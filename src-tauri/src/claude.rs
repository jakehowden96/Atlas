use crate::panel::types::{Concern, FlowData, FlowEdge, SummaryData};
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
    system: String,
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
    intent: String,
    approach: String,
    impact: String,
    #[serde(default)]
    concerns: Vec<ConcernResponse>,
    #[serde(default)]
    flow: FlowResponse,
}

#[derive(Deserialize, Default)]
struct ConcernResponse {
    severity: String,
    description: String,
    file: Option<String>,
    line: Option<u32>,
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

const SYSTEM_PROMPT: &str = r#"You are a senior software engineer reviewing code changes. Your role is to analyze git diffs and provide structured insight that helps the reviewer understand and justify the changes at the PR stage.

Respond with ONLY a JSON object. No markdown, no code fences, no commentary.

The JSON must have this exact structure:
{
  "intent": "What problem or requirement was this change addressing? (1-3 sentences)",
  "approach": "How was the problem solved and why this approach? (1-3 sentences)",
  "impact": "What is the blast radius? Which files, functions, and flows are affected? (1-3 sentences)",
  "concerns": [
    {"severity": "warning", "description": "Clear description of the concern", "file": "path/to/file.rs", "line": 42}
  ],
  "flow": {
    "edges": [
      {"from": "file.ts::changedSymbol", "to": "other.ts::consumer", "label": "calls", "type": "calls"}
    ]
  }
}

Field rules:
- intent: If an implementation plan is provided, use it to explain the original goal. Otherwise, infer from the diff.
- approach: Describe the implementation strategy and any notable trade-offs.
- impact: Describe the blast radius — which callers, consumers, and dependents are affected by these changes.
- concerns: Only genuine issues — bugs, security risks, performance problems, logic errors. Include file and line where applicable. Empty array if none.
- concerns.severity: One of "info", "warning", "error".

Impact graph rules:
- The graph must be change-centric: modified symbols at the centre, their callers and consumers radiating outward.
- Nodes MUST use format "filename::symbolName" (short filename, not full path).
- Edge "type" must be one of: "calls", "depends_on", "consumed_by", "modifies".
- Edge "label" should be a short description (e.g. "calls", "imports type", "reads from").
- Focus on [CHANGED] definitions from the code context.
- Keep the graph focused: 3-12 edges maximum.
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
        plan: Option<&str>,
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

        let mut user_message = String::new();

        if let Some(plan_text) = plan {
            if !plan_text.is_empty() {
                user_message.push_str("## Implementation Plan\n");
                user_message.push_str(plan_text);
                user_message.push_str("\n\n");
            }
        }

        if !analysis_context.is_empty() {
            user_message.push_str(analysis_context);
            user_message.push_str("\n\n");
        }

        user_message.push_str("## Diff\n");
        user_message.push_str(diff_text);

        let request = ApiRequest {
            model: self.model.clone(),
            max_tokens: 2048,
            stream: true,
            system: SYSTEM_PROMPT.to_string(),
            messages: vec![Message {
                role: "user".to_string(),
                content: user_message,
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
            intent: analysis.intent,
            approach: analysis.approach,
            impact: analysis.impact,
            concerns: analysis
                .concerns
                .into_iter()
                .map(|c| Concern {
                    severity: c.severity,
                    description: c.description,
                    file: c.file,
                    line: c.line,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_response_full_json() {
        let json = r#"{
            "intent": "Fix login timeout",
            "approach": "Increased timeout with backoff",
            "impact": "Affects auth.rs",
            "concerns": [
                {"severity": "warning", "description": "Timeout too generous", "file": "auth.rs", "line": 42}
            ],
            "flow": {
                "edges": [
                    {"from": "auth.rs::login", "to": "api.rs::handle", "label": "calls", "type": "calls"}
                ]
            }
        }"#;

        let parsed: AnalysisResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.intent, "Fix login timeout");
        assert_eq!(parsed.approach, "Increased timeout with backoff");
        assert_eq!(parsed.impact, "Affects auth.rs");
        assert_eq!(parsed.concerns.len(), 1);
        assert_eq!(parsed.concerns[0].severity, "warning");
        assert_eq!(parsed.concerns[0].file.as_deref(), Some("auth.rs"));
        assert_eq!(parsed.concerns[0].line, Some(42));
        assert_eq!(parsed.flow.edges.len(), 1);
        assert_eq!(parsed.flow.edges[0].from, "auth.rs::login");
        assert_eq!(parsed.flow.edges[0].edge_type.as_deref(), Some("calls"));
    }

    #[test]
    fn analysis_response_minimal_json() {
        let json = r#"{
            "intent": "test",
            "approach": "test",
            "impact": "test"
        }"#;

        let parsed: AnalysisResponse = serde_json::from_str(json).unwrap();
        assert!(parsed.concerns.is_empty());
        assert!(parsed.flow.edges.is_empty());
    }

    #[test]
    fn analysis_response_concern_without_file() {
        let json = r#"{
            "intent": "test",
            "approach": "test",
            "impact": "test",
            "concerns": [
                {"severity": "info", "description": "Consider refactoring"}
            ]
        }"#;

        let parsed: AnalysisResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.concerns.len(), 1);
        assert!(parsed.concerns[0].file.is_none());
        assert!(parsed.concerns[0].line.is_none());
    }

    #[test]
    fn user_message_includes_plan_when_present() {
        let plan = Some("## Plan\nRefactor auth");
        let context = "## Code Context\nDefinitions:";
        let diff = "diff --git a/f b/f";

        let mut msg = String::new();
        if let Some(plan_text) = plan {
            if !plan_text.is_empty() {
                msg.push_str("## Implementation Plan\n");
                msg.push_str(plan_text);
                msg.push_str("\n\n");
            }
        }
        if !context.is_empty() {
            msg.push_str(context);
            msg.push_str("\n\n");
        }
        msg.push_str("## Diff\n");
        msg.push_str(diff);

        assert!(msg.starts_with("## Implementation Plan\n"));
        assert!(msg.contains("## Code Context"));
        assert!(msg.contains("## Diff\n"));
    }

    #[test]
    fn user_message_omits_plan_when_none() {
        let plan: Option<&str> = None;
        let context = "";
        let diff = "diff --git a/f b/f";

        let mut msg = String::new();
        if let Some(plan_text) = plan {
            if !plan_text.is_empty() {
                msg.push_str("## Implementation Plan\n");
                msg.push_str(plan_text);
                msg.push_str("\n\n");
            }
        }
        if !context.is_empty() {
            msg.push_str(context);
            msg.push_str("\n\n");
        }
        msg.push_str("## Diff\n");
        msg.push_str(diff);

        assert!(msg.starts_with("## Diff\n"));
        assert!(!msg.contains("Implementation Plan"));
    }

    #[test]
    fn user_message_omits_empty_plan() {
        let plan = Some("");

        let mut msg = String::new();
        if let Some(plan_text) = plan {
            if !plan_text.is_empty() {
                msg.push_str("## Implementation Plan\n");
                msg.push_str(plan_text);
                msg.push_str("\n\n");
            }
        }
        msg.push_str("## Diff\ntest");

        assert!(msg.starts_with("## Diff\n"));
    }
}
