import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import QtQuick.Controls as Controls
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Config.js" as Config
import "PanelState.js" as PanelState
import "Prompt.js" as Prompt
import "Providers.js" as Providers

// Hone: paste text, pick an action, and let Claude Code or Codex rewrite it.
// Behaviour lives in PanelState.js; this file renders its state and performs the
// effects it asks for.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false

  readonly property string pluginId: (root.manifest && root.manifest.id) || "hone"
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || (Quickshell.env("HOME") + "/.config")
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")
  readonly property string configPath: root.configHome + "/hone/config.json"

  property var config: Config.defaultConfig()
  property string configError: ""
  property string rememberedProvider: ""
  property var flow: PanelState.initial(Config.defaultConfig().provider, Config.defaultConfig().language)
  property var notice: null

  readonly property var languages: [Config.AUTO_LANGUAGE].concat(root.config.languages)
  readonly property bool running: root.flow.status === "running"
  readonly property bool hasResult: root.flow.status === "done"

  property color background: Commons.Color.menu.background
  property color foreground: Commons.Color.menu.text
  property color border: Commons.Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Commons.Color.menu.scrim
  property color selectedBackground: Commons.Color.menu.selectedBackground
  readonly property int cornerRadius: Style.cornerRadius
  readonly property string fontFamily: Style.font.menuFamily
  readonly property int contentMargin: Style.spacing.panelPadding
  readonly property int gap: Style.spacing.controlGap
  readonly property int cardWidth: Math.min(Style.space(760), panel.width - Style.gapsOut * 2)
  readonly property int cardHeight: Math.min(Style.space(600), panel.height - Style.gapsOut * 2)

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function open(payloadJson) {
    root.opened = true
    root.notice = null
    root.apply(PanelState.opened(root.flow, ""))
    if (root.config.prefillClipboard) paste.running = true
    Qt.callLater(function() { input.focusText() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function apply(transition) {
    if (transition.state.status !== root.flow.status || transition.effect)
      console.log("hone: " + root.flow.status + " -> " + transition.state.status
        + (transition.effect ? " effect=" + transition.effect.type : "")
        + (transition.state.error ? " error=" + transition.state.error.key : ""))
    root.flow = transition.state
    if (transition.effect) root.perform(transition.effect)
  }

  function perform(effect) {
    if (effect.type === "run") root.startRun(effect.runId, effect.job)
    else if (effect.type === "cancel") backend.cancel()
    else if (effect.type === "copy") root.copyText(effect.text, effect.close)
    else if (effect.type === "close") root.dismiss()
    else if (effect.type === "rememberProvider") stateFile.setText(Config.stateText(effect.provider))
  }

  function startRun(runId, job) {
    var action = root.config.actions[job.actionIndex]
    var prompt = {
      system: Prompt.system(root.config.systemPrompt, action.prompt, job.instruction, job.language),
      user: Prompt.wrapped(job.input)
    }
    backend.run(runId, job.provider, root.config.providers[job.provider], prompt, root.config.timeoutSeconds)
  }

  function copyText(text, closeAfter) {
    copier.pendingText = text
    copier.closeAfter = closeAfter
    copier.running = true
  }

  function submit() {
    if (root.configError) return
    root.notice = null
    root.apply(PanelState.submit(root.flow))
  }

  function loadConfig(text) {
    var parsed = Config.parseConfig(text)
    root.configError = parsed.error
    if (parsed.error) {
      console.warn("hone: " + root.configPath + ": " + parsed.error)
      return
    }
    root.config = parsed.config
    root.flow = PanelState.initial(root.rememberedProvider || parsed.config.provider, parsed.config.language)
  }

  function errorText(error) {
    var text = strings.t(error.key)
    for (var i = 0; i < error.args.length; i++) text = text.arg(error.args[i])
    return text
  }

  function languageLabel(language) {
    return language === Config.AUTO_LANGUAGE ? strings.t("language.auto") : language
  }

  // Runs before the focused editor sees the key, so the shortcuts work
  // from every field.
  function handleKey(event) {
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    var alt = (event.modifiers & Qt.AltModifier) !== 0
    if (event.key === Qt.Key_Escape) root.apply(PanelState.escape(root.flow))
    else if (ctrl && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) root.submit()
    else if (ctrl && shift && event.key === Qt.Key_C) root.apply(PanelState.copy(root.flow, root.config.closeOnCopy))
    else if (ctrl && !shift && event.key === Qt.Key_R) root.apply(PanelState.retry(root.flow))
    else if (ctrl && !shift && event.key === Qt.Key_U) root.apply(PanelState.useAsInput(root.flow))
    else if (ctrl && !shift && event.key === Qt.Key_L) root.apply(PanelState.setLanguage(root.flow, PanelState.cycled(root.languages, root.flow.language)))
    else if (ctrl && !shift && event.key === Qt.Key_P) root.apply(PanelState.setProvider(root.flow, PanelState.cycled(Config.PROVIDERS, root.flow.provider)))
    else if (alt && event.key >= Qt.Key_1 && event.key <= Qt.Key_9 && event.key - Qt.Key_1 < root.config.actions.length)
      root.apply(PanelState.setAction(root.flow, event.key - Qt.Key_1))
    else return
    event.accepted = true
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.loadConfig(text())
    onLoadFailed: function(error) {
      if (error !== FileViewError.FileNotFound) {
        root.configError = "cannot read the file (error " + error + ")"
        console.warn("hone: cannot read " + root.configPath + ": error " + error)
        return
      }
      console.info("hone: writing default config to " + root.configPath)
      configFile.setText(Config.defaultConfigText())
    }
  }

  FileView {
    id: stateFile
    path: root.stateHome + "/hone/state.json"
    onLoaded: {
      root.rememberedProvider = Config.rememberedProvider(text())
      if (root.rememberedProvider && !root.running)
        root.flow = PanelState.setProvider(root.flow, root.rememberedProvider).state
    }
  }

  Process {
    id: paste
    command: ["wl-paste", "--no-newline", "--type", "text"]
    stdout: StdioCollector {
      onStreamFinished: {
        if (root.flow.status === "idle" && root.flow.input === "") root.apply(PanelState.editInput(root.flow, text))
      }
    }
  }

  Process {
    id: copier
    property string pendingText: ""
    property bool closeAfter: false
    command: ["wl-copy"]
    stdinEnabled: true
    onStarted: {
      copier.write(copier.pendingText)
      copier.stdinEnabled = false
    }
    onExited: function(exitCode) {
      copier.stdinEnabled = true
      if (exitCode !== 0) {
        console.warn("hone: wl-copy exited with " + exitCode)
        root.notice = { error: true, text: strings.t("error.copyFailed") }
        return
      }
      if (copier.closeAfter) root.dismiss()
      else root.notice = { error: false, text: strings.t("notice.copied") }
    }
  }

  HoneBackend {
    id: backend
    onDelta: function(runId, text) { root.apply(PanelState.delta(root.flow, runId, text)) }
    onFinished: function(runId, outcomeJson) { root.apply(PanelState.finished(root.flow, runId, JSON.parse(outcomeJson))) }
  }

  OverlayWindow {
    id: panel
    shown: root.opened
    WlrLayershell.namespace: "hone"

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function(event) { root.handleKey(event) }

      Column {
        id: layout
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.gap

        readonly property int editorHeight: Math.max(Style.space(80),
          (height - header.height - actions.height - instruction.height - footer.height
            - originalLabel.height - resultLabel.height - spacing * 8) / 2)

        Item {
          id: header
          width: parent.width
          height: Math.max(title.implicitHeight, providerButton.implicitHeight)

          Text {
            id: title
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: strings.t("title")
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            font.bold: true
          }

          Row {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: root.gap

            Button {
              text: root.languageLabel(root.flow.language)
              tooltipText: "Ctrl+L"
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.apply(PanelState.setLanguage(root.flow, PanelState.cycled(root.languages, root.flow.language)))
            }

            Button {
              id: providerButton
              text: Providers.LABELS[root.flow.provider]
              tooltipText: "Ctrl+P"
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.apply(PanelState.setProvider(root.flow, PanelState.cycled(Config.PROVIDERS, root.flow.provider)))
            }
          }
        }

        Flow {
          id: actions
          width: parent.width
          spacing: root.gap

          Repeater {
            model: root.config.actions

            Button {
              required property var modelData
              required property int index
              text: (index + 1) + "  " + modelData.label
              tooltipText: "Alt+" + (index + 1)
              fontFamily: root.fontFamily
              selected: root.flow.actionIndex === index
              onClicked: root.apply(PanelState.setAction(root.flow, index))
            }
          }
        }

        TextField {
          id: instruction
          width: parent.width
          text: root.flow.instruction
          placeholderText: strings.t("instruction.placeholder")
          font.family: root.fontFamily
          enabled: !root.running
          Keys.priority: Keys.BeforeItem
          Keys.onPressed: function(event) { root.handleKey(event) }
          onTextEdited: if (text !== root.flow.instruction) root.apply(PanelState.editInstruction(root.flow, text))
        }

        SectionText { id: originalLabel; text: strings.t("section.original"); fontName: root.fontFamily }

        Editor {
          id: input
          width: parent.width
          height: layout.editorHeight
          text: root.flow.input
          placeholder: strings.t("input.placeholder")
          readOnly: root.running
          textColor: root.foreground
          fontName: root.fontFamily
          keyHandler: root.handleKey
          onEdited: function(text) {
            if (text !== root.flow.input) root.apply(PanelState.editInput(root.flow, text))
          }
        }

        SectionText { id: resultLabel; text: strings.t("section.result"); fontName: root.fontFamily }

        Item {
          width: parent.width
          height: layout.editorHeight

          Editor {
            anchors.fill: parent
            visible: root.hasResult || root.running
            text: root.running ? root.flow.partial : root.flow.result
            placeholder: root.running ? strings.t("result.running").arg(Providers.LABELS[root.flow.provider]) : ""
            readOnly: true
            textColor: root.foreground
            fontName: root.fontFamily
            keyHandler: root.handleKey
          }

          Text {
            textFormat: Text.PlainText
            anchors.fill: parent
            visible: !root.hasResult && !root.running
            text: root.configError ? strings.t("error.config").arg(root.configPath).arg(root.configError)
              : root.flow.error ? root.errorText(root.flow.error) : strings.t("result.placeholder")
            color: (root.configError || root.flow.error) ? Commons.Color.urgent : Commons.Color.muted
            wrapMode: Text.Wrap
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }
        }

        Item {
          id: footer
          width: parent.width
          height: Math.max(hint.implicitHeight, buttons.implicitHeight)

          Text {
            id: hint
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: buttons.left
            anchors.rightMargin: root.gap
            anchors.verticalCenter: parent.verticalCenter
            text: root.notice ? root.notice.text
              : root.running ? strings.t("hint.running")
              : root.hasResult ? strings.t("hint.done")
              : strings.t("hint.idle").arg(root.config.actions.length)
            color: root.notice && root.notice.error ? Commons.Color.urgent : Commons.Color.muted
            elide: Text.ElideRight
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Row {
            id: buttons
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: root.gap

            Button {
              visible: root.running
              text: strings.t("button.cancel")
              fontFamily: root.fontFamily
              onClicked: root.apply(PanelState.escape(root.flow))
            }
            Button {
              visible: root.hasResult
              text: strings.t("button.useAsInput")
              fontFamily: root.fontFamily
              onClicked: root.apply(PanelState.useAsInput(root.flow))
            }
            Button {
              visible: root.hasResult || root.flow.status === "failed"
              text: strings.t("button.retry")
              fontFamily: root.fontFamily
              onClicked: root.apply(PanelState.retry(root.flow))
            }
            Button {
              visible: root.hasResult
              text: strings.t("button.copy")
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.apply(PanelState.copy(root.flow, root.config.closeOnCopy))
            }
          }
        }
      }
    }
  }

  component SectionText: Text {
    property string fontName: ""
    textFormat: Text.PlainText
    color: Commons.Color.muted
    font.family: fontName
    font.pixelSize: Style.font.caption
  }

  // A scrollable plain-text area styled like the kit's TextField. Inline
  // components do not see the file's ids, so everything comes in as a property.
  component Editor: Controls.ScrollView {
    id: editor
    property alias text: area.text
    property alias placeholder: area.placeholderText
    property alias readOnly: area.readOnly
    property color textColor: Commons.Color.foreground
    property string fontName: ""
    property var keyHandler: null
    signal edited(string text)

    function focusText() { area.forceActiveFocus() }

    Controls.TextArea {
      id: area
      textFormat: TextEdit.PlainText
      wrapMode: TextEdit.Wrap
      selectByMouse: true
      color: editor.textColor
      placeholderTextColor: Commons.Color.muted
      selectionColor: Style.selectionFillFor(editor.textColor, Commons.Color.accent)
      selectedTextColor: editor.textColor
      font.family: editor.fontName
      font.pixelSize: Style.font.body
      padding: Style.spacing.controlPaddingX
      background: BorderSurface {
        color: Style.controlFill(area.activeFocus, false, editor.textColor, Commons.Color.accent)
        borderSpec: Border.controlSpec(area.activeFocus ? "focus" : "normal", editor.textColor, Commons.Color.accent)
        radius: Style.cornerRadius
      }
      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function(event) { if (editor.keyHandler) editor.keyHandler(event) }
      onTextChanged: if (activeFocus && !readOnly) editor.edited(text)
    }
  }
}
