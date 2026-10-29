//! Filesystem policy shared by document loading, image loading and atomic saves.
//! No command accepts a filesystem path from the webview.
use std::{
    fs::File,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

pub const MARKDOWN_BYTES: usize = 2 * 1024 * 1024;
pub const IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const SVG_BYTES: usize = 10 * 1024 * 1024;
pub const HTML_BYTES: usize = 64 * 1024 * 1024;
pub const PDF_BYTES: usize = 128 * 1024 * 1024;
pub const IMAGE_TOTAL_BYTES: usize = 32 * 1024 * 1024;
pub const IMAGE_COUNT: usize = 100;

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "txt"
            )
        })
}
pub fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}
pub fn valid_filename(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    !name.is_empty()
        && name.encode_utf16().count() <= 240
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !name.ends_with(['.', ' '])
        && !["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        && !((stem.starts_with("COM") || stem.starts_with("LPT"))
            && ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&&stem[3..]))
}

pub fn relative_image(source: &str) -> Result<PathBuf, String> {
    let invalid = || "画像はMarkdownのフォルダー内の相対パスで指定してください。".to_string();
    if source.len() > 8192 {
        return Err(invalid());
    }
    let raw = source.split(['?', '#']).next().unwrap_or_default();
    for (i, byte) in raw.bytes().enumerate() {
        if byte == b'%'
            && !raw
                .as_bytes()
                .get(i + 1..i + 3)
                .is_some_and(|v| v.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(invalid());
        }
    }
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| invalid())?
        .replace('\\', "/");
    if decoded.starts_with('/') {
        return Err(invalid());
    }
    let mut relative = PathBuf::new();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if !relative.pop() {
                    return Err(invalid());
                }
            }
            _ if valid_filename(part) => relative.push(part),
            _ => return Err(invalid()),
        }
    }
    if image_mime(&relative).is_none() {
        return Err("対応する画像はPNG・JPEG・GIF・WebP・AVIF・SVGです。".into());
    }
    Ok(relative)
}

pub fn read_limited(file: &mut File, limit: usize) -> Result<Vec<u8>, String> {
    let metadata = file
        .metadata()
        .map_err(|_| "ファイルの情報を取得できません。")?;
    if !metadata.is_file() {
        return Err("通常のファイルを選択してください。".into());
    }
    if metadata.len() > limit as u64 {
        return Err(format!(
            "ファイルは{} MB以下にしてください。",
            limit / 1024 / 1024
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "ファイルを読み込めません。")?;
    if bytes.len() > limit {
        return Err("読み込み中にファイルがサイズの上限を超えました。".into());
    }
    Ok(bytes)
}

// The final path of the open handle prevents junction replacement between a
// path check and the read. Reads use this same handle after the containment check.
#[cfg(windows)]
pub fn handle_path(file: &File, _path: &Path) -> Result<PathBuf, String> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32768];
    // SAFETY: File owns a live handle and buffer is writable for its full length.
    let len = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if len == 0 || len >= buffer.len() {
        return Err("ファイルの場所を確認できません。".into());
    }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len])))
}
#[cfg(not(windows))]
pub fn handle_path(_file: &File, path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|_| "ファイルの場所を確認できません。".into())
}

pub fn read_markdown(selected: &Path) -> Result<(PathBuf, String), String> {
    if !is_markdown(selected) {
        return Err("Markdownファイルを1つ選択してください。".into());
    }
    let mut file = File::open(selected).map_err(|_| "Markdownファイルを開けません。")?;
    let actual = handle_path(&file, selected)?;
    let root = actual
        .parent()
        .ok_or("文書の場所を確認できません。")?
        .to_path_buf();
    let content = String::from_utf8(read_limited(&mut file, MARKDOWN_BYTES)?)
        .map_err(|_| "UTF-8のMarkdownファイルを選択してください。")?;
    Ok((
        root,
        content
            .strip_prefix('\u{feff}')
            .unwrap_or(&content)
            .to_owned(),
    ))
}

