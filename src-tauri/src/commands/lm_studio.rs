use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const DEFAULT_BASE_URL: &str = "http://localhost:1234";

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LmStudioSettings {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}

#[derive(Debug, Deserialize)]
pub struct TestConnectionPayload {
    #[serde(default = "default_base_url")]
    pub base_url: String,
}

#[derive(Debug, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

/// Test connection to LM Studio and list available models.
#[tauri::command]
pub async fn test_lm_studio_connection(
    payload: TestConnectionPayload,
) -> Result<ConnectionStatus, String> {
    let url = format!("{}/v1/models", payload.base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = match client.get(&url).timeout(std::time::Duration::from_secs(5)).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ConnectionStatus {
                connected: false,
                models: Vec::new(),
                error: Some(format!("Connection failed: {}", e)),
            });
        }
    };

    if !response.status().is_success() {
        return Ok(ConnectionStatus {
            connected: false,
            models: Vec::new(),
            error: Some(format!("Server returned status: {}", response.status())),
        });
    }

    #[derive(Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelInfo>,
    }

    #[derive(Deserialize)]
    struct ModelInfo {
        id: String,
    }

    let models_response: ModelsResponse = response.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = models_response.data.into_iter().map(|m| m.id).collect();

    Ok(ConnectionStatus {
        connected: true,
        models,
        error: None,
    })
}

#[derive(Debug, Deserialize)]
pub struct GenerateCaptionPayload {
    pub image_path: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
    pub prompt: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_max_tokens() -> u32 {
    300
}

#[derive(Debug, Serialize)]
pub struct CaptionResult {
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate a caption for a single image using LM Studio vision model.
#[tauri::command]
pub async fn generate_caption_lm_studio(
    payload: GenerateCaptionPayload,
) -> Result<CaptionResult, String> {
    let path = PathBuf::from(&payload.image_path);
    if !path.exists() || !path.is_file() {
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some("Image file not found".to_string()),
        });
    }

    // Read and encode image as base64
    let image_bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let base64_image = BASE64.encode(&image_bytes);

    // Detect MIME type from extension
    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };

    let data_url = format!("data:{};base64,{}", mime_type, base64_image);

    // Build request body (OpenAI-compatible format)
    let request_body = serde_json::json!({
        "model": payload.model.unwrap_or_else(|| "default".to_string()),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": payload.prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_url
                        }
                    }
                ]
            }
        ],
        "max_tokens": payload.max_tokens,
        "temperature": 0.7,
        "stream": false
    });

    let url = format!(
        "{}/v1/chat/completions",
        payload.base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = match client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(CaptionResult {
                success: false,
                caption: String::new(),
                error: Some(format!("Request failed: {}", e)),
            });
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Ok(CaptionResult {
            success: false,
            caption: String::new(),
            error: Some(format!("Server error {}: {}", status, body)),
        });
    }

    #[derive(Deserialize)]
    struct ChatResponse {
        choices: Vec<Choice>,
    }

    #[derive(Deserialize)]
    struct Choice {
        message: Message,
    }

    #[derive(Deserialize)]
    struct Message {
        content: String,
    }

    let chat_response: ChatResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(CaptionResult {
                success: false,
                caption: String::new(),
                error: Some(format!("Failed to parse response: {}", e)),
            });
        }
    };

    let caption = chat_response
        .choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .unwrap_or_default();

    Ok(CaptionResult {
        success: true,
        caption,
        error: None,
    })
}

fn default_batch_concurrency() -> u32 {
    2
}

#[derive(Debug, Deserialize)]
pub struct BatchCaptionPayload {
    pub image_paths: Vec<String>,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: Option<String>,
    pub prompt: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// Max concurrent requests (1 = sequential, 2–3 recommended).
    #[serde(default = "default_batch_concurrency")]
    pub concurrency: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct BatchCaptionResult {
    pub path: String,
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate captions for multiple images with bounded concurrency.
/// Results are returned in the same order as image_paths.
#[tauri::command]
pub async fn generate_captions_batch(
    payload: BatchCaptionPayload,
) -> Result<Vec<BatchCaptionResult>, String> {
    let concurrency = payload.concurrency.max(1).min(8) as usize;

    let base_url = payload.base_url.clone();
    let model = payload.model.clone();
    let prompt = payload.prompt.clone();
    let max_tokens = payload.max_tokens;

    let futures = payload
        .image_paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| {
            let base_url = base_url.clone();
            let model = model.clone();
            let prompt = prompt.clone();
            let single_payload = GenerateCaptionPayload {
                image_path: path.clone(),
                base_url,
                model,
                prompt,
                max_tokens,
            };
            async move {
                let result = generate_caption_lm_studio(single_payload).await;
                (index, path, result)
            }
        });

    let mut completed: Vec<(usize, String, Result<CaptionResult, String>)> = stream::iter(futures)
        .buffer_unordered(concurrency)
        .collect()
        .await;

    completed.sort_by_key(|(i, _, _)| *i);

    let results: Vec<BatchCaptionResult> = completed
        .into_iter()
        .map(|(_, path, result)| {
            match result {
                Ok(r) => BatchCaptionResult {
                    path,
                    success: r.success,
                    caption: r.caption,
                    error: r.error,
                },
                Err(e) => BatchCaptionResult {
                    path,
                    success: false,
                    caption: String::new(),
                    error: Some(e),
                },
            }
        })
        .collect();

    Ok(results)
}
