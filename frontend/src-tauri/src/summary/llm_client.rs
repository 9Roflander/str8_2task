use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use tracing::info;

// Generic structure for OpenAI-compatible API chat messages
#[derive(Debug, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// Generic structure for OpenAI-compatible API chat requests
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

// Generic structure for OpenAI-compatible API chat responses
#[derive(Deserialize, Debug)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
}

#[derive(Deserialize, Debug)]
pub struct Choice {
    pub message: MessageContent,
}

#[derive(Deserialize, Debug)]
pub struct MessageContent {
    pub content: String,
}

// Gemini response structures
#[derive(Deserialize, Debug)]
pub struct GeminiResponse {
    pub candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize, Debug)]
pub struct GeminiCandidate {
    pub content: GeminiContent,
}

#[derive(Deserialize, Debug)]
pub struct GeminiContent {
    pub parts: Vec<GeminiPart>,
}

#[derive(Deserialize, Debug)]
pub struct GeminiPart {
    pub text: Option<String>,
}

// Claude-specific request structure
#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

// Claude-specific response structure
#[derive(Deserialize, Debug)]
pub struct ClaudeChatResponse {
    pub content: Vec<ClaudeChatContent>,
}

#[derive(Deserialize, Debug)]
pub struct ClaudeChatContent {
    pub text: String,
}

/// LLM Provider enumeration for multi-provider support
#[derive(Debug, Clone, PartialEq)]
pub enum LLMProvider {
    OpenAI,
    Claude,
    Groq,
    Ollama,
    OpenRouter,
    Gemini,
}

impl LLMProvider {
    /// Parse provider from string (case-insensitive)
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "openai" => Ok(Self::OpenAI),
            "claude" => Ok(Self::Claude),
            "groq" => Ok(Self::Groq),
            "ollama" => Ok(Self::Ollama),
            "openrouter" => Ok(Self::OpenRouter),
            "gemini" => Ok(Self::Gemini),
            _ => Err(format!("Unsupported LLM provider: {}", s)),
        }
    }
}

