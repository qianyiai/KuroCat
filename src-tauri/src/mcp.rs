use crate::cats::{
    all_cats, cat_exists, cat_schema_guide, cats_path, delete_custom_cat, patch_custom_cat,
    sanitize_cat_id, upsert_custom_cat, CatSkinConfig,
};
use crate::config::{load_settings, save_settings, set_windows_autostart};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, IsTerminal, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SERVER_NAME: &str = "kurocat";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Real-time AI Coding Companion / pet interaction payload broadcast to both the desktop
/// pet window (`kuro-agent-event`) and the OBS Browser Source SSE stream (`agentEvent`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompanionEvent {
    /// "status" | "action" | "bubble"
    pub kind: String,
    /// "working" | "thinking" | "waiting" | "done" | "error" | "idle"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// "happy" | "pet" | "angry" | "curious" | "sleep" | "wake" | "tail_pat"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Optional session identifier for multi-session clients (concurrent Claude/Codex/DSH tasks).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_type: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<u64>,
    #[serde(default)]
    pub ts: u64,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn clean_short_text(raw: &str, max_chars: usize) -> Option<String> {
    let collapsed: String = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if collapsed.is_empty() {
        return None;
    }
    let count = collapsed.chars().count();
    if count <= max_chars {
        Some(collapsed)
    } else {
        let mut s: String = collapsed.chars().take(max_chars.saturating_sub(1)).collect();
        s.push('…');
        Some(s)
    }
}

fn normalize_status(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "working" | "coding" | "running" | "busy" | "typing" | "tool" => Some("working"),
        "thinking" | "planning" | "reasoning" | "prompt" => Some("thinking"),
        "waiting" | "waiting_approval" | "permission" | "approval" | "confirm" | "input" => {
            Some("waiting")
        }
        "done" | "complete" | "completed" | "finished" | "success" | "stop" => Some("done"),
        "error" | "failed" | "failure" | "fail" => Some("error"),
        "idle" | "clear" | "off" | "reset" | "cancel" | "canceled" | "cancelled" | "aborted" => {
            Some("idle")
        }
        _ => None,
    }
}

fn normalize_action(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "happy" | "celebrate" | "cheer" | "smile" => Some("happy"),
        "pet" | "purr" | "pat" => Some("pet"),
        "angry" | "cross" | "mad" | "huff" | "grumpy" => Some("angry"),
        "boop" | "sneeze" => Some("boop"),
        "chin" | "heart" | "hearts" => Some("chin"),
        "dizzy" | "spin" => Some("dizzy"),
        "curious" | "alert" | "look" => Some("curious"),
        "sleep" | "nap" | "zzz" => Some("sleep"),
        "wake" | "wakeup" => Some("wake"),
        "tail_pat" | "tail" | "slap" => Some("tail_pat"),
        _ => None,
    }
}

fn label_for_tool(tool_name: &str) -> (&'static str, bool) {
    let lower = tool_name.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return ("处理任务中…", true);
    }
    if lower.contains("edit")
        || lower.contains("write")
        || lower.contains("patch")
        || lower.contains("replace")
        || lower.contains("notebook")
    {
        ("写代码中…", true)
    } else if lower.contains("command")
        || lower.contains("bash")
        || lower.contains("shell")
        || lower.contains("exec")
        || lower.contains("terminal")
    {
        ("运行命令中…", true)
    } else if lower.contains("browser") || lower.contains("web") || lower.contains("fetch") {
        ("查阅资料中…", true)
    } else if lower.contains("read")
        || lower.contains("grep")
        || lower.contains("search")
        || lower.contains("find")
        || lower.contains("list")
        || lower.contains("glob")
        || lower.contains("view")
    {
        ("阅读代码中…", true)
    } else if lower.contains("subagent") || lower.contains("agent") || lower.contains("task") {
        ("协作处理中…", true)
    } else {
        ("调用工具中…", true)
    }
}

fn extract_hook_session(raw: &Value, session_hint: Option<&str>) -> Option<String> {
    if let Some(s) = session_hint.and_then(|v| clean_short_text(v, 48)) {
        return Some(s);
    }
    raw.get("session")
        .or_else(|| raw.get("sessionName"))
        .or_else(|| raw.get("session_name"))
        .or_else(|| raw.get("session_id"))
        .or_else(|| raw.get("sessionId"))
        .or_else(|| raw.get("thread_id"))
        .or_else(|| raw.get("threadId"))
        .or_else(|| raw.get("thread-id"))
        .or_else(|| raw.get("conversation_id"))
        .or_else(|| raw.get("conversationId"))
        .or_else(|| raw.get("trajectory_id"))
        .or_else(|| raw.get("trajectoryId"))
        .and_then(|v| v.as_str())
        .and_then(|v| clean_short_text(v, 48))
}

