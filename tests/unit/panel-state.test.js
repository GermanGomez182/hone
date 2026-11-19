const test = require("node:test")
const assert = require("node:assert/strict")
const PanelState = require("../../PanelState.js")

function idle(input) {
  return PanelState.opened(PanelState.initial("claude", "auto"), input === undefined ? "teh text" : input).state
}

function running(input) {
  return PanelState.submit(idle(input)).state
}

function done(result) {
  const state = running()
  return PanelState.finished(state, state.runId, { text: result || "The text." }).state
}

function failed() {
  const state = running()
  return PanelState.finished(state, state.runId, { error: { key: "error.failed", args: ["Codex", "boom"] } }).state
}

test("opening resets the panel and prefills the input", () => {
  const { state, effect } = PanelState.opened(done(), "fresh text")
  assert.equal(state.status, "idle")
  assert.equal(state.input, "fresh text")
  assert.equal(state.instruction, "")
  assert.equal(state.result, "")
  assert.equal(effect, null)
})

test("opening keeps the chosen action, language and provider", () => {
  let state = PanelState.setAction(idle(), 2).state
  state = PanelState.setLanguage(state, "Spanish").state
  state = PanelState.setProvider(state, "codex").state
  const reopened = PanelState.opened(state, "").state
  assert.deepEqual([reopened.actionIndex, reopened.language, reopened.provider], [2, "Spanish", "codex"])
})

test("submitting starts a run with everything the backend needs", () => {
  let state = PanelState.editInstruction(idle("hola"), "shorter").state
  state = PanelState.setAction(state, 1).state
  const { state: next, effect } = PanelState.submit(state)
  assert.equal(next.status, "running")
  assert.deepEqual(effect, {
    type: "run",
    runId: next.runId,
    job: { provider: "claude", actionIndex: 1, language: "auto", input: "hola", instruction: "shorter" }
  })
})

test("every run gets a new id", () => {
  const first = running()
  const second = PanelState.submit(PanelState.escape(first).state).state
  assert.notEqual(first.runId, second.runId)
})

test("submitting blank input fails without starting", () => {
  const { state, effect } = PanelState.submit(idle(" \n"))
  assert.equal(effect, null)
  assert.equal(state.status, "failed")
  assert.deepEqual(state.error, { key: "error.emptyInput", args: [] })
})

test("submitting while running does nothing", () => {
  const state = running()
  assert.deepEqual(PanelState.submit(state), { state, effect: null })
})

test("streamed text accumulates while running", () => {
  let state = running()
  state = PanelState.delta(state, state.runId, "Hel").state
  state = PanelState.delta(state, state.runId, "lo").state
  assert.equal(state.partial, "Hello")
})

test("text from an abandoned run is ignored", () => {
  const state = running()
  assert.equal(PanelState.delta(state, state.runId - 1, "late").state.partial, "")
  assert.equal(PanelState.finished(state, state.runId - 1, { text: "late" }).state.status, "running")
})

test("a finished run shows the cleaned result", () => {
  const state = running()
  const next = PanelState.finished(state, state.runId, { text: "```\nThe text.\n```" }).state
  assert.equal(next.status, "done")
  assert.equal(next.result, "The text.")
})

test("a finished run with no usable text fails", () => {
  const state = running()
  const next = PanelState.finished(state, state.runId, { text: "  " }).state
  assert.equal(next.status, "failed")
  assert.deepEqual(next.error, { key: "error.emptyResponse", args: [] })
})

test("a failed run shows its error", () => {
  assert.deepEqual(failed().error, { key: "error.failed", args: ["Codex", "boom"] })
})

test("accepting a finished result with paste-back closes and pastes it over the source", () => {
  assert.deepEqual(PanelState.submit(done("Done."), true).effect, { type: "copy", text: "Done.", close: true, paste: true })
})

test("accepting a finished result without paste-back copies it and closes", () => {
  assert.deepEqual(PanelState.submit(done("Done."), false).effect, { type: "copy", text: "Done.", close: true, paste: false })
})

test("copy only copies, using the closeOnCopy setting", () => {
  assert.deepEqual(PanelState.copy(done("Done."), false).effect, { type: "copy", text: "Done.", close: false, paste: false })
  assert.deepEqual(PanelState.copy(done("Done."), true).effect, { type: "copy", text: "Done.", close: true, paste: false })
})

test("auto prefill prefers the selection", () => {
  assert.equal(PanelState.prefillText("auto", "selected", "copied"), "selected")
})

test("auto prefill falls back to the clipboard when nothing is selected", () => {
  assert.equal(PanelState.prefillText("auto", " \n", "copied"), "copied")
  assert.equal(PanelState.prefillText("auto", "", ""), "")
})

