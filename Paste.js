// Pasting the result back into the window the text came from. The window is
// recorded when the panel opens (the overlay never becomes the active
// window), and the paste is sent to it the way Omarchy's universal paste
// does: Ctrl+V for apps, Ctrl+Shift+V for windows tagged as terminals.

var ADDRESS = /^0x[0-9a-fA-F]+$/
var TERMINAL_TAG = "terminal"

// `hyprctl activewindow -j` output to { address, terminal }, or null.
function sourceWindow(json) {
  var window
  try {
    window = JSON.parse(String(json))
  } catch (e) {
    return null
  }
  if (!window || !ADDRESS.test(String(window.address || ""))) return null
  return { address: window.address, terminal: hasTerminalTag(window.tags) }
}

// Dynamic Hyprland tags carry a trailing "*".
function hasTerminalTag(tags) {
  if (!Array.isArray(tags)) return false
  return tags.some(function(tag) { return String(tag).replace(/\*$/, "") === TERMINAL_TAG })
}

// The Hyprland dispatch that presses ("down") or releases ("up") the paste
// chord in the source window.
function keyState(source, state) {
  var mods = source.terminal ? "CTRL SHIFT" : "CTRL"
  return 'hl.dsp.send_key_state({ mods = "' + mods + '", key = "V", state = "' + state
    + '", window = "address:' + source.address + '" })'
}

if (typeof module !== "undefined") {
  module.exports = {
    sourceWindow: sourceWindow,
    keyState: keyState
  }
}
