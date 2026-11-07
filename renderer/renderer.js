'use strict';

// macOS-only UI (TCC permissions, ⌃⌥ glyphs, the Fn key) is gated on this.
const IS_MAC = !!(window.hush && window.hush.isMac);

const MOD_ORDER = ['ctrl', 'alt', 'cmd', 'shift'];
const MOD_SYMBOL = { ctrl: '⌃', alt: '⌥', cmd: '⌘', shift: '⇧' };
// Off macOS the 'cmd' modifier is the Windows key.
const MOD_NAME = { ctrl: 'Ctrl', alt: 'Alt', cmd: 'Win', shift: 'Shift' };

// Mirrors comboLabel() in src/combo.ts: glyphs on macOS, spelled out elsewhere.
function comboLabel(combo) {
  if (!combo) return '—';
  if (combo.mods.length === 0 && String(combo.key).toUpperCase() === 'FN') return '🌐 Fn';
  const mods = MOD_ORDER.filter((m) => combo.mods.includes(m));
  if (!IS_MAC) {
    const parts = mods.map((m) => MOD_NAME[m]);
    if (combo.key) parts.push(combo.key.toUpperCase());
    return parts.join(' + ') || '—';
  }
  const glyphs = mods.map((m) => MOD_SYMBOL[m]).join('');
  if (!combo.key) return glyphs || '—';
  return glyphs + combo.key.toUpperCase();
}

// ---- Language ----
// Strings live in i18n.js (window.HUSH_I18N), one table per language. LANG is
// resolved by the main process (saved choice, else the system language).
const I18N = window.HUSH_I18N;
let LANG = 'en';

// Look up a UI string in the current language (falling back to English), and
// fill {placeholders} from vars.
function t(key, vars) {
  let str = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.split(`{${k}}`).join(String(v));
  return str;
}

// Capture hint, per platform (Fn only exists on Mac keyboards).
function captureHint() {
  return t(IS_MAC ? 'captureHintMac' : 'captureHintWin');
}

// Re-render every static string tagged with data-i18n / data-i18n-title. Tagged
// elements never contain id'd children, so replacing their HTML is safe.
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.getElementById('capture-hint').textContent = captureHint();
  for (const b of document.querySelectorAll('#lang-seg button')) {
    b.classList.toggle('active', b.dataset.lang === LANG);
  }
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
  launchAtLogin: $('launch-at-login'),
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
  updateBanner: $('update-banner'),
  updateText: $('update-text'),
  updateDownload: $('update-download'),
  appVersion: $('app-version'),
};

// Show a user-facing error. When the onboarding modal is open its own #ob-err
// slot (which sits above the overlay) carries the message and the main window's
// #err is left blank; otherwise #err carries it.
function showError(msg) {
  const obErr = $('ob-err');
  const onboardingOpen = !!obErr && ob && ob.overlay && !ob.overlay.hidden;
  els.err.textContent = onboardingOpen ? '' : msg;
  if (obErr) { obErr.textContent = msg; obErr.hidden = !msg; }
}
function clearError() { showError(''); }

function render() {
  els.capShortcut.textContent = comboLabel(cfg.shortcut);
  for (const b of els.modeSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === cfg.mode);
  }
  els.delay.value = String(cfg.unmuteDelayMs);
  els.delayVal.textContent = String(cfg.unmuteDelayMs);
  els.launchAtLogin.checked = cfg.launchAtLogin;
  if (document.activeElement !== els.rpcId) els.rpcId.value = cfg.discordRpc.clientId || '';
  if (document.activeElement !== els.rpcSecret) els.rpcSecret.value = cfg.discordRpc.clientSecret || '';
  reflectRoleControls(els);
}

