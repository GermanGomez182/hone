// How Hone talks to each agent CLI: the command to run, how to read its
// streaming output, and how to explain a failure. Errors are returned as
// { key, args } so the panel can translate them.

var LABELS = { claude: "Claude Code", codex: "Codex" }
var LOGIN_COMMANDS = { claude: "claude auth login", codex: "codex login" }
var NO_DETAIL = "no output"
var FENCE = "```"

var AUTH_FAILURE = /not logged in|\/login|log in|unauthori[sz]ed|\b401\b|api key|authenticat|credential/i
var NETWORK_FAILURE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network is unreachable/i

// Returns { argv, stdin }. The user's text only ever travels on stdin, so it
// never shows up in the process list.
function command(provider, settings, prompt, workDir) {
  return provider === "claude" ? claudeCommand(settings, prompt) : codexCommand(settings, prompt, workDir)
}

function claudeCommand(settings, prompt) {
  var argv = [settings.binary, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
  if (settings.model) argv.push("--model", settings.model)
  argv.push("--system-prompt", prompt.system,
    "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence")
  return { argv: argv.concat(settings.extraArgs), stdin: prompt.user }
}

function codexCommand(settings, prompt, workDir) {
  var argv = [settings.binary, "exec", "--json", "--ephemeral", "--skip-git-repo-check",
    "--sandbox", "read-only", "--color", "never", "-C", workDir]
  if (settings.model) argv.push("-m", settings.model)
  return { argv: argv.concat(settings.extraArgs, ["-"]), stdin: prompt.system + "\n\n" + prompt.user }
}

// One line of CLI output to { type: "delta" | "final" | "error", ... }, or
// null for lines that carry nothing the panel shows.
function parseLine(provider, line) {
  var record
  try {
    record = JSON.parse(line)
  } catch (e) {
    return null
  }
  if (!record || typeof record !== "object") return null
  return provider === "claude" ? claudeEvent(record) : codexEvent(record)
}

function claudeEvent(record) {
  if (record.type === "stream_event" && record.event && record.event.type === "content_block_delta"
      && record.event.delta && record.event.delta.type === "text_delta")
    return { type: "delta", text: String(record.event.delta.text) }
  if (record.type !== "result") return null
  if (record.is_error) return { type: "error", detail: String(record.result || record.subtype || "") }
  return { type: "final", text: String(record.result || "") }
}

// Codex reports config warnings as "error" items; only a failed turn or a
// top-level error means the run failed.
function codexEvent(record) {
  if (record.type === "item.completed" && record.item && record.item.type === "agent_message")
    return { type: "final", text: String(record.item.text || "") }
  if (record.type === "turn.failed")
    return { type: "error", detail: String((record.error && record.error.message) || "") }
  if (record.type === "error") return { type: "error", detail: String(record.message || "") }
  return null
}

function cleanOutput(raw) {
  return stripWrapper(stripWrapper(String(raw).trim(), FENCE, FENCE, true), "<text>", "</text>", false)
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

function notInstalled(provider, binary) {
  return { key: "error.notInstalled", args: [LABELS[provider], binary] }
}

function failure(provider, detail) {
  var text = String(detail || "")
  if (AUTH_FAILURE.test(text)) return { key: "error.notSignedIn", args: [LABELS[provider], LOGIN_COMMANDS[provider]] }
  if (NETWORK_FAILURE.test(text)) return { key: "error.offline", args: [LABELS[provider]] }
  return { key: "error.failed", args: [LABELS[provider], firstLine(text) || NO_DETAIL] }
}

function firstLine(text) {
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++)
    if (lines[i].trim()) return lines[i].trim()
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    LABELS: LABELS,
    command: command,
    parseLine: parseLine,
    cleanOutput: cleanOutput,
    notInstalled: notInstalled,
    failure: failure
  }
}