fn is_auto_approval_mode(raw: &Value) -> bool {
    let mode = raw
        .get("permission_mode")
        .or_else(|| raw.get("permissionMode"))
        .or_else(|| raw.get("approval_policy"))
        .or_else(|| raw.get("approvalPolicy"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    matches!(
        mode.as_str(),
        "bypasspermissions"
            | "bypass_permissions"
            | "dontask"
            | "dont_ask"
            | "never"
            | "full-auto"
            | "full_auto"
            | "auto"
            | "on-failure"
    )
}

fn is_user_question_tool(tool_name: &str) -> bool {
    let lower = tool_name.trim().to_ascii_lowercase();
    lower.contains("ask_user")
        || lower.contains("askuser")
        || lower.contains("user_question")
        || lower.contains("request_user_input")
        || lower.contains("exit_plan_mode")
        || lower == "ask_question"
}

fn detect_hook_source(raw: &Value, source_hint: Option<&str>) -> String {
    if let Some(s) = source_hint.and_then(|v| clean_short_text(v, 28)) {
        return s;
    }
    if let Some(s) = raw
        .get("source")
        .and_then(|v| v.as_str())
        .and_then(|v| clean_short_text(v, 28))
    {
        return s;
    }
    let tp = raw
        .get("transcriptPath")
        .or_else(|| raw.get("transcript_path"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if tp.contains("doubao") {
        return "豆包工作版".to_string();
    }
    if tp.contains("workbuddy") || tp.contains("codebuddy") {
        return "WorkBuddy".to_string();
    }
    if tp.contains("deepseek") || tp.contains("/.dsh/") || tp.contains("\\.dsh\\") {
        return "DeepSeek".to_string();
    }
    if tp.contains("codex")
        || raw
            .get("type")
            .and_then(|v| v.as_str())
            .is_some_and(|t| {
                t.eq_ignore_ascii_case("agent-turn-complete")
                    || t.eq_ignore_ascii_case("approval-requested")
                    || t.eq_ignore_ascii_case("approval-required")
                    || t.eq_ignore_ascii_case("turn-aborted")
                    || t.eq_ignore_ascii_case("agent-turn-aborted")
            })
    {
        return "Codex".to_string();
    }
    if tp.contains("qwen") {
        return "千问".to_string();
    }
    if tp.contains("copilot") {
        return "Copilot".to_string();
    }
    if tp.contains("antigravity") || raw.get("hookEventName").is_some() {
        return "Antigravity".to_string();
    }
    if tp.contains("gemini") {
        return "Gemini".to_string();
    }
    if tp.contains("windsurf") || tp.contains("codeium") || raw.get("agent_action_name").is_some() {
        return "Windsurf".to_string();
    }
    if tp.contains("cursor") {
        return "Cursor".to_string();
    }
    if tp.contains("claude") || raw.get("hook_event_name").is_some() {
        return "Claude".to_string();
    }
    "AI".to_string()
}

/// Parses native hook JSON payloads from Antigravity, Claude Code, Tencent WorkBuddy/CodeBuddy,
/// OpenAI Codex CLI (`hooks.json` & `notify`), DeepSeek Harness (`dsh`), Cursor, or direct HTTP/CLI payloads.
pub fn parse_hook_payload(
    raw: &Value,
    source_hint: Option<&str>,
    event_hint: Option<&str>,
    text_hint: Option<&str>,
) -> Option<AgentCompanionEvent> {
    parse_hook_payload_with_session(raw, source_hint, None, event_hint, text_hint)
}

pub fn parse_hook_payload_with_session(
    raw: &Value,
    source_hint: Option<&str>,
    session_hint: Option<&str>,
    event_hint: Option<&str>,
    text_hint: Option<&str>,
) -> Option<AgentCompanionEvent> {
    let ts = now_epoch_ms();
    let source = detect_hook_source(raw, source_hint);
    let session = extract_hook_session(raw, session_hint);
    let override_text = text_hint
        .or_else(|| raw.get("text").and_then(|v| v.as_str()))
        .or_else(|| raw.get("message").and_then(|v| v.as_str()))
        .and_then(|s| clean_short_text(s, 72));
    let explicit_sound = raw.get("sound").and_then(|v| v.as_bool());
    let explicit_auto_type = raw.get("autoType").and_then(|v| v.as_bool());
    let explicit_ttl = raw
        .get("ttlMs")
        .and_then(|v| v.as_u64())
        .map(|v| v.clamp(1_000, 300_000));

    // 1) Simplified / direct payload: explicit `action`, `status` (when NOT a lifecycle hook payload), or CLI `--event`
    let has_lifecycle_hook_key = raw.get("hookEventName").is_some()
        || raw.get("hook_event_name").is_some()
        || raw.get("agent_action_name").is_some();
    if let Some(act_raw) = raw.get("action").and_then(|v| v.as_str()) {
        if let Some(action) = normalize_action(act_raw) {
            return Some(AgentCompanionEvent {
                kind: "action".to_string(),
                status: None,
                action: Some(action.to_string()),
                source: Some(source),
                session,
                text: override_text,
                tool: None,
                auto_type: Some(false),
                sound: explicit_sound,
                ttl_ms: Some(explicit_ttl.unwrap_or(5_000)),
                ts,
            });
        }
    }

    if let Some(st_raw) = event_hint.or_else(|| {
        if has_lifecycle_hook_key {
            None
        } else {
            raw.get("status").and_then(|v| v.as_str())
        }
    }) {
        if let Some(status) = normalize_status(st_raw) {
            let (default_text, default_auto_type, default_ttl, default_sound) = match status {
                "working" => (Some("写代码中…".to_string()), true, 180_000, false),
                "thinking" => (Some("思考中…".to_string()), false, 180_000, false),
                "waiting" => (Some("等你确认操作".to_string()), false, 180_000, true),
                "done" => (Some("任务完成！".to_string()), false, 6_500, true),
                "error" => (Some("任务出错了".to_string()), false, 8_500, true),
                _ => (None, false, 1_500, false),
            };
            return Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some(status.to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or(default_text),
                tool: raw
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .and_then(|s| clean_short_text(s, 36)),
                auto_type: Some(explicit_auto_type.unwrap_or(default_auto_type)),
                sound: Some(explicit_sound.unwrap_or(default_sound)),
                ttl_ms: Some(explicit_ttl.unwrap_or(default_ttl)),
                ts,
            });
        }
    }

    // 2) OpenAI Codex `notify` payload (`agent-turn-complete`, `approval-requested`, `turn-aborted`)
    if let Some(codex_type) = raw.get("type").and_then(|v| v.as_str()) {
        match codex_type.trim().to_ascii_lowercase().as_str() {
            "agent-turn-complete" => {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("done".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("任务完成！".to_string())),
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(6_500)),
                    ts,
                });
            }
            "approval-requested" | "approval-required" => {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("waiting".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("等你确认操作".to_string())),
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                    ts,
                });
            }
            "turn-aborted" | "agent-turn-aborted" | "interrupt" => {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("idle".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: None,
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(false),
                    ttl_ms: Some(1_000),
                    ts,
                });
            }
            _ => {}
        }
    }

    // 3) Native Lifecycle Hooks:
    //    - Antigravity: `hookEventName`, `toolCall.name`, `error`, `terminationReason`
    //    - Claude Code / WorkBuddy / Codex `hooks.json` / Cursor: `hook_event_name`, `tool_name`
    //    - Windsurf Cascade Hooks: `agent_action_name` (`pre_user_prompt`, `pre_write_code`, `post_cascade_response`, ...)
    //    - DeepSeek Harness (`dsh` / `dsh-hooks`): `event` or `type` (`turn/start`, `tool/call`, `approval/asked`, `turn/end`)
    let hook_event = raw
        .get("hookEventName")
        .or_else(|| raw.get("hook_event_name"))
        .or_else(|| raw.get("agent_action_name"))
        .or_else(|| raw.get("event"))
        .or_else(|| raw.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if hook_event.is_empty() {
        // Text-only bubble fallback
        if let Some(txt) = override_text {
            return Some(AgentCompanionEvent {
                kind: "bubble".to_string(),
                status: None,
                action: None,
                source: Some(source),
                session,
                text: Some(txt),
                tool: None,
                auto_type: Some(false),
                sound: Some(explicit_sound.unwrap_or(false)),
                ttl_ms: Some(explicit_ttl.unwrap_or(5_000)),
                ts,
            });
        }
        return None;
    }

    let tool_name = raw
        .get("toolCall")
        .and_then(|tc| tc.get("name"))
        .or_else(|| raw.get("tool_name"))
        .or_else(|| raw.get("toolName"))
        .or_else(|| raw.get("tool"))
        .or_else(|| {
            raw.get("tool_info")
                .and_then(|ti| ti.get("mcp_tool_name").or_else(|| ti.get("tool_name")))
        })
        .or_else(|| raw.get("data").and_then(|d| d.get("name").or_else(|| d.get("toolName"))))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let err_str = raw
        .get("error")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw.get("data")
                .and_then(|d| d.get("error"))
                .and_then(|e| e.as_str().or_else(|| e.get("message").and_then(|m| m.as_str())))
        })
        .unwrap_or("")
        .trim();
    let term_reason = raw
        .get("terminationReason")
        .or_else(|| raw.get("termination_reason"))
        .or_else(|| raw.get("reason"))
        .or_else(|| raw.get("status"))
        .or_else(|| raw.get("data").and_then(|d| d.get("reason")).and_then(|r| r.get("kind").or(Some(r))))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let ev_lower = hook_event.trim().to_ascii_lowercase();
    match ev_lower.as_str() {
        "sessionstart" | "session_start" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("idle".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("已连接，待命中".to_string())),
            tool: None,
            auto_type: Some(false),
            sound: Some(false),
            ttl_ms: Some(explicit_ttl.unwrap_or(3_200)),
            ts,
        }),
        "sessionend" | "session_end" | "interrupt" | "turn_aborted" | "turnaborted" => {
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("idle".to_string()),
                action: None,
                source: Some(source),
                session,
                text: None,
                tool: None,
                auto_type: Some(false),
                sound: Some(false),
                ttl_ms: Some(1_000),
                ts,
            })
        }
        "turn/start" | "step/start" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("thinking".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("思考分析中…".to_string())),
            tool: None,
            auto_type: Some(explicit_auto_type.unwrap_or(false)),
            sound: Some(false),
            ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
            ts,
        }),
        "preinvocation"
        | "userpromptsubmit"
        | "beforesubmitprompt"
        | "pre_user_prompt"
        | "beforeagent" => {
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("working".to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or_else(|| Some("思考写代码中…".to_string())),
                tool: None,
                auto_type: Some(explicit_auto_type.unwrap_or(true)),
                sound: Some(false),
                ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                ts,
            })
        }
        "pre_write_code" | "post_write_code" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("working".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("写代码中…".to_string())),
            tool: Some("write_code".to_string()),
            auto_type: Some(explicit_auto_type.unwrap_or(true)),
            sound: Some(false),
            ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
            ts,
        }),
        "pre_run_command" | "post_run_command" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("working".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("运行命令中…".to_string())),
            tool: Some("run_command".to_string()),
            auto_type: Some(explicit_auto_type.unwrap_or(true)),
            sound: Some(false),
            ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
            ts,
        }),
        "pre_read_code" | "post_read_code" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("working".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("阅读代码中…".to_string())),
            tool: Some("read_code".to_string()),
            auto_type: Some(explicit_auto_type.unwrap_or(true)),
            sound: Some(false),
            ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
            ts,
        }),
        "pretooluse" | "posttooluse" | "postinvocation" | "beforeshellexecution"
        | "afterfileedit" | "subagentstart" | "tool/call" | "pre_mcp_tool_use"
        | "post_mcp_tool_use" | "beforetool" | "aftertool" => {
            if !err_str.is_empty() {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("error".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("工具执行出错".to_string())),
                    tool: clean_short_text(tool_name, 36),
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(8_000)),
                    ts,
                });
            }
            if is_user_question_tool(tool_name) {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("waiting".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("等你确认操作".to_string())),
                    tool: clean_short_text(tool_name, 36),
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                    ts,
                });
            }
            let (label, auto_type) = label_for_tool(tool_name);
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("working".to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or_else(|| Some(label.to_string())),
                tool: clean_short_text(tool_name, 36),
                auto_type: Some(explicit_auto_type.unwrap_or(auto_type)),
                sound: Some(false),
                ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                ts,
            })
        }
        "tool/result" => {
            if !err_str.is_empty() {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("error".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("工具执行出错".to_string())),
                    tool: clean_short_text(tool_name, 36),
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(8_000)),
                    ts,
                });
            }
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("thinking".to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or_else(|| Some("整理结果中…".to_string())),
                tool: clean_short_text(tool_name, 36),
                auto_type: Some(explicit_auto_type.unwrap_or(false)),
                sound: Some(false),
                ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                ts,
            })
        }
        "posttoolusefailure" | "erroroccurred" => Some(AgentCompanionEvent {
            kind: "status".to_string(),
            status: Some("error".to_string()),
            action: None,
            source: Some(source),
            session,
            text: override_text.or_else(|| Some("工具执行失败".to_string())),
            tool: clean_short_text(tool_name, 36),
            auto_type: Some(false),
            sound: Some(explicit_sound.unwrap_or(true)),
            ttl_ms: Some(explicit_ttl.unwrap_or(8_500)),
            ts,
        }),
        "permissionrequest" | "approval/asked" | "approval/request" => {
            // Suppress false waiting alerts when the client is running in auto-approval / bypass mode (#128)
            if is_auto_approval_mode(raw) {
                return None;
            }
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("waiting".to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or_else(|| Some("等你确认操作".to_string())),
                tool: clean_short_text(tool_name, 36),
                auto_type: Some(false),
                sound: Some(explicit_sound.unwrap_or(true)),
                ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                ts,
            })
        }
        "notification" => {
            // Distinguish real approval/elicitation prompts from idle or generic informational notifications (#128)
            let ntype = raw
                .get("notification_type")
                .or_else(|| raw.get("notificationType"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if matches!(
                ntype.as_str(),
                "permission_prompt" | "elicitation_dialog" | "approval" | "approval_prompt"
            ) {
                if is_auto_approval_mode(raw) {
                    return None;
                }
                Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("waiting".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("等你确认操作".to_string())),
                    tool: clean_short_text(tool_name, 36),
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                    ts,
                })
            } else if ntype == "idle_prompt" {
                Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("idle".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: None,
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(false),
                    ttl_ms: Some(1_000),
                    ts,
                })
            } else {
                override_text.map(|txt| AgentCompanionEvent {
                    kind: "bubble".to_string(),
                    status: None,
                    action: None,
                    source: Some(source),
                    session,
                    text: Some(txt),
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(false)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(5_000)),
                    ts,
                })
            }
        }
        "stop"
        | "agentstop"
        | "subagentstop"
        | "afteragent"
        | "taskcompleted"
        | "turn_complete"
        | "turn/end"
        | "post_cascade_response" => {
            if term_reason.eq_ignore_ascii_case("USER_CANCELED")
                || term_reason.eq_ignore_ascii_case("aborted")
                || term_reason.eq_ignore_ascii_case("canceled")
                || term_reason.eq_ignore_ascii_case("cancelled")
            {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("idle".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: None,
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(false),
                    ttl_ms: Some(1_000),
                    ts,
                });
            }
            if term_reason.eq_ignore_ascii_case("blocked") {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("waiting".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("等你确认操作".to_string())),
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(180_000)),
                    ts,
                });
            }
            if term_reason.eq_ignore_ascii_case("ERROR")
                || term_reason.eq_ignore_ascii_case("failed")
                || term_reason.eq_ignore_ascii_case("max-tokens")
                || !err_str.is_empty()
            {
                return Some(AgentCompanionEvent {
                    kind: "status".to_string(),
                    status: Some("error".to_string()),
                    action: None,
                    source: Some(source),
                    session,
                    text: override_text.or_else(|| Some("任务出错了".to_string())),
                    tool: None,
                    auto_type: Some(false),
                    sound: Some(explicit_sound.unwrap_or(true)),
                    ttl_ms: Some(explicit_ttl.unwrap_or(9_000)),
                    ts,
                });
            }
            Some(AgentCompanionEvent {
                kind: "status".to_string(),
                status: Some("done".to_string()),
                action: None,
                source: Some(source),
                session,
                text: override_text.or_else(|| Some("任务完成！".to_string())),
                tool: None,
                auto_type: Some(false),
                sound: Some(explicit_sound.unwrap_or(true)),
                ttl_ms: Some(explicit_ttl.unwrap_or(6_500)),
                ts,
            })
        }
        _ => None,
    }
}

