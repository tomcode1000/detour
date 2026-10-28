// The Detour engine: plays a trip's events (flight feed, airline emails, traveller messages,
// merchant charges), asks the rules what the card should be, and keeps the card in line.
import * as rules from './rules.js';
import { parseTime } from './time.js';
import { fmtMoney, DECLINE_WORDS } from './agent/words.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export class Engine {
  constructor({ scenario, policy, makeFunding, agent, runId = Date.now().toString(36) }) {
    this.scenario = scenario;
    this.policy = policy;
    this.makeFunding = makeFunding;
    this.agent = agent;
    this.runId = runId;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    const s = this.scenario;
    this.clock = parseTime(s.start);
    this.funding = this.makeFunding({ clock: () => this.clock });
    this.flights = {};
    for (const [id, f] of Object.entries(s.flights)) this.flights[id] = this.normalFlight(f);
    this.legs = [...s.legs];
    this.cursor = 0;
    this.disruption = null;
    this.disruptionSeq = 0;
    this.card = null;
    this.transactions = [];
    this.approvals = [];
    this.messages = [];
    this.emails = [];
    this.log = [];
    this.scene = null;
    this.summary = null;
    this.waiting = false;
    this.busy = false;
    this.changed();
  }

  normalFlight(f) {
    const sched_dep = parseTime(f.sched_dep);
    const sched_arr = parseTime(f.sched_arr);
    return { ...f, sched_dep, sched_arr, est_dep: parseTime(f.est_dep ?? sched_dep), est_arr: parseTime(f.est_arr ?? sched_arr) };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(); }

  record(source, text, extra = {}) {
    this.log.push({ at: this.clock, source, text, ...extra });
  }

  get spent() {
    return this.transactions.filter((t) => t.status === 'APPROVED').reduce((s, t) => s + t.amount, 0);
  }

  async say(text) {
    if (text) this.messages.push({ at: this.clock, from: 'detour', text });
  }

  async notify(notice) {
    const text = await this.agent.notify({ notice: { spent: this.spent, ...notice }, card: this.card, policy: this.policy });
    await this.say(text);
  }

  // ---------------------------------------------------------------- playing the story
  get finished() { return this.cursor >= this.scenario.events.length; }

  async step() {
    if (this.busy || this.finished) return false;
    if (this.waiting && this.approvals.some((a) => a.status === 'PENDING')) return false;
    this.busy = true;
    try {
      this.waiting = false;
      const ev = this.scenario.events[this.cursor++];
      this.clock = Math.max(this.clock, parseTime(ev.at));
      await this.apply(ev);
      await this.reconcile();
    } catch (e) {
      this.record('error', e.message);
    } finally {
      this.busy = false;
      this.changed();
    }
    return true;
  }

  // Plays forward until the story ends or needs a human.
  async runToPause() {
    while (!this.finished) {
      const moved = await this.step();
      if (!moved) break;
      if (this.waiting && this.approvals.some((a) => a.status === 'PENDING')) break;
    }
  }

  async apply(ev) {
    switch (ev.type) {
      case 'note':
        this.scene = { name: ev.scene, text: ev.text };
        this.record('story', `${ev.scene}: ${ev.text}`);
        break;
      case 'feed':
        for (const u of ev.updates || []) {
          const f = this.flights[u.id];
          for (const [k, v] of Object.entries(u)) f[k] = ['est_dep', 'est_arr'].includes(k) ? parseTime(v) : v;
          this.record('feed', `${u.id}: ${this.describeFlight(f)}`);
        }
        if (ev.rebook) {
          const f = this.normalFlight(ev.rebook.flight);
          this.flights[f.id] = f;
          const old = this.legs[ev.rebook.leg];
          this.legs[ev.rebook.leg] = f.id;
          this.record('feed', `Rebooked: ${old} replaced by ${f.id} (${f.from}-${f.to})`);
        }
        break;
      case 'email': {
        const parsed = await this.agent.readEmail(ev);
        const agrees = this.feedAgrees(parsed);
        this.emails.push({ at: this.clock, from: ev.from, subject: ev.subject, body: ev.body, parsed, agrees });
        this.record('agent', `Airline email read as "${parsed.kind}" (${parsed.flights.join(', ') || 'no flight'}). ${agrees ? 'The flight feed agrees.' : 'The flight feed does not confirm this - an email alone cannot open or raise a card.'}`);
        break;
      }
      case 'traveller':
        await this.travellerSays(ev.text);
        break;
      case 'auth':
        await this.charge(ev);
        break;
      case 'await':
        this.waiting = true;
        this.record('story', ev.text);
        break;
      default:
        this.record('error', `Unknown event type ${ev.type}`);
    }
  }

  describeFlight(f) {
    if (f.status === 'CANCELLED') return 'cancelled';
    if (f.status === 'LANDED') return 'landed';
    const late = Math.round((f.est_arr - f.sched_arr) / 60e3);
    const lateText = late > 0 ? `${Math.floor(late / 60)}h${String(late % 60).padStart(2, '0')} late` : 'on time';
    if (f.status === 'DEPARTED') return late > 0 ? `in the air, arriving ${lateText}` : 'in the air';
    return late > 0 ? `running ${lateText}` : 'on time';
  }

  // An email counts only if the flight feed shows the same thing.
  feedAgrees(parsed) {
    const known = parsed.flights.map((id) => this.flights[id]).filter(Boolean);
    if (!known.length) return false;
    if (parsed.kind === 'rebooked') return parsed.flights.some((id) => this.legs.includes(id));
    if (parsed.kind === 'cancelled') return known.some((f) => f.status === 'CANCELLED');
    return rules.detectDisruption(this.legs, this.flights, this.policy) !== null;
  }

  // ---------------------------------------------------------------- the decision loop
  async reconcile() {
    if (this.summary) return;
    const last = this.flights[this.legs.at(-1)];
    if (last.status === 'LANDED') return this.closeOut();

    const d = this.disruption;
    if (d && !d.closed) {
      const leg = this.flights[this.legs[d.legIndex]];
      if (leg.status === 'DEPARTED' || leg.status === 'LANDED') {
        d.closed = true;
        this.record('rules', `${leg.id} has departed - the disruption is over.`);
        if (this.card?.status === 'ACTIVE') {
          await this.setCardStatus('INACTIVE');
          await this.notify({ type: 'expired' });
        }
        return;
      }
    }

    if (!this.disruption || this.disruption.closed) {
      const found = rules.detectDisruption(this.legs, this.flights, this.policy);
      if (!found) return;
      const flight = this.flights[this.legs[found.legIndex]];
      this.disruption = { ...found, seq: ++this.disruptionSeq, start: this.clock, closed: false, missedFlight: found.reason.includes('arrives too late') ? flight.id : null };
      this.record('rules', `Disruption detected: ${found.reason}. Ada is stranded in ${this.policy.cities[found.airport]?.city || found.airport}.`);
    }
    await this.alignCard();
  }

  // Works out the card the rules want now, and issues / updates / escalates.
  async alignCard() {
    const d = this.disruption;
    const city = this.policy.cities[d.airport];
    if (!city) return this.record('rules', `No city rates for ${d.airport}; escalate to the travel manager.`);
    const flight = this.flights[this.legs[d.legIndex]];
    const next = flight.id === d.missedFlight ? null : rules.nextDeparture(flight);

    let nights = rules.countNights({ start: d.start, next, now: this.clock, tz: city.tz, policy: this.policy });
    nights = Math.max(nights, this.card?.grantedNights ?? 0); // nights the manager approved stay
    const allowed = Math.max(this.card?.approvedNights ?? 0, this.policy.rules.auto_nights);
    if (nights > allowed && (this.card?.declinedNights ?? 0) >= nights) nights = allowed;

    const planned = this.plan({ nights, next, city });
    if (!this.card) {
      const why = rules.needsApproval(null, planned, 0, this.policy);
      if (why) return this.requestApproval({ kind: 'issue', from: null, to: planned, why });
      return this.issue(planned, d.reason);
    }
    if (rules.sameControls(this.card.controls, planned)) return this.supersedePending(planned);
    const why = rules.needsApproval(this.card.controls, planned, this.card.approvedNights, this.policy);
    if (why) {
      const tell = next ? `Your new flight leaves ${this.when(next)}, so you need night ${planned.nights} in ${city.city}` : `It looks like you need night ${planned.nights} in ${city.city}`;
      return this.requestApproval({ kind: 'nights', from: this.card.controls, to: planned, why, tell });
    }
    this.supersedePending(planned);
    await this.updateCard(planned);
  }

  plan({ nights, next, city, extras, extraCategories }) {
    const d = this.disruption;
    const planned = rules.planControls({
      nights, city, policy: this.policy,
      activeFrom: this.card?.controls.activeFrom ?? this.clock,
      activeTo: rules.activeUntil({ start: d.start, next, now: this.clock, policy: this.policy }),
      extras: extras ?? this.card?.extras ?? 0,
      extraCategories: extraCategories ?? this.card?.extraCategories ?? [],
    });
    return { ...planned, tz: city.tz, city: city.city };
  }

  async issue(controls, reason) {
    const requestId = `detour-${this.runId}-${this.scenario.traveller.id}-d${this.disruption.seq}`;
    const card = await this.funding.issue({ traveller: this.scenario.traveller, controls, requestId });
    this.card = { ...card, controls, approvedNights: 0, grantedNights: 0, declinedNights: 0, extras: 0, extraCategories: [] };
    this.record('card', `Card issued: ${fmtMoney(controls.limit, controls.currency)} for ${controls.categories.join(', ')}, until ${this.when(controls.activeTo)}.`, { requestId });
    await this.notify({ type: 'issued', reason: this.reasonInWords(reason) });
  }

  async updateCard(controls, change) {
    const before = this.card.controls;
    const card = await this.funding.update(this.card.id, controls);
    this.card.controls = controls;
    this.card.status = card.status || this.card.status;
    const what = change || this.diff(before, controls);
    this.record('card', `Card updated: ${what}.`);
    await this.notify({ type: 'updated', change: what });
  }

  async setCardStatus(status) {
    await this.funding.setStatus(this.card.id, status);
    this.card.status = status;
    this.record('card', `Card ${status === 'INACTIVE' ? 'switched off' : status.toLowerCase()}.`);
  }

  diff(a, b) {
    const parts = [];
    if (a.limit !== b.limit) parts.push(`limit ${fmtMoney(a.limit, a.currency)} -> ${fmtMoney(b.limit, b.currency)}`);
    const added = b.categories.filter((k) => !a.categories.includes(k)).map((k) => this.policy.categories[k].label.toLowerCase());
    if (added.length) parts.push(`${added.join(', ')} added`);
    if (a.activeTo !== b.activeTo) parts.push(`now works until ${this.when(b.activeTo)}`);
    return parts.join('; ') || 'no change';
  }

  reasonInWords(reason) {
    if (reason.includes('arrives too late')) return 'Your first flight is running late and you will miss your connection';
    if (reason.includes('cancelled')) return 'Your flight has been cancelled';
    return 'Your flight is badly delayed';
  }

  when(ms) {
    const tz = this.policy.cities[this.disruption?.airport]?.tz || 'UTC';
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  }

  // ---------------------------------------------------------------- approvals
  evidence() {
    return {
      flights: this.legs.map((id) => ({ id, from: this.flights[id].from, to: this.flights[id].to, status: this.describeFlight(this.flights[id]), est_dep: this.flights[id].est_dep })),
      emails: this.emails.slice(-2).map((e) => ({ subject: e.subject, agrees: e.agrees })),
      traveller: this.messages.filter((m) => m.from === 'traveller').slice(-1).map((m) => m.text),
    };
  }

  // Pending approvals that no longer match what the rules want are withdrawn.
  supersedePending(planned) {
    for (const a of this.approvals) {
      if (a.status === 'PENDING' && a.kind === 'nights' && !rules.sameControls(a.to, planned)) {
        a.status = 'WITHDRAWN';
        this.record('rules', `Approval ${a.id} withdrawn: the situation changed.`);
      }
    }
  }

  async requestApproval({ kind, from, to, why, tell, quiet }) {
    const same = this.approvals.find((a) => a.status === 'PENDING' && a.kind === kind && rules.sameControls(a.to, to));
    if (same) return same;
    this.supersedePending(to);
    const approval = {
      id: `apr_${this.approvals.length + 1}`, kind, at: this.clock, status: 'PENDING', why,
      from: from && clone(from), to: clone(to),
      delta: from ? Math.round((to.limit - from.limit) * 100) / 100 : to.limit,
      evidence: this.evidence(),
    };
    this.approvals.push(approval);
    this.record('rules', `${why} - sent to ${this.policy.travel_manager} (${approval.id}).`);
    if (!quiet) await this.notify({ type: 'approval_requested', why, tell });
    return approval;
  }

  async decide(id, decision) {
    const a = this.approvals.find((x) => x.id === id);
    if (!a || a.status !== 'PENDING') return false;
    this.busy = true;
    try {
      // The approval is bound to the exact card it was asked about. If the card has moved on, it is stale.
      if (a.from && !rules.sameControls(this.card?.controls, a.from)) {
        a.status = 'STALE';
        this.record('manager', `${a.id} is stale: the card changed since it was requested.`);
        return true;
      }
      a.status = decision === 'approve' ? 'APPROVED' : 'DECLINED';
      a.decidedAt = this.clock;
      this.record('manager', `${this.policy.travel_manager} ${a.status.toLowerCase()} ${a.id}: ${a.why}.`);
      if (a.status === 'APPROVED') {
        if (!this.card) {
          await this.issue(a.to, this.disruption.reason);
        } else {
          this.card.approvedNights = Math.max(this.card.approvedNights, a.to.nights);
          if (a.kind === 'nights') this.card.grantedNights = Math.max(this.card.grantedNights, a.to.nights);
          if (a.kind === 'raise') {
            this.card.extras = a.to.breakdown.extras;
            this.card.extraCategories = a.to.categories.filter((k) => !['meals', 'transport'].includes(k) && !(k === 'lodging' && a.to.nights > 0));
          }
          await this.updateCard(a.to);
        }
      } else {
        if (this.card) this.card.declinedNights = Math.max(this.card.declinedNights, a.to.nights);
        await this.notify({ type: 'declined_by_manager' });
      }
      await this.reconcile();
    } finally {
      this.busy = false;
      this.changed();
    }
    return true;
  }

  // ---------------------------------------------------------------- traveller and merchants
  async travellerSays(text) {
    this.messages.push({ at: this.clock, from: 'traveller', text });
    const proposal = await this.agent.understand(text, { card: this.card, policy: this.policy, spent: this.spent });
    this.record('agent', `Understood Ada as: ${JSON.stringify(proposal)}`);
    const outcome = await this.handleProposal(proposal);
    this.record('rules', `Decision: ${outcome.result}${outcome.why ? ` - ${outcome.why}` : ''}`);
    const reply = await this.agent.reply({ text, outcome: { ...outcome, spent: this.spent }, card: this.card, policy: this.policy });
    await this.say(reply);
  }

  async handleProposal(p) {
    if (p.kind === 'add_night') {
      if (this.approvals.some((a) => a.status === 'PENDING' && a.kind === 'nights')) return { result: 'pending' };
      if (!this.card || this.card.status !== 'ACTIVE') return { result: 'no_card' };
      // The traveller's word alone cannot add a night: the manager decides, with the feed as evidence.
      const city = this.policy.cities[this.disruption.airport];
      const to = this.plan({ nights: this.card.controls.nights + 1, next: null, city });
      await this.requestApproval({ kind: 'nights', from: this.card.controls, to, why: `Ada asks for night ${to.nights}, but the flight feed does not show it yet`, quiet: true });
      return { result: 'escalate', why: 'The flight information does not show another night yet.' };
    }
    if (p.kind !== 'raise') return { result: 'info' };

    const outcome = rules.evaluateRequest({ card: this.card, spent: this.spent, request: p, policy: this.policy });
    if (outcome.result === 'raise' || outcome.result === 'escalate') {
      const city = this.policy.cities[this.disruption.airport];
      const extraCategories = [...new Set([...(this.card.extraCategories || []), outcome.category])];
      const to = this.plan({ nights: this.card.controls.nights, next: null, city, extras: (this.card.extras || 0) + outcome.raise, extraCategories });
      to.activeTo = this.card.controls.activeTo;
      if (outcome.result === 'raise') {
        this.card.extras = to.breakdown.extras;
        this.card.extraCategories = extraCategories;
        await this.updateCard(to, `raised by ${fmtMoney(outcome.raise, to.currency)} for ${this.policy.categories[outcome.category].label.toLowerCase()}`);
        return { ...outcome, result: 'raised' };
      }
      await this.requestApproval({ kind: 'raise', from: this.card.controls, to, why: outcome.why, quiet: true });
    }
    return outcome;
  }

  async charge(ev) {
    if (!this.card) {
      this.record('merchant', `${ev.merchant} tried to charge ${fmtMoney(ev.amount, ev.currency)} but there is no card.`);
      return null;
    }
    const tx = await this.funding.authorize(this.card.id, ev);
    tx.label = ev.label;
    this.transactions.push(tx);
    const verdict = tx.status === 'APPROVED' ? 'approved' : `declined (${tx.reason})`;
    this.record('merchant', `${ev.merchant}: ${fmtMoney(ev.amount, ev.currency)} (MCC ${ev.mcc}) ${verdict}.`);
    if (tx.status !== 'APPROVED') {
      await this.notify({ type: 'purchase_declined', amount: ev.amount, currency: ev.currency, merchant: ev.merchant, reasonText: DECLINE_WORDS[tx.reason] || tx.reason });
    }
    return tx;
  }

  // A purchase typed in from the page ("try the card").
  async tryPurchase({ merchant, mcc, amount, currency }) {
    if (this.busy) return null;
    this.busy = true;
    try {
      return await this.charge({ merchant: merchant || 'Test merchant', mcc: String(mcc), amount: Number(amount), currency: currency || this.card?.controls.currency, label: `manual-${this.transactions.length + 1}` });
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async chat(text) {
    if (this.busy) return;
    this.busy = true;
    try { await this.travellerSays(text); } finally { this.busy = false; this.changed(); }
  }

  async closeOut() {
    if (this.card && this.card.status !== 'CLOSED') await this.setCardStatus('CLOSED');
    const approved = this.transactions.filter((t) => t.status === 'APPROVED');
    const byCategory = {};
    for (const t of approved) {
      const cat = Object.entries(this.policy.categories).find(([, c]) => c.mccs.includes(t.mcc))?.[0] || 'other';
      byCategory[cat] = Math.round(((byCategory[cat] || 0) + t.amount) * 100) / 100;
    }
    this.summary = {
      currency: this.card?.controls.currency,
      spent: Math.round(this.spent * 100) / 100,
      limit: this.card?.controls.limit,
      byCategory,
      declined: this.transactions.filter((t) => t.status !== 'APPROVED').length,
      nights: this.card?.controls.nights ?? 0,
      approvals: this.approvals.filter((a) => a.status === 'APPROVED').length,
    };
    this.record('card', `Trip over. Spent ${fmtMoney(this.summary.spent, this.summary.currency || '')} of ${fmtMoney(this.summary.limit || 0, this.summary.currency || '')}.`);
    if (this.card) await this.notify({ type: 'closed', spent: this.summary.spent, currency: this.summary.currency });
  }

  // ---------------------------------------------------------------- what the page sees
  snapshot() {
    const next = this.scenario.events[this.cursor];
    return {
      title: this.scenario.title,
      note: this.scenario.note,
      clock: this.clock,
      tz: this.policy.cities[this.disruption?.airport]?.tz || 'Europe/Berlin',
      scene: this.scene,
      progress: { at: this.cursor, total: this.scenario.events.length, finished: this.finished, waiting: this.waiting && this.approvals.some((a) => a.status === 'PENDING'), next: next ? next.type : null },
      adapters: { funding: this.funding.label, fundingName: this.funding.name, agent: this.agent.label, agentName: this.agent.name },
      company: this.policy.company,
      manager: this.policy.travel_manager,
      ratesNote: this.policy.rates_note,
      traveller: { name: `${this.scenario.traveller.first_name} ${this.scenario.traveller.last_name}`, role: this.scenario.traveller.role },
      legs: this.legs.map((id) => ({ ...this.flights[id], statusText: this.describeFlight(this.flights[id]) })),
      disruption: this.disruption,
      card: this.card && {
        id: this.card.id, last4: this.card.last4, status: this.card.status,
        controls: this.card.controls,
        categoryLabels: this.card.controls.categories.map((k) => this.policy.categories[k].label),
        spent: Math.round(this.spent * 100) / 100,
        remaining: Math.round((this.card.controls.limit - this.spent) * 100) / 100,
      },
      transactions: this.transactions,
      approvals: this.approvals,
      messages: this.messages,
      emails: this.emails,
      log: this.log,
      summary: this.summary,
      busy: this.busy,
    };
  }
}
