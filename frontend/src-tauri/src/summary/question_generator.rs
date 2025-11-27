use crate::summary::llm_client::{LLMProvider, generate_summary};
use std::str::FromStr;
use crate::database::repositories::setting::SettingsRepository;
use sqlx::SqlitePool;
use log::{info, warn};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Question {
    pub text: String,
    pub context: String, // The transcript chunk that triggered the question
}

/// Generate clarifying questions from transcript chunks
/// Returns questions when context is unclear (missing deadlines, owners, etc.)
pub async fn generate_questions(
    pool: &SqlitePool,
    transcript_chunk: &str,
    recent_context: &str, // Last few chunks for context
) -> Result<Vec<Question>, String> {
    if transcript_chunk.trim().is_empty() {
        return Ok(vec![]);
    }

    // Get model config
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to get model config: {}", e))?;

    let config = config.ok_or_else(|| "Model config not found".to_string())?;
    
    // Parse provider
    let provider = LLMProvider::from_str(&config.provider)
        .map_err(|e| format!("Invalid provider: {}", e))?;

    let api_key = SettingsRepository::get_api_key(pool, &config.provider)
        .await
        .map_err(|e| format!("Failed to get API key: {}", e))?
        .unwrap_or_default();

    // Focused prompt for Jira task creation
    let prompt = format!(
        r#"You are an AI Scrum Master preparing to create Jira tasks. Analyze this meeting transcript and identify ONLY critical missing information needed to create actionable Jira tasks.

Focus STRICTLY on:
- WHO will do the task? (assignee/owner)
- WHEN is it due? (deadline/sprint)
- WHAT exactly needs to be done? (clear task description)
- WHAT defines "done"? (acceptance criteria)
- HOW urgent is it? (priority)

Recent context:
{}
Current transcript:
{}

Generate ONLY 1 concise question (max 50 words) if critical information is missing for Jira task creation.
Questions must be:
- Short and direct (under 50 words)
- Actionable (answer helps create Jira task)
- Focused on task assignment, deadlines, or clear requirements

Return ONLY a JSON array of strings. Example:
["Who should be assigned to this task?"]
or
["What is the deadline for this?"]

If everything needed for Jira task creation is clear, return: []"#,
        recent_context,
        transcript_chunk
    );

    // Use lightweight model for quick question generation
    // Create HTTP client with extended timeout for long-running LLM requests
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800)) // 30 minutes
        .build()
        .unwrap_or_else(|_| reqwest::Client::new()); // Fallback to default if builder fails
    let response = generate_summary(
        &client,
        &provider,
        &config.model,
        &api_key,
        "", // system prompt
        &prompt,
        config.ollama_endpoint.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to generate questions: {}", e))?;

    // Parse response - expect JSON array
    info!("🔍 [Question Gen] Raw LLM response length: {} chars", response.len());
    info!("🔍 [Question Gen] Raw LLM response preview: {}", &response[..response.len().min(200)]);
    
    let questions: Vec<String> = serde_json::from_str(&response)
        .unwrap_or_else(|e| {
            warn!("⚠️ [Question Gen] Failed to parse as JSON: {}. Trying text extraction.", e);
            // If not JSON, try to extract questions from text
            extract_questions_from_text(&response)
        });

    info!("📋 [Question Gen] Parsed {} raw questions from LLM", questions.len());
    
    let questions_before_filter = questions.len();
    let questions: Vec<Question> = questions
        .into_iter()
        .map(|text| text.trim().to_string())
        .filter(|text| {
            // Filter out questions that are too long or irrelevant
            let trimmed = text.trim();
            let lower = trimmed.to_lowercase();
            let passes = !trimmed.is_empty()
                && trimmed.len() <= 150 // Max 150 chars (shorter for Jira focus)
                && trimmed.len() >= 10  // Min 10 chars
                && trimmed.ends_with('?') // Must be a question
                && !lower.contains("can you") // Avoid generic questions
                && !lower.contains("could you")
                && !lower.contains("would you")
                && (lower.contains("who") || lower.contains("when") || lower.contains("what") || lower.contains("deadline") || lower.contains("assign") || lower.contains("due") || lower.contains("priority") || lower.contains("owner") || lower.contains("responsible")); // Must be Jira-relevant
            
            if !passes {
                info!("🚫 [Question Gen] Filtered out question: '{}'", &trimmed[..trimmed.len().min(50)]);
            }
            passes
        })
        .map(|text| {
            info!("✅ [Question Gen] Question passed filter: '{}'", &text[..text.len().min(100)]);
            Question {
                text: text.to_string(),
                context: transcript_chunk.to_string(),
            }
        })
        .take(1) // Only take the first (best) question
        .collect();

    info!("📊 [Question Gen] Filtering results: {} before, {} after", questions_before_filter, questions.len());
    
    if !questions.is_empty() {
        info!("✅ [Question Gen] Generated {} clarifying question(s)", questions.len());
        for (idx, q) in questions.iter().enumerate() {
            info!("   Question {}: '{}'", idx + 1, q.text);
        }
    } else {
        info!("ℹ️ [Question Gen] No questions generated (all filtered out or LLM returned empty)");
    }

    Ok(questions)
}

fn extract_questions_from_text(text: &str) -> Vec<String> {
    // Simple extraction: look for lines ending with "?"
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.ends_with('?') && trimmed.len() > 10 {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
        .collect()
}
