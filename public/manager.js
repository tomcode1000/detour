// Detour travel manager app: company sign-up, trips and invites, approvals, payments, policy and log.
// Shared helpers come from app-core.js.
let S = null;
let openApproval = null;
let openTrip = null;
let logFilter = 'all';
// Inside the demo page the phones keep their own sign-in, so Reset can start them from the beginning.
const KEY = EMBED ? 'detour.demo.manager' : 'detour.manager';
try { localStorage.setItem('detour.role', 'manager'); } catch {}
const session = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

const traveller = () => S.traveller.name;
const liveInvite = () => S.account?.invites.find((i) => i.live);
const first = () => traveller().split(' ')[0];
const mgr = () => S.account?.company.manager || S.manager;
const tzOf = (code) => AIRPORTS[code]?.[3] || 'UTC';
const PAY_PILL = { SENT: '<span class="pill ok">Paid</span>', SCHEDULED: '<span class="pill info">Scheduled</span>', CANCELLED: '<span class="pill bad">Cancelled</span>', DECLINED: '<span class="pill bad">Declined</span>' };
const ADA = '<span class="avatar md photo"><img src="/img/app/ada.jpg" alt=""></span>';

// ---------------------------------------------------------------- start, sign up, sign in
function showMain() {
  $('top-actions').hidden = false;
  go('home', { replace: true });
  if (S) render(S);
}
function start() {
  if (session.get()) return showMain();
  go('start', { replace: true });
}

