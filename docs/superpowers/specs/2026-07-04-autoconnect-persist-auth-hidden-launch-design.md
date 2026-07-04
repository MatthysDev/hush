# Design — Auto-connexion LAN, auth Discord persistante, lancement masqué

Date : 2026-07-04
Branche : `contrib/sync-and-features`

## Contexte

Hush est un utilitaire menu-bar (Electron/TypeScript, `src/` → `dist/`) qui coupe
le micro Discord pendant la dictée Wispr Flow. Le travail récent a ajouté le mode
multi-machines (rôles `local` / `host` / `controller`), la synchro WebSocket
Mac↔Windows avec pairing code + heartbeat, une découverte mDNS/Bonjour, l'auth
Discord OAuth avec refresh token, et le lancement au démarrage.

Trois frictions subsistent à l'usage :

1. **La popup Discord « Autoriser Hush » réapparaît à chaque lancement.**
2. **La connexion Mac↔Windows est difficile à établir** ; elle finit par se faire
   « toute seule » en arrière-plan.
3. **La fenêtre de réglages s'ouvre à chaque démarrage**, alors qu'on veut un
   lancement discret en arrière-plan.

Plus deux artefacts à nettoyer : des `.js` compilés à la racine et un dépôt git
vide `Hush/` créés par erreur.

Bluetooth pour l'appairage : évoqué pour le futur, **hors scope** de cette spec.

---

## Feature 1 — Auth Discord persistante (bug fix)

### Cause racine

Le token OAuth (access + refresh + expiry) est correctement obtenu et persisté
côté `main.ts` (`doConnectDiscord`). Mais le renderer casse cette persistance :

- `renderer/renderer.js:110-113` — `syncRpcInputs()` reconstruit
  `cfg.discordRpc = { clientId, clientSecret }`, **sans** `accessToken`,
  `refreshToken`, `tokenExpiresAt`.
- Au prochain `config:set` / `saveConfig`, ce `discordRpc` sans tokens **écrase**
  celui sur disque. Le renderer détient de toute façon un `cfg` lu avant que les
  tokens n'existent, donc même sans `syncRpcInputs` un save réécrit une version
  périmée (read-modify-write qui clobber les tokens).

Résultat : au lancement suivant, `cfg.discordRpc` n'a plus de token → le chemin
d'`AUTHORIZE` complet est pris → popup à chaque fois.

### Approche retenue — garde côté `main` (source de vérité)

Les tokens sont gérés **exclusivement** par `main` ; le renderer ne devrait
jamais pouvoir les effacer. Dans le chemin de sauvegarde côté `main` :

- Lorsqu'un `config:set` (ou `saveConfig`) arrive, **fusionner** les tokens
  déjà connus (`accessToken`/`refreshToken`/`tokenExpiresAt`) dans le
  `discordRpc` entrant **tant que `clientId` et `clientSecret` sont inchangés**.
- Si `clientId` ou `clientSecret` changent (nouvelle app Discord), on **remet à
  zéro** les tokens (ils ne valent plus rien).

Cela rend la persistance robuste quel que soit ce que renvoie le renderer.

### Garde-fou secondaire — renderer

`syncRpcInputs()` préserve en mémoire les tokens du `cfg` courant au lieu de les
écraser, pour que le `cfg` renvoyé reste cohérent.

### Emplacement probable de la logique

Un point unique de fusion, appelé par `config:set` (et idéalement partagé avec
`saveConfig`) pour éviter la duplication. Décision précise laissée au plan.

### Tests

- Sauver une config sans tokens quand `main` en détient → les tokens survivent.
- Changer `clientId`/`clientSecret` → les tokens sont bien effacés.
- Cycle « autorise une fois → relance → reconnexion silencieuse » (pas d'appel
  `AUTHORIZE`).

---

## Feature 2 — Connexion auto entre les 2 machines

### Problème

En rôle `controller`, `connectRemote()` compose l'**IP fixe stockée**
(`cfg.remote.host:port`). Si l'IP change (DHCP) ou si l'hôte démarre après le
controller, la boucle de reconnexion du `RemoteDiscordMuter` (3 s) retente
indéfiniment la **même** adresse — d'où « ça finit par marcher » quand l'IP est
la bonne et que l'hôte finit par se lever, mais échec durable si l'IP a changé.

La découverte mDNS (`browseHosts`) existe déjà mais n'est utilisée que pour un
scan manuel de 2,5 s dans les réglages ; elle ne pilote pas la connexion.

### Topologie

Un **seul** hôte sur le LAN (le PC Windows). Pas de choix multi-hôtes à gérer.

### Approche retenue — la découverte mDNS pilote la connexion

En rôle `controller` :

