# Affichage version + détection de mise à jour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la version de Hush dans l'UI et signaler automatiquement qu'une version plus récente existe, avec un bouton qui ouvre la page de téléchargement.

**Architecture:** Un module pur `src/update-check.ts` (fetch injecté, testable sans Electron/réseau) interroge l'API GitHub Releases de l'upstream ; `src/main.ts` l'appelle au démarrage et toutes les 24 h, expose le résultat au renderer via le flux `status` existant et via un item de la barre système ; le renderer affiche une ligne de version + un bandeau « nouvelle version → Télécharger ».

**Tech Stack:** Electron 30, TypeScript (CommonJS, `src/`→`dist/`), Vitest, `globalThis.fetch` (Node 20), IPC contextBridge.

## Global Constraints

- Langue UI et messages : **français**, accents corrects.
- Tests : **Vitest**. Fichier ciblé : `npx vitest run tests/<f>.test.ts` ; suite : `npm test`. Build/typecheck : `npm run build`, `npm run typecheck`.
- Logique pure et testable extraite hors de `main.ts`/`renderer.js` (ni Electron ni DOM ne chargent en test) — motif de `discord-oauth.ts`.
- **Best-effort, ne throw jamais** : toute erreur réseau/quota/JSON → `null`, aucun blocage, aucune erreur remontée.
- Repo interrogé : **`MatthysDev/hush`** (upstream, d'où l'utilisateur installe). URL : `https://api.github.com/repos/MatthysDev/hush/releases/latest`. Non authentifié (repo public).
- Cadence : **au lancement + toutes les 24 h**.
- Le bouton **ouvre la page de release** (`shell.openExternal`), pas de téléchargement/install auto (app non signée sur macOS — hors scope).
- Commits fréquents, un par tâche minimum.

---

## Task 1 : Module pur `update-check.ts` + tests

**Files:**
- Create: `src/update-check.ts`
- Test: `tests/update-check.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type UpdateInfo = { version: string; url: string }`
  - `type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>`
  - `const RELEASES_API_URL: string`
  - `compareVersions(a: string, b: string): -1 | 0 | 1`
  - `parseLatestRelease(json: unknown): UpdateInfo | null`
  - `checkForUpdate(fetchImpl: FetchLike, currentVersion: string): Promise<UpdateInfo | null>`

- [ ] **Step 1: Write the failing test**

Créer `tests/update-check.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  compareVersions, parseLatestRelease, checkForUpdate, RELEASES_API_URL,
} from '../src/update-check';

describe('compareVersions', () => {
  it('returns 0 for equal versions (with or without v prefix)', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
  it('detects patch / minor / major differences', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });
  it('compares numerically, not lexically (0.10.0 > 0.9.0)', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
  });
  it('treats a missing component as 0 and ignores a pre-release suffix', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.3-beta', '1.2.3')).toBe(0);
  });
});

describe('parseLatestRelease', () => {
  it('extracts version + url from a valid payload', () => {
    expect(parseLatestRelease({ tag_name: 'v0.2.0', html_url: 'https://x/rel' }))
      .toEqual({ version: 'v0.2.0', url: 'https://x/rel' });
  });
  it('returns null when a field is missing or non-string', () => {
    expect(parseLatestRelease({ tag_name: 'v0.2.0' })).toBeNull();
    expect(parseLatestRelease({ html_url: 'https://x' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 1, html_url: 'https://x' })).toBeNull();
  });
  it('returns null for a non-object', () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease('nope')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  const ok = (body: any): any =>
    async () => ({ ok: true, status: 200, json: async () => body });

  it('returns the release when it is newer', async () => {
    const fetchImpl = ok({ tag_name: 'v0.2.0', html_url: 'https://x/rel' });
    expect(await checkForUpdate(fetchImpl, '0.1.7'))
      .toEqual({ version: 'v0.2.0', url: 'https://x/rel' });
  });
  it('returns null when the release is equal or older', async () => {
    expect(await checkForUpdate(ok({ tag_name: 'v0.1.7', html_url: 'https://x' }), '0.1.7')).toBeNull();
    expect(await checkForUpdate(ok({ tag_name: 'v0.1.0', html_url: 'https://x' }), '0.1.7')).toBeNull();
  });
  it('returns null on a non-OK HTTP status', async () => {
    const fetchImpl: any = async () => ({ ok: false, status: 403, json: async () => ({}) });
    expect(await checkForUpdate(fetchImpl, '0.1.7')).toBeNull();
  });
  it('returns null when fetch rejects (offline)', async () => {
    const fetchImpl: any = async () => { throw new Error('offline'); };
    expect(await checkForUpdate(fetchImpl, '0.1.7')).toBeNull();
  });
  it('returns null on malformed JSON body', async () => {
    expect(await checkForUpdate(ok({ nope: true }), '0.1.7')).toBeNull();
  });
  it('hits the upstream releases endpoint', async () => {
    let seen = '';
    const fetchImpl: any = async (url: string) => {
      seen = url; return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0', html_url: 'https://x' }) };
    };
    await checkForUpdate(fetchImpl, '0.1.7');
    expect(seen).toBe(RELEASES_API_URL);
    expect(RELEASES_API_URL).toContain('MatthysDev/hush');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update-check.test.ts`
