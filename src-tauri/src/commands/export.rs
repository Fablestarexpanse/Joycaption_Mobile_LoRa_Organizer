//! Export dataset: copy images + .txt captions to a folder or ZIP.
//! Supports filtering by relative paths and "only captioned"; optional trigger word and sequential naming.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::ratings::{load_ratings, ImageRating, RatingsData};

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn is_image(p: &Path) -> bool {
    let ext = match p.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_lowercase(),
        None => return false,
    };
    IMAGE_EXT.iter().any(|&e| e.eq_ignore_ascii_case(&ext))
}

fn caption_path(img: &Path) -> PathBuf {
    img.with_extension("txt")
}

// ============ Export to folder or ZIP ============

#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    pub source_path: String,
    pub dest_path: String,
    #[serde(default)]
    pub as_zip: bool,
    #[serde(default)]
    pub only_captioned: bool,
    #[serde(default)]
    pub relative_paths: Option<Vec<String>>,
    #[serde(default)]
    pub trigger_word: Option<String>,
    #[serde(default)]
    pub sequential_naming: bool,
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub exported_count: usize,
    pub skipped_count: usize,
    pub error: Option<String>,
    pub output_path: String,
}

/// Normalize relative path: forward slashes, trim leading slashes.
fn normalize_rel(s: &str) -> String {
    s.replace('\\', "/").trim_start_matches(|c| c == '/' || c == '\\').to_string()
}

/// Normalize for case-insensitive path comparison (e.g. Windows).
fn normalize_key_for_lookup(s: &str) -> String {
    normalize_rel(s).to_lowercase()
}

#[tauri::command]
pub async fn export_dataset(options: ExportOptions) -> Result<ExportResult, String> {
    let source = PathBuf::from(&options.source_path);
    if !source.is_dir() {
        return Err("Source folder does not exist".to_string());
    }
    let canonical_source = source.canonicalize().map_err(|e| e.to_string())?;

    let mut images: Vec<PathBuf> = Vec::new();

    if let Some(ref relative_paths) = options.relative_paths {
        // Use frontend paths directly: join each to canonical source and add if file exists
        for rel in relative_paths {
            let normalized = normalize_rel(rel);
            if normalized.is_empty() {
                continue;
            }
            let full = canonical_source.join(&normalized);
            if full.is_file() && is_image(&full) {
                if options.only_captioned && !caption_path(&full).exists() {
                    continue;
                }
                images.push(full);
            }
        }
    } else {
        // No filter: walk entire source and add all (subject to only_captioned)
        for entry in WalkDir::new(&canonical_source).follow_links(false).into_iter().filter_map(Result::ok) {
            let p = entry.path();
            if !p.is_file() || !is_image(p) {
                continue;
            }
            if options.only_captioned && !caption_path(p).exists() {
                continue;
            }
            images.push(p.to_path_buf());
        }
    }

    images.sort();

    if options.as_zip {
        export_zip(&images, &options)
    } else {
        export_folder(&images, &options)
    }
}

fn apply_trigger(content: &str, trigger: Option<&String>) -> String {
    let content = content.trim();
    match trigger {
        Some(t) if !t.is_empty() => format!("{}, {}", t.trim(), content),
        _ => content.to_string(),
    }
}

fn export_folder(images: &[PathBuf], opt: &ExportOptions) -> Result<ExportResult, String> {
    let dest = PathBuf::from(&opt.dest_path);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut exported = 0usize;
    let mut skipped = 0usize;

    for (i, img) in images.iter().enumerate() {
        let ext = img.extension().and_then(|e| e.to_str()).unwrap_or("png");
        let name = if opt.sequential_naming {
            format!("{:04}.{}", i + 1, ext)
        } else {
            img.file_name().and_then(|n| n.to_str()).unwrap_or("image.png").to_string()
        };

        let dest_img = dest.join(&name);
        if fs::copy(img, &dest_img).is_err() {
            skipped += 1;
            continue;
        }

        let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
        let dest_txt = dest.join(format!("{}.txt", base));
        let cap_src = caption_path(img);
        if cap_src.exists() {
            if let Ok(content) = fs::read_to_string(&cap_src) {
                let out = apply_trigger(&content, opt.trigger_word.as_ref());
                let _ = fs::write(&dest_txt, out);
            }
        }
        exported += 1;
    }

    Ok(ExportResult {
        success: true,
        exported_count: exported,
        skipped_count: skipped,
        error: None,
        output_path: opt.dest_path.clone(),
    })
}

