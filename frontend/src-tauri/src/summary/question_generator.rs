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
    // CRITICAL: Make prompt more direct and ensure questions are always generated
    let prompt = format!(
        r#"You are a meeting facilitator analyzing a transcript to identify items that need clarification from meeting participants.

Recent context:
{}
Current transcript:
{}

IMPORTANT: You MUST generate at least 1 clarifying question. Even if everything seems clear, find something to ask about.

Analyze the meeting content and generate 2-5 concise clarifying questions that should be asked to the meeting participants.

Focus on identifying:
1. **Missing Assignees**: Action items or tasks mentioned without a clear owner
2. **Unclear Deadlines**: Tasks without specific due dates or vague timelines ("soon", "later")
3. **Ambiguous Requirements**: Items that need more specific definition or acceptance criteria
4. **Missing Priorities**: Tasks that lack urgency/importance classification
5. **Unclear Dependencies**: References to blockers or prerequisites that aren't well defined
6. **Next Steps**: What should happen next?
7. **Decisions**: What decisions need to be made?

IMPORTANT GUIDELINES:
- ALWAYS generate at least 1 question, even if you have to be creative
- Questions should be SHORT and DIRECT (1-2 sentences max)
- Questions should be suitable for posting in a meeting chat
- Questions should be actionable - asking for specific information
- Use names if mentioned in the transcript
- Format questions conversationally, as if you're asking in the meeting
- End each question with a question mark "?"

EXAMPLE QUESTIONS:
- "Who will be handling the Stripe webhook fix?"
- "What's the deadline for the API documentation?"
- "Can we confirm the priority for the VPN issue - is it blocking the release?"
- "Is the database migration dependent on the auth service being ready?"
- "What are the next steps for this project?"

Return ONLY a JSON array of question strings. Example:
["Who should be assigned to this task?", "What is the deadline for this?"]

CRITICAL: Always return at least 1 question. Never return an empty array."#,
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
    
    // Store response for fallback use
    let response_clone = response.clone();
    
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
    
    // Log all raw questions for debugging
    for (idx, q) in questions.iter().enumerate() {
        info!("   Raw question {}: '{}'", idx + 1, q);
    }
    
    let questions_before_filter = questions.len();
    let mut filtered_questions: Vec<String> = questions
        .iter()
        .map(|text| text.trim().to_string())
        .filter(|text| {
            // RELAXED filtering - only basic quality checks
            let trimmed = text.trim();
            
            // Basic quality checks - very permissive
            let passes = !trimmed.is_empty()
                && trimmed.len() <= 300 // Increased max to 300 chars
                && trimmed.len() >= 5   // Reduced min to 5 chars (very short questions are OK)
                && (trimmed.ends_with('?') || trimmed.ends_with('.')); // Allow questions or statements
            
            if !passes {
                warn!("🚫 [Question Gen] Filtered out question (basic check failed): '{}'", &trimmed[..trimmed.len().min(50)]);
            } else {
                info!("✅ [Question Gen] Question passed basic filter: '{}'", &trimmed[..trimmed.len().min(100)]);
            }
            passes
        })
        .collect();
    
    // CRITICAL FIX: If no questions passed filter, use the first raw question anyway (very permissive fallback)
    // This ensures we always show something if the LLM generated questions
    if filtered_questions.is_empty() && questions_before_filter > 0 {
        warn!("⚠️ [Question Gen] All questions filtered out, but we have {} raw questions. Using first one anyway.", questions_before_filter);
        // Use the first raw question from the original list
        if let Some(first_q) = questions.first() {
            let trimmed_q = first_q.trim();
            if !trimmed_q.is_empty() {
                info!("✅ [Question Gen] Using fallback question: '{}'", &trimmed_q[..trimmed_q.len().min(100)]);
                filtered_questions.push(trimmed_q.to_string());
            }
        }
        
        // If still empty, try to extract from response text
        if filtered_questions.is_empty() {
            let extracted = extract_questions_from_text(&response_clone);
            if let Some(first_q) = extracted.first() {
                info!("✅ [Question Gen] Using extracted fallback question: '{}'", &first_q[..first_q.len().min(100)]);
                filtered_questions.push(first_q.clone());
            }
        }
    }
    
    // Convert to Question structs
    let questions: Vec<Question> = filtered_questions
        .into_iter()
        .map(|text| {
            Question {
                text: text.to_string(),
                context: transcript_chunk.to_string(),
            }
        })
        .take(3) // Take up to 3 questions (frontend will show first one)
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