// Reflect cfg.role / cfg.remote / cfg.hostListen into a set of role controls —
// the main window (els) or the onboarding step's ob-* refs. Sibling of
// wireRoleControls(refs), which wires the same set's events. 'host' takes
// priority in the UI: it's an add-on on top of "this machine", mutually
// exclusive with being a controller of a remote machine.
function reflectRoleControls(refs) {
  const hosting = cfg.role === 'host';
  const controllerSelected = cfg.role === 'controller';
  for (const b of refs.roleSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.role === (controllerSelected ? 'controller' : 'local'));
  }
  refs.controllerPanel.hidden = !controllerSelected;
  refs.hostToggle.checked = hosting;
  refs.hostPanel.hidden = !hosting;
  if (document.activeElement !== refs.remoteHost) refs.remoteHost.value = cfg.remote.host || '';
  if (document.activeElement !== refs.remotePort) refs.remotePort.value = String(cfg.remote.port || 8698);
  if (document.activeElement !== refs.remoteCode) refs.remoteCode.value = cfg.remote.pairingCode || '';
  if (document.activeElement !== refs.hostPort) refs.hostPort.value = String(cfg.hostListen.port || 8698);
  refs.hostCode.value = cfg.hostListen.pairingCode || '';
}

async function refreshHostAddrs(refs) {
  const info = await window.hush.lanInfo();
  refs.hostAddrs.textContent = info.addresses.length ? info.addresses.join(', ') : t('noLanIp');
}

// Pull the RPC credentials out of whichever inputs are on screen into cfg,
// preserving any OAuth token fields main previously handed us (config:get).
function syncRpcInputs() {
  cfg.discordRpc = {
    ...cfg.discordRpc,
    clientId: els.rpcId.value.trim(),
    clientSecret: els.rpcSecret.value.trim(),
  };
}

// Arm a capture button, record the pressed combo into cfg[field], persist it,
// and refresh every button that shows this shortcut (window + onboarding).
async function captureInto(field, btnEl) {
  if (armedField) return; // one at a time
  armedField = field;
  clearError();
  btnEl.classList.add('armed');
  btnEl.textContent = t('pressShortcut');

  const res = await window.hush.captureCombo();

  if (res.combo) {
    cfg[field] = res.combo;
    await persist();
  } else if (res.reason === 'unsupported') {
    showError(t(IS_MAC ? 'unsupportedMac' : 'unsupportedWin'));
  } else if (res.reason === 'timeout') {
    showError(t(IS_MAC ? 'timeoutMac' : 'timeoutWin'));
  }

  btnEl.classList.remove('armed');
  armedField = null;
  render();
  // Keep the onboarding button (if the tutorial is on the shortcut step) in sync.
  const obBtn = document.getElementById('ob-cap-shortcut');
  if (obBtn) obBtn.textContent = comboLabel(cfg.shortcut);
}

els.capShortcut.addEventListener('click', () => captureInto('shortcut', els.capShortcut));

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

// Launch-at-login toggles the OS login item; persist immediately so it takes
// effect without needing the Save button.
els.launchAtLogin.addEventListener('change', async () => {
  cfg.launchAtLogin = els.launchAtLogin.checked;
  await persist();
});