/// Materializes (or refreshes when port/version changes) a zero-dependency native Cordis plugin
/// (`dsh-kurocat`) inside KuroCat's app data directory so DeepSeek Harness (`dsh`) can track every
/// `session/event` (thinking, tool calls, live todo tasks & step progress, approvals, turn ends)
/// automatically in real time — identical to `dsh-pet` / `dsh-dafeiyu`, with zero token cost.
pub fn ensure_dsh_bridge_plugin(port: u16) -> Option<std::path::PathBuf> {
    let actual_port = if port == 0 { 27420 } else { port };
    let plugin_dir = crate::config::app_data_dir().join("dsh-plugin");
    std::fs::create_dir_all(&plugin_dir).ok()?;

    let package_json = serde_json::to_string_pretty(&json!({
        "name": "dsh-kurocat",
        "version": SERVER_VERSION,
        "type": "module",
        "description": "KuroCat real-time desktop pet companion bridge for DeepSeek Harness (dsh)",
        "main": "index.js",
        "exports": {
            ".": "./index.js",
            "./package.json": "./package.json"
        },
        "files": ["index.js", "cordis.patch.yml"],
        "dsh": {
            "bundle": {
                "patch": "./cordis.patch.yml"
            }
        }
    }))
    .ok()?;

    let cordis_patch_yml = "# KuroCat native DeepSeek Harness companion bridge\n- insert:\n    - id: dsh-kurocat\n      name: 'dsh-kurocat'\n";

    let index_js = format!(
        r#"// Auto-generated by KuroCat v{ver} — native zero-dependency Cordis plugin for DeepSeek Harness (dsh).
// Subscribes directly to DSH `session/event` & `session/disposed` so KuroCat mirrors every thinking
// step, tool call, live todo task/progress, approval wait, and completion in real time (zero tokens).
import http from 'node:http';

export const name = 'dsh-kurocat';
export const inject = [];

const DEFAULT_PORT = {port};
const HEARTBEAT_MS = 25000;

function resolvePort(config) {{
  const raw = Number(config?.port ?? process.env.KUROCAT_PORT ?? DEFAULT_PORT);
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : DEFAULT_PORT;
}}

function postEvent(port, payload) {{
  try {{
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request({{
      hostname: '127.0.0.1',
      port,
      path: '/hook',
      method: 'POST',
      timeout: 350,
      headers: {{
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        Connection: 'close',
      }},
    }}, (res) => {{
      res.resume();
    }});
    req.on('error', () => {{}});
    req.on('timeout', () => req.destroy());
    req.end(body);
  }} catch {{
    // Never disturb DSH if KuroCat is closed or restarting
  }}
}}

function cleanShort(value, maxLen) {{
  const s = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!s) return '';
  return s.length <= maxLen ? s : `${{s.slice(0, Math.max(1, maxLen - 1))}}…`;
}}

function cleanProjectName(value) {{
  const s = String(value ?? '').trim();
  if (!s) return undefined;
  const parts = s.split(/[\\/]/u).filter(Boolean);
  const candidate = parts.length > 1 ? parts.at(-1) : s;
  return cleanShort(candidate, 20) || undefined;
}}

function projectNameOf(session, event) {{
  const candidates = [
    event?.data?.projectName,
    session?.cwd,
    session?.context?.cwd,
    session?.header?.cwd,
    event?.data?.cwd,
    session?.title,
    session?.name,
    session?.header?.title,
    session?.header?.name,
  ];
  for (const c of candidates) {{
    const name = cleanProjectName(c);
    if (name) return name;
  }}
  return undefined;
}}

function sessionIdOf(session) {{
  return String(session?.header?.id ?? session?.id ?? 'default');
}}

function isSubagent(session) {{
  return session?.header?.origin === 'subagent'
    || Number(session?.header?.delegationDepth ?? 0) > 0;
}}

function isUserQuestionTool(toolName) {{
  const lower = String(toolName ?? '').toLowerCase();
  return lower.includes('ask_user')
    || lower.includes('askuser')
    || lower.includes('user_question')
    || lower.includes('request_user_input')
    || lower.includes('exit_plan_mode')
    || lower === 'ask_question';
}}

function describeTool(toolName) {{
  const lower = String(toolName ?? '').toLowerCase();
  if (!lower) return '处理任务中…';
  if (/edit|write|patch|replace|notebook|apply/.test(lower)) return '写代码中…';
  if (/bash|shell|pwsh|powershell|exec|terminal|command|run/.test(lower)) return '运行命令中…';
  if (/browser|web|fetch|http/.test(lower)) return '查阅资料中…';
  if (/read|grep|glob|search|find|list|view|inspect/.test(lower)) return '阅读代码中…';
  if (/subagent|agent|delegate|task/.test(lower)) return '协作处理中…';
  return `调用 ${{cleanShort(toolName, 18)}}…`;
}}

function toolCallIdOf(event, fallback) {{
  return String(event?.data?.id ?? event?.data?.callId ?? event?.data?.toolCallId ?? fallback ?? '');
}}

function extractTodoState(todos) {{
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const completed = todos.filter((t) => ['completed', 'complete', 'done'].includes(t?.status)).length;
  const current = todos.find((t) => t?.status === 'in_progress')
    ?? todos.find((t) => t?.status === 'pending');
  return {{
    completed,
    total: todos.length,
    task: current?.content ? cleanShort(current.content, 36) : undefined,
  }};
}}

function composeTaskText(rec, fallback) {{
  const parts = [];
  if (rec.progress?.total) {{
    parts.push(`${{rec.progress.completed}}/${{rec.progress.total}}`);
  }}
  if (rec.task) {{
    parts.push(rec.task);
  }} else if (fallback) {{
    parts.push(fallback);
  }}
  return cleanShort(parts.join(' · ') || fallback || '处理任务中…', 68);
}}

export function apply(ctx, config = {{}}) {{
  const port = resolvePort(config);
  const includeSubagents = config?.includeSubagents === true;
  const eventCtx = ctx.root ?? ctx;
  const sessions = new Map();
  let sawSessionEvent = false;
  let fallbackRunning = 0;

  const getRecord = (session, event) => {{
    const id = sessionIdOf(session);
    let rec = sessions.get(id);
    if (!rec) {{
      rec = {{
        id,
        key: `dsh:${{id}}`,
        project: undefined,
        turnActive: false,
        openTools: new Map(),
        waitingCallId: undefined,
        waitingApprovalId: undefined,
        task: undefined,
        progress: undefined,
        lastStatus: 'idle',
        lastText: '',
        lastPayload: null,
        lastSentAt: 0,
      }};
      sessions.set(id, rec);
    }}
    const proj = projectNameOf(session, event);
    if (proj) rec.project = proj;
    return rec;
  }};

  const emitFor = (rec, status, text, opts = {{}}) => {{
    const source = rec.project ? `DeepSeek · ${{rec.project}}` : 'DeepSeek';
    const payload = {{
      session: rec.key,
      source,
      status,
      text: text || undefined,
      tool: opts.tool || undefined,
      autoType: opts.autoType,
      sound: opts.sound,
      ttlMs: opts.ttlMs ?? (status === 'done' ? 6500 : status === 'error' ? 8500 : 180000),
      ts: Date.now(),
    }};
    rec.lastStatus = status;
    rec.lastText = text || '';
    rec.lastPayload = (status === 'working' || status === 'thinking' || status === 'waiting') ? payload : null;
    rec.lastSentAt = Date.now();
    postEvent(port, payload);
  }};

  const handleSessionEvent = (session, event) => {{
    if (!event || typeof event.type !== 'string') return;
    sawSessionEvent = true;
    if (!includeSubagents && isSubagent(session)) return;
    const rec = getRecord(session, event);

    switch (event.type) {{
      case 'turn/start': {{
        rec.turnActive = true;
        rec.openTools.clear();
        rec.waitingCallId = undefined;
        rec.waitingApprovalId = undefined;
        rec.task = undefined;
        rec.progress = undefined;
        emitFor(rec, 'thinking', '思考准备中…', {{ autoType: false, sound: false }});
        break;
      }}
      case 'step/start':
      case 'assistant/chunk':
      case 'assistant/message': {{
        if (!rec.turnActive || rec.openTools.size > 0 || rec.waitingApprovalId) return;
        const text = composeTaskText(rec, '思考分析中…');
        if (rec.lastStatus === 'thinking' && rec.lastText === text && Date.now() - rec.lastSentAt < HEARTBEAT_MS) {{
          return;
        }}
        emitFor(rec, 'thinking', text, {{ autoType: false, sound: false }});
        break;
      }}
      case 'tool/call': {{
        rec.turnActive = true;
        const callId = toolCallIdOf(event, `seq-${{event.seq ?? Date.now()}}`);
        const toolName = String(event.data?.name ?? event.data?.message?.name ?? 'tool');
        rec.openTools.set(callId, toolName);
        if (isUserQuestionTool(toolName)) {{
          rec.waitingCallId = callId;
          emitFor(rec, 'waiting', '等你确认操作', {{ tool: toolName, autoType: false, sound: true }});
        }} else {{
          const action = describeTool(toolName);
          const text = rec.task ? composeTaskText(rec, action) : action;
          emitFor(rec, 'working', text, {{ tool: toolName, autoType: true, sound: false }});
        }}
        break;
      }}
      case 'tool/result': {{
        const callId = toolCallIdOf(event);
        if (callId) rec.openTools.delete(callId);
        if (callId && callId === rec.waitingCallId) rec.waitingCallId = undefined;
        if (event.data?.error) {{
          emitFor(rec, 'error', '工具执行出错', {{ autoType: false, sound: true, ttlMs: 4500 }});
          return;
        }}
        if (rec.openTools.size > 0) {{
          const nextTool = rec.openTools.values().next().value;
          const action = describeTool(nextTool);
          const text = rec.task ? composeTaskText(rec, action) : action;
          emitFor(rec, 'working', text, {{ tool: nextTool, autoType: true, sound: false }});
        }} else if (rec.turnActive) {{
          emitFor(rec, 'thinking', composeTaskText(rec, '整理结果中…'), {{ autoType: false, sound: false }});
        }}
        break;
      }}
      case 'todo/write': {{
        const info = extractTodoState(event.data?.todos);
        if (!info) return;
        rec.progress = {{ completed: info.completed, total: info.total }};
        if (info.task) rec.task = info.task;
        if (!rec.turnActive) return;
        if (rec.openTools.size > 0) {{
          const activeTool = rec.openTools.values().next().value;
          emitFor(rec, 'working', composeTaskText(rec, describeTool(activeTool)), {{
            tool: activeTool,
            autoType: true,
            sound: false,
          }});
        }} else {{
          emitFor(rec, 'thinking', composeTaskText(rec, '执行任务中…'), {{ autoType: false, sound: false }});
        }}
        break;
      }}
      case 'approval/asked': {{
        const id = String(event.data?.id ?? '');
        const fresh = !(id && rec.waitingApprovalId === id && rec.lastStatus === 'waiting');
        rec.waitingApprovalId = id || 'pending';
        emitFor(rec, 'waiting', '等你确认审批', {{
          tool: event.data?.toolName,
          autoType: false,
          sound: fresh,
        }});
        break;
      }}
      case 'approval/decided': {{
        rec.waitingApprovalId = undefined;
        if (!rec.turnActive) return;
        if (rec.openTools.size > 0) {{
          const activeTool = rec.openTools.values().next().value;
          emitFor(rec, 'working', composeTaskText(rec, describeTool(activeTool)), {{
            tool: activeTool,
            autoType: true,
            sound: false,
          }});
        }} else {{
          emitFor(rec, 'thinking', composeTaskText(rec, '继续处理中…'), {{ autoType: false, sound: false }});
        }}
        break;
      }}
      case 'turn/end': {{
        rec.turnActive = false;
        rec.openTools.clear();
        rec.waitingCallId = undefined;
        rec.waitingApprovalId = undefined;
        const kind = String(event.data?.reason?.kind ?? 'completed');
        if (kind === 'blocked') {{
          emitFor(rec, 'waiting', '等待你确认操作', {{ autoType: false, sound: true }});
        }} else if (kind === 'aborted') {{
          emitFor(rec, 'idle', '', {{ autoType: false, sound: false, ttlMs: 1000 }});
        }} else if (kind === 'completed') {{
          emitFor(rec, 'done', '任务完成！', {{ autoType: false, sound: true, ttlMs: 6500 }});
        }} else {{
          emitFor(rec, 'error', kind === 'max-tokens' ? '达到上下文上限' : '任务出错了', {{
            autoType: false,
            sound: true,
            ttlMs: 8500,
          }});
        }}
        break;
      }}
      default:
        break;
    }}
  }};

  const offEvent = eventCtx.on('session/event', (session, event) => {{
    try {{ handleSessionEvent(session, event); }} catch {{}}
  }}, {{ global: true }});

  const offDisposed = eventCtx.on('session/disposed', (session) => {{
    try {{
      const id = sessionIdOf(session);
      const rec = sessions.get(id);
      if (rec) {{
        sessions.delete(id);
        emitFor(rec, 'idle', '', {{ autoType: false, sound: false, ttlMs: 1000 }});
      }}
    }} catch {{}}
  }}, {{ global: true }});

  // Fallback for legacy DSH builds that emit `agent/status` instead of `session/event`
  const offLegacyStatus = eventCtx.on('agent/status', (payload) => {{
    if (sawSessionEvent) return;
    try {{
      const st = payload?.status;
      if (st === 'running') {{
        fallbackRunning += 1;
        postEvent(port, {{ session: 'dsh:legacy', source: 'DeepSeek', status: 'working', text: '处理任务中…', autoType: true, sound: false, ttlMs: 180000, ts: Date.now() }});
      }} else if (st === 'idle') {{
        const was = fallbackRunning > 0;
        fallbackRunning = Math.max(0, fallbackRunning - 1);
        if (was && fallbackRunning === 0) {{
          postEvent(port, {{ session: 'dsh:legacy', source: 'DeepSeek', status: 'done', text: '任务完成！', autoType: false, sound: true, ttlMs: 6500, ts: Date.now() }});
        }}
      }}
    }} catch {{}}
  }}, {{ global: true }});

  // Keepalive heartbeat so long deep-reasoning or slow commands never drop off KuroCat mid-turn
  const heartbeat = setInterval(() => {{
    const now = Date.now();
    for (const rec of sessions.values()) {{
      if (rec.turnActive && rec.lastPayload && now - rec.lastSentAt >= HEARTBEAT_MS - 1000) {{
        rec.lastSentAt = now;
        postEvent(port, {{ ...rec.lastPayload, sound: false, ts: now }});
      }}
    }}
  }}, HEARTBEAT_MS);
  heartbeat.unref?.();

  ctx.on('dispose', () => {{
    clearInterval(heartbeat);
    offEvent?.();
    offDisposed?.();
    offLegacyStatus?.();
    for (const rec of sessions.values()) {{
      if (rec.turnActive) {{
        emitFor(rec, 'idle', '', {{ autoType: false, sound: false, ttlMs: 1000 }});
      }}
    }}
    sessions.clear();
  }});
}}
"#,
        ver = SERVER_VERSION,
        port = actual_port,
    );

    let write_if_changed = |path: std::path::PathBuf, content: &str| -> std::io::Result<()> {
        if let Ok(existing) = std::fs::read_to_string(&path) {
            if existing == content {
                return Ok(());
            }
        }
        std::fs::write(path, content.as_bytes())
    };

    write_if_changed(plugin_dir.join("package.json"), &package_json).ok()?;
    write_if_changed(plugin_dir.join("cordis.patch.yml"), cordis_patch_yml).ok()?;
    write_if_changed(plugin_dir.join("index.js"), &index_js).ok()?;

    // Also build a zero-dependency npm-format `.tgz` package so DSH Official Desktop App users
    // can install via "Plugins -> Add Plugin" by pasting the `.tgz` path with zero CLI/Node setup!
    let tgz_bytes = build_ustar_gzip_tgz(&[
        ("package/package.json", package_json.as_bytes()),
        ("package/cordis.patch.yml", cordis_patch_yml.as_bytes()),
        ("package/index.js", index_js.as_bytes()),
    ]);
    let tgz_path = plugin_dir.join("dsh-kurocat.tgz");
    let tgz_same = std::fs::read(&tgz_path).map(|b| b == tgz_bytes).unwrap_or(false);
    if !tgz_same {
        let _ = std::fs::write(&tgz_path, &tgz_bytes);
    }
    Some(plugin_dir)
}

