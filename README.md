# Hush

> Push-to-talk bridge for macOS — mute Discord while you dictate with Wispr Flow.

Hush is a tiny menu-bar (tray) Electron app. Hold one key and it **mutes Discord**
and **starts Wispr Flow dictation** in a single gesture; release it and it **stops
dictation** and **unmutes Discord**. No more broadcasting your dictation to a whole
Discord call.

- **Modes** — `hold` (push-to-talk) or `toggle`.
- **Fully configurable hotkeys** — trigger, Discord mute combo, Wispr combo, all
  captured live from a settings window and checked for conflicts.
- **Menu-bar only** — no dock icon (`LSUIElement`), a tray icon that flips between
  a *safe* (muted) and *live* (mic open) state.

## Why it's trickier than it looks

Hush synthesizes global hotkeys with `@nut-tree-fork/nut-js` and listens to the
keyboard globally with `uiohook-napi`. Those two facts fight each other, and most
of the code is about winning that fight cleanly:

- **Self-observation loop** (`synth-guard.ts`) — uIOhook sees the very keys nut-js
  injects. A modifier-only trigger would read its own synthetic Discord combo as
  "the trigger changed" and flap mute on/off forever. `SynthGuard` marks the
  injection window (with a grace period for delivery lag) so self-generated events
  are dropped.
- **Modifier leakage** (`orchestrator.ts` → `maskTriggerMods`) — a trigger with
  modifiers is physically held while we inject, so those modifiers leak into every
  synthesized chord (Discord sees `⌃⌥⇧⌘X` instead of `⌘⌥X` and never matches).
  Synth-releasing the trigger modifiers first neutralizes them at the OS level.
- **Hotkey coalescing** (`muteDictateGapMs`) — firing two global shortcuts in the
  same instant lets the OS coalesce them and drop one. Hush sequences them with a
  small gap so both land.

## Architecture

```
src/
├── main.ts          # Electron entry: tray, settings window, IPC, permissions, wiring
├── orchestrator.ts  # The state machine: press/release → mute + dictate / stop + unmute
├── input-engine.ts  # uiohook-napi global keyboard listener → trigger detection
├── synth-engine.ts  # nut-js keystroke synthesis (tap / hold down / hold up)
├── synth-guard.ts   # Drops self-generated key events (breaks the observation loop)
├── synth-map.ts     # Combo → nut-js Key mapping
├── combo.ts         # Combo normalization, equality, distinctness, display labels
├── config.ts        # Defaults + validation
├── store.ts         # Persisted config (electron-store)
├── brand.ts         # Name, taglines, color palette
├── debug.ts         # Opt-in debug logging
├── preload.ts       # contextBridge IPC surface for the settings window
└── types.ts         # Shared types (Combo, Mode, HushConfig, engine interfaces)

renderer/            # Settings window (plain HTML/CSS/JS)
tests/               # vitest unit tests (orchestrator, synth, combo, config)
assets/              # Tray icons (template PNGs + SVGs)
```

The core logic is fully unit-tested against fake engines — the `Orchestrator`,
`SynthGuard`, `synth-map` and combo/config helpers all have deterministic tests
(no OS, no real keyboard).

## Develop

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm start           # build + launch Electron
npm run dist        # build a signed-less .dmg (electron-builder)
```

macOS grants are required at first launch: **Accessibility** and **Input
Monitoring** (the settings window links straight to the right System Settings
panes).

## Config

Defaults live in `src/config.ts` and are persisted via `electron-store`:

| Setting            | Default        | Meaning                                   |
| ------------------ | -------------- | ----------------------------------------- |
| `trigger`          | `F13`          | The push-to-talk / toggle key             |
| `discordCombo`     | `⌃⌥⌘1`         | Discord's "toggle mute" shortcut          |
| `wisprCombo`       | `⌃⌥⌘2`         | Wispr Flow's dictation shortcut           |
| `mode`             | `hold`         | `hold` (push-to-talk) or `toggle`         |
| `muteDictateGapMs` | `25`           | Gap between muting Discord and dictating  |
| `unmuteDelayMs`    | `0`            | Delay before unmuting on release          |

## License

MIT © Matthys Ducrocq
