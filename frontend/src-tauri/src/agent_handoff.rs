use crate::database::repositories::{
    meeting::MeetingsRepository, summary::SummaryProcessesRepository,
};
use crate::diarization;
use crate::feishu::{
    self, build_augmented_path, expand_home_path, sanitize_relative_stem, FeishuDeliveryResult,
};
use crate::state::AppState;
use chrono::{FixedOffset, Utc};
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

const AGENT_STORE_FILE: &str = "agent_handoff_config.json";
const AGENT_STORE_KEY: &str = "config";
const SKILL_NAME: &str = "aigoodmeeting-agent-handoff";
const MAX_STORED_LOG_LINES: usize = 80;

static ACTIVE_RUNS: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentHandoffConfig {
    #[serde(default = "default_agent_id")]
    pub default_agent: String,
    #[serde(default = "default_workspace_dir")]
    pub workspace_dir: String,
    #[serde(default = "default_true")]
    pub auto_execute_when_ready: bool,
    #[serde(default = "default_feishu_delivery_mode")]
    pub feishu_delivery_mode: String,
    #[serde(default)]
    pub feishu_chat_id: String,
    #[serde(default)]
    pub feishu_chat_name: String,
    #[serde(default)]
    pub custom_cli_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub model_overrides: BTreeMap<String, String>,
}

fn default_agent_id() -> String {
    "codex".to_string()
}

fn default_true() -> bool {
    true
}

fn default_feishu_delivery_mode() -> String {
    "doc_and_group".to_string()
}

fn default_workspace_dir() -> String {
    if let Some(home) = dirs::home_dir() {
        let agent_hub = home.join("Documents/AgentHub");
        if agent_hub.is_dir() {
            return agent_hub.to_string_lossy().to_string();
        }
        let docs = home.join("Documents");
        if docs.is_dir() {
            return docs.to_string_lossy().to_string();
        }
        return home.to_string_lossy().to_string();
    }
    ".".to_string()
}