/// Materializes a zero-dependency native OpenCode plugin (`kurocat.js`) inside KuroCat's app data
/// directory so OpenCode can track every tool call, session status, and permission prompt with zero
/// token cost (simply copy into `~/.config/opencode/plugins/kurocat.js`).
pub fn ensure_opencode_bridge_plugin(port: u16) -> Option<std::path::PathBuf> {
    let actual_port = if port == 0 { 27420 } else { port };
    let plugin_dir = crate::config::app_data_dir().join("opencode-plugin");
    std::fs::create_dir_all(&plugin_dir).ok()?;
    let plugin_path = plugin_dir.join("kurocat.js");

    let plugin_js = format!(
        r#"// Auto-generated by KuroCat v{ver} — native real-time OpenCode companion bridge
// Zero external dependencies. Copy to ~/.config/opencode/plugins/kurocat.js and restart OpenCode.

const PORT = Number(process.env.KUROCAT_PORT || {port});
const ENDPOINT = `http://127.0.0.1:${{PORT}}/hook`;

function describeTool(toolName) {{
  const t = String(toolName || '').toLowerCase();
  if (/write|edit|patch|replace|create|multi_edit|notebook/.test(t)) return '写代码中…';
  if (/bash|shell|exec|terminal|command|run/.test(t)) return '运行命令中…';
  if (/grep|glob|find|search|ripgrep/.test(t)) return '搜索项目中…';
  if (/read|view|list|ls|cat|outline/.test(t)) return '阅读代码中…';
  if (/web|fetch|http|browser|url/.test(t)) return '查资料中…';
  if (/task|agent|subagent/.test(t)) return '调度子任务中…';
  return '执行工具中…';
}}

function isQuestionTool(toolName) {{
  const t = String(toolName || '').toLowerCase();
  return t.includes('ask') || t.includes('question') || t.includes('confirm');
}}

function postHook(payload) {{
  try {{
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), 800) : null;
    fetch(ENDPOINT, {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify(payload),
      signal: ac ? ac.signal : undefined,
    }})
      .catch(() => {{}})
      .finally(() => {{
        if (timer) clearTimeout(timer);
      }});
  }} catch {{}}
}}

export const KuroCatPlugin = async () => {{
  const busySessions = new Set();

  return {{
    'tool.execute.before': async (input) => {{
      const sid = `opencode:${{input?.sessionID || 'default'}}`;
      const tool = String(input?.tool || '');
      busySessions.add(sid);
      if (isQuestionTool(tool)) {{
        postHook({{
          session: sid,
          source: 'OpenCode',
          status: 'waiting',
          text: '等你确认操作',
          tool,
          autoType: false,
          sound: true,
          ttlMs: 180000,
          ts: Date.now(),
        }});
        return;
      }}
      postHook({{
        session: sid,
        source: 'OpenCode',
        status: 'working',
        text: describeTool(tool),
        tool,
        autoType: true,
        sound: false,
        ttlMs: 180000,
        ts: Date.now(),
      }});
    }},

    'tool.execute.after': async (input) => {{
      const sid = `opencode:${{input?.sessionID || 'default'}}`;
      if (!busySessions.has(sid)) return;
      postHook({{
        session: sid,
        source: 'OpenCode',
        status: 'thinking',
        text: '整理结果中…',
        tool: String(input?.tool || ''),
        autoType: false,
        sound: false,
        ttlMs: 180000,
        ts: Date.now(),
      }});
    }},

    event: async ({{ event }}) => {{
      const type = String(event?.type || '');
      const props = event?.properties || {{}};
      const rawSid = props.sessionID || props.info?.id || 'default';
      const sid = `opencode:${{rawSid}}`;

      if (type === 'session.status') {{
        const st = String(props.status?.type || props.status || '').toLowerCase();
        if (st === 'busy' || st === 'running' || st === 'retry') {{
          busySessions.add(sid);
          postHook({{
            session: sid,
            source: 'OpenCode',
            status: st === 'retry' ? 'working' : 'thinking',
            text: st === 'retry' ? '重试中…' : '思考分析中…',
            autoType: st === 'retry',
            sound: false,
            ttlMs: 180000,
            ts: Date.now(),
          }});
        }} else if (st === 'idle' && busySessions.delete(sid)) {{
          postHook({{
            session: sid,
            source: 'OpenCode',
            status: 'done',
            text: '任务完成！',
            autoType: false,
            sound: true,
            ttlMs: 6500,
            ts: Date.now(),
          }});
        }}
      }} else if (type === 'session.idle') {{
        busySessions.delete(sid);
        postHook({{
          session: sid,
          source: 'OpenCode',
          status: 'done',
          text: '任务完成！',
          autoType: false,
          sound: true,
          ttlMs: 6500,
          ts: Date.now(),
        }});
      }} else if (type === 'session.error') {{
        busySessions.delete(sid);
        postHook({{
          session: sid,
          source: 'OpenCode',
          status: 'error',
          text: '任务出错了',
          autoType: false,
          sound: true,
          ttlMs: 8500,
          ts: Date.now(),
        }});
      }} else if (type === 'permission.asked' || type === 'permission.updated') {{
        postHook({{
          session: sid,
          source: 'OpenCode',
          status: 'waiting',
          text: '等你确认权限',
          autoType: false,
          sound: true,
          ttlMs: 180000,
          ts: Date.now(),
        }});
      }} else if (type === 'session.deleted') {{
        busySessions.delete(sid);
        postHook({{
          session: sid,
          source: 'OpenCode',
          status: 'idle',
          text: '',
          autoType: false,
          sound: false,
          ttlMs: 1000,
          ts: Date.now(),
        }});
      }}
    }},
  }};
}};

export default KuroCatPlugin;
"#,
        ver = env!("CARGO_PKG_VERSION"),
        port = actual_port,
    );

    let same = std::fs::read_to_string(&plugin_path)
        .map(|s| s == plugin_js)
        .unwrap_or(false);
    if !same {
        std::fs::write(&plugin_path, plugin_js.as_bytes()).ok()?;
    }
    Some(plugin_path)
}