Expected: FAIL — module `../src/update-check` introuvable.

- [ ] **Step 3: Write the implementation**

Créer `src/update-check.ts` :

```ts
// Best-effort "is there a newer release?" check against the upstream GitHub
// Releases API. Pure and fetch-injected so it unit-tests without a network
// stack or Electron — mirrors discord-oauth.ts. Never throws: every failure
// (offline, rate-limited, malformed) resolves to null so the caller treats
// "no update" and "couldn't check" identically.

export type UpdateInfo = { version: string; url: string };

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

// Upstream is where the user installs from (the fork only contributes).
export const RELEASES_API_URL =
  'https://api.github.com/repos/MatthysDev/hush/releases/latest';

// Numeric semver compare on MAJOR.MINOR.PATCH. Tolerates a leading 'v' and a
// pre-release suffix (ignored). Missing/non-numeric parts count as 0.
// Returns -1 (a<b), 0 (equal), 1 (a>b).
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => {
      const x = parseInt(n, 10);
      return Number.isFinite(x) ? x : 0;
    });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// Pull { version, url } out of a GitHub "latest release" payload. Returns null
// if the shape isn't what we expect (missing tag_name/html_url, non-object).
export function parseLatestRelease(json: unknown): UpdateInfo | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const version = obj.tag_name;
  const url = obj.html_url;
  if (typeof version !== 'string' || typeof url !== 'string') return null;
  if (!version || !url) return null;
  return { version, url };
}

// Returns the newer release ({ version, url }) if one exists, else null.
// Best-effort: swallows every error path to null.
export async function checkForUpdate(
  fetchImpl: FetchLike,
  currentVersion: string,
): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hush' },
    });
    if (!res.ok) return null;
    const info = parseLatestRelease(await res.json());
    if (!info) return null;
    return compareVersions(info.version, currentVersion) === 1 ? info : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update-check.test.ts`
Expected: PASS (tous les cas).

- [ ] **Step 5: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: OK, suite verte.

- [ ] **Step 6: Commit**

```bash
git add src/update-check.ts tests/update-check.test.ts
git commit -m "feat(update): pure GitHub-release update-check module"
```

---

## Task 2 : Câblage `main.ts` + IPC version (preload)

**Files:**
- Modify: `src/main.ts` (import, état module, `runUpdateCheck`, boot + interval, champ `status.update`, item barre système, `cleanup`, IPC `app:version`)
- Modify: `src/preload.ts` (méthode `getVersion`)

**Interfaces:**
- Consumes: `checkForUpdate`, `UpdateInfo`, `FetchLike` de `src/update-check.ts`.
- Produces:
  - Nouveau champ dans le payload `status` : `update: UpdateInfo | null`.
  - IPC `app:version` → `string` ; exposé au renderer comme `window.hush.getVersion(): Promise<string>`.

- [ ] **Step 1: Importer le module**

Dans `src/main.ts`, ajouter près des imports internes :

