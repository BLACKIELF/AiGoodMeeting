//! Optional, local speaker attribution. Originals and the meeting database are never rewritten.
use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;
use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tempfile::NamedTempFile;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

const MAX_RESULT_BYTES: usize = 16 * 1024 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(4 * 60 * 60);
const INVALID_RESULT: &str = "说话人区分没有返回有效结果，原有结果已保留。";
const CANCELLED: &str = "已取消说话人区分，原有结果已保留。";
const MISSING_AUDIO: &str = "这场会议没有可用的录音文件，无法自动区分说话人。";
const INVALID_RUNTIME: &str = "本地说话人处理环境不完整，请先完成配置。";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpeakerSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpeakerTranscript {
    pub schema_version: u32,
    pub model: String,
    pub segments: Vec<SpeakerSegment>,
    pub speakers: Vec<String>,
    #[serde(default)]
    pub names: BTreeMap<String, String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Deserialize)]
struct DiarizationRuntime {
    python: PathBuf,
    script: PathBuf,
    model: PathBuf,
    whisper_model: PathBuf,
    whisper_cli: PathBuf,
    ffmpeg: PathBuf,
    #[serde(default = "default_language")]
    language: String,
}

fn default_language() -> String {
    "zh".to_string()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiarizationProgress<'a> {
    meeting_id: &'a str,
    stage: &'a str,
    message: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiarizationUpdated<'a> {
    meeting_id: &'a str,
    updated_at: &'a str,
}

#[derive(Default)]
struct JobRegistry {
    jobs: HashMap<String, Arc<CancellationToken>>,
}

impl JobRegistry {
    fn start(&mut self, meeting_id: &str) -> Result<Arc<CancellationToken>, String> {
        if self.jobs.contains_key(meeting_id) {
            return Err("这场会议正在区分说话人，请等待完成或取消。".into());
        }
        let token = Arc::new(CancellationToken::new());
        self.jobs.insert(meeting_id.to_string(), token.clone());
        Ok(token)
    }

    fn cancel(&self, meeting_id: &str) {
        if let Some(token) = self.jobs.get(meeting_id) {
            token.cancel();
        }
    }

    fn finish(&mut self, meeting_id: &str, token: &Arc<CancellationToken>) {
        if self
            .jobs
            .get(meeting_id)
            .is_some_and(|current| Arc::ptr_eq(current, token))
        {
            self.jobs.remove(meeting_id);
        }
    }

    fn commit_if_active<F>(
        &mut self,
        meeting_id: &str,
        token: &Arc<CancellationToken>,
        commit: F,
    ) -> Result<(), String>
    where
        F: FnOnce() -> Result<(), String>,
    {
        if token.is_cancelled()
            || !self
                .jobs
                .get(meeting_id)
                .is_some_and(|current| Arc::ptr_eq(current, token))
        {
            return Err(CANCELLED.into());
        }
        // The same lock protects cancellation and atomic replacement. A cancellation
        // accepted before this boundary can never publish a late result.
        commit()?;
        self.jobs.remove(meeting_id);
        Ok(())
    }
}

static JOBS: LazyLock<Mutex<JobRegistry>> = LazyLock::new(|| Mutex::new(JobRegistry::default()));

struct RegisteredJob {
    meeting_id: String,
    token: Arc<CancellationToken>,
}

impl RegisteredJob {
    fn start(meeting_id: &str) -> Result<Self, String> {
        let token = JOBS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .start(meeting_id)?;
        Ok(Self {
            meeting_id: meeting_id.to_string(),
            token,
        })
    }
}

impl Drop for RegisteredJob {
    fn drop(&mut self) {
        self.token.cancel();
        JOBS.lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .finish(&self.meeting_id, &self.token);
    }
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "无法访问本地说话人结果目录。".to_string())
}

