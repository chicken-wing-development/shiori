//! Public-network-only image retrieval. Validate DNS once, then pin those exact
//! addresses for the connection; neither redirects nor a proxy may bypass it.
use crate::filesystem::IMAGE_BYTES;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, Client, Url};
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};

const PRIVATE: &str = "内部ネットワーク・ローカル端末の画像URLは取得できません。画像をローカルファイルとして指定してください。";
static FETCH_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Serialize)]
pub struct RemoteImage {
    mime: String,
    data: String,
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only global unicast. Exclude special-purpose, documentation and
            // transition ranges (including IPv4-mapped/NAT64/6to4 addresses).
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

fn source_url(source: &str) -> Result<(Url, String), String> {
    if source.len() > 8192 || source.chars().any(char::is_control) {
        return Err("画像のURLが不正です。".into());
    }
    let mut url = Url::parse(source).map_err(|_| "画像のURLが不正です。")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("画像のURLが不正です。".into());
    }
    url.set_fragment(None);
    let host = url
        .host_str()
        .ok_or("画像のURLが不正です。")?
        .trim_matches(['[', ']'])
        .to_string();
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !public_ip(ip) {
            return Err(PRIVATE.into());
        }
    } else {
        let name = host.trim_end_matches('.');
        if !name.contains('.')
            || ["localhost", "local", "internal", "home", "lan"]
                .iter()
                .any(|suffix| name == *suffix || name.ends_with(&format!(".{suffix}")))
        {
            return Err(PRIVATE.into());
        }
    }
    Ok((url, host))
}

fn validate_addresses(addresses: &[SocketAddr]) -> Result<(), String> {
    if addresses.is_empty()
        || addresses.len() > 64
        || addresses.iter().any(|address| !public_ip(address.ip()))
    {
        return Err(PRIVATE.into());
    }
    Ok(())
}

async fn image_response(mut response: reqwest::Response) -> Result<RemoteImage, String> {
    if !response.status().is_success() {
        return Err("外部画像を取得できません。リダイレクトは許可されていません。".into());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "image/svg+xml"
    ) {
        return Err("対応していない画像形式です。".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > IMAGE_BYTES as u64)
    {
        return Err("参照画像は1枚8 MBまでです。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "外部画像を読み込めません。")?
    {
        if chunk.len() > IMAGE_BYTES.saturating_sub(bytes.len()) {
            return Err("参照画像は1枚8 MBまでです。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(RemoteImage {
        mime,
        data: STANDARD.encode(bytes),
    })
}

async fn fetch_inner(source: &str) -> Result<RemoteImage, String> {
    let (url, host) = source_url(source)?;
    let port = url.port_or_known_default().ok_or("画像のURLが不正です。")?;
    let addresses: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "画像の配信元を確認できません。")?
        .collect();
    validate_addresses(&addresses)?;
    let client = pinned_client(&host, &addresses)?;
    // Fresh client, no cookie store, authentication, caller headers or referrer.
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "外部画像を取得できません。")?;
    image_response(response).await
}

fn pinned_client(host: &str, addresses: &[SocketAddr]) -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .referer(false)
        .http1_only()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|_| "外部画像の取得を準備できません。".into())
}

