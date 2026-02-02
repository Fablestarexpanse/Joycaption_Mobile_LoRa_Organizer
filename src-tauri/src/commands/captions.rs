use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Get the caption file path for an image (same name, .txt extension).
fn caption_path_for(image_path: &str) -> PathBuf {
    let path = PathBuf::from(image_path);
    path.with_extension("txt")
}

#[derive(Debug, Deserialize)]
pub struct ReadCaptionPayload {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct CaptionData {
    pub exists: bool,
    pub raw: String,
    pub tags: Vec<String>,
}

/// Reads the caption file for an image. Returns tags parsed from comma-separated format.
#[tauri::command]
pub fn read_caption(payload: ReadCaptionPayload) -> Result<CaptionData, String> {
    let caption_path = caption_path_for(&payload.path);

    if !caption_path.exists() {
        return Ok(CaptionData {
            exists: false,
            raw: String::new(),
            tags: Vec::new(),
        });
    }

    let raw = fs::read_to_string(&caption_path).map_err(|e| e.to_string())?;
    let tags = parse_tags(&raw);

    Ok(CaptionData {
        exists: true,
        raw: raw.trim().to_string(),
        tags,
    })
}

#[derive(Debug, Deserialize)]
pub struct WriteCaptionPayload {
    pub path: String,
    pub tags: Vec<String>,
}

/// Writes tags to the caption file for an image (comma-separated).
#[tauri::command]
pub fn write_caption(payload: WriteCaptionPayload) -> Result<(), String> {
    let caption_path = caption_path_for(&payload.path);
    let content = payload.tags.join(", ");
    fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Parse comma-separated tags from raw caption text.
fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct AddTagPayload {
    pub path: String,
    pub tag: String,
}

/// Adds a tag to the caption file if not already present.
#[tauri::command]
pub fn add_tag(payload: AddTagPayload) -> Result<Vec<String>, String> {
    let caption_path = caption_path_for(&payload.path);
    let mut tags = if caption_path.exists() {
        let raw = fs::read_to_string(&caption_path).map_err(|e| e.to_string())?;
        parse_tags(&raw)
    } else {
        Vec::new()
    };

    let tag = payload.tag.trim().to_string();
    if !tag.is_empty() && !tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
        tags.push(tag);
        let content = tags.join(", ");
        fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    }

    Ok(tags)
}

#[derive(Debug, Deserialize)]
pub struct RemoveTagPayload {
    pub path: String,
    pub tag: String,
}

/// Removes a tag from the caption file.
#[tauri::command]
pub fn remove_tag(payload: RemoveTagPayload) -> Result<Vec<String>, String> {
    let caption_path = caption_path_for(&payload.path);
    if !caption_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&caption_path).map_err(|e| e.to_string())?;
    let mut tags = parse_tags(&raw);
    let tag_lower = payload.tag.trim().to_lowercase();
    tags.retain(|t| t.to_lowercase() != tag_lower);

    let content = tags.join(", ");
    fs::write(&caption_path, &content).map_err(|e| e.to_string())?;

    Ok(tags)
}

#[derive(Debug, Deserialize)]
pub struct ReorderTagsPayload {
    pub path: String,
    pub tags: Vec<String>,
}

/// Replaces all tags with the given ordered list.
#[tauri::command]
pub fn reorder_tags(payload: ReorderTagsPayload) -> Result<(), String> {
    let caption_path = caption_path_for(&payload.path);
    let content = payload.tags.join(", ");
    fs::write(&caption_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn is_image_path(p: &Path) -> bool {
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.as_ref()
        .map(|e| IMAGE_EXT.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
pub struct ClearAllCaptionsPayload {
    pub root_path: String,
}

#[derive(Debug, Serialize)]
pub struct ClearAllCaptionsResult {
    pub cleared_count: usize,
}

/// Clears all caption files in the project (writes empty content to each image's .txt).
/// Uses the same walk as the project so paths match.
#[tauri::command]
pub fn clear_all_captions(payload: ClearAllCaptionsPayload) -> Result<ClearAllCaptionsResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.is_dir() {
        return Err("Project folder does not exist".to_string());
    }
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let mut cleared = 0usize;
    for entry in WalkDir::new(&canonical)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        if !p.is_file() || !is_image_path(p) {
            continue;
        }
        let caption_path = p.with_extension("txt");
        if let Err(e) = fs::write(&caption_path, "") {
            return Err(format!("Failed to clear {}: {}", caption_path.display(), e));
        }
        cleared += 1;
    }
    Ok(ClearAllCaptionsResult { cleared_count: cleared })
}