/// Generates a summary using the specified LLM provider
///
/// # Arguments
/// * `client` - Reqwest HTTP client (reused for performance)
/// * `provider` - The LLM provider to use
/// * `model_name` - The specific model to use (e.g., "gpt-4", "claude-3-opus")
/// * `api_key` - API key for the provider (not needed for Ollama)
/// * `system_prompt` - System instructions for the LLM
/// * `user_prompt` - User query/content to process
/// * `ollama_endpoint` - Optional custom Ollama endpoint (defaults to localhost:11434)
///
/// # Returns
/// The generated summary text or an error message
pub async fn generate_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
) -> Result<String, String> {
    let openai_style_body = serde_json::json!(ChatRequest {
        model: model_name.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }
        ],
    });

    let (api_url, mut headers, request_body, uses_bearer_auth) = match provider {
        LLMProvider::OpenAI => (
            "https://api.openai.com/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            openai_style_body.clone(),
            true,
        ),
        LLMProvider::Groq => (
            "https://api.groq.com/openai/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            openai_style_body.clone(),
            true,
        ),
        LLMProvider::OpenRouter => (
            "https://openrouter.ai/api/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            openai_style_body.clone(),
            true,
        ),
        LLMProvider::Ollama => {
            let host = ollama_endpoint
                .map(|s| s.to_string())
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            (
                format!("{}/v1/chat/completions", host),
                header::HeaderMap::new(),
                openai_style_body.clone(),
                true,
            )
        }
        LLMProvider::Claude => {
            let mut header_map = header::HeaderMap::new();
            header_map.insert(
                "x-api-key",
                api_key
                    .parse()
                    .map_err(|_| "Invalid API key format".to_string())?,
            );
            header_map.insert(
                "anthropic-version",
                "2023-06-01"
                    .parse()
                    .map_err(|_| "Invalid anthropic version".to_string())?,
            );
            (
                "https://api.anthropic.com/v1/messages".to_string(),
                header_map,
                serde_json::json!(ClaudeRequest {
                    system: system_prompt.to_string(),
                    model: model_name.to_string(),
                    max_tokens: 2048,
                    messages: vec![ChatMessage {
                        role: "user".to_string(),
                        content: user_prompt.to_string(),
                    }]
                }),
                false,
            )
        }
        LLMProvider::Gemini => (
            format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model_name, api_key
            ),
            header::HeaderMap::new(),
            serde_json::json!({
                "system_instruction": {
                    "parts": [{
                        "text": system_prompt
                    }]
                },
                "contents": [{
                    "role": "user",
                    "parts": [{
                        "text": user_prompt
                    }]
                }]
            }),
            false,
        ),
    };

    if uses_bearer_auth {
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", api_key)
                .parse()
                .map_err(|_| "Invalid authorization header".to_string())?,
        );
    }
    headers.insert(
        header::CONTENT_TYPE,
        "application/json"
            .parse()
            .map_err(|_| "Invalid content type".to_string())?,
    );

    info!("🐞 LLM Request to {}: model={}, url={}", provider_name(provider), model_name, api_url);
    let request_start = std::time::Instant::now();
    let api_url_clone = api_url.clone(); // Clone for error message

    // Send request with timeout logging
    let response = client
        .post(&api_url)
        .headers(headers)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            let elapsed = request_start.elapsed().as_secs();
            format!("Failed to send request to LLM after {}s: {} (URL: {})", elapsed, e, api_url_clone)
        })?;
    
    let request_elapsed = request_start.elapsed().as_secs();
    info!("🐞 LLM Request sent, waiting for response (elapsed: {}s)...", request_elapsed);

    if !response.status().is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("LLM API request failed: {}", error_body));
    }

    // Parse response based on provider
    if provider == &LLMProvider::Claude {
        let chat_response = response
            .json::<ClaudeChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        info!("🐞 LLM Response received from Claude");

        let content = chat_response
            .content
            .get(0)
            .ok_or("No content in LLM response")?
            .text
            .trim();
        Ok(content.to_string())
    } else if provider == &LLMProvider::Gemini {
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read Gemini response text: {}", e))?;
        
        info!("🐞 Gemini raw response length: {} chars", response_text.len());
        info!("🐞 Gemini raw response preview: {}", &response_text.chars().take(500).collect::<String>());
        
        let gemini_response: GeminiResponse = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse Gemini response JSON: {}. Response preview: {}", e, &response_text.chars().take(200).collect::<String>()))?;

        info!("🐞 LLM Response received from Gemini, candidates count: {}", gemini_response.candidates.len());

        // Collect all text parts from all candidates
        let mut all_text_parts = Vec::new();
        for (idx, candidate) in gemini_response.candidates.iter().enumerate() {
            info!("🐞 Processing candidate {} with {} parts", idx, candidate.content.parts.len());
            for (part_idx, part) in candidate.content.parts.iter().enumerate() {
                if let Some(text) = &part.text {
                    info!("🐞 Candidate {} part {} text length: {}", idx, part_idx, text.len());
                    all_text_parts.push(text.as_str());
                } else {
                    info!("🐞 Candidate {} part {} has no text", idx, part_idx);
                }
            }
        }

        if all_text_parts.is_empty() {
            return Err("No text content found in any Gemini response parts".to_string());
        }

        let full_content = all_text_parts.join("");
        info!("🐞 Gemini final content length: {} chars", full_content.len());
        info!("🐞 Gemini final content preview: {}", &full_content.chars().take(500).collect::<String>());

        Ok(full_content.trim().to_string())
    } else {
        let chat_response = response
            .json::<ChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        info!("🐞 LLM Response received from {}", provider_name(provider));

        let content = chat_response
            .choices
            .get(0)
            .ok_or("No content in LLM response")?
            .message
            .content
            .trim();
        Ok(content.to_string())
    }
}

/// Helper function to get provider name for logging
fn provider_name(provider: &LLMProvider) -> &str {
    match provider {
        LLMProvider::OpenAI => "OpenAI",
        LLMProvider::Claude => "Claude",
        LLMProvider::Groq => "Groq",
        LLMProvider::Ollama => "Ollama",
        LLMProvider::OpenRouter => "OpenRouter",
        LLMProvider::Gemini => "Gemini",
    }
}