fn result_path(app_data: &Path, meeting_id: &str) -> Result<PathBuf, String> {
    if meeting_id.trim().is_empty() || meeting_id.len() > 120 {
        return Err("会议标识无效。".into());
    }
    // The escape prefix cannot occur in unescaped identifiers, preventing collisions.
    let safe_id = if meeting_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        meeting_id.to_string()
    } else {
        let mut encoded = String::from("~");
        for byte in meeting_id.as_bytes() {
            use std::fmt::Write as _;
            let _ = write!(encoded, "{byte:02x}");
        }
        encoded
    };
    Ok(app_data.join("diarization").join(format!("{safe_id}.json")))
}

fn valid_speaker_id(id: &str) -> bool {
    id == "unknown"
        || id.strip_prefix("speaker_").is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix.len() <= 10
                && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 80 && !name.chars().any(char::is_control)
}

fn validate_transcript(transcript: &SpeakerTranscript) -> Result<(), String> {
    if transcript.schema_version != 1
        || transcript.model.trim().is_empty()
        || transcript.model.len() > 1024
        || transcript.model.chars().any(char::is_control)
        || transcript.segments.is_empty()
        || transcript.segments.len() > 100_000
        || transcript.speakers.is_empty()
        || transcript.speakers.len() > 256
        || transcript.warnings.len() > 256
    {
        return Err(INVALID_RESULT.into());
    }
    let mut ids = HashSet::new();
    for speaker in &transcript.speakers {
        if !valid_speaker_id(speaker) || !ids.insert(speaker.as_str()) {
            return Err(INVALID_RESULT.into());
        }
    }
    let mut previous_start = 0.0;
    for segment in &transcript.segments {
        if !segment.start.is_finite()
            || !segment.end.is_finite()
            || segment.start < 0.0
            || segment.end <= segment.start
            || segment.end > 7.0 * 24.0 * 60.0 * 60.0
            || segment.start < previous_start
            || !ids.contains(segment.speaker.as_str())
            || segment.text.trim().is_empty()
            || segment.text.len() > 100_000
            || segment
                .text
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
        {
            return Err(INVALID_RESULT.into());
        }
        previous_start = segment.start;
    }
    if transcript
        .names
        .iter()
        .any(|(id, name)| !ids.contains(id.as_str()) || !valid_name(name))
        || transcript.warnings.iter().any(|warning| {
            warning.len() > 2000
                || warning.chars().any(|character| {
                    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
                })
        })
    {
        return Err(INVALID_RESULT.into());
    }
    Ok(())
}

fn default_name(id: &str) -> String {
    if id == "unknown" {
        "未确定说话人".into()
    } else {
        id.strip_prefix("speaker_")
            .and_then(|number| number.parse::<u64>().ok())
            .map(|number| format!("说话人 {}", number + 1))
            .unwrap_or_else(|| id.to_string())
    }
}

fn touch(transcript: &mut SpeakerTranscript) {
    let now = Utc::now();
    let next = DateTime::parse_from_rfc3339(&transcript.updated_at)
        .ok()
        .map(|previous| previous.with_timezone(&Utc))
        .filter(|previous| *previous >= now)
        .map(|previous| previous + ChronoDuration::nanoseconds(1))
        .unwrap_or(now);
    transcript.updated_at = next.to_rfc3339_opts(SecondsFormat::Nanos, true);
}

fn prepare_result(bytes: &[u8]) -> Result<SpeakerTranscript, String> {
    let json = std::str::from_utf8(bytes).map_err(|_| INVALID_RESULT.to_string())?;
    let mut transcript: SpeakerTranscript =
        serde_json::from_str(json).map_err(|_| INVALID_RESULT.to_string())?;
    // Names and revision are owned by the app, rather than executable output.
    transcript.names.clear();
    transcript.updated_at.clear();
    validate_transcript(&transcript)?;
    for id in &transcript.speakers {
        transcript.names.insert(id.clone(), default_name(id));
    }
    touch(&mut transcript);
    Ok(transcript)
}

