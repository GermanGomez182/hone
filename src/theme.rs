use std::fmt;
use std::path::Path;

use serde::Deserialize;

pub type Rgb = [u8; 3];

/// The subset of an Omarchy theme's `colors.toml` that the window uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Palette {
    pub dark: bool,
    pub accent: Rgb,
    pub selection: Rgb,
    pub background: Rgb,
    pub surface: Rgb,
    pub foreground: Rgb,
    pub muted: Rgb,
    pub error: Rgb,
    pub success: Rgb,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThemeError {
    Unreadable { path: String, reason: String },
    Invalid { reason: String },
}

impl fmt::Display for ThemeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ThemeError::Unreadable { path, reason } => {
                write!(f, "cannot read theme {path}: {reason}")
            }
            ThemeError::Invalid { reason } => write!(f, "invalid theme colors: {reason}"),
        }
    }
}

pub fn load_palette(path: &Path) -> Result<Palette, ThemeError> {
    let source = std::fs::read_to_string(path).map_err(|error| ThemeError::Unreadable {
        path: path.display().to_string(),
        reason: error.to_string(),
    })?;
    parse_palette(&source)
}

pub fn parse_palette(source: &str) -> Result<Palette, ThemeError> {
    let raw: RawColors = toml::from_str(source).map_err(|error| invalid(error.message()))?;
    Ok(Palette {
        dark: parse_mode(&raw.mode)?,
        accent: parse_hex(&raw.accent)?,
        selection: parse_hex(&raw.selection)?,
        background: parse_hex(&raw.background)?,
        surface: parse_hex(&raw.lighter_background)?,
        foreground: parse_hex(&raw.foreground)?,
        muted: parse_hex(&raw.dark_foreground)?,
        error: parse_hex(&raw.red)?,
        success: parse_hex(&raw.green)?,
    })
}

#[derive(Deserialize)]
struct RawColors {
    mode: String,
    accent: String,
    selection: String,
    background: String,
    lighter_background: String,
    foreground: String,
    dark_foreground: String,
    red: String,
    green: String,
}

fn parse_mode(mode: &str) -> Result<bool, ThemeError> {
    match mode {
        "dark" => Ok(true),
        "light" => Ok(false),
        other => Err(invalid(&format!(
            "mode must be \"dark\" or \"light\", got \"{other}\""
        ))),
    }
}

const HEX_DIGITS: usize = 6;

fn parse_hex(color: &str) -> Result<Rgb, ThemeError> {
    let malformed = || invalid(&format!("expected a #rrggbb color, got \"{color}\""));
    let digits = color
        .strip_prefix('#')
        .filter(|d| d.len() == HEX_DIGITS && d.is_ascii())
        .ok_or_else(malformed)?;
    let channel = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).map_err(|_| malformed());
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

fn invalid(reason: &str) -> ThemeError {
    ThemeError::Invalid {
        reason: reason.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKYO: &str = r##"
mode = "dark"
accent = "#7aa2f7"
selection = "#292e42"
muted = "#414868"
background = "#1a1b26"
lighter_background = "#24283b"
foreground = "#a9b1d6"
dark_foreground = "#565f89"
red = "#f7768e"
green = "#9ece6a"
"##;

    #[test]
    fn parses_the_theme_colors() {
        let palette = parse_palette(TOKYO).unwrap();
        assert_eq!(
            palette,
            Palette {
                dark: true,
                accent: [0x7a, 0xa2, 0xf7],
                selection: [0x29, 0x2e, 0x42],
                background: [0x1a, 0x1b, 0x26],
                surface: [0x24, 0x28, 0x3b],
                foreground: [0xa9, 0xb1, 0xd6],
                muted: [0x56, 0x5f, 0x89],
                error: [0xf7, 0x76, 0x8e],
                success: [0x9e, 0xce, 0x6a],
            }
        );
    }

    #[test]
    fn light_mode_is_not_dark() {
        let light = TOKYO.replace(r#"mode = "dark""#, r#"mode = "light""#);
        assert!(!parse_palette(&light).unwrap().dark);
    }

    #[test]
    fn uppercase_hex_is_accepted() {
        let upper = TOKYO.replace("#7aa2f7", "#7AA2F7");
        assert_eq!(parse_palette(&upper).unwrap().accent, [0x7a, 0xa2, 0xf7]);
    }

    #[test]
    fn a_missing_key_is_named_in_the_error() {
        let missing = TOKYO.replace(r##"accent = "#7aa2f7""##, "");
        let error = parse_palette(&missing).unwrap_err().to_string();
        assert!(error.contains("accent"), "{error}");
    }

    #[test]
    fn a_malformed_color_is_named_in_the_error() {
        let bad = TOKYO.replace("#7aa2f7", "blue");
        let error = parse_palette(&bad).unwrap_err().to_string();
        assert!(error.contains("blue"), "{error}");
    }

    #[test]
    fn a_short_hex_color_is_rejected() {
        let bad = TOKYO.replace("#7aa2f7", "#7af");
        assert!(parse_palette(&bad).is_err());
    }

    #[test]
    fn a_non_ascii_color_is_rejected_without_panicking() {
        let bad = TOKYO.replace("#7aa2f7", "#aééa");
        assert!(parse_palette(&bad).is_err());
    }

    #[test]
    fn an_unknown_mode_is_rejected() {
        let bad = TOKYO.replace(r#"mode = "dark""#, r#"mode = "dim""#);
        assert!(parse_palette(&bad).unwrap_err().to_string().contains("dim"));
    }

    #[test]
    fn an_unreadable_file_names_the_path() {
        let error = load_palette(Path::new("/nonexistent/colors.toml")).unwrap_err();
        assert!(
            matches!(error, ThemeError::Unreadable { ref path, .. } if path == "/nonexistent/colors.toml")
        );
    }
}
