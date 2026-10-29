// Demo dock: the story controls (scripted flight feed), kept apart from the product screens.
// Pages call DetourDock.mount() once and DetourDock.update(state) on every snapshot.
// Inside the /demo view the pages are embedded (?embed) and the dock is not shown there.
window.DetourDock = (() => {
  let el = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function post(path) {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!j.ok && window.DetourToast) window.DetourToast(j.error || 'Something went wrong.');
    } catch {
      if (window.DetourToast) window.DetourToast('Lost connection to the Detour server.');
    }
  }

  function mount({ inline = false } = {}) {
    if (!inline && new URLSearchParams(location.search).has('embed')) return;
    el = document.createElement('div');
    el.className = `dock${inline ? ' inline' : ''}`;
    el.innerHTML = `
      <div class="dock-label"><span class="dock-tag">Demo</span><span class="dock-step" data-k="step">Event 0</span></div>
      <div class="dock-scene"><b data-k="scene"></b><span data-k="text"></span></div>
      <div class="dock-activity" data-k="activity"></div>
      <div class="dock-buttons">
        <button data-a="reset" title="Restart the story">Reset</button>
        <button data-a="step" title="Next event (N)">Next</button>
        <button data-a="run" class="go" title="Play until a decision is needed (P)">Play</button>
      </div>`;
    (inline ? document.getElementById('dock-slot') : document.body).appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;
      post({ reset: '/api/reset', step: '/api/step', run: '/api/run' }[b.dataset.a]);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = { n: 'step', N: 'step', p: 'run', P: 'run' }[e.key];
      const b = a && el.querySelector(`button[data-a="${a}"]`);
      if (b && !b.disabled) b.click();
    });
  }

  function update(s) {
    if (!el) return;
    const q = (k) => el.querySelector(`[data-k="${k}"]`);
    q('step').textContent = `Event ${s.progress.at} of ${s.progress.total}`;
    q('scene').textContent = s.scene ? s.scene.name : 'Ready';
    q('text').textContent = s.scene ? s.scene.text : s.title;
    q('activity').innerHTML = s.activity ? `<span class="spinner"></span>${esc(s.activity)}…` : s.progress.waiting ? `Waiting for ${esc(s.manager)}` : '';
    const blocked = s.busy || s.playing || s.progress.finished || s.progress.waiting;
    el.querySelector('[data-a="step"]').disabled = blocked;
    el.querySelector('[data-a="run"]').disabled = blocked;
    el.querySelector('[data-a="reset"]').disabled = s.busy || s.playing;
    el.querySelector('[data-a="run"]').textContent = s.playing ? 'Playing…' : s.progress.waiting ? 'Needs approval' : s.progress.finished ? 'Done' : 'Play';
  }

  return { mount, update };
})();
