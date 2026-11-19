// The panel's state machine. Every transition takes the current state and
// returns { state, effect }: a new state (the old one is never mutated) and
// at most one side effect for the QML shell to perform:
//   { type: "run", runId, job }     start the agent CLI
//   { type: "cancel" }              stop the running CLI
//   { type: "copy", text, close }   put text on the clipboard
//   { type: "close" }               hide the panel
//   { type: "rememberProvider", provider }

var FENCE = "```"

function initial(provider, language) {
  return {
    status: "idle",
    input: "",
    instruction: "",
    actionIndex: 0,
    language: language,
    provider: provider,
    partial: "",
    result: "",
    error: null,
    runId: 0
  }
}

function opened(state, clipboardText) {
  return unchanged(update(state, {
    status: "idle", input: String(clipboardText || ""), instruction: "", partial: "", result: "", error: null
  }))
}

function editInput(state, text) {
  if (state.status === "running") return unchanged(state)
  return unchanged(invalidated(update(state, { input: text })))
}

function editInstruction(state, text) {
  if (state.status === "running") return unchanged(state)
  return unchanged(invalidated(update(state, { instruction: text })))
}

function setAction(state, index) {
  return choose(state, "actionIndex", index, null)
}

function setLanguage(state, language) {
  return choose(state, "language", language, null)
}

function setProvider(state, provider) {
  return choose(state, "provider", provider, { type: "rememberProvider", provider: provider })
}

function choose(state, field, value, effect) {
  if (state.status === "running" || state[field] === value) return unchanged(state)
  var changes = {}
  changes[field] = value
  return { state: invalidated(update(state, changes)), effect: effect }
}

function submit(state) {
  if (state.status === "running") return unchanged(state)
  if (state.status === "done") return { state: state, effect: { type: "copy", text: state.result, close: true } }
  return start(state)
}

function copy(state, closeOnCopy) {
  if (state.status !== "done") return unchanged(state)
  return { state: state, effect: { type: "copy", text: state.result, close: closeOnCopy } }
}

function retry(state) {
  if (state.status !== "done" && state.status !== "failed") return unchanged(state)
  return start(state)
}

function useAsInput(state) {
  if (state.status !== "done") return unchanged(state)
  return unchanged(update(state, { input: state.result, result: "", status: "idle" }))
}

function escape(state) {
  if (state.status === "running") return { state: update(state, { status: "idle", partial: "" }), effect: { type: "cancel" } }
  return { state: state, effect: { type: "close" } }
}

function delta(state, runId, text) {
  if (!isCurrentRun(state, runId)) return unchanged(state)
  return unchanged(update(state, { partial: state.partial + text }))
}

// outcome is { text } on success or { error: { key, args } } on failure.
function finished(state, runId, outcome) {
  if (!isCurrentRun(state, runId)) return unchanged(state)
  if (outcome.error) return unchanged(update(state, { status: "failed", error: outcome.error, partial: "" }))
  var text = cleanOutput(outcome.text)
  if (!text) return unchanged(update(state, { status: "failed", error: problem("error.emptyResponse"), partial: "" }))
  return unchanged(update(state, { status: "done", result: text, partial: "" }))
}

function cycled(values, current) {
  var index = values.indexOf(current)
  return values[(index + 1) % values.length]
}

// Model output to the text the user will paste: trimmed, without a wrapping
// code fence or echoed <text> tags. "" means nothing usable came back.
function cleanOutput(raw) {
  return stripWrapper(stripWrapper(String(raw || "").trim(), FENCE, FENCE, true), "<text>", "</text>", false)
}

function stripWrapper(text, open, close, dropFirstLine) {
  if (text.indexOf(open) !== 0 || text.length < open.length + close.length
      || text.lastIndexOf(close) !== text.length - close.length) return text
  var inner = text.slice(open.length, text.length - close.length)
  if (dropFirstLine) {
    var newline = inner.indexOf("\n")
    inner = newline < 0 ? inner : inner.slice(newline + 1)
  }
  return inner.trim()
}

function start(state) {
  if (!state.input.trim()) return unchanged(update(state, { status: "failed", error: problem("error.emptyInput") }))
  var next = update(state, { status: "running", runId: state.runId + 1, partial: "", result: "", error: null })
  return {
    state: next,
    effect: {
      type: "run",
      runId: next.runId,
      job: {
        provider: next.provider,
        actionIndex: next.actionIndex,
        language: next.language,
        input: next.input,
        instruction: next.instruction
      }
    }
  }
}

function isCurrentRun(state, runId) {
  return state.status === "running" && state.runId === runId
}

function invalidated(state) {
  if (state.status !== "done" && state.status !== "failed") return state
  return update(state, { status: "idle", result: "", error: null })
}

function update(state, changes) {
  var next = {}
  for (var key in state) next[key] = state[key]
  for (var change in changes) next[change] = changes[change]
  return next
}

function unchanged(state) {
  return { state: state, effect: null }
}

function problem(key) {
  return { key: key, args: [] }
}

if (typeof module !== "undefined") {
  module.exports = {
    initial: initial,
    opened: opened,
    editInput: editInput,
    editInstruction: editInstruction,
    setAction: setAction,
    setLanguage: setLanguage,
    setProvider: setProvider,
    submit: submit,
    copy: copy,
    retry: retry,
    useAsInput: useAsInput,
    escape: escape,
    delta: delta,
    finished: finished,
    cycled: cycled,
    cleanOutput: cleanOutput
  }
}
