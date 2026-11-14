use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;
use tokio::process::Command;

const FEISHU_STORE_FILE: &str = "feishu_config.json";
const FEISHU_STORE_KEY: &str = "config";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    #[serde(default)]
    pub cli_path: String,
    #[serde(default = "default_identity")]
    pub identity: String,
    #[serde(default)]
    pub profile: String,
    #[serde(default = "default_upload_mode")]
    pub default_upload_mode: String,
    #[serde(default)]
    pub destination: String,
}

fn default_identity() -> String {
    "user".to_string()
}

fn default_upload_mode() -> String {
    "docx".to_string()
}

impl Default for FeishuConfig {
    fn default() -> Self {
        Self {
            cli_path: String::new(),
            identity: default_identity(),
            profile: String::new(),
            default_upload_mode: default_upload_mode(),
            destination: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuStatusResponse {
    pub installed: bool,
    pub resolved_cli_path: Option<String>,
    pub version: Option<String>,
    pub authenticated: bool,
    pub brand: Option<String>,
    pub active_identity: Option<String>,
    pub user_name: Option<String>,
    pub user_ready: bool,
    pub bot_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuUploadResponse {
    pub ok: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    pub title: String,
    pub mode_label: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentResponse {
    pub saved: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeishuDestination {
    DriveRoot,
    DriveFolder(String),
    WikiNode(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeishuUploadPayload {
    BinaryDocx { file_name: String, bytes: Vec<u8> },
    TextFile { file_name: String, content: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadCommandPlan {
    pub args: Vec<String>,
    pub payload: FeishuUploadPayload,
    pub mode_label: String,
}

fn expand_home_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn build_augmented_path() -> OsString {
    let mut dirs_list: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs_list.push(home.join(".local/bin"));
    }
    dirs_list.push(PathBuf::from("/opt/homebrew/bin"));
    dirs_list.push(PathBuf::from("/usr/local/bin"));
    dirs_list.push(PathBuf::from("/usr/bin"));
    dirs_list.push(PathBuf::from("/bin"));

    if let Some(existing) = std::env::var_os("PATH") {
        for entry in std::env::split_paths(&existing) {
            if !dirs_list.contains(&entry) {
                dirs_list.push(entry);
            }
        }
    }
    std::env::join_paths(dirs_list).unwrap_or_else(|_| OsString::from("/usr/bin:/bin"))
}

pub fn resolve_lark_cli_binary(configured_path: &str) -> Result<PathBuf, String> {
    let trimmed = configured_path.trim();
    if !trimmed.is_empty() {
        let custom = expand_home_path(trimmed);
        if custom.is_file() {
            return Ok(custom);
        }
        return Err(format!("指定的飞书 CLI 路径不存在：{}", custom.display()));
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/lark-cli"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/lark-cli"));
    candidates.push(PathBuf::from("/usr/local/bin/lark-cli"));

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Ok(found) = which::which("lark-cli") {
        return Ok(found);
    }

    Err("未检测到飞书 CLI（lark-cli）。请先安装并在终端完成 lark-cli auth login，或在设置中指定可执行文件路径。".to_string())
}

pub fn parse_feishu_destination(raw: &str) -> Result<FeishuDestination, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(FeishuDestination::DriveRoot);
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed).trim_end_matches('/');
        if let Some(idx) = without_query.find("/drive/folder/") {
            let token = without_query[idx + "/drive/folder/".len()..]
                .split('/')
                .next()
                .unwrap_or("")
                .trim();
            if is_safe_token(token) {
                return Ok(FeishuDestination::DriveFolder(token.to_string()));
            }
        }
        if let Some(idx) = without_query.find("/wiki/") {
            let token = without_query[idx + "/wiki/".len()..]
                .split('/')
                .next()
                .unwrap_or("")
                .trim();
            if is_safe_token(token) {
                return Ok(FeishuDestination::WikiNode(token.to_string()));
            }
        }
        return Err("目标链接不是飞书云盘文件夹或知识库节点。请粘贴含 /drive/folder/ 或 /wiki/ 的链接，或留空上传到云盘根目录。".to_string());
    }

    if !is_safe_token(trimmed) {
        return Err("目标文件夹或知识库节点 Token 格式无效，仅支持字母、数字、下划线或短横线。".to_string());
    }

    if trimmed.starts_with("wik") {
        Ok(FeishuDestination::WikiNode(trimmed.to_string()))
    } else {
        Ok(FeishuDestination::DriveFolder(trimmed.to_string()))
    }
}

fn is_safe_token(token: &str) -> bool {
    let len = token.len();
    (6..=80).contains(&len)
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

pub fn sanitize_relative_stem(raw_title: &str) -> String {
    let cleaned: String = raw_title
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' | '\t' => ' ',
            _ if ch.is_control() => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut base = if cleaned.is_empty() {
        "会议纪要".to_string()
    } else {
        cleaned.chars().take(72).collect()
    };
    while base.starts_with('.') || base.starts_with('-') {
        base.remove(0);
    }
    if base.trim().is_empty() {
        "会议纪要".to_string()
    } else {
        base.trim().to_string()
    }
}

fn normalized_identity(raw: &str) -> &str {
    match raw.trim() {
        "bot" => "bot",
        "auto" => "auto",
        _ => "user",
    }
}

pub fn build_upload_command_plan(
    config: &FeishuConfig,
    title: &str,
    mode_override: Option<&str>,
    docx_bytes: Option<Vec<u8>>,
    markdown_text: Option<String>,
    plain_text: Option<String>,
) -> Result<UploadCommandPlan, String> {
    let markdown_text = markdown_text.map(|text| crate::summary::plain_text::to_summary_plain_text(&text));
    let plain_text = plain_text.map(|text| crate::summary::plain_text::to_summary_plain_text(&text));
    let destination = parse_feishu_destination(&config.destination)?;
    let stem = sanitize_relative_stem(title);
    let mode = mode_override
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| config.default_upload_mode.trim());
    let identity = normalized_identity(&config.identity);
    let profile = config.profile.trim();

    let append_common_flags = |args: &mut Vec<String>| {
        if identity != "auto" {
            args.push("--as".to_string());
            args.push(identity.to_string());
        }
        if !profile.is_empty() {
            args.push("--profile".to_string());
            args.push(profile.to_string());
        }
        args.push("--format".to_string());
        args.push("json".to_string());
    };

    match mode {
        "file_docx" => {
            let bytes = docx_bytes.filter(|b| !b.is_empty()).ok_or_else(|| {
                "缺少可上传的 Word 文档内容，请先生成纪要或转写内容。".to_string()
            })?;
            let rel_name = format!("{}.docx", stem);
            let mut args = vec![
                "drive".to_string(),
                "+upload".to_string(),
                "--file".to_string(),
                rel_name.clone(),
                "--name".to_string(),
                rel_name.clone(),
            ];
            match destination {
                FeishuDestination::DriveRoot => {}
                FeishuDestination::DriveFolder(tok) => {
                    args.push("--folder-token".to_string());
                    args.push(tok);
                }
                FeishuDestination::WikiNode(tok) => {
                    args.push("--wiki-token".to_string());
                    args.push(tok);
                }
            }
            append_common_flags(&mut args);
            Ok(UploadCommandPlan {
                args,
                payload: FeishuUploadPayload::BinaryDocx {
                    file_name: rel_name,
                    bytes,
                },
                mode_label: "飞书云盘 Word 文件".to_string(),
            })
        }
        "file_txt" => {
            let content = plain_text
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| "缺少可上传的纯文本内容。".to_string())?;
            let rel_name = format!("{}.txt", stem);
            let mut args = vec![
                "drive".to_string(),
                "+upload".to_string(),
                "--file".to_string(),
                rel_name.clone(),
                "--name".to_string(),
                rel_name.clone(),
            ];
            match destination {
                FeishuDestination::DriveRoot => {}
                FeishuDestination::DriveFolder(tok) => {
                    args.push("--folder-token".to_string());
                    args.push(tok);
                }
                FeishuDestination::WikiNode(tok) => {
                    args.push("--wiki-token".to_string());
                    args.push(tok);
                }
            }
            append_common_flags(&mut args);
            Ok(UploadCommandPlan {
                args,
                payload: FeishuUploadPayload::TextFile {
                    file_name: rel_name,
                    content,
                },
                mode_label: "飞书云盘 TXT 文件".to_string(),
            })
        }
        "file_md" => {
            let content = markdown_text
                .or(plain_text)
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| "缺少可上传的 Markdown 内容。".to_string())?;
            let rel_name = format!("{}.md", stem);
            let mut args = vec![
                "drive".to_string(),
                "+upload".to_string(),
                "--file".to_string(),
                rel_name.clone(),
                "--name".to_string(),
                rel_name.clone(),
            ];
            match destination {
                FeishuDestination::DriveRoot => {}
                FeishuDestination::DriveFolder(tok) => {
                    args.push("--folder-token".to_string());
                    args.push(tok);
                }
                FeishuDestination::WikiNode(tok) => {
                    args.push("--wiki-token".to_string());
                    args.push(tok);
                }
            }
            append_common_flags(&mut args);
            Ok(UploadCommandPlan {
                args,
                payload: FeishuUploadPayload::TextFile {
                    file_name: rel_name,
                    content,
                },
                mode_label: "飞书云盘 Markdown 文件".to_string(),
            })
        }
        _ => {
            // Default: create an online editable Feishu cloud document ("docx")
            match destination {
                FeishuDestination::WikiNode(wiki_token) => {
                    let content = markdown_text
                        .or(plain_text)
                        .filter(|t| !t.trim().is_empty())
                        .ok_or_else(|| "缺少可写入飞书知识库的文档内容。".to_string())?;
                    let rel_name = format!("{}.md", stem);
                    let mut args = vec![
                        "docs".to_string(),
                        "+create".to_string(),
                        "--doc-format".to_string(),
                        "markdown".to_string(),
                        "--title".to_string(),
                        stem.clone(),
                        "--content".to_string(),
                        format!("@{}", rel_name),
                        "--parent-token".to_string(),
                        wiki_token,
                    ];
                    append_common_flags(&mut args);
                    Ok(UploadCommandPlan {
                        args,
                        payload: FeishuUploadPayload::TextFile {
                            file_name: rel_name,
                            content,
                        },
                        mode_label: "飞书知识库在线云文档".to_string(),
                    })
                }
                FeishuDestination::DriveRoot | FeishuDestination::DriveFolder(_) => {
                    if let Some(bytes) = docx_bytes.filter(|b| !b.is_empty()) {
                        let rel_name = format!("{}.docx", stem);
                        let mut args = vec![
                            "drive".to_string(),
                            "+import".to_string(),
                            "--type".to_string(),
                            "docx".to_string(),
                            "--file".to_string(),
                            rel_name.clone(),
                            "--name".to_string(),
                            stem.clone(),
                        ];
                        if let FeishuDestination::DriveFolder(folder_token) = destination {
                            args.push("--folder-token".to_string());
                            args.push(folder_token);
                        }
                        append_common_flags(&mut args);
                        Ok(UploadCommandPlan {
                            args,
                            payload: FeishuUploadPayload::BinaryDocx {
                                file_name: rel_name,
                                bytes,
                            },
                            mode_label: "飞书在线云文档".to_string(),
                        })
                    } else {
                        let content = markdown_text
                            .or(plain_text)
                            .filter(|t| !t.trim().is_empty())
                            .ok_or_else(|| "缺少可上传的文档内容。".to_string())?;
                        let rel_name = format!("{}.md", stem);
                        let mut args = vec![
                            "docs".to_string(),
                            "+create".to_string(),
                            "--doc-format".to_string(),
                            "markdown".to_string(),
                            "--title".to_string(),
                            stem.clone(),
                            "--content".to_string(),
                            format!("@{}", rel_name),
                        ];
                        if let FeishuDestination::DriveFolder(folder_token) = destination {
                            args.push("--parent-token".to_string());
                            args.push(folder_token);
                        }
                        append_common_flags(&mut args);
                        Ok(UploadCommandPlan {
                            args,
                            payload: FeishuUploadPayload::TextFile {
                                file_name: rel_name,
                                content,
                            },
                            mode_label: "飞书在线云文档".to_string(),
                        })
                    }
                }
            }
        }
    }
}

fn find_json_string<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    if let Some(obj) = value.as_object() {
        for key in keys {
            if let Some(s) = obj.get(*key).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
                return Some(s);
            }
        }
        for child in obj.values() {
            if let Some(found) = find_json_string(child, keys) {
                return Some(found);
            }
        }
    } else if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(found) = find_json_string(item, keys) {
                return Some(found);
            }
        }
    }
    None
}