pub(crate) fn load_speaker_transcript(
    app_data: &Path,
    meeting_id: &str,
) -> Result<Option<SpeakerTranscript>, String> {
    let path = result_path(app_data, meeting_id)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取已保存的说话人结果。".into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_RESULT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取已保存的说话人结果。".to_string())?;
    if bytes.len() > MAX_RESULT_BYTES {
        return Err("已保存的说话人结果过大，无法读取。".into());
    }
    let transcript: SpeakerTranscript =
        serde_json::from_slice(&bytes).map_err(|_| "已保存的说话人结果损坏。".to_string())?;
    validate_transcript(&transcript)?;
    if DateTime::parse_from_rfc3339(&transcript.updated_at).is_err() {
        return Err("已保存的说话人结果缺少有效版本信息。".into());
    }
    Ok(Some(transcript))
}

fn atomic_save(path: &Path, transcript: &SpeakerTranscript) -> Result<(), String> {
    validate_transcript(transcript)?;
    let bytes = serde_json::to_vec_pretty(transcript).map_err(|_| INVALID_RESULT.to_string())?;
    if bytes.len() > MAX_RESULT_BYTES {
        return Err("说话人结果过大，未保存；原有结果已保留。".into());
    }
    let directory = path.parent().ok_or_else(|| "结果目录无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|_| "无法创建本地说话人结果目录。".to_string())?;
    let mut temporary = NamedTempFile::new_in(directory)
        .map_err(|_| "无法保存说话人结果，原有结果已保留。".to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "无法保存说话人结果，原有结果已保留。".to_string())?;
    temporary
        .persist(path)
        .map_err(|_| "无法保存说话人结果，原有结果已保留。".to_string())?;
    Ok(())
}

fn load_runtime(app_data: &Path) -> Result<DiarizationRuntime, String> {
    let path = app_data.join("diarization-runtime.json");
    let metadata = fs::metadata(&path)
        .map_err(|_| "本地说话人模型尚未配置，暂时无法自动区分。".to_string())?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err(INVALID_RUNTIME.into());
    }
    let bytes = fs::read(path).map_err(|_| INVALID_RUNTIME.to_string())?;
    let runtime: DiarizationRuntime =
        serde_json::from_slice(&bytes).map_err(|_| INVALID_RUNTIME.to_string())?;
    for path in [&runtime.model, &runtime.whisper_model] {
        if !path.is_absolute() || !path.exists() {
            return Err("本地说话人模型文件缺失，请先完成配置。".into());
        }
    }
    if !runtime.model.is_dir() || !runtime.whisper_model.is_file() {
        return Err("本地说话人模型文件不完整，请先完成配置。".into());
    }
    for path in [
        &runtime.python,
        &runtime.script,
        &runtime.whisper_cli,
        &runtime.ffmpeg,
    ] {
        if !path.is_absolute() || !path.is_file() {
            return Err(INVALID_RUNTIME.into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&runtime.python, &runtime.whisper_cli, &runtime.ffmpeg] {
            let permissions = fs::metadata(path)
                .map_err(|_| INVALID_RUNTIME.to_string())?
                .permissions();
            if permissions.mode() & 0o111 == 0 {
                return Err(INVALID_RUNTIME.into());
            }
        }
    }
    if runtime.language.is_empty()
        || runtime.language.len() > 16
        || !runtime
            .language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(INVALID_RUNTIME.into());
    }
    Ok(runtime)
}

async fn ensure_meeting_exists(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<(), String> {
    MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|_| "无法读取会议记录。".to_string())?
        .ok_or_else(|| "找不到这场会议。".to_string())?;
    Ok(())
}

async fn meeting_audio(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<PathBuf, String> {
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|_| "无法读取会议记录。".to_string())?
        .ok_or_else(|| "找不到这场会议。".to_string())?;
    let folder = meeting
        .folder_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| MISSING_AUDIO.to_string())?;
    if !folder.is_absolute() || !folder.is_dir() {
        return Err(MISSING_AUDIO.into());
    }
    let folder = folder
        .canonicalize()
        .map_err(|_| MISSING_AUDIO.to_string())?;
    let audio = crate::audio::retranscription::find_audio_file(&folder)
        .map_err(|_| MISSING_AUDIO.to_string())?
        .canonicalize()
        .map_err(|_| MISSING_AUDIO.to_string())?;
    let metadata = fs::metadata(&audio).map_err(|_| MISSING_AUDIO.to_string())?;
    if !audio.starts_with(&folder) || !metadata.is_file() || metadata.len() == 0 {
        return Err(MISSING_AUDIO.into());
    }
    Ok(audio)
}

