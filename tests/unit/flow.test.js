const test = require("node:test")
const assert = require("node:assert/strict")
const Flow = require("../../Flow.js")

function idle(input) {
  return Flow.opened(Flow.initial("claude", "auto"), input === undefined ? "teh text" : input).state
}

function running(input) {
  return Flow.submit(idle(input)).state
}

function done(result) {
  const state = running()
  return Flow.finished(state, state.runId, { text: result || "The text." }).state
}

function failed() {
  const state = running()
  return Flow.finished(state, state.runId, { error: { key: "error.failed", args: ["Codex", "boom"] } }).state
}

test("opening resets the panel and prefills the input", () => {
  const { state, effect } = Flow.opened(done(), "fresh text")
  assert.equal(state.status, "idle")
  assert.equal(state.input, "fresh text")
  assert.equal(state.instruction, "")
  assert.equal(state.result, "")
  assert.equal(effect, null)
})

test("opening keeps the chosen action, language and provider", () => {
  let state = Flow.setAction(idle(), 2).state
  state = Flow.setLanguage(state, "Spanish").state
  state = Flow.setProvider(state, "codex").state
  const reopened = Flow.opened(state, "").state
  assert.deepEqual([reopened.actionIndex, reopened.language, reopened.provider], [2, "Spanish", "codex"])
})

test("submitting starts a run with everything the backend needs", () => {
  let state = Flow.editInstruction(idle("hola"), "shorter").state
  state = Flow.setAction(state, 1).state
  const { state: next, effect } = Flow.submit(state)
  assert.equal(next.status, "running")
  assert.deepEqual(effect, {
    type: "run",
    runId: next.runId,
    job: { provider: "claude", actionIndex: 1, language: "auto", input: "hola", instruction: "shorter" }
  })
})

test("every run gets a new id", () => {
  const first = running()
  const second = Flow.submit(Flow.escape(first).state).state
  assert.notEqual(first.runId, second.runId)
})

test("submitting blank input fails without starting", () => {
  const { state, effect } = Flow.submit(idle(" \n"))
  assert.equal(effect, null)
  assert.equal(state.status, "failed")
  assert.deepEqual(state.error, { key: "error.emptyInput", args: [] })
})

test("submitting while running does nothing", () => {
  const state = running()
  assert.deepEqual(Flow.submit(state), { state, effect: null })
})

test("streamed text accumulates while running", () => {
  let state = running()
  state = Flow.delta(state, state.runId, "Hel").state
  state = Flow.delta(state, state.runId, "lo").state
  assert.equal(state.partial, "Hello")
})

test("text from an abandoned run is ignored", () => {
  const state = running()
  assert.equal(Flow.delta(state, state.runId - 1, "late").state.partial, "")
  assert.equal(Flow.finished(state, state.runId - 1, { text: "late" }).state.status, "running")
})

test("a finished run shows the cleaned result", () => {
  const state = running()
  const next = Flow.finished(state, state.runId, { text: "```\nThe text.\n```" }).state
  assert.equal(next.status, "done")
  assert.equal(next.result, "The text.")
})

test("a finished run with no usable text fails", () => {
  const state = running()
  const next = Flow.finished(state, state.runId, { text: "  " }).state
  assert.equal(next.status, "failed")
  assert.deepEqual(next.error, { key: "error.emptyResponse", args: [] })
})

test("a failed run shows its error", () => {
  assert.deepEqual(failed().error, { key: "error.failed", args: ["Codex", "boom"] })
})

test("submitting a finished result copies it and closes", () => {
  assert.deepEqual(Flow.submit(done("Done.")).effect, { type: "copy", text: "Done.", close: true })
})

test("copy uses the closeOnCopy setting", () => {
  assert.deepEqual(Flow.copy(done("Done."), false).effect, { type: "copy", text: "Done.", close: false })
  assert.deepEqual(Flow.copy(done("Done."), true).effect, { type: "copy", text: "Done.", close: true })
})

test("there is nothing to copy before a result", () => {
  assert.equal(Flow.copy(idle(), false).effect, null)
  assert.equal(Flow.copy(running(), false).effect, null)
})

