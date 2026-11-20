import QtQuick
import Quickshell
import Quickshell.Io
import "plugin"

// Drives the real HoneBackend and PasteBack components against fake CLIs and
// prints one PASS/FAIL line per case. Run through tests/integration/run.
ShellRoot {
  id: harness

  readonly property string fakes: Quickshell.env("HONE_FAKES")
  readonly property var prompt: ({ system: "SYS", user: "hello" })
  property var cases: []
  property int current: -1
  property var events: []

  function settings(binary) {
    return { binary: binary, model: "", extraArgs: [] }
  }

  readonly property var appWindow: ({ address: "0xa1", terminal: false })
  readonly property var terminalWindow: ({ address: "0xb2", terminal: true })

  function pastes() {
    return pasteLog.text().split("\n").filter(function(line) { return line !== "" })
  }

  function dispatch(window, state) {
    var mods = window.terminal ? "CTRL SHIFT" : "CTRL"
    return 'dispatch hl.dsp.send_key_state({ mods = "' + mods + '", key = "V", state = "' + state
      + '", window = "address:' + window.address + '" })'
  }

  function onlyFinished(runId) {
    var found = events.filter(function(e) { return e.kind === "finished" && e.runId === runId })
    return found.length === 1 ? found[0].outcome : null
  }

  // Objects that cross a QML signal come back with their keys sorted, so
  // compare with sorted keys rather than insertion order.
  function canonical(value) {
    return JSON.stringify(value, function(key, v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return v
      var sorted = {}
      Object.keys(v).sort().forEach(function(k) { sorted[k] = v[k] })
      return sorted
    })
  }

  function expectEqual(actual, expected) {
    var a = canonical(actual), b = canonical(expected)
    return a === b ? "" : "expected " + b + " got " + a
  }

  Component.onCompleted: {
    cases = [
      {
        name: "claude streams a delta and finishes with the result read from stdin",
        start: function() { backend.run(1, "claude", settings(fakes + "/claude-ok"), prompt, 5) },
        wait: 3000,
        check: function() {
          var deltas = events.filter(function(e) { return e.kind === "delta" }).map(function(e) { return e.text })
          return expectEqual(deltas, ["got:hello"]) || expectEqual(onlyFinished(1), { text: "got:hello" })
        }
      },
      {
        name: "codex finishes with the agent message and ignores warning items",
        start: function() { backend.run(2, "codex", settings(fakes + "/codex-ok"), prompt, 5) },
        wait: 3000,
        check: function() { return expectEqual(onlyFinished(2), { text: "codex says hi" }) }
      },
      {
        name: "a signed-out CLI reports the login command",
        start: function() { backend.run(3, "claude", settings(fakes + "/claude-signed-out"), prompt, 5) },
        wait: 3000,
        check: function() {
          return expectEqual(onlyFinished(3), { error: { key: "error.notSignedIn", args: ["Claude Code", "claude auth login"] } })
        }
      },
      {
        name: "a missing binary is reported as not installed",
        start: function() { backend.run(4, "codex", settings("hone-missing-binary"), prompt, 5) },
        wait: 2000,
        check: function() {
          return expectEqual(onlyFinished(4), { error: { key: "error.notInstalled", args: ["Codex", "hone-missing-binary"] } })
        }
      },
      {
        name: "a run that outlives the timeout is stopped and reported",
        start: function() { backend.run(5, "claude", settings(fakes + "/slow"), prompt, 1) },
        wait: 3000,
        check: function() {
          return expectEqual(onlyFinished(5), { error: { key: "error.timedOut", args: [1] } }) || (backend.busy ? "still running" : "")
        }
      },
      {
        name: "a cancelled run stops without reporting anything",
        start: function() {
          backend.run(6, "claude", settings(fakes + "/slow"), prompt, 30)
          cancelTimer.start()
        },
        wait: 2000,
        check: function() {
          return expectEqual(events.length, 0) || (backend.busy ? "still running" : "")
        }
      },
      {
        name: "a run started while a cancelled one is exiting still runs",
        start: function() {
          backend.run(7, "claude", settings(fakes + "/slow"), prompt, 30)
          backend.cancel()
          backend.run(8, "claude", settings(fakes + "/claude-ok"), prompt, 5)
        },
        wait: 3000,
        check: function() {
          return expectEqual(onlyFinished(7), null) || expectEqual(onlyFinished(8), { text: "got:hello" })
        }
      },
      {
        name: "cancelling while a run is queued drops the queued run too",
        start: function() {
          backend.run(9, "claude", settings(fakes + "/slow"), prompt, 30)
          backend.run(10, "claude", settings(fakes + "/claude-ok"), prompt, 5)
          backend.cancel()
        },
        wait: 3000,
        check: function() {
          return expectEqual(events.length, 0) || (backend.busy ? "still running" : "")
        }
      },
      {
        name: "a paste waits for the panel to hide, then presses and releases in the window it was scheduled for",
        start: function() {
          paster.panelVisible = true
          paster.schedule(appWindow)
          hideTimer.start()
        },
        wait: 1500,
        check: function() {
          return expectEqual(pastes(), [dispatch(appWindow, "down"), dispatch(appWindow, "up")])
        }
      },
      {
        name: "a paste scheduled while hidden goes out after the focus delay",
        start: function() {
          paster.panelVisible = false
          paster.schedule(terminalWindow)
        },
        wait: 1000,
        check: function() {
          return expectEqual(pastes(), [dispatch(terminalWindow, "down"), dispatch(terminalWindow, "up")])
        }
      },
      {
        name: "reopening the panel before a pending paste is sent drops it",
        start: function() {
          paster.panelVisible = true
          paster.schedule(appWindow)
          paster.panelVisible = false
          paster.cancel()
          paster.panelVisible = true
          paster.panelVisible = false
        },
        wait: 1000,
        check: function() { return expectEqual(pastes(), []) }
      },
      {
        name: "a paste with no recorded window sends nothing",
        start: function() {
          paster.panelVisible = false
          paster.schedule(null)
        },
        wait: 1000,
        check: function() { return expectEqual(pastes(), []) }
      }
    ]
    next()
  }

  function next() {
    current += 1
    if (current >= cases.length) {
      console.log("HONE-TEST DONE")
      Qt.quit()
      return
    }
    events = []
    pasteLog.setText("")
    cases[current].start()
    caseTimer.interval = cases[current].wait
    caseTimer.start()
  }

  Timer {
    id: caseTimer
    onTriggered: {
      var problem = harness.cases[harness.current].check()
      console.log((problem ? "HONE-TEST FAIL " : "HONE-TEST PASS ") + harness.cases[harness.current].name + (problem ? ": " + problem : ""))
      harness.next()
    }
  }

  Timer {
    id: cancelTimer
    interval: 200
    onTriggered: backend.cancel()
  }

  Timer {
    id: hideTimer
    interval: 400
    onTriggered: paster.panelVisible = false
  }

  FileView {
    id: pasteLog
    path: Quickshell.env("HONE_PASTE_LOG")
    blockLoading: true
    blockWrites: true
    watchChanges: true
    onFileChanged: reload()
  }

  PasteBack {
    id: paster
    hyprctl: harness.fakes + "/hyprctl"
  }

  HoneBackend {
    id: backend
    onDelta: function(runId, text) { harness.events = harness.events.concat([{ kind: "delta", runId: runId, text: text }]) }
    onFinished: function(runId, outcomeJson) {
      harness.events = harness.events.concat([{ kind: "finished", runId: runId, outcome: JSON.parse(outcomeJson) }])
    }
  }
}