struct OwnedProcessGroup {
    pid: Option<u32>,
    armed: bool,
}

impl OwnedProcessGroup {
    fn signal(&self, signal: i32) {
        #[cfg(unix)]
        if let Some(pid) = self.pid.and_then(|pid| i32::try_from(pid).ok()) {
            // Only the group established for this owned child is ever targeted.
            unsafe { libc::kill(-pid, signal) };
        }
        #[cfg(not(unix))]
        let _ = signal;
    }
}

impl Drop for OwnedProcessGroup {
    fn drop(&mut self) {
        if self.armed {
            self.signal(9);
        }
    }
}

async fn terminate_child(child: &mut Child, group: &mut OwnedProcessGroup) {
    group.signal(15);
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    // Python may already have exited while Whisper is still shutting down.
    group.signal(9);
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    group.armed = false;
}

async fn read_stdout(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_RESULT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| INVALID_RESULT.to_string())?;
    if bytes.len() > MAX_RESULT_BYTES {
        return Err("说话人结果过大，原有结果已保留。".into());
    }
    Ok(bytes)
}

async fn run_python(
    runtime: &DiarizationRuntime,
    audio: &Path,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, String> {
    let mut command = Command::new(&runtime.python);
    command
        .arg(&runtime.script)
        .arg("--audio")
        .arg(audio)
        .arg("--whisper-model")
        .arg(&runtime.whisper_model)
        .arg("--diarization-model")
        .arg(&runtime.model)
        .arg("--whisper-cli")
        .arg(&runtime.whisper_cli)
        .arg("--ffmpeg")
        .arg(&runtime.ffmpeg)
        .arg("--language")
        .arg(&runtime.language)
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command.spawn().map_err(|_| INVALID_RUNTIME.to_string())?;
    let mut group = OwnedProcessGroup {
        pid: child.id(),
        armed: true,
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| INVALID_RUNTIME.to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| INVALID_RUNTIME.to_string())?;
    let output = {
        let collect = async {
            let status = async { child.wait().await.map_err(|_| INVALID_RUNTIME.to_string()) };
            // Drain stderr with bounded memory; never expose or log private transcript text.
            let drain = async {
                tokio::io::copy(&mut stderr, &mut tokio::io::sink())
                    .await
                    .map(|_| ())
                    .map_err(|_| INVALID_RUNTIME.to_string())
            };
            let (status, bytes, ()) = tokio::try_join!(status, read_stdout(stdout), drain)?;
            Ok::<_, String>((status, bytes))
        };
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(CANCELLED.to_string()),
            _ = tokio::time::sleep(JOB_TIMEOUT) => Err("说话人区分用时过长，已停止处理，原有结果已保留。".to_string()),
            result = collect => result,
        }
    };
    match output {
        Ok((status, bytes)) if status.success() && !cancellation.is_cancelled() => {
            group.armed = false;
            Ok(bytes)
        }
        Ok(_) => {
            terminate_child(&mut child, &mut group).await;
            if cancellation.is_cancelled() {
                Err(CANCELLED.into())
            } else {
                Err("说话人区分失败，原有结果已保留。请检查本地处理环境与模型。".into())
            }
        }
        Err(error) => {
            terminate_child(&mut child, &mut group).await;
            Err(error)
        }
    }
}

fn progress<R: Runtime>(app: &AppHandle<R>, meeting_id: &str, stage: &str, message: &str) {
    let _ = app.emit(
        "diarization-progress",
        DiarizationProgress {
            meeting_id,
            stage,
            message,
        },
    );
}

fn updated<R: Runtime>(app: &AppHandle<R>, meeting_id: &str, transcript: &SpeakerTranscript) {
    let _ = app.emit(
        "diarization-updated",
        DiarizationUpdated {
            meeting_id,
            updated_at: &transcript.updated_at,
        },
    );
}

