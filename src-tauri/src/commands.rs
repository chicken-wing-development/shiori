//! Tauri adapters: native picker/drop grants access; frontend sends opaque IDs.
use crate::{
    backend::{Backend, Bookmark, ImageData, OpenedDocument, SaveKind},
    filesystem as fs,
};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn fetch_export_image(
    source: String,
) -> Result<crate::remote_images::RemoteImage, String> {
    crate::remote_images::fetch(&source).await
}

#[tauri::command]
pub async fn open_document(window: WebviewWindow) -> Result<Option<OpenedDocument>, String> {
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
            .blocking_pick_file();
        selected
            .map(|file| {
                app.state::<Backend>()
                    .open(&file.into_path().map_err(|_| "ファイルの場所が不正です。")?)
            })
            .transpose()
    })
    .await
    .map_err(|_| "ファイルを開けません。")?
}
#[tauri::command]
pub async fn read_document_image(
    state: State<'_, Backend>,
    token: String,
    source: String,
) -> Result<ImageData, String> {
    let document = state.document(&token)?;
    tauri::async_runtime::spawn_blocking(move || document.image(&source))
        .await
        .map_err(|_| "画像を読み込めません。")?
}
#[tauri::command]
pub fn close_document(state: State<'_, Backend>, token: String) -> Result<(), String> {
    state.close(&token)
}

#[tauri::command]
pub async fn begin_export(
    window: WebviewWindow,
    name: String,
    kind: SaveKind,
) -> Result<Option<String>, String> {
    if !fs::valid_filename(&name) {
        return Err("ファイル名が不正です。".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (label, extensions) = kind.filter();
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(name)
            .add_filter(label, extensions)
            .blocking_save_file();
        selected
            .map(|file| {
                app.state::<Backend>()
                    .reserve_save(file.into_path().map_err(|_| "保存先が不正です。")?, kind)
            })
            .transpose()
    })
    .await
    .map_err(|_| "保存先を選択できません。")?
}
#[tauri::command]
pub async fn finish_export(
    state: State<'_, Backend>,
    ticket: String,
    content: String,
) -> Result<(), String> {
    let destination = state.take_save(&ticket)?;
    tauri::async_runtime::spawn_blocking(move || destination.commit(&content))
        .await
        .map_err(|_| "保存処理を完了できません。")?
}
#[tauri::command]
pub async fn finish_pdf(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    ticket: String,
    html: String,
) -> Result<(), String> {
    let destination = state.take_save(&ticket)?;
    if !destination.is_pdf() {
        return Err("PDFの保存先を選択してください。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        destination.commit_pdf(&crate::pdf::render(app, html)?)
    })
    .await
    .map_err(|_| "PDFを保存できませんでした。")?
}
#[tauri::command]
pub fn cancel_export(state: State<'_, Backend>, ticket: String) -> Result<(), String> {
    state.cancel_save(&ticket)
}

fn bookmark_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "文書の場所を保存できません。")?;
    std::fs::create_dir_all(&dir).map_err(|_| "文書の場所を保存できません。")?;
    Ok(dir.join("document-location.json"))
}
#[tauri::command]
pub async fn remember_document(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    token: Option<String>,
) -> Result<(), String> {
    let bookmark = token.map(|token| state.bookmark(&token)).transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = serde_json::to_vec(&bookmark).map_err(|_| "文書の場所を保存できません。")?;
        fs::write_bytes(&bookmark_path(&app)?, &bytes)
    })
    .await
    .map_err(|_| "文書の場所を保存できません。")?
}
fn load_bookmark(path: &Path, token: &str) -> Result<Bookmark, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "文書を開き直してください。")?;
    let bookmark: Bookmark = serde_json::from_slice(&fs::read_limited(&mut file, 64 * 1024)?)
        .map_err(|_| "文書を開き直してください。")?;
    if bookmark.token != token {
        return Err("文書を開き直してください。".into());
    }
    Ok(bookmark)
}
#[tauri::command]
pub async fn resume_document(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    token: String,
) -> Result<(), String> {
    if state.document(&token).is_ok() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Backend>()
            .restore(load_bookmark(&bookmark_path(&app)?, &token)?)
    })
    .await
    .map_err(|_| "文書を開き直してください。")?
}

pub fn dropped(window: &tauri::Window, paths: &[PathBuf]) {
    let documents: Vec<_> = paths
        .iter()
        .filter(|path| fs::is_markdown(path))
        .cloned()
        .collect();
    if documents.len() != 1 {
        let _ = window.emit(
            "document-open-error",
            "編集するMarkdownファイルを1つドロップしてください。",
        );
        return;
    }
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let backend = window.state::<Backend>();
        match backend.open(&documents[0]) {
            Ok(document) => {
                if window.emit("document-opened", &document).is_err() {
                    let _ = backend.close(&document.token);
                }
            }
            Err(message) => {
                let _ = window.emit("document-open-error", message);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restore_requires_exact_recorded_token_and_a_valid_bookmark() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bookmark.json");
        let token = uuid::Uuid::new_v4().to_string();
        fs::write_bytes(
            &path,
            &serde_json::to_vec(&Bookmark {
                token: token.clone(),
                root: dir.path().into(),
            })
            .unwrap(),
        )
        .unwrap();
        assert!(load_bookmark(&path, &token).is_ok());
        assert!(load_bookmark(&path, "other").is_err());
        fs::write_bytes(&path, b"null").unwrap();
        assert!(load_bookmark(&path, &token).is_err());
    }
}
