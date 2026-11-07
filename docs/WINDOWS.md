# Hush on Windows

Hush runs on Windows from the same codebase as macOS. This page covers what is
platform-specific and how to build and verify the Windows installer.

## What's shared

- **Electron**, **`uiohook-napi`** (global keyboard listener, no permission
  needed on Windows) and **`discord-rpc`** (Discord's local IPC socket) behave the
  same on both platforms.
- **The whole core** (`orchestrator.ts`, `gesture.ts`, `discord-mute.ts`,
  `input-engine.ts`, `config.ts`, `store.ts`, the LAN link) has no macOS APIs.
- **Auto mode** (hold = push-to-talk, double-tap = hands-free, tap = stop) works
  identically, since it only depends on press/release events.

## What differs on Windows

| Area | macOS | Windows |
| ---- | ----- | ------- |
| Default shortcut | `⌃⌥` | `Ctrl + Win` (Wispr Flow's Windows default) |
| Shortcut labels | Glyphs (`⌃⌥⌘⇧`) | Spelled out (`Ctrl + Alt + Win + Shift`); the Win key is stored as the `cmd` modifier |
| Fn / Globe key | Polled via CoreGraphics | Not applicable (no-op) |
| Permissions | Input Monitoring + Accessibility (TCC) | None; the Permissions card and onboarding step are hidden |
| Tray icon | Template image (auto-tinted by the menu bar) | Template recolored at runtime: white/dark to match the taskbar theme (read from the registry), mint while Discord is muted |
| App menu | Custom macOS menu (Edit roles enable ⌘C/⌘V) | Removed from the settings window; clipboard shortcuts work natively |
| Debug log | `~/Library/Logs/Hush/hush-debug.log` | `%APPDATA%\Hush\logs\hush-debug.log` |
| Launch at login | Login Items | `HKCU\...\Run` entry with `--hidden` (registered by the installed app only, never by dev runs) |

Enable debug logging with `HUSH_DEBUG=1` or by creating an empty `.hush-debug`
file in your home folder.

## Build

```bash
# on Windows (or the windows-latest leg of .github/workflows/release.yml):
npm ci
npm run dist:win     # → release/Hush-Setup.exe
```

Native deps need their Windows prebuilds, so build on Windows; don't
cross-compile from macOS.

**Local build fails with "Cannot create symbolic link : A required privilege is
not held by the client"?** electron-builder unpacks its `winCodeSign` tool bundle,
which contains macOS symlinks that Windows can only create with Developer Mode on
or from an admin shell. Either enable Developer Mode, or pre-extract the bundle
without the macOS part (from the repo root):

```bash
cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
"$OLDPWD/node_modules/7zip-bin/win/x64/7za.exe" x -bd <the-downloaded>.7z -owinCodeSign-2.6.0 '-xr!darwin'
```

GitHub's `windows-latest` runners don't hit this.

The installer is unsigned: SmartScreen warns once ("More info → Run anyway")
unless you sign it with an Authenticode certificate.

## Verify on real hardware

1. Install, confirm the tray icon appears (it may land in the `^` overflow) and
   the settings window opens.
2. Connect Discord (Client ID/Secret + `http://localhost` redirect, same as macOS).
   Use the official Discord desktop app; third-party clients like Vesktop don't
   expose the RPC socket.
3. With the debug log on, check each gesture against Wispr Flow:
   - hold → muted while held;
   - double-tap → stays muted after release (`gesture: double-tap → hands-free on`);
   - single tap → unmuted (`gesture: tap → hands-free off`).
