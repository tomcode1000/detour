// Detour traveller app: what the stranded traveller sees on their phone.
// Shared helpers come from mobile.js.
let S = null;
let screen = params.get('tab') === 'messages' ? 'messages' : 'trip';
try { localStorage.setItem('detour.role', 'traveller'); } catch {}
let seen = 0;
let lastCount = 0;

function render(s) {
  S = s;
  const tz = s.tz;
  renderHero(s, tz);
  renderFlight(s, tz);
  renderHotel(s);
  renderMoney(s, tz);
  renderInbox(s, tz);
  renderChat(s, tz);
  $('tv-fine').textContent = 'Demo: scripted flight feed and fictional test data. Payments run in the Airwallex sandbox.';
  const fromDetour = s.messages.filter((m) => m.from === 'detour').length;
  if (screen === 'messages') seen = fromDetour;
  $('tv-badge').textContent = fromDetour > seen ? fromDetour - seen : '';
  DetourDock.update(s);
}

const toTraveller = (s) => (s.payments || []).filter((l) => l.role === 'traveller');
const hotelRows = (s) => (s.payments || []).filter((l) => l.role === 'hotel');

function renderHero(s, tz) {
  const el = $('tv-hero');
  const c = s.card;
  const dest = CITY[s.legs.at(-1)?.to] || s.legs.at(-1)?.to;
  if (s.summary) {
    el.className = 'tv-hero calm';
    const sm = s.summary;
    el.innerHTML = sm.mode === 'transfer'
      ? `<div class="eyebrow">Trip complete</div><h1>Welcome to ${esc(dest)}</h1><p>Detour sent you ${money(sm.toTraveller, sm.currency)} and paid your hotel directly. Nothing to claim, no receipts.</p>`
      : `<div class="eyebrow">Trip complete</div><h1>Welcome to ${esc(dest)}</h1><p>Your Detour card is closed. You spent ${money(sm.spent, sm.currency)}. Nothing to claim, no receipts.</p>`;
    return;
  }
  if (!c) {
    el.className = 'tv-hero calm';
    el.innerHTML = `<div class="eyebrow">Trip to ${esc(dest)}</div><h1>Your trip is on track</h1><p>Detour is watching your flights. If one is cancelled or badly delayed, money for meals, taxis and a hotel reaches you automatically.</p>`;
    return;
  }
  if (c.status !== 'ACTIVE') {
    el.className = 'tv-hero calm';
    el.innerHTML = `<div class="eyebrow">On your way</div><h1>Have a good flight</h1><p>Your Detour cover has ended. Anything you didn't need was cancelled before it was paid.</p>`;
    return;
  }
  const k = c.controls;
  const hotel = k.categories.includes('lodging');
  el.className = 'tv-hero covered';
  let big = '';
  if (s.mode === 'transfer') {
    const sent = toTraveller(s).filter((l) => l.status === 'SENT');
    const rec = sent.filter((l) => l.received);
    const cur = rec[0]?.received.currency || k.currency;
    big = `<div class="big">${money(sum(rec, (l) => l.received.amount), cur)}<small>in your account</small></div>`;
  } else {
    big = `<div class="big">${money(c.remaining, k.currency)}<small>left on your card</small></div>`;
  }
  el.innerHTML = `<div class="eyebrow">Disrupted · ${esc(k.city)}</div><h1>You're covered in ${esc(k.city)}</h1>
    <p>Meals and taxis${hotel ? ', and your hotel is paid' : ''}. Until ${esc(dayHm(k.activeTo, tz))}.</p>${big}`;
}

function flightPill(f) {
  if (f.status === 'CANCELLED') return '<span class="pill bad">Cancelled</span>';
  if (f.status === 'LANDED') return '<span class="pill plain">Landed</span>';
  if (f.status === 'DEPARTED') return '<span class="pill info">In the air</span>';
  if (/late/.test(f.statusText)) return `<span class="pill warn">${esc(f.statusText.replace('running ', ''))}</span>`;
  return '<span class="pill ok">On time</span>';
}
function renderFlight(s, tz) {
  const f = s.legs.find((l) => l.status !== 'LANDED') || s.legs.at(-1);
  $('tv-flight').innerHTML = `
    <div class="tv-card-head"><h2>${f.status === 'LANDED' ? 'Last flight' : 'Next flight'}</h2><span>${esc(f.id)}</span></div>
    <div class="tv-flight"><div class="ap">${esc(f.from)}<span>${esc(CITY[f.from] || f.from)}</span></div><div class="mid">→</div><div class="ap to">${esc(f.to)}<span>${esc(CITY[f.to] || f.to)}</span></div></div>
    <div class="tv-flight-foot"><span>Departs ${esc(dayHm(f.est_dep, tz))} local</span>${flightPill(f)}</div>`;
}

