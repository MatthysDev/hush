// Hush experiment C — toggle Discord mute by pressing its button via the
// Accessibility API (AXUIElement), instead of sending a keystroke.
//
// Usage:
//   hush-ax           -> find + press the mute/unmute button
//   hush-ax --dump    -> list candidate buttons (labels) for debugging
// Requires Accessibility permission for THIS binary.

import Cocoa
import ApplicationServices

let dump = CommandLine.arguments.contains("--dump")

let trusted = AXIsProcessTrustedWithOptions(
  [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
if !trusted {
  print("AX: not trusted for Accessibility yet — grant 'hush-ax' in System Settings › Privacy › Accessibility, then retry.")
  exit(5)
}

// Discord stable bundle id (Canary/PTB differ); match by id or name.
let apps = NSWorkspace.shared.runningApplications
guard let discord = apps.first(where: {
  $0.bundleIdentifier == "com.hnc.Discord" || $0.localizedName == "Discord"
}) else {
  print("AX: Discord is not running.")
  exit(2)
}

let appEl = AXUIElementCreateApplication(discord.processIdentifier)

func str(_ el: AXUIElement, _ attr: String) -> String {
  var v: AnyObject?
  if AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success {
    return (v as? String) ?? ""
  }
  return ""
}
func children(_ el: AXUIElement) -> [AXUIElement] {
  var v: AnyObject?
  if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success {
    return (v as? [AXUIElement]) ?? []
  }
  return []
}

var candidates: [(el: AXUIElement, label: String)] = []
var visited = 0

func walk(_ el: AXUIElement, _ depth: Int) {
  if visited > 12000 || depth > 60 { return }
  visited += 1
  let role = str(el, kAXRoleAttribute as String)
  let label = (str(el, kAXTitleAttribute as String) + " " +
               str(el, kAXDescriptionAttribute as String)).trimmingCharacters(in: .whitespaces)
  let low = label.lowercased()
  if role == (kAXButtonRole as String) &&
     (low.contains("mute") || low.contains("micro") || low.contains("sourdine")) {
    candidates.append((el, label))
  }
  for c in children(el) { walk(c, depth + 1) }
}
walk(appEl, 0)

if dump {
  print("AX: \(candidates.count) mute-like button(s) among \(visited) elements:")
  for c in candidates { print("  • \(c.label)") }
  exit(0)
}

guard let target = candidates.first else {
  print("AX: no mute button found (scanned \(visited) elements). Try --dump, or open Discord's main window.")
  exit(4)
}

let r = AXUIElementPerformAction(target.el, kAXPressAction as CFString)
print("AX: pressed '\(target.label)' -> \(r == .success ? "ok" : "error \(r.rawValue)")")
exit(r == .success ? 0 : 3)
