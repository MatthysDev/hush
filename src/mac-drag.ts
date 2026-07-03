// Helpers for the "drag Hush into the macOS Privacy list" affordance. macOS
// System Settings accepts an app dropped onto its Accessibility / Input
// Monitoring lists; Electron can start a native file drag of the app bundle.
// These two helpers are pure so they can be unit-tested without Electron.

// Resolve the enclosing macOS .app bundle from the running executable path.
//   /Applications/Hush.app/Contents/MacOS/Hush  ->  /Applications/Hush.app
// Returns null when the exe isn't inside a .app (e.g. a non-macOS binary).
export function appBundlePath(exePath: string): string | null {
  const marker = '.app/Contents/MacOS/';
  const idx = exePath.indexOf(marker);
  if (idx === -1) return null;
  return exePath.slice(0, idx + '.app'.length);
}

// Whether to offer the drag affordance: macOS only, and only for a packaged
// app — dragging the dev-mode Electron.app into the list would grant the wrong
// entry. When false, the UI falls back to the "Open" buttons.
export function canDragPermissions(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  bundle: string | null,
): boolean {
  return platform === 'darwin' && isPackaged && bundle !== null;
}
