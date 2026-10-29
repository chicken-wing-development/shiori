//! Render one isolated, scriptless HTML snapshot with WebView2's PDF engine.
//! This webview has no Tauri capability. It can request only its own document.
use crate::filesystem::{HTML_BYTES, PDF_BYTES};
use std::{collections::HashMap, sync::Mutex};
use tauri::Manager;

const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
#[derive(Default)]
pub struct PdfDocuments(Mutex<HashMap<String, Vec<u8>>>);
impl PdfDocuments {
    fn insert(&self, label: &str, html: String) -> Result<(), String> {
        if html.len() > HTML_BYTES {
            return Err("PDFの元になるHTMLは64 MBまでです。".into());
        }
        let mut documents = self.0.lock().map_err(|_| "PDF処理を準備できません。")?;
        if !documents.is_empty() {
            return Err("別のPDFを作成中です。".into());
        }
        documents.insert(label.into(), html.into_bytes());
        Ok(())
    }
    fn body(&self, label: &str, path: &str) -> Option<Vec<u8>> {
        if path != format!("/{label}") {
            return None;
        }
        self.0.lock().ok()?.get(label).cloned()
    }
    fn remove(&self, label: &str) {
        if let Ok(mut documents) = self.0.lock() {
            documents.remove(label);
        }
    }
}
pub fn response(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let body = if request.method() == tauri::http::Method::GET {
        context
            .app_handle()
            .state::<PdfDocuments>()
            .body(context.webview_label(), request.uri().path())
    } else {
        None
    };
    tauri::http::Response::builder()
        .status(if body.is_some() { 200 } else { 404 })
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", CSP)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body.unwrap_or_default())
        .expect("fixed response headers")
}

