/* global window, document */
const api = window.hush.test;
const logEl = document.getElementById('log');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(res) {
  // res: { ok, log } from an experiment, or a plain string.
  const text = typeof res === 'string' ? res : res.log;
  const ok = typeof res === 'string' ? null : res.ok;
  const line = document.createElement('div');
  const cls = ok === null ? '' : ok ? 'ok' : 'ko';
  line.innerHTML = `<span class="t">${stamp()}</span>  <span class="${cls}"></span>`;
  line.querySelector('span:last-child').textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function call(fn) {
  try {
    log(await fn());
  } catch (e) {
    log({ ok: false, log: `Erreur IPC: ${e && e.message ? e.message : String(e)}` });
  }
}

// --- tabs ---
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  });
});

document.getElementById('clear').addEventListener('click', () => {
  logEl.innerHTML = '';
});

// --- A: RPC ---
document.getElementById('rpc-connect').addEventListener('click', () => {
  const id = document.getElementById('rpc-id').value.trim();
  const secret = document.getElementById('rpc-secret').value.trim();
  log('RPC: connexion…');
  call(() => api.rpcConnect(id, secret));
});
document.getElementById('rpc-mute').addEventListener('click', () => call(() => api.rpcSetMute(true)));
document.getElementById('rpc-unmute').addEventListener('click', () => call(() => api.rpcSetMute(false)));
document.getElementById('rpc-disc').addEventListener('click', () => call(() => api.rpcDisconnect()));

// --- B: HID ---
api.discordCombo().then((r) => {
  document.getElementById('b-combo').textContent = r.label || '—';
});
document.getElementById('hid-tap').addEventListener('click', () => {
  log('HID: compilation/envoi (1er run = quelques secondes)…');
  call(() => api.hidTap());
});

// --- C: AX ---
document.getElementById('ax-toggle').addEventListener('click', () => {
  log('AX: recherche du bouton mute…');
  call(() => api.axToggle());
});
document.getElementById('ax-dump').addEventListener('click', () => call(() => api.axDump()));

// --- D: Audio ---
document.getElementById('audio-detect').addEventListener('click', () => call(() => api.audioDetect()));
document.getElementById('audio-mute').addEventListener('click', () => call(() => api.audioDegradedMute(true)));
document.getElementById('audio-unmute').addEventListener('click', () => call(() => api.audioDegradedMute(false)));

log('Test Bench prêt. Rejoins un call Discord, puis teste chaque onglet.');
