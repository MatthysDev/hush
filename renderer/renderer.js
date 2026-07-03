'use strict';

const MOD_ORDER = ['ctrl', 'alt', 'cmd', 'shift'];
const MOD_SYMBOL = { ctrl: '⌃', alt: '⌥', cmd: '⌘', shift: '⇧' };

function comboLabel(combo) {
  if (!combo) return '—';
  const mods = MOD_ORDER.filter((m) => combo.mods.includes(m)).map((m) => MOD_SYMBOL[m]).join('');
  if (!combo.key) return mods || '—';
  return mods + combo.key.toUpperCase();
}

let cfg = null;
let armedField = null;

const $ = (id) => document.getElementById(id);
const els = {
  name: $('brand-name'),
  tagline: $('brand-tagline'),
  capShortcut: $('cap-shortcut'),
  modeSeg: $('mode-seg'),
  delay: $('delay'),
  delayVal: $('delay-val'),
  err: $('err'),
  save: $('save'),
  quit: $('quit'),
  accState: $('acc-state'),
  inputState: $('input-state'),
  openAcc: $('open-acc'),
  openInput: $('open-input'),
  statusDot: $('status-dot'),
  statusLabel: $('status-label'),
  rpcId: $('rpc-id'),
  rpcSecret: $('rpc-secret'),
  rpcState: $('rpc-state'),
  rpcError: $('rpc-error'),
  rpcReconnect: $('rpc-reconnect'),
  openTuto: $('open-tuto'),
  replayTuto: $('replay-tuto'),
  roleSeg: $('role-seg'),
  controllerPanel: $('controller-panel'),
  discoverBtn: $('discover-btn'),
  hostList: $('host-list'),
  remoteHost: $('remote-host'),
  remotePort: $('remote-port'),
  remoteCode: $('remote-code'),
  remoteConnect: $('remote-connect'),
  remoteStatus: $('remote-status'),
  hostToggle: $('host-toggle'),
  hostPanel: $('host-panel'),
  hostAddrs: $('host-addrs'),
  hostPort: $('host-port'),
  hostCode: $('host-code'),
  regenCodeBtn: $('regen-code-btn'),
};

const CAP = { shortcut: els.capShortcut };

function render() {
  els.capShortcut.textContent = comboLabel(cfg.shortcut);
  for (const b of els.modeSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === cfg.mode);
  }
  els.delay.value = String(cfg.unmuteDelayMs);
  els.delayVal.textContent = String(cfg.unmuteDelayMs);
  if (document.activeElement !== els.rpcId) els.rpcId.value = cfg.discordRpc.clientId || '';
  if (document.activeElement !== els.rpcSecret) els.rpcSecret.value = cfg.discordRpc.clientSecret || '';
  renderRole();
}

// Reflect cfg.role / cfg.remote / cfg.hostListen into the "Où est Discord ?" card.
// 'host' takes priority in the UI: it's an add-on on top of "this machine", mutually
// exclusive with being a controller of a remote machine.
function renderRole() {
  const hosting = cfg.role === 'host';
  const controllerSelected = cfg.role === 'controller';
  for (const b of els.roleSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.role === (controllerSelected ? 'controller' : 'local'));
  }
  els.controllerPanel.hidden = !controllerSelected;
  els.hostToggle.checked = hosting;
  els.hostPanel.hidden = !hosting;
  if (document.activeElement !== els.remoteHost) els.remoteHost.value = cfg.remote.host || '';
  if (document.activeElement !== els.remotePort) els.remotePort.value = String(cfg.remote.port || 8698);
  if (document.activeElement !== els.remoteCode) els.remoteCode.value = cfg.remote.pairingCode || '';
  if (document.activeElement !== els.hostPort) els.hostPort.value = String(cfg.hostListen.port || 8698);
  els.hostCode.value = cfg.hostListen.pairingCode || '';
}

async function refreshHostAddrs() {
  const info = await window.hush.lanInfo();
  els.hostAddrs.textContent = info.addresses.length ? info.addresses.join(', ') : 'aucune IP LAN';
}

// Pull the RPC credentials out of whichever inputs are on screen into cfg.
function syncRpcInputs() {
  cfg.discordRpc = {
    clientId: els.rpcId.value.trim(),
    clientSecret: els.rpcSecret.value.trim(),
  };
}

async function startCapture(field) {
  if (armedField) return; // one at a time
  armedField = field;
  els.err.textContent = '';
  CAP[field].classList.add('armed');
  CAP[field].textContent = 'Appuie…';

  const res = await window.hush.captureCombo();

  if (res.combo) {
    cfg[field] = res.combo;
  } else if (res.reason === 'unsupported') {
    els.err.textContent = 'Touche non gérée — utilise une lettre, un chiffre ou F1–F24 (avec ⌃⌥⌘⇧ en option).';
  } else if (res.reason === 'timeout') {
    els.err.textContent = 'Rien capté. Active « Surveillance de la saisie » pour Hush, puis relance l\'app.';
  }
  CAP[field].classList.remove('armed');
  armedField = null;
  render();
}

