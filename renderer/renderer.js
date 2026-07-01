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

const els = {
  name: document.getElementById('brand-name'),
  tagline: document.getElementById('brand-tagline'),
  capTrigger: document.getElementById('cap-trigger'),
  capDiscord: document.getElementById('cap-discord'),
  capWispr: document.getElementById('cap-wispr'),
  modeSeg: document.getElementById('mode-seg'),
  gap: document.getElementById('gap'),
  gapVal: document.getElementById('gap-val'),
  delay: document.getElementById('delay'),
  delayVal: document.getElementById('delay-val'),
  err: document.getElementById('err'),
  save: document.getElementById('save'),
  quit: document.getElementById('quit'),
  accState: document.getElementById('acc-state'),
  inputState: document.getElementById('input-state'),
  openAcc: document.getElementById('open-acc'),
  openInput: document.getElementById('open-input'),
  statusDot: document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
};

const CAP = { trigger: els.capTrigger, discordCombo: els.capDiscord, wisprCombo: els.capWispr };

function render() {
  els.capTrigger.textContent = comboLabel(cfg.trigger);
  els.capDiscord.textContent = comboLabel(cfg.discordCombo);
  els.capWispr.textContent = comboLabel(cfg.wisprCombo);
  for (const b of els.modeSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === cfg.mode);
  }
  els.gap.value = String(cfg.muteDictateGapMs);
  els.gapVal.textContent = String(cfg.muteDictateGapMs);
  els.delay.value = String(cfg.unmuteDelayMs);
  els.delayVal.textContent = String(cfg.unmuteDelayMs);
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
  // 'cancelled' (Échap) / 'busy' -> on garde l'ancienne valeur, sans message

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

els.gap.addEventListener('input', () => {
  cfg.muteDictateGapMs = Number(els.gap.value);
  els.gapVal.textContent = els.gap.value;
});

els.delay.addEventListener('input', () => {
  cfg.unmuteDelayMs = Number(els.delay.value);
  els.delayVal.textContent = els.delay.value;
});

els.save.addEventListener('click', async () => {
  els.err.textContent = '';
  const res = await window.hush.saveConfig(cfg);
  if (!res.ok) {
    els.err.textContent =
      res.error.includes('distinct')
        ? 'Les trois raccourcis doivent être différents les uns des autres.'
        : res.error;
    return;
  }
  els.save.textContent = '✓ Enregistré';
  setTimeout(() => (els.save.textContent = 'Enregistrer'), 1200);
});

els.quit.addEventListener('click', () => window.hush.quit());
els.openAcc.addEventListener('click', () => window.hush.openAccessibility());
els.openInput.addEventListener('click', () => window.hush.openInputMonitoring());

window.hush.onStatus((s) => {
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
});

function setPill(el, ok, label) {
  el.textContent = `${label} : ${ok ? 'OK' : 'à activer'}`;
  el.className = ok ? 'pill pill-ok' : 'pill pill-warn';
}

async function refreshPermissions() {
  const p = await window.hush.getPermissions();
  setPill(els.accState, p.accessibility, 'Accessibilité');
  setPill(els.inputState, p.inputMonitoring, 'Surveillance de la saisie');
}

async function init() {
  const brand = await window.hush.getBrand();
  els.name.textContent = brand.name;
  els.tagline.textContent = brand.tagline;
  document.title = brand.name;
  cfg = await window.hush.getConfig();
  render();
  refreshPermissions();
  setInterval(refreshPermissions, 2000);
}

init();
