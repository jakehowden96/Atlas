use crate::panel::watcher::{FlowData, FlowEdge, Issue, SummaryData};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use tokio_util::io::StreamReader;
use futures_util::TryStreamExt;

#[derive(Clone)]
pub struct ClaudeClient {
    api_key: String,
    base_url: String,
    model: String,
    http: Client,
}

#[derive(Serialize)]
struct ApiRequest {
    model: String,
    max_tokens: u32,
    stream: bool,
    messages: Vec<Message>,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ContentBlockDelta {
    delta: Option<DeltaContent>,
}

#[derive(Deserialize)]
struct DeltaContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnalysisResponse {
    summary: String,
    fix: String,
    why: String,
    confidence: f64,
    #[serde(default)]
    issues: Vec<IssueResponse>,
    #[serde(default)]
    flow: FlowResponse,
}

#[derive(Deserialize, Default)]
struct IssueResponse {
    severity: String,
    file: String,
    line: u32,
    message: String,
}

#[derive(Deserialize, Default)]
struct FlowResponse {
    #[serde(default)]
    edges: Vec<EdgeResponse>,
}

#[derive(Deserialize)]
struct EdgeResponse {
    from: String,
    to: String,
    label: Option<String>,
    #[serde(rename = "type")]
    edge_type: Option<String>,
}

const ANALYSIS_PROMPT: &str = r#"Analyze this git diff and respond with ONLY a JSON object (no markdown, no code fences, no explanation).

The JSON must have this exact structure:
{
  "summary": "Brief description of what changed (1-2 sentences)",
  "fix": "What the changes accomplish or how they fix the issue (1-2 sentences)",
  "why": "Why these changes matter or what problem they solve (1-2 sentences)",
  "confidence": 0.85,
  "issues": [
    {"severity": "warning", "file": "path/to/file.rs", "line": 42, "message": "Description of potential issue"}
  ],
  "flow": {
    "edges": [
      {"from": "file.ts::functionName", "to": "other.ts::otherFunction", "label": "calls updateDB", "type": "call"}
    ]
  }
}

Rules:
- confidence: 0.0 to 1.0, how confident you are in the analysis
- issues: only include real concerns (bugs, security, performance). Empty array if none found.
- severity: one of "info", "warning", "error"
- Keep all text concise

Flow rules:
- Nodes MUST use the format "filename::symbolName" (e.g. "graph-layout.ts::layoutFlowGraph")
- Use the short filename (not the full path), e.g. "panel.rs" not "src-tauri/src/commands/panel.rs"
- Only include symbols that appear in the diff or are directly called/imported by changed code
- Edge "type" must be one of: "call" (function invocation), "import" (dependency), "modify" (data mutation), "emit" (event/signal)
- Edge "label" should be a short description of the relationship (e.g. "calls", "imports type", "updates state")
- Focus on [CHANGED] definitions from the code context below
- For cross-file relationships, trace imports to identify which files depend on modified symbols
- Keep the graph focused: 3-10 edges maximum, showing the most important relationships

"#;

impl ClaudeClient {
    pub fn new(api_key: String, base_url: String, model: String) -> Result<Self, String> {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        Ok(Self { api_key, base_url, model, http })
    }

    pub async fn analyze_diff(
        &self,
        raw_diff: &str,
        analysis_context: &str,
    ) -> Result<(SummaryData, FlowData), String> {
        // Truncate very large diffs to avoid token limits (char-boundary safe)
        let diff_text = if raw_diff.len() > 30_000 {
            let mut end = 30_000;
            while !raw_diff.is_char_boundary(end) {
                end -= 1;
            }
            &raw_diff[..end]
        } else {
            raw_diff
        };

        let prompt = if analysis_context.is_empty() {
            format!("{}Diff:\n{}", ANALYSIS_PROMPT, diff_text)
        } else {
            format!("{}{}\n\nDiff:\n{}", ANALYSIS_PROMPT, analysis_context, diff_text)
        };

        let request = ApiRequest {
            model: self.model.clone(),
            max_tokens: 2048,
            stream: true,
            messages: vec![Message {
                role: "user".to_string(),
                content: prompt,
            }],
        };

        let url = format!("{}v1/messages", self.base_url);

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Claude API error {}: {}", status, body));
        }

        // Stream SSE events and accumulate text
        let mut accumulated_text = String::new();
        let byte_stream = response
            .bytes_stream()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));
        let stream_reader = StreamReader::new(byte_stream);
        let mut lines = stream_reader.lines();

        while let Some(line) = lines.next_line().await.map_err(|e| format!("Stream read error: {}", e))? {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    break;
                }
                if let Ok(block) = serde_json::from_str::<ContentBlockDelta>(data) {
                    if let Some(delta) = block.delta {
                        if let Some(text) = delta.text {
                            accumulated_text.push_str(&text);
                        }
                    }
                }
            }
        }

        if accumulated_text.is_empty() {
            return Err("Empty response from Claude".to_string());
        }

        // Strip any markdown code fences if present
        let json_text = accumulated_text
            .trim()
            .strip_prefix("```json")
            .or_else(|| accumulated_text.trim().strip_prefix("```"))
            .unwrap_or(accumulated_text.trim());
        let json_text = json_text.strip_suffix("```").unwrap_or(json_text).trim();

        let analysis: AnalysisResponse = serde_json::from_str(json_text)
            .map_err(|e| format!("Failed to parse Claude response as JSON: {}\nRaw: {}", e, json_text))?;

        let summary = SummaryData {
            summary: analysis.summary,
            fix: analysis.fix,
            why: analysis.why,
            confidence: analysis.confidence.clamp(0.0, 1.0),
            issues: analysis
                .issues
                .into_iter()
                .map(|i| Issue {
                    severity: i.severity,
                    file: i.file,
                    line: i.line,
                    message: i.message,
                })
                .collect(),
        };

        let flow = FlowData {
            edges: analysis
                .flow
                .edges
                .into_iter()
                .map(|e| FlowEdge {
                    from: e.from,
                    to: e.to,
                    label: e.label,
                    edge_type: e.edge_type,
                })
                .collect(),
        };

        Ok((summary, flow))
    }
}