for (const [field, btn] of Object.entries(CAP)) {
  btn.addEventListener('click', () => startCapture(field));
}

els.modeSeg.addEventListener('click', (e) => {
  const m = e.target.dataset.mode;
  if (!m) return;
  cfg.mode = m;
  render();
});

els.delay.addEventListener('input', () => {
  cfg.unmuteDelayMs = Number(els.delay.value);
  els.delayVal.textContent = els.delay.value;
});

// ---- Où est Discord ? (cross-machine role) ----
els.roleSeg.addEventListener('click', (e) => {
  const r = e.target.dataset.role;
  if (!r) return;
  if (els.hostToggle.checked) { els.hostToggle.checked = false; els.hostPanel.hidden = true; }
  for (const b of els.roleSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.role === r);
  els.controllerPanel.hidden = r !== 'controller';
  cfg.role = r;
});

els.hostToggle.addEventListener('change', async () => {
  const checked = els.hostToggle.checked;
  els.hostPanel.hidden = !checked;
  if (!checked) {
    // Fall back to whichever of local/controller the segment is showing.
    const active = els.roleSeg.querySelector('button.active');
    cfg.role = active?.dataset.role === 'controller' ? 'controller' : 'local';
    await persist();
    return;
  }
  // Hosting is exclusive with being a controller of a remote machine.
  for (const b of els.roleSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.role === 'local');
  els.controllerPanel.hidden = true;
  cfg.role = 'host';
  await refreshHostAddrs();
  if (!cfg.hostListen.pairingCode) cfg.hostListen.pairingCode = await window.hush.genCode();
  els.hostCode.value = cfg.hostListen.pairingCode;
  els.hostPort.value = String(cfg.hostListen.port || 8698);
  await persist();
});

els.regenCodeBtn.addEventListener('click', async () => {
  cfg.hostListen.pairingCode = await window.hush.genCode();
  els.hostCode.value = cfg.hostListen.pairingCode;
  await persist();
});

els.discoverBtn.addEventListener('click', async () => {
  els.hostList.innerHTML = '<li>Recherche…</li>';
  const hosts = await window.hush.discoverHosts();
  els.hostList.innerHTML = '';
  if (!hosts.length) {
    els.hostList.innerHTML = "<li>Aucun hôte trouvé — saisis l'IP.</li>";
    return;
  }
  for (const h of hosts) {
    const li = document.createElement('li');
    li.textContent = `${h.name} — ${h.host}:${h.port}`;
    li.addEventListener('click', () => {
      els.remoteHost.value = h.host;
      els.remotePort.value = String(h.port);
    });
    els.hostList.appendChild(li);
  }
});

els.remoteConnect.addEventListener('click', async () => {
  cfg.role = 'controller';
  cfg.remote = {
    host: els.remoteHost.value.trim(),
    port: Number(els.remotePort.value) || 8698,
    pairingCode: els.remoteCode.value.trim(),
  };
  els.remoteStatus.textContent = 'Connexion…';
  els.remoteStatus.className = 'pill pill-warn';
  if (!(await persist())) {
    els.remoteStatus.textContent = 'Non connecté';
    els.remoteStatus.className = 'pill pill-off';
  }
});

async function persist() {
  syncRpcInputs();
  els.err.textContent = '';
  const res = await window.hush.saveConfig(cfg);
  if (!res.ok) {
    els.err.textContent = res.error.includes('shortcut must have')
      ? 'Choisis un vrai raccourci (au moins une touche ou un modificateur).'
      : res.error;
    return false;
  }
  cfg = res.config;
  return true;
}

els.save.addEventListener('click', async () => {
  if (await persist()) {
    els.save.textContent = '✓ Enregistré';
    setTimeout(() => (els.save.textContent = 'Enregistrer'), 1200);
  }
});

// Connect / reconnect the Discord RPC. saveConfig auto-reconnects when the
// credentials changed; for an unchanged reconnect (e.g. after launching Discord)
// we force it explicitly.
async function connectRpc(idInput, secretInput) {
  const id = (idInput || els.rpcId).value.trim();
  const secret = (secretInput || els.rpcSecret).value.trim();
  const changed = id !== cfg.discordRpc.clientId || secret !== cfg.discordRpc.clientSecret;
  els.rpcId.value = id; els.rpcSecret.value = secret;
  if (!(await persist())) return;
  if (!changed) await window.hush.reconnectRpc();
}

els.rpcReconnect.addEventListener('click', () => connectRpc());

