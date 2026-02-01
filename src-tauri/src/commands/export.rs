use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::ratings::{load_ratings, ImageRating};

/// Normalize path for comparison (forward slashes, lowercase on Windows for extension)
fn relative_path_str(path: &Path, source: &Path) -> Option<String> {
    path.strip_prefix(source)
        .ok()
        .and_then(|p| p.to_str())
        .map(|s| s.replace('\\', "/"))
}

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

fn caption_path_for(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

#[allow(dead_code)]
fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    /// Source folder to export from
    pub source_path: String,
    /// Destination folder or ZIP path
    pub dest_path: String,
    /// Export as ZIP
    #[serde(default)]
    pub as_zip: bool,
    /// Only export captioned images
    #[serde(default)]
    pub only_captioned: bool,
    /// If set, only export these relative paths (e.g. for "only good" export)
    #[serde(default)]
    pub relative_paths: Option<Vec<String>>,
    /// Trigger word to prepend to captions
    #[serde(default)]
    pub trigger_word: Option<String>,
    /// Use sequential naming (001.png, 002.png, etc.)
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

/// Export dataset to folder or ZIP
#[tauri::command]
pub async fn export_dataset(options: ExportOptions) -> Result<ExportResult, String> {
    let source = PathBuf::from(&options.source_path);
    if !source.exists() || !source.is_dir() {
        return Err("Source folder does not exist".to_string());
    }

    // Optional whitelist of relative paths (e.g. only good-rated images)
    let path_set: Option<std::collections::HashSet<String>> = options
        .relative_paths
        .as_ref()
        .map(|v| v.iter().map(|s| s.replace('\\', "/")).collect());

    // Collect images to export
    let mut images: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&source)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_image_path(path) {
            continue;
        }

        if let Some(ref set) = path_set {
            let rel = match relative_path_str(path, &source) {
                Some(r) => r,
                None => continue,
            };
            if !set.contains(&rel) {
                continue;
            }
        }

        if options.only_captioned {
            let caption_path = caption_path_for(path);
            if !caption_path.exists() {
                continue;
            }
        }

        images.push(path.to_path_buf());
    }

    images.sort();

    if options.as_zip {
        export_as_zip(&images, &options)
    } else {
        export_to_folder(&images, &options)
    }
}

fn export_to_folder(images: &[PathBuf], options: &ExportOptions) -> Result<ExportResult, String> {
    let dest = PathBuf::from(&options.dest_path);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut exported = 0;
    let mut skipped = 0;

    for (i, img_path) in images.iter().enumerate() {
        let ext = img_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");

        let new_name = if options.sequential_naming {
            format!("{:04}.{}", i + 1, ext)
        } else {
            img_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("image.png")
                .to_string()
        };

        let dest_img = dest.join(&new_name);
        let dest_txt = dest.join(format!(
            "{}.txt",
            new_name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&new_name)
        ));

        // Copy image
        if let Err(_e) = fs::copy(img_path, &dest_img) {
            skipped += 1;
            continue;
        }

        // Copy/modify caption
        let caption_path = caption_path_for(img_path);
        if caption_path.exists() {
            if let Ok(content) = fs::read_to_string(&caption_path) {
                let final_content = if let Some(ref trigger) = options.trigger_word {
                    if !trigger.is_empty() {
                        format!("{}, {}", trigger.trim(), content.trim())
                    } else {
                        content.trim().to_string()
                    }
                } else {
                    content.trim().to_string()
                };
                let _ = fs::write(&dest_txt, final_content);
            }
        }

        exported += 1;
    }

    Ok(ExportResult {
        success: true,
        exported_count: exported,
        skipped_count: skipped,
        error: None,
        output_path: options.dest_path.clone(),
    })
}

