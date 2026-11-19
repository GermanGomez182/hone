/// Normalizes model output into the text the user will paste, or `None` if nothing usable came back.
pub fn clean_output(raw: &str) -> Option<String> {
    let text = strip_code_fence(raw.trim()).trim();
    if text.is_empty() {
        return None;
    }
    Some(text.to_string())
}

const FENCE: &str = "```";

fn strip_code_fence(text: &str) -> &str {
    let Some(inner) = text.strip_prefix(FENCE).and_then(|t| t.strip_suffix(FENCE)) else {
        return text;
    };
    match inner.split_once('\n') {
        Some((_language_tag, body)) => body,
        None => inner,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(clean_output("  hello.\n\n"), Some("hello.".to_string()));
    }

    #[test]
    fn strips_a_wrapping_code_fence() {
        assert_eq!(clean_output("```\nhello.\n```"), Some("hello.".to_string()));
    }

    #[test]
    fn strips_a_wrapping_code_fence_with_language_tag() {
        assert_eq!(
            clean_output("```text\nhello.\n```\n"),
            Some("hello.".to_string())
        );
    }

    #[test]
    fn keeps_inner_newlines() {
        assert_eq!(
            clean_output("line one\n\nline two"),
            Some("line one\n\nline two".to_string())
        );
    }

    #[test]
    fn empty_output_is_none() {
        assert_eq!(clean_output(""), None);
    }

    #[test]
    fn whitespace_only_output_is_none() {
        assert_eq!(clean_output(" \n\t "), None);
    }

    #[test]
    fn empty_code_fence_is_none() {
        assert_eq!(clean_output("```\n```"), None);
    }
}
