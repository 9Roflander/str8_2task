use crate::summary::llm_client::{LLMProvider, generate_summary};
use std::str::FromStr;
use crate::database::repositories::setting::SettingsRepository;
use sqlx::SqlitePool;
use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
pub struct Question {
    pub text: String,
    pub context: String, // The transcript chunk that triggered the question
}

/// Save questions and inputs to a text file for debugging
fn save_question_debug(
    transcript_chunk: &str,
    recent_context: &str,
    prompt: &str,
    llm_response: &str,
    questions: &[Question],
) {
    // Try to save to a debug file - try multiple locations
    let mut path = None;
    
    // Try current directory first
    if let Ok(mut current_path) = std::env::current_dir() {
        current_path.push("question_debug.txt");
        if OpenOptions::new().create(true).append(true).open(&current_path).is_ok() {
            path = Some(current_path);
        }
    }
    
    // Try home directory if current dir failed
    if path.is_none() {
        if let Some(home) = std::env::var_os("HOME") {
            let mut home_path = PathBuf::from(home);
            home_path.push("question_debug.txt");
            if OpenOptions::new().create(true).append(true).open(&home_path).is_ok() {
                path = Some(home_path);
            }
        }
    }
    
    // Try temp directory as last resort
    if path.is_none() {
        if let Ok(temp) = std::env::var("TMPDIR") {
            let mut temp_path = PathBuf::from(temp);
            temp_path.push("question_debug.txt");
            if OpenOptions::new().create(true).append(true).open(&temp_path).is_ok() {
                path = Some(temp_path);
            }
        } else if let Ok(temp) = std::env::var("TEMP") {
            let mut temp_path = PathBuf::from(temp);
            temp_path.push("question_debug.txt");
            if OpenOptions::new().create(true).append(true).open(&temp_path).is_ok() {
                path = Some(temp_path);
            }
        }
    }
    
    let path = match path {
        Some(p) => p,
        None => {
            warn!("⚠️ [Question Gen] Could not open debug file in any location");
            return;
        }
    };
    
    let mut file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(f) => f,
        Err(e) => {
            warn!("⚠️ [Question Gen] Failed to open debug file: {}", e);
            return;
        }
    };
    
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    if let Err(e) = writeln!(file, "\n{}", "=".repeat(80)) {
        warn!("⚠️ [Question Gen] Failed to write to debug file: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "TIMESTAMP: {}", timestamp) {
        warn!("⚠️ [Question Gen] Failed to write timestamp: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "\n--- TRANSCRIPT CHUNK ({} chars) ---", transcript_chunk.len()) {
        warn!("⚠️ [Question Gen] Failed to write transcript chunk header: {}", e);
        return;
    }
    if let Err(e) = writeln!(file, "{}", transcript_chunk) {
        warn!("⚠️ [Question Gen] Failed to write transcript chunk: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "\n--- RECENT CONTEXT ({} chars) ---", recent_context.len()) {
        warn!("⚠️ [Question Gen] Failed to write recent context header: {}", e);
        return;
    }
    if let Err(e) = writeln!(file, "{}", recent_context) {
        warn!("⚠️ [Question Gen] Failed to write recent context: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "\n--- PROMPT SENT TO LLM ({} chars) ---", prompt.len()) {
        warn!("⚠️ [Question Gen] Failed to write prompt header: {}", e);
        return;
    }
    if let Err(e) = writeln!(file, "{}", prompt) {
        warn!("⚠️ [Question Gen] Failed to write prompt: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "\n--- LLM RAW RESPONSE ({} chars) ---", llm_response.len()) {
        warn!("⚠️ [Question Gen] Failed to write LLM response header: {}", e);
        return;
    }
    if let Err(e) = writeln!(file, "{}", llm_response) {
        warn!("⚠️ [Question Gen] Failed to write LLM response: {}", e);
        return;
    }
    
    if let Err(e) = writeln!(file, "\n--- GENERATED QUESTIONS ({} total) ---", questions.len()) {
        warn!("⚠️ [Question Gen] Failed to write questions header: {}", e);
        return;
    }
    if questions.is_empty() {
        if let Err(e) = writeln!(file, "NO QUESTIONS GENERATED") {
            warn!("⚠️ [Question Gen] Failed to write no questions message: {}", e);
            return;
        }
    } else {
        for (idx, q) in questions.iter().enumerate() {
            if let Err(e) = writeln!(file, "{}. {}", idx + 1, q.text) {
                warn!("⚠️ [Question Gen] Failed to write question {}: {}", idx + 1, e);
                return;
            }
        }
    }
    
    if let Err(e) = writeln!(file, "\n{}\n", "=".repeat(80)) {
        warn!("⚠️ [Question Gen] Failed to write separator: {}", e);
        return;
    }
    
    info!("✅ [Question Gen] Saved debug info to: {:?}", path);
    info!("📁 [Question Gen] Debug file location: {}", path.display());
    warn!("📁 [Question Gen] ⚠️ IMPORTANT: Question debug file saved to: {}", path.display());
    eprintln!("📁 [Question Gen] ⚠️ IMPORTANT: Question debug file saved to: {}", path.display());
}

/// Generate clarifying questions from transcript chunks
/// Returns questions when context is unclear (missing deadlines, owners, etc.)
pub async fn generate_questions(
    pool: &SqlitePool,
    transcript_chunk: &str,
    recent_context: &str, // Last few chunks for context
) -> Result<Vec<Question>, String> {
    // Log what we received
    info!("🔍 [Question Gen] Received transcript_chunk: {} chars, recent_context: {} chars", 
          transcript_chunk.len(), recent_context.len());
    info!("🔍 [Question Gen] transcript_chunk preview: {}", 
          &transcript_chunk[..transcript_chunk.len().min(200)]);
    info!("🔍 [Question Gen] recent_context preview: {}", 
          &recent_context[..recent_context.len().min(200)]);
    
    // RELAXED: Allow very short chunks (minimum 5 chars) for popup display
    if transcript_chunk.trim().len() < 5 {
        warn!("⚠️ [Question Gen] transcript_chunk is too short ({} chars), using fallback question", transcript_chunk.trim().len());
        // Return a generic question instead of empty
        return Ok(vec![Question {
            text: "What should we clarify about this?".to_string(),
            context: transcript_chunk.to_string(),
        }]);
    }

    // Get model config
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| {
            warn!("❌ [Question Gen] Failed to get model config from database: {}", e);
            format!("Failed to get model config: {}", e)
        })?;

    let config = config.ok_or_else(|| {
        warn!("❌ [Question Gen] Model config not found in database");
        "Model config not found. Please configure a model in Settings.".to_string()
    })?;
    
    info!("✅ [Question Gen] Model config loaded: provider={}, model={}", config.provider, config.model);
    
    // Parse provider
    let provider = LLMProvider::from_str(&config.provider)
        .map_err(|e| {
            warn!("❌ [Question Gen] Invalid provider '{}': {}", config.provider, e);
            format!("Invalid provider '{}': {}", config.provider, e)
        })?;

    // Get API key (not required for Ollama)
    let api_key = if provider == LLMProvider::Ollama {
        // Ollama doesn't require API key, use empty string
        info!("ℹ️ [Question Gen] Using Ollama provider (no API key required)");
        String::new()
    } else {
        SettingsRepository::get_api_key(pool, &config.provider)
            .await
            .map_err(|e| {
                warn!("❌ [Question Gen] Failed to get API key for provider '{}': {}", config.provider, e);
                format!("Failed to get API key: {}", e)
            })?
            .unwrap_or_else(|| {
                warn!("⚠️ [Question Gen] API key not found for provider '{}', using empty string", config.provider);
                String::new()
            })
    };
    
    // Validate API key for providers that require it (except Ollama)
    if api_key.is_empty() && provider != LLMProvider::Ollama {
        warn!("⚠️ [Question Gen] API key is empty for provider '{}', but continuing anyway", config.provider);
    } else if !api_key.is_empty() {
        info!("✅ [Question Gen] API key loaded (length: {} chars)", api_key.len());
    }

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
    
    info!("🚀 [Question Gen] Calling LLM with provider={:?}, model={}, endpoint={:?}", 
          provider, config.model, config.ollama_endpoint);
    
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
    .map_err(|e| {
        error!("❌ [Question Gen] LLM call failed: {}", e);
        format!("Failed to generate questions from LLM: {}. Please check your model configuration and API keys.", e)
    })?;
    
    info!("✅ [Question Gen] LLM response received: {} chars", response.len());

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
    // ULTRA-RELAXED filtering for popup display - accept almost anything
    let mut filtered_questions: Vec<String> = questions
        .iter()
        .map(|text| text.trim().to_string())
        .filter(|text| {
            let trimmed = text.trim();
            // MINIMAL checks: just not empty and not absurdly long (for popup display)
            let passes = !trimmed.is_empty() && trimmed.len() <= 1000;
            
            if !passes {
                warn!("🚫 [Question Gen] Filtered out (empty or too long): '{}'", &trimmed[..trimmed.len().min(50)]);
            } else {
                info!("✅ [Question Gen] Question accepted: '{}'", &trimmed[..trimmed.len().min(100)]);
            }
            passes
        })
        .collect();
    
    // AGGRESSIVE FALLBACK: If no questions passed, use ANY raw question
    if filtered_questions.is_empty() && questions_before_filter > 0 {
        warn!("⚠️ [Question Gen] All questions filtered, using raw questions without any filtering");
        // Accept ANY non-empty question, even if very long
        for q in &questions {
            let trimmed_q = q.trim();
            if !trimmed_q.is_empty() {
                // Truncate if too long, but still use it
                let final_q = if trimmed_q.len() > 1000 {
                    format!("{}...", &trimmed_q[..997])
                } else {
                    trimmed_q.to_string()
                };
                info!("✅ [Question Gen] Using raw question (no filtering): '{}'", &final_q[..final_q.len().min(100)]);
                filtered_questions.push(final_q);
                break; // Take first one
            }
        }
    }
    
    // If still empty, extract from response with ultra-relaxed rules
    if filtered_questions.is_empty() {
        let extracted = extract_questions_from_text(&response_clone);
        for q in &extracted {
            let trimmed_q = q.trim();
            if !trimmed_q.is_empty() {
                let final_q = if trimmed_q.len() > 1000 {
                    format!("{}...", &trimmed_q[..997])
                } else {
                    trimmed_q.to_string()
                };
                info!("✅ [Question Gen] Using extracted question: '{}'", &final_q[..final_q.len().min(100)]);
                filtered_questions.push(final_q);
                break;
            }
        }
    }
    
    // FINAL FALLBACK: Use generic question if we have ANY response
    if filtered_questions.is_empty() && !response_clone.trim().is_empty() {
        warn!("⚠️ [Question Gen] No questions extracted, using generic fallback");
        filtered_questions.push("Can you provide more details about this?".to_string());
    }
    
    // ABSOLUTE LAST RESORT: If response is empty, still generate a question
    if filtered_questions.is_empty() {
        warn!("⚠️ [Question Gen] Response was empty, using default question");
        filtered_questions.push("What should we clarify about this?".to_string());
    }
    
    // Convert to Question structs
    // Take up to 5 questions for popup (frontend will show first one)
    // CRITICAL: Always return at least 1 question if we have any
    let questions: Vec<Question> = if filtered_questions.is_empty() {
        // This should never happen due to fallbacks, but just in case
        vec![Question {
            text: "What needs clarification?".to_string(),
            context: transcript_chunk.to_string(),
        }]
    } else {
        filtered_questions
            .into_iter()
            .map(|text| {
                Question {
                    text: text.to_string(),
                    context: transcript_chunk.to_string(),
                }
            })
            .take(5) // Up to 5 questions for popup display
            .collect()
    };

    info!("📊 [Question Gen] Filtering results: {} before, {} after", questions_before_filter, questions.len());
    
    // Log the full prompt being sent
    info!("🔍 [Question Gen] Full prompt length: {} chars", prompt.len());
    info!("🔍 [Question Gen] Prompt preview: {}", &prompt[..prompt.len().min(500)]);
    
    if !questions.is_empty() {
        info!("✅ [Question Gen] Generated {} clarifying question(s)", questions.len());
        for (idx, q) in questions.iter().enumerate() {
            info!("   Question {}: '{}'", idx + 1, q.text);
        }
    } else {
        info!("ℹ️ [Question Gen] No questions generated (all filtered out or LLM returned empty)");
    }
    
    // Save to debug file
    save_question_debug(
        transcript_chunk,
        recent_context,
        &prompt,
        &response,
        &questions,
    );

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
    
    // ULTRA-RELAXED extraction: accept almost any line for popup display
    for line in text.lines() {
        let trimmed = line.trim();
        // Remove common prefixes
        let cleaned = trimmed
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim_start_matches("• ")
            .trim_start_matches("\"")
            .trim_start_matches("'")
            .trim_start_matches("1. ")
            .trim_start_matches("2. ")
            .trim_start_matches("3. ")
            .trim_start_matches("4. ")
            .trim_start_matches("5. ")
            .trim_end_matches("\"")
            .trim_end_matches("'")
            .trim();
        
        // ACCEPT ANY non-empty line that's not too long - no other requirements
        if !cleaned.is_empty() && cleaned.len() <= 1000 {
            questions.push(cleaned.to_string());
        }
    }
    
    // Remove duplicates and return
    questions.sort();
    questions.dedup();
    questions
}