function renderHotel(s) {
  const rows = hotelRows(s).filter((l) => l.status !== 'CANCELLED');
  const card = $('tv-hotel');
  if (s.mode !== 'transfer' || !rows.length || s.summary) { card.hidden = true; return; }
  card.hidden = false;
  const name = rows[0].payeeName.replace(/\s+GmbH$/, '');
  card.innerHTML = `<div class="tv-card-head"><h2>Hotel</h2><span>${rows.length} night${rows.length === 1 ? '' : 's'}</span></div>
    <div class="tv-hotel"><b>${esc(name)}</b><p>Paid directly by ${esc(company(S))}. Just give your name at the desk; there is nothing to pay and nothing to claim.</p>
    <span class="pill ok tag">Room paid</span></div>`;
}

function renderMoney(s, tz) {
  const el = $('tv-money');
  if (s.mode !== 'transfer') {
    const c = s.card;
    el.innerHTML = c
      ? `<div class="tv-card-head"><h2>Your Detour card</h2><span>•••• ${esc(c.last4 || '')}</span></div>
        <div class="tv-row"><div class="l"><b>Left to spend</b><span>${esc(c.categoryLabels.join(', '))}</span></div><div class="r"><b>${money(c.remaining, c.controls.currency)}</b><span>of ${money(c.controls.limit, c.controls.currency)}</span></div></div>`
      : '<div class="tv-card-head"><h2>Money</h2><span>Nothing needed yet</span></div><div class="tv-row"><div class="l"><span>A card appears here the moment your trip is disrupted.</span></div></div>';
    return;
  }
  const rows = toTraveller(s);
  if (!rows.length) {
    el.innerHTML = '<div class="tv-card-head"><h2>Money sent to you</h2><span>Nothing needed yet</span></div><div class="tv-row"><div class="l"><span>If your trip is disrupted, Detour sends money straight to your bank account.</span></div></div>';
    return;
  }
  el.innerHTML = `<div class="tv-card-head"><h2>Money sent to you</h2><span>to your bank account</span></div>` + rows.slice().reverse().map((l) => {
    const off = l.status === 'CANCELLED';
    const when = l.status === 'SENT' ? `Sent ${dayHm(l.payAt, tz)}` : l.status === 'SCHEDULED' ? `Arrives ${dayHm(l.payAt, tz)}` : 'Not needed';
    const rec = l.received && l.received.currency !== l.currency ? money(l.received.amount, l.received.currency) : money(l.amount, l.currency);
    return `<div class="tv-row ${off ? 'off' : ''}"><div class="l"><b>${esc(l.what)}</b><span>${esc(when)}</span></div><div class="r"><b>${esc(rec)}</b><span>${money(l.amount, l.currency)}</span></div></div>`;
  }).join('');
}

function renderChat(s, tz) {
  const chat = $('tv-chat');
  const writing = s.activity && /^(Messaging|Replying|Reading .*message)/.test(s.activity);
  if (!s.messages.length && !writing) {
    chat.innerHTML = '<div class="chat-empty">Messages from Detour appear here. You can also ask for help, for example if the hotel asks for a deposit.</div>';
  } else {
    let lastDay = '';
    chat.innerHTML = s.messages.map((m) => {
      const day = fmt(m.at, tz, { weekday: 'long', day: 'numeric', month: 'long' });
      const sep = day !== lastDay ? `<div class="tv-day">${esc(day)}</div>` : '';
      lastDay = day;
      if (m.kind === 'share') {
        const how = { screenshot: 'Shared a screenshot', forwarded: 'Forwarded an airline email', shared: 'Shared an airline message' }[m.how] || 'Shared an airline message';
        return `${sep}<div class="msg traveller share"><span class="att"><svg viewBox="0 0 24 24"><path d="M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.7a1.7 1.7 0 0 1-2.4-2.4L15 7.6"/></svg>${how}</span><q>${esc(m.text)}</q><time>${hm(m.at, tz)}</time></div>`;
      }
      return `${sep}<div class="msg ${m.from}">${esc(m.text)}<time>${hm(m.at, tz)}</time></div>`;
    }).join('') + (writing ? '<div class="typing" aria-label="Detour is writing"><span></span><span></span><span></span></div>' : '');
  }
  const count = s.messages.length + (writing ? 1 : 0);
  if (count !== lastCount) chat.scrollTop = chat.scrollHeight;
  lastCount = count;
  const lock = s.busy || s.playing;
  $('tv-text').disabled = lock;
  $('tv-form').querySelector('button').disabled = lock;
  $('tv-text').placeholder = lock ? 'Detour is working…' : 'Message Detour';
}