impl Default for AgentHandoffConfig {
    fn default() -> Self {
        Self {
            default_agent: default_agent_id(),
            workspace_dir: default_workspace_dir(),
            auto_execute_when_ready: true,
            feishu_delivery_mode: default_feishu_delivery_mode(),
            feishu_chat_id: String::new(),
            feishu_chat_name: String::new(),
            custom_cli_paths: BTreeMap::new(),
            model_overrides: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationInfo {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub installed: bool,
    pub executable: bool,
    pub cli_path: Option<String>,
    pub app_path: Option<String>,
    pub version: Option<String>,
    pub skill_linked: bool,
    pub status_label: String,
    pub hint: String,
    pub install_command: Option<String>,
    pub login_command: Option<String>,
    pub docs_url: Option<String>,
    pub beginner_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorrectedTerm {
    #[serde(default)]
    pub heard: String,
    #[serde(default)]
    pub normalized: String,
    #[serde(default)]
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationQuestion {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub suggested_options: Vec<String>,
    #[serde(default)]
    pub default_option: String,
    #[serde(default = "default_true")]
    pub allow_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    pub status: String,
    #[serde(default)]
    pub understood_goal: String,
    #[serde(default)]
    pub corrected_terms: Vec<CorrectedTerm>,
    #[serde(default)]
    pub planned_deliverables: Vec<String>,
    #[serde(default)]
    pub suggested_feishu_title: String,
    #[serde(default)]
    pub missing_info_summary: String,
    #[serde(default)]
    pub questions: Vec<ClarificationQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub feishu_title: String,
    #[serde(default)]
    pub feishu_message_summary: String,
    #[serde(default)]
    pub deliverable_markdown_path: String,
    #[serde(default)]
    pub artifact_paths: Vec<String>,
    #[serde(default)]
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationAnswer {
    pub question_id: String,
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub run_id: String,
    pub meeting_id: String,
    pub meeting_title: String,
    pub agent_id: String,
    pub agent_name: String,
    #[serde(default)]
    pub collaborator_agent_ids: Vec<String>,
    #[serde(default)]
    pub collaborator_agent_names: Vec<String>,
    pub workspace_dir: String,
    pub user_instruction: String,
    pub feishu_delivery_mode: String,
    pub feishu_chat_id: String,
    pub feishu_chat_name: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub run_dir: String,
    pub context_path: String,
    pub preflight: Option<PreflightResult>,
    pub answers: Vec<ClarificationAnswer>,
    pub execute_result: Option<ExecuteResult>,
    pub deliverable_preview: Option<String>,
    pub feishu_delivery: Option<FeishuDeliveryResult>,
    pub error: Option<String>,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressEvent {
    pub run_id: String,
    pub meeting_id: String,
    pub stage: String,
    pub message: String,
    pub log_line: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPreflightRequest {
    pub meeting_id: String,
    pub agent_id: Option<String>,
    #[serde(default)]
    pub collaborator_agent_ids: Vec<String>,
    pub user_instruction: Option<String>,
    pub workspace_dir: Option<String>,
    pub feishu_delivery_mode: Option<String>,
    pub feishu_chat_id: Option<String>,
    pub feishu_chat_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteRunRequest {
    pub run_id: String,
    pub meeting_id: String,
    pub answers: Vec<ClarificationAnswer>,
    pub collaborator_agent_ids: Option<Vec<String>>,
    pub feishu_delivery_mode: Option<String>,
    pub feishu_chat_id: Option<String>,
    pub feishu_chat_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualHandoffResponse {
    pub run_dir: String,
    pub context_path: String,
    pub prompt_text: String,
    pub launched_app: bool,
    pub message: String,
}

struct AgentSpec {
    id: &'static str,
    name: &'static str,
    short_name: &'static str,
    cli_names: &'static [&'static str],
    app_paths: &'static [&'static str],
    skill_rel_dir: &'static str,
    version_args: &'static [&'static str],
    hint: &'static str,
    install_command: Option<&'static str>,
    login_command: Option<&'static str>,
    docs_url: Option<&'static str>,
    beginner_note: &'static str,
}

const AGENT_SPECS: &[AgentSpec] = &[
    AgentSpec {
        id: "codex",
        name: "Codex",
        short_name: "Codex",
        cli_names: &["codex"],
        app_paths: &["/Applications/ChatGPT.app"],
        skill_rel_dir: ".codex/skills",
        version_args: &["--version"],
        hint: "支持 codex exec 非交互式读写工作区并落盘",
        install_command: Some("npm install -g @openai/codex"),
        login_command: Some("codex login"),
        docs_url: Some("https://openai.com/codex"),
        beginner_note: "点「一键安装」后登录 OpenAI 账号即可直连执行。",
    },
    AgentSpec {
        id: "agy",
        name: "Antigravity（反重力）",
        short_name: "反重力",
        cli_names: &["agy"],
        app_paths: &["/Applications/Antigravity.app"],
        skill_rel_dir: ".gemini/config/skills",
        version_args: &["--version"],
        hint: "支持 agy -p 联动当前 Antigravity 模型与工具",
        install_command: Some("agy install"),
        login_command: None,
        docs_url: Some("https://antigravity.google"),
        beginner_note: "先安装 Antigravity 客户端并在客户端登录 Google 账号，再点「安装命令行工具」即可直连。",
    },
    AgentSpec {
        id: "dsh",
        name: "DeepSeek Harness (DSH)",
        short_name: "DSH",
        cli_names: &["dsh"],
        app_paths: &["/Applications/DeepSeek Harness.app"],
        skill_rel_dir: ".dsh/skills",
        version_args: &["--version"],
        hint: "支持 dsh --profile headless 直接执行任务",
        install_command: Some("npm install -g @deepseek-ai/dsh"),
        login_command: None,
        docs_url: Some("https://www.deepseek.com"),
        beginner_note: "一键安装 DSH 后，在 DSH 里配置好模型凭证即可参与执行或协同。",
    },
    AgentSpec {
        id: "claude",
        name: "Claude Code",
        short_name: "Claude",
        cli_names: &["claude"],
        app_paths: &["/Applications/Claude.app"],
        skill_rel_dir: ".claude/skills",
        version_args: &["--version"],
        hint: "支持 claude -p 长文档分析与项目执行",
        install_command: Some("npm install -g @anthropic-ai/claude-code"),
        login_command: Some("claude"),
        docs_url: Some("https://docs.anthropic.com/en/docs/claude-code"),
        beginner_note: "一键安装后运行一次 claude 完成浏览器登录即可直连。",
    },
    AgentSpec {
        id: "workbuddy",
        name: "WorkBuddy / CodeBuddy",
        short_name: "WorkBuddy",
        cli_names: &["codebuddy", "codebuddy-code", "cbc"],
        app_paths: &["/Applications/WorkBuddy.app"],
        skill_rel_dir: ".workbuddy/skills",
        version_args: &["--version"],
        hint: "检测 WorkBuddy 桌面端与 CodeBuddy CLI；有 CLI 可直连执行，无 CLI 可一键打包交接",
        install_command: Some("npm install -g @tencent-ai/codebuddy-code"),
        login_command: Some("codebuddy"),
        docs_url: Some("https://copilot.tencent.com"),
        beginner_note: "安装 CodeBuddy 命令行组件后即可免手动直连；若只装了 WorkBuddy 桌面端，也会自动打包并打开。",
    },
    AgentSpec {
        id: "kimi",
        name: "Kimi Code",
        short_name: "Kimi",
        cli_names: &["kimi"],
        app_paths: &["/Applications/Kimi Code.app", "/Applications/Kimi.app"],
        skill_rel_dir: ".kimi-code/skills",
        version_args: &["--version"],
        hint: "支持 kimi -p --auto 非交互执行",
        install_command: Some("npm install -g @moonshot-ai/kimi-code"),
        login_command: Some("kimi"),
        docs_url: Some("https://www.kimi.com"),
        beginner_note: "一键安装后在终端运行一次 kimi 扫码/登录即可使用。",
    },
    AgentSpec {
        id: "gemini",
        name: "Gemini CLI",
        short_name: "Gemini",
        cli_names: &["gemini"],
        app_paths: &["/Applications/Gemini.app"],
        skill_rel_dir: ".gemini/skills",
        version_args: &["--version"],
        hint: "支持 gemini -p 非交互执行",
        install_command: Some("npm install -g @google/gemini-cli"),
        login_command: Some("gemini"),
        docs_url: Some("https://github.com/google-gemini/gemini-cli"),
        beginner_note: "一键安装后运行一次 gemini 登录 Google 账号即可使用。",
    },
    AgentSpec {
        id: "hermes",
        name: "Hermes",
        short_name: "Hermes",
        cli_names: &["hermes"],
        app_paths: &["/Applications/Hermes.app"],
        skill_rel_dir: ".hermes/skills",
        version_args: &["--version"],
        hint: "支持 hermes -z 非交互执行",
        install_command: None,
        login_command: Some("hermes login"),
        docs_url: None,
        beginner_note: "安装本机 Hermes 后登录账号，点「重新检测」即可接入。",
    },
    AgentSpec {
        id: "opencode",
        name: "OpenCode",
        short_name: "OpenCode",
        cli_names: &["opencode"],
        app_paths: &["/Applications/OpenCode.app"],
        skill_rel_dir: ".config/opencode/skills",
        version_args: &["--version"],
        hint: "支持 opencode run 非交互执行",
        install_command: Some("npm install -g opencode-ai"),
        login_command: Some("opencode auth"),
        docs_url: Some("https://opencode.ai"),
        beginner_note: "一键安装后运行 opencode auth 绑定模型即可使用。",
    },
];

fn find_agent_spec(agent_id: &str) -> Option<&'static AgentSpec> {
    let key = agent_id.trim().to_ascii_lowercase();
    AGENT_SPECS.iter().find(|s| s.id == key)
}

fn resolve_cli_for_spec(spec: &AgentSpec, custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = custom_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = expand_home_path(raw);
        if p.is_file() {
            return Some(p);
        }
    }

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        search_dirs.push(home.join(".local/bin"));
        search_dirs.push(home.join(".cargo/bin"));
        search_dirs.push(home.join(".grok/bin"));
    }
    search_dirs.push(PathBuf::from("/opt/homebrew/bin"));
    search_dirs.push(PathBuf::from("/usr/local/bin"));

    for name in spec.cli_names {
        for dir in &search_dirs {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        if let Ok(found) = which::which(name) {
            return Some(found);
        }
    }
    None
}

fn resolve_app_for_spec(spec: &AgentSpec) -> Option<PathBuf> {
    for raw in spec.app_paths {
        let p = PathBuf::from(raw);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn check_skill_linked(spec: &AgentSpec) -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    let skill_dir = home.join(spec.skill_rel_dir).join(SKILL_NAME);
    skill_dir.join("SKILL.md").is_file()
}

fn resolve_shared_skill_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join("Documents/AgentHub/shared/skills")
            .join(SKILL_NAME)
            .join("SKILL.md"),
        home.join(".codex/skills").join(SKILL_NAME).join("SKILL.md"),
        home.join(".gemini/config/skills")
            .join(SKILL_NAME)
            .join("SKILL.md"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

async fn probe_cli_version(binary: &Path, args: &[&str]) -> Option<String> {
    let out = tokio::time::timeout(
        Duration::from_secs(4),
        Command::new(binary)
            .args(args)
            .env("PATH", build_augmented_path())
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string);
    if first.is_some() {
        return first;
    }
    let err_text = String::from_utf8_lossy(&out.stderr);
    err_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

async fn detect_single_agent(
    spec: &'static AgentSpec,
    custom_path: Option<String>,
) -> AgentInstallationInfo {
    let cli_path = resolve_cli_for_spec(spec, custom_path.as_deref());
    let app_path = resolve_app_for_spec(spec);
    let skill_linked = check_skill_linked(spec);
    let version = if let Some(ref bin) = cli_path {
        probe_cli_version(bin, spec.version_args).await
    } else {
        None
    };

    let executable = cli_path.is_some();
    let installed = executable || app_path.is_some();
    let status_label = match (executable, app_path.is_some()) {
        (true, true) => "桌面端 + CLI 已就绪".to_string(),
        (true, false) => "CLI 已就绪".to_string(),
        (false, true) => "仅桌面端（支持打包交接）".to_string(),
        (false, false) => "未安装".to_string(),
    };

    AgentInstallationInfo {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        short_name: spec.short_name.to_string(),
        installed,
        executable,
        cli_path: cli_path.map(|p| p.to_string_lossy().to_string()),
        app_path: app_path.map(|p| p.to_string_lossy().to_string()),
        version,
        skill_linked,
        status_label,
        hint: spec.hint.to_string(),
        install_command: spec.install_command.map(str::to_string),
        login_command: spec.login_command.map(str::to_string),
        docs_url: spec.docs_url.map(str::to_string),
        beginner_note: spec.beginner_note.to_string(),
    }
}

pub fn build_terminal_applescript(command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("要执行的命令不能为空".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("只支持单行安全安装或登录命令".to_string());
    }
    let escaped = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
    Ok(format!(
        "tell application \"Terminal\"\n    activate\n    do script \"{}\"\nend tell",
        escaped
    ))
}

#[tauri::command]
pub async fn run_command_in_terminal(command: String) -> Result<String, String> {
    let script = build_terminal_applescript(&command)?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .await
            .map_err(|e| format!("打开终端失败：{}", e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if err.is_empty() {
                "无法拉起终端窗口，请先复制命令手动粘贴运行。".to_string()
            } else {
                format!("打开终端失败：{}", err)
            });
        }
        Ok("已在终端窗口中启动命令，完成后回到这里点「重新检测」即可。".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = script;
        Err("当前系统暂不支持自动打开终端，请点击「复制命令」后粘贴到命令行运行。".to_string())
    }
}

pub fn load_agent_config<R: Runtime>(app: &AppHandle<R>) -> AgentHandoffConfig {
    let Ok(store) = app.store(AGENT_STORE_FILE) else {
        warn!("Failed to open agent_handoff_config.json store, using defaults");
        return AgentHandoffConfig::default();
    };
    store
        .get(AGENT_STORE_KEY)
        .and_then(|v| serde_json::from_value::<AgentHandoffConfig>(v).ok())
        .unwrap_or_default()
}

pub fn persist_agent_config<R: Runtime>(
    app: &AppHandle<R>,
    config: &AgentHandoffConfig,
) -> Result<(), String> {
    let store = app
        .store(AGENT_STORE_FILE)
        .map_err(|e| format!("无法打开 Agent 联动配置存储：{}", e))?;
    let serialized = serde_json::to_value(config)
        .map_err(|e| format!("无法序列化 Agent 联动配置：{}", e))?;
    store.set(AGENT_STORE_KEY, serialized);
    store
        .save()
        .map_err(|e| format!("保存 Agent 联动配置失败：{}", e))?;
    Ok(())
}

fn agent_runs_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{}", e))?;
    let root = data_dir.join("agent-runs");
    std::fs::create_dir_all(&root).map_err(|e| format!("创建 Agent 运行目录失败：{}", e))?;
    Ok(root)
}

fn run_dir_for<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    let safe_meeting = sanitize_relative_stem(meeting_id);
    let safe_run = sanitize_relative_stem(run_id);
    Ok(agent_runs_root(app)?.join(safe_meeting).join(safe_run))
}

fn save_run_record(run: &AgentRunRecord) -> Result<(), String> {
    let path = PathBuf::from(&run.run_dir).join("run-state.json");
    let json = serde_json::to_string_pretty(run)
        .map_err(|e| format!("序列化任务状态失败：{}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("写入任务状态失败：{}", e))?;
    Ok(())
}

fn load_run_record<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    run_id: &str,
) -> Result<AgentRunRecord, String> {
    let dir = run_dir_for(app, meeting_id, run_id)?;
    let path = dir.join("run-state.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取历史任务失败（{}）：{}", path.display(), e))?;
    serde_json::from_str::<AgentRunRecord>(&raw)
        .map_err(|e| format!("解析历史任务记录失败：{}", e))
}

fn format_beijing_time(raw: &str) -> String {
    let cleaned = raw.trim().replace('Z', "+00:00");
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&cleaned) {
        if let Some(tz) = FixedOffset::east_opt(8 * 3600) {
            return dt
                .with_timezone(&tz)
                .format("%Y-%m-%d %H:%M (UTC+8)")
                .to_string();
        }
    }
    raw.to_string()
}

fn format_mmss(secs: Option<f64>) -> String {
    let Some(s) = secs else {
        return String::new();
    };
    let total = s.max(0.0).round() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let sec = total % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{:02}:{:02}", m, sec)
    }
}

fn extract_summary_markdown(raw_result: Option<&str>) -> String {
    let Some(raw) = raw_result.map(str::trim).filter(|s| !s.is_empty()) else {
        return String::new();
    };
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(md) = val.get("markdown").and_then(|v| v.as_str()) {
            if !md.trim().is_empty() {
                return md.trim().to_string();
            }
        }
        if let Some(md) = val
            .get("english_cache")
            .and_then(|e| e.get("markdown"))
            .and_then(|v| v.as_str())
        {
            if !md.trim().is_empty() {
                return md.trim().to_string();
            }
        }
    }
    raw.to_string()
}

async fn build_meeting_context_markdown<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
) -> Result<(String, String), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "应用数据库尚未初始化".to_string())?;
    let pool = state.db_manager.pool();