1. Lancer une **découverte mDNS continue** (le `browseHosts` existant, gardé
   actif au lieu d'un scan ponctuel).
2. À chaque hôte Hush découvert : si on n'est pas connecté **ou** si l'adresse
   découverte diffère de la cible actuelle → appeler
   `remote.connect(host, port, code)` avec le **pairing code enregistré**
   (`cfg.remote.pairingCode`) et l'adresse/port **courants** de l'hôte.
3. Débounce léger pour éviter les reconnexions en rafale sur des annonces mDNS
   répétées.
4. Persister l'IP découverte dans `cfg.remote.host` (best-effort) pour garder une
   dernière-adresse-connue utilisable au prochain démarrage avant que mDNS ne
   réponde.

Comme il n'y a qu'un hôte, on se connecte au premier hôte trouvé — pas de
correspondance par nom.

### Fallback manuel (décision utilisateur : « Auto + secours manuel »)

- Le champ IP reste dans l'UI.
- Si `cfg.remote.host` est renseigné, le controller **compose immédiatement**
  cette adresse au démarrage (comportement actuel) pendant que la découverte
  tourne en parallèle et prend le relais dès qu'un hôte est vu.
- Si Bonjour est indisponible (multicast bloqué), on dégrade proprement sur l'IP
  manuelle — aucune régression.

### Cycle de vie

- La découverte démarre/s'arrête avec le rôle `controller` (dans
  `applyRoleTransition` / bring-up initial / `powerMonitor 'resume'`).
- Sur `resume` : relancer découverte + reconnexion (idempotent).
- Le pairing code reste une saisie **unique** ; l'adresse n'a plus à être saisie.

### UI

Changement léger : indiquer « recherche de l'hôte… / connecté à <nom> » dans la
carte Emplacement. Le champ IP devient optionnel (secours). Détail au plan.

### Tests

- Découverte renvoie un hôte → `remote.connect` appelé avec l'adresse découverte
  et le code enregistré.
- L'adresse change → reconnexion vers la nouvelle adresse.
- Bonjour indispo → dégrade sur l'IP manuelle, pas de crash.
- Sortie du rôle controller → découverte arrêtée.

---

## Feature 3 — Lancement au démarrage en arrière-plan (fenêtre masquée)

### Problème

`launchAtLogin: true` (défaut) + `openAsHidden` sont déjà appliqués, mais
`main.ts:537` appelle `showWindow()` **inconditionnellement** à chaque lancement
— donc l'auto-lancement ouvre quand même la fenêtre de réglages.

### Approche retenue

N'ouvrir la fenêtre au démarrage **que si** :

- l'app **n'a pas** été lancée par l'ouverture de session, **ou**
- la config est **incomplète** (première installation / setup non terminé).

Sinon → rester en tray uniquement.

Détection « lancé à l'ouverture de session » :

- **macOS** : `app.getLoginItemSettings().wasOpenedAtLogin`.
- **Windows** : `openAsHidden` est ignoré → passer `args: ['--hidden']` dans
  `app.setLoginItemSettings(...)` et tester `process.argv.includes('--hidden')`.

Détection « setup complet » (pour ne pas cacher la fenêtre à un utilisateur qui
n'a rien configuré) : par rôle —
`local`/`host` → `clientId` + `clientSecret` présents ;
`controller` → pairing code présent. Critère exact précisé au plan.

### Tests

- Lancé à l'ouverture de session + setup complet → pas de fenêtre.
- Lancé à l'ouverture de session + setup incomplet → fenêtre affichée.
- Lancement manuel (clic sur l'app) → fenêtre affichée.
- `setLoginItemSettings` reçoit bien `args: ['--hidden']` sur Windows.

---

## Feature 4 — Nettoyage du dépôt

- Supprimer les `.js` parasites à la racine (`discovery.js`, `mute-client.js`,
  `mute-protocol.js`, `mute-server.js`, `mute-transport.js`) : ce sont des sorties
  de compilation TypeScript qui ont fuité hors de `dist/`.
- Supprimer le dossier `Hush/` (dépôt git vide, `README.md` de 7 octets, créé par
  erreur).
- Vérifier la config de build (`tsconfig.json`, scripts) pour s'assurer que la
  compilation ne dépose pas de `.js` à la racine, et/ou ajouter au `.gitignore` un
  garde-fou. But : que ces artefacts ne reviennent pas.

---

## Hors scope

- Appairage Bluetooth (idée future).
- Refonte du store des tokens dans une clé séparée (amélioration possible plus
  tard ; la fusion côté `main` suffit ici).
- Sélection multi-hôtes (un seul hôte sur le LAN).

## Ordre de mise en œuvre suggéré

1. Nettoyage (rapide, dégage le terrain).
2. Auth persistante (bug le plus visible, peu de code).
3. Lancement masqué (petit, isolé).
4. Auto-connexion mDNS (le plus gros morceau).