#[cfg(windows)]
mod windows_pdf {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use webview2_com::{
        ExecuteScriptCompletedHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_16},
        PrintToPdfStreamCompletedHandler,
    };
    use windows::{
        core::{Interface, PCWSTR},
        Win32::System::Com::IStream,
    };

    struct Cleanup {
        app: tauri::AppHandle,
        label: String,
        window: Option<WebviewWindow>,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Some(window) = &self.window {
                let _ = window.destroy();
            }
            self.app.state::<PdfDocuments>().remove(&self.label);
        }
    }

    fn ready(window: &WebviewWindow) -> Result<bool, String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        window.with_webview(move |platform| {
            let failed = sender.clone();
            // Fixed code only; untrusted HTML never contributes JavaScript.
            let script: Vec<u16> = "document.readyState === 'complete' && document.fonts.status === 'loaded' && Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)".encode_utf16().chain(Some(0)).collect();
            // SAFETY: all COM calls run on WebView2's owning UI thread, and
            // ExecuteScript copies the NUL-terminated argument during the call.
            let result = unsafe { platform.controller().CoreWebView2().and_then(|core| {
                let callback = ExecuteScriptCompletedHandler::create(Box::new(move |error, result| {
                    let value = error.map(|_| result == "true").map_err(|_| "PDFの画像読み込み状態を確認できません。".to_string());
                    let _ = sender.send(value); Ok(())
                }));
                core.ExecuteScript(PCWSTR(script.as_ptr()), &callback)
            }) };
            if result.is_err() { let _ = failed.send(Err("PDFの描画状態を確認できません。".into())); }
        }).map_err(|_| "PDF描画用ウィンドウに接続できません。")?;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "PDFの画像読み込みがタイムアウトしました。")?
    }

    fn stream_bytes(stream: Option<IStream>) -> Result<Vec<u8>, String> {
        let stream = stream.ok_or("PDFのデータを取得できません。")?;
        let mut bytes = Vec::new();
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let mut count = 0;
            // SAFETY: the callback supplies a live stream on the UI thread;
            // buffer and count remain valid for the synchronous Read call.
            unsafe {
                stream.Read(
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    Some(&mut count),
                )
            }
            .ok()
            .map_err(|_| "PDFのデータを読み込めません。")?;
            if count == 0 {
                break;
            }
            if bytes.len() + count as usize > PDF_BYTES {
                return Err("PDFは128 MBまでです。".into());
            }
            bytes.extend_from_slice(&buffer[..count as usize]);
        }
        Ok(bytes)
    }

    fn print(window: &WebviewWindow) -> Result<Vec<u8>, String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        window
            .with_webview(move |platform| {
                let failed = sender.clone();
                // SAFETY: WebView2 interfaces stay on the owning UI thread. The
                // completion callback reads the PDF there and sends only owned bytes.
                let result: windows::core::Result<()> = unsafe {
                    (|| {
                        let environment: ICoreWebView2Environment6 =
                            platform.environment().cast()?;
                        let settings = environment.CreatePrintSettings()?;
                        settings.SetPageWidth(210.0 / 25.4)?;
                        settings.SetPageHeight(297.0 / 25.4)?;
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                        let core: ICoreWebView2_16 =
                            platform.controller().CoreWebView2()?.cast()?;
                        let callback = PrintToPdfStreamCompletedHandler::create(Box::new(
                            move |error, stream| {
                                let result = error
                                    .map_err(|_| "PDFを生成できません。".to_string())
                                    .and_then(|_| stream_bytes(stream));
                                let _ = sender.send(result);
                                Ok(())
                            },
                        ));
                        core.PrintToPdfStream(&settings, &callback)
                    })()
                };
                if result.is_err() {
                    let _ = failed.send(Err(
                        "PDF生成を開始できません。WebView2 Runtimeを確認してください。".into(),
                    ));
                }
            })
            .map_err(|_| "PDF描画用ウィンドウに接続できません。")?;
        receiver
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "PDF生成がタイムアウトしました。")?
    }

    pub fn render(app: tauri::AppHandle, html: String) -> Result<Vec<u8>, String> {
        let label = format!("pdf-{}", uuid::Uuid::new_v4());
        app.state::<PdfDocuments>().insert(&label, html)?;
        let mut cleanup = Cleanup {
            app: app.clone(),
            label: label.clone(),
            window: None,
        };
        let (loaded, receiver) = mpsc::sync_channel(1);
        let expected_path = format!("/{label}");
        let url = format!("shiori-pdf://localhost/{label}")
            .parse()
            .map_err(|_| "PDFのURLを作成できません。")?;
        let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::CustomProtocol(url))
            .title("PDF export")
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .inner_size(1000.0, 800.0)
            .on_navigation(move |url| {
                url.path() == expected_path
                    && ((url.scheme() == "shiori-pdf" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http"
                            && url.host_str() == Some("shiori-pdf.localhost")))
            })
            .on_page_load(move |_window, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    let _ = loaded.try_send(());
                }
            })
            .build()
            .map_err(|_| "PDF描画用ウィンドウを作成できません。")?;
        cleanup.window = Some(window.clone());
        receiver
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "PDF文書の読み込みがタイムアウトしました。")?;
        let deadline = Instant::now() + Duration::from_secs(20);
        while !ready(&window)? {
            if Instant::now() >= deadline {
                return Err(
                    "PDFに含める画像を読み込めません。画像の形式を確認してください。".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        print(&window)
    }
}
#[cfg(windows)]
pub use windows_pdf::render;
#[cfg(not(windows))]
pub fn render(_app: tauri::AppHandle, _html: String) -> Result<Vec<u8>, String> {
    Err("直接のPDF出力はWindows版で利用できます。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_document_is_scoped_to_its_window_and_removed_after_use() {
        let documents = PdfDocuments::default();
        documents.insert("pdf-one", "<p>one</p>".into()).unwrap();
        assert!(documents.body("main", "/pdf-one").is_none());
        assert!(documents.body("pdf-one", "/other").is_none());
        assert_eq!(
            documents.body("pdf-one", "/pdf-one").unwrap(),
            b"<p>one</p>"
        );
        assert!(documents.insert("pdf-two", "two".into()).is_err());
        documents.remove("pdf-one");
        assert!(documents.body("pdf-one", "/pdf-one").is_none());
        assert!(documents.insert("pdf-two", "two".into()).is_ok());
    }
}
