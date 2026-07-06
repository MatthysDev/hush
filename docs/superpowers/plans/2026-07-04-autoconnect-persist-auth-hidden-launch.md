# Auto-connexion LAN, auth Discord persistante, lancement masqué — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'app utilisable sans friction quotidienne : connexion Mac↔Windows automatique par mDNS, reconnexion Discord silencieuse (fin de la popup à chaque lancement), et démarrage discret en arrière-plan.

**Architecture:** Trois correctifs ciblés dans l'app Electron/TypeScript existante, chacun avec sa logique pure extraite dans un petit module testable (`config.ts`, `launch.ts`, `host-discovery.ts`) et un câblage fin dans `src/main.ts`. Plus un nettoyage du working tree (package.json vidé par accident, artefacts `.js` à la racine, dépôt `Hush/` vide).

**Tech Stack:** Electron 30, TypeScript (CommonJS, `src/` → `dist/`), Vitest, electron-store, bonjour-service (mDNS), discord-rpc, ws.

## Global Constraints

- Langue de l'UI et des messages utilisateur : **français**, avec accents corrects.
- Tests : **Vitest**. Lancer un fichier : `npx vitest run tests/<fichier>.test.ts`. Toute la suite : `npm test` (= `vitest run`) une fois `package.json` restauré (Task 1).
- Build / typecheck : `npm run build` (= `tsc`) et `npm run typecheck` (= `tsc --noEmit`) après Task 1.
- Logique pure et testable extraite hors de `main.ts`/`renderer.js` (ni Electron ni DOM ne sont chargés en test) — suivre le motif existant (`net.ts`, `location-switch.ts`, `discord-oauth.ts`).
- Best-effort : aucune de ces features ne doit pouvoir throw et casser le démarrage — envelopper les appels OS/réseau dans `try/catch` comme le code existant.
- Cross-platform : macOS **et** Windows. `openAsHidden` est macOS-only ; Windows utilise `args: ['--hidden']`.
- Commits fréquents, un par tâche minimum.

---

## Task 1 : Nettoyage du working tree

**Files:**
- Restore: `package.json` (working tree vidé par accident — le restaurer depuis HEAD)
- Delete: `discovery.js`, `mute-client.js`, `mute-protocol.js`, `mute-server.js`, `mute-transport.js` (artefacts de compilation à la racine)
- Delete: `Hush/` (dépôt git vide accidentel, `README.md` de 7 octets)
- Modify: `.gitignore` (garde-fou contre le retour des `.js` racine)

**Interfaces:**
- Consumes: rien.
- Produces: un `package.json` fonctionnel (scripts `test`/`build`/`typecheck`/`start`, devDependencies, config electron-builder) sur lequel toutes les tâches suivantes s'appuient.

- [ ] **Step 1: Constater l'état avant nettoyage**

Run: `git status --short && ls *.js 2>/dev/null && ls -d Hush 2>/dev/null`
Expected: `package.json` marqué modifié, les 5 `.js` et `Hush/` listés comme non suivis.

- [ ] **Step 2: Restaurer le package.json**

Le working tree a supprimé tous les `scripts`, `devDependencies` et la config `build`. Le diff ne contient que des suppressions → restauration sûre depuis HEAD.

Run: `git checkout -- package.json`
Then verify: `node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).join(','))"`
Expected: `test,typecheck,build,rebuild,start,pack,dist,dist:win`

- [ ] **Step 3: Supprimer les artefacts racine et le dépôt vide**

```bash
rm -f discovery.js mute-client.js mute-protocol.js mute-server.js mute-transport.js
rm -rf Hush
```

- [ ] **Step 4: Ajouter le garde-fou .gitignore**

Ajouter à la fin de `.gitignore` (aucun `.js` légitime ne vit à la racine du repo — les sources sont en `src/`, le renderer en `renderer/`) :

```gitignore

# Stray tsc output — sources live in src/, never at the repo root
/*.js
```

- [ ] **Step 5: Vérifier que le build et les tests repartent**

