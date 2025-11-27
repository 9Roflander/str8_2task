use crate::database::repositories::{
    meeting::MeetingsRepository, setting::SettingsRepository, summary::SummaryProcessesRepository,
};
use crate::summary::llm_client::LLMProvider;
use crate::summary::processor::{extract_meeting_name_from_markdown, generate_meeting_summary};
use crate::ollama::metadata::ModelMetadataCache;
use sqlx::SqlitePool;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tracing::{error, info, warn};
use once_cell::sync::Lazy;

// Global cache for model metadata (5 minute TTL)
static METADATA_CACHE: Lazy<ModelMetadataCache> = Lazy::new(|| {
    ModelMetadataCache::new(Duration::from_secs(300))
});

/// Summary service - handles all summary generation logic
pub struct SummaryService;

impl SummaryService {
    /// Processes transcript in the background and generates summary
    ///
    /// This function is designed to be spawned as an async task and does not block
    /// the main thread. It updates the database with progress and results.
    ///
    /// # Arguments
    /// * `_app` - Tauri app handle (for future use)
    /// * `pool` - SQLx connection pool
    /// * `meeting_id` - Unique identifier for the meeting
    /// * `text` - Full transcript text
    /// * `model_provider` - LLM provider name (e.g., "ollama", "openai")
    /// * `model_name` - Specific model (e.g., "gpt-4", "llama3.2:latest")
    /// * `custom_prompt` - Optional user-provided context
    /// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
    pub async fn process_transcript_background<R: tauri::Runtime>(
        _app: AppHandle<R>,
        pool: SqlitePool,
        meeting_id: String,
        text: String,
        model_provider: String,
        model_name: String,
        custom_prompt: String,
        template_id: String,
    ) {
        let start_time = Instant::now();
        info!(
            "🚀 Starting background processing for meeting_id: {}",
            meeting_id
        );

        // Update status to processing when background task actually starts
        // But first check if this process has been cancelled (status is not PENDING)
        let current_process = SummaryProcessesRepository::get_summary_data(&pool, &meeting_id).await;
        match current_process {
            Ok(Some(proc)) if proc.status != "PENDING" => {
                warn!(
                    "⚠️ Process for meeting_id {} is no longer PENDING (status: {}), cancelling background task",
                    meeting_id, proc.status
                );
                return; // Exit early - this process was superseded
            }
            Ok(None) => {
                warn!(
                    "⚠️ Process entry not found for meeting_id {}, cancelling background task",
                    meeting_id
                );
                return; // Exit early - process was deleted
            }
            _ => {} // Process is PENDING, continue
        }
        
        if let Err(e) = SummaryProcessesRepository::update_process_processing(&pool, &meeting_id).await {
            error!(
                "⚠️ Failed to update status to processing for {}: {}",
                meeting_id, e
            );
        } else {
            info!("✓ Status updated to 'processing' for meeting_id: {}", meeting_id);
        }

        // Parse provider
        let provider = match LLMProvider::from_str(&model_provider) {
            Ok(p) => p,
            Err(e) => {
                Self::update_process_failed(&pool, &meeting_id, &e).await;
                return;
            }
        };

        // Validate and setup api_key, Flexible for Ollama
        let api_key = match SettingsRepository::get_api_key(&pool, &model_provider).await {
            Ok(Some(key)) if !key.is_empty() => key,
            Ok(None) | Ok(Some(_)) => {
                if provider != LLMProvider::Ollama {
                    let err_msg = format!("Api key not found for {}", &model_provider);
                    Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                    return;
                }
                String::new()
            }
            Err(e) => {
                let err_msg = format!("Failed to retrieve api key for {} : {}", &model_provider, e);
                Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                return;
            }
        };

        // Get Ollama endpoint if provider is Ollama
        let ollama_endpoint = if provider == LLMProvider::Ollama {
            match SettingsRepository::get_model_config(&pool).await {
                Ok(Some(config)) => config.ollama_endpoint,
                Ok(None) => None,
                Err(e) => {
                    info!("Failed to retrieve Ollama endpoint: {}, using default", e);
                    None
                }
            }
        } else {
            None
        };

        // Verify Ollama connectivity if using Ollama
        if provider == LLMProvider::Ollama {
            let endpoint = ollama_endpoint.as_deref().unwrap_or("http://localhost:11434");
            info!("🔍 Verifying Ollama connectivity at: {}", endpoint);
            let test_client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());
            
            match test_client.get(&format!("{}/api/tags", endpoint)).send().await {
                Ok(resp) if resp.status().is_success() => {
                    info!("✓ Ollama is reachable at {}", endpoint);
                }
                Ok(resp) => {
                    let error_msg = format!("Ollama returned error status {} at {}", resp.status(), endpoint);
                    error!("❌ {}", error_msg);
                    Self::update_process_failed(&pool, &meeting_id, &error_msg).await;
                    return;
                }
                Err(e) => {
                    let error_msg = format!("Cannot connect to Ollama at {}: {}. Please ensure Ollama is running.", endpoint, e);
                    error!("❌ {}", error_msg);
                    Self::update_process_failed(&pool, &meeting_id, &error_msg).await;
                    return;
                }
            }
        }

