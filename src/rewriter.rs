use std::fmt;
use std::time::Duration;

use crate::mode::Mode;
use crate::output::clean_output;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    NotFound,
    TimedOut,
    Io(String),
}

/// Runs an external program, feeding `stdin` and collecting its output.
pub trait CommandRunner {
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: &str,
        timeout: Duration,
    ) -> Result<CommandOutput, RunError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeConfig {
    pub program: String,
    pub model: String,
    pub timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RewriteError {
    EmptyInput,
    NotInstalled { program: String },
    TimedOut { after: Duration },
    Failed { detail: String },
    EmptyResponse,
}

impl fmt::Display for RewriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RewriteError::EmptyInput => write!(f, "Nothing to rewrite: the input is empty."),
            RewriteError::NotInstalled { program } => write!(
                f,
                "Could not run `{program}`: it is not on PATH. Install Claude Code or set POLISH_CLAUDE_BIN."
            ),
            RewriteError::TimedOut { after } => {
                write!(
                    f,
                    "Claude did not answer within {}s. Try again.",
                    after.as_secs()
                )
            }
            RewriteError::Failed { detail } => write!(f, "Claude failed: {detail}"),
            RewriteError::EmptyResponse => {
                write!(f, "Claude returned an empty response. Try again.")
            }
        }
    }
}

pub struct ClaudeCli<R: CommandRunner> {
    runner: R,
    config: ClaudeConfig,
}

impl<R: CommandRunner> ClaudeCli<R> {
    pub fn new(runner: R, config: ClaudeConfig) -> Self {
        Self { runner, config }
    }

    pub fn rewrite(&self, mode: Mode, text: &str) -> Result<String, RewriteError> {
        if text.trim().is_empty() {
            return Err(RewriteError::EmptyInput);
        }
        let args = self.args(mode);
        let output = self
            .runner
            .run(&self.config.program, &args, text, self.config.timeout)
            .map_err(|error| self.run_error(error))?;
        if !output.success {
            return Err(RewriteError::Failed {
                detail: failure_detail(&output),
            });
        }
        clean_output(&output.stdout).ok_or(RewriteError::EmptyResponse)
    }

    fn args(&self, mode: Mode) -> Vec<String> {
        [
            "-p",
            "--model",
            &self.config.model,
            "--system-prompt",
            mode.system_prompt(),
            "--tools",
            "",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--no-session-persistence",
        ]
        .map(String::from)
        .to_vec()
    }

    fn run_error(&self, error: RunError) -> RewriteError {
        match error {
            RunError::NotFound => RewriteError::NotInstalled {
                program: self.config.program.clone(),
            },
            RunError::TimedOut => RewriteError::TimedOut {
                after: self.config.timeout,
            },
            RunError::Io(detail) => RewriteError::Failed { detail },
        }
    }
}