/// Pure-Rust POSIX ustar `.tar` wrapped in RFC 1952 `.gz` (uncompressed DEFLATE stored blocks).
/// Keeps binary size tiny with zero extra crate dependencies while staying 100% compatible with
/// `tar`, Node `zlib`, npm, and DeepSeek Harness Desktop App's `.tgz` plugin installer.
fn build_ustar_gzip_tgz(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut tar = Vec::with_capacity(20 * 1024);
    for (name, data) in entries {
        let mut header = [0u8; 512];
        let name_bytes = name.as_bytes();
        let copy_len = name_bytes.len().min(100);
        header[..copy_len].copy_from_slice(&name_bytes[..copy_len]);
        header[100..108].copy_from_slice(b"0000644\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        let size_oct = format!("{:011o}\0", data.len());
        header[124..136].copy_from_slice(size_oct.as_bytes());
        header[136..148].copy_from_slice(b"14500000000\0");
        header[148..156].fill(b' ');
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let chksum: u32 = header.iter().map(|&b| b as u32).sum();
        let chk_oct = format!("{:06o}\0 ", chksum);
        header[148..156].copy_from_slice(chk_oct.as_bytes());

        tar.extend_from_slice(&header);
        tar.extend_from_slice(data);
        let rem = data.len() % 512;
        if rem != 0 {
            tar.resize(tar.len() + (512 - rem), 0);
        }
    }
    tar.resize(tar.len() + 1024, 0);

    // IEEE 802.3 CRC32 for RFC 1952 gzip trailer
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in &tar {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if (crc & 1) != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    crc = !crc;

    let mut gz = Vec::with_capacity(tar.len() + 64);
    gz.extend_from_slice(&[0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03]);
    let chunks: Vec<&[u8]> = tar.chunks(65_535).collect();
    for (idx, chunk) in chunks.iter().enumerate() {
        let is_last = idx + 1 == chunks.len();
        gz.push(if is_last { 0x01 } else { 0x00 });
        let len = chunk.len() as u16;
        let nlen = !len;
        gz.extend_from_slice(&len.to_le_bytes());
        gz.extend_from_slice(&nlen.to_le_bytes());
        gz.extend_from_slice(chunk);
    }
    gz.extend_from_slice(&crc.to_le_bytes());
    gz.extend_from_slice(&(tar.len() as u32).to_le_bytes());
    gz
}

fn post_loopback_json(port: u16, path: &str, payload: &Value) -> bool {
    let actual_port = if port == 0 { 27420 } else { port };
    let addr = SocketAddr::from(([127, 0, 0, 1], actual_port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let body = payload.to_string();
    let req = format!(
        "POST {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        actual_port,
        body.as_bytes().len(),
        body
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let _ = stream.flush();
    let mut drain = [0u8; 256];
    let _ = stream.read(&mut drain);
    true
}

/// CLI entrypoint for `KuroCat --hook` used by Antigravity, Claude Code, WorkBuddy, and Codex hooks.
/// Never blocks, never slows down the AI host (<=250ms timeout), and always outputs `{}` on stdout.
pub fn run_hook_cli(args: &[String]) {
    let mut source_hint: Option<String> = None;
    let mut session_hint: Option<String> = None;
    let mut event_hint: Option<String> = None;
    let mut text_hint: Option<String> = None;
    let mut port_override: Option<u16> = None;
    let mut positional_json: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--hook" => {}
            "--source" if i + 1 < args.len() => {
                i += 1;
                source_hint = Some(args[i].clone());
            }
            "--session" if i + 1 < args.len() => {
                i += 1;
                session_hint = Some(args[i].clone());
            }
            "--event" | "--status" if i + 1 < args.len() => {
                i += 1;
                event_hint = Some(args[i].clone());
            }
            "--text" | "--message" if i + 1 < args.len() => {
                i += 1;
                text_hint = Some(args[i].clone());
            }
            "--port" if i + 1 < args.len() => {
                i += 1;
                port_override = args[i].parse::<u16>().ok();
            }
            other if other.trim_start().starts_with('{') => {
                positional_json = Some(other.to_string());
            }
            _ => {}
        }
        i += 1;
    }

    let raw_payload: Value = if let Some(pos) = positional_json {
        serde_json::from_str(&pos).unwrap_or_else(|_| json!({}))
    } else if event_hint.is_none() && !std::io::stdin().is_terminal() {
        let mut buf = Vec::new();
        let _ = std::io::stdin().take(512 * 1024).read_to_end(&mut buf);
        serde_json::from_slice(&buf).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let settings = load_settings();
    if settings.mcp_enabled {
        let port = port_override.unwrap_or(settings.mcp_port);
        if let Some(ev) = parse_hook_payload_with_session(
            &raw_payload,
            source_hint.as_deref(),
            session_hint.as_deref(),
            event_hint.as_deref(),
            text_hint.as_deref(),
        ) {
            if let Ok(val) = serde_json::to_value(&ev) {
                let _ = post_loopback_json(port, "/agent/event", &val);
            }
        }
    }

    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{{}}");
    let _ = out.flush();
}

fn cat_skin_properties_schema() -> Value {
    let mut map = serde_json::Map::new();
    let core = json!({
        "id": { "type": "string", "description": "Unique lowercase slug ID, e.g. 'bengal-tiger', 'tibetan-fox', 'my-calico'" },
        "name": { "type": "string", "description": "Display name shown in menu, e.g. '霸气小老虎', '藏狐', '我的三花'" },
        "emoji": { "type": "string", "description": "Optional emoji badge, e.g. '🐱', '🐯', '🦊'" },
        "furColor": { "type": "string", "description": "Base coat hex color, e.g. '#f2a452'" },
        "furSecondaryColor": { "type": "string" },
        "outlineColor": { "type": "string", "description": "Outer stroke hex color for light coats, e.g. '#5d5148'" },
        "legLineColor": { "type": "string" },
        "pattern": { "type": "string", "enum": ["solid", "bicolor", "tuxedo", "tabby", "calico", "siamese"] },
        "maskColor": { "type": "string" },
        "foreheadBridgeColor": { "type": "string" },
        "flankColor": { "type": "string" },
        "bellyBibColor": { "type": "string" },
        "stripeColor": { "type": "string" },
        "calicoPatchColor": { "type": "string" },
        "earOuterColor": { "type": "string" },
        "earTipColor": { "type": "string" },
        "earInnerColor": { "type": "string" },
        "earTuftColor": { "type": "string" },
        "tailColor": { "type": "string" },
        "tailTipColor": { "type": "string" },
        "tailFluffy": { "type": "boolean" },
        "tailStripes": { "type": "boolean" },
        "eyeColorTop": { "type": "string" },
        "eyeColorBottom": { "type": "string" },
        "rightEyeColorTop": { "type": "string", "description": "Heterochromia (odd-eyed): optional viewer-right eye top iris hex color" },
        "rightEyeColorBottom": { "type": "string", "description": "Heterochromia (odd-eyed): optional viewer-right eye bottom iris hex color" },
        "pupilColor": { "type": "string" },
        "eyeCatchlight": { "type": "boolean" },
        "eyeRimColor": { "type": "string" },
        "squintColor": { "type": "string" },
        "squintGlowColor": { "type": "string" },
        "noseColor": { "type": "string" },
        "mouthColor": { "type": "string" },
        "blushColor": { "type": "string" },
        "whiskerColor": { "type": "string" },
        "eyebrowColor": { "type": "string", "description": "Optional eyebrow CSS color" },
        "armColor": { "type": "string" },
        "pawColor": { "type": "string" },
        "pawOutlineColor": { "type": "string" },
        "armCreaseColor": { "type": "string" },
        "accentColor": { "type": "string", "description": "Pressed key & clicked mouse highlight hex color" },
        "accentSideColor": { "type": "string" }
    });
    let sculpting = json!({
        "faceShape": { "type": "string", "enum": ["round", "square", "wide", "fox", "oval"], "description": "Head silhouette: round (cat), square (Tibetan fox), wide (tiger/bear), fox (pointed chin), oval (bunny/capybara)" },
        "headWidth": { "type": "number", "minimum": 0.78, "maximum": 1.32, "description": "Horizontal head width multiplier (default 1.0)" },
        "jawSquareness": { "type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Jawline & cheek squareness (0.0 round .. 1.0 boxy square face)" },
        "earShape": { "type": "string", "enum": ["cat", "round", "tall", "small", "wide", "folded", "floppy"], "description": "Ear silhouette: cat, round (tiger/bear/panda), tall (fox/bunny), small (Tibetan fox), wide (fennec), folded (Scottish Fold), floppy (lop bunny)" },
        "earScale": { "type": "number", "minimum": 0.55, "maximum": 1.55, "description": "Ear size multiplier (default 1.0)" },
        "earSpacing": { "type": "number", "minimum": 0.70, "maximum": 1.35, "description": "Horizontal ear spread multiplier (default 1.0)" },
        "earTilt": { "type": "number", "minimum": -0.45, "maximum": 0.65, "description": "Extra outward ear tilt in radians (-0.45 upright .. +0.65 outward/droopy)" },
        "eyeSquint": { "type": "number", "minimum": 0.0, "maximum": 0.75, "description": "Resting upper-eyelid droop for deadpan/cool gaze (e.g. 0.50 for Tibetan fox)" },
        "eyeScale": { "type": "number", "minimum": 0.55, "maximum": 1.45, "description": "Overall eye size multiplier (default 1.0)" },
        "eyeAspect": { "type": "number", "minimum": 0.60, "maximum": 1.40, "description": "Eye height/width ratio (<1.0 sleek narrow almond, >1.0 big tall round eyes)" },
        "eyeSpacing": { "type": "number", "minimum": 0.72, "maximum": 1.35, "description": "Horizontal distance between eyes (0.72 close-set .. 1.35 wide-set)" },
        "eyeOffsetY": { "type": "number", "minimum": -1.0, "maximum": 1.0, "description": "Vertical eye placement (-1.0 higher .. +1.0 lower cute baby face)" },
        "eyeTilt": { "type": "number", "minimum": -0.50, "maximum": 0.50, "description": "Outer eye corner slant in radians (-0.50 droopy .. +0.50 upturned fox)" },
        "pupilShape": { "type": "string", "enum": ["oval", "round", "slit", "dot", "star"], "description": "Pupil style: oval (classic cat), round (big anime), slit (sharp vertical cat slit), dot (tiny kawaii bead), star (4-point star sparkle)" },
        "pupilScale": { "type": "number", "minimum": 0.40, "maximum": 1.45, "description": "Pupil size multiplier (default 1.0)" },
        "noseShape": { "type": "string", "enum": ["cat", "round", "wide", "small", "none"], "description": "Nose shape: cat (triangle), round (bear button), wide (tiger/capybara), small (tiny dot), none (hidden)" },
        "noseScale": { "type": "number", "minimum": 0.50, "maximum": 1.80, "description": "Nose size multiplier (default 1.0)" },
        "noseOffsetY": { "type": "number", "minimum": -1.0, "maximum": 1.0, "description": "Vertical nose placement (-1.0 higher .. +1.0 lower)" },
        "mouthShape": { "type": "string", "enum": ["w", "smile", "flat", "open", "blep", "none"], "description": "Mouth style: w (classic :3 cat), smile (happy U smile), flat (deadpan straight), open (tiny o), blep (cute sticking-out pink tongue), none (hidden)" },
        "mouthScale": { "type": "number", "minimum": 0.55, "maximum": 1.70, "description": "Mouth size/width multiplier (default 1.0)" },
        "mouthOffsetY": { "type": "number", "minimum": -1.0, "maximum": 1.0, "description": "Vertical mouth placement (-1.0 higher .. +1.0 lower)" },
        "whiskerLength": { "type": "number", "minimum": 0.0, "maximum": 1.60, "description": "Whisker length multiplier (0.0 hides whiskers .. 1.60 long whiskers)" },
        "eyebrowStyle": { "type": "string", "enum": ["none", "soft", "thick", "angry", "worried"], "description": "Eyebrow style: none, soft (thin arch), thick (bold dot brows), angry (fierce), worried (droopy inner)" },
        "blushAlways": { "type": "boolean", "description": "Keep soft rosy cheek blush permanently visible even when not being petted" },
        "blushScale": { "type": "number", "minimum": 0.50, "maximum": 1.60, "description": "Cheek blush size multiplier (default 1.0)" },
        "bodyChubbiness": { "type": "number", "minimum": 0.80, "maximum": 1.25, "description": "Torso chubbiness multiplier (default 1.0)" },
        "spots": {
            "type": "array",
            "description": "Custom cat markings/spots (up to 16 in 3D, unlimited in 2D). rx/ry are in 2D canvas px (recommended 6..42).",
            "items": {
                "type": "object",
                "required": ["part", "x", "y", "rx", "ry", "color"],
                "properties": {
                    "part": { "type": "string", "enum": ["head", "body", "leftArm", "rightArm"] },
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "rx": { "type": "number" },
                    "ry": { "type": "number" },
                    "rotation": { "type": "number" },
                    "color": { "type": "string" },
                    "opacity": { "type": "number" }
                }
            }
        }
    });
    if let Value::Object(m) = core {
        map.extend(m);
    }
    if let Value::Object(m) = sculpting {
        map.extend(m);
    }
    Value::Object(map)
}

fn tool_definitions() -> Value {
    let skin_props = cat_skin_properties_schema();
    json!([
        {
            "name": "list_cats",
            "description": "List all available KuroCat skins (built-in cats, 'dafeiyu', and custom cats) and show which skin is currently active on screen.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "get_cat_schema",
            "description": "Get the full Cat Skin JSON schema — including patterns, faceShape, earShape (incl. folded/floppy/tall), full eye/pupil/heterochromia/nose/mouth/eyebrow/whisker/blush sculpting, spots[], and Tiger / Tibetan Fox / Scottish Fold examples.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "upsert_cat",
            "description": "Create a new custom cat skin or update an existing one with full 2D & 3D live hot-reload! Supports coat colors, pattern, faceShape, earShape, eye/pupil/heterochromia, nose/mouth/eyebrow/whisker/blush sculpting, and spots[]. Set merge: true to patch only supplied fields.",
            "inputSchema": {
                "type": "object",
                "required": ["cat"],
                "properties": {
                    "cat": {
                        "type": "object",
                        "required": ["id"],
                        "properties": skin_props
                    },
                    "activate": {
                        "type": "boolean",
                        "default": true,
                        "description": "Immediately switch the live desktop cat to this skin (default: true)."
                    },
                    "merge": {
                        "type": "boolean",
                        "default": false,
                        "description": "When true and a cat with this ID already exists, merge only the provided fields onto it instead of replacing all fields."
                    }
                }
            }
        },
        {
            "name": "patch_cat",
            "description": "Partially update an existing cat skin by ID — only send fields you want to change; keeps all other colors, contour settings, and spots intact.",
            "inputSchema": {
                "type": "object",
                "required": ["id", "patch"],
                "properties": {
                    "id": { "type": "string", "description": "Existing cat ID to modify (e.g. 'black', 'ragdoll', or custom ID)" },
                    "patch": {
                        "type": "object",
                        "description": "Subset of CatSkinConfig fields to update",
                        "properties": skin_props
                    },
                    "activate": {
                        "type": "boolean",
                        "default": true,
                        "description": "Immediately switch to this cat after patching (default: true)."
                    }
                }
            }
        },
        {
            "name": "switch_cat",
            "description": "Switch the active skin displayed on the user's desktop by ID (e.g. 'black', 'ragdoll', 'orange-tabby', 'calico', 'tuxedo', 'siamese', 'dafeiyu', or any custom ID).",
            "inputSchema": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": { "type": "string", "description": "Cat ID to activate" }
                }
            }
        },
        {
            "name": "delete_cat",
            "description": "Delete a custom cat skin (or reset a customized built-in skin back to default).",
            "inputSchema": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": { "type": "string", "description": "Custom cat ID to delete" }
                }
            }
        },
        {
            "name": "get_settings",
            "description": "Read current KuroCat desktop pet settings (active skin, 3D/2D mode, scale, opacity, bubbles, sound, typing sound, volume/mute, always-on-top, click-through lock, fpsCap, language, privacy guard, OBS, Live Capture window, MCP).",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "update_settings",
            "description": "Update KuroCat desktop pet settings live across Windows, macOS, and Linux.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "catBreed": { "type": "string", "description": "Active skin ID to switch to (e.g. 'black', 'ragdoll', 'dafeiyu', or custom ID)." },
                    "laoWuHandover": { "type": "boolean", "default": true, "description": "Play the Lao Wu handover animation when switching between built-in 3D cats (default: true)." },
                    "renderMode": { "type": "string", "enum": ["2d", "3d"], "description": "Visual engine mode: '2d' or '3d'." },
                    "collarColor": { "type": "string", "enum": ["none", "red", "blue", "pink", "green"], "description": "Optional 3D collar & gold bell color." },
                    "headphoneMode": { "type": "string", "enum": ["auto", "on", "off"], "description": "Gaming headset mode." },
                    "scale": { "type": "number", "minimum": 0.2, "maximum": 1.5 },
                    "opacity": { "type": "number", "minimum": 0.2, "maximum": 1.0, "description": "Desktop pet overall opacity from 0.2 (20%) to 1.0 (100%, default)." },
                    "keyboardLayout": { "type": "string", "enum": ["65", "98", "108", "macbook"] },
                    "whiteKeyboard": { "type": "boolean", "description": "Use silver-white keycap finish when keyboardLayout is 'macbook'." },
                    "trackpadEnabled": { "type": "boolean", "description": "Show macOS Magic Trackpad visualization instead of mouse." },
                    "keyboardOrientation": { "type": "string", "enum": ["cat", "viewer"] },
                    "tailKeyMode": { "type": "string", "enum": ["smart", "custom", "edge", "off"] },
                    "tailKeyIds": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "showKeyBubbles": { "type": "boolean" },
                    "soundEnabled": { "type": "boolean" },
                    "idlePurrEnabled": { "type": "boolean", "description": "Play soft purring during idle keyboard kneading (default: false)." },
                    "typingSoundEnabled": { "type": "boolean" },
                    "soundVolume": { "type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Master sound volume from 0.0 (0%) to 1.0 (100%, default)." },
                    "soundMuted": { "type": "boolean", "description": "Mute all KuroCat sounds when true (default: false)." },
                    "expressionHotkeys": { "type": "boolean", "description": "Enable global Alt+Shift+1..6 / 0 expression hotkeys synced to desktop pet and OBS (default: true)." },
                    "pauseHotkey": { "type": "string", "description": "Global shortcut to toggle Pause/Resume listening & hide pet (e.g. 'Alt+Shift+P', 'Ctrl+Alt+P', 'F9', or '' to disable)." },
                    "alwaysOnTop": { "type": "boolean" },
                    "yieldOnFullscreen": { "type": "boolean", "description": "Automatically yield behind fullscreen videos and games while keeping always-on-top over normal and maximized windows (default: false)." },
                    "clickThroughLocked": { "type": "boolean" },
                    "privacyPasswordGuard": { "type": "boolean" },
                    "eyeGazeMode": { "type": "string", "enum": ["screen", "window"], "description": "Eye tracking reference: 'screen' (screen-center basis to avoid corner eye-rolling, default) or 'window' (classic pet-window-relative tracking)." },
                    "fpsCap": { "type": "integer", "enum": [0, 30, 60], "description": "Frame rate cap: 0 (auto 60), 30 (eco), or 60." },
                    "language": { "type": "string", "enum": ["auto", "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "es-ES", "pt-BR", "ru-RU", "de-DE"] },
                    "obsEnabled": { "type": "boolean" },
                    "obsPort": { "type": "integer", "minimum": 1024, "maximum": 65535 },
                    "obsHidePet": { "type": "boolean" },
                    "liveCaptureEnabled": { "type": "boolean", "description": "Enable/open the borderless chroma-key capture window ('KuroCat Live') for Live Companion Window Capture." },
                    "liveChromaColor": { "type": "string", "enum": ["blue", "green", "magenta"], "description": "Chroma-key background color for the KuroCat Live capture window ('blue', 'green', or 'magenta')." },
                    "liveHidePet": { "type": "boolean", "description": "Hide the desktop pet while the KuroCat Live capture window is active." },
                    "autostart": { "type": "boolean" }
                }
            }
        },
        {
            "name": "set_agent_status",
            "description": "Drive KuroCat as an AI Coding Companion: show a floating status bubble above the pet, optionally animate the pet typing code automatically while working, and celebrate or alert when done / waiting / errored.",
            "inputSchema": {
                "type": "object",
                "required": ["status"],
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["working", "thinking", "waiting", "done", "error", "idle"],
                        "description": "working = pet auto-types code; thinking = curious head tilt; waiting = awaits user approval; done = happy completion alert; error = grumpy alert; idle = clear status"
                    },
                    "text": { "type": "string", "description": "Short status text shown in the floating pill bubble (<=72 chars), e.g. '正在修复登录 Bug…' or '构建通过！'" },
                    "source": { "type": "string", "description": "Optional agent badge name, e.g. '豆包工作版', 'WorkBuddy', 'DeepSeek', 'Codex', '千问', 'Antigravity', 'Claude'" },
                    "session": { "type": "string", "description": "Optional session key for multi-session stacked bubbles (e.g. 'worker-1', project name, or session ID)." },
                    "autoType": { "type": "boolean", "description": "Whether the pet should virtually type on its keyboard (defaults to true for 'working')." },
                    "sound": { "type": "boolean", "description": "Play a gentle chime if sound is enabled (defaults to true for done/waiting/error)." },
                    "ttlMs": { "type": "integer", "minimum": 1000, "maximum": 300000, "description": "Auto-clear timeout in milliseconds." }
                }
            }
        },
        {
            "name": "trigger_action",
            "description": "Trigger a live expression/animation and optional speech bubble on the running desktop pet and OBS stream.",
            "inputSchema": {
                "type": "object",
                "required": ["action"],
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["happy", "pet", "angry", "boop", "chin", "dizzy", "curious", "sleep", "wake", "tail_pat"],
                        "description": "Expression or animation to play immediately."
                    },
                    "text": { "type": "string", "description": "Optional floating bubble message to show with the action." },
                    "source": { "type": "string", "description": "Optional agent badge name." },
                    "session": { "type": "string", "description": "Optional session key for multi-session stacked bubbles." },
                    "sound": { "type": "boolean", "description": "Play a gentle sound if enabled." },
                    "ttlMs": { "type": "integer", "minimum": 1000, "maximum": 60000 }
                }
            }
        }
    ])
}