#[tauri::command]
pub async fn get_speaker_transcript<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<SpeakerTranscript>, String> {
    ensure_meeting_exists(state.db_manager.pool(), &meeting_id).await?;
    load_speaker_transcript(&app_data_dir(&app)?, &meeting_id)
}

#[tauri::command]
pub async fn diarize_meeting<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<SpeakerTranscript, String> {
    let app_data = app_data_dir(&app)?;
    let path = result_path(&app_data, &meeting_id)?;
    let job = RegisteredJob::start(&meeting_id)?;
    let result = async {
        progress(&app, &meeting_id, "preparing", "正在检查录音和本地模型…");
        let audio = meeting_audio(state.db_manager.pool(), &meeting_id).await?;
        let runtime = load_runtime(&app_data)?;
        if job.token.is_cancelled() {
            return Err(CANCELLED.to_string());
        }
        progress(
            &app,
            &meeting_id,
            "processing",
            "正在本地区分说话人，较长录音需要更多时间…",
        );
        let bytes = run_python(&runtime, &audio, &job.token).await?;
        let transcript = prepare_result(&bytes)?;
        progress(&app, &meeting_id, "saving", "正在保存说话人结果…");
        JOBS.lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .commit_if_active(&meeting_id, &job.token, || atomic_save(&path, &transcript))?;
        updated(&app, &meeting_id, &transcript);
        progress(
            &app,
            &meeting_id,
            "completed",
            "已保存说话人结果，可继续修改。",
        );
        Ok(transcript)
    }
    .await;
    if let Err(error) = &result {
        progress(
            &app,
            &meeting_id,
            if job.token.is_cancelled() {
                "cancelled"
            } else {
                "error"
            },
            error,
        );
    }
    result
}

#[tauri::command]
pub async fn cancel_diarization(meeting_id: String) -> Result<(), String> {
    JOBS.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .cancel(&meeting_id);
    Ok(())
}

fn rename(transcript: &mut SpeakerTranscript, speaker_id: &str, name: &str) -> Result<(), String> {
    if !transcript.speakers.iter().any(|id| id == speaker_id) {
        return Err("找不到这个说话人，请刷新后重试。".into());
    }
    let name = name.trim();
    if !valid_name(name) {
        return Err("请输入 1 至 80 个字的姓名，且不要换行。".into());
    }
    transcript
        .names
        .insert(speaker_id.to_string(), name.to_string());
    Ok(())
}

fn merge(
    transcript: &mut SpeakerTranscript,
    source_id: &str,
    target_id: &str,
) -> Result<(), String> {
    if source_id == target_id {
        return Err("请选择两个不同的说话人。".into());
    }
    if !transcript.speakers.iter().any(|id| id == source_id)
        || !transcript.speakers.iter().any(|id| id == target_id)
    {
        return Err("找不到要合并的说话人，请刷新后重试。".into());
    }
    for segment in &mut transcript.segments {
        if segment.speaker == source_id {
            segment.speaker = target_id.to_string();
        }
    }
    transcript.speakers.retain(|id| id != source_id);
    transcript.names.remove(source_id);
    Ok(())
}

fn reassign(
    transcript: &mut SpeakerTranscript,
    segment_index: usize,
    speaker_id: &str,
) -> Result<(), String> {
    if segment_index >= transcript.segments.len() {
        return Err("找不到这段发言，请刷新后重试。".into());
    }
    if speaker_id == "unknown" && !transcript.speakers.iter().any(|id| id == speaker_id) {
        transcript.speakers.push("unknown".into());
        transcript
            .names
            .insert("unknown".into(), default_name("unknown"));
    }
    if !transcript.speakers.iter().any(|id| id == speaker_id) {
        return Err("找不到这个说话人，请刷新后重试。".into());
    }
    transcript.segments[segment_index].speaker = speaker_id.to_string();
    Ok(())
}

