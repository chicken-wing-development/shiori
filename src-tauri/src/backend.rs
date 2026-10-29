//! Opaque document capabilities and single-use save tickets. No UI dependencies.
use crate::filesystem as fs;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_PENDING: usize = 16;
#[derive(Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub token: String,
    pub root: PathBuf,
}
#[derive(Clone, Serialize)]
pub struct OpenedDocument {
    pub token: String,
    pub name: String,
    pub content: String,
}
#[derive(Serialize)]
pub struct ImageData {
    pub name: String,
    pub mime: &'static str,
    pub data: String,
}
pub struct Document {
    pub root: PathBuf,
    sizes: Mutex<HashMap<PathBuf, usize>>,
}
#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveKind {
    Markdown,
    Svg,
    Html,
    Pdf,
}
impl SaveKind {
    pub fn filter(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Markdown => ("Markdown", &["md", "markdown"]),
            Self::Svg => ("SVG", &["svg"]),
            Self::Html => ("HTML", &["html"]),
            Self::Pdf => ("PDF", &["pdf"]),
        }
    }
    fn limit(self) -> usize {
        match self {
            Self::Markdown => fs::MARKDOWN_BYTES,
            Self::Svg => fs::SVG_BYTES,
            Self::Html => fs::HTML_BYTES,
            Self::Pdf => fs::PDF_BYTES,
        }
    }
}
pub struct Destination {
    path: PathBuf,
    kind: SaveKind,
}
#[derive(Default)]
pub struct Backend {
    documents: Mutex<HashMap<String, Arc<Document>>>,
    destinations: Mutex<HashMap<String, Destination>>,
}
impl Backend {
    pub fn open(&self, selected: &Path) -> Result<OpenedDocument, String> {
        let (root, content) = fs::read_markdown(selected)?;
        let name = selected
            .file_name()
            .ok_or("ファイル名が不正です。")?
            .to_string_lossy()
            .into_owned();
        let token = uuid::Uuid::new_v4().to_string();
        self.restore(Bookmark {
            token: token.clone(),
            root,
        })?;
        Ok(OpenedDocument {
            token,
            name,
            content,
        })
    }
    pub fn document(&self, token: &str) -> Result<Arc<Document>, String> {
        self.documents
            .lock()
            .map_err(|_| "文書を確認できません。")?
            .get(token)
            .cloned()
            .ok_or_else(|| "「開く」からMarkdownを選び直してください。".into())
    }
    pub fn restore(&self, bookmark: Bookmark) -> Result<(), String> {
        if !bookmark.root.is_absolute() || uuid::Uuid::parse_str(&bookmark.token).is_err() {
            return Err("文書の場所を確認できません。".into());
        }
        let mut documents = self
            .documents
            .lock()
            .map_err(|_| "文書を保持できません。")?;
        if documents.contains_key(&bookmark.token) {
            return Ok(());
        }
        if documents.len() >= MAX_PENDING {
            return Err("文書を開く処理が多すぎます。".into());
        }
        documents.insert(
            bookmark.token,
            Arc::new(Document {
                root: bookmark.root,
                sizes: Mutex::new(HashMap::new()),
            }),
        );
        Ok(())
    }
    pub fn close(&self, token: &str) -> Result<(), String> {
        self.documents
            .lock()
            .map_err(|_| "文書を閉じられません。")?
            .remove(token);
        Ok(())
    }
    pub fn bookmark(&self, token: &str) -> Result<Bookmark, String> {
        Ok(Bookmark {
            token: token.into(),
            root: self.document(token)?.root.clone(),
        })
    }
    pub fn reserve_save(&self, selected: PathBuf, kind: SaveKind) -> Result<String, String> {
        if !selected.is_absolute() {
            return Err("保存先が不正です。".into());
        }
        let mut destinations = self
            .destinations
            .lock()
            .map_err(|_| "保存先を保持できません。")?;
        if destinations.len() >= MAX_PENDING {
            return Err("保存処理が多すぎます。".into());
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        destinations.insert(
            ticket.clone(),
            Destination {
                path: selected,
                kind,
            },
        );
        Ok(ticket)
    }
    pub fn take_save(&self, ticket: &str) -> Result<Destination, String> {
        self.destinations
            .lock()
            .map_err(|_| "保存先を確認できません。")?
            .remove(ticket)
            .ok_or_else(|| "保存先を選択してください。".into())
    }
    pub fn cancel_save(&self, ticket: &str) -> Result<(), String> {
        self.destinations
            .lock()
            .map_err(|_| "保存処理を中止できません。")?
            .remove(ticket);
        Ok(())
    }
}
impl Document {
    pub fn image(&self, source: &str) -> Result<ImageData, String> {
        let (actual, mut file) = fs::open_image(&self.root, source)?;
        let mime = fs::image_mime(&actual).ok_or("対応していない画像形式です。")?;
        // Serialize per-document accounting, including concurrent image requests.
        let mut sizes = self
            .sizes
            .lock()
            .map_err(|_| "画像のサイズを確認できません。")?;
        if sizes.len() >= fs::IMAGE_COUNT && !sizes.contains_key(&actual) {
            return Err("参照画像は100個までです。".into());
        }
        let bytes = fs::read_limited(&mut file, fs::IMAGE_BYTES)?;
        if sizes.values().sum::<usize>() - sizes.get(&actual).copied().unwrap_or(0) + bytes.len()
            > fs::IMAGE_TOTAL_BYTES
        {
            return Err("参照画像は合計32 MBまでです。".into());
        }
        let name = actual.file_name().unwrap().to_string_lossy().into_owned();
        sizes.insert(actual, bytes.len());
        Ok(ImageData {
            name,
            mime,
            data: STANDARD.encode(bytes),
        })
    }
}
impl Destination {
    pub fn commit(self, content: &str) -> Result<(), String> {
        if self.kind == SaveKind::Pdf {
            return Err("PDFは専用の生成処理が必要です。".into());
        }
        if content.len() > self.kind.limit() {
            return Err(format!(
                "保存できるサイズは{} MBまでです。",
                self.kind.limit() / 1024 / 1024
            ));
        }
        fs::write_bytes(&self.path, content.as_bytes())
    }
    pub fn is_pdf(&self) -> bool {
        self.kind == SaveKind::Pdf
    }
    pub fn commit_pdf(self, bytes: &[u8]) -> Result<(), String> {
        if !self.is_pdf() || !bytes.starts_with(b"%PDF-") || bytes.len() > fs::PDF_BYTES {
            return Err("PDFの形式またはサイズが不正です。".into());
        }
        fs::write_bytes(&self.path, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Backend, OpenedDocument) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("note.md"), "# 文書").unwrap();
        std::fs::write(dir.path().join("img/sharp1.png"), "image").unwrap();
        let backend = Backend::default();
        let opened = backend.open(&dir.path().join("note.md")).unwrap();
        (dir, backend, opened)
    }
    #[test]
    fn opens_sibling_images_without_exposing_paths_and_revokes_capability() {
        let (_dir, backend, opened) = fixture();
        assert_eq!(
            backend
                .document(&opened.token)
                .unwrap()
                .image("./img/sharp1.png")
                .unwrap()
                .data,
            STANDARD.encode(b"image")
        );
        assert!(backend.document("C:\\arbitrary").is_err());
        backend.close(&opened.token).unwrap();
        assert!(backend.document(&opened.token).is_err());
    }
    #[test]
    fn restored_bookmark_keeps_the_original_base_directory() {
        let (_dir, backend, opened) = fixture();
        let bookmark: Bookmark = serde_json::from_slice(
            &serde_json::to_vec(&backend.bookmark(&opened.token).unwrap()).unwrap(),
        )
        .unwrap();
        let restarted = Backend::default();
        restarted.restore(bookmark).unwrap();
        assert!(restarted
            .document(&opened.token)
            .unwrap()
            .image("img/sharp1.png")
            .is_ok());
    }
    #[test]
    fn image_size_total_and_count_limits_apply_to_unique_files() {
        let (dir, backend, opened) = fixture();
        let doc = backend.document(&opened.token).unwrap();
        for i in 0..=fs::IMAGE_COUNT {
            let name = format!("{i}.png");
            std::fs::write(dir.path().join(&name), "x").unwrap();
            assert_eq!(doc.image(&name).is_ok(), i < fs::IMAGE_COUNT);
        }
        assert!(doc.image("0.png").is_ok());
        let opened = backend.open(&dir.path().join("note.md")).unwrap();
        let doc = backend.document(&opened.token).unwrap();
        for i in 0..5 {
            let name = format!("large{i}.png");
            std::fs::File::create(dir.path().join(&name))
                .unwrap()
                .set_len(fs::IMAGE_BYTES as u64)
                .unwrap();
            assert_eq!(doc.image(&name).is_ok(), i < 4);
        }
        std::fs::File::create(dir.path().join("oversize.png"))
            .unwrap()
            .set_len(fs::IMAGE_BYTES as u64 + 1)
            .unwrap();
        assert!(doc.image("oversize.png").is_err());
    }
    #[test]
    fn save_tickets_are_single_use_cancelable_and_reject_paths() {
        let (dir, backend, _opened) = fixture();
        let path = dir.path().join("saved.md");
        assert!(backend.take_save(path.to_str().unwrap()).is_err());
        let ticket = backend
            .reserve_save(path.clone(), SaveKind::Markdown)
            .unwrap();
        backend
            .take_save(&ticket)
            .unwrap()
            .commit("# 保存")
            .unwrap();
        assert!(backend.take_save(&ticket).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# 保存");
        let ticket = backend
            .reserve_save(path.clone(), SaveKind::Markdown)
            .unwrap();
        backend.cancel_save(&ticket).unwrap();
        assert!(backend.take_save(&ticket).is_err());
        let ticket = backend
            .reserve_save(path.clone(), SaveKind::Markdown)
            .unwrap();
        assert!(backend
            .take_save(&ticket)
            .unwrap()
            .commit(&"あ".repeat(700_000))
            .is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "# 保存");
    }

    #[test]
    fn html_accepts_embedded_assets_above_the_markdown_limit() {
        let (dir, backend, _) = fixture();
        let path = dir.path().join("export.html");
        let content = format!("<!doctype html><p>{}</p>", "a".repeat(3 * 1024 * 1024));
        let ticket = backend.reserve_save(path.clone(), SaveKind::Html).unwrap();
        backend
            .take_save(&ticket)
            .unwrap()
            .commit(&content)
            .unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), content);
        assert!(backend.take_save(&ticket).is_err());
    }

    #[test]
    fn pdf_rejects_wrong_types_and_preserves_existing_files_on_failure() {
        let (dir, backend, _) = fixture();
        let path = dir.path().join("export.pdf");
        std::fs::write(&path, b"original").unwrap();
        let ticket = backend.reserve_save(path.clone(), SaveKind::Pdf).unwrap();
        assert!(backend
            .take_save(&ticket)
            .unwrap()
            .commit("<html/>")
            .is_err());
        assert!(backend.take_save(&ticket).is_err());
        let ticket = backend.reserve_save(path.clone(), SaveKind::Pdf).unwrap();
        assert!(backend
            .take_save(&ticket)
            .unwrap()
            .commit_pdf(b"invalid")
            .is_err());
        assert!(backend.take_save(&ticket).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let ticket = backend
            .reserve_save(dir.path().join("wrong.html"), SaveKind::Html)
            .unwrap();
        assert!(backend
            .take_save(&ticket)
            .unwrap()
            .commit_pdf(b"%PDF-1.7")
            .is_err());
        assert!(!dir.path().join("wrong.html").exists());
        let ticket = backend.reserve_save(path.clone(), SaveKind::Pdf).unwrap();
        backend
            .take_save(&ticket)
            .unwrap()
            .commit_pdf(b"%PDF-1.7\ncontent")
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.7\ncontent");
    }
}