els.quit.addEventListener('click', () => window.hush.quit());
els.openAcc.addEventListener('click', () => window.hush.openAccessibility());
els.openInput.addEventListener('click', () => window.hush.openInputMonitoring());

// ---- Status + permissions ----
function setStatus(s) {
  if (!s.engineReady) {
    els.statusDot.className = 'dot warn';
    els.statusLabel.textContent = 'Permissions requises';
  } else if (s.active) {
    els.statusDot.className = 'dot active';
    els.statusLabel.textContent = 'Micro coupé';
  } else {
    els.statusDot.className = 'dot idle';
    els.statusLabel.textContent = 'Prêt';
  }
  setRpcPill(els.rpcState, s.rpc);
  const ob = $('ob-rpc-state');
  if (ob) setRpcPill(ob, s.rpc);
  // Surface the real reason a connection failed (esp. useful on Windows) instead
  // of a silent "Non connecté".
  if (els.rpcError) {
    if (s.rpc !== 'connected' && s.rpcError) {
      els.rpcError.textContent = `Discord : ${s.rpcError}`;
      els.rpcError.hidden = false;
    } else {
      els.rpcError.hidden = true;
    }
  }
  // Live remote-connection status (controller role) from the main process.
  if (s.role === 'controller') {
    const r = s.remote || {};
    if (r.state === 'connected') { els.remoteStatus.textContent = 'Connecté ✓'; els.remoteStatus.className = 'pill pill-ok'; }
    else if (r.state === 'connecting') { els.remoteStatus.textContent = 'Connexion…'; els.remoteStatus.className = 'pill pill-warn'; }
    else if (r.error) { els.remoteStatus.textContent = `Échec : ${r.error}`; els.remoteStatus.className = 'pill pill-warn'; }
    else { els.remoteStatus.textContent = 'Hôte injoignable'; els.remoteStatus.className = 'pill pill-off'; }
  }
}

function setRpcPill(el, state) {
  if (!el) return;
  if (state === 'connected') { el.textContent = 'Connecté ✓'; el.className = 'pill pill-ok'; }
  else if (state === 'connecting') { el.textContent = 'Connexion…'; el.className = 'pill pill-warn'; }
  else { el.textContent = 'Non connecté'; el.className = 'pill pill-off'; }
}

window.hush.onStatus(setStatus);

function setPill(el, ok, label) {
  el.textContent = `${label} : ${ok ? 'OK' : 'à activer'}`;
  el.className = ok ? 'pill pill-ok' : 'pill pill-warn';
}

async function refreshPermissions() {
  const p = await window.hush.getPermissions();
  setPill(els.accState, p.accessibility, 'Accessibilité');
  setPill(els.inputState, p.inputMonitoring, 'Surveillance de la saisie');
  const a = $('ob-acc'); if (a) setPill(a, p.accessibility, 'Accessibilité');
  const i = $('ob-input'); if (i) setPill(i, p.inputMonitoring, 'Surveillance de la saisie');
}

