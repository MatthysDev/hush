// Hush experiment B — post a key combo at the HID event tap.
//
// nut-js posts synthetic keys at the *session* tap; Discord's keybind capture
// ignores those. `.cghidEventTap` injects lower in the stack, so the event looks
// like real hardware to apps that read closer to the driver. This helper taps a
// combo (modifiers + key) there.
//
// Usage: hush-hid "<modKeycodes csv>" "<keyKeycode|-1>"
// Requires Accessibility permission for THIS binary (posting events is gated).

import Cocoa

let args = CommandLine.arguments
let modArg = args.count > 1 ? args[1] : ""
let keyArg = args.count > 2 ? args[2] : "-1"

let mods: [Int] = modArg.isEmpty ? [] : modArg.split(separator: ",").compactMap { Int($0) }
let key = Int(keyArg) ?? -1

// Prompt for Accessibility on first run so posting actually reaches other apps.
let trusted = AXIsProcessTrustedWithOptions(
  [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
if !trusted {
  print("HID: not trusted for Accessibility yet — grant 'hush-hid' in System Settings › Privacy › Accessibility, then retry.")
}

let src = CGEventSource(stateID: .hidSystemState)

func flags(_ mods: [Int]) -> CGEventFlags {
  var f = CGEventFlags()
  for m in mods {
    switch m {
    case 55: f.insert(.maskCommand)
    case 56: f.insert(.maskShift)
    case 58: f.insert(.maskAlternate)
    case 59: f.insert(.maskControl)
    default: break
    }
  }
  return f
}

func post(_ keycode: Int, down: Bool, flags f: CGEventFlags) {
  guard let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(keycode), keyDown: down) else { return }
  e.flags = f
  e.post(tap: .cghidEventTap)
}

// Press modifiers (accumulating flags), tap the key, release modifiers.
var held: [Int] = []
for m in mods {
  held.append(m)
  post(m, down: true, flags: flags(held))
}
if key >= 0 {
  post(key, down: true, flags: flags(held))
  usleep(10_000)
  post(key, down: false, flags: flags(held))
}
for m in mods.reversed() {
  held.removeAll { $0 == m }
  post(m, down: false, flags: flags(held))
}

print("HID: tapped combo mods=\(mods) key=\(key) (trusted=\(trusted))")
exit(trusted ? 0 : 5)