$('tv-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('tv-text').value.trim();
  if (!text || S?.busy || S?.playing) return;
  $('tv-text').value = '';
  await api('/api/chat', { text });
};

// ---------------------------------------------------------------- airline messages
function renderInbox(s, tz) {
  const items = (s.inbox || []).slice().reverse();
  const lock = s.busy || s.playing;
  $('tv-inbox').innerHTML = `<div class="tv-card-head"><h2>Airline messages</h2><span>${items.length ? 'only what you share is read' : ''}</span></div>`
    + (items.length ? items.map((m) => `
      <div class="tv-inbox-item"><div class="l"><b>${esc(m.subject)}</b><span>${esc(m.from.replace(/\s*<.*>/, ''))} · ${esc(dayHm(m.at, tz))}</span></div>
        ${m.shared ? ({ suspicious: '<span class="pill bad">Suspicious</span>', confirmed: '<span class="pill ok">Confirmed</span>', unconfirmed: '<span class="pill plain">Not confirmed</span>' }[m.verdict] || '<span class="pill plain">Reading…</span>') : `<button class="btn" data-share-inbox="${esc(m.id)}" ${lock ? 'disabled' : ''}>Share</button>`}</div>`).join('')
      : '<div class="tv-inbox-item"><div class="l"><span>Messages from your airline appear here. Share one with Detour if it is about a delay or cancellation.</span></div></div>')
    + `<button class="tv-share-any" id="share-any" ${lock ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>Share a message or screenshot</button>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-share-inbox]');
  if (b && !b.disabled) { b.disabled = true; api('/api/airline-message', { inboxId: b.dataset.shareInbox, how: 'forwarded' }); }
  if (e.target.closest('#share-any')) openSheet();
});

// The share sheet
let sheetHow = 'pasted';
function openSheet(text = '', how = 'pasted') {
  sheetHow = how;
  $('sheet-text').value = text;
  $('sheet-status').textContent = '';
  $('sheet').hidden = false;
  $('sheet-backdrop').hidden = false;
  setTimeout(() => $('sheet-text').focus(), 50);
}
function closeSheet() { $('sheet').hidden = true; $('sheet-backdrop').hidden = true; }
$('sheet-cancel').onclick = closeSheet;
$('sheet-backdrop').onclick = closeSheet;
$('sheet-send').onclick = async () => {
  const text = $('sheet-text').value.trim();
  if (!text) { $('sheet-status').textContent = 'Paste a message or add a screenshot first.'; return; }
  if (S?.busy || S?.playing) { $('sheet-status').textContent = 'Detour is busy, try again in a moment.'; return; }
  closeSheet();
  setupTabsShow('messages');
  await api('/api/airline-message', { text, how: sheetHow });
};

// Screenshots are read on the phone (Tesseract OCR, loaded only when needed); only text is sent.
let ocrLib = null;
async function readImage(file) {
  $('sheet-status').innerHTML = '<span class="spinner"></span>Reading the screenshot on your phone…';
  try {
    if (!ocrLib) {
      await new Promise((ok, fail) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        sc.onload = ok; sc.onerror = fail;
        document.head.appendChild(sc);
      });
      ocrLib = window.Tesseract;
    }
    const { data } = await ocrLib.recognize(file, 'eng');
    const text = data.text.replace(/[ \t]+\n/g, '\n').trim();
    if (!text) throw new Error('no text');
    $('sheet-text').value = text;
    sheetHow = 'screenshot';
    $('sheet-status').textContent = 'Check the text, then send.';
  } catch {
    $('sheet-status').textContent = "Couldn't read that image. Try pasting the text instead.";
  }
}
$('sheet-file').onchange = (e) => { const f = e.target.files?.[0]; if (f) readImage(f); e.target.value = ''; };

// Android "Share → Detour": the service worker keeps what was shared and opens /traveller?shared.
async function pickUpShared() {
  if (!params.has('shared') || !('caches' in window)) return;
  const cache = await caches.open('detour-share');
  const textRes = await cache.match('/shared/text');
  const imageRes = await cache.match('/shared/image');
  await cache.delete('/shared/text');
  await cache.delete('/shared/image');
  history.replaceState(null, '', '/traveller');
  openSheet(textRes ? await textRes.text() : '', 'shared');
  if (imageRes) readImage(await imageRes.blob());
}

const setupTabsShow = setupTabs(screen, (name) => {
  screen = name;
  if (S) render(S);
  if (name === 'messages') $('tv-chat').scrollTop = $('tv-chat').scrollHeight;
});
DetourDock.mount();
connect(render);
pickUpShared();
