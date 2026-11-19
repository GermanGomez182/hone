use std::io::{self, Read, Write};
use std::process::{Child, Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use wait_timeout::ChildExt;

use crate::rewriter::{CommandOutput, CommandRunner, RunError};

/// Runs real child processes, killing them if they exceed the timeout.
pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: &str,
        timeout: Duration,
    ) -> Result<CommandOutput, RunError> {
        let mut child = spawn(program, args)?;
        feed_stdin(&mut child, stdin.to_string());
        let stdout = collect(child.stdout.take());
        let stderr = collect(child.stderr.take());
        let Some(status) = child.wait_timeout(timeout).map_err(io_error)? else {
            kill(&mut child, program);
            return Err(RunError::TimedOut);
        };
        Ok(CommandOutput {
            success: status.success(),
            stdout: join(stdout)?,
            stderr: join(stderr)?,
        })
    }
}

fn spawn(program: &str, args: &[String]) -> Result<Child, RunError> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => RunError::NotFound,
            _ => io_error(error),
        })
}

/// Writes on a separate thread so a child that fills its stdout pipe before reading all input cannot deadlock us.
fn feed_stdin(child: &mut Child, input: String) {
    let Some(mut pipe) = child.stdin.take() else {
        return;
    };
    thread::spawn(move || {
        if let Err(error) = pipe.write_all(input.as_bytes()) {
            log::debug!("child closed stdin before reading all input: {error}");
        }
    });
}

fn collect<R: Read + Send + 'static>(pipe: Option<R>) -> JoinHandle<io::Result<String>> {
    thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut pipe) = pipe {
            pipe.read_to_string(&mut text)?;
        }
        Ok(text)
    })
}

fn join(handle: JoinHandle<io::Result<String>>) -> Result<String, RunError> {
    handle
        .join()
        .map_err(|_| RunError::Io("output reader thread panicked".into()))?
        .map_err(io_error)
}

fn kill(child: &mut Child, program: &str) {
    if let Err(error) = child.kill().and_then(|()| child.wait().map(drop)) {
        log::warn!("failed to kill timed out `{program}`: {error}");
    }
}

fn io_error(error: io::Error) -> RunError {
    RunError::Io(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GENEROUS: Duration = Duration::from_secs(10);

    fn sh(script: &str) -> Vec<String> {
        vec!["-c".into(), script.into()]
    }

    #[test]
    fn captures_stdout_from_stdin() {
        let output = SystemRunner
            .run("cat", &[], "héllo\nworld", GENEROUS)
            .unwrap();
        assert_eq!(
            output,
            CommandOutput {
                success: true,
                stdout: "héllo\nworld".into(),
                stderr: String::new()
            }
        );
    }

    #[test]
    fn handles_input_larger_than_a_pipe_buffer() {
        let big = "a".repeat(1 << 20);
        let output = SystemRunner.run("cat", &[], &big, GENEROUS).unwrap();
        assert_eq!(output.stdout.len(), big.len());
    }

    #[test]
    fn reports_failure_and_stderr_on_non_zero_exit() {
        let output = SystemRunner
            .run("sh", &sh("echo boom >&2; exit 3"), "", GENEROUS)
            .unwrap();
        assert!(!output.success);
        assert_eq!(output.stderr, "boom\n");
    }

    #[test]
    fn missing_program_is_not_found() {
        let result = SystemRunner.run("polish-definitely-missing-binary", &[], "", GENEROUS);
        assert_eq!(result, Err(RunError::NotFound));
    }

    #[test]
    fn slow_program_times_out() {
        let result = SystemRunner.run("sh", &sh("exec sleep 30"), "", Duration::from_millis(100));
        assert_eq!(result, Err(RunError::TimedOut));
    }
}