Run: `npm run build && npm test`
Expected: `tsc` compile sans erreur (sortie dans `dist/`), la suite Vitest passe entièrement.
Then: `git status --short`
Expected: plus aucun `.js` à la racine ni `Hush/` en non-suivi ; seuls `package.json` (revenu propre → absent du status) et `.gitignore` modifiés.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(repo): restore gutted package.json, drop stray tsc output & empty Hush repo"
```

---

## Task 2 : Auth Discord persistante (fin de la popup à chaque lancement)

**Cause racine** : `renderer/renderer.js:110` (`syncRpcInputs`) reconstruit `cfg.discordRpc` avec seulement `{clientId, clientSecret}`, jetant les tokens ; le `config:set` suivant écrit sur disque un `discordRpc` sans tokens et les efface. Correctif principal côté `main` (source de vérité) + garde-fou renderer.

**Files:**
- Modify: `src/config.ts` (ajouter `preserveDiscordTokens`)
- Modify: `src/main.ts:542-553` (fusion dans le handler `config:set`)
- Modify: `renderer/renderer.js:109-114` (garde-fou `syncRpcInputs`)
- Test: `tests/config.test.ts` (ajouter un bloc `describe`)

**Interfaces:**
- Consumes: `DiscordRpc` de `src/types.ts` (`{ clientId, clientSecret, accessToken?, refreshToken?, tokenExpiresAt? }`).
- Produces: `preserveDiscordTokens(prev: DiscordRpc, next: DiscordRpc): DiscordRpc`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `tests/config.test.ts` :

```ts
import { preserveDiscordTokens } from '../src/config';