fn export_zip(images: &[PathBuf], opt: &ExportOptions) -> Result<ExportResult, String> {
    use std::io::Write;

    let file = fs::File::create(&opt.dest_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut exported = 0usize;
    let mut skipped = 0usize;

    for (i, img) in images.iter().enumerate() {
        let ext = img.extension().and_then(|e| e.to_str()).unwrap_or("png");
        let name = if opt.sequential_naming {
            format!("{:04}.{}", i + 1, ext)
        } else {
            img.file_name().and_then(|n| n.to_str()).unwrap_or("image.png").to_string()
        };

        let data = match fs::read(img) {
            Ok(d) => d,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        zip.start_file(&name, opts).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;

        let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
        let txt_name = format!("{}.txt", base);
        let cap_src = caption_path(img);
        if cap_src.exists() {
            if let Ok(content) = fs::read_to_string(&cap_src) {
                let out = apply_trigger(&content, opt.trigger_word.as_ref());
                zip.start_file(&txt_name, opts).map_err(|e| e.to_string())?;
                zip.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
            }
        }
        exported += 1;
    }

    zip.finish().map_err(|e| e.to_string())?;

    Ok(ExportResult {
        success: true,
        exported_count: exported,
        skipped_count: skipped,
        error: None,
        output_path: opt.dest_path.clone(),
    })
}

// ============ Export by rating (good / bad / needs_edit subfolders) ============

#[derive(Debug, Deserialize)]
pub struct ExportByRatingOptions {
    pub source_path: String,
    pub dest_path: String,
    #[serde(default)]
    pub trigger_word: Option<String>,
    #[serde(default)]
    pub sequential_naming: bool,
}

fn rating_key(r: ImageRating) -> Option<&'static str> {
    match r {
        ImageRating::Good => Some("good"),
        ImageRating::Bad => Some("bad"),
        ImageRating::NeedsEdit => Some("needs_edit"),
        ImageRating::None => None,
    }
}

/// Look up rating for a relative path: try exact key, case-insensitive, then key as absolute path (strip project root).
fn get_rating_for_path(
    ratings: &RatingsData,
    rel_key: &str,
    rel: &str,
    project_root: &str,
) -> String {
    if let Some(v) = ratings.ratings.get(rel_key) {
        return v.clone();
    }
    if rel != rel_key {
        if let Some(v) = ratings.ratings.get(rel) {
            return v.clone();
        }
    }
    let want = normalize_key_for_lookup(rel_key);
    let root_norm = normalize_key_for_lookup(project_root);
    for (k, v) in &ratings.ratings {
        if normalize_key_for_lookup(k) == want {
            return v.clone();
        }
        // Keys may have been stored as absolute paths if strip_prefix failed when project was opened
        let k_norm = normalize_key_for_lookup(k);
        if !root_norm.is_empty()
            && k_norm.len() > root_norm.len()
            && (k_norm.starts_with(&root_norm) || k_norm.starts_with(&root_norm.replace('\\', "/")))
        {
            let suffix = k_norm
                .strip_prefix(&root_norm)
                .or_else(|| k_norm.strip_prefix(&root_norm.replace('\\', "/")))
                .unwrap_or(k_norm.as_str());
            let suffix_trim = suffix.trim_start_matches(|c| c == '/' || c == '\\');
            if !suffix_trim.is_empty() && normalize_key_for_lookup(suffix_trim) == want {
                return v.clone();
            }
        }
    }
    "none".to_string()
}

#[tauri::command]
pub async fn export_by_rating(options: ExportByRatingOptions) -> Result<ExportResult, String> {
    let root = PathBuf::from(&options.source_path);
    if !root.is_dir() {
        return Err("Source folder does not exist".to_string());
    }

    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let project_root = canonical.to_str().unwrap_or(options.source_path.as_str());
    let ratings = load_ratings(project_root);

    let mut by_rating: std::collections::HashMap<&'static str, Vec<PathBuf>> = [
        ("good", Vec::new()),
        ("bad", Vec::new()),
        ("needs_edit", Vec::new()),
    ]
    .into_iter()
    .collect();

    // Walk from canonical so strip_prefix(canonical) always succeeds and matches how project stores relative_path.
    for entry in WalkDir::new(&canonical).follow_links(false).into_iter().filter_map(Result::ok) {
        let p = entry.path();
        if !p.is_file() || !is_image(p) {
            continue;
        }
        let rel = match p.strip_prefix(&canonical) {
            Ok(r) => r.to_str().map(|s| s.replace('\\', "/")).unwrap_or_default(),
            Err(_) => continue,
        };
        if rel.is_empty() {
            continue;
        }
        let rel_key = normalize_rel(&rel);
        if rel_key.is_empty() {
            continue;
        }

        let rating_str = get_rating_for_path(&ratings, &rel_key, &rel, project_root);
        let rating = ImageRating::from_str(&rating_str);
        if let Some(key) = rating_key(rating) {
            by_rating.get_mut(key).unwrap().push(p.to_path_buf());
        }
    }

    let dest = PathBuf::from(&options.dest_path);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut total_exported = 0usize;
    let mut total_skipped = 0usize;

    for (subdir, list) in by_rating.iter_mut() {
        list.sort();
        let sub = dest.join(*subdir);
        fs::create_dir_all(&sub).map_err(|e| e.to_string())?;

        for (i, img) in list.iter().enumerate() {
            let ext = img.extension().and_then(|e| e.to_str()).unwrap_or("png");
            let name = if options.sequential_naming {
                format!("{:04}.{}", i + 1, ext)
            } else {
                img.file_name().and_then(|n| n.to_str()).unwrap_or("image.png").to_string()
            };

            let dest_img = sub.join(&name);
            if fs::copy(img, &dest_img).is_err() {
                total_skipped += 1;
                continue;
            }

            let base = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
            let dest_txt = sub.join(format!("{}.txt", base));
            let cap_src = caption_path(img);
            if cap_src.exists() {
                if let Ok(content) = fs::read_to_string(&cap_src) {
                    let out = apply_trigger(&content, options.trigger_word.as_ref());
                    let _ = fs::write(&dest_txt, out);
                }
            }
            total_exported += 1;
        }
    }

    Ok(ExportResult {
        success: true,
        exported_count: total_exported,
        skipped_count: total_skipped,
        error: None,
        output_path: options.dest_path.clone(),
    })
}