fn ok_text(payload: Value) -> Value {
    let text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": false
    })
}

fn err_text(msg: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": msg }],
        "isError": true
    })
}

fn execute_tool(
    name: &str,
    args: &Value,
    on_change: &dyn Fn(),
    on_agent_event: &dyn Fn(AgentCompanionEvent),
) -> Value {
    match name {
        "list_cats" => {
            let settings = load_settings();
            let cats = all_cats();
            ok_text(json!({
                "activeCatId": settings.cat_breed,
                "storagePath": cats_path().to_string_lossy(),
                "count": cats.len(),
                "cats": cats
            }))
        }
        "get_cat_schema" => ok_text(cat_schema_guide()),
        "upsert_cat" => {
            let Some(cat_val) = args.get("cat") else {
                return err_text("Missing required 'cat' object argument.");
            };
            let merge = args.get("merge").and_then(|v| v.as_bool()).unwrap_or(false);
            let save_res = if merge {
                let Some(obj) = cat_val.as_object() else {
                    return err_text("'cat' must be a JSON object.");
                };
                let Some(id_raw) = obj.get("id").and_then(|v| v.as_str()) else {
                    return err_text("Missing required 'cat.id' string.");
                };
                if cat_exists(id_raw) {
                    patch_custom_cat(id_raw, obj)
                } else {
                    match serde_json::from_value::<CatSkinConfig>(cat_val.clone()) {
                        Ok(c) => upsert_custom_cat(c),
                        Err(e) => Err(format!("Invalid cat skin JSON: {}", e)),
                    }
                }
            } else {
                match serde_json::from_value::<CatSkinConfig>(cat_val.clone()) {
                    Ok(c) => upsert_custom_cat(c),
                    Err(e) => Err(format!("Invalid cat skin JSON: {}", e)),
                }
            };

            match save_res {
                Ok(saved) => {
                    let activate = args
                        .get("activate")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    if activate {
                        let mut s = load_settings();
                        s.cat_breed = saved.id.clone();
                        save_settings(&s);
                    }
                    on_change();
                    ok_text(json!({
                        "status": "saved",
                        "activated": activate,
                        "cat": saved
                    }))
                }
                Err(e) => err_text(&format!("Failed to save custom cat: {}", e)),
            }
        }
        "patch_cat" => {
            let Some(id_raw) = args.get("id").and_then(|v| v.as_str()) else {
                return err_text("Missing required 'id' string argument.");
            };
            let Some(patch_obj) = args.get("patch").and_then(|v| v.as_object()) else {
                return err_text("Missing required 'patch' object argument.");
            };
            match patch_custom_cat(id_raw, patch_obj) {
                Ok(saved) => {
                    let activate = args
                        .get("activate")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    if activate {
                        let mut s = load_settings();
                        s.cat_breed = saved.id.clone();
                        save_settings(&s);
                    }
                    on_change();
                    ok_text(json!({
                        "status": "patched",
                        "activated": activate,
                        "cat": saved
                    }))
                }
                Err(e) => err_text(&format!("Failed to patch cat: {}", e)),
            }
        }
        "switch_cat" => {
            let Some(id_raw) = args.get("id").and_then(|v| v.as_str()) else {
                return err_text("Missing required 'id' string argument.");
            };
            let id = sanitize_cat_id(id_raw);
            if !cat_exists(&id) {
                let ids: Vec<String> = all_cats().into_iter().map(|c| c.id).collect();
                return err_text(&format!(
                    "Cat '{}' not found. Available IDs: {:?}",
                    id, ids
                ));
            }
            let mut s = load_settings();
            s.cat_breed = id.clone();
            save_settings(&s);
            on_change();
            ok_text(json!({
                "status": "switched",
                "activeCatId": id
            }))
        }
        "delete_cat" => {
            let Some(id_raw) = args.get("id").and_then(|v| v.as_str()) else {
                return err_text("Missing required 'id' string argument.");
            };
            let id = sanitize_cat_id(id_raw);
            match delete_custom_cat(&id) {
                Ok(removed) => {
                    if removed {
                        let mut s = load_settings();
                        if s.cat_breed == id && !cat_exists(&id) {
                            s.cat_breed = "black".to_string();
                            save_settings(&s);
                        }
                        on_change();
                        ok_text(json!({
                            "status": "deleted",
                            "id": id
                        }))
                    } else {
                        err_text(&format!("No custom cat entry found for '{}'.", id))
                    }
                }
                Err(e) => err_text(&format!("Failed to delete cat: {}", e)),
            }
        }
        "get_settings" => ok_text(serde_json::to_value(load_settings()).unwrap_or(json!({}))),
        "update_settings" => {
            let mut s = load_settings();
            if let Some(breed) = args.get("catBreed").and_then(|v| v.as_str()) {
                let clean = sanitize_cat_id(breed);
                if cat_exists(&clean) {
                    s.cat_breed = clean;
                } else {
                    return err_text(&format!("Unknown catBreed '{}'.", clean));
                }
            }
            if let Some(b) = args.get("laoWuHandover").and_then(|v| v.as_bool()) {
                s.lao_wu_handover = b;
            }
            if let Some(scale) = args.get("scale").and_then(|v| v.as_f64()) {
                s.scale = scale.clamp(0.20, 1.50);
            }
            if let Some(opacity) = args.get("opacity").and_then(|v| v.as_f64()) {
                s.opacity = crate::config::normalize_opacity(opacity);
            }
            if let Some(rm) = args.get("renderMode").and_then(|v| v.as_str()) {
                s.render_mode = crate::config::normalize_render_mode(rm);
            }
            if let Some(cc) = args.get("collarColor").and_then(|v| v.as_str()) {
                s.collar_color = crate::config::normalize_collar_color(cc);
            }
            if let Some(hm) = args.get("headphoneMode").and_then(|v| v.as_str()) {
                s.headphone_mode = crate::config::normalize_headphone_mode(hm);
            }
            if let Some(layout) = args.get("keyboardLayout").and_then(|v| v.as_str()) {
                s.keyboard_layout = crate::config::normalize_keyboard_layout(layout);
            }
            if let Some(b) = args.get("whiteKeyboard").and_then(|v| v.as_bool()) {
                s.white_keyboard = b;
            }
            if let Some(b) = args.get("trackpadEnabled").and_then(|v| v.as_bool()) {
                s.trackpad_enabled = b;
            }
            if let Some(orient) = args.get("keyboardOrientation").and_then(|v| v.as_str()) {
                s.keyboard_orientation = crate::config::normalize_keyboard_orientation(orient);
            }
            if let Some(mode) = args.get("tailKeyMode").and_then(|v| v.as_str()) {
                s.tail_key_mode = crate::config::normalize_tail_key_mode(mode);
            }
            if let Some(arr) = args.get("tailKeyIds").and_then(|v| v.as_array()) {
                let raw: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                s.tail_key_ids = crate::config::normalize_tail_key_ids(&raw);
            }
            if let Some(b) = args.get("showKeyBubbles").and_then(|v| v.as_bool()) {
                s.show_key_bubbles = b;
            }
            if let Some(b) = args.get("soundEnabled").and_then(|v| v.as_bool()) {
                s.sound_enabled = b;
            }
            if let Some(b) = args.get("idlePurrEnabled").and_then(|v| v.as_bool()) {
                s.idle_purr_enabled = b;
            }
            if let Some(b) = args.get("typingSoundEnabled").and_then(|v| v.as_bool()) {
                s.typing_sound_enabled = b;
            }
            if let Some(vol) = args.get("soundVolume").and_then(|v| v.as_f64()) {
                s.sound_volume = crate::config::normalize_sound_volume(vol);
            }
            if let Some(b) = args.get("soundMuted").and_then(|v| v.as_bool()) {
                s.sound_muted = b;
            }
            if let Some(b) = args.get("alwaysOnTop").and_then(|v| v.as_bool()) {
                s.always_on_top = b;
            }
            if let Some(b) = args.get("yieldOnFullscreen").and_then(|v| v.as_bool()) {
                s.yield_on_fullscreen = b;
            }
            if let Some(b) = args.get("clickThroughLocked").and_then(|v| v.as_bool()) {
                s.click_through_locked = b;
            }
            if let Some(b) = args.get("privacyPasswordGuard").and_then(|v| v.as_bool()) {
                s.privacy_password_guard = b;
            }
            if let Some(b) = args.get("expressionHotkeys").and_then(|v| v.as_bool()) {
                s.expression_hotkeys = b;
            }
            if let Some(hk) = args.get("pauseHotkey").and_then(|v| v.as_str()) {
                s.pause_hotkey = crate::config::normalize_pause_hotkey(hk);
            }
            if let Some(gm) = args.get("eyeGazeMode").and_then(|v| v.as_str()) {
                s.eye_gaze_mode = crate::config::normalize_eye_gaze_mode(gm);
            }
            if let Some(cap) = args.get("fpsCap").and_then(|v| v.as_u64()) {
                s.fps_cap = crate::config::normalize_fps_cap(cap as u16);
            }
            if let Some(lang) = args.get("language").and_then(|v| v.as_str()) {
                s.language = crate::config::normalize_language(lang);
            }
            if let Some(b) = args.get("obsEnabled").and_then(|v| v.as_bool()) {
                s.obs_enabled = b;
                if !b {
                    s.obs_hide_pet = false;
                }
            }
            if let Some(port) = args.get("obsPort").and_then(|v| v.as_u64()) {
                if (1024..=65535).contains(&port) {
                    s.obs_port = port as u16;
                }
            }
            if let Some(b) = args.get("obsHidePet").and_then(|v| v.as_bool()) {
                s.obs_hide_pet = s.obs_enabled && b;
            }
            if let Some(b) = args.get("liveCaptureEnabled").and_then(|v| v.as_bool()) {
                s.live_capture_enabled = b;
                if !b {
                    s.live_hide_pet = false;
                }
            }
            if let Some(color) = args.get("liveChromaColor").and_then(|v| v.as_str()) {
                s.live_chroma_color = crate::config::normalize_live_chroma_color(color);
            }
            if let Some(b) = args.get("liveHidePet").and_then(|v| v.as_bool()) {
                s.live_hide_pet = s.live_capture_enabled && b;
            }
            if let Some(b) = args.get("autostart").and_then(|v| v.as_bool()) {
                // Never trigger UAC or alter elevated Task Scheduler autostart from an AI MCP call.
                if !s.autostart_admin && set_windows_autostart(b).is_ok() {
                    s.autostart = b;
                }
            }
            save_settings(&s);
            on_change();
            ok_text(serde_json::to_value(&s).unwrap_or(json!({})))
        }
        "set_agent_status" => {
            let default_src = if args.get("source").and_then(|v| v.as_str()).is_some() {
                None
            } else {
                Some("MCP")
            };
            let Some(ev) = parse_hook_payload(args, default_src, None, None) else {
                return err_text("Invalid 'status'. Expected one of: working, thinking, waiting, done, error, idle.");
            };
            on_agent_event(ev.clone());
            ok_text(json!({
                "status": "dispatched",
                "event": ev
            }))
        }
        "trigger_action" => {
            let default_src = if args.get("source").and_then(|v| v.as_str()).is_some() {
                None
            } else {
                Some("MCP")
            };
            let Some(ev) = parse_hook_payload(args, default_src, None, None) else {
                return err_text("Invalid 'action'. Expected one of: happy, pet, angry, boop, chin, dizzy, curious, sleep, wake, tail_pat.");
            };
            on_agent_event(ev.clone());
            ok_text(json!({
                "status": "dispatched",
                "event": ev
            }))
        }
        _ => err_text(&format!("Unknown tool: {}", name)),
    }
}