$('demo-company').onclick = async () => {
  const j = await api('/api/signin', { demo: true });
  if (j.ok) { session.set('demo'); showMain(); }
};
$('signin-form').onsubmit = async (e) => {
  e.preventDefault();
  $('si-error').textContent = '';
  const j = await api('/api/signin', { email: $('si-email').value, password: $('si-pass').value }, { quiet: true });
  if (!j.ok) { $('si-error').textContent = j.error; return; }
  session.set($('si-email').value.trim().toLowerCase());
  $('si-pass').value = '';
  showMain();
};
$('su1-form').onsubmit = (e) => {
  e.preventDefault();
  const err = $('su1-error');
  err.textContent = '';
  if (!$('su-company').value.trim() || !$('su-name').value.trim()) { err.textContent = 'Add your company name and your name.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('su-email').value.trim())) { err.textContent = 'That email address does not look right.'; return; }
  if ($('su-pass').value.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
  fillPolicyFields(document.querySelector('#su2-form .policy-fields'));
  go('signup2');
};
$('su2-form').onsubmit = async (e) => {
  e.preventDefault();
  $('su2-error').textContent = '';
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const j = await api('/api/signup', {
    company: $('su-company').value, manager: $('su-name').value, email: $('su-email').value, password: $('su-pass').value,
    country: $('su-country').value, currency: $('su-currency').value, policy: readPolicyFields(e.target),
  }, { quiet: true });
  btn.disabled = false;
  if (!j.ok) { $('su2-error').textContent = j.error; return; }
  session.set($('su-email').value.trim().toLowerCase());
  $('su-pass').value = '';
  showMain();
  toast(`Welcome to Detour, ${$('su-name').value.trim().split(' ')[0]}.`);
};
$('m-signout').onclick = () => { session.clear(); $('top-actions').hidden = true; go('start', { replace: true }); };

// Policy form (sign-up step 2 and Edit policy)
function fillPolicyFields(box) {
  const r = S.policy.rules;
  const opt = (vals, cur, label) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label(v)}</option>`).join('');
  box.innerHTML = `
    <div class="grid2">
      <label class="field"><span>Nights covered automatically</span><select name="nights">${opt([0, 1, 2, 3], r.auto_nights, (v) => `${v} night${v === 1 ? '' : 's'}`)}</select></label>
      <label class="field"><span>Approval needed above</span><select name="raise">${opt([25, 50, 75, 100], r.max_auto_raise_pct, (v) => `+${v}%`)}</select></label>
    </div>
    <div class="section-head" style="padding-top:2px"><h2>City rates</h2></div>
    ${Object.entries(S.policy.cities).map(([code, c]) => `
      <div class="card flight-form" data-city="${code}">
        <div class="flight-n"><b style="color:var(--text);font-size:15px">${esc(c.city)}</b><span>${esc(c.currency)}</span></div>
        <div class="grid3">
          <label class="field"><span>Meals / day</span><input name="meals" type="number" min="1" step="1" inputmode="numeric" value="${c.meals_per_day}"></label>
          <label class="field"><span>Taxis</span><input name="transport" type="number" min="1" step="1" inputmode="numeric" value="${c.transport}"></label>
          <label class="field"><span>Hotel / night</span><input name="lodging" type="number" min="1" step="1" inputmode="numeric" value="${c.lodging_per_night}"></label>
        </div>
      </div>`).join('')}`;
}
function readPolicyFields(form) {
  const cities = {};
  form.querySelectorAll('[data-city]').forEach((el) => {
    cities[el.dataset.city] = { meals: Number(el.querySelector('[name=meals]').value), transport: Number(el.querySelector('[name=transport]').value), lodging: Number(el.querySelector('[name=lodging]').value) };
  });
  return { auto_nights: Number(form.querySelector('[name=nights]').value), max_auto_raise_pct: Number(form.querySelector('[name=raise]').value), cities };
}
onView('signup2', () => { const box = document.querySelector('#su2-form .policy-fields'); if (!box.children.length) fillPolicyFields(box); });
onView('policyedit', () => fillPolicyFields(document.querySelector('#pe-form .policy-fields')));
$('pe-form').onsubmit = async (e) => {
  e.preventDefault();
  $('pe-error').textContent = '';
  const j = await api('/api/policy', readPolicyFields(e.target), { quiet: true });
  if (!j.ok) { $('pe-error').textContent = j.error; return; }
  toast('Policy saved.');
  goBack();
};

// ---------------------------------------------------------------- render
function render(s) {
  const before = S;
  S = s;
  const pending = s.approvals.filter((a) => a.status === 'PENDING');
  $('appr-count').hidden = !pending.length;
  $('appr-count').textContent = pending.length;
  $('bell-dot').hidden = !pending.length;
  $('top-avatar').textContent = initials(mgr());
  renderHome(pending);
  renderApprovals();
  if (openApproval) renderApproval();
  renderTrips();
  if (openTrip) renderTrip();
  renderMore();
  renderPayments();
  renderClaim(S.claim, { manage: true });
  renderPolicy();
  renderLog();
  if (before && !$('top-actions').hidden) momentsFor(before, s);
}

// ---------------------------------------------------------------- moments: what Sam sees the instant something happens
function momentsFor(a, b) {
  for (const ap of b.approvals) {
    if (ap.status !== 'PENDING' || a.approvals.some((x) => x.id === ap.id)) continue;
    const f = ap.evidence.flights.at(-1);
    moment({
      tone: 'warn', icon: 'bang', title: 'Decision required',
      sub: `${first()} needs ${ap.kind === 'nights' ? `night ${ap.to.nights} in ${ap.to.city}` : `extra cover in ${ap.to.city}`}. ${ap.why}.`,
      amount: `+${money(ap.delta, ap.to.currency)}`, amountNote: `Updated coverage ${money(ap.to.limit, ap.to.currency)}`,
      rows: f ? [['plane', `${f.id} ${f.from} → ${f.to}`, f.status.charAt(0).toUpperCase() + f.status.slice(1).toLowerCase()]] : [],
      primary: { label: 'Review request', run: () => { openApproval = ap.id; renderApproval(); go('approval'); } },
      secondary: { label: 'Later' },
    });
  }

  const was = (id) => (a.payments || []).find((l) => l.id === id);
  const sent = (b.payments || []).filter((l) => l.status === 'SENT' && was(l.id)?.status !== 'SENT');
  if (sent.length) {
    const toAda = sent.filter((l) => l.role === 'traveller');
    const toHotel = sent.filter((l) => l.role === 'hotel');
    const parts = [];
    if (toAda.length) parts.push(`${money(sum(toAda), toAda[0].currency)} to ${first()}`);
    if (toHotel.length) parts.push(`${money(sum(toHotel), toHotel[0].currency)} to ${toHotel[0].payeeName.replace(/\s+GmbH$/, '')}${toHotel[0].method === 'card' ? ` on the hotel card ••${toHotel[0].card}` : ''}`);
    toast(`Paid ${parts.join(' and ')}.`);
  }

  for (const t of (b.transactions || []).slice((a.transactions || []).length)) {
    toast(t.status === 'APPROVED' ? `${first()} paid ${money(t.amount, t.currency)} at ${t.merchant.split(',')[0]}.` : `Card declined: ${money(t.amount, t.currency)} at ${t.merchant.split(',')[0]} is not meals or taxis.`);
  }
  if ((b.payments || []).length !== (a.payments || []).length || (b.transactions || []).length !== (a.transactions || []).length) loadBalance(true);

  // A traveller says the trip on their invite is wrong.
  for (const i of b.account?.invites || []) {
    if (i.disputed && !(a.account?.invites || []).find((x) => x.token === i.token)?.disputed) {
      moment({ tone: 'warn', icon: 'warn', title: `${i.name.split(' ')[0]} says this isn't their trip`, sub: `${i.name} checked the flights on the invite and they don't match. Remove the trip and add the right flights.`, primary: { label: 'Open the trip', go: 'trips' }, secondary: { label: 'Later' } });
    }
  }

  for (const m of b.inbox || []) {
    const old = (a.inbox || []).find((x) => x.id === m.id);
    if (m.verdict === 'suspicious' && old?.verdict !== 'suspicious') toast(`Detour caught a fake airline message sent to ${first()}. Nothing was paid.`);
  }

  if (b.summary && !a.summary) {
    const sm = b.summary;
    moment({
      tone: 'ok', icon: 'check', title: 'Trip closed', sub: `${first()} is on the way. No expense claim to check.`,
      rows: sm.mode === 'transfer'
        ? [['users', `Sent to ${first()}`, money(sm.toTraveller, sm.currency)], ['bed', 'Paid to the hotel', money(sm.toHotel, sm.currency)], ['refresh', 'Cancelled, never paid', money(sm.cancelled, sm.currency)]]
        : [['card', 'Spent on the card', money(sm.spent, sm.currency)], ...(sm.toHotel ? [['bed', 'Paid to the hotel', money(sm.toHotel, sm.currency)]] : []), ...(sm.unused ? [['refresh', 'Left on the card, never spent', money(sm.unused, sm.currency)]] : [])],
      primary: { label: 'See payments', go: 'payments' }, secondary: { label: 'Close' },
    });
  }
}

function approvalTitle(a) {
  if (a.kind === 'nights') return `Additional hotel night in ${a.to.city}`;
  if (a.kind === 'issue') return `Cover in ${a.to.city}`;
  return `Extra allowance in ${a.to.city}`;
}
function tripStatus() {
  if (S.summary) return '<span class="pill plain">Closed</span>';
  const d = S.disruption;
  if (d && !d.closed) return `<span class="pill bad">${/cancelled/.test(d.reason) ? 'Cancelled' : /arrives too late/.test(d.reason) ? 'Disrupted' : 'Delayed'}</span>`;
  if (d?.closed) return '<span class="pill info">In the air</span>';
  return '<span class="pill ok">On track</span>';
}
const liveRoute = () => [S.legs[0]?.from, ...S.legs.map((l) => l.to)].join(' → ');

function renderHome(pending) {
  const h = Number(fmt(S.clock, S.tz, { hour: '2-digit' }));
  $('h-hello').innerHTML = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(mgr().split(' ')[0])} 👋`;
  const invites = (S.account?.invites || []).filter((i) => !i.live);
  const trips = (liveInvite() ? 1 : 0) + (S.otherTrips || []).length + invites.length;
  const disrupted = S.disruption && !S.disruption.closed && !S.summary ? 1 : 0;
  const pay = S.payments || [];
  const cur = S.card?.controls.currency || S.account?.company.currency || 'EUR';
  const sent = sum(pay.filter((l) => l.status === 'SENT')) + cardSpent();
  const sched = sum(pay.filter((l) => l.status === 'SCHEDULED'));
  const covered = S.card?.status === 'ACTIVE' ? 1 : 0;
  $('h-balance').innerHTML = balanceHtml({ compact: true });
  $('h-tiles').innerHTML = `
    <button class="tile" data-go="trips">${icon('plane', 'c-cyan')}<b>${trips}</b><span>Active trips</span><em class="c-green">${invites.length ? `${invites.length} invited` : 'All being watched'}</em></button>
    <button class="tile" data-go="${pending.length ? 'approvals' : 'trips'}">${icon('warn', 'c-orange')}<b>${disrupted}</b><span>Disruptions</span><em class="${disrupted || pending.length ? 'c-orange' : 'c-green'}">${pending.length ? 'Needs attention' : disrupted ? 'Handled by Detour' : 'None right now'}</em></button>
    <button class="tile" data-go="policy">${icon('shield', 'c-green')}<b>${covered}</b><span>Covered now</span><em class="c-green">Within policy</em></button>
    <button class="tile" data-go="payments">${icon('wallet', 'c-purple')}<b>${money(sent, cur)}</b><span>Paid out</span><em class="c-purple">${sched ? `${money(sched, cur)} scheduled` : 'Nothing scheduled'}</em></button>`;
  $('h-decisions').innerHTML = pending.map((a) => `
    <button class="banner warn" data-approval="${a.id}"><span class="badge">${icon('bang')}</span><div class="grow"><b>Decision required</b><small>${esc(first())} · ${a.kind === 'nights' ? `night ${a.to.nights} in ${esc(a.to.city)}` : esc(approvalTitle(a))} · +${money(a.delta, a.to.currency)}</small></div>${icon('chev-r', 'chev')}</button>`).join('');
  const live = liveInvite();
  $('h-trips').innerHTML = (live ? (live.registered ? liveTripCard() : inviteCard(live)) : noTripCard()) + (S.otherTrips || []).slice(0, 2).map(otherTripCard).join('');
}

function liveTripCard() {
  const c = S.card;
  const extra = c && S.mode === 'transfer' ? `<small>${icon('shield', 'c-green')} Covered until ${esc(dayHm(c.controls.activeTo, S.tz))}</small>` : '';
  return `<div class="card"><button class="row tap" data-trip="live">${ADA}<div class="grow"><b>${esc(traveller())}<span class="tag">Traveller</span></b><small>${esc(S.traveller.role)}</small><small style="color:var(--text);margin-top:6px">${icon('plane', 'c-cyan')} ${esc(liveRoute())}</small>${extra}</div><div class="end">${tripStatus()}</div></button></div>`;
}
function noTripCard() {
  return `<div class="card"><button class="row tap" data-go="invite"><span class="ic">${icon('user-plus')}</span><div class="grow"><b>Add your first trip</b><small>Invite a traveller by email. Detour starts watching their flights.</small></div>${icon('chev-r', 'chev')}</button></div>`;
}
function otherTripCard(t) {
  return `<div class="card"><div class="row"><span class="avatar md">${esc(initials(t.name))}</span><div class="grow"><b>${esc(t.name)}</b><small>${esc(t.role)} · ${esc(t.flight)} ${esc(t.when)}</small><small style="color:var(--text);margin-top:6px">${icon('plane', 'c-cyan')} ${esc(t.route)}</small></div><div class="end"><span class="pill ok">On track</span></div></div></div>`;
}
function inviteCard(i) {
  const codes = [i.flights[0]?.from, ...i.flights.map((f) => f.to)].join(' → ');
  return `<div class="card"><button class="row tap" data-trip="${esc(i.token)}"><span class="avatar md">${esc(initials(i.name))}</span><div class="grow"><b>${esc(i.name)}</b><small>${esc(i.role)} · ${esc(i.email)}</small><small style="color:var(--text);margin-top:6px">${icon('plane', 'c-cyan')} ${esc(codes)}</small></div><div class="end">${i.disputed ? '<span class="pill bad">Wrong trip</span>' : i.registered ? '<span class="pill ok">Registered</span>' : '<span class="pill info">Invited</span>'}</div></button></div>`;
}

// ---------------------------------------------------------------- approvals
function renderApprovals() {
  const list = S.approvals.slice().reverse();
  $('a-list').innerHTML = list.length ? list.map((a) => {
    const pill = { PENDING: '<span class="pill warn">Pending</span>', APPROVED: '<span class="pill ok">Approved</span>', DECLINED: '<span class="pill bad">Declined</span>' }[a.status] || '';
    return `<div class="card"><button class="row tap" data-approval="${a.id}">${ADA}<div class="grow"><b>${esc(traveller())}</b><small>${esc(approvalTitle(a))}</small><small>${esc(dayHm(a.decidedAt || a.at, S.tz))}</small></div><div class="end"><b>+${money(a.delta, a.to.currency)}</b>${pill}</div></button></div>`;
  }).join('') : '<div class="card"><div class="empty">Nothing needs you. Detour handles everything inside your policy on its own.</div></div>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-approval]');
  if (!b) return;
  openApproval = b.dataset.approval;
  renderApproval();
  go('approval');
});
function renderApproval() {
  const a = S.approvals.find((x) => x.id === openApproval);
  if (!a) return;
  const to = a.to;
  const status = { PENDING: '<span class="pill warn" style="height:34px;padding:0 14px;font-size:14px">' + icon('bang') + 'Pending approval</span>', APPROVED: '<span class="pill ok" style="height:34px;padding:0 14px;font-size:14px">' + icon('check') + 'Approved</span>', DECLINED: '<span class="pill bad" style="height:34px;padding:0 14px;font-size:14px">' + icon('x') + 'Declined</span>' }[a.status];
  const hotel = S.policy.cities[Object.keys(S.policy.cities).find((k) => S.policy.cities[k].city === to.city)]?.hotel;
  const flights = a.evidence.flights;
  const f = flights.at(-1);
  const emails = a.evidence.emails;
  const email = emails.filter((e) => e.agrees).at(-1) || emails.at(-1);
  const subjects = new Set((S.inbox || []).map((m) => m.subject));
  const said = a.evidence.traveller.filter((t) => !subjects.has(t)).at(-1);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  const fCls = (t) => (/cancel/i.test(t) ? 'bad' : /late|delay/i.test(t) ? 'warn' : 'ok');
  $('ap-body').innerHTML = `
    <div>${status}</div>
    <div class="who">${ADA.replace('md', 'lg')}<div><b>${esc(traveller())}</b><small>${esc(companyName(S))}</small></div></div>
    <div class="card">
      <div class="split"><div class="grow"><h3>${esc(approvalTitle(a))}</h3><p>${esc(a.why)}.</p></div><div class="side"><b class="amount-big">+${money(a.delta, to.currency)}</b><small class="c-muted" style="display:block;margin-top:2px">Additional</small></div></div>
      <div class="row" style="min-height:52px">${icon('shield-o', 'c-cyan')}<div class="grow"><small style="margin:0">Updated coverage · until ${esc(dayHm(to.activeTo, S.tz))}</small></div><b class="amount-big" style="font-size:19px">${money(to.limit, to.currency)}</b></div>
    </div>
    ${hotel ? `<div class="card"><div class="row"><img class="thumb" style="width:76px;height:56px" src="/img/app/hotel.jpg" alt=""><div class="grow"><small style="margin:0 0 2px">Hotel · paid directly</small><b>${esc(hotel.replace(/\s+GmbH$/, ''))}</b><small>${icon('pin', 'c-cyan')} ${esc(to.city)} · ${to.nights} night${to.nights > 1 ? 's' : ''}</small></div></div></div>` : ''}
    ${f ? `<div class="card"><div class="row"><span class="ic plain">${icon('plane')}</span><div class="grow"><b>Flight status <span class="pill ${fCls(f.status)}" style="margin-left:6px">${esc(cap(f.status))}</span></b><small>${flights.map((x) => `${esc(x.id)} ${esc(x.from)} → ${esc(x.to)}`).join(' · ')}</small></div></div></div>` : ''}
    ${email ? `<div class="card"><div class="row"><span class="doc-thumb"></span><div class="grow"><b>Airline message (evidence)</b><p class="ev-quote">“${esc(email.subject)}”</p>${email.agrees ? '' : '<small class="c-orange">The flight feed does not confirm this yet</small>'}</div></div></div>` : ''}
    ${said ? `<div class="card"><div class="row"><span class="ic plain">${icon('chat')}</span><div class="grow"><b>Traveller's explanation</b><p class="ev-quote">“${esc(said)}”</p></div></div></div>` : ''}
    ${a.status === 'PENDING' ? `<div class="sticky-actions"><div class="btn-row"><button class="btn ghost" data-decide="decline">${icon('x')}Decline</button><button class="btn primary" data-decide="approve">${icon('check')}Approve</button></div></div>` : `<p class="fine">Decided ${esc(dateHm(a.decidedAt || a.at, S.tz))} by ${esc(mgr())}</p>`}`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-decide]');
  if (!b) return;
  const approve = b.dataset.decide === 'approve';
  const ap = S.approvals.find((x) => x.id === openApproval);
  b.closest('.btn-row').querySelectorAll('button').forEach((x) => { x.disabled = true; });
  b.classList.add('busy');
  b.innerHTML = `<span class="spin"></span>${approve ? 'Approving' : 'Declining'}`;
  const j = await api('/api/decide', { id: openApproval, decision: b.dataset.decide });
  if (!j.ok || !ap) { renderApproval(); return; }
  const what = ap.kind === 'nights' ? `Night ${ap.to.nights} in ${ap.to.city}` : approvalTitle(ap);
  moment(approve
    ? { tone: 'ok', icon: 'check', title: 'Request approved', sub: `${first()} has been told.${ap.kind === 'nights' ? ' The hotel is paid directly.' : ''}`, amount: `+${money(ap.delta, ap.to.currency)}`, amountNote: what,
        rows: [['shield-o', 'Updated coverage', money(ap.to.limit, ap.to.currency)], ['clock', 'Covered until', dayHm(ap.to.activeTo, S.tz)]], primary: { label: 'Done', go: 'home' } }
    : { tone: 'info', icon: 'x', title: 'Request declined', sub: `${first()} has been told. Detour keeps the cover inside your policy.`, amountNote: what, primary: { label: 'Done', go: 'home' } });
});

// ---------------------------------------------------------------- trips
function renderTrips() {
  const invites = (S.account?.invites || []).filter((i) => !i.live);
  const live = liveInvite();
  $('t-list').innerHTML = (live ? (live.registered ? liveTripCard() : inviteCard(live)) : '') + invites.slice().reverse().map(inviteCard).join('') + (S.otherTrips || []).map(otherTripCard).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-trip]');
  if (!b) return;
  openTrip = b.dataset.trip;
  renderTrip();
  go('trip');
});
function renderTrip() {
  let legs; let stay = null; let who; let last = '';
  if (openTrip === 'live') {
    legs = S.legs.map((l) => ({ ...l, dep: l.est_dep }));
    const d = S.disruption;
    stay = d && !d.closed ? d.airport : null;
    who = `${ADA.replace('md', 'lg')}<div><b>${esc(traveller())}</b><small>${esc(S.traveller.role)} · ${tripStatus()}</small></div>`;
    const m = S.messages.at(-1);
    if (m) last = `<div class="section-head"><h2>Latest message</h2></div><div class="card pad"><small class="c-muted">${m.from === 'traveller' ? esc(first()) : `Detour to ${esc(first())}`} · ${esc(dayHm(m.at, S.tz))}</small><p style="margin-top:6px;color:#c9d6e2;font-size:14.5px">${esc(m.text)}</p></div>`;
  } else {
    const i = (S.account?.invites || []).find((x) => x.token === openTrip);
    if (!i) return;
    legs = i.flights.map((f) => ({ id: f.id, from: f.from, to: f.to, dep: Date.parse(f.dep), status: 'SCHEDULED', statusText: 'on time' }));
    who = `<span class="avatar lg">${esc(initials(i.name))}</span><div><b>${esc(i.name)}</b><small>${esc(i.email)} · ${i.registered ? 'Registered' : 'Invited'}</small></div>`;
  }
  const disputed = (openTrip === 'live' ? liveInvite() : (S.account?.invites || []).find((x) => x.token === openTrip))?.disputed;
  $('tr-who').innerHTML = who;
  $('tr-flag').innerHTML = disputed ? `<div class="banner warn"><span class="badge">${icon('warn')}</span><div class="grow"><b>The traveller says this isn't their trip</b><small>Remove it and add the right flights. They get a new invite.</small></div></div>` : '';
  const d = openTrip === 'live' ? S.disruption : null;
  const state = (l) => (l.status === 'LANDED' || l.status === 'DEPARTED' ? 'done' : l.status === 'CANCELLED' || d?.missedFlight === l.id ? 'broken' : 'next');
  if (currentView === 'trip') drawRoute($('tr-map'), legs.map((l) => ({ from: l.from, to: l.to, state: state(l) })), { stay });
  $('tr-legs').innerHTML = legs.map((f) => `<div class="row"><span class="ic plain">${icon('plane')}</span><div class="grow"><b>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)}</b><small>Departs ${esc(dateHm(f.dep, tzOf(f.from)))}</small></div>${state(f) === 'broken' ? '<span class="pill bad">Disrupted</span>' : state(f) === 'done' ? '<span class="pill plain">Flown</span>' : '<span class="pill ok">Scheduled</span>'}</div>`).join('');
  $('tr-claim').innerHTML = openTrip === 'live' ? claimRow(S.claim) : '';
  // Invites can be sent again (a fresh link) or removed. Ada's trip stays once the demo story is running.
  const inv = openTrip === 'live' ? liveInvite() : (S.account?.invites || []).find((x) => x.token === openTrip);
  const canRemove = inv && !(inv.live && S.progress.at > 0);
  $('tr-actions').innerHTML = inv ? `<div class="btn-row">${inv.registered ? '' : `<button class="btn ghost" data-renew="${esc(inv.token)}">${icon('mail')}Send invite again</button>`}${canRemove ? `<button class="btn ghost danger" data-remove="${esc(inv.token)}">${icon('x')}Remove trip</button>` : ''}</div>` : '';
  $('tr-last').innerHTML = last;
}
onView('trip', () => renderTrip());

