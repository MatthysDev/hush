# Homebrew cask for Hush.
#
# This file is the source of truth; publish it in a tap repo named
# `MatthysDev/homebrew-hush` (path `Casks/hush.rb`) so users can run:
#
#   brew install --cask matthysdev/hush/hush
#
# After each release (`git tag vX.Y.Z && git push --tags` → the Release workflow
# builds the DMG), update `version` and `sha256` below to the values the workflow
# prints, then push this file to the tap.

cask "hush" do
  version "0.1.0"
  sha256 :no_check # replace with the release DMG's shasum -a 256 for pinned installs

  url "https://github.com/MatthysDev/hush/releases/download/v#{version}/Hush-#{version}-arm64.dmg"
  name "Hush"
  desc "Mute Discord over RPC while you dictate with Wispr Flow"
  homepage "https://github.com/MatthysDev/hush"

  depends_on macos: ">= :monterey"

  app "Hush.app"

  # Hush is not notarized (free & open-source), so Gatekeeper would block the
  # first launch. Clear the quarantine flag on install so it opens normally.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Hush.app"],
                   sudo: false
  end

  uninstall quit: "com.hush.app"

  zap trash: [
    "~/Library/Application Support/hush",
    "~/Library/Logs/Hush",
    "~/Library/Preferences/com.hush.app.plist",
    "~/Library/Saved Application State/com.hush.app.savedState",
  ]
end