describe('preserveDiscordTokens', () => {
  const withTokens = {
    clientId: 'id', clientSecret: 'secret',
    accessToken: 'A', refreshToken: 'R', tokenExpiresAt: 123,
  };

  it('carries tokens forward when credentials are unchanged and next has none', () => {
    const next = { clientId: 'id', clientSecret: 'secret' };
    expect(preserveDiscordTokens(withTokens, next)).toEqual({
      clientId: 'id', clientSecret: 'secret',
      accessToken: 'A', refreshToken: 'R', tokenExpiresAt: 123,
    });
  });

  it('drops tokens when the clientId changes (new Discord app invalidates them)', () => {
    const next = { clientId: 'other', clientSecret: 'secret' };
    expect(preserveDiscordTokens(withTokens, next)).toEqual({
      clientId: 'other', clientSecret: 'secret',
    });
  });

  it('drops tokens when the clientSecret changes', () => {
    const next = { clientId: 'id', clientSecret: 'new' };
    expect(preserveDiscordTokens(withTokens, next)).toEqual({
      clientId: 'id', clientSecret: 'new',
    });
  });

  it('prefers tokens the renderer did carry over the previous ones', () => {
    const next = {
      clientId: 'id', clientSecret: 'secret',
      accessToken: 'A2', refreshToken: 'R2', tokenExpiresAt: 999,
    };
    expect(preserveDiscordTokens(withTokens, next)).toEqual(next);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `preserveDiscordTokens is not a function` / import introuvable.

- [ ] **Step 3: Implémenter le helper**

Ajouter dans `src/config.ts` (importer le type en tête : `import { DiscordRpc, HushConfig } from './types';` — remplacer l'import existant `HushConfig`) :

```ts
// The renderer only ever knows the Discord clientId/secret — it doesn't carry
// the OAuth tokens Hush obtained at runtime. Saving its config verbatim would
// wipe those tokens and force a re-authorize popup on the next launch. Carry the
// existing tokens forward UNLESS the credentials changed (a new Discord app
// invalidates them). If `next` already carries tokens, they win.
export function preserveDiscordTokens(prev: DiscordRpc, next: DiscordRpc): DiscordRpc {
  const sameCreds = prev.clientId === next.clientId && prev.clientSecret === next.clientSecret;
  if (!sameCreds) return { clientId: next.clientId, clientSecret: next.clientSecret };
  return {
    ...next,
    accessToken: next.accessToken ?? prev.accessToken,
    refreshToken: next.refreshToken ?? prev.refreshToken,
    tokenExpiresAt: next.tokenExpiresAt ?? prev.tokenExpiresAt,
  };
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (tous les cas, y compris les tests `config` existants).

- [ ] **Step 5: Câbler la fusion dans le handler config:set**

Dans `src/main.ts`, ajouter `preserveDiscordTokens` à l'import de `./store`… non : il vient de `./config`. En tête de fichier, `loadConfig, saveConfig` viennent de `./store` ; ajouter un import : `import { preserveDiscordTokens } from './config';`

Puis remplacer le corps du handler `config:set` (actuellement lignes 542-553) :

```ts
    ipcMain.handle('config:set', (_e, next: HushConfig) => {
      try {
        const prev = cfg; // note: cfg is reassigned inside applyConfig(saved)
        // Never let the renderer's token-less discordRpc wipe the OAuth tokens
        // main holds — otherwise every save forces a re-authorize popup.
        const merged: HushConfig = {
          ...next,
          discordRpc: preserveDiscordTokens(prev.discordRpc, next.discordRpc),
        };
        const saved = saveConfig(merged);
        applyRoleTransition(prev, saved);
        // Only touch the OS login item when the toggle actually changed.
        if (saved.launchAtLogin !== prev.launchAtLogin) applyLaunchAtLogin(saved);
        return { ok: true, config: saved };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
```

- [ ] **Step 6: Garde-fou côté renderer**

Dans `renderer/renderer.js`, remplacer `syncRpcInputs` (lignes 109-114) pour préserver les champs token déjà présents en mémoire :

```js
// Pull the RPC credentials out of whichever inputs are on screen into cfg,
// preserving any OAuth token fields main previously handed us (config:get).
function syncRpcInputs() {
  cfg.discordRpc = {
    ...cfg.discordRpc,
    clientId: els.rpcId.value.trim(),
    clientSecret: els.rpcSecret.value.trim(),
  };
}
```

- [ ] **Step 7: Vérifier build + typecheck + suite complète**

Run: `npm run typecheck && npm test`
Expected: aucun typage cassé, toute la suite passe.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/main.ts renderer/renderer.js tests/config.test.ts
git commit -m "fix(discord): preserve OAuth tokens across config saves (no re-authorize popup)"
```

---

## Task 3 : Lancement au démarrage en arrière-plan (fenêtre masquée)

**Files:**
- Create: `src/launch.ts`
- Test: `tests/launch.test.ts`
- Modify: `src/main.ts` (`applyLaunchAtLogin`, ajout `wasAutoLaunched`, garde sur `showWindow()` au boot, import)

**Interfaces:**
- Consumes: `HushConfig` de `src/types.ts`.
- Produces:
  - `setupComplete(cfg: HushConfig): boolean`
  - `shouldShowWindowOnLaunch(openedAtLogin: boolean, cfg: HushConfig): boolean`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/launch.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { setupComplete, shouldShowWindowOnLaunch } from '../src/launch';
import { DEFAULT_CONFIG } from '../src/config';

const local = (over = {}) => ({ ...DEFAULT_CONFIG, role: 'local' as const, ...over });

describe('setupComplete', () => {
  it('false for a fresh local config with no Discord credentials', () => {
    expect(setupComplete(local())).toBe(false);
  });
  it('true once local Discord credentials are set', () => {
    expect(setupComplete(local({ discordRpc: { clientId: 'a', clientSecret: 'b' } }))).toBe(true);
  });
  it('controller is complete once it has a pairing code (address is auto-discovered)', () => {
    const ctrl = { ...DEFAULT_CONFIG, role: 'controller' as const,
      remote: { host: '', port: 8698, pairingCode: 'XYZ' } };
    expect(setupComplete(ctrl)).toBe(true);
  });
  it('controller with no pairing code is incomplete', () => {
    const ctrl = { ...DEFAULT_CONFIG, role: 'controller' as const,
      remote: { host: '', port: 8698, pairingCode: '' } };
    expect(setupComplete(ctrl)).toBe(false);
  });
});

describe('shouldShowWindowOnLaunch', () => {
  const ready = local({ discordRpc: { clientId: 'a', clientSecret: 'b' } });
  it('hides the window when auto-launched at login and setup is complete', () => {
    expect(shouldShowWindowOnLaunch(true, ready)).toBe(false);
  });
  it('shows the window when auto-launched but setup is incomplete', () => {
    expect(shouldShowWindowOnLaunch(true, local())).toBe(true);
  });
  it('always shows the window on a manual launch', () => {
    expect(shouldShowWindowOnLaunch(false, ready)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/launch.test.ts`
Expected: FAIL — module `../src/launch` introuvable.

- [ ] **Step 3: Implémenter src/launch.ts**

```ts
import { HushConfig } from './types';

// "Setup complete" = enough is configured that the settings window has nothing
// urgent to show. local/host drive a local Discord and need its credentials;
// controller only needs a pairing code — the host address is auto-discovered.
export function setupComplete(cfg: HushConfig): boolean {
  if (cfg.role === 'controller') return Boolean(cfg.remote.pairingCode);
  return Boolean(cfg.discordRpc.clientId && cfg.discordRpc.clientSecret);
}

// Show the settings window on launch UNLESS the app was auto-started at login
// and setup is already complete — then Hush stays quietly in the tray.
export function shouldShowWindowOnLaunch(openedAtLogin: boolean, cfg: HushConfig): boolean {
  return !(openedAtLogin && setupComplete(cfg));
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Étendre applyLaunchAtLogin au démarrage masqué Windows**

Dans `src/main.ts`, remplacer `applyLaunchAtLogin` (lignes 200-204) :

```ts
function applyLaunchAtLogin(next: HushConfig): void {
  try {
    // openAsHidden covers macOS; Windows ignores it, so we register a --hidden
    // arg on the login-item launch and detect it in wasAutoLaunched().
    app.setLoginItemSettings({
      openAtLogin: next.launchAtLogin,
      openAsHidden: true,
      args: ['--hidden'],
    });
  } catch { /* noop — login-item control is best-effort */ }
}
```

- [ ] **Step 6: Ajouter le détecteur d'auto-lancement + importer les helpers**

Dans `src/main.ts`, ajouter l'import près des autres imports internes :

```ts
import { shouldShowWindowOnLaunch } from './launch';
```

Puis ajouter cette fonction juste au-dessus de `function showWindow()` (vers la ligne 325) :

```ts
// Was this process started automatically at login (vs. the user opening it)?
// Windows: the login item carries our --hidden arg. macOS: ask the OS directly.
function wasAutoLaunched(): boolean {
  if (process.argv.includes('--hidden')) return true;
  try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
}
```

- [ ] **Step 7: Garder l'ouverture de la fenêtre au boot**

Dans `src/main.ts`, remplacer la ligne 537 (`showWindow();` sous le commentaire « First run: open the settings window ») par :

```ts
    // Open the settings window on launch — unless we were auto-started at login
    // and setup is already done, in which case stay quietly in the tray.
    if (shouldShowWindowOnLaunch(wasAutoLaunched(), cfg)) showWindow();
```

- [ ] **Step 8: Vérifier typecheck + suite complète**

Run: `npm run typecheck && npm test`
Expected: OK, suite verte.

- [ ] **Step 9: Commit**

```bash
git add src/launch.ts src/main.ts tests/launch.test.ts
git commit -m "feat(launch): start hidden in the tray when auto-launched at login"
```

---

## Task 4 : Connexion auto entre les 2 machines (mDNS pilote la connexion)

**Files:**
- Create: `src/host-discovery.ts`
- Test: `tests/host-discovery.test.ts`
- Modify: `src/main.ts` (import, état `stopHostDiscovery`, `startHostDiscovery`/`stopDiscovery`, `connectRemote`, `applyRoleTransition`, `cleanup`)
- Modify: `renderer/renderer.js:355` (libellé « recherche de l'hôte » en rôle controller — polish manuel)

**Interfaces:**
- Consumes:
  - `browseHosts(onFound: (h: DiscoveredHost) => void): () => void` de `src/discovery.ts` (`DiscoveredHost = { name: string; host: string; port: number }`).
  - `RemoteDiscordMuter.connect(host: string, port: number, code: string): void` et `.isConnected()` de `src/mute-client.ts`.
- Produces:
  - `hostAddr(h: { host: string; port: number }): string`
  - `shouldRetarget(currentTarget: string, discovered: string): boolean`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/host-discovery.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { hostAddr, shouldRetarget } from '../src/host-discovery';

describe('hostAddr', () => {
  it('formats host:port', () => {
    expect(hostAddr({ host: '192.168.1.20', port: 8698 })).toBe('192.168.1.20:8698');
  });
});

describe('shouldRetarget', () => {
  it('retargets when the discovered address differs from the current one', () => {
    expect(shouldRetarget('192.168.1.20:8698', '192.168.1.33:8698')).toBe(true);
  });
  it('does not retarget the same address (the muter retries it on its own)', () => {
    expect(shouldRetarget('192.168.1.20:8698', '192.168.1.20:8698')).toBe(false);
  });
  it('retargets from no current target (first discovery)', () => {
    expect(shouldRetarget('', '192.168.1.20:8698')).toBe(true);
  });
  it('ignores an empty discovered address', () => {
    expect(shouldRetarget('192.168.1.20:8698', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/host-discovery.test.ts`
Expected: FAIL — module `../src/host-discovery` introuvable.

- [ ] **Step 3: Implémenter src/host-discovery.ts**

```ts
// Pure decision helpers for controller-side mDNS auto-connect. The controller
// browses continuously; each discovered host is fed through shouldRetarget to
// decide whether to (re)dial it. Kept dependency-free so it is unit-testable
// without a network stack.

export function hostAddr(h: { host: string; port: number }): string {
  return `${h.host}:${h.port}`;
}

// Only (re)connect when the discovered address differs from the one we already
// target. An unchanged address needs no action — the muter's own reconnect loop
// keeps retrying it. An empty discovered address is ignored.
export function shouldRetarget(currentTarget: string, discovered: string): boolean {
  return discovered !== '' && discovered !== currentTarget;
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/host-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Importer les helpers dans main.ts**

Dans `src/main.ts`, l'import de `./discovery` existe déjà (`advertiseHost, browseHosts, DiscoveredHost`). Ajouter :

```ts
import { hostAddr, shouldRetarget } from './host-discovery';
```

- [ ] **Step 6: Ajouter l'état et les fonctions de découverte**

Dans `src/main.ts`, à côté des autres variables de module (près de `let stopAdvertise` vers la ligne 71), ajouter :

```ts
let stopHostDiscovery: (() => void) | null = null;
```

Puis ajouter ces deux fonctions juste au-dessus de `function connectRemote()` (vers la ligne 317) :

```ts
// Controller-side continuous mDNS discovery: browse for a Hush host and dial its
// CURRENT address whenever it changes (DHCP move, host restart). There is only
// ever one host on the LAN, so we connect to whichever we find. The pairing code
// stays a one-time entry; the address is no longer something the user maintains.
function startHostDiscovery(): void {
  stopDiscovery();
  if (cfg.role !== 'controller') return;
  let currentTarget = cfg.remote.host ? hostAddr(cfg.remote) : '';
  stopHostDiscovery = browseHosts((h) => {
    const addr = hostAddr(h);
    if (!shouldRetarget(currentTarget, addr)) return;
    currentTarget = addr;
    dbg('discovery: host found — connecting', addr);
    cfg = { ...cfg, remote: { ...cfg.remote, host: h.host, port: h.port } };
    try { saveConfig(cfg); } catch { /* noop — remember the address best-effort */ }
    remote.connect(h.host, h.port, cfg.remote.pairingCode);
    win?.webContents.send('config-updated', cfg); // reflect the discovered IP in an open window
    pushStatus();
  });
}

function stopDiscovery(): void {
  if (stopHostDiscovery) { stopHostDiscovery(); stopHostDiscovery = null; }
}
```

- [ ] **Step 7: Faire piloter connectRemote par la découverte**

Dans `src/main.ts`, remplacer `connectRemote` (lignes 318-323) :

```ts
// Controller role: dial the last-known host immediately (fast path), then keep
// an mDNS browse running so we switch to the host's live address when it appears
// or moves. Idempotent — safe to call on resume and on every role transition.
function connectRemote(): void {
  remote.disconnect();
  stopDiscovery();
  if (cfg.role !== 'controller') return;
  // Fast path: try the last-known address right away so a reconnect after wake
  // doesn't wait a full mDNS round.
  if (cfg.remote.host) remote.connect(cfg.remote.host, cfg.remote.port, cfg.remote.pairingCode);
  startHostDiscovery(); // keep looking; retarget to the live address when found
  pushStatus();
}
```

- [ ] **Step 8: Arrêter la découverte quand on quitte le rôle controller et au cleanup**

Dans `src/main.ts`, dans `applyRoleTransition`, sous les deux lignes de teardown (`stopHost(); remote.disconnect();`, vers la ligne 439-440), ajouter :

```ts
  stopDiscovery();
```

Et dans `cleanup()` (lignes 424-429), ajouter `stopDiscovery();` :

```ts
function cleanup() {
  void orchestrator?.forceRelease();
  input?.stop();
  remote.disconnect();
  stopDiscovery();
  stopHost();
}
```

- [ ] **Step 9: Polish UI — libellé « recherche de l'hôte » (manuel)**

Dans `renderer/renderer.js`, le cas déconnecté sans erreur (ligne ~355) affiche « Hôte injoignable ». En rôle controller, la découverte tourne en continu, donc remplacer ce libellé par un état actif :

```js
      setRemote(r.error ? `Échec : ${r.error}` : 'Recherche de l’hôte…', 'pill pill-warn');
```

(Le `pill-warn` — orange — reflète « en cours / échec transitoire » plutôt qu'un « non connecté » définitif, puisque la découverte tourne en continu.)

- [ ] **Step 10: Vérifier typecheck + suite complète**

Run: `npm run typecheck && npm test`
Expected: OK, suite verte (dont `host-discovery.test.ts`).

- [ ] **Step 11: Commit**

```bash
git add src/host-discovery.ts src/main.ts renderer/renderer.js tests/host-discovery.test.ts
git commit -m "feat(remote): auto-connect to the host via continuous mDNS discovery"
```

---

## Vérification manuelle finale (les 3 machines réelles)

Après les 4 tâches, une passe manuelle sur le vrai matériel (impossible à couvrir en unit tests) :

1. **Auth Discord** : configurer Discord une fois (autoriser dans la popup), quitter et relancer l'app → reconnexion silencieuse, **aucune** popup. Sauvegarder un réglage quelconque puis relancer → toujours pas de popup.
2. **Auto-connexion** : PC hôte (Windows) et Mac controller lancés ; débrancher/rebrancher le Wi-Fi du Mac ou changer l'IP du PC → la connexion se rétablit seule sans ressaisir l'IP. Lancer le controller avant l'hôte → il se connecte dès que l'hôte apparaît.
3. **Lancement masqué** : activer « lancer au démarrage », redémarrer la session → Hush démarre dans la barre de menus **sans** ouvrir la fenêtre. Ouvrir l'app manuellement (clic) → la fenêtre s'affiche.
4. **Build packagé** : `npm run build` puis un `pack`/`dist` de vérification si possible, pour confirmer que le nettoyage n'a rien cassé.