// Add a trip and invite
let flightRows = 0;
function addFlightRow() {
  flightRows += 1;
  const n = $('inv-flights').children.length + 1;
  $('inv-flights').insertAdjacentHTML('beforeend', `<div class="card flight-form" data-flight>
    <div class="flight-n"><span>Flight ${n}</span>${n > 1 ? `<button type="button" data-remove aria-label="Remove flight">${icon('x')}</button>` : ''}</div>
    <label class="field"><span>Flight number</span><input name="id" placeholder="LH403" autocapitalize="characters" autocomplete="off"></label>
    <div class="grid2"><label class="field"><span>From</span><input name="from" placeholder="SIN" maxlength="3" autocapitalize="characters" autocomplete="off"></label><label class="field"><span>To</span><input name="to" placeholder="FRA" maxlength="3" autocapitalize="characters" autocomplete="off"></label></div>
    <div class="grid2"><label class="field"><span>Date</span><input name="date" type="date"></label><label class="field"><span>Departs (local)</span><input name="time" type="time" value="09:00"></label></div>
  </div>`);
}
$('inv-add').onclick = addFlightRow;
$('inv-flights').addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('[data-flight]').remove(); });
onView('invite', () => {
  if (!$('inv-flights').children.length) addFlightRow();
  $('inv-demo').hidden = Boolean(liveInvite()); // until Ada is invited, on the demo page and on a phone
});
// Demo page: fill in Ada's real itinerary (the one the scripted flight feed follows).
$('inv-demo').onclick = () => {
  $('inv-name').value = 'Ada Lim';
  $('inv-email').value = S.account.liveEmail;
  $('inv-role').value = S.traveller.role;
  $('inv-flights').innerHTML = '';
  S.account.liveEmail && [['DA779', 'SIN', 'FRA', '2026-11-05', '12:30'], ['DA908', 'FRA', 'LHR', '2026-11-05', '19:50']].forEach(([id, from, to, date, time]) => {
    addFlightRow();
    const row = $('inv-flights').lastElementChild;
    Object.entries({ id, from, to, date, time }).forEach(([k, v]) => { row.querySelector(`[name=${k}]`).value = v; });
  });
};
// Local departure time at the airport → UTC
function localToUtc(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess)).toISOString();
}
$('inv-form').onsubmit = async (e) => {
  e.preventDefault();
  $('inv-error').textContent = '';
  const flights = [...document.querySelectorAll('[data-flight]')].map((el) => {
    const v = (k) => el.querySelector(`[name=${k}]`).value.trim();
    const from = v('from').toUpperCase();
    return { id: v('id'), from, to: v('to').toUpperCase(), dep: v('date') ? localToUtc(v('date'), v('time'), tzOf(from)) : null };
  });
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const j = await api('/api/invite', { name: $('inv-name').value, email: $('inv-email').value, role: $('inv-role').value, flights }, { quiet: true });
  btn.disabled = false;
  if (!j.ok) { $('inv-error').textContent = j.error; return; }
  showInvited(j.result);
  e.target.reset();
  $('inv-flights').innerHTML = '';
};
document.addEventListener('click', async (e) => {
  const renew = e.target.closest('[data-renew]');
  const remove = e.target.closest('[data-remove]');
  if (renew) {
    const j = await api('/api/invite/renew', { token: renew.dataset.renew });
    if (j.ok) { openTrip = null; showInvited(j.result); toast('New invite link made. The old one no longer works.'); }
  } else if (remove) {
    const inv = (S.account?.invites || []).find((x) => x.token === remove.dataset.remove);
    if (!inv || !confirm(`Remove ${inv.name}'s trip? Detour stops watching their flights, and their invite link stops working.`)) return;
    const j = await api('/api/invite/remove', { token: inv.token });
    if (j.ok) { openTrip = null; toast(`${inv.name}'s trip removed.`); go('trips', { replace: true }); }
  }
});

