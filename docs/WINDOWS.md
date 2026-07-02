# Porting Hush to Windows

Hush is macOS-only today, but most of the hard parts are already
cross-platform. This is the concrete checklist to finish a Windows build.

## What already works on Windows (no change)

- **Electron** — same runtime on both platforms.
- **`uiohook-napi`** — global keyboard listener; ships prebuilt Windows binaries
  and needs **no special permission** on Windows (unlike macOS TCC).
- **`discord-rpc`** — the Discord RPC/IPC socket works identically on Windows.
- **The whole core**: `orchestrator.ts`, `discord-mute.ts`, `input-engine.ts`,
  `combo.ts`, `config.ts`, `store.ts` — pure logic, no macOS APIs. These run as-is.
- **A Windows `.ico`** is already generated (`assets/icon.ico`, via `gen-icons.sh`)
  and wired into `package.json` → `build.win`.

## What must change

### 1. Permissions (`src/main.ts`)
Windows has **no** Accessibility / Input Monitoring TCC prompts — global hooks
just work. The macOS-only code is already guarded (`process.platform === 'darwin'`
around the prompts, and `permStatus()` returns `{accessibility:true,
inputMonitoring:true}` off-darwin), so nothing crashes. Two cleanups:
- Hide the **Permissions** card in the settings window on Windows (it's
  irrelevant). Gate it on a `platform` value exposed through the preload bridge.
- The `perm:open-accessibility` / `perm:open-input` IPC handlers open
  `x-apple.systempreferences:` URLs — no-ops on Windows, but the buttons should be
  hidden anyway per the point above.

### 2. `node-mac-permissions` (`src/main.ts`)
The `require('@nut-tree-fork/node-mac-permissions')` is already wrapped in
try/catch and falls back to `null` on Windows — safe. It's a macOS-only native
module; keep it out of the Windows bundle via electron-builder's `files`/`asar`
handling (it simply won't load).

### 3. Menu-bar / tray (`src/main.ts`)
- `Tray` works on Windows, but `img.setTemplateImage(true)` is macOS-only styling.
  On Windows, use a normal colored icon (e.g. `assets/icon.ico` or a small PNG),
  not the monochrome `*Template.png` masks.
- `app.dock?.hide()` is macOS-only; `?.` already makes it a no-op on Windows.
- `LSUIElement` (hide from Dock) is macOS-only; on Windows there is no Dock, so a
  tray-only app is the default — nothing to do, but note it launches with no
  window by design.

### 4. Autostart (optional, nice-to-have)
macOS uses Login Items; Windows uses `app.setLoginItemSettings({ openAtLogin })`
which works on both — add a toggle if you want launch-on-boot.

### 5. Packaging (`package.json`)
- `build.win` is already set (`nsis` target, `assets/icon.ico`,
  `Hush-${version}-Setup.exe`). Build with `npm run dist:win`.
- **You must build on Windows** (or CI with a Windows runner) — the `uiohook-napi`
  and any native deps need the Windows prebuilds; you can't cross-compile the
  installer from macOS reliably.
- Add a Windows job to `.github/workflows/release.yml` (a `runs-on:
  windows-latest` matrix leg) to produce the `.exe` alongside the macOS `.dmg`.
- Code signing: Windows SmartScreen will warn on an unsigned `.exe`, same story as
  macOS notarization. Ship unsigned (users click "More info → Run anyway") or buy
  an Authenticode cert.

## Build & test

```bash
# on a Windows machine (or windows-latest CI):
npm ci
npm run dist:win     # → release/Hush-0.1.0-Setup.exe
```

Then verify on real Windows hardware:
1. Install, confirm the tray icon appears and the settings window opens.
2. Set a shortcut, hold it, confirm the Discord mic mutes and unmutes.
3. Confirm the Discord RPC connects (Client ID/Secret + `http://localhost`
   redirect — same setup as macOS).

## Not portable

- **Wispr Flow** must exist on the target OS for the bridge to be useful. If Wispr
  isn't available on Windows, Hush still mutes Discord for any push-to-talk
  shortcut, but there's no dictation app to pair with.
