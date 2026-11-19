const test = require("node:test")
const assert = require("node:assert/strict")
const Paste = require("../../Paste.js")

const BROWSER = JSON.stringify({ address: "0x559119a27150", class: "brave-origin", tags: [] })
const TERMINAL = JSON.stringify({ address: "0x55911a2b3c40", class: "Alacritty", tags: ["terminal*", "transparent-window*"] })

test("the source window is read from hyprctl activewindow", () => {
  assert.deepEqual(Paste.sourceWindow(BROWSER), { address: "0x559119a27150", terminal: false })
})

test("a window tagged terminal is recognised as a terminal", () => {
  assert.deepEqual(Paste.sourceWindow(TERMINAL), { address: "0x55911a2b3c40", terminal: true })
})

test("no usable source window gives null", () => {
  assert.equal(Paste.sourceWindow("{}"), null)
  assert.equal(Paste.sourceWindow(""), null)
  assert.equal(Paste.sourceWindow("not json"), null)
})

test("an address that is not hex is rejected because it is spliced into a dispatch", () => {
  assert.equal(Paste.sourceWindow(JSON.stringify({ address: "0x1\" })", tags: [] })), null)
})

test("apps paste with Ctrl+V and terminals with Ctrl+Shift+V, like Omarchy's universal paste", () => {
  assert.equal(Paste.keyState({ address: "0xabc", terminal: false }, "down"),
    'hl.dsp.send_key_state({ mods = "CTRL", key = "V", state = "down", window = "address:0xabc" })')
  assert.equal(Paste.keyState({ address: "0xabc", terminal: true }, "up"),
    'hl.dsp.send_key_state({ mods = "CTRL SHIFT", key = "V", state = "up", window = "address:0xabc" })')
})