// ---- Where is Discord? (cross-machine role) ----
// Wire a full set of role controls (segment, host toggle, discover, remote/host
// fields, connect, regen) onto the shared persist()/discover/genCode handlers.
// Live `input` listeners keep cfg.remote / cfg.hostListen current, so persist()
// no longer needs to read these fields out of the DOM — which is what lets the
// onboarding step reuse this with ob-* elements without clobbering cfg.
function wireRoleControls(refs) {
  // Keep cfg in sync as the user types (works for window AND onboarding fields).
  const syncRemote = () => {
    cfg.remote = {
      host: refs.remoteHost.value.trim(),
      port: Number(refs.remotePort.value) || 8698,
      pairingCode: refs.remoteCode.value.trim(),
    };
  };
  const syncHost = () => {
    cfg.hostListen = {
      port: Number(refs.hostPort.value) || 8698,
      pairingCode: refs.hostCode.value.trim(),
    };
  };
  refs.remoteHost.addEventListener('input', syncRemote);
  refs.remotePort.addEventListener('input', syncRemote);
  refs.remoteCode.addEventListener('input', syncRemote);
  refs.hostPort.addEventListener('input', syncHost);

  // Segment: This computer / Another computer. Persist immediately so the switch
  // takes effect without a Save; controller persists only when a remote config
  // is already known (otherwise just reveal the panel and wait for Connect).
  refs.roleSeg.addEventListener('click', async (e) => {
    const r = e.target.dataset.role;
    if (!r) return;
    if (refs.hostToggle.checked) { refs.hostToggle.checked = false; refs.hostPanel.hidden = true; }
    for (const b of refs.roleSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.role === r);
    refs.controllerPanel.hidden = r !== 'controller';
    cfg.role = r;
    if (r === 'local' || (cfg.remote.host && cfg.remote.pairingCode)) await persist();
  });

  refs.hostToggle.addEventListener('change', async () => {
    const checked = refs.hostToggle.checked;
    refs.hostPanel.hidden = !checked;
    if (!checked) {
      const active = refs.roleSeg.querySelector('button.active');
      cfg.role = active?.dataset.role === 'controller' ? 'controller' : 'local';
      await persist();
      return;
    }
    for (const b of refs.roleSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.role === 'local');
    refs.controllerPanel.hidden = true;
    cfg.role = 'host';
    await refreshHostAddrs(refs);
    if (!cfg.hostListen.pairingCode) cfg.hostListen.pairingCode = await window.hush.genCode();
    refs.hostCode.value = cfg.hostListen.pairingCode;
    refs.hostPort.value = String(cfg.hostListen.port || 8698);
    syncHost();
    await persist();
  });

  refs.regenCodeBtn.addEventListener('click', async () => {
    cfg.hostListen.pairingCode = await window.hush.genCode();
    refs.hostCode.value = cfg.hostListen.pairingCode;
    syncHost();
    await persist();
  });

  refs.discoverBtn.addEventListener('click', async () => {
    refs.hostList.innerHTML = `<li>${t('searching')}</li>`;
    const hosts = await window.hush.discoverHosts();
    refs.hostList.innerHTML = '';
    if (!hosts.length) {
      refs.hostList.innerHTML = `<li>${t('noHost')}</li>`;
      return;
    }
    for (const h of hosts) {
      const li = document.createElement('li');
      li.textContent = `${h.name} — ${h.host}:${h.port}`;
      li.addEventListener('click', () => {
        refs.remoteHost.value = h.host;
        refs.remotePort.value = String(h.port);
        syncRemote();
      });
      refs.hostList.appendChild(li);
    }
  });

  refs.remoteConnect.addEventListener('click', async () => {
    cfg.role = 'controller';
    syncRemote();
    refs.remoteStatus.textContent = t('connecting');
    refs.remoteStatus.className = 'pill pill-warn';
    if (!(await persist())) {
      refs.remoteStatus.textContent = t('notConnected');
      refs.remoteStatus.className = 'pill pill-off';
    }
  });
}

async function persist() {
  syncRpcInputs();
  clearError();
  const res = await window.hush.saveConfig(cfg);
  if (!res.ok) {
    showError(translateConfigError(res.error));
    return false;
  }
  cfg = res.config;
  return true;
}

// Map validateConfig's technical error strings to a friendlier message for the UI.
function translateConfigError(error) {
  if (error.includes('shortcut must have')) {
    return t('errShortcut');
  } else if (error.includes('host address')) {
    return t('errHost');
  } else if (error.includes('pairing code')) {
    return t('errCode');
  } else if (error.includes('port')) {
    return t('errPort');
  }
  return error;
}

