use serde::{Deserialize, Serialize};

/// Represents a single section in a meeting template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSection {
    /// Section title (e.g., "Summary", "Action Items")
    pub title: String,

    /// Instruction for the LLM on what to extract/include
    pub instruction: String,

    /// Format type: "paragraph", "list", or "string"
    pub format: String,

    /// Optional markdown formatting hint for list items (e.g., table structure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_format: Option<String>,

    /// Alternative formatting hint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example_item_format: Option<String>,
}

/// Represents a complete meeting template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    /// Template display name
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// List of sections in the template
    pub sections: Vec<TemplateSection>,
}

impl Template {
    /// Validates the template structure
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("Template name cannot be empty".to_string());
        }

        if self.description.is_empty() {
            return Err("Template description cannot be empty".to_string());
        }

        if self.sections.is_empty() {
            return Err("Template must have at least one section".to_string());
        }

        for (i, section) in self.sections.iter().enumerate() {
            if section.title.is_empty() {
                return Err(format!("Section {} has empty title", i));
            }

            if section.instruction.is_empty() {
                return Err(format!("Section '{}' has empty instruction", section.title));
            }

            match section.format.as_str() {
                "paragraph" | "list" | "string" => {},
                other => return Err(format!(
                    "Section '{}' has invalid format '{}'. Must be 'paragraph', 'list', or 'string'",
                    section.title, other
                )),
            }
        }

        Ok(())
    }

    /// Generates a clean markdown template structure
    pub fn to_markdown_structure(&self) -> String {
        let mut markdown = String::from("# <Add Title here>\n\n");
        markdown.push_str("**IMPORTANT: Output sections in this EXACT order. Do NOT add any extra sections.**\n\n");

        for (i, section) in self.sections.iter().enumerate() {
            markdown.push_str(&format!("{}. **{}**\n\n", i + 1, section.title));
        }

        markdown.push_str("\n**REMINDER: Output ONLY these sections in this exact order. No additional sections allowed.**\n");
        markdown
    }

    /// Generates section-specific instructions for the LLM
    pub fn to_section_instructions(&self) -> String {
        let mut instructions = String::from(
            "- **For the main title (`# [AI-Generated Title]`):** Analyze the entire transcript and create a concise, descriptive title for the meeting.\n"
        );

        for section in &self.sections {
            instructions.push_str(&format!(
                "- **For the '{}' section:** {}.\n",
                section.title, section.instruction
            ));
            
            // Add format-specific instructions
            match section.format.as_str() {
                "paragraph" => {
                    instructions.push_str(&format!(
                        "  - **FORMAT REQUIREMENT**: This section must be written as a continuous paragraph (NOT a list or bullet points). Write flowing text that summarizes the content.\n"
                    ));
                }
                "list" => {
                    instructions.push_str(&format!(
                        "  - **FORMAT REQUIREMENT**: This section must be written as a list using bullet points (*) or numbered items.\n"
                    ));
                }
                _ => {}
            }

            // Add item format instructions if present
            let item_format = section.item_format.as_ref()
                .or(section.example_item_format.as_ref());

            if let Some(format) = item_format {
                instructions.push_str(&format!(
                    "  - Items in this section should follow the format: `{}`.\n",
                    format
                ));
            }

            // Add validation examples for Action Items sections
            if section.title.to_lowercase().contains("action") {
                instructions.push_str(
                    "  - **CRITICAL TABLE FORMAT - MUST USE EXACT COLUMN NAMES:**\n\
                     The table header MUST be EXACTLY: | **Owner** | Task | Due | Reference Transcript Segment | Segment Time stamp |\n\
                     DO NOT use: 'Action', 'Task ID (if noted)', 'Task ID', or any other column names.\n\
                     The FIRST column MUST be 'Owner' (or '**Owner**'), the SECOND column MUST be 'Task', the THIRD column MUST be 'Due'.\n\
                     - **VALIDATION EXAMPLES:**\n\
                     * CORRECT HEADER: | **Owner** | Task | Due | Reference Transcript Segment | Segment Time stamp |\n\
                     * CORRECT ROW: | Two developers | Fix Stripe webhook (PROJ-404) | Before noon today | Not specified | Not specified |\n\
                     * WRONG HEADER: | Action | Task ID (if noted) | Due | ... | (Missing Owner column!)\n\
                     * WRONG HEADER: | Task | Owner | Due | ... | (Wrong column order!)\n\
                     * BAD ROW: | No blocker | Stripe debugging continues | None | ... |\n\
                     * BAD ROW: | None | Task description | TBD | ... |\n\
                     * NEVER use: 'No blocker', 'None', 'TBD', 'N/A', 'None noted in this section', or transcript chunk references as values.\n\
                     * If information is missing, use 'Not specified' (not 'None' or 'TBD').\n"
                );
            }
        }

        instructions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_valid_template() {
        let template = Template {
            name: "Test Template".to_string(),
            description: "A test template".to_string(),
            sections: vec![
                TemplateSection {
                    title: "Summary".to_string(),
                    instruction: "Provide a summary".to_string(),
                    format: "paragraph".to_string(),
                    item_format: None,
                    example_item_format: None,
                },
            ],
        };

        assert!(template.validate().is_ok());
    }

    #[test]
    fn test_validate_empty_name() {
        let template = Template {
            name: "".to_string(),
            description: "A test template".to_string(),
            sections: vec![],
        };

        assert!(template.validate().is_err());
    }

    #[test]
    fn test_validate_invalid_format() {
        let template = Template {
            name: "Test".to_string(),
            description: "Test".to_string(),
            sections: vec![
                TemplateSection {
                    title: "Test".to_string(),
                    instruction: "Test".to_string(),
                    format: "invalid".to_string(),
                    item_format: None,
                    example_item_format: None,
                },
            ],
        };

        assert!(template.validate().is_err());
    }
}
