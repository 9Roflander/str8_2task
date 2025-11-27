/// Embedded default templates using compile-time inclusion
///
/// These templates are bundled into the binary and serve as fallbacks
/// when custom templates are not available.

/// Daily standup template for engineering/product teams
pub const DAILY_STANDUP: &str = include_str!("../../../templates/daily_standup.json");

/// Standard meeting notes template
pub const STANDARD_MEETING: &str = include_str!("../../../templates/standard_meeting.json");

/// Registry of all built-in templates
///
/// Maps template identifiers to their embedded JSON content
pub fn get_builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("daily_standup", DAILY_STANDUP),
        ("standard_meeting", STANDARD_MEETING),
    ]
}

/// Get a built-in template by identifier
///
/// # Arguments
/// * `id` - Template identifier (only "standard_meeting" is available)
///
/// # Returns
/// The template JSON content if found, None otherwise
/// Only returns standard_meeting - other templates are disabled
pub fn get_builtin_template(id: &str) -> Option<&'static str> {
    match id {
        "standard_meeting" => Some(STANDARD_MEETING),
        _ => None, // All other templates are disabled
    }
}

/// List all built-in template identifiers
/// Only returns standard_meeting - other templates are disabled
pub fn list_builtin_template_ids() -> Vec<&'static str> {
    vec!["standard_meeting"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_templates_valid_json() {
        for (id, content) in get_builtin_templates() {
            let result = serde_json::from_str::<serde_json::Value>(content);
            assert!(
                result.is_ok(),
                "Built-in template '{}' contains invalid JSON: {:?}",
                id,
                result.err()
            );
        }
    }

    #[test]
    fn test_get_builtin_template() {
        assert!(get_builtin_template("standard_meeting").is_some());
        assert!(get_builtin_template("daily_standup").is_none()); // Disabled
        assert!(get_builtin_template("nonexistent").is_none());
    }
}
