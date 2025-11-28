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

    // General prompt for meeting facilitation - similar to backend implementation
    let prompt = format!(
        r#"You are a meeting facilitator analyzing a transcript to identify items that need clarification from meeting participants.

Recent context:
{}
Current transcript:
{}

Analyze the meeting content and generate 1-3 concise clarifying questions that should be asked to the meeting participants.

Focus on identifying:
1. **Missing Assignees**: Action items or tasks mentioned without a clear owner
2. **Unclear Deadlines**: Tasks without specific due dates or vague timelines ("soon", "later")
3. **Ambiguous Requirements**: Items that need more specific definition or acceptance criteria
4. **Missing Priorities**: Tasks that lack urgency/importance classification
5. **Unclear Dependencies**: References to blockers or prerequisites that aren't well defined

IMPORTANT GUIDELINES:
- Questions should be SHORT and DIRECT (1-2 sentences max, under 100 words)
- Questions should be suitable for posting in a meeting chat
- Questions should be actionable - asking for specific information
- Use names if mentioned in the transcript
- Don't ask about items that are already clearly defined
- Each question should address a DIFFERENT gap in information
- Format questions conversationally, as if you're asking in the meeting

EXAMPLE QUESTIONS:
- "Who will be handling the Stripe webhook fix?"
- "What's the deadline for the API documentation?"
- "Can we confirm the priority for the VPN issue - is it blocking the release?"
- "Is the database migration dependent on the auth service being ready?"

Return ONLY a JSON array of question strings. Example:
["Who should be assigned to this task?", "What is the deadline for this?"]

If everything is clear and no clarification is needed, return: []"#,
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

    // Parse response - expect JSON array, but handle various formats
    info!("🔍 [Question Gen] Raw LLM response length: {} chars", response.len());
    info!("🔍 [Question Gen] Raw LLM response preview: {}", &response[..response.len().min(200)]);
    
    let questions: Vec<String> = {
        // Try to parse as JSON first
        let trimmed = response.trim();
        
        // Try to extract JSON array from markdown code blocks or other formatting
        let json_start = trimmed.find('[').unwrap_or(0);
        let json_end = trimmed.rfind(']').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_candidate = &trimmed[json_start..json_end];
        
        match serde_json::from_str::<Vec<String>>(json_candidate) {
            Ok(parsed) => parsed,
            Err(e) => {
                warn!("⚠️ [Question Gen] Failed to parse as JSON: {}. Trying text extraction.", e);
                // If not JSON, try to extract questions from text
                extract_questions_from_text(&response)
            }
        }
    };

    info!("📋 [Question Gen] Parsed {} raw questions from LLM", questions.len());
    
    let questions_before_filter = questions.len();
    let questions: Vec<Question> = questions
        .into_iter()
        .map(|text| text.trim().to_string())
        .filter(|text| {
            // More relaxed filtering - focus on quality, not specific keywords
            let trimmed = text.trim();
            let lower = trimmed.to_lowercase();
            
            // Basic quality checks
            let passes = !trimmed.is_empty()
                && trimmed.len() <= 200 // Max 200 chars (reasonable for popup)
                && trimmed.len() >= 10  // Min 10 chars
                && trimmed.ends_with('?') // Must be a question
                && !lower.contains("can you") // Avoid overly generic questions
                && !lower.contains("could you")
                && !lower.contains("would you")
                && !lower.starts_with("please") // Avoid polite requests that aren't questions
                && !lower.contains("i need") // Avoid statements
                && !lower.contains("we should"); // Avoid suggestions
            
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
        .take(1) // Only take the first (best) question for popup display
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
    // Improved extraction: look for questions in various formats
    let mut questions = Vec::new();
    
    // Try to find JSON-like arrays in the text
    if let Some(start) = text.find('[') {
        if let Some(end) = text[start..].find(']') {
            let array_candidate = &text[start..start + end + 1];
            if let Ok(parsed) = serde_json::from_str::<Vec<String>>(array_candidate) {
                questions.extend(parsed);
            }
        }
    }
    
    // Also extract questions from lines ending with "?"
    for line in text.lines() {
        let trimmed = line.trim();
        // Remove common prefixes and extract question
        let cleaned = trimmed
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim_start_matches("• ")
            .trim_start_matches("\"")
            .trim_end_matches("\"")
            .trim();
        
        if cleaned.ends_with('?') && cleaned.len() > 10 && cleaned.len() <= 200 {
            questions.push(cleaned.to_string());
        }
    }
    
    // Remove duplicates and return
    questions.sort();
    questions.dedup();
    questions
}