    let meeting = MeetingsRepository::get_meeting(pool, meeting_id)
        .await
        .map_err(|e| format!("读取会议详情失败：{}", e))?
        .ok_or_else(|| format!("未找到会议：{}", meeting_id))?;

    let metadata = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .ok()
        .flatten();
    let folder_path = metadata
        .and_then(|m| m.folder_path)
        .unwrap_or_else(|| "无".to_string());

    let summary_proc = SummaryProcessesRepository::get_summary_data(pool, meeting_id)
        .await
        .ok()
        .flatten();
    let summary_md = extract_summary_markdown(
        summary_proc
            .as_ref()
            .and_then(|sp| sp.result.as_deref()),
    );

    let speaker_transcript =
        diarization::get_speaker_transcript(app.clone(), state, meeting_id.to_string())
            .await
            .ok()
            .flatten();

    let mut transcript_lines: Vec<String> = Vec::new();
    let transcript_source: &str;

    if let Some(st) = speaker_transcript.filter(|s| !s.segments.is_empty()) {
        for seg in &st.segments {
            let text = seg.text.trim();
            if text.is_empty() {
                continue;
            }
            let speaker_label = st
                .names
                .get(&seg.speaker)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or(&seg.speaker);
            let ts = format_mmss(Some(seg.start));
            transcript_lines.push(format!("[{}] {}: {}", ts, speaker_label, text));
        }
        transcript_source = "说话人分人稿（diarization）";
    } else {
        for (idx, seg) in meeting.transcripts.iter().enumerate() {
            let text = seg.text.trim();
            if text.is_empty() {
                continue;
            }
            let ts = format_mmss(seg.audio_start_time);
            let tag = if ts.is_empty() {
                format!("#{:03}", idx + 1)
            } else {
                ts
            };
            transcript_lines.push(format!("[{}] {}", tag, text));
        }
        transcript_source = "原始转写（SQLite transcripts）";
    }

    if transcript_lines.is_empty() && summary_md.is_empty() {
        return Err("这场会议既没有转写内容也没有纪要，无法交给 Agent 处理。".to_string());
    }

    let mut parts = vec![
        format!("# 会议上下文：{}", meeting.title),
        String::new(),
        "## 基本信息".to_string(),
        format!("- **会议 ID**：`{}`", meeting.id),
        format!("- **记录时间**：{}", format_beijing_time(&meeting.created_at)),
        format!("- **录音目录**：`{}`", folder_path),
        format!(
            "- **转写来源**：{}（共 {} 段）",
            transcript_source,
            transcript_lines.len()
        ),
        String::new(),
    ];

    if !summary_md.is_empty() {
        parts.push(
            "## 本地纪要草稿（仅供参考，日期/人名/专有名词必须以下方完整原始转写为准）".to_string(),
        );
        parts.push(String::new());
        parts.push(summary_md);
        parts.push(String::new());
    }

    parts.push("## 完整转写原文".to_string());
    parts.push(String::new());
    parts.push(if transcript_lines.is_empty() {
        "（无转写内容）".to_string()
    } else {
        transcript_lines.join("\n")
    });
    parts.push(String::new());

    Ok((meeting.title, parts.join("\n")))
}

fn build_preflight_prompt(
    context_path: &Path,
    result_path: &Path,
    workspace_dir: &Path,
    user_instruction: &str,
    skill_path: Option<&Path>,
) -> String {
    let skill_line = skill_path
        .map(|p| format!("- 共享工作流规范：`{}`（请遵守其中规则）\n", p.display()))
        .unwrap_or_default();
    let user_req = if user_instruction.trim().is_empty() {
        "（未额外补充，请直接从会议原文中提炼最核心、最值得立即落地的可执行交付物）".to_string()
    } else {
        user_instruction.trim().to_string()
    };

    format!(
        r#"你是 AiGoodMeeting 联动的智能执行 Agent，现在处于【Phase 1：需求完整性预检】阶段。
注意：本阶段只做分析与判断，不要修改项目代码，不要对外发送飞书消息，**严禁调用 memoryctl 或写入任何长期记忆库**，只把 JSON 结果写入指定文件。

## 输入文件
- 会议完整上下文：`{context}`
- 工作区目录：`{workspace}`（可按需只读查看相关项目目录名与资料以纠偏专有名词）
{skill}- 用户本次补充说明：{user_req}

## 任务要求
1. 务必阅读完整原始转写，不要盲信本地小模型纪要（日期、人名、专有名词常有误）。结合工作区已有项目资料纠正同音误识别。
2. 审慎判断当前信息是否已经足够完善，可以立即进入正式执行：
   - 如果目标明确、交付形态清晰、无需关键决策补充 → 设 `"status": "ready"`，`questions` 为空数组 `[]`。
   - 如果存在会显著改变成品方向的缺口（如：要做哪一种交付物、面向谁、版本脱敏口径、目标飞书群、关键商业参数/口径、重点先落哪几项）→ 设 `"status": "needs_clarification"`，提出 **1～4 个**高价值、低负担的问题（每个问题提供 2～4 个具体可选推荐项，第一项为推荐项，并填 `defaultOption`）。不要问琐碎格式问题。
   - **脱敏红线**：若原声包含合伙人私下吐槽、粗话、敏感利益切分或对第三方机构的非公开评价，必须在预检中提醒并确认面向范围（内部决策版 vs 脱敏团队版）。
3. 将严格合法的 UTF-8 JSON 写入文件：`{result}`，同时在你的最终回复中输出同一份 JSON（放在 ```json ... ``` 代码块中）。

## JSON 输出结构（严格遵守字段名）
```json
{{
  "status": "ready" | "needs_clarification",
  "understoodGoal": "一句话准确说明你要帮用户完成什么",
  "correctedTerms": [
    {{"heard": "转写误词", "normalized": "正确名称", "evidence": "依据"}}
  ],
  "plannedDeliverables": ["交付物 1", "交付物 2"],
  "suggestedFeishuTitle": "清晰具体的飞书文档标题",
  "missingInfoSummary": "若 needs_clarification 用一句话概括缺口，否则空字符串",
  "questions": [
    {{
      "id": "q1",
      "question": "清晰简洁的问题",
      "reason": "为什么需要确认这一点",
      "suggestedOptions": ["推荐选项 A", "选项 B", "选项 C"],
      "defaultOption": "推荐选项 A",
      "allowCustom": true
    }}
  ]
}}
```
"#,
        context = context_path.display(),
        workspace = workspace_dir.display(),
        skill = skill_line,
        user_req = user_req,
        result = result_path.display(),
    )
}