pub fn handle_jsonrpc(
    req: &Value,
    on_change: &dyn Fn(),
    on_agent_event: &dyn Fn(AgentCompanionEvent),
) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    // Notifications (no id) must not receive a JSON-RPC response
    if id.is_none() || method.starts_with("notifications/") {
        return None;
    }
    let id = id.unwrap();

    let result = match method {
        "initialize" => {
            let client_ver = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2024-11-05");
            let ver = match client_ver {
                "2025-06-18" | "2025-03-26" | "2024-11-05" => client_ver,
                _ => "2024-11-05",
            };
            Ok(json!({
                "protocolVersion": ver,
                "capabilities": {
                    "tools": { "listChanged": false }
                },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION
                },
                "instructions": "Use get_cat_schema to inspect the custom cat skin format (including faceShape, jawSquareness, earShape, eyeSquint, and spots[]), upsert_cat or patch_cat to customize the live desktop pet in 2D & 3D, and set_agent_status / trigger_action to animate the pet as a real-time AI coding companion."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Ok(execute_tool(tool_name, &args, on_change, on_agent_event))
        }
        _ => Err((-32601, format!("Method not found: {}", method))),
    };

    Some(match result {
        Ok(res) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": res
        }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

/// Transport 1: Zero-dependency native Stdio MCP server (`KuroCat --mcp`)
pub fn run_stdio_mcp() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let noop = || {};
    let forward_agent = |ev: AgentCompanionEvent| {
        let port = load_settings().mcp_port;
        if let Ok(val) = serde_json::to_value(&ev) {
            let _ = post_loopback_json(port, "/agent/event", &val);
        }
    };

    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else {
            break;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let err_resp = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": { "code": -32700, "message": format!("Parse error: {}", e) }
                });
                let _ = writeln!(out, "{}", err_resp);
                let _ = out.flush();
                continue;
            }
        };

        // Respect the user's MCP toggle on tool invocations even over Stdio
        let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
        if method == "tools/call" && !load_settings().mcp_enabled {
            if let Some(id) = parsed.get("id").cloned() {
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": err_text("MCP server is disabled in KuroCat settings. Enable 'MCP 扩展' in KuroCat's menu or tray.")
                });
                let _ = writeln!(out, "{}", resp);
                let _ = out.flush();
            }
            continue;
        }

        if let Some(resp) = handle_jsonrpc(&parsed, &noop, &forward_agent) {
            let _ = writeln!(out, "{}", resp);
            let _ = out.flush();
        }
    }
}

/// Transport 2: Lightweight loopback-only Streamable HTTP MCP + Agent Hook endpoint
/// (`http://127.0.0.1:<port>/mcp`, `/hook`, `/agent/event`, `/health`).
pub fn start_http_mcp_server<F, G>(
    port: u16,
    enabled: Arc<AtomicBool>,
    on_change: F,
    on_agent_event: G,
) where
    F: Fn() + Send + Sync + 'static,
    G: Fn(AgentCompanionEvent) + Send + Sync + 'static,
{
    let on_change = Arc::new(on_change);
    let on_agent_event = Arc::new(on_agent_event);
    std::thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", port);
        let Ok(listener) = TcpListener::bind(&addr) else {
            return;
        };
        for stream_res in listener.incoming() {
            let Ok(stream) = stream_res else {
                continue;
            };
            let flag = enabled.clone();
            let notify = on_change.clone();
            let agent_cb = on_agent_event.clone();
            std::thread::spawn(move || {
                handle_http_conn(stream, &flag, &*notify, &*agent_cb);
            });
        }
    });
}

fn write_http_response_with_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    extra_headers: &str,
    body: &str,
) {
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Accept, Mcp-Session-Id\r\n{}Connection: close\r\n\r\n{}",
        status,
        content_type,
        body.as_bytes().len(),
        extra_headers,
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn write_http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    write_http_response_with_headers(stream, status, content_type, "", body);
}

fn read_chunked_body<R: BufRead>(reader: &mut R, max_bytes: usize) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    loop {
        let mut size_line = String::new();
        if reader.read_line(&mut size_line).map_err(|_| "io")? == 0 {
            return Err("eof");
        }
        let hex_part = size_line.split(';').next().unwrap_or("").trim();
        let chunk_len = usize::from_str_radix(hex_part, 16).map_err(|_| "bad_chunk")?;
        if chunk_len == 0 {
            // Drain trailing CRLF / optional trailer headers
            loop {
                let mut trailer = String::new();
                if reader.read_line(&mut trailer).unwrap_or(0) == 0 || trailer.trim().is_empty() {
                    break;
                }
            }
            return Ok(out);
        }
        if out.len().saturating_add(chunk_len) > max_bytes {
            return Err("too_large");
        }
        let start = out.len();
        out.resize(start + chunk_len, 0);
        reader
            .read_exact(&mut out[start..])
            .map_err(|_| "io")?;
        let mut crlf = [0u8; 2];
        let _ = reader.read_exact(&mut crlf);
    }
}

fn read_http_body<R: BufRead>(
    reader: &mut R,
    content_length: usize,
    is_chunked: bool,
    max_bytes: usize,
) -> Result<Vec<u8>, &'static str> {
    if is_chunked {
        return read_chunked_body(reader, max_bytes);
    }
    if content_length > max_bytes {
        return Err("too_large");
    }
    let mut buf = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut buf).map_err(|_| "io")?;
    }
    Ok(buf)
}