fn failure_detail(output: &CommandOutput) -> String {
    let stderr = output.stderr.trim();
    if stderr.is_empty() {
        return output.stdout.trim().to_string();
    }
    stderr.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Call {
        program: String,
        args: Vec<String>,
        stdin: String,
        timeout: Duration,
    }

    struct FakeRunner {
        reply: Result<CommandOutput, RunError>,
        calls: RefCell<Vec<Call>>,
    }

    impl FakeRunner {
        fn replying(reply: Result<CommandOutput, RunError>) -> Self {
            Self {
                reply,
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl CommandRunner for &FakeRunner {
        fn run(
            &self,
            program: &str,
            args: &[String],
            stdin: &str,
            timeout: Duration,
        ) -> Result<CommandOutput, RunError> {
            self.calls.borrow_mut().push(Call {
                program: program.to_string(),
                args: args.to_vec(),
                stdin: stdin.to_string(),
                timeout,
            });
            self.reply.clone()
        }
    }

    const TIMEOUT: Duration = Duration::from_secs(30);

    fn config() -> ClaudeConfig {
        ClaudeConfig {
            program: "claude".into(),
            model: "haiku".into(),
            timeout: TIMEOUT,
        }
    }

    fn ok(stdout: &str) -> Result<CommandOutput, RunError> {
        Ok(CommandOutput {
            success: true,
            stdout: stdout.into(),
            stderr: String::new(),
        })
    }

    fn arg_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let index = args.iter().position(|a| a == flag)?;
        args.get(index + 1).map(String::as_str)
    }

    #[test]
    fn returns_the_cleaned_model_output() {
        let runner = FakeRunner::replying(ok("  Fixed text.\n"));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "fixd text");
        assert_eq!(result, Ok("Fixed text.".to_string()));
    }

    #[test]
    fn sends_the_text_on_stdin_not_as_an_argument() {
        let runner = FakeRunner::replying(ok("x"));
        ClaudeCli::new(&runner, config())
            .rewrite(Mode::Grammar, "--secret text")
            .unwrap();
        let calls = runner.calls.borrow();
        assert_eq!(calls[0].stdin, "--secret text");
        assert!(!calls[0].args.iter().any(|a| a.contains("--secret text")));
    }

    #[test]
    fn runs_the_configured_program_model_and_timeout() {
        let runner = FakeRunner::replying(ok("x"));
        ClaudeCli::new(&runner, config())
            .rewrite(Mode::Grammar, "hi")
            .unwrap();
        let calls = runner.calls.borrow();
        assert_eq!(calls[0].program, "claude");
        assert_eq!(arg_after(&calls[0].args, "--model"), Some("haiku"));
        assert_eq!(calls[0].timeout, TIMEOUT);
    }

    #[test]
    fn uses_the_mode_system_prompt_in_print_mode() {
        let runner = FakeRunner::replying(ok("x"));
        ClaudeCli::new(&runner, config())
            .rewrite(Mode::Polish, "hi")
            .unwrap();
        let args = &runner.calls.borrow()[0].args;
        assert!(args.contains(&"-p".to_string()));
        assert_eq!(
            arg_after(args, "--system-prompt"),
            Some(Mode::Polish.system_prompt())
        );
    }

    #[test]
    fn disables_tools_mcp_settings_and_session_persistence() {
        let runner = FakeRunner::replying(ok("x"));
        ClaudeCli::new(&runner, config())
            .rewrite(Mode::Grammar, "hi")
            .unwrap();
        let args = &runner.calls.borrow()[0].args;
        assert_eq!(arg_after(args, "--tools"), Some(""));
        assert_eq!(arg_after(args, "--setting-sources"), Some(""));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(args.contains(&"--no-session-persistence".to_string()));
    }

    #[test]
    fn blank_input_is_rejected_without_running_anything() {
        let runner = FakeRunner::replying(ok("x"));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "  \n ");
        assert_eq!(result, Err(RewriteError::EmptyInput));
        assert!(runner.calls.borrow().is_empty());
    }

    #[test]
    fn missing_program_reports_not_installed() {
        let runner = FakeRunner::replying(Err(RunError::NotFound));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(
            result,
            Err(RewriteError::NotInstalled {
                program: "claude".into()
            })
        );
    }

    #[test]
    fn timeout_reports_the_limit() {
        let runner = FakeRunner::replying(Err(RunError::TimedOut));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(result, Err(RewriteError::TimedOut { after: TIMEOUT }));
    }

    #[test]
    fn non_zero_exit_reports_stderr() {
        let runner = FakeRunner::replying(Ok(CommandOutput {
            success: false,
            stdout: String::new(),
            stderr: "  Not logged in\n".into(),
        }));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(
            result,
            Err(RewriteError::Failed {
                detail: "Not logged in".into()
            })
        );
    }

    #[test]
    fn non_zero_exit_without_stderr_falls_back_to_stdout() {
        let runner = FakeRunner::replying(Ok(CommandOutput {
            success: false,
            stdout: "API Error: overloaded".into(),
            stderr: String::new(),
        }));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(
            result,
            Err(RewriteError::Failed {
                detail: "API Error: overloaded".into()
            })
        );
    }

    #[test]
    fn io_errors_are_reported_as_failures() {
        let runner = FakeRunner::replying(Err(RunError::Io("broken pipe".into())));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(
            result,
            Err(RewriteError::Failed {
                detail: "broken pipe".into()
            })
        );
    }

    #[test]
    fn empty_model_output_is_an_error() {
        let runner = FakeRunner::replying(ok("\n"));
        let result = ClaudeCli::new(&runner, config()).rewrite(Mode::Grammar, "hi");
        assert_eq!(result, Err(RewriteError::EmptyResponse));
    }

    #[test]
    fn errors_render_actionable_messages() {
        let not_installed = RewriteError::NotInstalled {
            program: "claude".into(),
        }
        .to_string();
        assert!(not_installed.contains("claude") && not_installed.contains("PATH"));
        let timed_out = RewriteError::TimedOut { after: TIMEOUT }.to_string();
        assert!(timed_out.contains("30s"));
        assert_eq!(
            RewriteError::EmptyInput.to_string(),
            "Nothing to rewrite: the input is empty."
        );
    }
}
