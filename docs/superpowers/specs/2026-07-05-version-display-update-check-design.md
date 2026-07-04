# Design — Affichage de la version + détection de mise à jour

Date : 2026-07-05
Branche : `contrib/sync-and-features`

## Contexte

Hush est un utilitaire menu-bar (Electron/TypeScript, `src/` → `dist/`). Sa version
est timbrée depuis le tag git au moment du build (workflow `release.yml`), et
distribuée en **DMG macOS non signé** + **installeur Windows NSIS non signé** via
les **GitHub Releases de `MatthysDev/hush`** (l'upstream, d'où l'utilisateur
installe réellement). L'app ne montre nulle part sa version, et rien ne signale
qu'une nouvelle est sortie — l'app installée devient périmée sans que l'utilisateur
le sache.

## Objectif

1. Afficher la version courante dans l'UI.
2. Détecter automatiquement qu'une version plus récente existe et proposer de la
   télécharger en un clic (ouverture de la page de release).

## Contrainte déterminante (pourquoi « détecter + télécharger », pas auto-install)

La mise à jour automatique en place sur macOS (Squirrel.Mac) **exige une app
signée**. Or le build macOS est volontairement **non signé** (`identity: null`,
gratuit/open-source). Une vraie auto-MàJ en un clic sur macOS est donc impossible
sans certificat Apple Developer payant + notarisation. Windows (NSIS) pourrait
s'auto-mettre à jour sans signature, mais on retient une approche **symétrique et
sans coût** : détecter + notifier + ouvrir la page de téléchargement. L'auto-install
et la signature/notarisation sont **hors scope**.

## Architecture

### Module pur `src/update-check.ts`

Sans dépendance Electron ni réseau (fetch injecté), testable comme
`discord-oauth.ts`.

- `compareVersions(a: string, b: string): -1 | 0 | 1`
  Compare deux versions semver (`MAJOR.MINOR.PATCH`). Tolère le préfixe `v`
  (`v0.2.0`). Comparaison **numérique** composant par composant (pas
  lexicographique — `0.10.0` > `0.9.0`). Un composant manquant/non numérique vaut
  0. Un éventuel suffixe pré-release (`-beta`) est ignoré pour la comparaison de
  cœur (la source `/releases/latest` n'expose de toute façon pas les pré-releases).

- `parseLatestRelease(json: unknown): { version: string; url: string } | null`
  Extrait `tag_name` → `version` et `html_url` → `url` de la réponse de l'API
  GitHub. Renvoie `null` si le JSON est absent/malformé ou s'il manque un champ.

- `checkForUpdate(fetchImpl, currentVersion: string): Promise<{ version: string; url: string } | null>`
  Fait `GET https://api.github.com/repos/MatthysDev/hush/releases/latest` (headers
  `Accept: application/vnd.github+json` et `User-Agent: Hush`), parse via
  `parseLatestRelease`, et renvoie `{ version, url }` **uniquement si**
  `compareVersions(latest, currentVersion) === 1` (release strictement plus
  récente). Sinon `null`. **Best-effort total** : toute erreur (hors ligne, quota
  HTTP 403, statut non-OK, JSON cassé) est avalée → `null`. Ne throw jamais.

Constantes : `RELEASES_API_URL` (l'URL upstream ci-dessus).

### Câblage `src/main.ts`

- Au `whenReady`, puis via un `setInterval` de **24 h** (l'app tourne en continu),
  appeler `checkForUpdate(fetch, app.getVersion())`. Stocker le résultat dans une
  variable de module `latestUpdate: { version, url } | null`.
- Pousser `latestUpdate` au renderer dans le payload de `pushStatus()` (nouveau
  champ `update`), et l'inclure dans le menu de la barre système : quand une MàJ
  existe, un item **« Nouvelle version X.Y.Z — Télécharger »** qui fait
  `shell.openExternal(url)` (déjà la mécanique utilisée pour le portail Discord).
- `checkForUpdate` est best-effort : un échec ne bloque ni le lancement ni rien.
- Nettoyer l'intervalle dans `cleanup()`.

### UI renderer (`renderer/renderer.js` + `index.html` + `style.css`)

- **Ligne de version** en pied de la fenêtre de réglages : « Hush X.Y.Z »,
  obtenue via un IPC one-shot `app:version` (handler renvoyant `app.getVersion()`).
  Toujours visible.
- **Bandeau de mise à jour** : quand `status.update` est non nul, afficher un
  bandeau « Nouvelle version X.Y.Z disponible » + bouton **« Télécharger »** qui
  appelle l'IPC existant `app:open-external` avec l'URL. Masqué sinon.

## Flux de données

`app.getVersion()` → `checkForUpdate` (main, au boot + toutes les 24 h) →
`latestUpdate` → `pushStatus()` → renderer (bandeau + bouton) et menu barre
système (item Télécharger) → clic → `shell.openExternal(url)` ouvre la page de
release GitHub.

## Gestion d'erreur

- Réseau indisponible / quota API / statut non-OK / JSON malformé → `checkForUpdate`
  renvoie `null`, aucun bandeau, aucun item de menu, aucune erreur remontée.
- Version de l'app plus récente que la dernière release (build de dev) →
  `compareVersions` renvoie ≤ 0 → pas de MàJ affichée.
- `/releases/latest` exclut déjà brouillons et pré-releases → seules les versions
  stables sont proposées.

## Tests

Fonctions pures dans `tests/update-check.test.ts` :
- `compareVersions` : égalité ; diff patch / mineur / majeur ; préfixe `v` des deux
  côtés ; ordre numérique (`0.10.0` > `0.9.0`) ; composant manquant.
- `parseLatestRelease` : JSON valide → `{version, url}` ; champ manquant → `null` ;
  entrée non-objet → `null`.
- `checkForUpdate` (fetch factice injecté) : release plus récente → `{version,url}` ;
  release égale/plus ancienne → `null` ; `fetch` qui rejette → `null` ; statut
  HTTP non-OK → `null` ; JSON malformé → `null`.

Le câblage `main.ts` et l'UI sont vérifiés manuellement (Electron/DOM non chargés
en test), cohérent avec le reste du projet.

## Hors scope

- Téléchargement + installation automatiques (bloqués par l'app non signée sur
  macOS ; décision « niveau 1 »).
- Signature / notarisation macOS, `electron-updater`, artefacts `latest.yml`.
- Téléchargement direct de l'asset correspondant à la plateforme (on ouvre la page
  de release ; l'utilisateur choisit .dmg/.exe et débloque Gatekeeper/SmartScreen
  une fois).

## Ordre de mise en œuvre suggéré

1. Module pur `update-check.ts` + tests.
2. Câblage `main.ts` (check au boot + 24 h, champ `status.update`, item barre
   système, IPC version).
3. UI renderer (ligne de version + bandeau + bouton).