fn handle_http_conn(
    mut stream: TcpStream,
    enabled: &AtomicBool,
    on_change: &dyn Fn(),
    on_agent_event: &dyn Fn(AgentCompanionEvent),
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let raw_target = parts[1];
    let (path, query) = raw_target.split_once('?').unwrap_or((raw_target, ""));

    let mut content_length: usize = 0;
    let mut is_chunked = false;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() {
            return;
        }
        let trimmed = header.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            } else if k.eq_ignore_ascii_case("transfer-encoding")
                && v.to_ascii_lowercase().contains("chunked")
            {
                is_chunked = true;
            }
        }
    }

    if method == "OPTIONS" {
        write_http_response(&mut stream, "204 No Content", "text/plain", "");
        return;
    }

    if !enabled.load(Ordering::Relaxed) {
        write_http_response(
            &mut stream,
            "403 Forbidden",
            "application/json; charset=utf-8",
            r#"{"error":"MCP server is disabled in KuroCat settings"}"#,
        );
        return;
    }

    if method == "GET" && (path == "/health" || path == "/") {
        let body = json!({
            "ok": true,
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
            "mcpEndpoint": "/mcp",
            "hookEndpoint": "/hook",
            "agentEventEndpoint": "/agent/event"
        })
        .to_string();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        return;
    }

    if method == "GET" && path == "/mcp" {
        // MCP Streamable HTTP spec: return 405 when server does not open unsolicited SSE streams
        write_http_response_with_headers(
            &mut stream,
            "405 Method Not Allowed",
            "application/json; charset=utf-8",
            "Allow: POST, DELETE, OPTIONS\r\n",
            r#"{"error":"Use POST /mcp for JSON-RPC requests"}"#,
        );
        return;
    }

    if method == "DELETE" && path == "/mcp" {
        write_http_response(&mut stream, "204 No Content", "text/plain", "");
        return;
    }

    if method == "POST" && (path == "/hook" || path == "/agent/event") {
        let buf = match read_http_body(&mut reader, content_length, is_chunked, 512 * 1024) {
            Ok(b) => b,
            Err("too_large") => {
                write_http_response(
                    &mut stream,
                    "413 Payload Too Large",
                    "application/json",
                    r#"{"error":"Payload too large"}"#,
                );
                return;
            }
            Err(_) => return,
        };
        let parsed: Value = if buf.is_empty() {
            json!({})
        } else {
            match serde_json::from_slice(&buf) {
                Ok(v) => v,
                Err(e) => {
                    let body = json!({ "ok": false, "error": format!("Invalid JSON: {}", e) }).to_string();
                    write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &body);
                    return;
                }
            }
        };

        let mut source_q: Option<String> = None;
        let mut session_q: Option<String> = None;
        let mut event_q: Option<String> = None;
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "source" && !v.is_empty() {
                    source_q = Some(v.to_string());
                } else if k == "session" && !v.is_empty() {
                    session_q = Some(v.to_string());
                } else if (k == "event" || k == "status") && !v.is_empty() {
                    event_q = Some(v.to_string());
                }
            }
        }

        let dispatched = if path == "/agent/event" {
            if let Ok(mut ev) = serde_json::from_value::<AgentCompanionEvent>(parsed.clone()) {
                if ev.ts == 0 {
                    ev.ts = now_epoch_ms();
                }
                if ev.session.is_none() {
                    ev.session = session_q.clone();
                }
                on_agent_event(ev.clone());
                Some(ev)
            } else {
                parse_hook_payload_with_session(
                    &parsed,
                    source_q.as_deref(),
                    session_q.as_deref(),
                    event_q.as_deref(),
                    None,
                )
                .map(|ev| {
                    on_agent_event(ev.clone());
                    ev
                })
            }
        } else {
            parse_hook_payload_with_session(
                &parsed,
                source_q.as_deref(),
                session_q.as_deref(),
                event_q.as_deref(),
                None,
            )
            .map(|ev| {
                on_agent_event(ev.clone());
                ev
            })
        };

        let body = json!({
            "ok": true,
            "dispatched": dispatched.is_some(),
            "event": dispatched
        })
        .to_string();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        return;
    }

    if method == "POST" && (path == "/mcp" || path == "/") {
        let buf = match read_http_body(&mut reader, content_length, is_chunked, 2 * 1024 * 1024) {
            Ok(b) => b,
            Err("too_large") => {
                write_http_response(
                    &mut stream,
                    "413 Payload Too Large",
                    "application/json",
                    r#"{"error":"Payload too large"}"#,
                );
                return;
            }
            Err(_) => return,
        };
        let parsed: Value = match serde_json::from_slice(&buf) {
            Ok(v) => v,
            Err(e) => {
                let err = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": { "code": -32700, "message": format!("Parse error: {}", e) }
                })
                .to_string();
                write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &err);
                return;
            }
        };

        if let Some(arr) = parsed.as_array() {
            let mut responses = Vec::new();
            for item in arr {
                if let Some(resp) = handle_jsonrpc(item, on_change, on_agent_event) {
                    responses.push(resp);
                }
            }
            if responses.is_empty() {
                write_http_response(&mut stream, "202 Accepted", "application/json", "");
            } else {
                let body = serde_json::to_string(&responses).unwrap_or_else(|_| "[]".to_string());
                write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
            }
        } else if let Some(resp) = handle_jsonrpc(&parsed, on_change, on_agent_event) {
            let body = resp.to_string();
            write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        } else {
            write_http_response(&mut stream, "202 Accepted", "application/json", "");
        }
        return;
    }

    write_http_response(
        &mut stream,
        "404 Not Found",
        "application/json; charset=utf-8",
        r#"{"error":"Not found. Use POST /mcp, POST /hook, POST /agent/event, or GET /health"}"#,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_antigravity_lifecycle_hooks() {
        let pre_inv = json!({
            "hookEventName": "PreInvocation",
            "transcriptPath": "C:/Users/me/.gemini/antigravity/transcript.jsonl"
        });
        let ev = parse_hook_payload(&pre_inv, None, None, None).unwrap();
        assert_eq!(ev.source.as_deref(), Some("Antigravity"));
        assert_eq!(ev.status.as_deref(), Some("working"));
        assert_eq!(ev.auto_type, Some(true));

        let post_edit = json!({
            "hookEventName": "PostToolUse",
            "toolCall": { "name": "edit_file" },
            "error": ""
        });
        let ev2 = parse_hook_payload(&post_edit, None, None, None).unwrap();
        assert_eq!(ev2.status.as_deref(), Some("working"));
        assert_eq!(ev2.text.as_deref(), Some("写代码中…"));

        let post_err = json!({
            "hookEventName": "PostToolUse",
            "toolCall": { "name": "run_command" },
            "error": "exit status 1"
        });
        let ev3 = parse_hook_payload(&post_err, None, None, None).unwrap();
        assert_eq!(ev3.status.as_deref(), Some("error"));

        let stop_ok = json!({
            "hookEventName": "Stop",
            "terminationReason": "NO_TOOL_CALL",
            "fullyIdle": true
        });
        let ev4 = parse_hook_payload(&stop_ok, None, None, None).unwrap();
        assert_eq!(ev4.status.as_deref(), Some("done"));
        assert_eq!(ev4.sound, Some(true));

        let stop_cancel = json!({
            "hookEventName": "Stop",
            "terminationReason": "USER_CANCELED"
        });
        let ev5 = parse_hook_payload(&stop_cancel, None, None, None).unwrap();
        assert_eq!(ev5.status.as_deref(), Some("idle"));
    }

    #[test]
    fn parses_claude_workbuddy_and_codex_hooks() {
        let wb_perm = json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "transcript_path": "/home/u/.workbuddy/session.jsonl"
        });
        let ev = parse_hook_payload(&wb_perm, None, None, None).unwrap();
        assert_eq!(ev.source.as_deref(), Some("WorkBuddy"));
        assert_eq!(ev.status.as_deref(), Some("waiting"));
        assert_eq!(ev.auto_type, Some(false));

        let codex_notify = json!({
            "type": "agent-turn-complete",
            "thread-id": "t1"
        });
        let ev2 = parse_hook_payload(&codex_notify, None, None, None).unwrap();
        assert_eq!(ev2.source.as_deref(), Some("Codex"));
        assert_eq!(ev2.session.as_deref(), Some("t1"));
        assert_eq!(ev2.status.as_deref(), Some("done"));

        // Codex approval-requested & interrupt (#128)
        let codex_wait = json!({
            "type": "approval-requested",
            "thread-id": "t2"
        });
        let ev_wait = parse_hook_payload(&codex_wait, None, None, None).unwrap();
        assert_eq!(ev_wait.source.as_deref(), Some("Codex"));
        assert_eq!(ev_wait.status.as_deref(), Some("waiting"));

        let codex_int = json!({
            "hook_event_name": "Interrupt",
            "session_id": "s-int"
        });
        let ev_int = parse_hook_payload(&codex_int, Some("Codex"), None, None).unwrap();
        assert_eq!(ev_int.status.as_deref(), Some("idle"));
        assert_eq!(ev_int.session.as_deref(), Some("s-int"));

        // Auto-approved PermissionRequest must not emit false waiting alert (#128)
        let auto_perm = json!({
            "hook_event_name": "PermissionRequest",
            "permission_mode": "bypassPermissions",
            "tool_name": "Bash"
        });
        assert!(parse_hook_payload(&auto_perm, Some("Codex"), None, None).is_none());

        // Generic Notification without approval type should not fake "waiting" (#128)
        let generic_notif = json!({
            "hook_event_name": "Notification",
            "notification_type": "info",
            "message": "背景索引完成"
        });
        let ev_info = parse_hook_payload(&generic_notif, Some("Claude"), None, None).unwrap();
        assert_eq!(ev_info.kind, "bubble");
        assert_eq!(ev_info.sound, Some(false));

        let idle_notif = json!({
            "hook_event_name": "Notification",
            "notification_type": "idle_prompt"
        });
        let ev_idle = parse_hook_payload(&idle_notif, Some("Claude"), None, None).unwrap();
        assert_eq!(ev_idle.status.as_deref(), Some("idle"));

        // Native DeepSeek Harness (dsh) session events
        let dsh_start = json!({
            "type": "turn/start",
            "session": "dsh:abc123",
            "source": "DeepSeek"
        });
        let ev_dsh_start = parse_hook_payload(&dsh_start, None, None, None).unwrap();
        assert_eq!(ev_dsh_start.status.as_deref(), Some("thinking"));
        assert_eq!(ev_dsh_start.session.as_deref(), Some("dsh:abc123"));

        let dsh_tool = json!({
            "type": "tool/call",
            "data": { "name": "edit_file" },
            "session": "dsh:abc123",
            "source": "DeepSeek"
        });
        let ev_dsh_tool = parse_hook_payload(&dsh_tool, None, None, None).unwrap();
        assert_eq!(ev_dsh_tool.status.as_deref(), Some("working"));
        assert_eq!(ev_dsh_tool.text.as_deref(), Some("写代码中…"));

        let dsh_end = json!({
            "type": "turn/end",
            "data": { "reason": { "kind": "completed" } },
            "session": "dsh:abc123",
            "source": "DeepSeek"
        });
        let ev_dsh_end = parse_hook_payload(&dsh_end, None, None, None).unwrap();
        assert_eq!(ev_dsh_end.status.as_deref(), Some("done"));

        // Verify native DSH Cordis bridge plugin + `.tgz` package materialize cleanly
        let plugin_dir = ensure_dsh_bridge_plugin(27420).expect("dsh-plugin should materialize");
        assert!(plugin_dir.join("package.json").is_file());
        assert!(plugin_dir.join("cordis.patch.yml").is_file());
        let tgz = std::fs::read(plugin_dir.join("dsh-kurocat.tgz")).expect("dsh-kurocat.tgz readable");
        assert!(tgz.len() > 2048 && tgz[0] == 0x1f && tgz[1] == 0x8b);
        let idx = std::fs::read_to_string(plugin_dir.join("index.js")).expect("index.js readable");
        assert!(idx.contains("session/event"));
        assert!(idx.contains("todo/write"));
        assert!(idx.contains("approval/asked"));
        assert!(idx.contains("turn/end"));

        // Cursor native hooks (`beforeSubmitPrompt`, `stop` with `status: aborted|completed|error`)
        let cur_abort = json!({
            "hook_event_name": "stop",
            "status": "aborted",
            "conversation_id": "cur-1"
        });
        let ev_cur_abort = parse_hook_payload(&cur_abort, Some("Cursor"), None, None).unwrap();
        assert_eq!(ev_cur_abort.source.as_deref(), Some("Cursor"));
        assert_eq!(ev_cur_abort.status.as_deref(), Some("idle"));

        // Windsurf native Cascade Hooks (`agent_action_name` + `trajectory_id`)
        let ws_write = json!({
            "agent_action_name": "pre_write_code",
            "trajectory_id": "traj-42"
        });
        let ev_ws_write = parse_hook_payload(&ws_write, None, None, None).unwrap();
        assert_eq!(ev_ws_write.source.as_deref(), Some("Windsurf"));
        assert_eq!(ev_ws_write.session.as_deref(), Some("traj-42"));
        assert_eq!(ev_ws_write.status.as_deref(), Some("working"));
        assert_eq!(ev_ws_write.text.as_deref(), Some("写代码中…"));

        let ws_done = json!({
            "agent_action_name": "post_cascade_response",
            "trajectory_id": "traj-42"
        });
        let ev_ws_done = parse_hook_payload(&ws_done, None, None, None).unwrap();
        assert_eq!(ev_ws_done.status.as_deref(), Some("done"));

        // Gemini CLI native hooks (`BeforeAgent`, `BeforeTool`, `AfterTool`, `AfterAgent`)
        let gem_before = json!({
            "hook_event_name": "BeforeAgent",
            "session_id": "gem-1"
        });
        let ev_gem_before = parse_hook_payload(&gem_before, Some("Gemini"), None, None).unwrap();
        assert_eq!(ev_gem_before.source.as_deref(), Some("Gemini"));
        assert_eq!(ev_gem_before.status.as_deref(), Some("working"));

        let gem_tool = json!({
            "hook_event_name": "BeforeTool",
            "tool_name": "write_file",
            "session_id": "gem-1"
        });
        let ev_gem_tool = parse_hook_payload(&gem_tool, Some("Gemini"), None, None).unwrap();
        assert_eq!(ev_gem_tool.status.as_deref(), Some("working"));
        assert_eq!(ev_gem_tool.text.as_deref(), Some("写代码中…"));

        let gem_after = json!({
            "hook_event_name": "AfterAgent",
            "session_id": "gem-1"
        });
        let ev_gem_after = parse_hook_payload(&gem_after, Some("Gemini"), None, None).unwrap();
        assert_eq!(ev_gem_after.status.as_deref(), Some("done"));

        // VS Code / GitHub Copilot (`ErrorOccurred`, `AgentStop`)
        let cop_err = json!({
            "hook_event_name": "ErrorOccurred",
            "session_id": "cop-1"
        });
        let ev_cop_err = parse_hook_payload(&cop_err, Some("Copilot"), None, None).unwrap();
        assert_eq!(ev_cop_err.status.as_deref(), Some("error"));

        let cop_stop = json!({
            "hook_event_name": "AgentStop",
            "session_id": "cop-1"
        });
        let ev_cop_stop = parse_hook_payload(&cop_stop, Some("Copilot"), None, None).unwrap();
        assert_eq!(ev_cop_stop.status.as_deref(), Some("done"));

        // OpenCode native bridge plugin materialization
        let oc_file = ensure_opencode_bridge_plugin(27420).expect("opencode plugin should materialize");
        let oc_js = std::fs::read_to_string(&oc_file).expect("kurocat.js readable");
        assert!(oc_js.contains("tool.execute.before"));
        assert!(oc_js.contains("session.idle"));
        assert!(oc_js.contains("permission.asked"));
    }

    #[test]
    fn decodes_http_chunked_body() {
        let wire = b"7\r\n{\"ok\": \r\n5\r\ntrue}\r\n0\r\n\r\n";
        let mut cursor = BufReader::new(&wire[..]);
        let body = read_chunked_body(&mut cursor, 1024).unwrap();
        assert_eq!(std::str::from_utf8(&body).unwrap(), "{\"ok\": true}");
    }

    #[test]
    fn update_settings_schema_includes_live_capture_fields() {
        let tools = tool_definitions();
        let arr = tools.as_array().expect("tool_definitions should be array");
        let update = arr
            .iter()
            .find(|t| t.get("name").and_then(|n| n.as_str()) == Some("update_settings"))
            .expect("update_settings tool missing");
        let props = update
            .get("inputSchema")
            .and_then(|s| s.get("properties"))
            .expect("properties missing");
        assert_eq!(
            props
                .get("liveCaptureEnabled")
                .and_then(|p| p.get("type"))
                .and_then(|t| t.as_str()),
            Some("boolean")
        );
        assert_eq!(
            props
                .get("liveHidePet")
                .and_then(|p| p.get("type"))
                .and_then(|t| t.as_str()),
            Some("boolean")
        );
        assert_eq!(
            props
                .get("opacity")
                .and_then(|p| p.get("type"))
                .and_then(|t| t.as_str()),
            Some("number")
        );
        let chroma_enum: Vec<&str> = props
            .get("liveChromaColor")
            .and_then(|p| p.get("enum"))
            .and_then(|e| e.as_array())
            .expect("liveChromaColor enum missing")
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert_eq!(chroma_enum, vec!["blue", "green", "magenta"]);
    }

    #[test]
    fn cat_mcp_tools_work_without_dog_extensions() {
        let tools = tool_definitions();
        let arr = tools.as_array().expect("tool_definitions should be array");
        let names: Vec<&str> = arr
            .iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        for expected in [
            "list_cats",
            "get_cat_schema",
            "upsert_cat",
            "patch_cat",
            "switch_cat",
            "delete_cat",
            "get_settings",
            "update_settings",
            "set_agent_status",
            "trigger_action",
        ] {
            assert!(names.contains(&expected), "missing MCP tool: {expected}");
        }
        assert!(!names.contains(&"upsert_pet"));

        let noop = || {};
        let noop_ev = |_ev: AgentCompanionEvent| {};
        let req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "list_cats", "arguments": {} }
        });
        let resp = handle_jsonrpc(&req, &noop, &noop_ev).expect("response expected");
        assert_eq!(resp["result"]["isError"], json!(false));
        let payload: Value =
            serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap())
                .expect("valid JSON output");
        let cats = payload["cats"].as_array().expect("cats array");
        assert!(!cats.iter().any(|c| c["id"] == "shiba-inu" || c["id"] == "golden-retriever"));
    }
}