test("prefill can be pinned to one source or turned off", () => {
  assert.equal(PanelState.prefillText("selection", "", "copied"), "")
  assert.equal(PanelState.prefillText("clipboard", "selected", "copied"), "copied")
  assert.equal(PanelState.prefillText("none", "selected", "copied"), "")
})

test("there is nothing to copy before a result", () => {
  assert.equal(PanelState.copy(idle(), false).effect, null)
  assert.equal(PanelState.copy(running(), false).effect, null)
})

test("retry runs the same input again after a result or a failure", () => {
  assert.equal(PanelState.retry(done()).effect.type, "run")
  assert.equal(PanelState.retry(failed()).effect.type, "run")
})

test("retry does nothing while idle or running", () => {
  assert.equal(PanelState.retry(idle()).effect, null)
  assert.equal(PanelState.retry(running()).effect, null)
})

test("use as input moves the result into the input for another pass", () => {
  const { state } = PanelState.useAsInput(done("Better text."))
  assert.equal(state.input, "Better text.")
  assert.equal(state.status, "idle")
  assert.equal(state.result, "")
})

test("use as input does nothing without a result", () => {
  const state = idle()
  assert.deepEqual(PanelState.useAsInput(state), { state, effect: null })
})

test("escape while running cancels the run and keeps the panel open", () => {
  const { state, effect } = PanelState.escape(running())
  assert.equal(state.status, "idle")
  assert.equal(state.partial, "")
  assert.deepEqual(effect, { type: "cancel" })
})

test("escape when not running closes the panel", () => {
  assert.deepEqual(PanelState.escape(idle()).effect, { type: "close" })
  assert.deepEqual(PanelState.escape(done()).effect, { type: "close" })
})

test("editing the input discards a stale result or error", () => {
  assert.equal(PanelState.editInput(done(), "changed").state.status, "idle")
  assert.equal(PanelState.editInput(failed(), "changed").state.status, "idle")
})

test("editing the instruction discards a stale result", () => {
  const { state } = PanelState.editInstruction(done(), "more formal")
  assert.equal(state.instruction, "more formal")
  assert.equal(state.status, "idle")
})

test("edits are ignored while running", () => {
  const state = running()
  assert.deepEqual(PanelState.editInput(state, "x"), { state, effect: null })
  assert.deepEqual(PanelState.editInstruction(state, "x"), { state, effect: null })
})

test("changing action, language or provider discards a stale result", () => {
  assert.equal(PanelState.setAction(done(), 1).state.status, "idle")
  assert.equal(PanelState.setLanguage(done(), "English").state.status, "idle")
  assert.equal(PanelState.setProvider(done(), "codex").state.status, "idle")
})

test("reselecting the current choice keeps the result", () => {
  assert.equal(PanelState.setAction(done(), 0).state.status, "done")
  assert.equal(PanelState.setProvider(done(), "claude").state.status, "done")
})

test("choices cannot change while running", () => {
  const state = running()
  assert.equal(PanelState.setAction(state, 3).state.actionIndex, 0)
  assert.equal(PanelState.setLanguage(state, "Spanish").state.language, "auto")
  assert.equal(PanelState.setProvider(state, "codex").state.provider, "claude")
})

test("choosing a provider asks for it to be remembered", () => {
  assert.deepEqual(PanelState.setProvider(idle(), "codex").effect, { type: "rememberProvider", provider: "codex" })
  assert.equal(PanelState.setProvider(idle(), "claude").effect, null)
})

test("cycling wraps around the list", () => {
  assert.equal(PanelState.cycled(["auto", "English", "Spanish"], "Spanish"), "auto")
  assert.equal(PanelState.cycled(["auto", "English", "Spanish"], "auto"), "English")
  assert.equal(PanelState.cycled(["claude", "codex"], "unknown"), "claude")
})

test("transitions never mutate the previous state", () => {
  const state = idle()
  const snapshot = JSON.stringify(state)
  PanelState.submit(state)
  PanelState.editInput(state, "x")
  PanelState.setAction(state, 2)
  assert.equal(JSON.stringify(state), snapshot)
})

test("output cleanup trims and strips a wrapping code fence", () => {
  assert.equal(PanelState.cleanOutput("  hi.\n"), "hi.")
  assert.equal(PanelState.cleanOutput("```text\nhi.\n```"), "hi.")
  assert.equal(PanelState.cleanOutput("line one\n\nline two"), "line one\n\nline two")
})

test("output cleanup strips text tags echoed back by the model", () => {
  assert.equal(PanelState.cleanOutput("<text>\nhi.\n</text>"), "hi.")
})

test("empty output cleans to an empty string", () => {
  assert.equal(PanelState.cleanOutput(" \n"), "")
  assert.equal(PanelState.cleanOutput("```\n```"), "")
})