async fn edit_transcript<R: Runtime, F>(
    app: &AppHandle<R>,
    state: &AppState,
    meeting_id: &str,
    edit: F,
) -> Result<SpeakerTranscript, String>
where
    F: FnOnce(&mut SpeakerTranscript) -> Result<(), String>,
{
    ensure_meeting_exists(state.db_manager.pool(), meeting_id).await?;
    let app_data = app_data_dir(app)?;
    let path = result_path(&app_data, meeting_id)?;
    let transcript = {
        let registry = JOBS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if registry.jobs.contains_key(meeting_id) {
            return Err("正在区分说话人，请完成或取消后再修改。".into());
        }
        let mut transcript = load_speaker_transcript(&app_data, meeting_id)?
            .ok_or_else(|| "请先完成说话人区分，再修改结果。".to_string())?;
        let before = transcript.clone();
        edit(&mut transcript)?;
        if transcript != before {
            touch(&mut transcript);
            atomic_save(&path, &transcript)?;
        }
        transcript
    };
    updated(app, meeting_id, &transcript);
    Ok(transcript)
}

#[tauri::command]
pub async fn rename_speaker<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    speaker_id: String,
    name: String,
) -> Result<SpeakerTranscript, String> {
    edit_transcript(&app, &state, &meeting_id, |transcript| {
        rename(transcript, &speaker_id, &name)
    })
    .await
}

#[tauri::command]
pub async fn merge_speakers<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    source_id: String,
    target_id: String,
) -> Result<SpeakerTranscript, String> {
    edit_transcript(&app, &state, &meeting_id, |transcript| {
        merge(transcript, &source_id, &target_id)
    })
    .await
}

#[tauri::command]
pub async fn set_segment_speaker<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    segment_index: usize,
    speaker_id: String,
) -> Result<SpeakerTranscript, String> {
    edit_transcript(&app, &state, &meeting_id, |transcript| {
        reassign(transcript, segment_index, &speaker_id)
    })
    .await
}