pub fn parse_lark_upload_output(
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
    title: &str,
    mode_label: &str,
) -> Result<FeishuUploadResponse, String> {
    let parsed_json = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok();

    if exit_code == Some(0) {
        if let Some(ref json) = parsed_json {
            if json.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                let err_msg = find_json_string(json, &["message", "msg", "error"])
                    .unwrap_or("飞书接口返回失败");
                return Err(format!("上传飞书失败：{}", err_msg));
            }
            let url = find_json_string(json, &["url", "doc_url", "document_url", "applink"]).map(str::to_string);
            let token = find_json_string(
                json,
                &["document_id", "doc_token", "file_token", "token", "obj_token"],
            )
            .map(str::to_string);

            return Ok(FeishuUploadResponse {
                ok: true,
                url,
                token,
                title: title.to_string(),
                mode_label: mode_label.to_string(),
                message: format!("已上传至{}", mode_label),
            });
        }

        return Ok(FeishuUploadResponse {
            ok: true,
            url: None,
            token: None,
            title: title.to_string(),
            mode_label: mode_label.to_string(),
            message: format!("已上传至{}", mode_label),
        });
    }

    if exit_code == Some(10) {
        return Err("飞书 CLI 触发了写入安全确认，请检查目标目录权限或稍后重试。".to_string());
    }

    if let Some(json) = parsed_json {
        if let Some(err_msg) = find_json_string(&json, &["message", "msg"]) {
            return Err(format!("上传飞书失败：{}", err_msg));
        }
    }

    let detail = if !stderr.trim().is_empty() {
        stderr.trim()
    } else if !stdout.trim().is_empty() {
        stdout.trim()
    } else {
        "未知命令行错误"
    };
    Err(format!("上传飞书失败：{}", detail))
}