        // Dynamically fetch context size for Ollama models
        let token_threshold = if provider == LLMProvider::Ollama {
            match METADATA_CACHE.get_or_fetch(&model_name, ollama_endpoint.as_deref()).await {
                Ok(metadata) => {
                    // Reserve 300 tokens for prompt overhead
                    let optimal = metadata.context_size.saturating_sub(300);
                    info!(
                        "✓ Using dynamic context for {}: {} tokens (chunk size: {})",
                        model_name, metadata.context_size, optimal
                    );
                    optimal
                }
                Err(e) => {
                    warn!(
                        "⚠️ Failed to fetch context for {}: {}. Using default 4000",
                        model_name, e
                    );
                    4000  // Fallback to safe default
                }
            }
        } else {
            // Cloud providers (OpenAI, Claude, Groq) handle large contexts automatically
            100000  // Effectively unlimited for single-pass processing
        };

        // Generate summary
        // Create HTTP client with extended timeout for long-running LLM requests
        // 30 minutes timeout to match frontend polling timeout
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1800)) // 30 minutes
            .build()
            .unwrap_or_else(|_| reqwest::Client::new()); // Fallback to default if builder fails
        
        let text_preview = if text.len() > 200 {
            format!("{}...", &text[..200])
        } else {
            text.clone()
        };
        info!(
            "📝 Starting summary generation: provider={:?}, model={}, text_length={}, token_threshold={}",
            provider, model_name, text.len(), token_threshold
        );
        info!("📝 Transcript preview in service: {}", text_preview);
        if text.is_empty() {
            error!("❌ CRITICAL: Transcript text is EMPTY in process_transcript_background!");
        }
        
        let result = generate_meeting_summary(
            &client,
            &provider,
            &model_name,
            &api_key,
            &text,
            &custom_prompt,
            &template_id,
            token_threshold,
            ollama_endpoint.as_deref(),
        )
        .await;
        
        info!("📝 Summary generation call completed for meeting_id: {}", meeting_id);

        let duration = start_time.elapsed().as_secs_f64();

        match result {
            Ok((mut final_markdown, num_chunks)) => {
                // Before saving results, verify this process hasn't been cancelled
                let current_process = SummaryProcessesRepository::get_summary_data(&pool, &meeting_id).await;
                match current_process {
                    Ok(Some(proc)) if proc.status != "processing" => {
                        warn!(
                            "⚠️ Process for meeting_id {} is no longer processing (status: {}), discarding results",
                            meeting_id, proc.status
                        );
                        return; // Exit early - this process was cancelled/superseded
                    }
                    Ok(None) => {
                        warn!(
                            "⚠️ Process entry not found for meeting_id {}, discarding results",
                            meeting_id
                        );
                        return; // Exit early - process was deleted
                    }
                    _ => {} // Process is still processing, continue
                }
                
                if num_chunks == 0 && final_markdown.is_empty() {
                    Self::update_process_failed(
                        &pool,
                        &meeting_id,
                        "Summary generation failed: No content was processed.",
                    )
                    .await;
                    return;
                }

                info!(
                    "✓ Successfully processed {} chunks for meeting_id: {}. Duration: {:.2}s",
                    num_chunks, meeting_id, duration
                );
                info!("final markdown is {}", &final_markdown);

                // Extract and update meeting name if present
                if let Some(name) = extract_meeting_name_from_markdown(&final_markdown) {
                    if !name.is_empty() {
                        info!(
                            "📝 Updating meeting name to '{}' for meeting_id: {}",
                            name, meeting_id
                        );
                        if let Err(e) =
                            MeetingsRepository::update_meeting_title(&pool, &meeting_id, &name).await
                        {
                            error!("⚠️ Failed to update meeting name for {}: {}", meeting_id, e);
                        }

                        // Strip the title line from markdown
                        info!("✂️ Stripping title from final_markdown");
                        if let Some(hash_pos) = final_markdown.find('#') {
                            // Find end of first line after '#'
                            let body_start =
                                if let Some(line_end) = final_markdown[hash_pos..].find('\n') {
                                    hash_pos + line_end
                                } else {
                                    final_markdown.len() // No newline, whole string is title
                                };

                            final_markdown = final_markdown[body_start..].trim_start().to_string();
                        } else {
                            // No '#' found, clear the string
                            final_markdown.clear();
                        }
                    }
                }

                // Create result JSON with markdown only (summary_json will be added on first edit)
                let result_json = serde_json::json!({
                    "markdown": final_markdown,
                });

                // Update database with completed status
                if let Err(e) = SummaryProcessesRepository::update_process_completed(
                    &pool,
                    &meeting_id,
                    result_json,
                    num_chunks,
                    duration,
                )
                .await
                {
                    error!(
                        "⚠️ Failed to save completed process for {}: {}",
                        meeting_id, e
                    );
                } else {
                    info!(
                        "💾 Summary saved successfully for meeting_id: {}",
                        meeting_id
                    );
                }
            }
            Err(e) => {
                Self::update_process_failed(&pool, &meeting_id, &e).await;
            }
        }
    }

    /// Updates the summary process status to failed with error message
    ///
    /// # Arguments
    /// * `pool` - SQLx connection pool
    /// * `meeting_id` - Meeting identifier
    /// * `error_msg` - Error message to store
    async fn update_process_failed(pool: &SqlitePool, meeting_id: &str, error_msg: &str) {
        error!(
            "❌ Processing failed for meeting_id {}: {}",
            meeting_id, error_msg
        );
        if let Err(e) =
            SummaryProcessesRepository::update_process_failed(pool, meeting_id, error_msg).await
        {
            error!(
                "⚠️ Failed to update DB status to failed for {}: {}",
                meeting_id, e
            );
        }
    }
}