els.save.addEventListener('click', async () => {
  if (await persist()) {
    els.save.textContent = t('saved');
    setTimeout(() => (els.save.textContent = t('save')), 1200);
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
// Last status pushed by main — re-applied when an onboarding step renders, so
// a step opened after the push still shows the current Discord state/error.
let lastStatus = null;

function setStatus(s) {
  lastStatus = s;
  if (!s.engineReady) {
    els.statusDot.className = 'dot warn';
    els.statusLabel.textContent = t(IS_MAC ? 'statusPerms' : 'statusListenerFailed');
  } else if (s.active) {
    els.statusDot.className = 'dot active';
    els.statusLabel.textContent = t('statusMuted');
  } else {
    els.statusDot.className = 'dot idle';
    els.statusLabel.textContent = t('statusReady');
  }
  setRpcPill(els.rpcState, s.rpc);
  const ob = $('ob-rpc-state');
  if (ob) setRpcPill(ob, s.rpc);
  // Surface the real reason a connection failed (esp. useful on Windows) instead
  // of a silent "Not connected" — in the window and in the onboarding step.
  const rpcMsg = s.rpc !== 'connected' && s.rpcError ? explainRpcError(s.rpcError) : '';
  for (const el of [els.rpcError, $('ob-rpc-error')]) {
    if (!el) continue;
    el.textContent = rpcMsg;
    el.hidden = !rpcMsg;
  }
  // Live remote-connection status (controller role) from the main process.
  if (s.role === 'controller') {
    const r = s.remote || {};
    const help = $('remote-help');
    const obStatus = $('ob-remote-status');
    const setRemote = (text, cls) => {
      els.remoteStatus.textContent = text; els.remoteStatus.className = cls;
      if (obStatus) { obStatus.textContent = text; obStatus.className = cls; }
    };
    if (r.state === 'connected') {
      setRemote(t('connected'), 'pill pill-ok');
      if (help) help.hidden = true;
    } else if (r.state === 'connecting') {
      setRemote(t('connecting'), 'pill pill-warn');
      if (help) help.hidden = true;
    } else {
      setRemote(r.error ? t('remoteFailed', { error: r.error }) : t('lookingForHost'), 'pill pill-warn');
      if (help) {
        help.textContent = t('remoteHelp', { port: cfg.remote?.port || 8698 });
        help.hidden = false;
      }
    }
  }
  // Update-available banner (from the main-process release check).
  if (s.update && s.update.version && s.update.url) {
    els.updateText.textContent = t('updateAvailable', { version: s.update.version });
    els.updateDownload.onclick = () => window.hush.openExternal(s.update.url);
    els.updateBanner.hidden = false;
  } else {
    els.updateBanner.hidden = true;
  }
}

// Turn Discord's raw RPC/OAuth errors into what the user should actually do.
function explainRpcError(raw) {
  if (/missing Client ID/i.test(raw)) return t('rpcErrMissing');
  if (/redirect_uri/i.test(raw)) return t('rpcErrRedirect');
  if (/invalid_client|client_secret|401/i.test(raw)) return t('rpcErrCreds');
  if (/ENOENT|connection closed|could not connect|timed? ?out/i.test(raw)) {
    return t('rpcErrUnreachable', { error: raw });
  }
  return t('rpcErrOther', { error: raw });
}

function setRpcPill(el, state) {
  if (!el) return;
  if (state === 'connected') { el.textContent = t('connected'); el.className = 'pill pill-ok'; }
  else if (state === 'connecting') { el.textContent = t('connecting'); el.className = 'pill pill-warn'; }
  else { el.textContent = t('notConnected'); el.className = 'pill pill-off'; }
}

window.hush.onStatus(setStatus);

function setPill(el, ok, label) {
  el.textContent = t('pill', { label, state: ok ? 'OK' : t('needsEnabling') });
  el.className = ok ? 'pill pill-ok' : 'pill pill-warn';
}

async function refreshPermissions() {
  if (!IS_MAC) return; // macOS-only TCC permissions; nothing to show elsewhere
  const p = await window.hush.getPermissions();
  setPill(els.accState, p.accessibility, t('accessibility'));
  setPill(els.inputState, p.inputMonitoring, t('inputMonitoring'));
  const a = $('ob-acc'); if (a) setPill(a, p.accessibility, t('accessibility'));
  const i = $('ob-input'); if (i) setPill(i, p.inputMonitoring, t('inputMonitoring'));
}

// macOS only, installed app only: let the user drag Hush straight into the
// Privacy list. Falls back silently to the "Open" buttons when unavailable.
let permCanDrag = false;
function wirePermDrag(el) {
  if (!el || el.dataset.wired) return;
  el.dataset.wired = '1';
  // Native file drag is started by the main process; prevent the default (which
  // would try to drag the <img> as a web image).
  el.addEventListener('dragstart', (e) => { e.preventDefault(); window.hush.startPermDrag(); });
}
async function initPermDrag() {
  try { permCanDrag = await window.hush.canDragPermissions(); } catch { permCanDrag = false; }
  const chip = $('perm-drag');
  if (chip && permCanDrag) { chip.hidden = false; wirePermDrag(chip); }
}

// ---- Onboarding tutorial ----
// The English / Français switch shown on the welcome step and in Behavior.
function langSegment(id) {
  return `<div class="segment" id="${id}">
    <button type="button" data-lang="en" class="${LANG === 'en' ? 'active' : ''}">English</button>
    <button type="button" data-lang="fr" class="${LANG === 'fr' ? 'active' : ''}">Français</button>
  </div>`;
}

// Built on every render so the steps follow the current language.
function buildSteps() {
  return [
    {
      glyph: '🤫',
      title: t('obWelcomeTitle'),
      body: `<div class="binding">
          <div class="binding-label"><strong>${t('language')}</strong></div>
          ${langSegment('ob-lang-seg')}
        </div>
        ${t('obWelcomeBody', { perms: IS_MAC ? t('obWelcomePerms') : '' })}`,
      wire(root) {
        root.querySelector('#ob-lang-seg').addEventListener('click', (e) => {
          const l = e.target.dataset.lang;
          if (l) void setLanguage(l);
        });
      },
    },
    {
      macOnly: true,
      glyph: '🔐',
      title: t('permTitle'),
      body: `<p>${t('obPermIntro')}</p>
        <div class="perm-row"><span id="ob-acc" class="pill pill-warn">${t('pill', { label: t('accessibility'), state: t('needsEnabling') })}</span><button class="ghost" id="ob-open-acc">${t('open')}</button></div>
        <div class="perm-row"><span id="ob-input" class="pill pill-warn">${t('pill', { label: t('inputMonitoring'), state: t('needsEnabling') })}</span><button class="ghost" id="ob-open-input">${t('open')}</button></div>
        <p style="margin-top:12px">${t('obPermEnable')}</p>
        <div class="perm-drag" data-permdrag hidden draggable="true" title="${t('dragTitle')}">
          <img src="../assets/generated/icon-256.png" alt="" width="40" height="40" />
          <div class="perm-drag-txt"><strong>${t('dragHeading')}</strong><span class="muted">${t('obDragBody')}</span></div>
        </div>`,
      wire(root) {
        root.querySelector('#ob-open-acc').onclick = () => window.hush.openAccessibility();
        root.querySelector('#ob-open-input').onclick = () => window.hush.openInputMonitoring();
        const d = root.querySelector('[data-permdrag]');
        if (d && permCanDrag) { d.hidden = false; wirePermDrag(d); }
        refreshPermissions();
      },
    },
    {
      key: 'discord',
      glyph: '🎙️',
      title: t('obDiscordTitle'),
      body: `<p>${t('obDiscordIntro')}</p>
        <ol>
          <li>${t('obDiscordStep1', { portal: '<a class="link" id="ob-portal" href="#">discord.com/developers</a>' })}</li>
          <li>${t('obDiscordStep2')}</li>
          <li>${t('obDiscordStep3')}</li>
        </ol>
        <div class="callout">${t('obRedirectCallout')}</div>
        <div class="field"><label for="ob-rpc-id">Client ID</label><input id="ob-rpc-id" type="text" spellcheck="false" placeholder="123456789012345678" /></div>
        <div class="field"><label for="ob-rpc-secret">Client Secret</label><input id="ob-rpc-secret" type="password" spellcheck="false" placeholder="••••••••••••" /></div>
        <div class="row-actions"><button class="ghost" id="ob-connect">${t('connect')}</button><span id="ob-rpc-state" class="pill pill-off">${t('notConnected')}</span></div>
        <p class="err" id="ob-rpc-error" hidden></p>
        <p style="margin-top:10px">${t('obDiscordOpen')}</p>`,
      wire(root) {
        const id = root.querySelector('#ob-rpc-id');
        const secret = root.querySelector('#ob-rpc-secret');
        id.value = cfg.discordRpc.clientId || '';
        secret.value = cfg.discordRpc.clientSecret || '';
        root.querySelector('#ob-portal').onclick = (e) => { e.preventDefault(); window.hush.openExternal('https://discord.com/developers/applications'); };
        root.querySelector('#ob-connect').onclick = () => connectRpc(id, secret);
        if (lastStatus) setStatus(lastStatus); // show the current state/error right away
      },
    },
    {
      glyph: '⌨️',
      title: t('shortcutTitle'),
      body: `<p>${t('obShortcutIntro')}</p>
        <p>${t('obShortcutNoSim')}</p>
        <div class="binding">
          <div class="binding-label"><strong>Push-to-talk</strong><span class="muted">${t('obPttHint')}</span></div>
          <button class="capture" id="ob-cap-shortcut">⌃⌥</button>
        </div>
        <p class="hint">${captureHint()}</p>
        <div class="binding">
          <div class="binding-label"><strong>Mode</strong><span class="muted">${t('obModeHint')}</span></div>
          <div class="segment" id="ob-mode-seg">
            <button type="button" data-mode="auto" class="active">Auto</button>
            <button type="button" data-mode="hold">${t('modeHold')}</button>
            <button type="button" data-mode="toggle">${t('modeToggle')}</button>
          </div>
        </div>
        <div class="callout">${t('obModeCallout')}</div>`,
      wire(root) {
        const btn = root.querySelector('#ob-cap-shortcut');
        btn.textContent = comboLabel(cfg.shortcut);
        btn.onclick = () => captureInto('shortcut', btn);

        const modeSeg = root.querySelector('#ob-mode-seg');
        for (const b of modeSeg.querySelectorAll('button')) {
          b.classList.toggle('active', b.dataset.mode === cfg.mode);
        }
        modeSeg.addEventListener('click', async (e) => {
          const m = e.target.dataset.mode;
          if (!m) return;
          cfg.mode = m;
          for (const b of modeSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.mode === m);
          await persist();   // no Save button in the tutorial → persist immediately
          render();          // keep the window's Behavior segment in sync
        });
      },
    },
    {
      glyph: '🖥️',
      title: t('whereTitle'),
      body: `<p>${t('obWhereIntro')}</p>
        <div class="binding">
          <div class="binding-label"><strong>${t('discordLocation')}</strong></div>
          <div class="segment" id="ob-role-seg">
            <button type="button" data-role="local" class="active">${t('thisComputer')}</button>
            <button type="button" data-role="controller">${t('anotherComputer')}</button>
          </div>
        </div>
        <div id="ob-controller-panel" hidden>
          <p class="hint">${t('obControllerHint')}</p>
          <div class="row-actions"><button class="ghost" id="ob-discover-btn" type="button">${t('findHosts')}</button></div>
          <ul id="ob-host-list"></ul>
          <div class="field"><label for="ob-remote-host">${t('hostIpLabel')}</label><input id="ob-remote-host" type="text" spellcheck="false" placeholder="192.168.1.20" /></div>
          <div class="field"><label for="ob-remote-port">${t('port')}</label><input id="ob-remote-port" type="number" value="8698" /></div>
          <div class="field"><label for="ob-remote-code">${t('pairingCode')}</label><input id="ob-remote-code" type="text" spellcheck="false" placeholder="ABC123" /></div>
          <div class="row-actions"><button class="primary" id="ob-remote-connect" type="button">${t('connect')}</button><span id="ob-remote-status" class="pill pill-off">${t('notConnected')}</span></div>
        </div>
        <hr />
        <div class="perm-row"><span>${t('hostsDiscord')}</span><input type="checkbox" id="ob-host-toggle" /></div>
        <div id="ob-host-panel" hidden>
          <p class="muted">${t('addresses')} <strong id="ob-host-addrs">—</strong></p>
          <div class="field"><label for="ob-host-port">${t('port')}</label><input id="ob-host-port" type="number" value="8698" /></div>
          <div class="field"><label for="ob-host-code">${t('pairingCode')}</label><input id="ob-host-code" type="text" readonly /></div>
          <div class="row-actions"><button class="ghost" id="ob-regen-code-btn" type="button">${t('regenCode')}</button></div>
        </div>
        <div class="callout">${t('obSameNetwork')}</div>`,
      wire(root) {
        const refs = {
          roleSeg: root.querySelector('#ob-role-seg'),
          controllerPanel: root.querySelector('#ob-controller-panel'),
          discoverBtn: root.querySelector('#ob-discover-btn'),
          hostList: root.querySelector('#ob-host-list'),
          remoteHost: root.querySelector('#ob-remote-host'),
          remotePort: root.querySelector('#ob-remote-port'),
          remoteCode: root.querySelector('#ob-remote-code'),
          remoteConnect: root.querySelector('#ob-remote-connect'),
          remoteStatus: root.querySelector('#ob-remote-status'),
          hostToggle: root.querySelector('#ob-host-toggle'),
          hostPanel: root.querySelector('#ob-host-panel'),
          hostAddrs: root.querySelector('#ob-host-addrs'),
          hostPort: root.querySelector('#ob-host-port'),
          hostCode: root.querySelector('#ob-host-code'),
          regenCodeBtn: root.querySelector('#ob-regen-code-btn'),
        };
        // Reflect current cfg into the freshly-rendered controls, then wire them.
        reflectRoleControls(refs);
        if (cfg.role === 'host') refreshHostAddrs(refs);
        wireRoleControls(refs);
      },
    },
    {
      glyph: '✅',
      title: t('obDoneTitle'),
      body: t('obDoneBody', { where: t(IS_MAC ? 'trayWhereMac' : 'trayWhereWin') }),
    },
  ];
}

let obIndex = 0;
const ob = {
  overlay: $('onboarding'),
  steps: $('ob-steps'),
  body: $('ob-body'),
  back: $('ob-back'),
  next: $('ob-next'),
  skip: $('ob-skip'),
};

// The onboarding steps that apply to this platform (drops macOS-only steps
// elsewhere, so indices below are platform-relative — target steps by key).
function steps() {
  return buildSteps().filter((s) => !s.macOnly || IS_MAC);
}

function renderStep() {
  const list = steps();
  const s = list[obIndex];
  ob.steps.innerHTML = list.map((_, i) => `<i class="${i <= obIndex ? 'done' : ''}"></i>`).join('');
  ob.body.innerHTML = `<span class="glyph">${s.glyph}</span><h3>${s.title}</h3>${s.body}`;
  if (typeof s.wire === 'function') s.wire(ob.body);
  ob.back.classList.toggle('hidden', obIndex === 0);
  ob.next.textContent = t(obIndex === list.length - 1 ? 'finish' : 'next');
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
  if (obIndex >= steps().length - 1) return closeOnboarding();
  obIndex++; renderStep();
});
ob.back.addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderStep(); } });
ob.skip.addEventListener('click', closeOnboarding);
els.openTuto.addEventListener('click', (e) => {
  e.preventDefault();
  // Jump to the "Connect Discord" step by key — its index shifts by platform.
  openOnboarding(Math.max(0, steps().findIndex((s) => s.key === 'discord')));
});
els.replayTuto.addEventListener('click', (e) => { e.preventDefault(); openOnboarding(0); });

