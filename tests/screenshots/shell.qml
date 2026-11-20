import QtQuick
import QtQuick.Controls
import Quickshell

// A stand-in chat app for the README screenshots: a plain window with an
// invented message. It covers the area behind Hone's panel so the cropped
// screenshots contain nothing from the real desktop.
ShellRoot {
  FloatingWindow {
    title: "hone-demo"
    implicitWidth: 1600
    implicitHeight: 900
    color: "#1e1f24"

    TextArea {
      id: message
      x: 24
      y: 24
      width: 700
      height: 120
      color: "#d8d8d8"
      persistentSelection: true
      wrapMode: TextEdit.Wrap
      text: Quickshell.env("HONE_DEMO_TEXT")
      focus: true
      Component.onCompleted: forceActiveFocus()
      onTextChanged: console.log("DEMO-TEXT " + JSON.stringify(text))
    }
  }
}
