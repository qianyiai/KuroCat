//! Contribution seam: implement PassiveAdapter, then add it to registry().
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Mapping {
    pub id: String,
    pub project: String,
    pub run: String,
    pub last_seq: Option<u64>,
    pub line: u64,
    pub activity: String,
    pub outcome: Option<String>,
    pub last_ms: u64,
    pub approvals: BTreeSet<String>,
    pub title: String,
    pub progress: String,
    pub stage: String,
}

pub trait PassiveAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn default_root(&self) -> std::path::PathBuf;
    fn compressed(&self) -> bool;
    fn matches(&self, path: &Path) -> bool;
    fn fold(&self, event: &Value, state: &mut Mapping) -> Result<bool, String>;
    fn titles(&self, _root: &Path) -> BTreeMap<String, String> {
        BTreeMap::new()
    }
}
fn short(raw: &str, limit: usize) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}
fn tool_stage(name: &str, command: &str) -> String {
    let name = name.to_lowercase();
    let c = command.to_lowercase();
    if name.contains("test")
        || c.contains("cargo test")
        || c.contains("npm test")
        || c.contains("unittest")
        || c.contains("pytest")
    {
        "testing"
    } else if name.contains("edit") || name.contains("write") || name.contains("patch") {
        "editing"
    } else if c.contains("npm run build") || c.contains("tauri build") || c.contains("cargo build")
    {
        "building"
    } else if name.contains("search") || name.contains("grep") || c.starts_with("rg ") {
        "searching"
    } else if name.contains("read") || c.starts_with("cat ") || c.starts_with("sed ") {
        "reading"
    } else if name.contains("web") || name.contains("tavily") || name.contains("browse") {
        "researching"
    } else if name.contains("command") || name == "bash" || name == "exec" {
        "command"
    } else {
        "processing"
    }
    .into()
}
fn codex_progress(item: &Value, s: &mut Mapping) {
    match item["type"].as_str().unwrap_or("") {
        "Reasoning" => {
            s.stage = "thinking".into();
        } // Never read reasoning text.
        "CommandExecution" => {
            s.stage = tool_stage("command", item["command"].as_str().unwrap_or(""));
        }
        "FileChange" => s.stage = "editing".into(),
        "WebSearch" => s.stage = "researching".into(),
        "McpToolCall" => {
            let tool = item["tool"].as_str().unwrap_or("");
            s.stage = tool_stage(tool, "");
            if tool.contains("update_running_summary") {
                if let Some(labels) = item["arguments"]["labels"].as_array() {
                    s.progress = short(
                        &labels
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" · "),
                        110,
                    );
                }
            }
        }
        "AgentMessage" if item["phase"] == "commentary" => {
            if let Some(parts) = item["content"].as_array() {
                let t = parts
                    .iter()
                    .filter(|v| v["type"] == "Text" || v["type"] == "text")
                    .filter_map(|v| v["text"].as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                if !t.trim().is_empty() {
                    s.progress = short(&t, 110);
                }
            }
        }
        _ => {}
    }
}
pub fn registry() -> Vec<Box<dyn PassiveAdapter>> {
    vec![Box::new(Dsh), Box::new(Codex)]
}
fn project(v: &Value) -> String {
    Path::new(v.as_str().unwrap_or(""))
        .file_name()
        .map(|s| {
            s.to_string_lossy()
                .chars()
                .filter(|c| !c.is_control())
                .take(40)
                .collect()
        })
        .unwrap_or_default()
}
fn sequence(s: &mut Mapping, seq: Option<u64>) -> bool {
    s.line += 1;
    let seq = seq.unwrap_or(s.line);
    if s.last_seq.is_some_and(|last| seq <= last) {
        return false;
    }
    s.last_seq = Some(seq);
    true
}
fn begin(s: &mut Mapping, run: String, time: u64) -> bool {
    s.run = run;
    s.activity = "working".into();
    s.outcome = None;
    s.approvals.clear();
    s.last_ms = time;
    s.progress.clear();
    s.stage = "processing".into();
    true
}
fn finish(s: &mut Mapping, run: &str, outcome: &str, time: u64) -> bool {
    if !s.run.is_empty() && s.run != run {
        return false;
    }
    s.run = run.into();
    s.activity = "idle".into();
    s.outcome = Some(outcome.into());
    s.approvals.clear();
    s.last_ms = time;
    true
}
pub struct Dsh;
impl PassiveAdapter for Dsh {
    fn id(&self) -> &'static str {
        "dsh"
    }
    fn display_name(&self) -> &'static str {
        "DSH"
    }
    fn default_root(&self) -> std::path::PathBuf {
        std::env::var_os("DSH_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| super::home().join(".dsh"))
            .join("sessions")
    }
    fn compressed(&self) -> bool {
        true
    }
    fn matches(&self, p: &Path) -> bool {
        p.file_name().is_some_and(|n| n == "session.v4.jsonl.zstd")
    }
    fn fold(&self, e: &Value, s: &mut Mapping) -> Result<bool, String> {
        let kind = e["type"].as_str().unwrap_or("");
        let d = &e["data"];
        if kind == "session" {
            if e["version"] != 4 {
                return Err("incompatible".into());
            }
            s.id = e["id"]
                .as_str()
                .filter(|x| !x.is_empty())
                .ok_or("format")?
                .into();
            s.project = project(&e["cwd"]);
            return Ok(false);
        }
        if s.id.is_empty() {
            return Err("format".into());
        }
        if !sequence(s, e["seq"].as_u64()) {
            return Ok(false);
        }
        let time = e["time"].as_u64().unwrap_or(0);
        let turn = d["turn"].as_u64().map(|n| n.to_string());
        let active = s.outcome.is_none() && !s.run.is_empty();
        Ok(match kind {
            "session/title" => {
                if let Some(title) = d["title"].as_str() {
                    s.title = short(title, 80);
                }
                false
            }
            "turn/start" => begin(s, turn.ok_or("format")?, time),
            "turn/end" => {
                let result = match d["reason"]["kind"].as_str() {
                    Some("completed") => "succeeded",
                    Some("aborted") => "cancelled",
                    Some("error") => "failed",
                    _ => "unknown",
                };
                finish(s, &turn.ok_or("format")?, result, time)
            }
            "approval/asked" if active => {
                s.approvals.insert(d["id"].as_str().ok_or("format")?.into());
                s.activity = "waiting-approval".into();
                s.last_ms = time;
                true
            }
            "approval/decided" if active => {
                if s.approvals.remove(d["id"].as_str().unwrap_or("")) {
                    s.activity = if s.approvals.is_empty() {
                        "working"
                    } else {
                        "waiting-approval"
                    }
                    .into();
                    s.last_ms = time;
                    true
                } else {
                    false
                }
            }
            "step/start" | "tool/call" | "tool/result"
                if active && turn.as_deref() == Some(&s.run) =>
            {
                s.last_ms = time;
                if kind == "tool/call" {
                    s.stage = tool_stage(d["name"].as_str().unwrap_or(""), "");
                }
                s.activity = if s.approvals.is_empty() {
                    "working"
                } else {
                    "waiting-approval"
                }
                .into();
                true
            }
            _ => false,
        })
    }
}
pub struct Codex;
impl PassiveAdapter for Codex {
    fn id(&self) -> &'static str {
        "codex"
    }
    fn display_name(&self) -> &'static str {
        "Codex"
    }
    fn default_root(&self) -> std::path::PathBuf {
        std::env::var_os("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| super::home().join(".codex"))
            .join("sessions")
    }
    fn compressed(&self) -> bool {
        false
    }
    fn matches(&self, p: &Path) -> bool {
        p.extension().is_some_and(|x| x == "jsonl")
            && p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
    }
    fn titles(&self, root: &Path) -> BTreeMap<String, String> {
        use std::io::{BufRead, BufReader, Read};
        let mut out = BTreeMap::new();
        let Some(parent) = root.parent() else {
            return out;
        };
        let Ok(file) = std::fs::File::open(parent.join("session_index.jsonl")) else {
            return out;
        };
        for line in BufReader::new(file.take(8 * 1024 * 1024))
            .lines()
            .map_while(Result::ok)
        {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let (Some(id), Some(title)) = (v["id"].as_str(), v["thread_name"].as_str()) {
                    out.insert(id.into(), short(title, 80));
                }
            }
        }
        out
    }
    fn fold(&self, e: &Value, s: &mut Mapping) -> Result<bool, String> {
        let d = &e["payload"];
        if e["type"] == "session_meta" {
            s.id = d["id"]
                .as_str()
                .or(d["session_id"].as_str())
                .filter(|x| !x.is_empty())
                .ok_or("format")?
                .into();
            s.project = project(&d["cwd"]);
            return Ok(false);
        }
        if s.id.is_empty() {
            return Err("format".into());
        }
        if !sequence(s, e["ordinal"].as_u64()) {
            return Ok(false);
        }
        let time = e["timestamp"]
            .as_str()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.timestamp_millis().max(0) as u64)
            .unwrap_or(0);
        if e["type"] != "event_msg" {
            if e["type"] == "response_item"
                && s.outcome.is_none()
                && !s.run.is_empty()
                && matches!(
                    d["type"].as_str(),
                    Some("function_call" | "custom_tool_call")
                )
            {
                let arguments = d["arguments"]
                    .as_str()
                    .or(d["input"].as_str())
                    .and_then(|v| serde_json::from_str::<Value>(v).ok())
                    .unwrap_or(Value::Null);
                let command = arguments["cmd"]
                    .as_str()
                    .or(arguments["command"].as_str())
                    .unwrap_or("");
                s.stage = tool_stage(d["name"].as_str().unwrap_or(""), command);
                s.last_ms = time;
                return Ok(true);
            }
            return Ok(false);
        }
        let turn = d["turn_id"].as_str().filter(|x| !x.is_empty());
        Ok(match d["type"].as_str().unwrap_or("") {
            "task_started" => begin(s, turn.ok_or("incompatible")?.into(), time),
            "task_complete" => finish(s, turn.ok_or("incompatible")?, "succeeded", time),
            "turn_aborted" => finish(s, turn.ok_or("incompatible")?, "cancelled", time),
            "item_completed" if s.outcome.is_none() && turn == Some(&s.run) => {
                s.last_ms = time;
                codex_progress(&d["item"], s);
                true
            }
            _ => false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn ds() -> Mapping {
        let mut s = Mapping::default();
        Dsh.fold(&json!({"type":"session","version":4,"id":"test"}), &mut s)
            .unwrap();
        s
    }
    #[test]
    fn progress_uses_public_commentary_and_never_reasoning_text() {
        let mut s = Mapping::default();
        codex_progress(
            &json!({"type":"AgentMessage","phase":"commentary","content":[{"type":"Text","text":"正在检查构建结果"}]}),
            &mut s,
        );
        assert_eq!(s.progress, "正在检查构建结果");
        codex_progress(
            &json!({"type":"Reasoning","raw_content":"PRIVATE_REASONING"}),
            &mut s,
        );
        assert_eq!(s.stage, "thinking");
        assert!(!s.progress.contains("PRIVATE_REASONING"));
        codex_progress(
            &json!({"type":"CommandExecution","command":"cargo test --lib"}),
            &mut s,
        );
        assert_eq!(s.stage, "testing");
    }
    #[test]
    fn dsh_title_is_metadata_not_an_id() {
        let mut s = ds();
        Dsh.fold(
            &json!({"type":"session/title","seq":1,"data":{"title":"实现工作陪伴"}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.title, "实现工作陪伴");
    }
    #[test]
    fn dsh_cancel_and_recovery() {
        let mut s = ds();
        Dsh.fold(
            &json!({"type":"turn/start","seq":1,"data":{"turn":2}}),
            &mut s,
        )
        .unwrap();
        Dsh.fold(
            &json!({"type":"tool/result","seq":2,"data":{"turn":2,"result":{"isError":true}}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.outcome, None);
        Dsh.fold(
            &json!({"type":"turn/end","seq":3,"data":{"turn":2,"reason":{"kind":"aborted"}}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.outcome.as_deref(), Some("cancelled"));
    }
    #[test]
    fn dsh_approvals_pair() {
        let mut s = ds();
        Dsh.fold(
            &json!({"type":"turn/start","seq":1,"data":{"turn":1}}),
            &mut s,
        )
        .unwrap();
        for (seq, id) in [(2, "a"), (3, "b")] {
            Dsh.fold(
                &json!({"type":"approval/asked","seq":seq,"data":{"id":id}}),
                &mut s,
            )
            .unwrap();
        }
        Dsh.fold(
            &json!({"type":"approval/decided","seq":4,"data":{"id":"a"}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.activity, "waiting-approval");
        Dsh.fold(
            &json!({"type":"approval/decided","seq":5,"data":{"id":"b"}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.activity, "working");
    }
    #[test]
    fn codex_duplicate_old_turn_and_private_text() {
        let mut s = Mapping::default();
        Codex
            .fold(&json!({"type":"session_meta","payload":{"id":"a"}}), &mut s)
            .unwrap();
        Codex.fold(&json!({"type":"event_msg","ordinal":3,"payload":{"type":"task_started","turn_id":"new"}}),&mut s).unwrap();
        assert!(!Codex.fold(&json!({"type":"event_msg","ordinal":4,"payload":{"type":"task_complete","turn_id":"old","last_agent_message":"SECRET"}}),&mut s).unwrap());
        assert_eq!(s.activity, "working");
        assert!(!serde_json::to_string(&s).unwrap().contains("SECRET"));
        assert!(!Codex.fold(&json!({"type":"event_msg","ordinal":2,"payload":{"type":"turn_aborted","turn_id":"new"}}),&mut s).unwrap());
    }
    #[test]
    fn unknown_dsh_reason_not_success() {
        let mut s = ds();
        Dsh.fold(
            &json!({"type":"turn/end","seq":1,"data":{"turn":1,"reason":{"kind":"blocked"}}}),
            &mut s,
        )
        .unwrap();
        assert_eq!(s.outcome.as_deref(), Some("unknown"));
    }
}