test("retry runs the same input again after a result or a failure", () => {
  assert.equal(Flow.retry(done()).effect.type, "run")
  assert.equal(Flow.retry(failed()).effect.type, "run")
})

test("retry does nothing while idle or running", () => {
  assert.equal(Flow.retry(idle()).effect, null)
  assert.equal(Flow.retry(running()).effect, null)
})

test("use as input moves the result into the input for another pass", () => {
  const { state } = Flow.useAsInput(done("Better text."))
  assert.equal(state.input, "Better text.")
  assert.equal(state.status, "idle")
  assert.equal(state.result, "")
})

test("use as input does nothing without a result", () => {
  const state = idle()
  assert.deepEqual(Flow.useAsInput(state), { state, effect: null })
})

test("escape while running cancels the run and keeps the panel open", () => {
  const { state, effect } = Flow.escape(running())
  assert.equal(state.status, "idle")
  assert.equal(state.partial, "")
  assert.deepEqual(effect, { type: "cancel" })
})

test("escape when not running closes the panel", () => {
  assert.deepEqual(Flow.escape(idle()).effect, { type: "close" })
  assert.deepEqual(Flow.escape(done()).effect, { type: "close" })
})

test("editing the input discards a stale result or error", () => {
  assert.equal(Flow.editInput(done(), "changed").state.status, "idle")
  assert.equal(Flow.editInput(failed(), "changed").state.status, "idle")
})

test("editing the instruction discards a stale result", () => {
  const { state } = Flow.editInstruction(done(), "more formal")
  assert.equal(state.instruction, "more formal")
  assert.equal(state.status, "idle")
})

test("edits are ignored while running", () => {
  const state = running()
  assert.deepEqual(Flow.editInput(state, "x"), { state, effect: null })
  assert.deepEqual(Flow.editInstruction(state, "x"), { state, effect: null })
})

test("changing action, language or provider discards a stale result", () => {
  assert.equal(Flow.setAction(done(), 1).state.status, "idle")
  assert.equal(Flow.setLanguage(done(), "English").state.status, "idle")
  assert.equal(Flow.setProvider(done(), "codex").state.status, "idle")
})

test("reselecting the current choice keeps the result", () => {
  assert.equal(Flow.setAction(done(), 0).state.status, "done")
  assert.equal(Flow.setProvider(done(), "claude").state.status, "done")
})

test("choices cannot change while running", () => {
  const state = running()
  assert.equal(Flow.setAction(state, 3).state.actionIndex, 0)
  assert.equal(Flow.setLanguage(state, "Spanish").state.language, "auto")
  assert.equal(Flow.setProvider(state, "codex").state.provider, "claude")
})

test("choosing a provider asks for it to be remembered", () => {
  assert.deepEqual(Flow.setProvider(idle(), "codex").effect, { type: "rememberProvider", provider: "codex" })
  assert.equal(Flow.setProvider(idle(), "claude").effect, null)
})

test("cycling wraps around the list", () => {
  assert.equal(Flow.cycled(["auto", "English", "Spanish"], "Spanish"), "auto")
  assert.equal(Flow.cycled(["auto", "English", "Spanish"], "auto"), "English")
  assert.equal(Flow.cycled(["claude", "codex"], "unknown"), "claude")
})

test("transitions never mutate the previous state", () => {
  const state = idle()
  const snapshot = JSON.stringify(state)
  Flow.submit(state)
  Flow.editInput(state, "x")
  Flow.setAction(state, 2)
  assert.equal(JSON.stringify(state), snapshot)
})

test("output cleanup trims and strips a wrapping code fence", () => {
  assert.equal(Flow.cleanOutput("  hi.\n"), "hi.")
  assert.equal(Flow.cleanOutput("```text\nhi.\n```"), "hi.")
  assert.equal(Flow.cleanOutput("line one\n\nline two"), "line one\n\nline two")
})

test("output cleanup strips text tags echoed back by the model", () => {
  assert.equal(Flow.cleanOutput("<text>\nhi.\n</text>"), "hi.")
})

test("empty output cleans to an empty string", () => {
  assert.equal(Flow.cleanOutput(" \n"), "")
  assert.equal(Flow.cleanOutput("```\n```"), "")
})