pub async fn fetch(source: &str) -> Result<RemoteImage, String> {
    let _slot = FETCH_SLOTS
        .try_acquire()
        .map_err(|_| "外部画像の取得が多すぎます。")?;
    tokio::time::timeout(Duration::from_secs(15), fetch_inner(source))
        .await
        .map_err(|_| "外部画像の取得がタイムアウトしました。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn serve(response: Vec<u8>) -> (SocketAddr, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8];
            while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                if stream.read(&mut byte).unwrap_or(0) == 0 {
                    break;
                }
                request.push(byte[0]);
            }
            let _ = stream.write_all(&response);
            String::from_utf8(request).unwrap()
        });
        (address, thread)
    }

    // Tests exercise the transport on our own loopback fixture. Production only
    // constructs this client after validate_addresses has rejected loopback.
    fn request_fixture(response: Vec<u8>) -> (Result<RemoteImage, String>, String) {
        let (address, thread) = serve(response);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(async {
            let response = pinned_client("image.invalid", &[address])
                .unwrap()
                .get(format!("http://image.invalid:{}/image.png", address.port()))
                .send()
                .await
                .unwrap();
            image_response(response).await
        });
        (result, thread.join().unwrap())
    }

    #[test]
    fn transport_pins_dns_and_sends_no_credentials_or_referrer() {
        let (result, request) = request_fixture(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\npng".to_vec());
        assert_eq!(result.unwrap().data, STANDARD.encode(b"png"));
        assert!(request.starts_with("GET /image.png HTTP/1.1\r\n"));
        for header in [
            "authorization:",
            "cookie:",
            "referer:",
            "proxy-authorization:",
        ] {
            assert!(!request.to_ascii_lowercase().contains(header));
        }
    }

    #[test]
    fn transport_rejects_redirects_and_unsupported_content() {
        let redirect_target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        redirect_target.set_nonblocking(true).unwrap();
        let response = format!("HTTP/1.1 302 Found\r\nLocation: http://{}/secret.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", redirect_target.local_addr().unwrap());
        assert!(request_fixture(response.into_bytes()).0.is_err());
        assert_eq!(
            redirect_target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        assert!(request_fixture(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()).0.is_err());
    }

    #[test]
    fn transport_limits_both_declared_and_streamed_body_sizes() {
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", IMAGE_BYTES + 1);
        assert!(request_fixture(response.into_bytes())
            .0
            .err()
            .unwrap()
            .contains("8 MB"));
        let mut response = format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:X}\r\n", IMAGE_BYTES + 1).into_bytes();
        response.extend(vec![0u8; IMAGE_BYTES + 1]);
        response.extend_from_slice(b"\r\n0\r\n\r\n");
        assert!(request_fixture(response).0.err().unwrap().contains("8 MB"));
    }

    #[test]
    fn rejects_private_special_and_encoded_addresses() {
        for host in [
            "127.0.0.1",
            "127.1",
            "2130706433",
            "0x7f000001",
            "0177.0.0.1",
            "0.0.0.0",
            "10.1.2.3",
            "100.64.1.1",
            "169.254.169.254",
            "172.31.1.1",
            "192.168.1.1",
            "198.18.0.1",
            "224.0.0.1",
            "[::1]",
            "[::ffff:127.0.0.1]",
            "[64:ff9b::7f00:1]",
            "[fc00::1]",
            "[fe80::1]",
            "[2002:7f00:1::]",
            "[2001:db8::1]",
            "localhost.",
            "a.localhost",
            "device.local",
            "router",
        ] {
            assert!(
                source_url(&format!("http://{host}/image.png")).is_err(),
                "{host}"
            );
        }
        for source in [
            "file:///C:/a.png",
            "ftp://example.com/a.png",
            "https://user:secret@example.com/a.png",
            "http://example.com/\nimage.png",
        ] {
            assert!(source_url(source).is_err());
        }
        for source in [
            "https://example.com/a.png",
            "http://8.8.8.8/a.png",
            "https://[2606:4700:4700::1111]/a.png",
        ] {
            assert!(source_url(source).is_ok());
        }
    }

    #[test]
    fn rejects_private_dns_results_and_mixed_answers() {
        let public: SocketAddr = "8.8.8.8:443".parse().unwrap();
        let private: SocketAddr = "127.0.0.1:443".parse().unwrap();
        assert!(validate_addresses(&[]).is_err());
        assert!(validate_addresses(&[private]).is_err());
        assert!(validate_addresses(&[public, private]).is_err());
        assert!(validate_addresses(&[public]).is_ok());
    }

    #[test]
    fn blocked_loopback_never_receives_a_connection() {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        server.set_nonblocking(true).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(runtime
            .block_on(fetch(&format!(
                "http://{}/private.png",
                server.local_addr().unwrap()
            )))
            .is_err());
        assert_eq!(
            server.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}
