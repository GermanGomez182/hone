const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Providers = require("../../Providers.js")
const Config = require("../../Config.js")

const PROMPT = { system: "SYSTEM", user: "<text>\nhi\n</text>" }
const WORK_DIR = "/run/user/1000"

function fixtureLines(name) {
  return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8").split("\n").filter(Boolean)
}

function eventsFrom(provider, lines) {
  return lines.map((line) => Providers.parseLine(provider, line)).filter(Boolean)
}

function providerConfig(provider, overrides) {
  return Object.assign(Config.defaultConfig().providers[provider], overrides)
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag)
  return index < 0 ? undefined : argv[index + 1]
}

test("claude runs in print mode with streaming JSON and the system prompt", () => {
  const { argv } = Providers.command("claude", providerConfig("claude"), PROMPT, WORK_DIR)
  assert.equal(argv[0], "claude")
  assert.ok(argv.includes("-p"))
  assert.equal(valueAfter(argv, "--output-format"), "stream-json")
  assert.ok(argv.includes("--include-partial-messages"))
  assert.equal(valueAfter(argv, "--system-prompt"), "SYSTEM")
  assert.equal(valueAfter(argv, "--model"), "haiku")
})

test("claude runs without tools, MCP servers, user settings or saved sessions", () => {
  const { argv } = Providers.command("claude", providerConfig("claude"), PROMPT, WORK_DIR)
  assert.equal(valueAfter(argv, "--tools"), "")
  assert.equal(valueAfter(argv, "--setting-sources"), "")
  assert.ok(argv.includes("--strict-mcp-config"))
  assert.ok(argv.includes("--no-session-persistence"))
})

test("claude receives only the fenced user text on stdin", () => {
  const { stdin, argv } = Providers.command("claude", providerConfig("claude"), PROMPT, WORK_DIR)
  assert.equal(stdin, PROMPT.user)
  assert.ok(!argv.includes(PROMPT.user))
})

test("an empty model leaves the choice to the CLI", () => {
  const { argv } = Providers.command("claude", providerConfig("claude", { model: "" }), PROMPT, WORK_DIR)
  assert.ok(!argv.includes("--model"))
})

test("codex runs a read-only, ephemeral exec in the work directory", () => {
  const { argv } = Providers.command("codex", providerConfig("codex"), PROMPT, WORK_DIR)
  assert.deepEqual(argv.slice(0, 3), ["codex", "exec", "--json"])
  assert.equal(valueAfter(argv, "--sandbox"), "read-only")
  assert.equal(valueAfter(argv, "-C"), WORK_DIR)
  assert.ok(argv.includes("--ephemeral"))
  assert.ok(argv.includes("--skip-git-repo-check"))
  assert.equal(argv[argv.length - 1], "-")
})

test("codex has no system prompt flag, so it gets system and text together on stdin", () => {
  const { stdin } = Providers.command("codex", providerConfig("codex"), PROMPT, WORK_DIR)
  assert.equal(stdin, "SYSTEM\n\n" + PROMPT.user)
})

test("extra arguments come before the stdin marker", () => {
  const { argv } = Providers.command("codex", providerConfig("codex", { extraArgs: ["-c", "x=1"], model: "o9" }), PROMPT, WORK_DIR)
  assert.deepEqual(argv.slice(-5), ["-m", "o9", "-c", "x=1", "-"])
})

test("a recorded claude stream yields its text deltas and the final result", () => {
  const events = eventsFrom("claude", fixtureLines("claude-success.jsonl"))
  assert.deepEqual(events, [{ type: "delta", text: "I went home." }, { type: "final", text: "I went home." }])
})

test("a claude error result becomes an error event", () => {
  const line = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Invalid API key" })
  assert.deepEqual(Providers.parseLine("claude", line), { type: "error", detail: "Invalid API key" })
})

test("a recorded codex run yields the agent message and ignores config warnings", () => {
  const events = eventsFrom("codex", fixtureLines("codex-success.jsonl"))
  assert.deepEqual(events, [{ type: "final", text: "I have gone home." }])
})

test("a failed codex turn becomes an error event", () => {
  const line = JSON.stringify({ type: "turn.failed", error: { message: "stream disconnected" } })
  assert.deepEqual(Providers.parseLine("codex", line), { type: "error", detail: "stream disconnected" })
})

test("a top-level codex error becomes an error event", () => {
  const line = JSON.stringify({ type: "error", message: "unauthorized" })
  assert.deepEqual(Providers.parseLine("codex", line), { type: "error", detail: "unauthorized" })
})

test("lines that are not JSON are ignored", () => {
  assert.equal(Providers.parseLine("claude", "Loading..."), null)
  assert.equal(Providers.parseLine("codex", ""), null)
})

test("output cleanup trims and strips a wrapping code fence", () => {
  assert.equal(Providers.cleanOutput("  hi.\n"), "hi.")
  assert.equal(Providers.cleanOutput("```text\nhi.\n```"), "hi.")
  assert.equal(Providers.cleanOutput("line one\n\nline two"), "line one\n\nline two")
})

test("output cleanup strips text tags echoed back by the model", () => {
  assert.equal(Providers.cleanOutput("<text>\nhi.\n</text>"), "hi.")
})

test("empty output cleans to an empty string", () => {
  assert.equal(Providers.cleanOutput(" \n"), "")
  assert.equal(Providers.cleanOutput("```\n```"), "")
})

test("a missing binary names the provider and the binary", () => {
  assert.deepEqual(Providers.notInstalled("codex", "codex"), { key: "error.notInstalled", args: ["Codex", "codex"] })
})

test("an authentication failure suggests the provider's login command", () => {
  assert.deepEqual(Providers.failure("claude", "Invalid API key · Please run /login"), {
    key: "error.notSignedIn", args: ["Claude Code", "claude auth login"]
  })
  assert.deepEqual(Providers.failure("codex", "401 Unauthorized"), {
    key: "error.notSignedIn", args: ["Codex", "codex login"]
  })
})

test("a network failure is reported as offline", () => {
  assert.deepEqual(Providers.failure("claude", "getaddrinfo ENOTFOUND api.anthropic.com"), {
    key: "error.offline", args: ["Claude Code"]
  })
})

test("any other failure keeps the first line of detail", () => {
  assert.deepEqual(Providers.failure("codex", "\n  boom\nstack"), { key: "error.failed", args: ["Codex", "boom"] })
})

test("a failure without detail still names the provider", () => {
  assert.deepEqual(Providers.failure("claude", ""), { key: "error.failed", args: ["Claude Code", "no output"] })
})