```ts
import { checkForUpdate, UpdateInfo, FetchLike } from './update-check';
```

- [ ] **Step 2: Ajouter l'état de module + la fonction de check**

Dans `src/main.ts`, à côté des variables de module (près de `let orchestrator`), ajouter :

```ts
let latestUpdate: UpdateInfo | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
```

Puis ajouter cette fonction juste au-dessus de `function pushStatus()` :

```ts
// Best-effort check for a newer upstream release. Updates latestUpdate and, when
// it changes, re-pushes status so the window banner and tray item refresh.
async function runUpdateCheck(): Promise<void> {
  const found = await checkForUpdate((globalThis.fetch as unknown) as FetchLike, app.getVersion());
  const changed = (found?.version ?? null) !== (latestUpdate?.version ?? null);
  latestUpdate = found;
  if (changed) {
    dbg('update: check', found ? `newer ${found.version}` : 'up to date');
    pushStatus();
  }
}
```

- [ ] **Step 3: Exposer le résultat dans le payload status**

Dans `src/main.ts`, dans `pushStatus()`, ajouter le champ `update` à l'objet envoyé (le `win?.webContents.send('status', { ... })` autour de la ligne 93) :

```ts
  win?.webContents.send('status', {
    active,
    engineReady,
    role: cfg.role,
    rpc: discord.getState(),
    rpcError: discord.getError(),
    remote: { state: remote.getState(), error: remote.getError() },
    update: latestUpdate,
  });
```

- [ ] **Step 4: Ajouter l'item « nouvelle version » à la barre système**

Dans `src/main.ts`, dans `refreshTrayMenu()`, remplacer ces trois lignes du template :

```ts
      ...discordLocationMenuItems(),
      { type: 'separator' },
      { label: 'Réglages…', click: showWindow },
```

par :

```ts
      ...discordLocationMenuItems(),
      ...(latestUpdate
        ? [
            { type: 'separator' as const },
            {
              label: `⬆︎ Nouvelle version ${latestUpdate.version} — Télécharger`,
              click: () => { const u = latestUpdate; if (u) void shell.openExternal(u.url); },
            },
          ]
        : []),
      { type: 'separator' },
      { label: 'Réglages…', click: showWindow },
```

(`shell` et `app` sont déjà importés en tête de `main.ts`.)

- [ ] **Step 5: Lancer le check au démarrage + toutes les 24 h**

Dans `src/main.ts`, dans le bloc `app.whenReady().then(() => { ... })`, après l'appel `showWindow()` gaté (la ligne `if (shouldShowWindowOnLaunch(...)) showWindow();`), ajouter :

```ts
    // Update check: once at boot, then daily while the app stays resident.
    void runUpdateCheck();
    updateTimer = setInterval(() => void runUpdateCheck(), UPDATE_CHECK_INTERVAL_MS);
```

- [ ] **Step 6: Nettoyer l'intervalle dans cleanup()**

Dans `src/main.ts`, dans `function cleanup()`, ajouter la ligne :

```ts
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
```

- [ ] **Step 7: Ajouter le handler IPC de version**

Dans `src/main.ts`, dans le bloc des `ipcMain.handle(...)` (près de `ipcMain.handle('config:get', () => cfg);`), ajouter :

```ts
    ipcMain.handle('app:version', () => app.getVersion());
```

- [ ] **Step 8: Exposer getVersion dans le preload**

Dans `src/preload.ts`, ajouter au `bridge` (à côté de `quit`) :

```ts
  getVersion: () => ipcRenderer.invoke('app:version'),
```

- [ ] **Step 9: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: aucun typage cassé (le nouveau champ `status.update` est du texte libre côté renderer), suite verte (les tests de Task 1 restent verts ; pas de nouveau test unitaire ici — câblage Electron vérifié au build + manuellement).

- [ ] **Step 10: Commit**

```bash
git add src/main.ts src/preload.ts
git commit -m "feat(update): check upstream release at boot+daily, surface in tray + status"
```

---

## Task 3 : UI renderer (ligne de version + bandeau MàJ)