fn export_as_zip(images: &[PathBuf], options: &ExportOptions) -> Result<ExportResult, String> {
    use std::io::Write;

    let dest_path = PathBuf::from(&options.dest_path);

    // Create ZIP file
    let file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);

    let zip_options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut exported = 0;
    let mut skipped = 0;

    for (i, img_path) in images.iter().enumerate() {
        let ext = img_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");

        let new_name = if options.sequential_naming {
            format!("{:04}.{}", i + 1, ext)
        } else {
            img_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("image.png")
                .to_string()
        };

        let txt_name = format!(
            "{}.txt",
            new_name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&new_name)
        );

        // Add image to ZIP
        let img_data = match fs::read(img_path) {
            Ok(data) => data,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        zip.start_file(&new_name, zip_options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&img_data).map_err(|e| e.to_string())?;

        // Add caption to ZIP
        let caption_path = caption_path_for(img_path);
        if caption_path.exists() {
            if let Ok(content) = fs::read_to_string(&caption_path) {
                let final_content = if let Some(ref trigger) = options.trigger_word {
                    if !trigger.is_empty() {
                        format!("{}, {}", trigger.trim(), content.trim())
                    } else {
                        content.trim().to_string()
                    }
                } else {
                    content.trim().to_string()
                };

                zip.start_file(&txt_name, zip_options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(final_content.as_bytes())
                    .map_err(|e| e.to_string())?;
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
        output_path: options.dest_path.clone(),
    })
}

// ============ Export by rating (good / bad / needs_edit subfolders) ============

#[derive(Debug, Deserialize)]
pub struct ExportByRatingOptions {
    pub source_path: String,
    /// Parent folder; creates good/, bad/, needs_edit/ inside
    pub dest_path: String,
    #[serde(default)]
    pub trigger_word: Option<String>,
    #[serde(default)]
    pub sequential_naming: bool,
}

/// Export images into subfolders by rating: dest/good, dest/bad, dest/needs_edit
#[tauri::command]
pub async fn export_by_rating(
    options: ExportByRatingOptions,
) -> Result<ExportResult, String> {
    let root = PathBuf::from(&options.source_path);
    if !root.exists() || !root.is_dir() {
        return Err("Source folder does not exist".to_string());
    }
    // Match open_project exactly: canonical root for strip_prefix, load ratings from same path frontend uses
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let ratings_data = load_ratings(&options.source_path);

    let mut images_by_rating: HashMap<String, Vec<PathBuf>> = HashMap::new();
    images_by_rating.insert("good".to_string(), Vec::new());
    images_by_rating.insert("bad".to_string(), Vec::new());
    images_by_rating.insert("needs_edit".to_string(), Vec::new());

    // Walk from root (same as open_project), compute relative_path using canonical_root (same as open_project)
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_image_path(path) {
            continue;
        }
        let path_buf = path.to_path_buf();
        let relative = path_buf.strip_prefix(&canonical_root).unwrap_or(&path_buf);
        let rel: String = relative
            .to_str()
            .map(|s| s.replace('\\', "/"))
            .unwrap_or_default();
        if rel.is_empty() {
            continue;
        }
        // Lookup: try exact key, trimmed (no leading slash), with leading slash (Windows strip_prefix can yield either), and backslash variants
        let rel_trimmed = rel.trim_start_matches(|c| c == '/' || c == '\\');
        let rel_with_leading = format!("/{}", rel_trimmed);
        let rel_backslash = rel.replace('/', "\\");
        let rel_trimmed_backslash = rel_trimmed.replace('/', "\\");
        let rel_trimmed_leading_backslash = format!("\\{}", rel_trimmed);

        let rating_str = ratings_data
            .ratings
            .get(&rel)
            .or_else(|| ratings_data.ratings.get(rel_trimmed))
            .or_else(|| ratings_data.ratings.get(&rel_with_leading))
            .or_else(|| ratings_data.ratings.get(&rel_backslash))
            .or_else(|| ratings_data.ratings.get(&rel_trimmed_backslash))
            .or_else(|| ratings_data.ratings.get(&rel_trimmed_leading_backslash))
            // Windows: case-insensitive fallback (ratings key might differ in casing)
            .or_else(|| {
                ratings_data.ratings.iter().find(|(k, _)| {
                    k.eq_ignore_ascii_case(&rel)
                        || k.eq_ignore_ascii_case(rel_trimmed)
                        || k.as_str().trim_start_matches(|c: char| c == '/' || c == '\\').eq_ignore_ascii_case(rel_trimmed)
                }).map(|(_, v)| v)
            })
            .map(|s| s.as_str())
            .unwrap_or("none");
        let rating = ImageRating::from_str(rating_str);
        let key = match rating {
            ImageRating::Good => "good",
            ImageRating::Bad => "bad",
            ImageRating::NeedsEdit => "needs_edit",
            ImageRating::None => continue,
        };
        images_by_rating
            .get_mut(key)
            .unwrap()
            .push(path_buf);
    }

    let dest = PathBuf::from(&options.dest_path);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut total_exported = 0;
    let mut total_skipped = 0;

    for (subdir, images) in &mut images_by_rating {
        images.sort();
        let sub_path = dest.join(subdir);
        fs::create_dir_all(&sub_path).map_err(|e| e.to_string())?;

        for (i, img_path) in images.iter().enumerate() {
            let ext = img_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let new_name = if options.sequential_naming {
                format!("{:04}.{}", i + 1, ext)
            } else {
                img_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("image.png")
                    .to_string()
            };
            let dest_img = sub_path.join(&new_name);
            let base = new_name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&new_name);
            let dest_txt = sub_path.join(format!("{}.txt", base));

            if fs::copy(img_path, &dest_img).is_err() {
                total_skipped += 1;
                continue;
            }

            let caption_path = caption_path_for(img_path);
            if caption_path.exists() {
                if let Ok(content) = fs::read_to_string(&caption_path) {
                    let final_content = if let Some(ref trigger) = options.trigger_word {
                        if !trigger.is_empty() {
                            format!("{}, {}", trigger.trim(), content.trim())
                        } else {
                            content.trim().to_string()
                        }
                    } else {
                        content.trim().to_string()
                    };
                    let _ = fs::write(&dest_txt, final_content);
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
