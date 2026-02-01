#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::open_project,
            commands::project::find_duplicates,
            commands::images::get_thumbnail,
            commands::images::get_image_data_url,
            commands::images::crop_image,
            commands::images::batch_resize,
            commands::images::delete_image,
            commands::captions::read_caption,
            commands::captions::write_caption,
            commands::captions::add_tag,
            commands::captions::remove_tag,
            commands::captions::reorder_tags,
            commands::lm_studio::test_lm_studio_connection,
            commands::lm_studio::generate_caption_lm_studio,
            commands::lm_studio::generate_captions_batch,
            commands::ollama::test_ollama_connection,
            commands::export::export_dataset,
            commands::export::export_by_rating,
            commands::ratings::set_rating,
            commands::ratings::get_ratings,
            commands::ratings::clear_all_ratings,
            commands::resource_monitor::get_resource_stats,
            commands::batch_rename::batch_rename,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LoRA Dataset Studio");
}
