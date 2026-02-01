use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::imageops::FilterType;
use image::ImageFormat;
use serde::Deserialize;
use std::io::Cursor;
use std::path::PathBuf;

const THUMB_SIZE: u32 = 256;

#[derive(Debug, Deserialize)]
pub struct CropImagePayload {
    pub image_path: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub flip_x: bool,
    #[serde(default)]
    pub flip_y: bool,
    #[serde(default)]
    pub rotate_degrees: i32,
    /// If true, save cropped image to a new file (keeps original). Returns new path.
    #[serde(default)]
    pub save_as_new: bool,
}

#[derive(Debug, Deserialize)]
pub struct GetThumbnailPayload {
    pub path: String,
    #[serde(default)]
    pub size: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct GetImageDataUrlPayload {
    pub path: String,
    /// Max length of the longest side (for preview); 0 = full size.
    #[serde(default)]
    pub max_side: Option<u32>,
}

/// Generates a thumbnail for the image at path. Returns a data URL (base64 JPEG).
#[tauri::command]
pub fn get_thumbnail(payload: GetThumbnailPayload) -> Result<String, String> {
    let path = PathBuf::from(&payload.path);
    if !path.exists() || !path.is_file() {
        return Err("File not found".to_string());
    }

    let size = payload.size.unwrap_or(THUMB_SIZE).min(512);

    let img = image::open(&path).map_err(|e| e.to_string())?;
    let thumb = img.resize(size, size, FilterType::Triangle);
    let mut buf = Vec::new();
    thumb
        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    let b64 = BASE64.encode(&buf);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Load image from path and return as data URL (for preview/crop so webview doesn't need asset protocol).
#[tauri::command]
pub fn get_image_data_url(payload: GetImageDataUrlPayload) -> Result<String, String> {
    let path = PathBuf::from(&payload.path);
    if !path.exists() || !path.is_file() {
        return Err("File not found".to_string());
    }

    let mut img = image::open(&path).map_err(|e| e.to_string())?;
    let max_side = payload.max_side.unwrap_or(0);
    if max_side > 0 {
        let (w, h) = (img.width(), img.height());
        let longest = w.max(h);
        if longest > max_side {
            let scale = max_side as f32 / longest as f32;
            let new_w = (w as f32 * scale).round() as u32;
            let new_h = (h as f32 * scale).round() as u32;
            img = img.resize(new_w, new_h, FilterType::Triangle);
        }
    }

    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(&buf);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Crop (and optionally flip/rotate) an image. Overwrites the file unless save_as_new is true.
/// Returns Some(new_path) when save_as_new is true, None otherwise.
#[tauri::command]
pub fn crop_image(payload: CropImagePayload) -> Result<Option<String>, String> {
    let path = PathBuf::from(&payload.image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }

    let img = image::open(&path).map_err(|e| e.to_string())?;

    let (w, h) = (img.width(), img.height());
    let x = payload.x.min(w.saturating_sub(1));
    let y = payload.y.min(h.saturating_sub(1));
    let cw = payload.width.min(w.saturating_sub(x));
    let ch = payload.height.min(h.saturating_sub(y));

    if cw == 0 || ch == 0 {
        return Err("Crop region has zero size".to_string());
    }

    // Crop first (in original image coordinates), then apply flip/rotate to the cropped result
    let cropped_sub = img.crop_imm(x, y, cw, ch);
    let mut out_img = image::DynamicImage::from(cropped_sub.to_rgb8());

    if payload.flip_x {
        out_img = out_img.fliph();
    }
    if payload.flip_y {
        out_img = out_img.flipv();
    }

    let rot = ((payload.rotate_degrees % 360 + 360) % 360) / 90;
    for _ in 0..rot {
        out_img = out_img.rotate90();
    }

    let format = ImageFormat::from_path(&path).unwrap_or(ImageFormat::Png);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let out_path: PathBuf = if payload.save_as_new {
        let parent = path.parent().unwrap_or_else(|| path.as_path());
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let mut n = 1u32;
        loop {
            let name = format!("{}_{}_crop.{}", stem, n, ext);
            let candidate = parent.join(&name);
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
            if n > 9999 {
                return Err("Could not create unique filename for new image".to_string());
            }
        }
    } else {
        path.clone()
    };

    let mut file = std::io::BufWriter::new(
        std::fs::File::create(&out_path).map_err(|e| e.to_string())?,
    );
    out_img
        .write_to(&mut file, format)
        .map_err(|e| e.to_string())?;

    // When saving as new, do NOT copy the caption — new image gets blank tags

    Ok(if payload.save_as_new {
        Some(out_path.to_string_lossy().into_owned())
    } else {
        None
    })
}

/// Delete an image file and its caption .txt from disk.
#[tauri::command]
pub fn delete_image(image_path: String) -> Result<(), String> {
    let path = PathBuf::from(&image_path);
    if !path.exists() || !path.is_file() {
        return Err("Image file not found".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    let txt_path = path.with_extension("txt");
    if txt_path.exists() && txt_path.is_file() {
        let _ = std::fs::remove_file(&txt_path);
    }
    Ok(())
}