// Switch the UI language live and save the choice (main re-labels the tray).
async function setLanguage(lang) {
  if (lang === LANG || !I18N[lang]) return;
  LANG = lang;
  cfg.language = lang;
  applyStaticI18n();
  render();
  if (lastStatus) setStatus(lastStatus);
  if (IS_MAC) refreshPermissions();
  if (!ob.overlay.hidden) renderStep();
  await persist();
}

$('lang-seg').addEventListener('click', (e) => {
  const l = e.target.dataset.lang;
  if (l) void setLanguage(l);
});

// ---- Init ----
async function init() {
  const brand = await window.hush.getBrand();
  els.name.textContent = brand.name;
  document.title = brand.name;
  try { LANG = await window.hush.getLanguage(); } catch { LANG = 'en'; }
  applyStaticI18n();
  try { els.appVersion.textContent = `Hush ${await window.hush.getVersion()}`; } catch { /* noop */ }
  cfg = await window.hush.getConfig();
  render();
  wireRoleControls(els);
  if (cfg.role === 'host') refreshHostAddrs(els);
  // macOS-only permission panel: poll it live on Mac; hide it entirely elsewhere.
  const permCard = document.getElementById('perm-card');
  if (IS_MAC) {
    refreshPermissions();
    setInterval(refreshPermissions, 2000);
  } else if (permCard) {
    permCard.hidden = true;
  }
  await initPermDrag(); // resolve drag availability before onboarding may render step 2

  window.hush.onConfigUpdated((next) => {
    cfg = next;
    render();
    if (!ob.overlay.hidden) renderStep(); // keep an open tutorial step in sync
  });
  window.hush.onFocusLocation(() => {
    $('role-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let onboarded = false;
  try { onboarded = localStorage.getItem('hush.onboarded') === '1'; } catch { /* noop */ }
  if (!onboarded) openOnboarding(0);
}

init();
