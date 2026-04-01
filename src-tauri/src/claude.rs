use crate::panel::watcher::{FlowData, FlowEdge, Issue, SummaryData};
use reqwest::Client;
use serde::{Deserialize, Serialize};

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
    messages: Vec<Message>,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
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
    mermaid: Option<String>,
}

#[derive(Deserialize)]
struct EdgeResponse {
    from: String,
    to: String,
    label: Option<String>,
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
      {"from": "function_a", "to": "function_b", "label": "calls"}
    ],
    "mermaid": "graph LR\n  A[\"function_a\"] --> B[\"function_b\"]"
  }
}

Rules:
- confidence: 0.0 to 1.0, how confident you are in the analysis
- issues: only include real concerns (bugs, security, performance). Empty array if none found.
- severity: one of "info", "warning", "error"
- flow.edges: show the key relationships between modified functions/modules
- flow.mermaid: valid Mermaid.js graph LR syntax showing the code flow of the changes. Put all labels in quotes.
- Keep all text concise

Diff:
"#;

impl ClaudeClient {
    pub fn new(api_key: String, base_url: String, model: String) -> Self {
        Self {
            api_key,
            base_url,
            model,
            http: Client::new(),
        }
    }

    pub async fn analyze_diff(
        &self,
        raw_diff: &str,
    ) -> Result<(SummaryData, FlowData), String> {
        // Truncate very large diffs to avoid token limits
        let diff_text = if raw_diff.len() > 30_000 {
            &raw_diff[..30_000]
        } else {
            raw_diff
        };

        let prompt = format!("{}{}", ANALYSIS_PROMPT, diff_text);

        let request = ApiRequest {
            model: self.model.clone(),
            max_tokens: 2048,
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

        let api_response: ApiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {}", e))?;

        let text = api_response
            .content
            .first()
            .and_then(|b| b.text.as_ref())
            .ok_or_else(|| "Empty response from Claude".to_string())?;

        // Strip any markdown code fences if present
        let json_text = text
            .trim()
            .strip_prefix("```json")
            .or_else(|| text.trim().strip_prefix("```"))
            .unwrap_or(text.trim());
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
                })
                .collect(),
            mermaid: analysis.flow.mermaid,
        };

        Ok((summary, flow))
    }
}
