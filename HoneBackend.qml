import QtQuick
import Quickshell
import Quickshell.Io
import "Providers.js" as Providers

// Runs one agent CLI at a time and turns its output into delta/finished
// signals. A run requested while a cancelled one is still exiting waits for
// it, because a Process cannot be restarted until it has stopped.
Item {
  id: backend

  // outcomeJson encodes { text } or { error: { key, args } }. It travels as a
  // string because objects crossing a QML signal turn arrays into array-like
  // maps. Cancelled runs emit nothing.
  signal delta(int runId, string text)
  signal finished(int runId, string outcomeJson)

  readonly property bool busy: process.running
  // A directory without project files, so the agent picks up no repo context.
  readonly property string workDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"

  property var active: null
  property var queued: null

  function run(runId, provider, settings, prompt, timeoutSeconds) {
    var request = {
      runId: runId,
      provider: provider,
      binary: settings.binary,
      command: Providers.command(provider, settings, prompt, backend.workDir),
      timeoutSeconds: timeoutSeconds
    }
    if (process.running) {
      backend.cancel()
      backend.queued = request
      return
    }
    backend.start(request)
  }

  // Cancels the active run and any run waiting behind it.
  function cancel() {
    backend.queued = null
    timeout.stop()
    if (!backend.active || !process.running) return
    backend.active.cancelled = true
    process.signal(15)
  }

  function start(request) {
    backend.active = {
      runId: request.runId,
      provider: request.provider,
      binary: request.binary,
      stdin: request.command.stdin,
      timeoutSeconds: request.timeoutSeconds,
      started: false,
      cancelled: false,
      timedOut: false,
      finalText: null,
      errorDetail: null,
      stderr: ""
    }
    console.info("hone: run " + request.runId + " started provider=" + request.provider
      + " chars=" + request.command.stdin.length)
    process.command = request.command.argv
    process.stdinEnabled = true
    process.running = true
    timeout.interval = request.timeoutSeconds * 1000
    timeout.start()
  }

  function handleLine(line) {
    var run = backend.active
    if (!run || run.cancelled) return
    var event = Providers.parseLine(run.provider, line)
    if (!event) return
    if (event.type === "delta") backend.delta(run.runId, event.text)
    else if (event.type === "final") run.finalText = event.text
    else if (event.type === "error") run.errorDetail = event.detail
  }

  function report(exitCode) {
    timeout.stop()
    var run = backend.active
    backend.active = null
    if (run) backend.finish(run, exitCode)
    if (backend.queued) {
      var next = backend.queued
      backend.queued = null
      backend.start(next)
    }
  }

  function finish(run, exitCode) {
    if (run.cancelled && !run.timedOut) {
      console.info("hone: run " + run.runId + " cancelled")
      return
    }
    var outcome = backend.outcomeOf(run, exitCode)
    if (outcome.error) console.warn("hone: run " + run.runId + " failed: " + outcome.error.key + " " + JSON.stringify(outcome.error.args))
    else console.info("hone: run " + run.runId + " finished")
    backend.finished(run.runId, JSON.stringify(outcome))
  }

  function outcomeOf(run, exitCode) {
    if (!run.started) return { error: Providers.notInstalled(run.provider, run.binary) }
    if (run.timedOut) return { error: { key: "error.timedOut", args: [run.timeoutSeconds] } }
    if (run.errorDetail !== null) return { error: Providers.failure(run.provider, run.errorDetail) }
    if (exitCode !== 0 || run.finalText === null) return { error: Providers.failure(run.provider, run.stderr) }
    return { text: run.finalText }
  }

  Timer {
    id: timeout
    onTriggered: {
      if (!backend.active || !process.running) return
      backend.active.timedOut = true
      backend.active.cancelled = true
      process.signal(15)
    }
  }

  Process {
    id: process
    workingDirectory: backend.workDir
    stdout: SplitParser { onRead: function(line) { backend.handleLine(line) } }
    stderr: SplitParser {
      onRead: function(line) { if (backend.active) backend.active.stderr += line + "\n" }
    }
    onStarted: {
      backend.active.started = true
      process.write(backend.active.stdin)
      process.stdinEnabled = false
    }
    onExited: function(exitCode) { backend.report(exitCode) }
    // A binary that cannot be found never starts and never exits.
    onRunningChanged: if (!running && backend.active && !backend.active.started) backend.report(-1)
  }
}
