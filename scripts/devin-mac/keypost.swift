// Physical key input on the macOS VM through the HID event tap, so it goes through the input method
// (the VNC server's Return did not commit IME text). Needs Accessibility permission for the ssh process;
// when missing it asks macOS to show the permission prompt and exits 1.
// usage: keypost TOKEN...   letters/digits/"-" are typed key by key; ":space" ":return" ":escape" ":delete"
//        ":tab" ":left" ":right" ":up" ":down" ":eisu" ":kana" are single keys. 0.5 s pause after each token.
import ApplicationServices
import Foundation

let letters: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38,
    "k": 40, "n": 45, "m": 46,
]
let named: [String: CGKeyCode] = [
    "space": 49, "return": 36, "escape": 53, "delete": 51, "tab": 48,
    "left": 123, "right": 124, "down": 125, "up": 126, "eisu": 102, "kana": 104,
]

let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
guard AXIsProcessTrustedWithOptions(prompt) else {
    print("not trusted: allow \"sshd-keygen-wrapper\" in System Settings > Privacy & Security > Accessibility")
    exit(1)
}

func press(_ code: CGKeyCode) {
    for down in [true, false] {
        CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
}

for token in CommandLine.arguments.dropFirst() {
    if token.hasPrefix(":") {
        guard let code = named[String(token.dropFirst())] else { print("unknown key \(token)"); exit(2) }
        press(code)
    } else {
        for ch in token.lowercased() {
            guard let code = letters[ch] else { print("unsupported character \(ch)"); exit(2) }
            press(code)
        }
    }
    usleep(500_000)
}