fn build_execute_prompt(
    context_path: &Path,
    preflight_path: &Path,
    answers_path: &Path,
    deliverable_path: &Path,
    result_path: &Path,
    workspace_dir: &Path,
    user_instruction: &str,
    skill_path: Option<&Path>,
) -> String {
    let skill_line = skill_path
        .map(|p| format!("- 共享工作流规范：`{}`\n", p.display()))
        .unwrap_or_default();
    let user_req = if user_instruction.trim().is_empty() {
        "（以会议原文与预检结论为准）".to_string()
    } else {
        user_instruction.trim().to_string()
    };

    format!(
        r#"你是 AiGoodMeeting 联动的智能执行 Agent，现在处于【Phase 2：正式执行并生成可交付成果】阶段。
注意：飞书云文档创建与群通知将由 AiGoodMeeting 后端在你完成后自动执行，本阶段你无需自行调用 lark-cli 发消息；**默认严禁调用 memoryctl 或写入 agent-memory-vault 等任何长期记忆库（除非用户原始指令明确要求写入记忆）**，专注于把任务做深、做实、做到可直接交付使用。

## 输入文件
- 会议完整上下文：`{context}`
- Phase 1 预检结论：`{preflight}`
- 用户确认与回答：`{answers}`
- 工作区目录：`{workspace}`
{skill}- 用户原始指令：{user_req}

## 执行要求
1. 完整阅读会议原始转写、预检结论和用户回答，必要时参考 `{workspace}` 中对应的已有项目资料确保事实准确、口径一致。
2. 产出一份高质量、结构清晰、可直接阅读和执行的 Markdown 完整成品，写入：`{deliverable}`。
   - 使用标准 Markdown（`#`/`##`/`###` 标题、清单、紧凑表格、加粗重点），确保导入飞书云文档后美观易读。
   - 若工作区中存在明确对应的项目目录，也可按需在对应项目目录保存副本或衍生文件，并在 `artifactPaths` 中列出所有真实生成的绝对路径。
   - 开头简明标注来源会议日期（以真实记录时间为准，不抄写本地草稿错误日期）与关键事实边界；未知数字/时间明确标注待确认，严禁编造。
   - **脱敏要求**：自动清除口语粗话、私下情绪化吐槽及不适合外发的敏感人身评价；如面向团队/多人飞书群，严格输出脱敏专业版本。
3. 将严格合法的 UTF-8 JSON 执行回执写入：`{result}`，并在最终回复中输出同一份 JSON（放在 ```json ... ``` 代码块中）。

## JSON 输出结构（严格遵守字段名）
```json
{{
  "summary": "3-5 句面向使用者的完整执行结果总结",
  "feishuTitle": "最终飞书云文档标题",
  "feishuMessageSummary": "发到飞书群/私聊的 5-8 行高密度摘要（突出结论、核心数据与下一步行动，不刷屏）",
  "deliverableMarkdownPath": "{deliverable}",
  "artifactPaths": ["{deliverable}"],
  "nextActions": ["建议下一步行动 1", "建议下一步行动 2"]
}}
```
"#,
        context = context_path.display(),
        preflight = preflight_path.display(),
        answers = answers_path.display(),
        deliverable = deliverable_path.display(),
        result = result_path.display(),
        workspace = workspace_dir.display(),
        skill = skill_line,
        user_req = user_req,
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentCommandPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub working_dir: PathBuf,
    pub last_message_file: Option<PathBuf>,
    pub strip_env_vars: Vec<&'static str>,
}

pub fn build_agent_command_plan(
    agent_id: &str,
    binary: PathBuf,
    workspace_dir: &Path,
    run_dir: &Path,
    short_prompt: &str,
    model_override: Option<&str>,
    last_message_file: PathBuf,
) -> Result<AgentCommandPlan, String> {
    let model = model_override.map(str::trim).filter(|s| !s.is_empty());
    let ws_str = workspace_dir.to_string_lossy().to_string();
    let run_str = run_dir.to_string_lossy().to_string();

    match agent_id {
        "codex" => {
            let mut args = vec![
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                "-C".to_string(),
                ws_str,
                "--add-dir".to_string(),
                run_str,
                "-s".to_string(),
                "workspace-write".to_string(),
                "-o".to_string(),
                last_message_file.to_string_lossy().to_string(),
            ];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            args.push(short_prompt.to_string());
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: Some(last_message_file),
                strip_env_vars: vec![],
            })
        }
        "agy" => {
            let mut args = vec![
                "--output-format".to_string(),
                "text".to_string(),
                "--mode".to_string(),
                "auto".to_string(),
                "--add-dir".to_string(),
                ws_str,
                "--add-dir".to_string(),
                run_str,
            ];
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
            args.push("-p".to_string());
            args.push(short_prompt.to_string());
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "dsh" => {
            let args = vec![
                "--profile".to_string(),
                "headless".to_string(),
                "--permission-mode".to_string(),
                "workspace-write".to_string(),
                "--approval-policy".to_string(),
                "never".to_string(),
                "--add-dir".to_string(),
                run_str,
                short_prompt.to_string(),
            ];
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "claude" => {
            let mut args = vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
                "--add-dir".to_string(),
                ws_str,
                "--add-dir".to_string(),
                run_str,
            ];
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
            args.push(short_prompt.to_string());
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec!["CLAUDECODE"],
            })
        }
        "workbuddy" => {
            let mut args = vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
                "--add-dir".to_string(),
                ws_str,
                "--add-dir".to_string(),
                run_str,
            ];
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
            args.push(short_prompt.to_string());
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "kimi" => {
            let mut args = vec![
                "-p".to_string(),
                short_prompt.to_string(),
                "--auto".to_string(),
                "--add-dir".to_string(),
                ws_str,
                "--add-dir".to_string(),
                run_str,
            ];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "gemini" => {
            let mut args = vec![
                "-p".to_string(),
                short_prompt.to_string(),
                "--approval-mode".to_string(),
                "auto_edit".to_string(),
            ];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "hermes" => {
            let mut args = vec![
                "-z".to_string(),
                short_prompt.to_string(),
                "--in".to_string(),
                ws_str,
                "--yolo".to_string(),
            ];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        "opencode" => {
            let mut args = vec!["run".to_string()];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            args.push(short_prompt.to_string());
            Ok(AgentCommandPlan {
                program: binary,
                args,
                working_dir: workspace_dir.to_path_buf(),
                last_message_file: None,
                strip_env_vars: vec![],
            })
        }
        _ => Err(format!("不支持的 Agent 类型：{}", agent_id)),
    }
}

pub fn extract_json_object_from_text(raw: &str) -> Option<serde_json::Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if val.is_object() {
            return Some(val);
        }
    }

    // Search fenced ```json ... ``` blocks from last to first
    let mut fence_candidates: Vec<&str> = Vec::new();
    let mut search_from = 0;
    while let Some(start_idx) = trimmed[search_from..].find("```") {
        let abs_start = search_from + start_idx + 3;
        let after_fence = &trimmed[abs_start..];
        let body_start = after_fence
            .find('\n')
            .map(|n| abs_start + n + 1)
            .unwrap_or(abs_start);
        if let Some(end_rel) = trimmed[body_start..].find("```") {
            fence_candidates.push(trimmed[body_start..body_start + end_rel].trim());
            search_from = body_start + end_rel + 3;
        } else {
            break;
        }
    }
    for candidate in fence_candidates.into_iter().rev() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(candidate) {
            if val.is_object() {
                return Some(val);
            }
        }
    }

    // Fallback: balanced top-level `{ ... }` scan from last closing brace
    let bytes = trimmed.as_bytes();
    let mut i = bytes.len();
    while i > 0 {
        i -= 1;
        if bytes[i] == b'}' {
            // Scan forward from each earlier '{' to i
            for start in (0..i).rev() {
                if bytes[start] != b'{' {
                    continue;
                }
                let mut depth = 0i32;
                let mut in_string = false;
                let mut escaped = false;
                let mut valid = true;
                for &b in &bytes[start..=i] {
                    if in_string {
                        if escaped {
                            escaped = false;
                        } else if b == b'\\' {
                            escaped = true;
                        } else if b == b'"' {
                            in_string = false;
                        }
                    } else if b == b'"' {
                        in_string = true;
                    } else if b == b'{' {
                        depth += 1;
                    } else if b == b'}' {
                        depth -= 1;
                        if depth < 0 {
                            valid = false;
                            break;
                        }
                    }
                }
                if valid && depth == 0 && !in_string {
                    if let Some(slice) = trimmed.get(start..=i) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(slice) {
                            if val.is_object() {
                                return Some(val);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn parse_preflight_json(
    result_file: &Path,
    last_message_file: Option<&Path>,
    stdout: &str,
    fallback_title: &str,
) -> Result<PreflightResult, String> {
    let candidates: Vec<String> = [
        std::fs::read_to_string(result_file).ok(),
        last_message_file.and_then(|p| std::fs::read_to_string(p).ok()),
        Some(stdout.to_string()),
    ]
    .into_iter()
    .flatten()
    .collect();

    for text in &candidates {
        if let Some(val) = extract_json_object_from_text(text) {
            if let Ok(mut parsed) = serde_json::from_value::<PreflightResult>(val) {
                parsed.status = if parsed.status.trim().eq_ignore_ascii_case("needs_clarification")
                    && !parsed.questions.is_empty()
                {
                    "needs_clarification".to_string()
                } else {
                    "ready".to_string()
                };
                if parsed.suggested_feishu_title.trim().is_empty() {
                    parsed.suggested_feishu_title = fallback_title.to_string();
                }
                for (idx, q) in parsed.questions.iter_mut().enumerate() {
                    if q.id.trim().is_empty() {
                        q.id = format!("q{}", idx + 1);
                    }
                    if q.default_option.trim().is_empty() {
                        if let Some(first) = q.suggested_options.first() {
                            q.default_option = first.clone();
                        }
                    }
                }
                return Ok(parsed);
            }
        }
    }

    Err("Agent 未返回可解析的预检 JSON，请查看运行日志或切换其他已安装 Agent 重试。".to_string())
}

pub fn parse_execute_json(
    result_file: &Path,
    last_message_file: Option<&Path>,
    stdout: &str,
    deliverable_path: &Path,
    fallback_title: &str,
) -> Result<ExecuteResult, String> {
    let candidates: Vec<String> = [
        std::fs::read_to_string(result_file).ok(),
        last_message_file.and_then(|p| std::fs::read_to_string(p).ok()),
        Some(stdout.to_string()),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut parsed_opt: Option<ExecuteResult> = None;
    for text in &candidates {
        if let Some(val) = extract_json_object_from_text(text) {
            if let Ok(parsed) = serde_json::from_value::<ExecuteResult>(val) {
                parsed_opt = Some(parsed);
                break;
            }
        }
    }

    let mut result = parsed_opt.unwrap_or_else(|| {
        let fallback_text = last_message_file
            .and_then(|p| std::fs::read_to_string(p).ok())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| stdout.trim().to_string());
        ExecuteResult {
            summary: fallback_text.chars().take(600).collect(),
            feishu_title: fallback_title.to_string(),
            feishu_message_summary: fallback_text.chars().take(500).collect(),
            deliverable_markdown_path: deliverable_path.to_string_lossy().to_string(),
            artifact_paths: vec![deliverable_path.to_string_lossy().to_string()],
            next_actions: vec![],
        }
    });

    // Guarantee deliverable markdown exists on disk
    let resolved_deliverable = if !result.deliverable_markdown_path.trim().is_empty()
        && Path::new(&result.deliverable_markdown_path).is_file()
    {
        PathBuf::from(&result.deliverable_markdown_path)
    } else if deliverable_path.is_file() {
        deliverable_path.to_path_buf()
    } else {
        let fallback_body = last_message_file
            .and_then(|p| std::fs::read_to_string(p).ok())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| stdout.trim().to_string());
        if fallback_body.trim().is_empty() {
            return Err("Agent 执行结束但未产出有效文档内容，请查看日志重试。".to_string());
        }
        let md = format!("# {}\n\n{}\n", fallback_title, fallback_body);
        std::fs::write(deliverable_path, md.as_bytes())
            .map_err(|e| format!("写入兜底成果文档失败：{}", e))?;
        deliverable_path.to_path_buf()
    };

    let deliv_str = resolved_deliverable.to_string_lossy().to_string();
    result.deliverable_markdown_path = deliv_str.clone();
    if !result.artifact_paths.contains(&deliv_str) {
        result.artifact_paths.insert(0, deliv_str);
    }
    if result.feishu_title.trim().is_empty() {
        result.feishu_title = fallback_title.to_string();
    }
    if result.summary.trim().is_empty() {
        result.summary = format!("已完成《{}》的整理与落地方案生成。", result.feishu_title);
    }
    if result.feishu_message_summary.trim().is_empty() {
        result.feishu_message_summary = result.summary.clone();
    }
    Ok(result)
}

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    run_id: &str,
    meeting_id: &str,
    stage: &str,
    message: &str,
    log_line: Option<String>,
) {
    let _ = app.emit(
        "agent-handoff-progress",
        AgentProgressEvent {
            run_id: run_id.to_string(),
            meeting_id: meeting_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            log_line,
        },
    );
}

fn register_cancel_token(run_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    if let Ok(mut guard) = ACTIVE_RUNS.lock() {
        guard.insert(run_id.to_string(), token.clone());
    }
    token
}

fn clear_cancel_token(run_id: &str) {
    if let Ok(mut guard) = ACTIVE_RUNS.lock() {
        guard.remove(run_id);
    }
}

async fn run_agent_process<R: Runtime>(
    app: &AppHandle<R>,
    run_id: &str,
    meeting_id: &str,
    stage: &str,
    plan: &AgentCommandPlan,
    timeout_secs: u64,
    logs: &mut Vec<String>,
) -> Result<(String, String), String> {
    let cancel_token = register_cancel_token(run_id);

    let mut cmd = Command::new(&plan.program);
    cmd.args(&plan.args)
        .current_dir(&plan.working_dir)
        .env("PATH", build_augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in &plan.strip_env_vars {
        cmd.env_remove(key);
    }

    let mut child = cmd.spawn().map_err(|e| {
        clear_cancel_token(run_id);
        format!("启动 Agent 进程失败（{}）：{}", plan.program.display(), e)
    })?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(bool, String)>();

    let stdout_task = stdout_pipe.map(|pipe| {
        let tx_out = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(pipe).lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = reader.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
                let _ = tx_out.send((false, line));
            }
            buf
        })
    });

    let stderr_task = stderr_pipe.map(|pipe| {
        let tx_err = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(pipe).lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = reader.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
                let _ = tx_err.send((true, line));
            }
            buf
        })
    });
    drop(tx);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    let mut cancelled = false;
    let mut timed_out = false;
    let mut exit_status = None;

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                cancelled = true;
                let _ = child.kill().await;
                break;
            }
            _ = tokio::time::sleep_until(deadline) => {
                timed_out = true;
                let _ = child.kill().await;
                break;
            }
            maybe_line = rx.recv() => {
                if let Some((is_err, line)) = maybe_line {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        let entry = if is_err {
                            format!("[stderr] {}", trimmed)
                        } else {
                            trimmed.to_string()
                        };
                        if logs.len() >= MAX_STORED_LOG_LINES {
                            logs.remove(0);
                        }
                        logs.push(entry.clone());
                        emit_progress(app, run_id, meeting_id, stage, trimmed, Some(entry));
                    }
                } else {
                    exit_status = child.wait().await.ok();
                    break;
                }
            }
        }
    }

    if exit_status.is_none() {
        exit_status = child.wait().await.ok();
    }
    clear_cancel_token(run_id);

    let stdout = if let Some(t) = stdout_task {
        t.await.unwrap_or_default()
    } else {
        String::new()
    };
    let stderr = if let Some(t) = stderr_task {
        t.await.unwrap_or_default()
    } else {
        String::new()
    };

    if cancelled {
        return Err("已取消本次 Agent 任务".to_string());
    }
    if timed_out {
        return Err(format!("Agent 执行超时（超过 {} 秒），请重试或切换模型。", timeout_secs));
    }

    let ok = exit_status.map(|s| s.success()).unwrap_or(false);
    if !ok {
        let detail = stderr
            .lines()
            .rev()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .or_else(|| stdout.lines().rev().map(str::trim).find(|l| !l.is_empty()))
            .unwrap_or("进程异常退出");
        return Err(format!("Agent 执行失败：{}", detail));
    }

    Ok((stdout, stderr))
}

