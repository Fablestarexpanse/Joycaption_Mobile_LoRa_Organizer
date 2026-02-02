use image::ImageReader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use super::ratings::{load_ratings, ImageRating};

const PROGRESS_EVENT: &str = "project-load-progress";

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn is_image_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.as_ref()
        .map(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// Get the caption file path for an image (same name, .txt extension).
fn caption_path_for(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

/// Parse comma-separated tags from raw caption text.
fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct OpenProjectPayload {
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageEntry {
    pub id: String,
    pub path: String,
    pub relative_path: String,
    pub filename: String,
    pub has_caption: bool,
    pub tags: Vec<String>,
    pub rating: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectLoadProgress {
    count: usize,
}

/// Opens a project at the given root path. Scans recursively for image files.
/// Emits progress events as images are discovered.
#[tauri::command]
pub fn open_project(app: AppHandle, payload: OpenProjectPayload) -> Result<Vec<ImageEntry>, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.exists() {
        return Err("Folder does not exist".to_string());
    }
    if !root.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let ratings_data = load_ratings(&payload.root_path);
    let mut entries = Vec::new();

    for entry in WalkDir::new(&canonical_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_image_path(path) {
            continue;
        }
        let path_buf = path.to_path_buf();
        let path_str = path_buf
            .to_str()
            .ok_or("Invalid path encoding")?
            .to_string();
        let relative = path_buf
            .strip_prefix(&canonical_root)
            .unwrap_or_else(|_| path_buf.as_path());
        let relative_path = relative
            .to_str()
            .ok_or("Invalid path encoding")?
            .replace('\\', "/");
        let filename = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let id = path_str.clone();

        // Read caption file if exists
        let caption_path = caption_path_for(&path_buf);
        let (has_caption, tags) = if caption_path.exists() {
            match fs::read_to_string(&caption_path) {
                Ok(raw) => (true, parse_tags(&raw)),
                Err(_) => (false, Vec::new()),
            }
        } else {
            (false, Vec::new())
        };

        // Get rating from loaded ratings data
        let rating = ratings_data
            .ratings
            .get(&relative_path)
            .map(|s| ImageRating::from_str(s))
            .unwrap_or(ImageRating::None);

        // Read image dimensions (header only, fast)
        let (width, height) = ImageReader::open(&path_buf)
            .ok()
            .and_then(|r| r.into_dimensions().ok())
            .unwrap_or((0u32, 0u32));
        let width = if width > 0 { Some(width) } else { None };
        let height = if height > 0 { Some(height) } else { None };

        let file_size = fs::metadata(&path_buf).ok().map(|m| m.len()).filter(|&n| n > 0);

        entries.push(ImageEntry {
            id,
            path: path_str,
            relative_path,
            filename,
            has_caption,
            tags,
            rating: rating.as_str().to_string(),
            width,
            height,
            file_size,
        });

        // Emit progress every 50 images
        if entries.len() % 50 == 0 {
            let _ = app.emit(PROGRESS_EVENT, ProjectLoadProgress { count: entries.len() });
        }
    }

    // Emit final count
    let _ = app.emit(PROGRESS_EVENT, ProjectLoadProgress { count: entries.len() });

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

#[derive(Debug, Deserialize)]
pub struct FindDuplicatesPayload {
    pub root_path: String,
}

#[derive(Debug, Serialize)]
pub struct FindDuplicatesResult {
    pub groups: Vec<Vec<String>>,
}

/// Find duplicate images by file content hash (SHA-256). Returns groups of relative paths.
#[tauri::command]
pub fn find_duplicates(payload: FindDuplicatesPayload) -> Result<FindDuplicatesResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.exists() || !root.is_dir() {
        return Err("Folder does not exist".to_string());
    }
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    let mut hash_to_paths: HashMap<String, Vec<String>> = HashMap::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_image_path(path) {
            continue;
        }

        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        let hash_hex = hex::encode(hasher.finalize());

        let relative = path
            .strip_prefix(&canonical_root)
            .unwrap_or(path);
        let rel_str = relative
            .to_str()
            .map(|s| s.replace('\\', "/"))
            .unwrap_or_default();
        if rel_str.is_empty() {
            continue;
        }

        hash_to_paths
            .entry(hash_hex)
            .or_default()
            .push(rel_str);
    }

    let groups: Vec<Vec<String>> = hash_to_paths
        .into_values()
        .filter(|v| v.len() > 1)
        .collect();

    Ok(FindDuplicatesResult { groups })
}
