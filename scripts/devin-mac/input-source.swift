// Enable and select a macOS input source by ID (default: Japanese Romaji typing).
// Lists the Kotoeri (Japanese) source IDs when the requested one is not installed.
// usage: input-source [SOURCE_ID]
import Carbon
import Foundation

func sourceID(_ s: TISInputSource) -> String {
    guard let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID) else { return "?" }
    return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
}

func find(_ id: String) -> TISInputSource? {
    let props = [kTISPropertyInputSourceID as String: id] as CFDictionary
    return (TISCreateInputSourceList(props, true)?.takeRetainedValue() as? [TISInputSource])?.first
}

let want = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese"
// The Japanese modes belong to the Kotoeri input method; enable it too or the mode cannot be selected.
if want.hasPrefix("com.apple.inputmethod.Kotoeri.RomajiTyping"),
    let parent = find("com.apple.inputmethod.Kotoeri.RomajiTyping")
{
    TISEnableInputSource(parent)
}
guard let source = find(want) else {
    print("not found: \(want)")
    let all = (TISCreateInputSourceList(nil, true)?.takeRetainedValue() as? [TISInputSource]) ?? []
    for s in all where sourceID(s).contains("Kotoeri") { print("  \(sourceID(s))") }
    exit(1)
}
TISEnableInputSource(source)
let status = TISSelectInputSource(source)
let current = TISCopyCurrentKeyboardInputSource().map { sourceID($0.takeRetainedValue()) } ?? "?"
print("current: \(current)")
if status != noErr || current != want {
    print("could not select \(want) (status \(status)); pick a keyboard mode ID, not its parent input method")
    exit(1)
}
