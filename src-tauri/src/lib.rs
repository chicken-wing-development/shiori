mod backend;
mod commands;
mod filesystem;
mod pdf;
mod remote_images;

pub fn run() {
    tauri::Builder::default()
        .manage(backend::Backend::default())
        .manage(pdf::PdfDocuments::default())
        .register_uri_scheme_protocol("shiori-pdf", pdf::response)
        .invoke_handler(tauri::generate_handler![
            commands::begin_export,
            commands::finish_export,
            commands::finish_pdf,
            commands::fetch_export_image,
            commands::cancel_export,
            commands::open_document,
            commands::read_document_image,
            commands::close_document,
            commands::remember_document,
            commands::resume_document
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                commands::dropped(window, paths);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("shiori could not start");
}
