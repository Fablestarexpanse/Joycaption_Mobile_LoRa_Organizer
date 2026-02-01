use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Debug, Clone, Deserialize)]
pub struct JoyCaptionSettings {
    /// Path to Python executable (e.g., "python" or "/path/to/venv/bin/python")
    #[serde(default = "default_python")]
    pub python_path: String,
    /// Path to JoyCaption script or module
    #[serde(default)]
    pub script_path: Option<String>,
    /// Caption mode: "descriptive", "training", "booru", etc.
    #[serde(default = "default_mode")]
    pub mode: String,
    /// Use low VRAM mode
    #[serde(default)]
    pub low_vram: bool,
}

fn default_python() -> String {
    "python".to_string()
}

fn default_mode() -> String {
    "descriptive".to_string()
}

#[derive(Debug, Deserialize)]
pub struct JoyCaptionPayload {
    pub image_path: String,
    #[serde(flatten)]
    pub settings: JoyCaptionSettings,
}

#[derive(Debug, Serialize)]
pub struct JoyCaptionResult {
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate a caption using JoyCaption (Python subprocess).
/// Single image: one process. Script supports --image <path> (append); module uses single --image.
#[tauri::command]
pub async fn generate_caption_joycaption(
    payload: JoyCaptionPayload,
) -> Result<JoyCaptionResult, String> {
    let mut cmd = Command::new(&payload.settings.python_path);

    if let Some(ref script) = payload.settings.script_path {
        cmd.arg(script);
    } else {
        cmd.arg("-m").arg("joycaption");
    }

    cmd.arg("--image")
        .arg(&payload.image_path)
        .arg("--mode")
        .arg(&payload.settings.mode);

    if payload.settings.low_vram {
        cmd.arg("--low-vram");
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Ok(JoyCaptionResult {
                success: false,
                caption: String::new(),
                error: Some(format!("Failed to start JoyCaption: {}", e)),
            });
        }
    };

    let mut stdout = child.stdout.take().expect("stdout not captured");
    let mut stderr = child.stderr.take().expect("stderr not captured");

    let mut output = String::new();
    let mut error_output = String::new();

    let (stdout_result, stderr_result, status) = tokio::join!(
        async { stdout.read_to_string(&mut output).await },
        async { stderr.read_to_string(&mut error_output).await },
        child.wait()
    );

    if let Err(e) = stdout_result {
        error_output.push_str(&format!("Read error: {}\n", e));
    }
    if let Err(e) = stderr_result {
        error_output.push_str(&format!("Stderr read error: {}\n", e));
    }

    let status = status.map_err(|e| e.to_string())?;

    if status.success() {
        Ok(JoyCaptionResult {
            success: true,
            caption: output.trim().to_string(),
            error: None,
        })
    } else {
        Ok(JoyCaptionResult {
            success: false,
            caption: String::new(),
            error: Some(if error_output.is_empty() {
                format!("JoyCaption exited with code: {:?}", status.code())
            } else {
                error_output.trim().to_string()
            }),
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct JoyCaptionBatchPayload {
    pub image_paths: Vec<String>,
    #[serde(flatten)]
    pub settings: JoyCaptionSettings,
}

#[derive(Debug, Serialize, Clone)]
pub struct JoyCaptionBatchResult {
    pub path: String,
    pub success: bool,
    pub caption: String,
    pub error: Option<String>,
}

/// Generate captions for multiple images. When script_path is set (bundled script),
/// invokes one process with multiple --image args so the model is loaded once.
/// When script_path is not set (-m joycaption), falls back to one process per image.
#[tauri::command]
pub async fn generate_captions_joycaption_batch(
    payload: JoyCaptionBatchPayload,
) -> Result<Vec<JoyCaptionBatchResult>, String> {
    let use_batch_script = payload.settings.script_path.is_some() && payload.image_paths.len() > 1;

    if use_batch_script {
        // One process: multiple --image path1 --image path2 ...
        let mut cmd = Command::new(&payload.settings.python_path);
        let script = payload.settings.script_path.as_ref().unwrap();
        cmd.arg(script);

        for path in &payload.image_paths {
            cmd.arg("--image").arg(path);
        }
        cmd.arg("--mode").arg(&payload.settings.mode);
        if payload.settings.low_vram {
            cmd.arg("--low-vram");
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return Err(format!("Failed to start JoyCaption batch: {}", e));
            }
        };

        let mut stdout = child.stdout.take().expect("stdout not captured");
        let mut stderr = child.stderr.take().expect("stderr not captured");
        let mut output = String::new();
        let mut error_output = String::new();

        let (stdout_result, stderr_result, status) = tokio::join!(
            async { stdout.read_to_string(&mut output).await },
            async { stderr.read_to_string(&mut error_output).await },
            child.wait()
        );

        if let Err(e) = stdout_result {
            return Err(format!("Read stdout error: {}", e));
        }
        if let Err(e) = stderr_result {
            return Err(format!("Read stderr error: {}", e));
        }
        let status = status.map_err(|e| e.to_string())?;

        if !status.success() {
            return Err(if error_output.is_empty() {
                format!("JoyCaption batch exited with code: {:?}", status.code())
            } else {
                error_output.trim().to_string()
            });
        }

        // One caption per line (same order as image_paths)
        let lines: Vec<&str> = output.lines().map(str::trim).collect();
        let results = payload
            .image_paths
            .into_iter()
            .enumerate()
            .map(|(i, path)| {
                let (success, caption, error) = if i < lines.len() {
                    let caption = lines[i].to_string();
                    (true, caption, None)
                } else {
                    (
                        false,
                        String::new(),
                        Some("No caption returned for this image".to_string()),
                    )
                };
                JoyCaptionBatchResult {
                    path,
                    success,
                    caption,
                    error,
                }
            })
            .collect::<Vec<_>>();
        Ok(results)
    } else {
        // Fallback: one process per image (e.g. when using -m joycaption)
        let mut results = Vec::new();
        for image_path in payload.image_paths {
            let single_payload = JoyCaptionPayload {
                image_path: image_path.clone(),
                settings: JoyCaptionSettings {
                    python_path: payload.settings.python_path.clone(),
                    script_path: payload.settings.script_path.clone(),
                    mode: payload.settings.mode.clone(),
                    low_vram: payload.settings.low_vram,
                },
            };
            let result = generate_caption_joycaption(single_payload).await?;
            results.push(JoyCaptionBatchResult {
                path: image_path,
                success: result.success,
                caption: result.caption,
                error: result.error,
            });
        }
        Ok(results)
    }
}
