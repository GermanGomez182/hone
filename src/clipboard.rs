use std::fmt;
use std::io::{self, Write};
use std::process::{Command, Output, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardError(String);

impl fmt::Display for ClipboardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "clipboard: {}", self.0)
    }
}

/// Reads plain text from the Wayland clipboard; `None` when it holds no usable text.
pub fn paste_text() -> Result<Option<String>, ClipboardError> {
    let output = Command::new("wl-paste")
        .args(["--no-newline", "--type", "text"])
        .output()
        .map_err(|error| spawn_error("wl-paste", &error))?;
    Ok(pasted_text(&output))
}

/// Puts text on the Wayland clipboard. wl-copy keeps serving it after this process exits.
pub fn copy_text(text: &str) -> Result<(), ClipboardError> {
    let mut child = Command::new("wl-copy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| spawn_error("wl-copy", &error))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ClipboardError("wl-copy has no stdin".into()))?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|error| ClipboardError(format!("writing to wl-copy: {error}")))?;
    drop(stdin);
    let status = child
        .wait()
        .map_err(|error| ClipboardError(format!("waiting for wl-copy: {error}")))?;
    if !status.success() {
        return Err(ClipboardError(format!("wl-copy exited with {status}")));
    }
    Ok(())
}

fn pasted_text(output: &Output) -> Option<String> {
    if !output.status.success() {
        log::debug!(
            "clipboard holds no text: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    let Ok(text) = String::from_utf8(output.stdout.clone()) else {
        log::debug!("clipboard text is not valid UTF-8; starting empty");
        return None;
    };
    if text.trim().is_empty() {
        return None;
    }
    Some(text)
}

fn spawn_error(program: &str, error: &io::Error) -> ClipboardError {
    ClipboardError(format!(
        "cannot run {program} ({error}); install wl-clipboard"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;

    const EXIT_FAILURE: i32 = 1 << 8;

    fn output(code: i32, stdout: &[u8]) -> Output {
        Output {
            status: ExitStatus::from_raw(code),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn text_on_the_clipboard_is_returned() {
        assert_eq!(
            pasted_text(&output(0, "héllo".as_bytes())),
            Some("héllo".into())
        );
    }

    #[test]
    fn an_empty_clipboard_is_none() {
        assert_eq!(pasted_text(&output(EXIT_FAILURE, b"")), None);
    }

    #[test]
    fn whitespace_only_text_is_none() {
        assert_eq!(pasted_text(&output(0, b" \n ")), None);
    }

    #[test]
    fn non_utf8_content_is_none() {
        assert_eq!(pasted_text(&output(0, &[0xff, 0xfe, 0x00])), None);
    }

    #[test]
    #[ignore = "touches the real Wayland clipboard; run with --ignored inside a session"]
    fn round_trips_through_the_real_clipboard() {
        copy_text("polish round trip ñ").unwrap();
        assert_eq!(paste_text().unwrap(), Some("polish round trip ñ".into()));
    }
}