pub fn open_image(root: &Path, source: &str) -> Result<(PathBuf, File), String> {
    let relative = relative_image(source)?;
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "画像が見つかりません。パスを確認してください。")?;
    if !path.starts_with(root) {
        return Err("選択したフォルダーの外の画像は読み込めません。".into());
    }
    let file = File::open(&path).map_err(|_| "画像を開けません。")?;
    let actual = handle_path(&file, &path)?;
    if !actual.starts_with(root) || image_mime(&actual).is_none() {
        return Err("画像の読み取り範囲または形式が不正です。".into());
    }
    Ok((actual, file))
}

pub fn atomic_write(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "保存先が不正です。"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    if let Ok(metadata) = path.metadata() {
        if metadata.permissions().readonly() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "保存先は読み取り専用です。",
            ));
        }
        temporary
            .as_file()
            .set_permissions(metadata.permissions())?;
    }
    write(temporary.as_file_mut())?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write(path, |file| file.write_all(bytes))
        .map_err(|_| "保存できませんでした。元のファイルは保持されています。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relative_paths_decode_once_and_normalize_separators() {
        for (source, expected) in [
            ("./img/sharp1.png", "img/sharp1.png"),
            (
                "img/../img/日本語%20画像.PNG?x#caption",
                "img/日本語 画像.PNG",
            ),
            ("img\\photo.png", "img/photo.png"),
            ("img/a%23b.png", "img/a#b.png"),
            ("img/a%2520b.png", "img/a%20b.png"),
        ] {
            assert_eq!(relative_image(source).unwrap(), PathBuf::from(expected));
        }
    }
    #[test]
    fn rejects_traversal_urls_devices_and_encoded_bypasses() {
        for source in [
            "../x.png",
            "%2e%2e/x.png",
            "img/../../x.png",
            "/img/a.png",
            "\\\\server\\a.png",
            "%2f%2fserver/a.png",
            "C:/a.png",
            "C%3a/a.png",
            "https://site/a.png",
            "file:///a.png",
            "img/a.png:secret",
            "img/a%00.png",
            "img/%xx.png",
            "img/%ff.png",
            "NUL.png",
            "COM1.png",
            "img./a.png",
            "img/a.exe",
            "#fragment",
            "img/a%3fb.png",
        ] {
            assert!(relative_image(source).is_err(), "{source}");
        }
    }
    #[test]
    fn filename_validation_matches_windows_rules() {
        for name in [
            "../note.md",
            "C:\\note.md",
            "CON.md",
            "LPT1.svg",
            "bad\0.md",
            "trailing.",
            "",
            "COM¹.md",
        ] {
            assert!(!valid_filename(name), "{name}");
        }
        assert!(valid_filename("日本語.md"));
    }
    #[test]
    fn read_markdown_rejects_oversize_binary_and_non_document_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "\u{feff}# 日本語").unwrap();
        assert_eq!(read_markdown(&path).unwrap().1, "# 日本語");
        std::fs::write(&path, [0xff]).unwrap();
        assert!(read_markdown(&path).is_err());
        File::create(&path)
            .unwrap()
            .set_len(MARKDOWN_BYTES as u64 + 1)
            .unwrap();
        assert!(read_markdown(&path).is_err());
        assert!(read_markdown(&dir.path().join("app.exe")).is_err());
    }
    #[test]
    fn interrupted_write_preserves_original_and_removes_temporary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        write_bytes(&path, b"original").unwrap();
        assert!(atomic_write(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("disk full"))
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        write_bytes(&path, "更新".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "更新");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn locked_destination_preserves_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        write_bytes(&path, b"original").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(write_bytes(&path, b"new").is_err());
        drop(lock);
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn junction_and_open_handle_cannot_escape_selected_folder() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.png"), "private").unwrap();
        let status = std::process::Command::new("powershell").args(["-NoProfile", "-Command", "New-Item -ItemType Junction -Path $env:SHIORI_TEST_LINK -Target $env:SHIORI_TEST_TARGET | Out-Null"]).env("SHIORI_TEST_LINK", dir.path().join("link")).env("SHIORI_TEST_TARGET", outside.path()).status().unwrap();
        assert!(status.success());
        let linked = dir.path().join("link/secret.png");
        let file = File::open(&linked).unwrap();
        assert!(!handle_path(&file, &linked)
            .unwrap()
            .starts_with(dir.path().canonicalize().unwrap()));
        assert!(open_image(&dir.path().canonicalize().unwrap(), "link/secret.png").is_err());
        std::fs::remove_dir(dir.path().join("link")).unwrap();
    }
}
