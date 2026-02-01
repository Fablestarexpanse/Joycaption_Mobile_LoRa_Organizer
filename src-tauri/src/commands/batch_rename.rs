//! Batch rename image files (and their .txt caption files) with a prefix and sequential index.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn caption_path_for(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

#[derive(Debug, Deserialize)]
pub struct BatchRenamePayload {
    pub root_path: String,
    /// Relative paths of images to rename (from project root).
    pub relative_paths: Vec<String>,
    /// Prefix for new filenames (e.g. "img" -> img_0001.png).
    pub prefix: String,
    /// Starting index (1-based).
    pub start_index: u32,
    /// Zero-pad index to this many digits (e.g. 4 -> 0001, 0002).
    pub zero_pad: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchRenameResult {
    pub success: bool,
    pub renamed_count: u32,
    pub errors: Vec<String>,
}

/// Renames image files and their caption files with prefix + zero-padded index.
#[tauri::command]
pub fn batch_rename(payload: BatchRenamePayload) -> Result<BatchRenameResult, String> {
    let root = PathBuf::from(&payload.root_path);
    if !root.exists() || !root.is_dir() {
        return Err("Root path does not exist or is not a directory".to_string());
    }

    let prefix = payload.prefix.trim();
    if prefix.is_empty() {
        return Err("Prefix cannot be empty".to_string());
    }

    let zero_pad = payload.zero_pad.max(1).min(12);
    let mut index = payload.start_index;
    let mut errors = Vec::new();
    let mut renamed = 0u32;

    for relative_path in &payload.relative_paths {
        let rel_normalized = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
        let old_path = root.join(&rel_normalized);

        if !old_path.exists() || !old_path.is_file() {
            errors.push(format!("Not found: {}", relative_path));
            index += 1;
            continue;
        }

        let ext = old_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_string();
        let new_name = format!("{}_{:0width$}.{}", prefix, index, ext, width = zero_pad as usize);
        let parent = old_path.parent().unwrap_or(&root);
        let new_path = parent.join(&new_name);

        if new_path == old_path {
            index += 1;
            renamed += 1;
            continue;
        }

        if new_path.exists() {
            errors.push(format!("Target already exists: {}", new_name));
            index += 1;
            continue;
        }

        if let Err(e) = fs::rename(&old_path, &new_path) {
            errors.push(format!("Rename {}: {}", relative_path, e));
            index += 1;
            continue;
        }

        let caption_old = caption_path_for(&old_path);
        let caption_new = new_path.with_extension("txt");
        let mut ok = true;
        if caption_old.exists() {
            if caption_new.exists() {
                let _ = fs::rename(&new_path, &old_path);
                errors.push(format!("Caption target exists: {}", new_name));
                ok = false;
            } else if fs::rename(&caption_old, &caption_new).is_err() {
                let _ = fs::rename(&new_path, &old_path);
                errors.push(format!("Failed to rename caption for: {}", relative_path));
                ok = false;
            }
        }
        if ok {
            renamed += 1;
        }
        index += 1;
    }

    Ok(BatchRenameResult {
        success: errors.is_empty(),
        renamed_count: renamed,
        errors,
    })
}
