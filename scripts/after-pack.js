// electron-builder afterPack hook (macOS only).
//
// Re-sign the packaged app ad-hoc with its real bundle identifier so macOS
// identifies it as `com.hush.app` instead of the generic linker-signed
// "Electron". This gives the app a stable, self-consistent code identity, which
// is what macOS keys the Local Network privacy grant on. Still ad-hoc — no paid
// Developer ID, no notarization — matching the project's free/unsigned stance.
//
// Runs after electron-builder has finished packing the .app, before the DMG is
// assembled. No-op on Windows/Linux.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // Seal the whole bundle ad-hoc under the app's own identifier. The nested
  // Electron helpers keep their existing (linker-signed) signatures; re-sealing
  // the outer bundle is enough to satisfy the Designated Requirement.
  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--identifier', 'com.hush.app', appPath],
    { stdio: 'inherit' },
  );
  console.log(`[after-pack] ad-hoc signed ${appName} as com.hush.app`);
};
