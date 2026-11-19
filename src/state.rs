use crate::mode::Mode;
use crate::rewriter::RewriteError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Idle,
    Running,
    Done(String),
    Failed(String),
}

/// What the UI shell must do in response to a user action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    Nothing,
    StartRewrite { mode: Mode, text: String },
    CopyAndClose(String),
}

#[derive(Debug)]
pub struct AppState {
    pub input: String,
    mode: Mode,
    status: Status,
}

impl AppState {
    pub fn new(input: String) -> Self {
        Self {
            input,
            mode: Mode::Grammar,
            status: Status::Idle,
        }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn status(&self) -> &Status {
        &self.status
    }

    pub fn result_mut(&mut self) -> Option<&mut String> {
        match &mut self.status {
            Status::Done(result) => Some(result),
            _ => None,
        }
    }

    pub fn set_mode(&mut self, mode: Mode) {
        if self.status == Status::Running || self.mode == mode {
            return;
        }
        self.mode = mode;
        self.status = Status::Idle;
    }

    pub fn input_edited(&mut self) {
        if self.status != Status::Running {
            self.status = Status::Idle;
        }
    }

    pub fn submit(&mut self) -> Effect {
        match &self.status {
            Status::Running => Effect::Nothing,
            Status::Done(result) => Effect::CopyAndClose(result.clone()),
            Status::Idle | Status::Failed(_) => self.start_rewrite(),
        }
    }

    pub fn rewrite_finished(&mut self, result: Result<String, String>) {
        if self.status != Status::Running {
            log::debug!("ignoring a rewrite result that arrived after the request was abandoned");
            return;
        }
        self.status = match result {
            Ok(text) => Status::Done(text),
            Err(message) => Status::Failed(message),
        };
    }

    fn start_rewrite(&mut self) -> Effect {
        if self.input.trim().is_empty() {
            self.status = Status::Failed(RewriteError::EmptyInput.to_string());
            return Effect::Nothing;
        }
        self.status = Status::Running;
        Effect::StartRewrite {
            mode: self.mode,
            text: self.input.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn done(text: &str) -> AppState {
        let mut state = AppState::new("teh text".into());
        state.submit();
        state.rewrite_finished(Ok(text.into()));
        state
    }

    #[test]
    fn starts_idle_in_grammar_mode_with_the_given_input() {
        let state = AppState::new("hello".into());
        assert_eq!(state.input, "hello");
        assert_eq!(state.mode(), Mode::Grammar);
        assert_eq!(state.status(), &Status::Idle);
    }

    #[test]
    fn submit_starts_a_rewrite_of_the_input_in_the_current_mode() {
        let mut state = AppState::new("teh text".into());
        state.set_mode(Mode::Polish);
        assert_eq!(
            state.submit(),
            Effect::StartRewrite {
                mode: Mode::Polish,
                text: "teh text".into()
            }
        );
        assert_eq!(state.status(), &Status::Running);
    }

    #[test]
    fn submitting_blank_input_fails_without_starting() {
        let mut state = AppState::new("  \n".into());
        assert_eq!(state.submit(), Effect::Nothing);
        assert!(matches!(state.status(), Status::Failed(message) if message.contains("empty")));
    }

    #[test]
    fn submitting_while_running_does_nothing() {
        let mut state = AppState::new("teh".into());
        state.submit();
        assert_eq!(state.submit(), Effect::Nothing);
        assert_eq!(state.status(), &Status::Running);
    }

    #[test]
    fn a_successful_rewrite_shows_the_result() {
        assert_eq!(
            done("The text.").status(),
            &Status::Done("The text.".into())
        );
    }

    #[test]
    fn a_failed_rewrite_shows_the_error() {
        let mut state = AppState::new("teh".into());
        state.submit();
        state.rewrite_finished(Err("Claude failed: boom".into()));
        assert_eq!(
            state.status(),
            &Status::Failed("Claude failed: boom".into())
        );
    }

    #[test]
    fn a_result_arriving_when_not_running_is_ignored() {
        let mut state = AppState::new("teh".into());
        state.rewrite_finished(Ok("late".into()));
        assert_eq!(state.status(), &Status::Idle);
    }

    #[test]
    fn submitting_a_finished_result_copies_it_and_closes() {
        let mut state = done("The text.");
        assert_eq!(state.submit(), Effect::CopyAndClose("The text.".into()));
    }

    #[test]
    fn the_result_can_be_edited_before_copying() {
        let mut state = done("The text.");
        state.result_mut().unwrap().push('!');
        assert_eq!(state.submit(), Effect::CopyAndClose("The text.!".into()));
    }

    #[test]
    fn there_is_no_result_to_edit_before_a_rewrite() {
        assert_eq!(AppState::new("x".into()).result_mut(), None);
    }

    #[test]
    fn editing_the_input_discards_a_stale_result() {
        let mut state = done("The text.");
        state.input_edited();
        assert_eq!(state.status(), &Status::Idle);
    }

    #[test]
    fn editing_the_input_clears_an_error() {
        let mut state = AppState::new(String::new());
        state.submit();
        state.input_edited();
        assert_eq!(state.status(), &Status::Idle);
    }

    #[test]
    fn switching_mode_discards_a_result_from_the_other_mode() {
        let mut state = done("The text.");
        state.set_mode(Mode::Polish);
        assert_eq!(state.mode(), Mode::Polish);
        assert_eq!(state.status(), &Status::Idle);
    }

    #[test]
    fn reselecting_the_same_mode_keeps_the_result() {
        let mut state = done("The text.");
        state.set_mode(Mode::Grammar);
        assert_eq!(state.status(), &Status::Done("The text.".into()));
    }

    #[test]
    fn mode_cannot_change_while_running() {
        let mut state = AppState::new("teh".into());
        state.submit();
        state.set_mode(Mode::Polish);
        assert_eq!(state.mode(), Mode::Grammar);
    }
}
