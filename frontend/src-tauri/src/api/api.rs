use log::{debug as log_debug, error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::{
    database::{
        models::MeetingModel,
        repositories::{
            meeting::MeetingsRepository, setting::SettingsRepository,
            transcript::TranscriptsRepository,
        },
    },
    state::AppState,
};

// Hardcoded server URL
const APP_SERVER_URL: &str = "http://localhost:5167";

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSearchResult {
    pub id: String,
    pub title: String,
    #[serde(rename = "matchContext")]
    pub match_context: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileRequest {
    pub email: String,
    pub license_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveProfileRequest {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub email: String,
    pub license_key: String,
    pub company: String,
    pub position: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetApiKeyRequest {
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteMeetingRequest {
    pub meeting_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingDetails {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub transcripts: Vec<MeetingTranscript>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingTranscript {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // Recording-relative timestamps for audio-transcript synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingTitleRequest {
    pub meeting_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingSummaryRequest {
    pub meeting_id: String,
    pub summary: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptRequest {
    pub meeting_title: String,
    pub transcripts: Vec<TranscriptSegment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // NEW: Recording-relative timestamps for playback synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: Option<String>,
    pub email: String,
    pub license_key: String,
    pub company: Option<String>,
    pub position: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_licensed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraConfig {
    pub url: String,
    pub email: String,
    pub api_token: String,
    pub default_project_key: Option<String>,
    pub default_issue_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraTaskCreate {
    pub project_key: String,
    pub summary: String,
    pub description: String,
    pub issue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duedate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraAnalysisRequest {
    pub meeting_id: String,
    pub model: String,
    pub model_name: String,
    // Optional raw transcript text; when present, backend will use this
    // directly instead of fetching from its own database.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    // Project key for context-aware task generation (required)
    pub project_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraIssueUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,  // accountId or "-1" to unassign
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duedate: Option<String>,  // YYYY-MM-DD format
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customfield_10020: Option<String>,  // Start date (common custom field)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraCommentCreate {
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraTransitionRequest {
    pub transition_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

// Helper function to get auth token from store (optional)
#[allow(dead_code)]
async fn get_auth_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let store = match app.store("store.json") {
        Ok(store) => store,
        Err(_) => return None,
    };

    match store.get("authToken") {
        Some(token) => {
            if let Some(token_str) = token.as_str() {
                let truncated = token_str.chars().take(20).collect::<String>();
                log_info!("Found auth token: {}", truncated);
                Some(token_str.to_string())
            } else {
                log_warn!("Auth token is not a string");
                None
            }
        }
        None => {
            log_warn!("No auth token found in store");
            None
        }
    }
}

// Helper function to get server address - now hardcoded
async fn get_server_address<R: Runtime>(_app: &AppHandle<R>) -> Result<String, String> {
    log_info!("Using hardcoded server URL: {}", APP_SERVER_URL);
    Ok(APP_SERVER_URL.to_string())
}

// Generic API call function with optional authentication
async fn make_api_request<R: Runtime, T: for<'de> Deserialize<'de>>(
    app: &AppHandle<R>,
    endpoint: &str,
    method: &str,
    body: Option<&str>,
    additional_headers: Option<HashMap<String, String>>,
    auth_token: Option<String>, // Pass auth token from frontend
) -> Result<T, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let server_url = get_server_address(app).await?;

    let url = format!("{}{}", server_url, endpoint);
    log_info!("Making {} request to: {}", method, url);

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Add authorization header if auth token is provided
    if let Some(token) = auth_token {
        log_info!("Adding authorization header");
        request = request.header("Authorization", format!("Bearer {}", token));
    } else {
        log_warn!("No auth token provided, making unauthenticated request");
    }

    request = request.header("Content-Type", "application/json");

    // Add additional headers if provided
    if let Some(headers) = additional_headers {
        for (key, value) in headers {
            request = request.header(&key, &value);
        }
    }

    // Add body if provided
    if let Some(body_str) = body {
        request = request.body(body_str.to_string());
    }

    let response = request.send().await.map_err(|e| {
        let error_msg = format!("Request failed: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    let status = response.status();
    log_info!("Response status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let error_msg = format!("HTTP {}: {}", status, error_text);
        log_error!("{}", error_msg);
        return Err(error_msg);
    }

    let response_text = response.text().await.map_err(|e| {
        let error_msg = format!("Failed to read response: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    // Safely truncate response for logging, respecting UTF-8 character boundaries
    let truncated = response_text.chars().take(200).collect::<String>();
    log_info!("Response body: {}", truncated);

    serde_json::from_str(&response_text).map_err(|e| {
        let error_msg = format!("Failed to parse JSON: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })
}

// API Commands for Tauri

#[tauri::command]
pub async fn api_get_meetings<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Vec<Meeting>, String> {
    log_info!(
        "api_get_meetings called with auth_token(native) : {}",
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();
    let meetings: Result<Vec<MeetingModel>, sqlx::Error> =
        MeetingsRepository::get_meetings(pool).await;

    match meetings {
        Ok(meeting_models) => {
            log_info!("Successfully got {} meetings", meeting_models.len());

            let result: Vec<Meeting> = meeting_models
                .into_iter()
                .map(|m| Meeting {
                    id: m.id,
                    title: m.title,
                })
                .collect();
            Ok(result)
        }
        Err(e) => {
            log_error!("Error getting meetings: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_search_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
    auth_token: Option<String>,
) -> Result<Vec<TranscriptSearchResult>, String> {
    log_info!(
        "api_search_transcripts called with query: '{}', auth_token: {}",
        query,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    match TranscriptsRepository::search_transcripts(pool, &query).await {
        Ok(results) => {
            log_info!(
                "Search completed successfully with {} results.",
                results.len()
            );
            Ok(results)
        }
        Err(e) => {
            log_error!("Error searching transcripts for query '{}': {}", query, e);
            Err(format!("Failed to search transcripts: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_get_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    auth_token: Option<String>,
) -> Result<Profile, String> {
    log_info!(
        "api_get_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let profile_request = ProfileRequest { email, license_key };
    let body = serde_json::to_string(&profile_request).map_err(|e| e.to_string())?;

    make_api_request::<R, Profile>(&app, "/get-profile", "POST", Some(&body), None, auth_token)
        .await
}

#[tauri::command]
pub async fn api_save_profile<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    email: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let save_request = SaveProfileRequest { id, email };
    let body = serde_json::to_string(&save_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/save-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_update_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    company: String,
    position: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_update_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let update_request = UpdateProfileRequest {
        email,
        license_key,
        company,
        position,
    };
    let body = serde_json::to_string(&update_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/update-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_get_model_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<ModelConfig>, String> {
    log_info!("api_get_model_config called (native)");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_model_config(pool).await {
        Ok(Some(config)) => {
            log_info!(
                "✅ Found model config in database: provider={}, model={}, whisperModel={}, ollamaEndpoint={:?}",
                &config.provider,
                &config.model,
                &config.whisper_model,
                &config.ollama_endpoint
            );
            match SettingsRepository::get_api_key(pool, &config.provider).await {
                Ok(api_key) => {
                    log_info!("Successfully retrieved model config and API key.");
                    Ok(Some(ModelConfig {
                        provider: config.provider,
                        model: config.model,
                        whisper_model: config.whisper_model,
                        api_key,
                        ollama_endpoint: config.ollama_endpoint,
                    }))
                }
                Err(e) => {
                    log_error!(
                        "Failed to get API key for provider {}: {}",
                        &config.provider,
                        e
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            log_warn!("⚠️ No model config found in database - database may be empty or settings table not initialized");
            Ok(None)
        }
        Err(e) => {
            log_error!("❌ Failed to get model config from database: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_save_model_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "💾 api_save_model_config called (native): provider='{}', model='{}', whisperModel='{}', ollamaEndpoint={:?}",
        &provider,
        &model,
        &whisper_model,
        &ollama_endpoint
    );
    let pool = state.db_manager.pool();

    if let Err(e) = SettingsRepository::save_model_config(
        pool,
        &provider,
        &model,
        &whisper_model,
        ollama_endpoint.as_deref(),
    )
    .await
    {
        log_error!("❌ Failed to save model config to database: {}", e);
        return Err(e.to_string());
    }

    // Clone api_key for use in sync payload (needed because we use it below)
    let api_key_for_sync = api_key.clone();
    
    if let Some(key) = &api_key {
        if !key.is_empty() {
            log_info!("🔑 API key provided, saving...");
            if let Err(e) = SettingsRepository::save_api_key(pool, &provider, key).await {
                log_error!("❌ Failed to save API key: {}", e);
                return Err(e.to_string());
            }
        }
    }

    // Sync to Python backend as well
    log_info!("🔄 Syncing model configuration to Python backend...");
    let sync_payload = serde_json::json!({
        "provider": provider,
        "model": model,
        "whisperModel": whisper_model,
        "apiKey": api_key_for_sync
    });
    
    match make_api_request::<R, serde_json::Value>(
        &_app,
        "/save-model-config",
        "POST",
        Some(&sync_payload.to_string()),
        None,
        None,
    ).await {
        Ok(_) => {
            log_info!("✅ Successfully synced model configuration to Python backend");
        }
        Err(e) => {
            // Don't fail the whole operation if backend sync fails - just log a warning
            log_warn!("⚠️ Failed to sync to Python backend (this is non-critical): {}", e);
            log_warn!("⚠️ You may need to set GOOGLE_API_KEY environment variable or manually sync the API key");
        }
    }

    log_info!("✅ Successfully saved model configuration to database");
    Ok(
        serde_json::json!({ "status": "success", "message": "Model configuration saved successfully" }),
    )
}

#[tauri::command]
pub async fn api_get_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<String, String> {
    log_info!(
        "api_get_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::get_api_key(&state.db_manager.pool(), &provider).await {
        Ok(key) => {
            log_info!(
                "Successfully retrieved API key for provider '{}'.",
                &provider
            );
            Ok(key.unwrap_or_default())
        }
        Err(e) => {
            log_error!("Failed to get API key for provider '{}': {}", &provider, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_get_transcript_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<TranscriptConfig>, String> {
    log_info!("api_get_transcript_config called (native)");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_transcript_config(pool).await {
        Ok(Some(config)) => {
            log_info!(
                "Found transcript config: provider={}, model={}",
                &config.provider,
                &config.model
            );
            match SettingsRepository::get_transcript_api_key(pool, &config.provider).await {
                Ok(api_key) => {
                    log_info!("Successfully retrieved transcript config and API key.");
                    Ok(Some(TranscriptConfig {
                        provider: config.provider,
                        model: config.model,
                        api_key,
                    }))
                }
                Err(e) => {
                    log_error!(
                        "Failed to get transcript API key for provider {}: {}",
                        &config.provider,
                        e
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            log_info!("No transcript config found, returning default.");
            Ok(Some(TranscriptConfig {
                provider: "localWhisper".to_string(),
                model: "large-v3".to_string(),
                api_key: None,
            }))
        }
        Err(e) => {
            log_error!("Failed to get transcript config: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_save_transcript_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript_config called (native) for provider '{}'",
        &provider
    );
    let pool = state.db_manager.pool();

    if let Err(e) = SettingsRepository::save_transcript_config(pool, &provider, &model).await {
        log_error!("Failed to save transcript config: {}", e);
        return Err(e.to_string());
    }

    if let Some(key) = api_key {
        if !key.is_empty() {
            log_info!("API key provided, saving for transcript provider...");
            if let Err(e) = SettingsRepository::save_transcript_api_key(pool, &provider, &key).await
            {
                log_error!("Failed to save transcript API key: {}", e);
                return Err(e.to_string());
            }
        }
    }

    log_info!("Successfully saved transcript configuration.");
    Ok(
        serde_json::json!({ "status": "success", "message": "Transcript configuration saved successfully" }),
    )
}

#[tauri::command]
pub async fn api_get_transcript_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<String, String> {
    log_info!(
        "api_get_transcript_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::get_transcript_api_key(&state.db_manager.pool(), &provider).await {
        Ok(key) => {
            log_info!(
                "Successfully retrieved transcript API key for provider '{}'.",
                &provider
            );
            Ok(key.unwrap_or_default())
        }
        Err(e) => {
            log_error!(
                "Failed to get transcript API key for provider '{}': {}",
                &provider,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_delete_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<(), String> {
    log_info!(
        "log_api_delete_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::delete_api_key(&state.db_manager.pool(), &provider).await {
        Ok(_) => {
            log_info!("Successfully deleted API key for provider '{}'.", &provider);
            Ok(())
        }
        Err(e) => {
            log_error!(
                "Failed to delete API key for provider '{}': {}",
                &provider,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_delete_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_delete_meeting called for meeting_id(native): {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    match MeetingsRepository::delete_meeting(pool, &meeting_id).await {
        Ok(true) => {
            log_info!("Successfully deleted meeting {}", meeting_id);
            Ok(serde_json::json!({
                "status": "success",
                "message": "Meeting deleted successfully"
            }))
        }
        Ok(false) => {
            log_warn!("Meeting not found or already deleted: {}", meeting_id);
            Err(format!(
                "Meeting not found or could not be deleted: {}",
                meeting_id
            ))
        }
        Err(e) => {
            log_error!("Error deleting meeting {}: {}", meeting_id, e);
            Err(format!("Failed to delete meeting: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_get_meeting<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<MeetingDetails, String> {
    log_info!(
        "api_get_meeting called(native) for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    match MeetingsRepository::get_meeting(pool, &meeting_id).await {
        Ok(Some(meeting)) => {
            log_info!("Successfully retrieved meeting {}", meeting_id);
            Ok(meeting)
        }
        Ok(None) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error retrieving meeting {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve meeting: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_save_meeting_title<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    title: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_title called for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();
    match MeetingsRepository::update_meeting_title(pool, &meeting_id, &title).await {
        Ok(true) => {
            log_info!("Successfully saved meeting title");
            Ok(serde_json::json!({"message": "Meeting title saved successfully"}))
        }
        Ok(false) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error saving meeting title: {}", e);
            Err(format!("Failed to save meeting title: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_save_jira_config<R: Runtime>(
    app: AppHandle<R>,
    config: JiraConfig,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_save_jira_config called");
    let body = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/save-jira-config", "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_config<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_config called");
    make_api_request::<R, serde_json::Value>(&app, "/get-jira-config", "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_create_jira_task<R: Runtime>(
    app: AppHandle<R>,
    task: JiraTaskCreate,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_create_jira_task called");
    let body = serde_json::to_string(&task).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/create-jira-task", "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_analyze_jira_tasks<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    request: JiraAnalysisRequest,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let has_text = request
        .text
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let text_len = request.text.as_ref().map(|t| t.len()).unwrap_or(0);

    log_info!(
        "api_analyze_jira_tasks called (meeting_id={}, model={}, model_name={}, has_text={}, text_len={})",
        request.meeting_id,
        request.model,
        request.model_name,
        has_text,
        text_len
    );

    // If using Gemini, ensure API key is synced to backend
    if request.model.to_lowercase() == "gemini" {
        let pool = state.db_manager.pool();
        if let Ok(Some(api_key)) = SettingsRepository::get_api_key(pool, "gemini").await {
            if !api_key.is_empty() {
                log_info!("🔄 Ensuring Gemini API key is synced to backend before Jira analysis...");
                // Get model config to sync
                if let Ok(Some(config)) = SettingsRepository::get_model_config(pool).await {
                    let sync_payload = serde_json::json!({
                        "provider": "gemini",
                        "model": config.model,
                        "whisperModel": config.whisper_model,
                        "apiKey": api_key
                    });
                    
                    // Try to sync (non-blocking - don't fail if it doesn't work)
                    let _ = make_api_request::<R, serde_json::Value>(
                        &app,
                        "/save-model-config",
                        "POST",
                        Some(&sync_payload.to_string()),
                        None,
                        None,
                    ).await;
                }
            }
        }
    }

    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/analyze-jira-tasks", "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_projects<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_projects called");
    make_api_request::<R, serde_json::Value>(&app, "/get-jira-projects", "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_issue_types<R: Runtime>(
    app: AppHandle<R>,
    project_key: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_issue_types called for project: {}", project_key);
    let endpoint = format!("/get-jira-issue-types/{}", project_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_project_context<R: Runtime>(
    app: AppHandle<R>,
    project_key: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_project_context called for project: {}", project_key);
    let endpoint = format!("/get-jira-project-context/{}", project_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_search_jira_issues<R: Runtime>(
    app: AppHandle<R>,
    jql: String,
    max_results: Option<i32>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_search_jira_issues called with JQL: {}", jql);
    let max = max_results.unwrap_or(50);
    let endpoint = format!("/search-jira-issues?jql={}&max_results={}", urlencoding::encode(&jql), max);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_issue<R: Runtime>(
    app: AppHandle<R>,
    issue_key: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_issue called for issue: {}", issue_key);
    let endpoint = format!("/get-jira-issue/{}", issue_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_update_jira_issue<R: Runtime>(
    app: AppHandle<R>,
    issue_key: String,
    update: JiraIssueUpdate,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_update_jira_issue called for issue: {}", issue_key);
    let body = serde_json::to_string(&update).map_err(|e| e.to_string())?;
    let endpoint = format!("/update-jira-issue/{}", issue_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_add_jira_comment<R: Runtime>(
    app: AppHandle<R>,
    issue_key: String,
    comment: JiraCommentCreate,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_add_jira_comment called for issue: {}", issue_key);
    let body = serde_json::to_string(&comment).map_err(|e| e.to_string())?;
    let endpoint = format!("/add-jira-comment/{}", issue_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_get_jira_transitions<R: Runtime>(
    app: AppHandle<R>,
    issue_key: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_jira_transitions called for issue: {}", issue_key);
    let endpoint = format!("/get-jira-transitions/{}", issue_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "GET", None, None, auth_token).await
}

#[tauri::command]
pub async fn api_transition_jira_issue<R: Runtime>(
    app: AppHandle<R>,
    issue_key: String,
    transition: JiraTransitionRequest,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_transition_jira_issue called for issue: {} with transition_id: {}", issue_key, transition.transition_id);
    let body = serde_json::to_string(&transition).map_err(|e| e.to_string())?;
    let endpoint = format!("/transition-jira-issue/{}", issue_key);
    make_api_request::<R, serde_json::Value>(&app, &endpoint, "POST", Some(&body), None, auth_token).await
}

#[tauri::command]
pub async fn api_save_transcript<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_title: String,
    transcripts: Vec<serde_json::Value>,
    folder_path: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript called for meeting: {}, transcripts: {}, folder_path: {:?}, auth_token: {}",
        meeting_title,
        transcripts.len(),
        folder_path,
        auth_token.is_some()
    );

    // Log first transcript for debugging
    if let Some(first) = transcripts.first() {
        log_debug!(
            "First transcript data: {}",
            serde_json::to_string_pretty(first).unwrap_or_default()
        );
    }

    // Convert serde_json::Value to TranscriptSegment
    let transcripts_to_save: Vec<TranscriptSegment> = transcripts
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            log_error!("Failed to parse transcript segments: {}", e);
            format!("Invalid transcript data format: {}. Please check the data structure.", e)
        })?;

    // Log parsed segments count and first segment details
    if let Some(first_seg) = transcripts_to_save.first() {
        log_debug!("First parsed segment: text='{}', audio_start_time={:?}, audio_end_time={:?}, duration={:?}",
                   first_seg.text.chars().take(50).collect::<String>(),
                   first_seg.audio_start_time,
                   first_seg.audio_end_time,
                   first_seg.duration);
    }

    let pool = state.db_manager.pool();

    // Now, call the repository with the correctly typed data.
    match TranscriptsRepository::save_transcript(
        pool,
        &meeting_title,
        &transcripts_to_save,
        folder_path,
    )
    .await
    {
        Ok(meeting_id) => {
            log_info!(
                "Successfully saved transcript and created meeting with id: {}",
                meeting_id
            );
            Ok(serde_json::json!({
                "status": "success",
                "message": "Transcript saved successfully",
                "meeting_id": meeting_id
            }))
        }
        Err(e) => {
            log_error!(
                "Error saving transcript for meeting '{}': {}",
                meeting_title,
                e
            );
            Err(format!("Failed to save transcript: {}", e))
        }
    }
}

/// Opens the meeting's recording folder in the system file explorer
#[tauri::command]
pub async fn open_meeting_folder<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    log_info!("open_meeting_folder called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    // Get meeting with folder_path
    let meeting: Option<MeetingModel> = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    match meeting {
        Some(m) => {
            if let Some(folder_path) = m.folder_path {
                log_info!("Opening meeting folder: {}", folder_path);

                // Verify folder exists
                let path = std::path::Path::new(&folder_path);
                if !path.exists() {
                    log_warn!("Folder path does not exist: {}", folder_path);
                    return Err(format!("Recording folder not found: {}", folder_path));
                }

                // Open folder based on OS
                #[cfg(target_os = "macos")]
                {
                    std::process::Command::new("open")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new("explorer")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                #[cfg(target_os = "linux")]
                {
                    std::process::Command::new("xdg-open")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                log_info!("Successfully opened folder: {}", folder_path);
                Ok(())
            } else {
                log_warn!("Meeting {} has no folder_path set", meeting_id);
                Err("Recording folder path not available for this meeting".to_string())
            }
        }
        None => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err("Meeting not found".to_string())
        }
    }
}

// Simple test command to check backend connectivity
#[tauri::command]
pub async fn test_backend_connection<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<String, String> {
    log_debug!("Testing backend connection...");

    let client = reqwest::Client::new();
    let server_url = get_server_address(&app).await?;

    log_debug!("Testing connection to: {}", server_url);

    let mut request = client.get(&format!("{}/docs", server_url));

    if let Some(token) = auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("Backend responded with status: {}", status);
            Ok(format!("Backend is reachable. Status: {}", status))
        }
        Err(e) => {
            let error_msg = format!("Failed to connect to backend: {}", e);
            log_debug!("{}", error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
pub async fn debug_backend_connection<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    log_debug!("=== DEBUG: Testing backend connection ===");

    // Test 1: Check server address from store
    let server_url = match get_server_address(&app).await {
        Ok(url) => {
            log_debug!("✓ Server URL from store: {}", url);
            url
        }
        Err(e) => {
            log_error!("✗ Failed to get server URL: {}", e);
            return Err(format!("Failed to get server URL: {}", e));
        }
    };

    // Test 2: Make a simple HTTP request to the backend
    let client = reqwest::Client::new();
    let test_url = format!("{}/docs", server_url); // Try the docs endpoint which should be public

    log_debug!("Testing connection to: {}", test_url);

    match client.get(&test_url).send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("✓ Backend responded with status: {}", status);
            Ok(format!(
                "Backend connection successful! Status: {}, URL: {}",
                status, server_url
            ))
        }
        Err(e) => {
            log_error!("✗ Backend connection failed: {}", e);
            Err(format!("Backend connection failed: {}", e))
        }
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    use std::process::Command;

    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(&["/C", "start", &url]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).output()
    } else {
        // Linux and other Unix-like systems
        Command::new("xdg-open").arg(&url).output()
    };

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open URL: {}", e)),
    }
}

// ============================================================================
// Browser Extension Integration Commands
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct SendToChatRequest {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendQuestionsToChatRequest {
    pub questions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_between: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateQuestionsRequest {
    pub meeting_id: String,
    pub model: String,
    pub model_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_key: Option<String>,
}

/// Get the current status of connected browser extensions
#[tauri::command]
pub async fn api_get_extension_status<R: Runtime>(
    app: AppHandle<R>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_get_extension_status called");
    make_api_request::<R, serde_json::Value>(&app, "/extension/status", "GET", None, None, None).await
}

/// Send a message to the meeting chat via browser extension
#[tauri::command]
pub async fn api_send_to_chat<R: Runtime>(
    app: AppHandle<R>,
    request: SendToChatRequest,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_send_to_chat called with message length: {}", request.message.len());
    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/extension/send-to-chat", "POST", Some(&body), None, None).await
}

/// Send multiple clarifying questions to the meeting chat
#[tauri::command]
pub async fn api_send_questions_to_chat<R: Runtime>(
    app: AppHandle<R>,
    request: SendQuestionsToChatRequest,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_send_questions_to_chat called with {} questions", request.questions.len());
    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/extension/send-questions", "POST", Some(&body), None, None).await
}

/// Generate clarifying questions about tasks from meeting transcript
#[tauri::command]
pub async fn api_generate_clarifying_questions<R: Runtime>(
    app: AppHandle<R>,
    request: GenerateQuestionsRequest,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_generate_clarifying_questions called for meeting: {}", request.meeting_id);
    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    make_api_request::<R, serde_json::Value>(&app, "/extension/generate-questions", "POST", Some(&body), None, None).await
}

/// Ping all connected browser extensions to check health
#[tauri::command]
pub async fn api_ping_extensions<R: Runtime>(
    app: AppHandle<R>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_ping_extensions called");
    make_api_request::<R, serde_json::Value>(&app, "/extension/ping", "POST", None, None, None).await
}
