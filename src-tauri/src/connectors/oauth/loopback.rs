//! One-shot `127.0.0.1` listener for the OAuth redirect (RFC 8252).

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::error::AtlasError;

pub const TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Bounds a connection that connects and then says nothing.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

const PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Atlas</title>\
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}</style>\
</head><body><p>You can close this tab and return to Atlas</p></body></html>";

pub struct Listener {
    listener: TcpListener,
    pub port: u16,
}

/// Listen on the first free port of `ports`.
pub async fn bind(ports: &[u16]) -> Result<Listener, AtlasError> {
    for &port in ports {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            // The bound port, so port 0 (tests) reports the one the OS picked.
            let port = listener.local_addr().map_or(port, |a| a.port());
            return Ok(Listener { listener, port });
        }
    }
    Err(AtlasError::ConnectorPortBusy {
        message: "Every port Atlas may use for sign-in is taken".to_string(),
    })
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |d, (x, y)| d | (x ^ y)) == 0
}

impl Listener {
    /// Serve until one `/callback` request arrives, then return its code. The
    /// listener is consumed, so a second callback finds the port closed.
    pub async fn wait(
        self,
        state: &str,
        timeout: Duration,
        cancel: oneshot::Receiver<()>,
    ) -> Result<String, AtlasError> {
        tokio::select! {
            r = self.serve(state) => r,
            _ = cancel => Err(AtlasError::ConnectorCancelled { message: "Sign-in cancelled".to_string() }),
            _ = tokio::time::sleep(timeout) => Err(AtlasError::timeout("browser", "Sign-in timed out")),
        }
    }

    async fn serve(&self, state: &str) -> Result<String, AtlasError> {
        loop {
            let (mut stream, _) = self.listener.accept().await.map_err(AtlasError::io)?;
            let Some(target) = tokio::time::timeout(READ_TIMEOUT, read_target(&mut stream))
                .await
                .ok()
                .flatten()
            else {
                continue;
            };
            let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
                respond(&mut stream, "400 Bad Request", "").await;
                continue;
            };
            if url.path() != "/callback" {
                respond(&mut stream, "404 Not Found", "").await;
                continue;
            }
            let get = |k: &str| {
                url.query_pairs()
                    .find(|(n, _)| n == k)
                    .map(|(_, v)| v.into_owned())
            };
            respond(&mut stream, "200 OK", PAGE).await;
            if !get("state").is_some_and(|s| same(&s, state)) {
                return Err(AtlasError::ConnectorRemote {
                    message: "The sign-in response did not match this request".to_string(),
                    status: 400,
                });
            }
            if let Some(error) = get("error") {
                return Err(if error == "access_denied" {
                    AtlasError::ConnectorDenied {
                        message: "Access was denied".to_string(),
                    }
                } else {
                    AtlasError::ConnectorRemote {
                        message: format!("Sign-in failed: {error}"),
                        status: 400,
                    }
                });
            }
            return get("code").ok_or_else(|| AtlasError::ConnectorRemote {
                message: "The sign-in response had no code".to_string(),
                status: 400,
            });
        }
    }
}

/// The request target of a GET, e.g. `/callback?code=x`.
async fn read_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 8192 {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let text = String::from_utf8_lossy(&buf);
    let mut parts = text.lines().next()?.split(' ');
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_string)
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) async fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    fn keep_open() -> (oneshot::Sender<()>, oneshot::Receiver<()>) {
        oneshot::channel()
    }

    #[tokio::test]
    async fn returns_the_code_and_closes() {
        let l = bind(&[0]).await.unwrap();
        let port = l.port;
        let (_tx, rx) = keep_open();
        let task = tokio::spawn(l.wait("s1", TIMEOUT, rx));
        let page = get(port, "/callback?code=abc&state=s1").await;
        assert!(page.contains("close this tab"));
        assert_eq!(task.await.unwrap().unwrap(), "abc");
        // No "port is closed now" check: `wait(self)` drops the listener, and a
        // parallel test can be handed the freed port, which flaked on Windows CI.
    }

    #[tokio::test]
    async fn other_paths_are_ignored() {
        let l = bind(&[0]).await.unwrap();
        let port = l.port;
        let (_tx, rx) = keep_open();
        let task = tokio::spawn(l.wait("s", TIMEOUT, rx));
        assert!(get(port, "/favicon.ico").await.contains("404"));
        get(port, "/callback?code=c&state=s").await;
        assert_eq!(task.await.unwrap().unwrap(), "c");
    }

    #[tokio::test]
    async fn wrong_state_is_rejected() {
        let l = bind(&[0]).await.unwrap();
        let port = l.port;
        let (_tx, rx) = keep_open();
        let task = tokio::spawn(l.wait("good", TIMEOUT, rx));
        get(port, "/callback?code=abc&state=evil").await;
        assert!(task.await.unwrap().is_err());
    }

    #[tokio::test]
    async fn denied_is_typed() {
        let l = bind(&[0]).await.unwrap();
        let port = l.port;
        let (_tx, rx) = keep_open();
        let task = tokio::spawn(l.wait("s", TIMEOUT, rx));
        get(port, "/callback?error=access_denied&state=s").await;
        assert!(matches!(
            task.await.unwrap(),
            Err(AtlasError::ConnectorDenied { .. })
        ));
    }

    #[tokio::test]
    async fn busy_port_falls_back_and_all_busy_errors() {
        let held = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let busy = held.local_addr().unwrap().port();
        let port = bind(&[busy, 0]).await.unwrap().port;
        assert!(port != busy && port != 0);
        assert!(matches!(
            bind(&[busy]).await,
            Err(AtlasError::ConnectorPortBusy { .. })
        ));
    }

    #[tokio::test]
    async fn times_out() {
        let l = bind(&[0]).await.unwrap();
        let (_tx, rx) = keep_open();
        let r = l.wait("s", Duration::from_millis(50), rx).await;
        assert!(matches!(r, Err(AtlasError::Timeout { .. })));
    }

    #[tokio::test]
    async fn cancel_stops_the_wait() {
        let l = bind(&[0]).await.unwrap();
        let (tx, rx) = keep_open();
        let task = tokio::spawn(l.wait("s", TIMEOUT, rx));
        tx.send(()).unwrap();
        assert!(matches!(
            task.await.unwrap(),
            Err(AtlasError::ConnectorCancelled { .. })
        ));
    }
}
