fn main() {
    // Tauri's build helper watches configuration and capabilities, but its
    // compiled Windows resource must also be regenerated when icons change.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "begin_export",
            "finish_export",
            "finish_pdf",
            "fetch_export_image",
            "cancel_export",
            "open_document",
            "read_document_image",
            "close_document",
            "remember_document",
            "resume_document",
        ]),
    ))
    .expect("failed to build application permissions");
}