#[tauri::command]
pub async fn agent_get_config<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AgentHandoffConfig, String> {
    Ok(load_agent_config(&app))
}

#[tauri::command]
pub async fn agent_save_config<R: Runtime>(
    app: AppHandle<R>,
    mut config: AgentHandoffConfig,
) -> Result<AgentHandoffConfig, String> {
    if config.workspace_dir.trim().is_empty() {
        config.workspace_dir = default_workspace_dir();
    } else {
        let expanded = expand_home_path(&config.workspace_dir);
        if !expanded.is_dir() {
            return Err(format!("指定的工作区目录不存在：{}", expanded.display()));
        }
        config.workspace_dir = expanded.to_string_lossy().to_string();
    }
    if find_agent_spec(&config.default_agent).is_none() {
        config.default_agent = default_agent_id();
    }
    persist_agent_config(&app, &config)?;
    Ok(config)
}

#[tauri::command]
pub async fn agent_detect_installations<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<AgentInstallationInfo>, String> {
    let config = load_agent_config(&app);
    let mut handles = Vec::new();
    for spec in AGENT_SPECS {
        let custom = config.custom_cli_paths.get(spec.id).cloned();
        handles.push(tokio::spawn(detect_single_agent(spec, custom)));
    }
    let mut results = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(info) = h.await {
            results.push(info);
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn agent_list_runs<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<Vec<AgentRunRecord>, String> {
    let meeting_dir = agent_runs_root(&app)?.join(sanitize_relative_stem(&meeting_id));
    if !meeting_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut runs: Vec<AgentRunRecord> = Vec::new();
    let entries = std::fs::read_dir(&meeting_dir)
        .map_err(|e| format!("读取 Agent 历史记录目录失败：{}", e))?;
    for entry in entries.flatten() {
        let state_file = entry.path().join("run-state.json");
        if state_file.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&state_file) {
                if let Ok(record) = serde_json::from_str::<AgentRunRecord>(&raw) {
                    runs.push(record);
                }
            }
        }
    }
    runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(runs)
}