// ---- Onboarding tutorial ----
const STEPS = [
  {
    glyph: '🤫',
    title: 'Bienvenue dans Hush',
    body: `<p>Tu dictes déjà avec Wispr Flow en tenant un raccourci. Hush <strong>coupe ton micro Discord</strong> pendant que tu le tiens — tu relâches, ton micro revient. Personne ne t'entend dicter.</p>
      <p>3 minutes de réglage : les permissions macOS, la connexion à Discord, et ton raccourci. C'est parti.</p>`,
  },
  {
    glyph: '🔐',
    title: 'Permissions macOS',
    body: `<p>Hush a besoin de deux autorisations pour repérer quand tu tiens ton raccourci.</p>
      <div class="perm-row"><span id="ob-acc" class="pill pill-warn">Accessibilité : à activer</span><button class="ghost" id="ob-open-acc">Ouvrir</button></div>
      <div class="perm-row"><span id="ob-input" class="pill pill-warn">Surveillance de la saisie : à activer</span><button class="ghost" id="ob-open-input">Ouvrir</button></div>
      <p style="margin-top:12px">Active <strong>Hush</strong> dans chaque volet. Si rien n'apparaît, l'entrée se crée dès le premier déclenchement.</p>`,
    wire(root) {
      root.querySelector('#ob-open-acc').onclick = () => window.hush.openAccessibility();
      root.querySelector('#ob-open-input').onclick = () => window.hush.openInputMonitoring();
      refreshPermissions();
    },
  },
  {
    glyph: '🎙️',
    title: 'Connecter Discord',
    body: `<p>Hush coupe Discord via son socket local — il te faut une petite app Discord (gratuit, 2 min) :</p>
      <ol>
        <li>Va sur <a class="link" id="ob-portal" href="#">discord.com/developers</a> → <strong>New Application</strong>.</li>
        <li>Menu <strong>OAuth2</strong> → copie le <strong>Client ID</strong> et un <strong>Client Secret</strong> (Reset Secret).</li>
        <li>Section <strong>Redirects</strong> → ajoute <code>http://localhost</code> puis <strong>Save</strong>.</li>
      </ol>
      <div class="callout">⚠️ Le <strong>redirect</strong> <code>http://localhost</code> est obligatoire — sans lui, la connexion échoue (« Missing redirect_uri »).</div>
      <div class="field"><label for="ob-rpc-id">Client ID</label><input id="ob-rpc-id" type="text" spellcheck="false" placeholder="123456789012345678" /></div>
      <div class="field"><label for="ob-rpc-secret">Client Secret</label><input id="ob-rpc-secret" type="password" spellcheck="false" placeholder="••••••••••••" /></div>
      <div class="row-actions"><button class="ghost" id="ob-connect">Connecter</button><span id="ob-rpc-state" class="pill pill-off">Non connecté</span></div>
      <p style="margin-top:10px">Discord doit être <strong>ouvert</strong>. Une popup d'autorisation apparaîtra → <strong>Authorize</strong>.</p>`,
    wire(root) {
      const id = root.querySelector('#ob-rpc-id');
      const secret = root.querySelector('#ob-rpc-secret');
      id.value = cfg.discordRpc.clientId || '';
      secret.value = cfg.discordRpc.clientSecret || '';
      root.querySelector('#ob-portal').onclick = (e) => { e.preventDefault(); window.hush.openExternal('https://discord.com/developers/applications'); };
      root.querySelector('#ob-connect').onclick = () => connectRpc(id, secret);
    },
  },
  {
    glyph: '⌨️',
    title: 'Ton raccourci',
    body: `<p>Un seul réglage : ton <strong>push-to-talk</strong>. Mets <strong>exactement</strong> le même raccourci que dans Wispr Flow (Réglages → General → Shortcuts).</p>
      <p>Hush ne simule rien : tu presses ce raccourci toi-même, Wispr dicte comme d'habitude, et Hush coupe Discord tant que tu le tiens.</p>
      <p>Tu le règles dans la fenêtre principale, juste derrière — clique sur le bouton de raccourci et presse ta touche.</p>`,
  },
  {
    glyph: '✅',
    title: 'Tout est prêt',
    body: `<p>Hush vit dans la <strong>barre de menus</strong> (en haut à droite). Tiens ton raccourci : Discord se coupe et Wispr dicte. Relâche : ton micro revient.</p>
      <p>Tu peux rouvrir ce tuto à tout moment via « Revoir le tuto ».</p>`,
  },
];

let obIndex = 0;
const ob = {
  overlay: $('onboarding'),
  steps: $('ob-steps'),
  body: $('ob-body'),
  back: $('ob-back'),
  next: $('ob-next'),
  skip: $('ob-skip'),
};

function renderStep() {
  const s = STEPS[obIndex];
  ob.steps.innerHTML = STEPS.map((_, i) => `<i class="${i <= obIndex ? 'done' : ''}"></i>`).join('');
  ob.body.innerHTML = `<span class="glyph">${s.glyph}</span><h3>${s.title}</h3>${s.body}`;
  if (typeof s.wire === 'function') s.wire(ob.body);
  ob.back.classList.toggle('hidden', obIndex === 0);
  ob.next.textContent = obIndex === STEPS.length - 1 ? 'Terminer' : 'Suivant';
}

function openOnboarding(index = 0) {
  obIndex = index;
  ob.overlay.hidden = false;
  renderStep();
}
function closeOnboarding() {
  ob.overlay.hidden = true;
  try { localStorage.setItem('hush.onboarded', '1'); } catch { /* noop */ }
}

ob.next.addEventListener('click', () => {
  if (obIndex >= STEPS.length - 1) return closeOnboarding();
  obIndex++; renderStep();
});
ob.back.addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderStep(); } });
ob.skip.addEventListener('click', closeOnboarding);
els.openTuto.addEventListener('click', (e) => { e.preventDefault(); openOnboarding(2); });
els.replayTuto.addEventListener('click', (e) => { e.preventDefault(); openOnboarding(0); });

// ---- Init ----
async function init() {
  const brand = await window.hush.getBrand();
  els.name.textContent = brand.name;
  els.tagline.textContent = brand.tagline;
  document.title = brand.name;
  cfg = await window.hush.getConfig();
  render();
  if (cfg.role === 'host') refreshHostAddrs();
  refreshPermissions();
  setInterval(refreshPermissions, 2000);

  let onboarded = false;
  try { onboarded = localStorage.getItem('hush.onboarded') === '1'; } catch { /* noop */ }
  if (!onboarded) openOnboarding(0);
}

init();