function showInvited(inv) {
  const link = `${location.origin}/traveller?invite=${inv.token}`;
  const firstName = inv.name.split(' ')[0];
  $('iv-title').textContent = `Invite ready for ${firstName}`;
  $('iv-sub').textContent = `Send it to ${inv.email}, or let ${firstName} scan the code.`;
  $('iv-link').textContent = link;
  $('iv-qr').innerHTML = '';
  if (window.QRCode) new window.QRCode($('iv-qr'), { text: link, width: 152, height: 152, colorDark: '#04111b', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
  const company = companyName(S);
  $('iv-mail').href = `mailto:${encodeURIComponent(inv.email)}?subject=${encodeURIComponent(`Your trip on Detour`)}&body=${encodeURIComponent(`Hi ${firstName},\n\n${company} has set up Detour for your trip. If a flight is cancelled or badly delayed, Detour pays for your meals, taxis and hotel.\n\nOpen this link on your phone to see your trip and finish registering:\n${link}\n\n${mgr()}`)}`;
  $('iv-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch { toast('Copy the link above.'); }
  };
  go('invited', { replace: true });
}

// ---------------------------------------------------------------- more, payments, policy, log
function renderMore() {
  const c = S.account?.company;
  $('m-who').innerHTML = `<span class="avatar lg">${esc(initials(mgr()))}</span><div><b>${esc(mgr())}</b><small>Travel manager · ${esc(companyName(S))}</small><small>${esc(c?.email || '')}</small></div>`;
  $('m-notif').innerHTML = notifRow();
  const liveMoney = S.adapters.fundingName.startsWith('airwallex');
  const liveAgent = S.adapters.agentName === 'deepseek';
  $('m-conn').innerHTML = `<div class="row"><span class="ic plain">${icon('bank')}</span><div class="grow"><b>Payments</b><small>${esc(S.adapters.funding)}</small></div><span class="pill ${liveMoney ? 'ok' : 'warn'}">${liveMoney ? 'Live' : 'Simulated'}</span></div>
    <div class="row"><span class="ic plain">${icon('sparkle')}</span><div class="grow"><b>Agent</b><small>${esc(S.adapters.agent)}</small></div><span class="pill ${liveAgent ? 'ok' : 'warn'}">${liveAgent ? 'Live' : 'Stand-in'}</span></div>`;
}

// ---------------------------------------------------------------- company balance (live from Airwallex)
let BAL = null;           // [{ currency, available, pending }] or null
let balAt = 0;
async function loadBalance(force = false) {
  if (!force && Date.now() - balAt < 15e3) return;
  balAt = Date.now();
  const j = await api('/api/balance', undefined, { quiet: true }).catch(() => null);
  if (j?.ok && Array.isArray(j.result)) { BAL = j.result; if (S) { renderHome(S.approvals.filter((a) => a.status === 'PENDING')); renderPayments(); renderFunds(); } }
}
const cardSpent = () => sum((S.transactions || []).filter((t) => t.status === 'APPROVED'));
// Money Detour has promised but not paid yet: scheduled hotel nights and what is left on open cards.
function committed() {
  const sched = sum((S.payments || []).filter((l) => l.status === 'SCHEDULED'));
  const open = S.card?.status === 'ACTIVE' && S.mode === 'card' ? Math.max(0, S.card.remaining) : 0;
  return { sched, open, total: sched + open };
}
function balanceHtml({ compact = false } = {}) {
  const cur = S.card?.controls.currency || 'EUR';
  const main = BAL?.find((b) => b.currency === cur);
  const others = (BAL || []).filter((b) => b.currency !== cur && b.available > 0).slice(0, 3);
  const c = committed();
  if (!BAL) return compact ? '' : '<div class="card"><div class="empty">Reading your balance from Airwallex…</div></div>';
  return `<div class="card"><button class="row tap" data-go="funds"><span class="ic green">${icon('bank')}</span><div class="grow"><small style="margin:0 0 2px">Company balance · Airwallex</small><b class="amount-big">${money(main?.available ?? 0, cur)}</b><small>${c.total ? `${money(c.total, cur)} set aside for open trips` : others.length ? others.map((b) => money(b.available, b.currency, { maximumFractionDigits: 0 })).join(' · ') : 'Nothing set aside right now'}</small></div><span class="pill info">Add funds</span>${icon('chev-r', 'chev')}</button></div>`;
}
const currencyName = (code) => { try { const n = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code); return n.charAt(0).toUpperCase() + n.slice(1); } catch { return code; } };
function renderFunds() {
  if (!$('f-list')) return;
  const cur = S.card?.controls.currency || 'EUR';
  const list = (BAL || []).filter((b) => b.available > 0 || b.currency === cur).sort((a, b) => (b.currency === cur) - (a.currency === cur) || b.available - a.available);
  $('f-list').innerHTML = BAL ? list.map((b) => `<div class="row"><span class="ic plain">${esc(b.currency.slice(0, 3))}</span><div class="grow"><b>${esc(currencyName(b.currency))}</b><small>${b.pending ? `${money(b.pending, b.currency)} pending` : 'Available'}</small></div><div class="end"><b>${money(b.available, b.currency)}</b></div></div>`).join('') : '<div class="empty">Reading your balance from Airwallex…</div>';
  const c = committed();
  $('f-commit').innerHTML = `<div class="row"><span class="ic orange">${icon('clock')}</span><div class="grow"><b>Set aside for open trips</b><small>${c.sched ? `${money(c.sched, cur)} hotel nights scheduled` : 'No hotel nights scheduled'}${c.open ? ` · ${money(c.open, cur)} left on Detour cards` : ''}</small></div><div class="end"><b>${money(c.total, cur)}</b></div></div>`;
  $('f-open').href = S.adapters.fundingName.startsWith('airwallex') ? 'https://www.sandbox.airwallex.com/' : 'https://www.airwallex.com/';
  $('f-note').textContent = S.adapters.fundingName.startsWith('airwallex') ? 'Read live from your Airwallex sandbox account. Sandbox balances are Airwallex test money.' : 'Local simulation: demo balances, not Airwallex.';
}
onView('funds', () => { renderFunds(); loadBalance(true); });
onView('home', () => loadBalance());
onView('payments', () => loadBalance());

function renderPayments() {
  const pay = S.payments || [];
  const cur = S.card?.controls.currency || S.account?.company.currency || 'EUR';
  const sent = pay.filter((l) => l.status === 'SENT');
  $('p-total').innerHTML = `<div class="row"><span class="ic">${icon('wallet')}</span><div class="grow"><small style="margin:0 0 2px">Total paid</small><b class="amount-big">${money(sum(sent), cur)}</b></div><div class="end"><small>${pay.filter((l) => l.status === 'SCHEDULED').length} scheduled</small><small>${pay.filter((l) => l.status === 'CANCELLED').length} cancelled</small></div></div>`;
  $('p-stats').innerHTML = [
    ['users', 'To travellers', sum(sent.filter((l) => l.role === 'traveller'))],
    ['bed', 'To hotels', sum(sent.filter((l) => l.role === 'hotel'))],
    ['doc', 'Fees', sum(sent, (l) => l.fee || 0)],
  ].map(([ic, k, v]) => `<div class="tile">${icon(ic, 'c-cyan')}<b style="font-size:17px">${money(v, cur)}</b><span style="font-size:12.5px">${k}</span></div>`).join('');
  $('p-balance').innerHTML = balanceHtml();
  $('p-card').innerHTML = S.hotelCard ? hotelCardHtml(S.hotelCard, cur) : S.mode === 'card' && S.card ? mealCardHtml(S.card) : '';
  $('p-claim').innerHTML = claimRow(S.claim);
  if (S.mode !== 'transfer') {
    // Card payments and the hotel paid directly, newest first.
    const spent = cardSpent();
    const hotelSent = sum(sent.filter((l) => l.role === 'hotel'));
    $('p-total').innerHTML = `<div class="row"><span class="ic">${icon('wallet')}</span><div class="grow"><small style="margin:0 0 2px">Total paid</small><b class="amount-big">${money(spent + hotelSent, cur)}</b></div><div class="end"><small>${pay.filter((l) => l.status === 'SCHEDULED').length} scheduled</small><small>${S.transactions.filter((t) => t.status !== 'APPROVED').length} declined</small></div></div>`;
    $('p-stats').innerHTML = [['card', 'On cards', spent], ['bed', 'To hotels', hotelSent], ['doc', 'Fees', sum(sent, (l) => l.fee || 0)]]
      .map(([ic, k, v]) => `<div class="tile">${icon(ic, 'c-cyan')}<b style="font-size:17px">${money(v, cur)}</b><span style="font-size:12.5px">${k}</span></div>`).join('');
    const rows = [
      ...S.transactions.map((t) => ({ at: t.at, html: `<div class="row ${t.status === 'APPROVED' ? '' : 'off'}">${ADA}<div class="grow"><b>${esc(t.merchant.split(',')[0])}</b><small>Card ••${esc(S.card?.last4 || '')} · ${t.status === 'APPROVED' ? 'Approved' : t.reason === 'MERCHANT_CATEGORY_NOT_ALLOWED' ? 'Declined: not meals or taxis' : esc(t.reason)}</small><small>${esc(dateHm(t.at, S.tz))}</small></div><div class="end"><b>${money(t.amount, t.currency)}</b><div style="margin-top:6px">${t.status === 'APPROVED' ? '<span class="pill ok">Paid</span>' : '<span class="pill bad">Declined</span>'}</div></div></div>` })),
      ...pay.map((l) => ({ at: l.placedAt ?? l.payAt, html: `<div class="row ${l.status === 'CANCELLED' ? 'off' : ''}"><span class="ic">${icon('building')}</span><div class="grow"><b>${esc(l.payeeName.replace(/\s+GmbH$/, ''))}</b><small>${esc(l.what)} · paid directly</small><small>${esc(l.status === 'SCHEDULED' ? `Due ${dateHm(l.payAt, S.tz)}` : l.status === 'CANCELLED' ? 'Not needed' : dateHm(l.payAt, S.tz))}</small></div><div class="end"><b>${money(l.amount, l.currency)}</b><div style="margin-top:6px">${PAY_PILL[l.status] || ''}</div></div></div>` })),
    ].sort((a, b) => b.at - a.at);
    $('p-list').innerHTML = rows.length ? rows.map((x) => x.html).join('') : '<div class="empty">No payments yet. They appear the moment a trip is disrupted.</div>';
    return;
  }
  $('p-list').innerHTML = pay.length ? pay.slice().reverse().map((l) => {
    const when = l.status === 'SCHEDULED' ? `Due ${dateHm(l.payAt, S.tz)}` : l.status === 'CANCELLED' ? 'Not needed' : dateHm(l.payAt, S.tz);
    const lead = l.role === 'hotel' ? `<span class="ic">${icon('building')}</span>` : ADA;
    return `<div class="row ${l.status === 'CANCELLED' ? 'off' : ''}">${lead}<div class="grow"><b>${esc(l.role === 'hotel' ? l.payeeName.replace(/\s+GmbH$/, '') : traveller())}</b><small>${esc(l.what)}${l.method === 'card' ? ` · Hotel card ••${esc(l.card)}` : ''}</small><small>${esc(when)}</small></div><div class="end"><b>${money(l.amount, l.currency)}</b><div style="margin-top:6px">${PAY_PILL[l.status] || ''}</div></div></div>`;
  }).join('') : '<div class="empty">No payments yet. They appear the moment a trip is disrupted.</div>';
}

// The traveller's meals and taxis card.
function mealCardHtml(c) {
  const open = c.status === 'ACTIVE';
  return `<div class="section-head"><h2>${esc(first())}'s Detour card</h2></div><div class="card"><div class="row"><span class="ic purple">${icon('card')}</span><div class="grow"><b>Virtual card ••${esc(c.last4 || '----')}</b><small>Meals and taxis only · ${money(c.remaining, c.controls.currency)} left of ${money(c.controls.limit, c.controls.currency)}</small><small>${open ? `Closes ${esc(dateHm(c.controls.activeTo, S.tz))}` : 'Closed with the trip'} · issued on Airwallex</small></div><span class="pill ${open ? 'ok' : 'plain'}">${open ? 'Active' : 'Closed'}</span></div></div>`;
}

// The hotels-only Airwallex card the hotel nights are charged to.
function hotelCardHtml(c, cur) {
  const open = c.status === 'ACTIVE';
  return `<div class="section-head"><h2>Hotel card</h2></div><div class="card"><div class="row"><span class="ic purple">${icon('card')}</span><div class="grow"><b>Virtual card ••${esc(c.last4 || '----')}</b><small>Hotels only · up to ${money(c.limit, cur)} · ${open ? `closes ${esc(dateHm(c.activeTo, S.tz))}` : 'closed with the trip'}</small><small>Issued on Airwallex for ${esc(traveller())}'s stay</small></div><span class="pill ${open ? 'ok' : 'plain'}">${open ? 'Active' : 'Closed'}</span></div></div>`;
}

function renderPolicy() {
  const r = S.policy.rules;
  $('po-company').innerHTML = `<div class="row"><img class="thumb" style="width:72px;height:56px" src="/img/app/company.jpg" alt=""><div class="grow"><b>${esc(companyName(S))}</b><small>Corporate travel policy</small></div><span class="pill ok">Active</span></div>`;
  const home = S.disruption ? S.policy.cities[S.disruption.airport] : S.policy.cities.FRA || Object.values(S.policy.cities)[0];
  const rows = [
    ['moon', 'Nights covered automatically', `${r.auto_nights} night${r.auto_nights === 1 ? '' : 's'}`],
    ['meal', `Meal allowance · ${home.city}`, `${money(home.meals_per_day, home.currency, { maximumFractionDigits: 0 })} / day`],
    ['bed', `Hotel · ${home.city}`, `${money(home.lodging_per_night * r.lodging_factor, home.currency, { maximumFractionDigits: 0 })} / night`],
    ['car', `Taxi & transport · ${home.city}`, `${money(home.transport, home.currency, { maximumFractionDigits: 0 })} / stay`],
    ['clock', 'Cover ends', `${r.rebook_buffer_hours}h after the next flight`],
    ['warn', 'Counts as disrupted', `${r.delay_threshold_hours}h+ late or cancelled`],
  ];
  $('po-rules').innerHTML = rows.map(([ic, k, v]) => `<div class="row" style="min-height:52px"><span class="ic plain">${icon(ic)}</span><div class="grow"><span style="color:#d5e0ea">${esc(k)}</span></div><b style="font-weight:600">${esc(v)}</b></div>`).join('');
  $('po-cities').innerHTML = Object.entries(S.policy.cities).map(([code, c]) => `<div class="row"><span class="ic plain">${icon('pin')}</span><div class="grow"><b>${esc(c.city)}</b><small>${esc(code)}${c.hotel ? ` · ${esc(c.hotel.replace(/\s+GmbH$/, ''))}` : ''}</small></div><div class="end"><b>${money(c.meals_per_day, c.currency, { maximumFractionDigits: 0 })}</b><small>meals · hotel ${money(c.lodging_per_night * r.lodging_factor, c.currency, { maximumFractionDigits: 0 })}</small></div></div>`).join('');
  $('po-approval').innerHTML = `<span class="badge">${icon('check')}</span><div class="grow"><b>Approval requirements</b><small>Night ${r.auto_nights + 1} onwards, or anything more than ${r.max_auto_raise_pct}% above the plan, waits for your approval.</small></div>`;
}

const SRC = { story: 'Story', feed: 'Flight feed', inbox: 'Inbox', rules: 'Rules', money: 'Payment', card: 'Card', agent: 'Agent', manager: 'Manager', merchant: 'Merchant', error: 'Error' };
function renderLog() {
  const list = S.approvals.filter((a) => logFilter === 'all' || a.status === logFilter).slice().reverse();
  $('l-list').innerHTML = list.length ? list.map((a) => {
    const pill = { PENDING: '<span class="pill warn">Pending</span>', APPROVED: '<span class="pill ok">Approved</span>', DECLINED: '<span class="pill bad">Declined</span>' }[a.status];
    return `<div class="card"><button class="row tap" data-approval="${a.id}">${ADA}<div class="grow"><b>${esc(traveller())}</b><small>${esc(approvalTitle(a))}</small></div><div class="end"><b class="c-green">+${money(a.delta, a.to.currency)}</b><div style="margin:5px 0 3px">${pill}</div><small>${esc(dateHm(a.decidedAt || a.at, S.tz))}</small>${a.status !== 'PENDING' ? `<small>by ${esc(mgr())}</small>` : ''}</div></button></div>`;
  }).join('') : '<div class="card"><div class="empty">No decisions here yet.</div></div>';
  $('l-activity').innerHTML = S.log.length ? S.log.slice().reverse().slice(0, 60).map((l) => `<div class="log-item"><div><span class="src ${esc(l.source)}">${SRC[l.source] || esc(l.source)}</span><time>${esc(dayHm(l.at, S.tz))}</time></div><p>${esc(l.text)}</p></div>`).join('') : '<div class="empty">Nothing yet.</div>';
}
$('l-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  logFilter = b.dataset.f;
  $('l-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  if (S) renderLog();
});

connect((s) => {
  const firstLoad = !S;
  render(s);
  if (firstLoad) {
    start();
    const tab = params.get('tab');
    if (tab === 'approval' && s.approvals.length) openApproval = s.approvals.at(-1).id;
    if (tab === 'trip') openTrip = 'live';
    const onboarding = ['signin', 'signup1', 'signup2'].includes(tab);
    if (tab && document.querySelector(`.view[data-view="${tab}"]`) && (currentView !== 'start' || onboarding)) { render(s); go(tab, { replace: true }); }
  }
});