pub fn load_feishu_config<R: Runtime>(app: &AppHandle<R>) -> FeishuConfig {
    let Ok(store) = app.store(FEISHU_STORE_FILE) else {
        warn!("Failed to open feishu_config.json store, using defaults");
        return FeishuConfig::default();
    };
    store
        .get(FEISHU_STORE_KEY)
        .and_then(|value| serde_json::from_value::<FeishuConfig>(value).ok())
        .unwrap_or_default()
}

pub fn persist_feishu_config<R: Runtime>(
    app: &AppHandle<R>,
    config: &FeishuConfig,
) -> Result<(), String> {
    let store = app
        .store(FEISHU_STORE_FILE)
        .map_err(|e| format!("无法打开飞书配置存储：{}", e))?;
    let serialized = serde_json::to_value(config)
        .map_err(|e| format!("无法序列化飞书配置：{}", e))?;
    store.set(FEISHU_STORE_KEY, serialized);
    store
        .save()
        .map_err(|e| format!("保存飞书配置失败：{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn feishu_get_config<R: Runtime>(app: AppHandle<R>) -> Result<FeishuConfig, String> {
    Ok(load_feishu_config(&app))
}

#[tauri::command]
pub async fn feishu_save_config<R: Runtime>(
    app: AppHandle<R>,
    config: FeishuConfig,
) -> Result<FeishuConfig, String> {
    // Validate destination syntax early so user gets immediate feedback
    let _ = parse_feishu_destination(&config.destination)?;
    if !config.cli_path.trim().is_empty() {
        let _ = resolve_lark_cli_binary(&config.cli_path)?;
    }
    persist_feishu_config(&app, &config)?;
    Ok(config)
}

#[tauri::command]
pub async fn feishu_check_status<R: Runtime>(
    app: AppHandle<R>,
    cli_path: Option<String>,
    profile: Option<String>,
) -> Result<FeishuStatusResponse, String> {
    let saved = load_feishu_config(&app);
    let effective_cli = cli_path.unwrap_or(saved.cli_path);
    let effective_profile = profile.unwrap_or(saved.profile);

    let binary = match resolve_lark_cli_binary(&effective_cli) {
        Ok(path) => path,
        Err(msg) => {
            return Ok(FeishuStatusResponse {
                installed: false,
                resolved_cli_path: None,
                version: None,
                authenticated: false,
                brand: None,
                active_identity: None,
                user_name: None,
                user_ready: false,
                bot_ready: false,
                message: msg,
            });
        }
    };

    let path_env = build_augmented_path();
    let version = match tokio::time::timeout(
        Duration::from_secs(6),
        Command::new(&binary)
            .arg("--version")
            .env("PATH", &path_env)
            .output(),
    )
    .await
    {
        Ok(Ok(out)) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if text.is_empty() { None } else { Some(text) }
        }
        _ => None,
    };

    let mut status_cmd = Command::new(&binary);
    status_cmd.arg("auth").arg("status").arg("--json");
    if !effective_profile.trim().is_empty() {
        status_cmd.arg("--profile").arg(effective_profile.trim());
    }
    status_cmd.env("PATH", &path_env);

    let output = tokio::time::timeout(Duration::from_secs(12), status_cmd.output())
        .await
        .map_err(|_| "检测飞书 CLI 状态超时，请检查网络连接后重试。".to_string())?
        .map_err(|e| format!("无法运行飞书 CLI：{}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok();

    let brand = parsed
        .as_ref()
        .and_then(|v| v.get("brand"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let active_identity = parsed
        .as_ref()
        .and_then(|v| v.get("identity"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let user_obj = parsed
        .as_ref()
        .and_then(|v| v.get("identities"))
        .and_then(|v| v.get("user"));
    let bot_obj = parsed
        .as_ref()
        .and_then(|v| v.get("identities"))
        .and_then(|v| v.get("bot"));

    let user_ready = user_obj
        .and_then(|u| u.get("available"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || user_obj
            .and_then(|u| u.get("status"))
            .and_then(|v| v.as_str())
            == Some("ready");
    let bot_ready = bot_obj
        .and_then(|b| b.get("available"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || bot_obj
            .and_then(|b| b.get("status"))
            .and_then(|v| v.as_str())
            == Some("ready");
    let user_name = user_obj
        .and_then(|u| u.get("userName"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);

    let authenticated = user_ready || bot_ready;
    let message = if authenticated {
        if let Some(ref name) = user_name {
            format!("已连接飞书账号：{}", name)
        } else if bot_ready {
            "已连接飞书应用机器人身份".to_string()
        } else {
            "飞书 CLI 已登录就绪".to_string()
        }
    } else {
        "已检测到 lark-cli，但尚未完成飞书登录。请在终端运行 lark-cli auth login 后重新检测。".to_string()
    };

    Ok(FeishuStatusResponse {
        installed: true,
        resolved_cli_path: Some(binary.to_string_lossy().to_string()),
        version,
        authenticated,
        brand,
        active_identity,
        user_name,
        user_ready,
        bot_ready,
        message,
    })
}

#[tauri::command]
pub async fn feishu_upload_document<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    mode: Option<String>,
    docx_bytes: Option<Vec<u8>>,
    markdown_text: Option<String>,
    plain_text: Option<String>,
) -> Result<FeishuUploadResponse, String> {
    let config = load_feishu_config(&app);
    let binary = resolve_lark_cli_binary(&config.cli_path)?;
    let plan = build_upload_command_plan(
        &config,
        &title,
        mode.as_deref(),
        docx_bytes,
        markdown_text,
        plain_text,
    )?;

    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("创建临时上传目录失败：{}", e))?;

    match &plan.payload {
        FeishuUploadPayload::BinaryDocx { file_name, bytes } => {
            let target_path = temp_dir.path().join(file_name);
            std::fs::write(&target_path, bytes)
                .map_err(|e| format!("写入临时 Word 文档失败：{}", e))?;
        }
        FeishuUploadPayload::TextFile { file_name, content } => {
            let target_path = temp_dir.path().join(file_name);
            std::fs::write(&target_path, content.as_bytes())
                .map_err(|e| format!("写入临时文档失败：{}", e))?;
        }
    }

    info!(
        "Uploading meeting document '{}' via lark-cli ({})",
        sanitize_relative_stem(&title),
        plan.mode_label
    );

    let mut cmd = Command::new(&binary);
    cmd.args(&plan.args)
        .current_dir(temp_dir.path())
        .env("PATH", build_augmented_path());

    let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| "上传飞书超时，请检查网络连接后重试。".to_string())?
        .map_err(|e| format!("调用飞书 CLI 失败：{}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_lark_upload_output(
        output.status.code(),
        &stdout,
        &stderr,
        &sanitize_relative_stem(&title),
        &plan.mode_label,
    )
}

#[tauri::command]
pub async fn export_meeting_document<R: Runtime>(
    app: AppHandle<R>,
    default_file_name: String,
    extension: String,
    bytes: Vec<u8>,
) -> Result<ExportDocumentResponse, String> {
    let ext = match extension.trim().to_ascii_lowercase().as_str() {
        "docx" => "docx",
        "md" | "markdown" => "md",
        _ => "txt",
    };
    let filter_label = match ext {
        "docx" => "Word 文档 (*.docx)",
        "md" => "Markdown 文档 (*.md)",
        _ => "纯文本文档 (*.txt)",
    };

    let stem = sanitize_relative_stem(
        default_file_name
            .trim_end_matches(&format!(".{}", ext))
            .trim(),
    );
    let initial_name = format!("{}.{}", stem, ext);

    let app_clone = app.clone();
    let ext_owned = ext.to_string();
    let filter_owned = filter_label.to_string();
    let picked = tokio::task::spawn_blocking(move || {
        let mut builder = app_clone
            .dialog()
            .file()
            .set_file_name(&initial_name)
            .add_filter(&filter_owned, &[ext_owned.as_str()]);
        if let Some(docs_dir) = dirs::document_dir().or_else(dirs::download_dir) {
            builder = builder.set_directory(docs_dir);
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(|e| format!("打开导出保存对话框失败：{}", e))?;

    let Some(file_path) = picked else {
        return Ok(ExportDocumentResponse {
            saved: false,
            path: None,
        });
    };

    let mut target: PathBuf = file_path
        .into_path()
        .map_err(|e| format!("解析保存路径失败：{}", e))?;

    let has_matching_ext = target
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(ext));
    if !has_matching_ext {
        target.set_extension(ext);
    }

    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty() && !Path::exists(p)) {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目标目录失败：{}", e))?;
    }

    std::fs::write(&target, &bytes).map_err(|e| {
        error!("Failed to write exported file {:?}: {}", target, e);
        format!("导出文件保存失败：{}", e)
    })?;

    let saved_path = target.to_string_lossy().to_string();
    info!("Exported meeting document to {}", saved_path);
    Ok(ExportDocumentResponse {
        saved: true,
        path: Some(saved_path),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn summary_upload_text_is_cleaned_and_docx_bytes_are_preserved() {
        for (mode, destination) in [
            ("file_txt", ""), ("file_md", ""), ("docx", ""),
            ("docx", "https://acme.feishu.cn/wiki/wikcnSpace09"),
        ] {
            let config = super::FeishuConfig { cli_path: String::new(), profile: String::new(),
                identity: "user".into(), default_upload_mode: mode.into(), destination: destination.into() };
            for use_markdown in [false, true] {
                let text = "# 纪要\n- **决定**".to_string();
                let plan = super::build_upload_command_plan(&config, "纪要", None, None,
                    use_markdown.then(|| text.clone()), Some(text)).unwrap();
                match plan.payload {
                    super::FeishuUploadPayload::TextFile { content, .. } => assert_eq!(content, "纪要\n决定"),
                    _ => panic!("expected text payload"),
                }
            }
        }
        let config = super::FeishuConfig { cli_path: String::new(), profile: String::new(), identity: "user".into(),
            default_upload_mode: "file_docx".into(), destination: String::new() };
        let bytes = vec![0x50, 0x4b, b'#', b'*', b'`'];
        let plan = super::build_upload_command_plan(&config, "纪要", None, Some(bytes.clone()), None, None).unwrap();
        match plan.payload {
            super::FeishuUploadPayload::BinaryDocx { bytes: actual, .. } => assert_eq!(actual, bytes),
            _ => panic!("expected binary payload"),
        }
    }
    use super::*;

    #[test]
    fn parses_feishu_destinations_accurately() {
        assert_eq!(parse_feishu_destination("").unwrap(), FeishuDestination::DriveRoot);
        assert_eq!(
            parse_feishu_destination("https://xxx.feishu.cn/drive/folder/fldcnAbc123XYZ?from=space").unwrap(),
            FeishuDestination::DriveFolder("fldcnAbc123XYZ".to_string())
        );
        assert_eq!(
            parse_feishu_destination("https://xxx.feishu.cn/wiki/wikcnNode987#top").unwrap(),
            FeishuDestination::WikiNode("wikcnNode987".to_string())
        );
        assert_eq!(
            parse_feishu_destination("fldcnDirectToken").unwrap(),
            FeishuDestination::DriveFolder("fldcnDirectToken".to_string())
        );
        assert_eq!(
            parse_feishu_destination("wikcnDirectWiki").unwrap(),
            FeishuDestination::WikiNode("wikcnDirectWiki".to_string())
        );
        assert!(parse_feishu_destination("https://xxx.feishu.cn/docx/doxcnSingleDoc").is_err());
    }

    #[test]
    fn builds_relative_file_arguments_for_drive_import_and_wiki_create() {
        let mut config = FeishuConfig {
            cli_path: String::new(),
            identity: "user".to_string(),
            profile: "work".to_string(),
            default_upload_mode: "docx".to_string(),
            destination: "https://acme.feishu.cn/drive/folder/fldcnFolder01".to_string(),
        };
        let plan = build_upload_command_plan(
            &config,
            "11月产品评审 / 纪要",
            None,
            Some(vec![0x50, 0x4b, 0x03, 0x04]),
            Some("# 标题".to_string()),
            Some("标题".to_string()),
        )
        .unwrap();

        assert_eq!(
            plan.args,
            vec![
                "drive",
                "+import",
                "--type",
                "docx",
                "--file",
                "11月产品评审 纪要.docx",
                "--name",
                "11月产品评审 纪要",
                "--folder-token",
                "fldcnFolder01",
                "--as",
                "user",
                "--profile",
                "work",
                "--format",
                "json",
            ]
        );
        if let FeishuUploadPayload::BinaryDocx { file_name, .. } = &plan.payload {
            assert!(!file_name.contains('/'));
            assert!(!file_name.starts_with('-'));
        } else {
            panic!("expected BinaryDocx payload");
        }

        // Wiki node switches to docs +create --parent-token with @relative.md
        config.destination = "https://acme.feishu.cn/wiki/wikcnSpace09".to_string();
        let wiki_plan = build_upload_command_plan(
            &config,
            "-周会记录",
            None,
            Some(vec![1, 2, 3]),
            Some("# 周会记录\n\n内容".to_string()),
            None,
        )
        .unwrap();
        assert_eq!(
            wiki_plan.args,
            vec![
                "docs",
                "+create",
                "--doc-format",
                "markdown",
                "--title",
                "周会记录",
                "--content",
                "@周会记录.md",
                "--parent-token",
                "wikcnSpace09",
                "--as",
                "user",
                "--profile",
                "work",
                "--format",
                "json",
            ]
        );
    }

    #[test]
    fn parses_lark_cli_json_responses_with_ok_and_nested_urls() {
        let ok_json = r#"{"ok":true,"data":{"url":"https://acme.feishu.cn/docx/doxcn123","document_id":"doxcn123"}}"#;
        let parsed = parse_lark_upload_output(Some(0), ok_json, "", "测试纪要", "飞书在线云文档").unwrap();
        assert!(parsed.ok);
        assert_eq!(parsed.url.as_deref(), Some("https://acme.feishu.cn/docx/doxcn123"));
        assert_eq!(parsed.token.as_deref(), Some("doxcn123"));

        let err_json = r#"{"ok":false,"error":{"message":"missing scope drive:drive"}}"#;
        let err = parse_lark_upload_output(Some(0), err_json, "", "测试纪要", "飞书在线云文档").unwrap_err();
        assert!(err.contains("missing scope drive:drive"));
    }
}