#[tauri::command]
pub async fn agent_cancel_run(run_id: String) -> Result<bool, String> {
    if let Ok(guard) = ACTIVE_RUNS.lock() {
        if let Some(token) = guard.get(&run_id) {
            token.cancel();
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn agent_open_run_folder(run_dir: String) -> Result<(), String> {
    let path = PathBuf::from(run_dir.trim());
    if !path.exists() {
        return Err(format!("产物目录不存在：{}", path.display()));
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败：{}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败：{}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败：{}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_prepare_manual_handoff<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    agent_id: String,
    user_instruction: Option<String>,
) -> Result<ManualHandoffResponse, String> {
    let spec = find_agent_spec(&agent_id)
        .ok_or_else(|| format!("未知 Agent：{}", agent_id))?;
    let (meeting_title, context_md) = build_meeting_context_markdown(&app, &meeting_id).await?;
    let run_id = format!("manual-{}", Utc::now().format("%Y%m%d-%H%M%S"));
    let run_dir = run_dir_for(&app, &meeting_id, &run_id)?;
    std::fs::create_dir_all(&run_dir).map_err(|e| format!("创建交接目录失败：{}", e))?;
    let context_path = run_dir.join("meeting-context.md");
    std::fs::write(&context_path, context_md.as_bytes())
        .map_err(|e| format!("写入会议上下文失败：{}", e))?;

    let extra = user_instruction
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n补充要求：{}", s))
        .unwrap_or_default();
    let prompt_text = format!(
        "请按照 aigoodmeeting-agent-handoff Skill 处理这场会议《{}》：\n上下文文件：{}\n请先读完整转写并纠偏专有名词；若存在关键信息缺口先向我提 1-4 个问题，信息完善则直接执行产出并同步到飞书。{}",
        meeting_title,
        context_path.display(),
        extra
    );

    let mut launched_app = false;
    if let Some(app_path) = resolve_app_for_spec(spec) {
        #[cfg(target_os = "macos")]
        {
            if Command::new("open").arg(&app_path).spawn().is_ok() {
                launched_app = true;
            }
        }
    }

    Ok(ManualHandoffResponse {
        run_dir: run_dir.to_string_lossy().to_string(),
        context_path: context_path.to_string_lossy().to_string(),
        prompt_text,
        launched_app,
        message: if launched_app {
            format!("已导出会议交接包并启动 {}，请直接粘贴提示词开始执行。", spec.name)
        } else {
            format!("已导出会议交接包，请复制提示词粘贴到 {} 中执行。", spec.name)
        },
    })
}

#[tauri::command]
pub async fn agent_start_preflight<R: Runtime>(
    app: AppHandle<R>,
    request: StartPreflightRequest,
) -> Result<AgentRunRecord, String> {
    let config = load_agent_config(&app);
    let agent_id = request
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&config.default_agent)
        .to_string();
    let spec = find_agent_spec(&agent_id)
        .ok_or_else(|| format!("不支持的 Agent：{}", agent_id))?;

    let custom_cli = config.custom_cli_paths.get(spec.id).map(String::as_str);
    let binary = resolve_cli_for_spec(spec, custom_cli).ok_or_else(|| {
        if resolve_app_for_spec(spec).is_some() {
            format!(
                "{} 仅检测到桌面版、未检测到命令行 CLI，请点击「打包并打开桌面端」或切换到其他已就绪 CLI Agent。",
                spec.name
            )
        } else {
            format!("未检测到 {} CLI，请先安装或在「设置 → Agent 联动」中指定可执行路径。", spec.name)
        }
    })?;

    let workspace_raw = request
        .workspace_dir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&config.workspace_dir);
    let workspace_dir = expand_home_path(workspace_raw);
    if !workspace_dir.is_dir() {
        return Err(format!("工作区目录不存在：{}", workspace_dir.display()));
    }

    let (meeting_title, context_md) =
        build_meeting_context_markdown(&app, &request.meeting_id).await?;

    let run_id = format!(
        "run-{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        &uuid::Uuid::new_v4().to_string()[..6]
    );
    let run_dir = run_dir_for(&app, &request.meeting_id, &run_id)?;
    std::fs::create_dir_all(&run_dir).map_err(|e| format!("创建任务目录失败：{}", e))?;

    let context_path = run_dir.join("meeting-context.md");
    std::fs::write(&context_path, context_md.as_bytes())
        .map_err(|e| format!("写入会议上下文失败：{}", e))?;

    let preflight_result_path = run_dir.join("preflight-result.json");
    let preflight_prompt_path = run_dir.join("preflight-prompt.txt");
    let last_msg_path = run_dir.join("preflight-last-message.txt");
    let user_instruction = request.user_instruction.unwrap_or_default();
    let skill_path = resolve_shared_skill_path();

    let full_prompt = build_preflight_prompt(
        &context_path,
        &preflight_result_path,
        &workspace_dir,
        &user_instruction,
        skill_path.as_deref(),
    );
    std::fs::write(&preflight_prompt_path, full_prompt.as_bytes())
        .map_err(|e| format!("写入预检提示词失败：{}", e))?;

    let short_prompt = format!(
        "请完整阅读并严格执行预检指令文件 `{}`（会议原文在 `{}`），将严格合法的 JSON 结果写入 `{}` 并在最终回复中输出该 JSON。不要修改项目代码，不要发飞书消息。",
        preflight_prompt_path.display(),
        context_path.display(),
        preflight_result_path.display()
    );

    let delivery_mode = request
        .feishu_delivery_mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&config.feishu_delivery_mode)
        .to_string();
    let chat_id = request
        .feishu_chat_id
        .unwrap_or_else(|| config.feishu_chat_id.clone());
    let chat_name = request
        .feishu_chat_name
        .unwrap_or_else(|| config.feishu_chat_name.clone());

    let mut collaborator_ids: Vec<String> = Vec::new();
    let mut collaborator_names: Vec<String> = Vec::new();
    for raw_cid in &request.collaborator_agent_ids {
        let cid = raw_cid.trim().to_ascii_lowercase();
        if cid.is_empty() || cid == spec.id || collaborator_ids.contains(&cid) {
            continue;
        }
        if let Some(cspec) = find_agent_spec(&cid) {
            collaborator_ids.push(cspec.id.to_string());
            collaborator_names.push(cspec.short_name.to_string());
        }
    }

    let now = Utc::now().to_rfc3339();
    let mut record = AgentRunRecord {
        run_id: run_id.clone(),
        meeting_id: request.meeting_id.clone(),
        meeting_title: meeting_title.clone(),
        agent_id: spec.id.to_string(),
        agent_name: spec.name.to_string(),
        collaborator_agent_ids: collaborator_ids,
        collaborator_agent_names: collaborator_names.clone(),
        workspace_dir: workspace_dir.to_string_lossy().to_string(),
        user_instruction,
        feishu_delivery_mode: delivery_mode,
        feishu_chat_id: chat_id,
        feishu_chat_name: chat_name,
        status: "preflighting".to_string(),
        created_at: now.clone(),
        updated_at: now,
        run_dir: run_dir.to_string_lossy().to_string(),
        context_path: context_path.to_string_lossy().to_string(),
        preflight: None,
        answers: vec![],
        execute_result: None,
        deliverable_preview: None,
        feishu_delivery: None,
        error: None,
        logs: vec![if collaborator_names.is_empty() {
            format!("已使用 {} 启动需求预检", spec.name)
        } else {
            format!(
                "已由 {} 主控（协同：{}）启动需求预检",
                spec.short_name,
                collaborator_names.join(" + ")
            )
        }],
    };
    save_run_record(&record)?;

    emit_progress(
        &app,
        &run_id,
        &request.meeting_id,
        "preflighting",
        &format!("正在调用 {} 审阅完整转写并检查信息完整性…", spec.name),
        None,
    );

    let model_override = config.model_overrides.get(spec.id).map(String::as_str);
    let plan = build_agent_command_plan(
        spec.id,
        binary,
        &workspace_dir,
        &run_dir,
        &short_prompt,
        model_override,
        last_msg_path.clone(),
    )?;

    info!("Running Agent preflight {} with {}", run_id, spec.name);
    match run_agent_process(
        &app,
        &run_id,
        &request.meeting_id,
        "preflighting",
        &plan,
        240,
        &mut record.logs,
    )
    .await
    {
        Ok((stdout, _stderr)) => {
            match parse_preflight_json(
                &preflight_result_path,
                plan.last_message_file.as_deref(),
                &stdout,
                &meeting_title,
            ) {
                Ok(preflight) => {
                    record.status = preflight.status.clone();
                    record.preflight = Some(preflight);
                    record.updated_at = Utc::now().to_rfc3339();
                    save_run_record(&record)?;
                    emit_progress(
                        &app,
                        &run_id,
                        &request.meeting_id,
                        &record.status,
                        if record.status == "needs_clarification" {
                            "Agent 提出了需要确认的问题"
                        } else {
                            "需求已完善，可立即执行"
                        },
                        None,
                    );
                    Ok(record)
                }
                Err(err) => {
                    record.status = "error".to_string();
                    record.error = Some(err.clone());
                    record.updated_at = Utc::now().to_rfc3339();
                    let _ = save_run_record(&record);
                    Err(err)
                }
            }
        }
        Err(err) => {
            record.status = if err.contains("已取消") {
                "cancelled".to_string()
            } else {
                "error".to_string()
            };
            record.error = Some(err.clone());
            record.updated_at = Utc::now().to_rfc3339();
            let _ = save_run_record(&record);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn agent_execute_run<R: Runtime>(
    app: AppHandle<R>,
    request: ExecuteRunRequest,
) -> Result<AgentRunRecord, String> {
    let config = load_agent_config(&app);
    let mut record = load_run_record(&app, &request.meeting_id, &request.run_id)?;
    let spec = find_agent_spec(&record.agent_id)
        .ok_or_else(|| format!("不支持的 Agent：{}", record.agent_id))?;

    let custom_cli = config.custom_cli_paths.get(spec.id).map(String::as_str);
    let binary = resolve_cli_for_spec(spec, custom_cli)
        .ok_or_else(|| format!("未检测到 {} CLI，请检查安装状态。", spec.name))?;

    if let Some(mode) = request
        .feishu_delivery_mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        record.feishu_delivery_mode = mode.to_string();
    }
    if let Some(chat_id) = request.feishu_chat_id {
        record.feishu_chat_id = chat_id;
    }
    if let Some(chat_name) = request.feishu_chat_name {
        record.feishu_chat_name = chat_name;
    }
    if let Some(collab_override) = request.collaborator_agent_ids {
        let mut ids = Vec::new();
        let mut names = Vec::new();
        for raw_cid in collab_override {
            let cid = raw_cid.trim().to_ascii_lowercase();
            if cid.is_empty() || cid == spec.id || ids.contains(&cid) {
                continue;
            }
            if let Some(cspec) = find_agent_spec(&cid) {
                ids.push(cspec.id.to_string());
                names.push(cspec.short_name.to_string());
            }
        }
        record.collaborator_agent_ids = ids;
        record.collaborator_agent_names = names;
    }
    record.answers = request.answers;
    record.status = "executing".to_string();
    record.error = None;
    record.updated_at = Utc::now().to_rfc3339();

    let run_dir = PathBuf::from(&record.run_dir);
    let workspace_dir = PathBuf::from(&record.workspace_dir);
    let context_path = PathBuf::from(&record.context_path);
    let preflight_path = run_dir.join("preflight-result.json");
    let answers_path = run_dir.join("answers.json");
    let deliverable_path = run_dir.join("deliverable.md");
    let execute_result_path = run_dir.join("execute-result.json");
    let execute_prompt_path = run_dir.join("execute-prompt.txt");
    let last_msg_path = run_dir.join("execute-last-message.txt");

    let answers_json = serde_json::to_string_pretty(&record.answers)
        .map_err(|e| format!("序列化回答失败：{}", e))?;
    std::fs::write(&answers_path, answers_json)
        .map_err(|e| format!("写入用户回答失败：{}", e))?;

    // Optional Multi-Agent Collaboration stage: run selected collaborator Agents in parallel first
    let mut collaborator_notes: Vec<(String, PathBuf)> = Vec::new();
    if !record.collaborator_agent_ids.is_empty() {
        let collab_display = record.collaborator_agent_names.join(" + ");
        record
            .logs
            .push(format!("启动多 Agent 协同复核：{}", collab_display));
        save_run_record(&record)?;
        emit_progress(
            &app,
            &record.run_id,
            &record.meeting_id,
            "executing",
            &format!("多 Agent 协同中：{} 正在并行分析与复核…", collab_display),
            None,
        );

        let mut collab_futs = Vec::new();
        for cid in &record.collaborator_agent_ids {
            let Some(cspec) = find_agent_spec(cid) else {
                continue;
            };
            let custom_c = config.custom_cli_paths.get(cspec.id).map(String::as_str);
            let Some(cbin) = resolve_cli_for_spec(cspec, custom_c) else {
                record.logs.push(format!("协同 Agent {} 未检测到 CLI，已跳过", cspec.short_name));
                continue;
            };
            let note_path = run_dir.join(format!("collab-{}.md", cspec.id));
            let prompt_path = run_dir.join(format!("collab-{}-prompt.txt", cspec.id));
            let last_path = run_dir.join(format!("collab-{}-last.txt", cspec.id));
            let c_prompt = format!(
                "你是参与多 Agent 协同的评审与补全专家（{}）。请阅读会议原文 `{}`、预检 `{}` 与用户确认 `{}`，从独立视角输出结构化协同建议（核心结论复核、易遗漏风险与反例、可落地的具体执行清单），写入 `{}`。严禁调用 memoryctl 或写入记忆库，严禁修改工作区既有项目文件，严禁发送飞书消息。",
                cspec.name,
                context_path.display(),
                preflight_path.display(),
                answers_path.display(),
                note_path.display(),
            );
            let _ = std::fs::write(&prompt_path, c_prompt.as_bytes());
            let c_short = format!(
                "请完整阅读并执行 `{}`，将协同分析报告写入 `{}`。不要改代码、不要写记忆、不要发飞书。",
                prompt_path.display(),
                note_path.display()
            );
            let c_model = config.model_overrides.get(cspec.id).map(String::as_str);
            if let Ok(c_plan) = build_agent_command_plan(
                cspec.id,
                cbin,
                &workspace_dir,
                &run_dir,
                &c_short,
                c_model,
                last_path.clone(),
            ) {
                let app_c = app.clone();
                let rid = format!("{}-collab-{}", record.run_id, cspec.id);
                let mid = record.meeting_id.clone();
                let cname = cspec.short_name.to_string();
                collab_futs.push(async move {
                    let mut sub_logs = Vec::new();
                    let res = run_agent_process(&app_c, &rid, &mid, "executing", &c_plan, 300, &mut sub_logs).await;
                    (cname, note_path, last_path, res)
                });
            }
        }

        let collab_results = futures_util::future::join_all(collab_futs).await;
        for (cname, note_path, last_path, res) in collab_results {
            match res {
                Ok((stdout, _)) => {
                    if !note_path.is_file() {
                        let fallback = std::fs::read_to_string(&last_path)
                            .ok()
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or(stdout);
                        if !fallback.trim().is_empty() {
                            let _ = std::fs::write(&note_path, fallback.as_bytes());
                        }
                    }
                    if note_path.is_file() {
                        record.logs.push(format!("协同 Agent {} 已完成分析", cname));
                        collaborator_notes.push((cname, note_path));
                    }
                }
                Err(e) => {
                    record
                        .logs
                        .push(format!("协同 Agent {} 未完成（已继续主控汇融）：{}", cname, e));
                }
            }
        }
    }

    let skill_path = resolve_shared_skill_path();
    let mut full_prompt = build_execute_prompt(
        &context_path,
        &preflight_path,
        &answers_path,
        &deliverable_path,
        &execute_result_path,
        &workspace_dir,
        &record.user_instruction,
        skill_path.as_deref(),
    );
    if !collaborator_notes.is_empty() {
        full_prompt.push_str("\n## 多 Agent 协同意见（请务必阅读并融合成一份统一成品）\n");
        for (cname, path) in &collaborator_notes {
            full_prompt.push_str(&format!("- 协同 Agent「{}」分析稿：`{}`\n", cname, path.display()));
        }
        full_prompt.push_str(
            "请在最终成品中吸收各方有价值的补充与风险提示，在文末增加简明的「多 Agent 协同复核摘要」小节，说明共识与关键补充点。\n",
        );
    }
    std::fs::write(&execute_prompt_path, full_prompt.as_bytes())
        .map_err(|e| format!("写入执行提示词失败：{}", e))?;

    let display_agent_label = if record.collaborator_agent_names.is_empty() {
        record.agent_name.clone()
    } else {
        format!(
            "{} + {} 协同",
            spec.short_name,
            record.collaborator_agent_names.join(" + ")
        )
    };

    record
        .logs
        .push(format!("开始由 {} 汇融执行并生成成品", display_agent_label));
    save_run_record(&record)?;

    emit_progress(
        &app,
        &record.run_id,
        &record.meeting_id,
        "executing",
        &format!("{} 正在生成最终成品文档…", display_agent_label),
        None,
    );

    let short_prompt = format!(
        "请完整阅读并严格执行任务说明文件 `{}`（会议原文 `{}`，预检 `{}`，用户确认 `{}`），将完整可交付的 Markdown 成品写入 `{}`，并将执行回执 JSON 写入 `{}` 且在最终回复中输出该 JSON。",
        execute_prompt_path.display(),
        context_path.display(),
        preflight_path.display(),
        answers_path.display(),
        deliverable_path.display(),
        execute_result_path.display(),
    );

    let model_override = config.model_overrides.get(spec.id).map(String::as_str);
    let plan = build_agent_command_plan(
        spec.id,
        binary,
        &workspace_dir,
        &run_dir,
        &short_prompt,
        model_override,
        last_msg_path.clone(),
    )?;

    let fallback_title = record
        .preflight
        .as_ref()
        .map(|p| p.suggested_feishu_title.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&record.meeting_title)
        .to_string();

    info!("Running Agent execution {} with {}", record.run_id, spec.name);
    let (stdout, _stderr) = match run_agent_process(
        &app,
        &record.run_id,
        &record.meeting_id,
        "executing",
        &plan,
        900,
        &mut record.logs,
    )
    .await
    {
        Ok(res) => res,
        Err(err) => {
            record.status = if err.contains("已取消") {
                "cancelled".to_string()
            } else {
                "error".to_string()
            };
            record.error = Some(err.clone());
            record.updated_at = Utc::now().to_rfc3339();
            let _ = save_run_record(&record);
            return Err(err);
        }
    };

    let exec_result = match parse_execute_json(
        &execute_result_path,
        plan.last_message_file.as_deref(),
        &stdout,
        &deliverable_path,
        &fallback_title,
    ) {
        Ok(r) => r,
        Err(err) => {
            record.status = "error".to_string();
            record.error = Some(err.clone());
            record.updated_at = Utc::now().to_rfc3339();
            let _ = save_run_record(&record);
            return Err(err);
        }
    };

    let deliverable_md = std::fs::read_to_string(&exec_result.deliverable_markdown_path)
        .unwrap_or_default();
    let preview: String = deliverable_md.chars().take(1600).collect();

    record.execute_result = Some(exec_result.clone());
    record.deliverable_preview = Some(preview);

    // Phase 3: Deliver to Feishu
    emit_progress(
        &app,
        &record.run_id,
        &record.meeting_id,
        "delivering_feishu",
        "Agent 已完成产出，正在发送到飞书…",
        None,
    );
    record.status = "delivering_feishu".to_string();
    save_run_record(&record)?;

    let delivery = feishu::deliver_agent_result_to_feishu(
        &app,
        &record.feishu_delivery_mode,
        Some(&record.feishu_chat_id),
        Some(&record.feishu_chat_name),
        &exec_result.feishu_title,
        &deliverable_md,
        &exec_result.feishu_message_summary,
        &display_agent_label,
        &record.run_id,
    )
    .await;

    let feishu_all_ok = match record.feishu_delivery_mode.as_str() {
        "none" => true,
        "doc_only" => delivery.doc_ok,
        _ => delivery.doc_ok && delivery.message_ok,
    };

    record.status = if feishu_all_ok {
        "completed".to_string()
    } else {
        "completed_feishu_warning".to_string()
    };
    record.logs.push(delivery.message.clone());
    record.feishu_delivery = Some(delivery);
    record.updated_at = Utc::now().to_rfc3339();
    save_run_record(&record)?;

    emit_progress(
        &app,
        &record.run_id,
        &record.meeting_id,
        &record.status,
        if feishu_all_ok {
            "全部执行并发送飞书完成"
        } else {
            "Agent 已完成产出，飞书推送有提示请查看"
        },
        None,
    );

    Ok(record)
}

#[tauri::command]
pub async fn agent_resend_feishu<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    run_id: String,
    delivery_mode: String,
    chat_id: Option<String>,
    chat_name: Option<String>,
) -> Result<AgentRunRecord, String> {
    let mut record = load_run_record(&app, &meeting_id, &run_id)?;
    let exec_result = record
        .execute_result
        .clone()
        .ok_or_else(|| "该任务尚未完成产出，无法发送飞书。".to_string())?;
    let deliverable_md = std::fs::read_to_string(&exec_result.deliverable_markdown_path)
        .map_err(|e| format!("读取本地产出文档失败：{}", e))?;

    record.feishu_delivery_mode = delivery_mode.clone();
    if let Some(cid) = chat_id {
        record.feishu_chat_id = cid;
    }
    if let Some(cname) = chat_name {
        record.feishu_chat_name = cname;
    }

    let resend_idem = format!(
        "{}-r{}",
        record.run_id,
        Utc::now().timestamp() % 100000
    );
    let delivery = feishu::deliver_agent_result_to_feishu(
        &app,
        &record.feishu_delivery_mode,
        Some(&record.feishu_chat_id),
        Some(&record.feishu_chat_name),
        &exec_result.feishu_title,
        &deliverable_md,
        &exec_result.feishu_message_summary,
        &record.agent_name,
        &resend_idem,
    )
    .await;

    let feishu_all_ok = match record.feishu_delivery_mode.as_str() {
        "none" => true,
        "doc_only" => delivery.doc_ok,
        _ => delivery.doc_ok && delivery.message_ok,
    };
    record.status = if feishu_all_ok {
        "completed".to_string()
    } else {
        "completed_feishu_warning".to_string()
    };
    record.logs.push(format!("重发飞书：{}", delivery.message));
    record.feishu_delivery = Some(delivery);
    record.updated_at = Utc::now().to_rfc3339();
    save_run_record(&record)?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_from_raw_fenced_and_noisy_stdout() {
        let raw = r#"{"status":"ready","understoodGoal":"做商业模式测算"}"#;
        assert_eq!(
            extract_json_object_from_text(raw).unwrap()["status"],
            "ready"
        );

        let noisy = "Loaded workspace...\n```json\n{\"status\":\"needs_clarification\",\"questions\":[{\"id\":\"q1\",\"question\":\"要发给谁？\"}]}\n```\nDone.";
        let parsed = extract_json_object_from_text(noisy).unwrap();
        assert_eq!(parsed["status"], "needs_clarification");
        assert_eq!(parsed["questions"][0]["id"], "q1");

        let bare = "Thinking complete.\n{\"status\":\"ready\",\"suggestedFeishuTitle\":\"测试文档\"}\n";
        assert_eq!(
            extract_json_object_from_text(bare).unwrap()["suggestedFeishuTitle"],
            "测试文档"
        );
    }

    #[test]
    fn builds_valid_command_plans_for_all_supported_agents() {
        let ws = Path::new("/tmp/workspace");
        let run = Path::new("/tmp/run");
        let last = PathBuf::from("/tmp/run/last.txt");

        for agent in [
            "codex",
            "agy",
            "dsh",
            "claude",
            "workbuddy",
            "kimi",
            "gemini",
            "hermes",
            "opencode",
        ] {
            let plan = build_agent_command_plan(
                agent,
                PathBuf::from(format!("/usr/local/bin/{}", agent)),
                ws,
                run,
                "execute task",
                Some("demo-model"),
                last.clone(),
            )
            .unwrap();
            assert_eq!(plan.working_dir, ws);
            assert!(plan.args.iter().any(|a| a.contains("execute task")));
        }

        let dsh_plan = build_agent_command_plan(
            "dsh",
            PathBuf::from("/Users/test/.local/bin/dsh"),
            ws,
            run,
            "run me",
            None,
            last.clone(),
        )
        .unwrap();
        assert_eq!(
            dsh_plan.args,
            vec![
                "--profile",
                "headless",
                "--permission-mode",
                "workspace-write",
                "--approval-policy",
                "never",
                "--add-dir",
                "/tmp/run",
                "run me",
            ]
        );

        let claude_plan = build_agent_command_plan(
            "claude",
            PathBuf::from("/Users/test/.local/bin/claude"),
            ws,
            run,
            "run me",
            None,
            last.clone(),
        )
        .unwrap();
        assert!(claude_plan.strip_env_vars.contains(&"CLAUDECODE"));

        let agy_plan = build_agent_command_plan(
            "agy",
            PathBuf::from("/Users/test/.local/bin/agy"),
            ws,
            run,
            "run agy prompt",
            None,
            last,
        )
        .unwrap();
        let p_idx = agy_plan.args.iter().position(|a| a == "-p").unwrap();
        assert_eq!(agy_plan.args.get(p_idx + 1).map(String::as_str), Some("run agy prompt"));
    }

    #[test]
    fn parses_preflight_normalizing_empty_questions_to_ready() {
        let dir = tempfile::tempdir().unwrap();
        let res_file = dir.path().join("preflight-result.json");
        std::fs::write(
            &res_file,
            r#"{"status":"needs_clarification","understoodGoal":"做计划","questions":[]}"#,
        )
        .unwrap();
        let parsed = parse_preflight_json(&res_file, None, "", "默认标题").unwrap();
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.suggested_feishu_title, "默认标题");
    }

    #[test]
    fn builds_safe_terminal_applescript_and_rejects_multiline() {
        let script = build_terminal_applescript("npm install -g @larksuite/cli").unwrap();
        assert!(script.contains("tell application \"Terminal\""));
        assert!(script.contains("do script \"npm install -g @larksuite/cli\""));
        assert!(build_terminal_applescript("echo 1\necho 2").is_err());
        assert!(build_terminal_applescript("   ").is_err());
    }
}