pub(crate) fn summary_text(transcript: &SpeakerTranscript) -> String {
    transcript
        .segments
        .iter()
        .map(|segment| {
            let seconds = segment.start.floor() as u64;
            let timestamp = format!(
                "{:02}:{:02}:{:02}",
                seconds / 3600,
                seconds / 60 % 60,
                seconds % 60
            );
            let name = transcript
                .names
                .get(&segment.speaker)
                .cloned()
                .unwrap_or_else(|| default_name(&segment.speaker));
            let text = segment
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            format!("[{timestamp}] {name}: {text}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> SpeakerTranscript {
        let json = br#"{"schema_version":1,"model":"local-test","segments":[{"start":0.0,"end":1.2,"speaker":"speaker_0","text":"First decision"},{"start":1.2,"end":3.0,"speaker":"speaker_1","text":"Second decision"}],"speakers":["speaker_0","speaker_1"],"warnings":[]}"#;
        prepare_result(json).unwrap()
    }

    #[test]
    fn rejects_empty_non_finite_negative_and_unlisted_results() {
        let original = fixture();
        let mut result = original.clone();
        result.segments.clear();
        assert!(validate_transcript(&result).is_err());
        for value in [f64::NAN, f64::INFINITY, -1.0] {
            let mut result = original.clone();
            result.segments[0].start = value;
            assert!(validate_transcript(&result).is_err());
        }
        let mut result = original.clone();
        result.segments[0].end = 0.0;
        assert!(validate_transcript(&result).is_err());
        let mut result = original.clone();
        result.segments[0].speaker = "speaker_2".into();
        assert!(validate_transcript(&result).is_err());
        let mut result = original;
        result.segments[1].start = -0.1;
        assert!(validate_transcript(&result).is_err());
        assert!(prepare_result(b"not json").is_err());
        assert!(prepare_result(&[0xff]).is_err());
    }

    #[test]
    fn rename_preserves_ids_and_merge_preserves_target_alias() {
        let mut transcript = fixture();
        rename(&mut transcript, "speaker_0", " Alice ").unwrap();
        rename(&mut transcript, "speaker_1", "Bob").unwrap();
        assert_eq!(transcript.segments[0].speaker, "speaker_0");
        assert!(rename(&mut transcript, "speaker_0", "\n").is_err());
        assert!(merge(&mut transcript, "speaker_0", "speaker_0").is_err());
        assert!(merge(&mut transcript, "speaker_2", "speaker_1").is_err());
        merge(&mut transcript, "speaker_0", "speaker_1").unwrap();
        assert_eq!(transcript.speakers, vec!["speaker_1"]);
        assert!(!transcript.names.contains_key("speaker_0"));
        assert_eq!(transcript.names["speaker_1"], "Bob");
        assert!(transcript
            .segments
            .iter()
            .all(|segment| segment.speaker == "speaker_1"));
        validate_transcript(&transcript).unwrap();
    }

    #[test]
    fn correction_changes_one_segment_and_can_mark_unknown() {
        let mut transcript = fixture();
        let second = transcript.segments[1].clone();
        reassign(&mut transcript, 0, "speaker_1").unwrap();
        assert_eq!(transcript.segments[0].speaker, "speaker_1");
        assert_eq!(transcript.segments[1], second);
        reassign(&mut transcript, 0, "unknown").unwrap();
        assert_eq!(transcript.segments[0].speaker, "unknown");
        assert!(transcript.speakers.contains(&"unknown".into()));
        assert!(reassign(&mut transcript, 2, "speaker_1").is_err());
        assert!(reassign(&mut transcript, 0, "../../wrong").is_err());
        validate_transcript(&transcript).unwrap();
    }

    #[test]
    fn storage_escapes_paths_without_collisions() {
        let base = Path::new("/test/app");
        for id in ["../escape", "会议 / 1", "a.b", "~2e2e2f"] {
            let path = result_path(base, id).unwrap();
            assert_eq!(path.parent().unwrap(), base.join("diarization"));
            assert_eq!(path.components().count(), 5);
        }
        assert_ne!(
            result_path(base, "../").unwrap(),
            result_path(base, "~2e2e2f").unwrap()
        );
        assert_eq!(
            result_path(base, "meeting-1").unwrap(),
            base.join("diarization/meeting-1.json")
        );
        assert!(result_path(base, "").is_err());
    }

    #[test]
    fn cancellation_before_commit_preserves_saved_result_and_blocks_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let path = result_path(directory.path(), "meeting-1").unwrap();
        let saved = fixture();
        atomic_save(&path, &saved).unwrap();
        let before = fs::read(&path).unwrap();
        let mut registry = JobRegistry::default();
        let token = registry.start("meeting-1").unwrap();
        assert!(registry.start("meeting-1").is_err());
        registry.cancel("meeting-1");
        let mut replacement = saved.clone();
        rename(&mut replacement, "speaker_0", "Late result").unwrap();
        assert!(registry
            .commit_if_active("meeting-1", &token, || atomic_save(&path, &replacement))
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        registry.finish("meeting-1", &token);
        let next = registry.start("meeting-1").unwrap();
        registry.finish("meeting-1", &token);
        assert!(registry
            .commit_if_active("meeting-1", &token, || panic!("stale job committed"))
            .is_err());
        registry
            .commit_if_active("meeting-1", &next, || atomic_save(&path, &replacement))
            .unwrap();
        registry.cancel("meeting-1");
        assert_eq!(
            load_speaker_transcript(directory.path(), "meeting-1")
                .unwrap()
                .unwrap(),
            replacement
        );
    }

    #[test]
    fn invalid_replacement_cannot_destroy_saved_result() {
        let directory = tempfile::tempdir().unwrap();
        let path = result_path(directory.path(), "meeting-1").unwrap();
        let mut result = fixture();
        atomic_save(&path, &result).unwrap();
        let before = fs::read(&path).unwrap();
        result.segments[0].end = -1.0;
        assert!(atomic_save(&path, &result).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn summary_resolves_aliases_and_revision_moves_forward() {
        let mut result = fixture();
        rename(&mut result, "speaker_0", "张老师").unwrap();
        result.segments[0].start = 3661.5;
        result.segments[0].end = 3662.0;
        result.segments.truncate(1);
        assert_eq!(summary_text(&result), "[01:01:01] 张老师: First decision");
        let revision = result.updated_at.clone();
        touch(&mut result);
        assert!(result.updated_at > revision);
    }
}
