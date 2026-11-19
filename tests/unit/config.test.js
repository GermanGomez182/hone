const test = require("node:test")
const assert = require("node:assert/strict")
const Config = require("../../Config.js")

function parsed(overrides) {
  return Config.parseConfig(JSON.stringify(overrides))
}

function errorOf(overrides) {
  const result = parsed(overrides)
  assert.equal(result.config, null, "expected the config to be rejected")
  return result.error
}

test("an empty object yields the defaults", () => {
  assert.deepEqual(parsed({}), { config: Config.defaultConfig(), error: "" })
})

test("defaults use claude haiku, auto language and the four standard actions", () => {
  const config = Config.defaultConfig()
  assert.equal(config.provider, "claude")
  assert.equal(config.providers.claude.model, "haiku")
  assert.equal(config.language, "auto")
  assert.deepEqual(config.actions.map((action) => action.id), ["chat", "grammar", "formal", "email"])
})

test("chat is the first action because it is the most used", () => {
  assert.equal(Config.defaultConfig().actions[0].label, "Chat")
})

test("by default the panel starts from the selection and pastes the result back", () => {
  const config = Config.defaultConfig()
  assert.equal(config.prefill, "auto")
  assert.equal(config.pasteBack, true)
})

test("prefill accepts auto, selection, clipboard or none", () => {
  for (const prefill of ["auto", "selection", "clipboard", "none"])
    assert.equal(parsed({ prefill }).config.prefill, prefill)
  assert.match(errorOf({ prefill: "primary" }), /prefill/)
})

test("pasteBack must be a boolean", () => {
  assert.equal(parsed({ pasteBack: false }).config.pasteBack, false)
  assert.match(errorOf({ pasteBack: "no" }), /pasteBack/)
})

test("the old prefillClipboard setting is reported as unknown", () => {
  assert.match(errorOf({ prefillClipboard: true }), /prefillClipboard/)
})

test("defaultConfig returns an independent copy each time", () => {
  const first = Config.defaultConfig()
  first.actions.pop()
  assert.equal(Config.defaultConfig().actions.length, 4)
})

test("top-level settings override the defaults", () => {
  const { config } = parsed({ provider: "codex", closeOnCopy: true, timeoutSeconds: 30 })
  assert.equal(config.provider, "codex")
  assert.equal(config.closeOnCopy, true)
  assert.equal(config.timeoutSeconds, 30)
})

test("a provider override keeps the provider fields it does not mention", () => {
  const { config } = parsed({ providers: { claude: { model: "sonnet" } } })
  assert.equal(config.providers.claude.model, "sonnet")
  assert.equal(config.providers.claude.binary, "claude")
  assert.deepEqual(config.providers.codex, Config.defaultConfig().providers.codex)
})

test("actions replace the default list wholesale", () => {
  const actions = [{ id: "pirate", label: "Pirate", prompt: "Rewrite like a pirate." }]
  assert.deepEqual(parsed({ actions }).config.actions, actions)
})

test("a named language must be one of the configured languages", () => {
  assert.equal(parsed({ language: "Spanish" }).config.language, "Spanish")
  assert.match(errorOf({ language: "French" }), /language/)
})

test("invalid JSON is reported with the parser message", () => {
  const result = Config.parseConfig("{ nope")
  assert.equal(result.config, null)
  assert.match(result.error, /not valid JSON/)
})

test("a non-object document is rejected", () => {
  assert.match(Config.parseConfig("[]").error, /object/)
})

test("an unknown top-level key is named in the error", () => {
  assert.match(errorOf({ closeOnCopyy: true }), /closeOnCopyy/)
})

test("an unknown provider key is named in the error", () => {
  assert.match(errorOf({ providers: { claude: { modle: "x" } } }), /providers\.claude\.modle/)
})

test("an unknown provider is rejected", () => {
  assert.match(errorOf({ provider: "gemini" }), /provider/)
  assert.match(errorOf({ providers: { gemini: {} } }), /providers\.gemini/)
})

test("wrong types are rejected with the field name", () => {
  assert.match(errorOf({ closeOnCopy: "yes" }), /closeOnCopy/)
  assert.match(errorOf({ providers: { codex: { extraArgs: "-c x" } } }), /providers\.codex\.extraArgs/)
  assert.match(errorOf({ systemPrompt: "" }), /systemPrompt/)
})

test("an empty binary is rejected", () => {
  assert.match(errorOf({ providers: { claude: { binary: " " } } }), /providers\.claude\.binary/)
})

test("the timeout must be a whole number of seconds between 1 and 600", () => {
  assert.match(errorOf({ timeoutSeconds: 0 }), /timeoutSeconds/)
  assert.match(errorOf({ timeoutSeconds: 1.5 }), /timeoutSeconds/)
  assert.match(errorOf({ timeoutSeconds: 601 }), /timeoutSeconds/)
  assert.equal(parsed({ timeoutSeconds: 600 }).config.timeoutSeconds, 600)
})

test("languages must be a non-empty list of names", () => {
  assert.match(errorOf({ languages: [] }), /languages/)
  assert.match(errorOf({ languages: ["English", ""] }), /languages/)
})

test("actions need between one and nine entries for the Alt+1..9 shortcuts", () => {
  assert.match(errorOf({ actions: [] }), /actions/)
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: "a" + i, label: "A", prompt: "p" }))
  assert.match(errorOf({ actions: ten }), /actions/)
})

test("each action needs a non-empty id, label and prompt", () => {
  assert.match(errorOf({ actions: [{ id: "x", label: "X" }] }), /actions\[0\]\.prompt/)
  assert.match(errorOf({ actions: [{ id: "x", label: "X", prompt: "p", key: "1" }] }), /actions\[0\]\.key/)
})

test("action ids must be unique", () => {
  const twice = [{ id: "x", label: "X", prompt: "p" }, { id: "x", label: "Y", prompt: "q" }]
  assert.match(errorOf({ actions: twice }), /duplicate action id "x"/)
})

test("the first-run file holds no settings, so later default changes still apply", () => {
  assert.equal(Config.initialConfigText(), "{}\n")
  assert.deepEqual(Config.parseConfig(Config.initialConfigText()), { config: Config.defaultConfig(), error: "" })
})

test("the remembered provider is read back from the state file", () => {
  assert.equal(Config.rememberedProvider(Config.stateText("codex")), "codex")
})

test("a missing, corrupt or unknown remembered provider is ignored", () => {
  assert.equal(Config.rememberedProvider(""), "")
  assert.equal(Config.rememberedProvider("{ nope"), "")
  assert.equal(Config.rememberedProvider(JSON.stringify({ provider: "gemini" })), "")
})
