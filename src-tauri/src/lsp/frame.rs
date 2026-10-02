//! Content-Length framing for the Language Server Protocol.
//!
//! LSP is JSON-RPC over a stream with HTTP-style headers. The frontend's
//! `Transport` wants bare JSON, so the header handling lives here on the
//! process side and never reaches the web view.

/// Wrap one JSON message in the header a server expects on stdin.
pub fn frame(message: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(message.len() + 32);
    out.extend_from_slice(format!("Content-Length: {}\r\n\r\n", message.len()).as_bytes());
    out.extend_from_slice(message.as_bytes());
    out
}

/// Incremental reader for a server's stdout.
///
/// A read from a pipe stops wherever the kernel felt like stopping, so a single
/// chunk can hold half a header, several whole messages, or one byte. This
/// keeps the leftovers and hands back only the messages that are complete.
#[derive(Default)]
pub struct FrameReader {
    buffer: Vec<u8>,
}

impl FrameReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a chunk and take every message that is now whole.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(step) = self.take_one() {
            out.extend(step);
        }
        out
    }

    /// Consume one frame from the front of the buffer. `None` means more bytes
    /// are needed; `Some(None)` means a broken frame was discarded and the
    /// next one may already be waiting; `Some(Some(m))` is a message.
    fn take_one(&mut self) -> Option<Option<String>> {
        let Some(split) = find(&self.buffer, b"\r\n\r\n") else {
            if self.buffer.len() > MAX_HEADER_BYTES {
                // Not a header block at all; waiting longer will not fix it.
                self.buffer.clear();
            }
            return None;
        };
        let length = std::str::from_utf8(&self.buffer[..split])
            .ok()
            .and_then(content_length)
            .filter(|length| *length <= MAX_BODY_BYTES);
        let Some(length) = length else {
            // A header block with no usable Content-Length is a broken server.
            // Drop it, but resynchronise on a Content-Length that got glued to
            // the front of the block by the previous frame's stray body bytes.
            let resync = rfind_ignore_case(&self.buffer[..split], b"content-length")
                .filter(|at| *at > 0)
                .unwrap_or(split + 4);
            self.buffer.drain(..resync);
            return Some(None);
        };
        let start = split + 4;
        let end = start + length;
        if self.buffer.len() < end {
            return None;
        }
        let body = self.buffer[start..end].to_vec();
        self.buffer.drain(..end);
        // A body that is not UTF-8 is a broken server rather than a partial
        // read, so the frame is dropped rather than blocking the stream.
        Some(String::from_utf8(body).ok())
    }
}

/// The largest message body accepted. Real LSP messages (whole-project
/// diagnostics, large completion lists) stay far below this; a bigger claimed
/// length is a corrupt header, and would otherwise stall the reader forever
/// waiting for bytes that never come.
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// The most header bytes buffered while waiting for the blank line that ends
/// them.
const MAX_HEADER_BYTES: usize = 64 * 1024;

fn rfind_ignore_case(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|w| w.eq_ignore_ascii_case(needle))
}

/// The `Content-Length` value, case-insensitively, from a header block.
fn content_length(headers: &str) -> Option<usize> {
    headers
        .split("\r\n")
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse().ok())
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_a_message_with_its_byte_length() {
        assert_eq!(frame("{}"), b"Content-Length: 2\r\n\r\n{}".to_vec());
    }

    #[test]
    fn length_is_bytes_rather_than_characters() {
        // A naive `chars().count()` would say 1 and truncate the body.
        let framed = frame("\"é\"");
        assert!(String::from_utf8_lossy(&framed).starts_with("Content-Length: 4"));
    }

    #[test]
    fn reads_one_whole_message() {
        let mut r = FrameReader::new();
        assert_eq!(
            r.push(&frame(r#"{"id":1}"#)),
            vec![r#"{"id":1}"#.to_string()]
        );
    }

    #[test]
    fn holds_a_partial_message_until_the_rest_arrives() {
        let mut r = FrameReader::new();
        let framed = frame(r#"{"id":1}"#);
        let (head, tail) = framed.split_at(framed.len() - 3);
        assert!(r.push(head).is_empty(), "an incomplete body yields nothing");
        assert_eq!(r.push(tail), vec![r#"{"id":1}"#.to_string()]);
    }

    #[test]
    fn splits_several_messages_out_of_one_chunk() {
        let mut r = FrameReader::new();
        let mut chunk = frame(r#"{"id":1}"#);
        chunk.extend_from_slice(&frame(r#"{"id":2}"#));
        assert_eq!(
            r.push(&chunk),
            vec![r#"{"id":1}"#.to_string(), r#"{"id":2}"#.to_string()]
        );
    }

    #[test]
    fn tolerates_extra_headers_and_odd_casing() {
        let mut r = FrameReader::new();
        let raw = b"Content-Type: application/vscode-jsonrpc\r\ncontent-length: 2\r\n\r\n{}";
        assert_eq!(r.push(raw), vec!["{}".to_string()]);
    }

    #[test]
    fn a_header_arriving_one_byte_at_a_time_still_parses() {
        let mut r = FrameReader::new();
        let framed = frame(r#"{"ok":true}"#);
        let mut seen = Vec::new();
        for byte in &framed {
            seen.extend(r.push(&[*byte]));
        }
        assert_eq!(seen, vec![r#"{"ok":true}"#.to_string()]);
    }

    #[test]
    fn an_absurd_content_length_does_not_panic() {
        let mut r = FrameReader::new();
        assert!(r
            .push(b"Content-Length: 18446744073709551615\r\n\r\n{}")
            .is_empty());
        // The oversized frame is discarded, so the stream recovers.
        assert_eq!(r.push(&frame("{}")), vec!["{}".to_string()]);
    }

    #[test]
    fn a_header_block_without_content_length_is_skipped() {
        let mut r = FrameReader::new();
        assert!(r.push(b"Foo: 1\r\n\r\n").is_empty());
        assert_eq!(r.push(&frame("{}")), vec!["{}".to_string()]);
    }

    #[test]
    fn a_non_utf8_body_does_not_hold_back_the_next_message() {
        let mut r = FrameReader::new();
        let mut chunk = b"Content-Length: 2\r\n\r\n".to_vec();
        chunk.extend_from_slice(&[0xff, 0xfe]);
        chunk.extend_from_slice(&frame("{}"));
        assert_eq!(r.push(&chunk), vec!["{}".to_string()]);
    }
}
