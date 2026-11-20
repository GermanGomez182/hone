import QtQuick
import Quickshell.Io
import "Paste.js" as Paste

// Pastes the result into the window the text came from, the way Omarchy's
// universal paste does: press, then release, the paste chord in that window.
// The overlay holds the keyboard exclusively until it is unmapped, so the
// press waits until the panel is hidden and focus has had time to return.
// The window is fixed when the paste is scheduled, so a later opening of the
// panel can never redirect it.
Item {
  id: paster

  property bool panelVisible: false
  property string hyprctl: "hyprctl"
  // Long enough for Hyprland to hand focus back to the window the text came from.
  readonly property int focusReturnMs: 150
  // Gap between pressing and releasing the paste chord, as Omarchy uses.
  readonly property int keyReleaseMs: 50

  property var target: null
  property bool waitingForHide: false

  function schedule(window) {
    paster.cancel()
    if (!window) {
      console.warn("hone: no source window was recorded; the result is only on the clipboard")
      return
    }
    paster.target = window
    if (paster.panelVisible) paster.waitingForHide = true
    else focusDelay.start()
  }

  // Drops a paste whose chord has not been pressed yet. A press already sent
  // is always released, so no key is left held down.
  function cancel() {
    paster.waitingForHide = false
    focusDelay.stop()
  }

  onPanelVisibleChanged: {
    if (paster.panelVisible || !paster.waitingForHide) return
    paster.waitingForHide = false
    focusDelay.start()
  }

  Timer {
    id: focusDelay
    interval: paster.focusReturnMs
    onTriggered: {
      keyPress.window = paster.target
      keyPress.command = [paster.hyprctl, "dispatch", Paste.keyState(keyPress.window, "down")]
      keyPress.running = true
    }
  }

  Process {
    id: keyPress
    property var window: null
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        console.warn("hone: paste-back failed: hyprctl exited with " + exitCode)
        return
      }
      keyRelease.window = keyPress.window
      releaseDelay.start()
    }
  }

  Timer {
    id: releaseDelay
    interval: paster.keyReleaseMs
    onTriggered: {
      keyRelease.command = [paster.hyprctl, "dispatch", Paste.keyState(keyRelease.window, "up")]
      keyRelease.running = true
    }
  }

  Process {
    id: keyRelease
    property var window: null
    onExited: function(exitCode) {
      if (exitCode !== 0) console.warn("hone: paste-back release failed: hyprctl exited with " + exitCode)
      else console.info("hone: pasted the result back into " + (keyRelease.window.terminal ? "a terminal" : "an app"))
    }
  }
}
