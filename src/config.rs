use std::time::Duration;

use crate::rewriter::ClaudeConfig;

pub const PROGRAM_VAR: &str = "POLISH_CLAUDE_BIN";
pub const MODEL_VAR: &str = "POLISH_MODEL";
pub const TIMEOUT_VAR: &str = "POLISH_TIMEOUT_SECS";

const DEFAULT_PROGRAM: &str = "claude";
const DEFAULT_MODEL: &str = "haiku";
const DEFAULT_TIMEOUT_SECS: u64 = 60;

/// Builds the backend config from optional overrides; `lookup` is usually `std::env::var(..).ok()`.
pub fn claude_config(lookup: impl Fn(&str) -> Option<String>) -> Result<ClaudeConfig, String> {
    let setting = |var: &str, default: &str| -> Result<String, String> {
        match lookup(var) {
            None => Ok(default.to_string()),
            Some(value) if value.trim().is_empty() => Err(format!("{var} is set but empty")),
            Some(value) => Ok(value),
        }
    };
    let timeout = setting(TIMEOUT_VAR, &DEFAULT_TIMEOUT_SECS.to_string())?;
    Ok(ClaudeConfig {
        program: setting(PROGRAM_VAR, DEFAULT_PROGRAM)?,
        model: setting(MODEL_VAR, DEFAULT_MODEL)?,
        timeout: parse_timeout(&timeout)?,
    })
}

fn parse_timeout(value: &str) -> Result<Duration, String> {
    match value.trim().parse::<u64>() {
        Ok(secs) if secs > 0 => Ok(Duration::from_secs(secs)),
        _ => Err(format!(
            "{TIMEOUT_VAR} must be a positive number of seconds, got \"{value}\""
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config_with(vars: &[(&str, &str)]) -> Result<ClaudeConfig, String> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        claude_config(|key| vars.get(key).cloned())
    }

    #[test]
    fn defaults_to_claude_haiku_with_a_minute_timeout() {
        assert_eq!(
            config_with(&[]),
            Ok(ClaudeConfig {
                program: "claude".into(),
                model: "haiku".into(),
                timeout: Duration::from_secs(60)
            })
        );
    }

    #[test]
    fn every_setting_can_be_overridden() {
        let config = config_with(&[
            (PROGRAM_VAR, "/opt/claude"),
            (MODEL_VAR, "sonnet"),
            (TIMEOUT_VAR, "15"),
        ])
        .unwrap();
        assert_eq!(config.program, "/opt/claude");
        assert_eq!(config.model, "sonnet");
        assert_eq!(config.timeout, Duration::from_secs(15));
    }

    #[test]
    fn a_non_numeric_timeout_is_an_error_naming_the_variable() {
        let error = config_with(&[(TIMEOUT_VAR, "soon")]).unwrap_err();
        assert!(
            error.contains(TIMEOUT_VAR) && error.contains("soon"),
            "{error}"
        );
    }

    #[test]
    fn a_zero_timeout_is_an_error() {
        assert!(config_with(&[(TIMEOUT_VAR, "0")]).is_err());
    }

    #[test]
    fn a_blank_override_is_an_error_naming_the_variable() {
        let error = config_with(&[(MODEL_VAR, " ")]).unwrap_err();
        assert!(error.contains(MODEL_VAR), "{error}");
    }
}