**Files:**
- Modify: `renderer/index.html` (bandeau + ligne de version)
- Modify: `renderer/renderer.js` (els, rendu du bandeau dans `setStatus`, fetch version dans `init`)
- Modify: `renderer/style.css` (styles bandeau + version)

**Interfaces:**
- Consumes: `window.hush.getVersion(): Promise<string>`, `window.hush.openExternal(url)`, et le champ `status.update: { version, url } | null` (via `onStatus`) — tous produits par Task 2.
- Produces: rien (feuille de l'arbre).

- [ ] **Step 1: Ajouter le bandeau + la ligne de version dans index.html**

Dans `renderer/index.html`, remplacer :

```html
    <p class="err" id="err"></p>

    <div class="actions">
```

par :

```html
    <p class="err" id="err"></p>

    <div class="update-banner" id="update-banner" hidden>
      <span id="update-text">Nouvelle version disponible</span>
      <button class="primary" id="update-download" type="button">Télécharger</button>
    </div>

    <div class="actions">
```

Puis remplacer :

```html
      <button class="primary" id="save">Enregistrer</button>
    </div>

    <p class="hint">
```

par :

```html
      <button class="primary" id="save">Enregistrer</button>
    </div>

    <p class="version" id="app-version"></p>

    <p class="hint">
```

- [ ] **Step 2: Déclarer les nouveaux éléments dans renderer.js**

Dans `renderer/renderer.js`, dans l'objet `els` (juste après `regenCodeBtn: $('regen-code-btn'),`), ajouter :

```js
  updateBanner: $('update-banner'),
  updateText: $('update-text'),
  updateDownload: $('update-download'),
  appVersion: $('app-version'),
```

- [ ] **Step 3: Rendre le bandeau depuis le statut**

Dans `renderer/renderer.js`, dans `function setStatus(s)`, juste avant l'accolade fermante de la fonction (après le bloc `if (s.role === 'controller') { ... }`), ajouter :

```js
  // Update-available banner (from the main-process release check).
  if (s.update && s.update.version && s.update.url) {
    els.updateText.textContent = `Nouvelle version ${s.update.version} disponible`;
    els.updateDownload.onclick = () => window.hush.openExternal(s.update.url);
    els.updateBanner.hidden = false;
  } else {
    els.updateBanner.hidden = true;
  }
```

- [ ] **Step 4: Afficher la version au démarrage**

Dans `renderer/renderer.js`, dans `async function init()`, juste après `document.title = brand.name;`, ajouter :

```js
  try { els.appVersion.textContent = `Hush ${await window.hush.getVersion()}`; } catch { /* noop */ }
```

- [ ] **Step 5: Styliser le bandeau et la version**

Dans `renderer/style.css`, ajouter à la fin du fichier :

```css
.update-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(120, 170, 255, 0.12);
  border: 1px solid rgba(120, 170, 255, 0.35);
  font-size: 13px;
}
.update-banner .primary { flex: 0 0 auto; }
.version {
  margin: 8px 0 0;
  text-align: center;
  font-size: 12px;
  opacity: 0.45;
}
```

- [ ] **Step 6: Verify typecheck + build + full suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: OK, suite verte, build propre (le renderer n'a pas de tests — vérifié à l'œil au build).

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/renderer.js renderer/style.css
git commit -m "feat(update): show version + update-available banner in settings"
```

---

## Vérification manuelle finale

Non couvrable en unit tests (Electron/DOM/réseau réels) :

1. **Version affichée** : ouvrir les réglages → « Hush 0.1.7 » visible en pied.
2. **Aucune MàJ** : si l'app est à jour (ou hors ligne), aucun bandeau, aucun item barre système, aucune erreur (vérifier le log `dbg`).
3. **MàJ détectée** : temporairement, pointer `RELEASES_API_URL` sur un repo dont la dernière release est plus récente que `app.getVersion()` (ou baisser la version locale), relancer → bandeau « Nouvelle version X — Télécharger » dans la fenêtre ET item dans la barre système ; clic → ouvre la page de release dans le navigateur. Remettre l'URL upstream ensuite.
4. **Best-effort** : couper le réseau au lancement → l'app démarre normalement, pas de bandeau, pas de crash.
