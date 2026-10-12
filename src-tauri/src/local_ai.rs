use base64::Engine as _;
use futures_util::StreamExt;
use log::{debug, error, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

const RUNTIME_MANIFEST_JSON: &str = include_str!("../local-ai-runtime-manifest.json");
const LOCAL_AI_COMPLETION_TIMEOUT_SECONDS: u64 = 180;
const LOCAL_AI_PERSISTENT_CONVERSATION_TIMEOUT_SECONDS: u64 = 120;
const LOCAL_AI_NATIVE_TOOL_PROBE_TIMEOUT_SECONDS: u64 = 120;
const LOCAL_AI_DOWNLOAD_CANCELLED: &str = "__local_ai_download_cancelled__";
const NATIVE_TOOL_CALLS_DISABLED_MESSAGE: &str =
    "Native LiteRT tool calls are disabled for this runtime.";

fn persistent_conversation_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(LOCAL_AI_PERSISTENT_CONVERSATION_TIMEOUT_SECONDS)
}

#[repr(C)]
struct KfLiteRtEngine {
    _private: [u8; 0],
}

type KfLiteRtChunkCallback = unsafe extern "C" fn(*const c_char, *mut c_void);

extern "C" {
    fn kf_litert_create_engine(
        model_path: *const c_char,
        native_lib_dir: *const c_char,
        cache_dir: *const c_char,
        use_gpu: bool,
        enable_speculative_decoding: bool,
        max_num_tokens: i32,
        error_out: *mut *mut c_char,
    ) -> *mut KfLiteRtEngine;
    fn kf_litert_destroy_engine(engine: *mut KfLiteRtEngine);
    fn kf_litert_send_message(
        engine: *mut KfLiteRtEngine,
        message_json: *const c_char,
        system_json: *const c_char,
        tools_json: *const c_char,
        history_json: *const c_char,
        extra_context_json: *const c_char,
        max_output_tokens: i32,
        visual_token_budget: i32,
        enable_constrained_decoding: bool,
        callback: KfLiteRtChunkCallback,
        user_data: *mut c_void,
        error_out: *mut *mut c_char,
    ) -> i32;
    fn kf_litert_cancel(engine: *mut KfLiteRtEngine);
    fn kf_litert_get_active_stream_count(engine: *mut KfLiteRtEngine) -> i32;
    fn kf_litert_free_string(value: *mut c_char);
    fn kf_litert_set_sampler_params(
        engine: *mut KfLiteRtEngine,
        sampler_type: i32,
        top_k: i32,
        top_p: f32,
        temperature: f32,
        seed: i32,
    ) -> i32;
    fn kf_litert_clear_sampler_params(engine: *mut KfLiteRtEngine);

    // Persistent conversation lifecycle
    fn kf_litert_create_conversation(
        engine: *mut KfLiteRtEngine,
        system_json: *const c_char,
        tools_json: *const c_char,
        messages_json: *const c_char,
        extra_context_json: *const c_char,
        error_out: *mut *mut c_char,
    ) -> i32;
    fn kf_litert_send_message_to_conversation(
        engine: *mut KfLiteRtEngine,
        message_json: *const c_char,
        max_output_tokens: i32,
        callback: KfLiteRtChunkCallback,
        user_data: *mut c_void,
        error_out: *mut *mut c_char,
    ) -> i32;
    fn kf_litert_destroy_conversation(engine: *mut KfLiteRtEngine);
    fn kf_litert_get_conversation_token_count(engine: *mut KfLiteRtEngine) -> i32;
    fn kf_litert_get_conversation_benchmark(
        engine: *mut KfLiteRtEngine,
        time_to_first_token_seconds: *mut f64,
        prefill_token_count: *mut i32,
        decode_token_count: *mut i32,
        prefill_tokens_per_second: *mut f64,
        decode_tokens_per_second: *mut f64,
    ) -> i32;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifestCapabilities {
    pub supports_constrained_tool_calls: bool,
    pub supports_native_tool_calls: bool,
    pub supports_reasoning_separation: bool,
    pub supports_vision_inputs: bool,
    #[serde(default)]
    pub supports_persistent_conversation: bool,
    #[serde(default)]
    pub supports_persistent_conversation_with_vision: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifestRuntime {
    runtime_version: String,
    model_repo_id: String,
    model_revision: String,
    model_artifact_id: String,
    model_file_name: String,
    remote_artifact_filename: String,
    model_expected_size_bytes: u64,
    model_sha256: String,
    #[serde(default)]
    archived_mirror: Option<ArchivedModelMirror>,
    #[serde(default)]
    remote_mmproj_filename: Option<String>,
    capabilities: RuntimeManifestCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ArchivedModelPart {
    url: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchivedModelMirror {
    model_revision: String,
    model_sha256: String,
    model_expected_size_bytes: u64,
    parts: Vec<ArchivedModelPart>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    client_runtime_id: String,
    litert_lm: RuntimeManifestRuntime,
    context_size_tokens: u64,
}

fn load_runtime_manifest() -> RuntimeManifest {
    serde_json::from_str::<RuntimeManifest>(RUNTIME_MANIFEST_JSON)
        .expect("local-ai-runtime-manifest.json is invalid")
}

pub fn validate_manifest_consistency() -> Result<(), String> {
    let manifest = load_runtime_manifest();
    if manifest.client_runtime_id.trim().is_empty() {
        return Err("local-ai-runtime-manifest.json clientRuntimeId is empty".to_string());
    }
    let descriptor = descriptor_from_manifest();
    if descriptor.expected_size_bytes < 8 || !valid_sha256(&descriptor.expected_sha256) {
        return Err("The local AI manifest has an invalid model size or SHA-256.".to_string());
    }
    if descriptor.model_file_name.trim().is_empty()
        || Path::new(&descriptor.model_file_name)
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(
            "The local AI model filename must stay inside the model directory.".to_string(),
        );
    }
    if descriptor.mmproj_file_name.is_some() {
        return Err(
            "A separate vision model requires its own pinned integrity contract.".to_string(),
        );
    }
    if let Some(mirror) = &descriptor.archived_mirror {
        validate_archived_mirror(mirror, &descriptor)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum LocalAiInstallState {
    #[default]
    NotDownloaded,
    Downloading,
    Verifying,
    Installed,
    Loading,
    Ready,
    Failed,
    RepairNeeded,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiRuntimeKind {
    LitertLm,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiWorkloadClass {
    Interactive,
    #[default]
    UserBatch,
    Background,
}

#[derive(Debug, Clone)]
struct LocalAiRuntimeDescriptor {
    runtime_version: String,
    model_repo_id: String,
    model_revision: String,
    model_artifact_id: String,
    model_file_name: String,
    remote_artifact_filename: String,
    expected_size_bytes: u64,
    expected_sha256: String,
    archived_mirror: Option<ArchivedModelMirror>,
    mmproj_file_name: Option<String>,
}

fn descriptor_from_manifest() -> LocalAiRuntimeDescriptor {
    descriptor_from_manifest_with_runtime_override(
        std::env::var_os("KWANTFLOW_LITERT_LM_RUNTIME_DIR").is_some(),
    )
}

fn descriptor_from_manifest_with_runtime_override(
    runtime_override_present: bool,
) -> LocalAiRuntimeDescriptor {
    let manifest = load_runtime_manifest();
    // An override can load dispatch libraries outside the compiled byte closure.
    // Its configured presence invalidates cache reuse even before the path exists.
    let native_fingerprint = if runtime_override_present {
        "unknown"
    } else {
        env!("KWANTFLOW_NATIVE_RUNTIME_SHA256")
    };
    LocalAiRuntimeDescriptor {
        runtime_version: format!(
            "{}+native-sha256:{}",
            manifest.litert_lm.runtime_version, native_fingerprint
        ),
        model_repo_id: manifest.litert_lm.model_repo_id,
        model_artifact_id: format!(
            "{}@{}+sha256:{}",
            manifest.litert_lm.model_artifact_id,
            manifest.litert_lm.model_revision,
            manifest.litert_lm.model_sha256
        ),
        model_revision: manifest.litert_lm.model_revision,
        model_file_name: manifest.litert_lm.model_file_name,
        remote_artifact_filename: manifest.litert_lm.remote_artifact_filename,
        expected_size_bytes: manifest.litert_lm.model_expected_size_bytes,
        expected_sha256: manifest.litert_lm.model_sha256,
        archived_mirror: manifest.litert_lm.archived_mirror,
        mmproj_file_name: manifest.litert_lm.remote_mmproj_filename,
    }
}

#[derive(Debug, Clone)]
struct NativeModelPaths {
    final_model_path: PathBuf,
    partial_model_path: PathBuf,
    partial_identity_path: PathBuf,
    download_lock_path: PathBuf,
    final_mmproj_path: Option<PathBuf>,
    cache_dir: PathBuf,
}

impl NativeModelPaths {
    fn from_root(root: &Path, descriptor: &LocalAiRuntimeDescriptor) -> Self {
        let final_model_path = root.join("models").join(&descriptor.model_file_name);
        let with_suffix = |suffix: &str| {
            let mut name = final_model_path
                .file_name()
                .unwrap_or_default()
                .to_os_string();
            name.push(suffix);
            final_model_path.with_file_name(name)
        };
        let final_mmproj_path = descriptor
            .mmproj_file_name
            .as_ref()
            .map(|name| root.join("models").join(name));
        let cache_dir = root.join("cache").join("litert").join(
            final_model_path
                .parent()
                .and_then(Path::file_name)
                .unwrap_or_default(),
        );
        Self {
            partial_model_path: with_suffix(".partial"),
            partial_identity_path: with_suffix(".partial.json"),
            download_lock_path: with_suffix(".download.lock"),
            final_model_path,
            final_mmproj_path,
            cache_dir,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadProgress {
    pub stage: String,
    pub label: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCapabilityProbeDiagnostics {
    pub supports_constrained_tool_calls: bool,
    pub supports_native_tool_calls: bool,
    pub supports_reasoning_separation: bool,
    pub supports_vision_inputs: bool,
    pub supports_persistent_conversation: bool,
    pub supports_persistent_conversation_with_vision: bool,
    pub checked_elapsed_ms: Option<u64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDiagnostics {
    pub active_launch_profile: String,
    pub startup_elapsed_ms: Option<u64>,
    pub image_probe_elapsed_ms: Option<u64>,
    pub last_completion_elapsed_ms: Option<u64>,
    pub last_failure_class: Option<String>,
    pub last_timeout_stage: Option<String>,
    pub gpu_acceleration: String,
    pub context_size_tokens: Option<u64>,
    pub active_stream_count: u32,
    pub capability_probe: LocalAiCapabilityProbeDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    pub runtime_kind: LocalAiRuntimeKind,
    pub runtime_version: String,
    pub model_repo_id: String,
    pub model_artifact_id: String,
    pub model_file_name: String,
    pub mmproj_file_name: Option<String>,
    pub expected_download_bytes: u64,
    pub install_state: LocalAiInstallState,
    pub runtime_available: bool,
    pub model_ready: bool,
    pub supports_image_inputs: bool,
    pub supports_native_tool_calls: bool,
    pub active_download: Option<LocalAiDownloadProgress>,
    pub last_error: Option<String>,
    pub diagnostics: LocalAiDiagnostics,
}

#[derive(Debug, Clone)]
struct VerificationFingerprint {
    algorithm_version: u8,
    path: PathBuf,
    len: u64,
    modified_unix_ns: u128,
    sha256: String,
    format_sig: String,
}

#[derive(Debug, Clone)]
struct ActiveCompletion {
    request_id: String,
    workload_class: LocalAiWorkloadClass,
    abort: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
struct LocalAiMutableState {
    install_state: LocalAiInstallState,
    active_download: Option<LocalAiDownloadProgress>,
    last_error: Option<String>,
    download_in_progress: bool,
    download_cancel_requested: bool,
    download_abort: Arc<AtomicBool>,
    verification_cache: Option<VerificationFingerprint>,
    pending_completions: HashMap<String, Arc<AtomicBool>>,
    active_completion: Option<ActiveCompletion>,
    last_completion_elapsed_ms: Option<u64>,
    capability_probe: Option<LocalAiCapabilityProbeDiagnostics>,
    runtime_poisoned: bool,
    lifecycle_gate: Arc<AsyncMutex<()>>,
    unload_generation: u64,
    unloads_in_progress: u32,
    inference_gate: Arc<AsyncMutex<()>>,
}

fn ensure_completion_not_cancelled(abort: Option<&AtomicBool>) -> Result<(), String> {
    if abort.is_some_and(|abort| abort.load(Ordering::SeqCst)) {
        return Err("Kwantflow AI completion was cancelled.".to_string());
    }
    Ok(())
}

async fn acquire_cancellable_gate(
    gate: Arc<AsyncMutex<()>>,
    abort: Option<&AtomicBool>,
) -> Result<OwnedMutexGuard<()>, String> {
    ensure_completion_not_cancelled(abort)?;
    let lock = gate.lock_owned();
    tokio::pin!(lock);
    let guard = loop {
        tokio::select! {
            guard = &mut lock => break guard,
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)), if abort.is_some() => {
                ensure_completion_not_cancelled(abort)?;
            }
        }
    };
    ensure_completion_not_cancelled(abort)?;
    Ok(guard)
}

async fn acquire_runtime_lifecycle(
    manager: &LocalAiRuntimeManager,
    abort: Option<&AtomicBool>,
) -> Result<OwnedMutexGuard<()>, String> {
    let (gate, generation) = {
        let state = manager.inner.lock().await;
        if state.unloads_in_progress != 0 {
            return Err(
                "Kwantflow AI runtime is unloading. Wait for it to finish before starting AI."
                    .to_string(),
            );
        }
        (state.lifecycle_gate.clone(), state.unload_generation)
    };
    let guard = acquire_cancellable_gate(gate, abort).await?;
    let state = manager.inner.lock().await;
    if state.unloads_in_progress != 0 || state.unload_generation != generation {
        return Err("Kwantflow AI runtime initialization was cancelled by unloading.".to_string());
    }
    if state.runtime_poisoned {
        return Err(
            "Kwantflow AI runtime is unavailable while native cancellation cleanup completes."
                .to_string(),
        );
    }
    if state.download_in_progress {
        return Err("Kwantflow AI model files are being downloaded or removed.".to_string());
    }
    Ok(guard)
}

async fn register_pending_completion(
    inner: &Arc<AsyncMutex<LocalAiMutableState>>,
    request_id: &str,
    abort: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut state = inner.lock().await;
    if state.pending_completions.contains_key(request_id) {
        return Err("Kwantflow AI request ID is already in use.".to_string());
    }
    state
        .pending_completions
        .insert(request_id.to_string(), abort);
    Ok(())
}

async fn register_active_completion(
    inner: &Arc<AsyncMutex<LocalAiMutableState>>,
    request_id: &str,
    workload_class: LocalAiWorkloadClass,
    abort: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut state = inner.lock().await;
    ensure_completion_not_cancelled(Some(&abort))?;
    state.active_completion = Some(ActiveCompletion {
        request_id: request_id.to_string(),
        workload_class,
        abort,
    });
    Ok(())
}

async fn request_active_completion_abort(
    inner: &Arc<AsyncMutex<LocalAiMutableState>>,
    request_id: &str,
    native_bridge: &NativeLiteRtBridge,
) -> bool {
    // Keep cancellation and active ownership under the same lock. A queued
    // request must not cancel whichever native request currently owns the gate.
    let state = inner.lock().await;
    let pending = state.pending_completions.get(request_id);
    if let Some(abort) = pending {
        abort.store(true, Ordering::SeqCst);
    }
    let active = state
        .active_completion
        .as_ref()
        .filter(|active| active.request_id == request_id);
    if let Some(active) = active {
        active.abort.store(true, Ordering::SeqCst);
        native_bridge.cancel();
    }
    pending.is_some() || active.is_some()
}

async fn clear_active_completion(inner: &Arc<AsyncMutex<LocalAiMutableState>>, request_id: &str) {
    let mut state = inner.lock().await;
    state.pending_completions.remove(request_id);
    if state
        .active_completion
        .as_ref()
        .is_some_and(|active| active.request_id == request_id)
    {
        state.active_completion = None;
    }
}

async fn mark_runtime_poisoned(inner: &Arc<AsyncMutex<LocalAiMutableState>>, stage: &str) {
    let mut state = inner.lock().await;
    state.runtime_poisoned = true;
    state.last_error = Some(format!(
        "Native cancellation cleanup is still running for stage {stage}."
    ));
}

fn schedule_native_recovery_after_task<T: Send + 'static>(
    inner: Arc<AsyncMutex<LocalAiMutableState>>,
    native_bridge: NativeLiteRtBridge,
    native_task: tokio::task::JoinHandle<T>,
) {
    tokio::spawn(async move {
        let _ = native_task.await;
        let unload_result = native_bridge.unload_engine();
        let mut state = inner.lock().await;
        state.runtime_poisoned = unload_result.is_err();
        state.capability_probe = None;
        state.active_completion = None;
        state.last_error = unload_result.err();
        if state.install_state == LocalAiInstallState::Ready {
            state.install_state = LocalAiInstallState::Installed;
        }
        info!("[local-ai] Native cancellation cleanup completed; runtime can be loaded again");
    });
}

struct InferenceGuard {
    _guard: OwnedMutexGuard<()>,
}

impl InferenceGuard {
    async fn acquire(
        inner: Arc<AsyncMutex<LocalAiMutableState>>,
        native_bridge: &NativeLiteRtBridge,
        workload_class: LocalAiWorkloadClass,
        abort: Option<&AtomicBool>,
    ) -> Result<Self, String> {
        ensure_completion_not_cancelled(abort)?;
        if workload_class != LocalAiWorkloadClass::Background {
            let state = inner.lock().await;
            ensure_completion_not_cancelled(abort)?;
            let active_background = state
                .active_completion
                .as_ref()
                .filter(|active| active.workload_class == LocalAiWorkloadClass::Background);
            if let Some(active) = active_background {
                active.abort.store(true, Ordering::SeqCst);
                native_bridge.cancel();
                info!(
                    "[local-ai] Foreground request cancelled active background workload; request_id={}",
                    active.request_id
                );
            }
        }
        let gate = { inner.lock().await.inference_gate.clone() };
        let guard = if workload_class == LocalAiWorkloadClass::Background {
            gate.try_lock_owned().map_err(|_| {
                "Kwantflow AI background workload yielded to an active foreground request."
                    .to_string()
            })?
        } else {
            acquire_cancellable_gate(gate, abort).await?
        };
        ensure_completion_not_cancelled(abort)?;
        if inner.lock().await.runtime_poisoned {
            drop(guard);
            return Err(
                "Kwantflow AI runtime is unavailable while native cancellation cleanup completes."
                    .to_string(),
            );
        }
        Ok(Self { _guard: guard })
    }
}

#[derive(Clone)]
pub struct LocalAiRuntimeManager {
    inner: Arc<AsyncMutex<LocalAiMutableState>>,
    native_bridge: NativeLiteRtBridge,
}

impl Default for LocalAiRuntimeManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(AsyncMutex::new(LocalAiMutableState::default())),
            native_bridge: NativeLiteRtBridge::new(),
        }
    }
}

impl LocalAiRuntimeManager {
    pub async fn unload(&self) -> Result<(), String> {
        let (lifecycle_gate, inference_gate) = {
            let mut state = self.inner.lock().await;
            state.unload_generation = state.unload_generation.wrapping_add(1);
            state.unloads_in_progress += 1;
            for abort in state.pending_completions.values() {
                abort.store(true, Ordering::SeqCst);
            }
            if let Some(active) = &state.active_completion {
                active.abort.store(true, Ordering::SeqCst);
            }
            self.native_bridge.cancel();
            (state.lifecycle_gate.clone(), state.inference_gate.clone())
        };
        let manager = self.clone();
        // Keep ownership even if the caller times out or its request disappears.
        // Lock order is lifecycle, inference, then native generation/engine.
        let mut unload_task = tokio::spawn(async move {
            let lifecycle_guard = lifecycle_gate.lock_owned().await;
            let inference_guard = inference_gate.lock_owned().await;
            let bridge = manager.native_bridge.clone();
            let result = tokio::task::spawn_blocking(move || {
                let _lifecycle_guard = lifecycle_guard;
                let _inference_guard = inference_guard;
                bridge.unload_engine()
            })
            .await
            .unwrap_or_else(|error| Err(format!("LiteRT engine unload thread panicked: {error}")));
            let mut state = manager.inner.lock().await;
            state.unloads_in_progress -= 1;
            match &result {
                Ok(()) => {
                    if !state.download_in_progress {
                        state.install_state = LocalAiInstallState::Installed;
                        state.active_download = None;
                    }
                    state.last_error = None;
                    state.runtime_poisoned = false;
                    state.active_completion = None;
                    state.capability_probe = None;
                }
                Err(error) => {
                    state.runtime_poisoned = true;
                    state.last_error = Some(error.clone());
                }
            }
            result
        });
        match tokio::time::timeout(std::time::Duration::from_secs(10), &mut unload_task).await {
            Ok(result) => {
                result.map_err(|error| format!("LiteRT unload task panicked: {error}"))?
            }
            Err(_) => {
                let error = "Kwantflow AI is still unloading. Wait for native initialization or cancellation cleanup to finish, then retry.".to_string();
                warn!("[local-ai] {error}");
                let mut state = self.inner.lock().await;
                if state.unloads_in_progress != 0 {
                    state.runtime_poisoned = true;
                    state.last_error = Some(error.clone());
                }
                Err(error)
            }
        }
    }
}

#[derive(Clone)]
pub struct NativeLiteRtBridge {
    state: Arc<NativeBridgeState>,
}

struct NativeBridgeState {
    engine: Mutex<Option<NativeEngineHandle>>,
    generation: Mutex<()>,
    gpu_used: AtomicBool,
}

struct NativeEngineHandle(*mut KfLiteRtEngine);

unsafe impl Send for NativeEngineHandle {}

impl Drop for NativeEngineHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                kf_litert_destroy_engine(self.0);
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum LocalAiStreamEvent {
    Thinking { text: String },
    Content { text: String },
}

struct NativeStreamingContext {
    sender: Option<std::sync::mpsc::Sender<LocalAiStreamEvent>>,
    chunks: Vec<String>,
    thoughts: Vec<String>,
    tool_calls: Vec<Value>,
}

#[derive(Debug)]
pub struct NativeCompletionOutput {
    pub content: String,
    pub thinking: String,
    pub tool_calls: Vec<Value>,
    pub benchmark: Option<NativeBenchmarkMetrics>,
}

#[derive(Debug)]
pub struct NativeBenchmarkMetrics {
    pub conversation_time_to_first_token_seconds: f64,
    pub prefill_token_count: u64,
    pub decode_token_count: u64,
    pub prefill_tokens_per_second: f64,
    pub decode_tokens_per_second: f64,
}

fn normalise_sampler_params(
    temperature: Option<f32>,
    top_k: Option<i32>,
    top_p: Option<f32>,
    seed: Option<i32>,
) -> (i32, i32, f32, f32, i32) {
    let temp = temperature.unwrap_or(0.0);
    let mut k = top_k.unwrap_or(0);
    let mut p = top_p.unwrap_or(0.0);
    let s = seed.unwrap_or(0);

    // LiteRT-LM's Top-P sampler first performs Top-K sampling. A zero Top-K
    // leaves the GPU sampler without a valid candidate set, so use the same
    // small positive value shown in Google's official conversation example.
    if temp > 0.0 && p <= 0.0 && k <= 0 {
        p = 0.95;
    }
    if temp > 0.0 && p > 0.0 && k <= 0 {
        k = 10;
    }

    // Request the LiteRT-LM v0.16 Greedy enum explicitly for deterministic
    // stages instead of relying on unspecified sampler behavior.
    let sampler_type = if temp <= 0.0 || k == 1 {
        k = 1;
        3
    } else if p > 0.0 {
        2
    } else if k > 0 {
        1
    } else {
        3
    };

    (sampler_type, k, p, temp, s)
}

impl NativeLiteRtBridge {
    pub fn new() -> Self {
        Self {
            state: Arc::new(NativeBridgeState {
                engine: Mutex::new(None),
                generation: Mutex::new(()),
                gpu_used: AtomicBool::new(false),
            }),
        }
    }

    fn set_sampler_params(
        &self,
        engine: *mut KfLiteRtEngine,
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        seed: Option<i32>,
    ) -> Result<(), String> {
        if temperature.is_none() && top_k.is_none() && top_p.is_none() && seed.is_none() {
            unsafe {
                kf_litert_clear_sampler_params(engine);
            }
            return Ok(());
        }

        let (sampler_type, k, p, temp, s) =
            normalise_sampler_params(temperature, top_k, top_p, seed);

        info!(
            "[local-ai] Configuring native sampler: type={}, top_k={}, top_p={}, temp={}, seed={}",
            sampler_type, k, p, temp, s
        );

        let status = unsafe { kf_litert_set_sampler_params(engine, sampler_type, k, p, temp, s) };
        if status != 0 {
            return Err(format!(
                "LiteRT-LM failed to create sampler type {sampler_type}."
            ));
        }
        Ok(())
    }

    fn clear_sampler_params(&self, engine: *mut KfLiteRtEngine) {
        unsafe {
            kf_litert_clear_sampler_params(engine);
        }
    }

    fn create_streaming_context(
        &self,
        on_event: Option<Channel<LocalAiStreamEvent>>,
    ) -> (NativeStreamingContext, Option<std::thread::JoinHandle<()>>) {
        let (tx, emitter_handle) = if let Some(on_event) = on_event {
            let (tx, rx) = std::sync::mpsc::channel::<LocalAiStreamEvent>();
            let handle = std::thread::spawn(move || {
                while let Ok(event) = rx.recv() {
                    if let Err(error) = on_event.send(event) {
                        warn!("[local-ai] Failed to send request stream event: {error}");
                    }
                }
            });
            (Some(tx), Some(handle))
        } else {
            (None, None)
        };

        let context = NativeStreamingContext {
            sender: tx,
            chunks: Vec::new(),
            thoughts: Vec::new(),
            tool_calls: Vec::new(),
        };

        (context, emitter_handle)
    }

    fn complete_streaming(
        &self,
        mut context: NativeStreamingContext,
        emitter_handle: Option<std::thread::JoinHandle<()>>,
    ) -> NativeStreamingContext {
        drop(context.sender.take());
        if let Some(handle) = emitter_handle {
            let _ = handle.join();
        }
        context
    }

    #[cfg(test)]
    fn unavailable_for_current_build() -> Self {
        Self::new()
    }

    fn take_native_error(error: *mut c_char) -> Option<String> {
        if error.is_null() {
            return None;
        }
        let message = unsafe { CStr::from_ptr(error).to_string_lossy().into_owned() };
        unsafe {
            kf_litert_free_string(error);
        }
        Some(message)
    }

    fn path_to_cstring(model_path: &Path) -> Result<CString, String> {
        CString::new(model_path.to_string_lossy().as_bytes())
            .map_err(|_| "model path contains an interior NUL byte".to_string())
    }

    pub fn load_engine(
        &self,
        model_path: &Path,
        native_lib_dir: Option<&Path>,
        cache_dir: &Path,
        max_num_tokens: i32,
    ) -> Result<(), String> {
        let model_path_cstr = Self::path_to_cstring(model_path)?;
        let native_lib_dir_cstr = native_lib_dir.map(Self::path_to_cstring).transpose()?;
        let cache_dir_cstr = Self::path_to_cstring(cache_dir)?;
        let mut error: *mut c_char = ptr::null_mut();

        let force_cpu = std::env::var("KWANTFLOW_FORCE_CPU").is_ok();
        let enable_speculative_decoding =
            std::env::var("KWANTFLOW_DISABLE_SPECULATIVE_DECODING").is_err();

        let mut tried_gpu = !force_cpu;
        let mut engine = if tried_gpu {
            unsafe {
                kf_litert_create_engine(
                    model_path_cstr.as_ptr(),
                    native_lib_dir_cstr
                        .as_ref()
                        .map(|dir| dir.as_ptr())
                        .unwrap_or(ptr::null()),
                    cache_dir_cstr.as_ptr(),
                    true,
                    enable_speculative_decoding,
                    max_num_tokens,
                    &mut error as *mut *mut c_char,
                )
            }
        } else {
            ptr::null_mut()
        };

        if engine.is_null() && tried_gpu {
            tried_gpu = false;
            let gpu_error = Self::take_native_error(error);
            warn!(
                "Failed to initialize LiteRT-LM with GPU: {:?}. Retrying on CPU...",
                gpu_error
            );
            error = ptr::null_mut();
        }

        if engine.is_null() {
            engine = unsafe {
                kf_litert_create_engine(
                    model_path_cstr.as_ptr(),
                    native_lib_dir_cstr
                        .as_ref()
                        .map(|dir| dir.as_ptr())
                        .unwrap_or(ptr::null()),
                    cache_dir_cstr.as_ptr(),
                    false,
                    enable_speculative_decoding,
                    max_num_tokens,
                    &mut error as *mut *mut c_char,
                )
            };
        }

        if engine.is_null() {
            return Err(Self::take_native_error(error)
                .unwrap_or_else(|| "native LiteRT-LM bridge failed to create engine".to_string()));
        }

        self.state.gpu_used.store(tried_gpu, Ordering::SeqCst);
        info!(
            "[local-ai] Native engine ready; backend={}, speculative_decoding_requested={}, context_tokens={}",
            if tried_gpu { "gpu" } else { "cpu" },
            enable_speculative_decoding,
            max_num_tokens
        );

        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let mut guard = self
            .state
            .engine
            .lock()
            .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
        *guard = Some(NativeEngineHandle(engine));
        Ok(())
    }

    pub fn unload_engine(&self) -> Result<(), String> {
        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let mut guard = self
            .state
            .engine
            .lock()
            .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
        *guard = None;
        Ok(())
    }

    fn is_engine_loaded(&self) -> bool {
        self.state
            .engine
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn cancel(&self) {
        let Ok(guard) = self.state.engine.lock() else {
            return;
        };
        if let Some(engine) = guard.as_ref() {
            unsafe {
                kf_litert_cancel(engine.0);
            }
        }
    }

    fn active_stream_count(&self) -> u32 {
        let Ok(guard) = self.state.engine.lock() else {
            return 0;
        };
        let Some(engine) = guard.as_ref() else {
            return 0;
        };
        unsafe { kf_litert_get_active_stream_count(engine.0).max(0) as u32 }
    }

    fn selected_backend(&self) -> &'static str {
        if !self.is_engine_loaded() {
            "unknown"
        } else if self.state.gpu_used.load(Ordering::SeqCst) {
            "gpu"
        } else {
            "cpu"
        }
    }

    pub fn send_message_output(
        &self,
        on_event: Option<Channel<LocalAiStreamEvent>>,
        cache_dir: &Path,
        request: &LocalAiCompletionRequest,
        enable_constrained_decoding: bool,
    ) -> Result<NativeCompletionOutput, String> {
        struct TempFileCleanupGuard {
            files: Vec<PathBuf>,
        }

        impl Drop for TempFileCleanupGuard {
            fn drop(&mut self) {
                for file in &self.files {
                    if file.exists() {
                        if let Err(e) = fs::remove_file(file) {
                            error!("Failed to clean up temporary file {:?}: {}", file, e);
                        } else {
                            debug!("Successfully cleaned up temporary file {:?}", file);
                        }
                    }
                }
            }
        }

        let mut cleanup_guard = TempFileCleanupGuard { files: Vec::new() };

        // When the caller supplies full messages (conversation history with tools),
        // decompose them into system/tools/history/last-message for the LiteRT-LM
        // The v0.16 Conversation API receives these values through its config.
        if let Some(messages) = &request.messages {
            if !messages.is_empty() {
                let normalised = normalise_native_conversation_messages(messages)?;

                // Determine system message content, preferring the explicit
                // `request.system_instruction` field (plain string from frontend)
                // over a system-role message embedded in the messages array.
                // The v0.16 Conversation API receives the system content separately.
                let system_content: Option<String> = request
                    .system_instruction
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        normalised.first().and_then(|m| {
                            if m.get("role").and_then(Value::as_str) == Some("system") {
                                m.get("content")
                                    .and_then(Value::as_str)
                                    .map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                    });
                let system_json: Option<String> = system_content
                    .as_ref()
                    .map(|s| serde_json::Value::String(s.clone()).to_string());

                // Separate history (everything except system and last message)
                // and the final user message to send.
                // If a system-role message existed in the array, skip it.
                let has_system_in_array = normalised
                    .first()
                    .map(|m| m.get("role").and_then(Value::as_str) == Some("system"))
                    .unwrap_or(false);
                let skip_system = if has_system_in_array { 1 } else { 0 };
                let non_system: Vec<&Value> = normalised.iter().skip(skip_system).collect();
                let (history_msgs, mut last_message) = if non_system.len() > 1 {
                    let (hist, last) = non_system.split_at(non_system.len() - 1);
                    (hist.to_vec(), last[0].clone())
                } else if non_system.len() == 1 {
                    (vec![], non_system[0].clone())
                } else {
                    return Err(
                        "local AI request has no user message in messages array".to_string()
                    );
                };

                // Append any artifacts to the last message if present, enabling multimodal input in structured path.
                if !request.artifacts.is_empty() {
                    // Gemma 4 requires images before text for optimal multimodal
                    // performance. Keep this ordering regardless of how the Svelte
                    // caller constructed its text and artifact arrays.
                    let mut image_parts = Vec::<Value>::new();
                    let mut text_parts = Vec::<Value>::new();
                    if let Some(existing_content) = last_message.get("content") {
                        match existing_content {
                            Value::String(s) => {
                                if !s.trim().is_empty() {
                                    text_parts.push(json!({
                                        "type": "text",
                                        "text": s
                                    }));
                                }
                            }
                            Value::Array(arr) => {
                                for part in arr {
                                    if part.get("type").and_then(Value::as_str) == Some("image") {
                                        image_parts.push(part.clone());
                                    } else {
                                        text_parts.push(part.clone());
                                    }
                                }
                            }
                            _ => {}
                        }
                    }

                    for artifact in &request.artifacts {
                        match artifact {
                            LocalAiCompletionArtifact::Text { text_content } => {
                                text_parts.push(json!({
                                    "type": "text",
                                    "text": text_content
                                }));
                            }
                            LocalAiCompletionArtifact::Image {
                                mime_type,
                                base64_data,
                            } => {
                                let uuid = uuid::Uuid::new_v4().to_string();
                                let ext = if mime_type.contains("png") {
                                    "png"
                                } else if mime_type.contains("gif") {
                                    "gif"
                                } else if mime_type.contains("webp") {
                                    "webp"
                                } else {
                                    "jpg"
                                };
                                let temp_file_name = format!("temp_image_{}.{}", uuid, ext);
                                let temp_file_path = cache_dir.join(temp_file_name);

                                let decoded_bytes = base64::prelude::BASE64_STANDARD
                                    .decode(base64_data)
                                    .map_err(|e| {
                                        format!("Failed to decode base64 image artifact: {}", e)
                                    })?;

                                fs::write(&temp_file_path, &decoded_bytes).map_err(|e| {
                                    format!(
                                        "Failed to write temporary image artifact to disk: {}",
                                        e
                                    )
                                })?;

                                cleanup_guard.files.push(temp_file_path.clone());

                                image_parts.push(json!({
                                    "type": "image",
                                    "path": temp_file_path.to_string_lossy().to_string()
                                }));
                            }
                        }
                    }

                    if let Value::Object(ref mut map) = last_message {
                        map.insert(
                            "content".to_string(),
                            Value::Array(images_before_text(image_parts, text_parts)),
                        );
                    }
                }

                // Gemma 4's v0.16 multi-prefill template dereferences
                // tool_data.function, so preserve the validated wrapped
                // declaration expected by this model artifact.
                let tools_json = serialise_litert_tool_declarations(&request.tools)?;

                // Build history JSON array
                let history_count = history_msgs.len();
                let history_json: Option<String> = if !history_msgs.is_empty() {
                    Some(Value::Array(history_msgs.into_iter().cloned().collect()).to_string())
                } else {
                    None
                };

                // Keep text-only messages as plain string content. Converting
                // them into multipart text arrays can route LiteRT-LM through
                // the multimodal embedding path during tool-call decode, which
                // fails for Gemma 4 with "Multimodal embeddings are not supported
                // during decode." True multimodal content should arrive as an
                // array from the caller and is preserved as-is.
                let last_msg_str = last_message.to_string();
                info!(
                    "[local-ai] Decomposed request: has_system={}, system_chars={}, tools={}, history_msgs={}, last_message_role={}",
                    system_content.is_some(),
                    system_content.as_ref().map_or(0, String::len),
                    request.tools.len(),
                    history_count,
                    last_message
                        .get("role")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                );

                return self.send_structured_output(
                    on_event,
                    &last_msg_str,
                    system_json.as_deref(),
                    tools_json.as_deref(),
                    history_json.as_deref(),
                    request.temperature,
                    request.top_k,
                    request.top_p,
                    request.seed,
                    request.enable_thinking,
                    request.max_output_tokens,
                    request.visual_token_budget,
                    enable_constrained_decoding,
                );
            }
        }

        // Build user content while keeping the system instruction separate on
        // The v0.16 Conversation API receives this as request context.

        let mut main_prompt = String::new();
        if let Some(user_prompt) = request.prompt.as_deref() {
            main_prompt.push_str(user_prompt);
        }

        let mut image_content = Vec::<Value>::new();
        let mut text_parts = Vec::<Value>::new();

        if !main_prompt.trim().is_empty() {
            text_parts.push(json!({
                "type": "text",
                "text": main_prompt
            }));
        }

        // cleanup_guard is defined at the top of the function and is shared by both branches.

        for artifact in &request.artifacts {
            match artifact {
                LocalAiCompletionArtifact::Text { text_content } => {
                    text_parts.push(json!({
                        "type": "text",
                        "text": text_content
                    }));
                }
                LocalAiCompletionArtifact::Image {
                    mime_type,
                    base64_data,
                } => {
                    let uuid = uuid::Uuid::new_v4().to_string();
                    let ext = if mime_type.contains("png") {
                        "png"
                    } else if mime_type.contains("gif") {
                        "gif"
                    } else if mime_type.contains("webp") {
                        "webp"
                    } else {
                        "jpg"
                    };
                    let temp_file_name = format!("temp_image_{}.{}", uuid, ext);
                    let temp_file_path = cache_dir.join(temp_file_name);

                    let decoded_bytes = base64::prelude::BASE64_STANDARD
                        .decode(base64_data)
                        .map_err(|e| format!("Failed to decode base64 image artifact: {}", e))?;

                    fs::write(&temp_file_path, &decoded_bytes).map_err(|e| {
                        format!("Failed to write temporary image artifact to disk: {}", e)
                    })?;

                    cleanup_guard.files.push(temp_file_path.clone());

                    image_content.push(json!({
                        "type": "image",
                        "path": temp_file_path.to_string_lossy().to_string()
                    }));
                }
            }
        }

        if image_content.is_empty() && text_parts.is_empty() {
            return Err("local AI request content is empty".to_string());
        }
        let content = images_before_text(image_content, text_parts);

        let content_val = if request.artifacts.is_empty() {
            Value::String(main_prompt)
        } else {
            Value::Array(content)
        };

        let message_json = json!({
            "role": "user",
            "content": content_val
        });

        self.send_structured_output(
            on_event,
            &message_json.to_string(),
            request
                .system_instruction
                .as_deref()
                .filter(|instruction| !instruction.trim().is_empty()),
            None,
            None,
            request.temperature,
            request.top_k,
            request.top_p,
            request.seed,
            request.enable_thinking,
            request.max_output_tokens,
            request.visual_token_budget,
            enable_constrained_decoding,
        )
    }

    fn send_structured_output(
        &self,
        on_event: Option<Channel<LocalAiStreamEvent>>,
        message_json: &str,
        system_json: Option<&str>,
        tools_json: Option<&str>,
        history_json: Option<&str>,
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        seed: Option<i32>,
        enable_thinking: bool,
        max_output_tokens: Option<i32>,
        visual_token_budget: Option<i32>,
        enable_constrained_decoding: bool,
    ) -> Result<NativeCompletionOutput, String> {
        let msg_cstr = CString::new(message_json)
            .map_err(|_| "local AI request message contains an interior NUL byte".to_string())?;
        let sys_cstr = system_json
            .map(|s| {
                CString::new(s).map_err(|_| "system_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        let tools_cstr = tools_json
            .map(|s| {
                CString::new(s).map_err(|_| "tools_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        let hist_cstr = history_json
            .map(|s| {
                CString::new(s)
                    .map_err(|_| "history_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        // Match persistent conversations and Gemma's prompt contract: absence
        // disables thinking. Sending an explicit false flag is not equivalent
        // for every upstream template revision.
        let extra_context_cstr = enable_thinking
            .then(|| CString::new(json!({ "enable_thinking": true }).to_string()))
            .transpose()
            .map_err(|_| "extra_context contains an interior NUL byte".to_string())?;

        let (mut context, emitter_handle) = self.create_streaming_context(on_event);
        let mut error: *mut c_char = ptr::null_mut();
        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let engine = {
            let guard = self
                .state
                .engine
                .lock()
                .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
            guard
                .as_ref()
                .map(|handle| handle.0)
                .ok_or_else(|| "native LiteRT-LM engine is not loaded".to_string())?
        };
        self.set_sampler_params(engine, temperature, top_k, top_p, seed)?;
        let status = unsafe {
            kf_litert_send_message(
                engine,
                msg_cstr.as_ptr(),
                sys_cstr.as_ref().map(|c| c.as_ptr()).unwrap_or(ptr::null()),
                tools_cstr
                    .as_ref()
                    .map(|c| c.as_ptr())
                    .unwrap_or(ptr::null()),
                hist_cstr
                    .as_ref()
                    .map(|c| c.as_ptr())
                    .unwrap_or(ptr::null()),
                extra_context_cstr
                    .as_ref()
                    .map(|context| context.as_ptr())
                    .unwrap_or(ptr::null()),
                max_output_tokens.unwrap_or(8192),
                visual_token_budget.unwrap_or(0),
                enable_constrained_decoding,
                native_chunk_callback,
                &mut context as *mut NativeStreamingContext as *mut c_void,
                &mut error as *mut *mut c_char,
            )
        };
        self.clear_sampler_params(engine);
        let context = self.complete_streaming(context, emitter_handle);
        if status != 0 {
            return Err(Self::take_native_error(error)
                .unwrap_or_else(|| "native LiteRT-LM bridge failed to send message".to_string()));
        }
        let mut time_to_first_token_seconds = 0.0;
        let mut prefill_token_count = 0;
        let mut decode_token_count = 0;
        let mut prefill_tokens_per_second = 0.0;
        let mut decode_tokens_per_second = 0.0;
        let benchmark = (unsafe {
            kf_litert_get_conversation_benchmark(
                engine,
                &mut time_to_first_token_seconds,
                &mut prefill_token_count,
                &mut decode_token_count,
                &mut prefill_tokens_per_second,
                &mut decode_tokens_per_second,
            )
        } == 0)
            .then_some(NativeBenchmarkMetrics {
                conversation_time_to_first_token_seconds: time_to_first_token_seconds,
                prefill_token_count: prefill_token_count.max(0) as u64,
                decode_token_count: decode_token_count.max(0) as u64,
                prefill_tokens_per_second,
                decode_tokens_per_second,
            });
        Ok(NativeCompletionOutput {
            content: context.chunks.join(""),
            thinking: context.thoughts.join(""),
            tool_calls: context.tool_calls,
            benchmark,
        })
    }

    fn probe_native_tool_calls(&self) -> Result<bool, String> {
        self.probe_native_tool_call_roundtrip(true)?;
        Ok(true)
    }

    fn probe_native_tool_call_roundtrip(
        &self,
        enable_constrained_decoding: bool,
    ) -> Result<(), String> {
        let tool_name = "kwantflow_probe_evidence_batch";
        let probe_tools = vec![json!({
            "type": "function",
            "function": {
                "name": tool_name,
                "description": "Returns an exact nested payload for native constrained-tool verification.",
                "parameters": {
                    "type": "object",
                    "properties": {
                    "units": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                    "unitKey": { "type": "string", "enum": ["probe:unit:1"] },
                                    "summary": { "type": "string", "maxLength": 64 }
                            },
                                "required": ["unitKey", "summary"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["units"],
                    "additionalProperties": false
                },
            }
        })];
        let tools_json = serialise_litert_tool_declarations(&probe_tools)?
            .ok_or_else(|| "native tool probe declaration was empty".to_string())?;
        let system_json = json!(
            "You are verifying LiteRT-LM structured evidence extraction. Call the provided tool exactly once."
        )
        .to_string();
        let prompt_text = "Call kwantflow_probe_evidence_batch with units containing probe:unit:1 and summary probe-ok.";
        let message_json = json!({
            "role": "user",
            "content": prompt_text
        })
        .to_string();

        info!(
            "[local-ai] Native tool probe starting; constrained_decoding={}",
            enable_constrained_decoding
        );
        let first_output = self.send_structured_output(
            None,
            &message_json,
            Some(&system_json),
            Some(&tools_json),
            None,
            Some(0.0),
            None,
            None,
            Some(42),
            false,
            Some(256),
            None,
            enable_constrained_decoding,
        )?;
        let call = first_output
            .tool_calls
            .iter()
            .find(|call| {
                call.get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    == Some(tool_name)
            })
            .cloned()
            .ok_or_else(|| {
                format!(
                    "native tool probe did not emit {tool_name}; constrained_decoding={}; content_len={}",
                    enable_constrained_decoding,
                    first_output.content.len()
                )
            })?;
        validate_native_probe_tool_call(&call)?;

        let history_json = json!([
            {
                "role": "user",
                "content": prompt_text
            },
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [call]
            },
            {
                "role": "tool",
                "content": [{
                    "type": "tool_response",
                    "tool_response": {
                        "name": tool_name,
                        "value": { "status": "probe-ok" }
                    }
                }]
            }
        ])
        .to_string();
        let final_message_json = json!({
            "role": "user",
            "content": "Now answer with exactly: probe complete."
        })
        .to_string();
        let final_output = self.send_structured_output(
            None,
            &final_message_json,
            Some(&system_json),
            Some(&tools_json),
            Some(&history_json),
            Some(0.0),
            None,
            None,
            Some(43),
            false,
            Some(256),
            None,
            enable_constrained_decoding,
        )?;
        if final_output.content.trim().is_empty() {
            return Err(format!(
                "native tool probe replay returned empty final content; constrained_decoding={}",
                enable_constrained_decoding
            ));
        }
        info!(
            "[local-ai] Native tool probe completed; constrained_decoding={}, final_content_len={}",
            enable_constrained_decoding,
            final_output.content.len()
        );
        Ok(())
    }

    // ── Persistent Conversation Management ──

    /// Create a persistent conversation with system message and tools.
    /// Only one persistent conversation can exist per engine at a time.
    fn create_conversation(
        &self,
        system_json: Option<&str>,
        tools_json: Option<&str>,
        messages_json: Option<&str>,
        extra_context_json: Option<&str>,
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        seed: Option<i32>,
    ) -> Result<(), String> {
        let sys_cstr = system_json
            .map(|s| {
                CString::new(s).map_err(|_| "system_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        let tools_cstr = tools_json
            .map(|s| {
                CString::new(s).map_err(|_| "tools_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        let msgs_cstr = messages_json
            .map(|s| {
                CString::new(s)
                    .map_err(|_| "messages_json contains an interior NUL byte".to_string())
            })
            .transpose()?;
        let extra_context_cstr = extra_context_json
            .map(|s| {
                CString::new(s)
                    .map_err(|_| "extra_context_json contains an interior NUL byte".to_string())
            })
            .transpose()?;

        let mut error: *mut c_char = ptr::null_mut();
        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let engine = {
            let guard = self
                .state
                .engine
                .lock()
                .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
            guard
                .as_ref()
                .map(|handle| handle.0)
                .ok_or_else(|| "native LiteRT-LM engine is not loaded".to_string())?
        };
        self.set_sampler_params(engine, temperature, top_k, top_p, seed)?;
        let status = unsafe {
            kf_litert_create_conversation(
                engine,
                sys_cstr.as_ref().map(|c| c.as_ptr()).unwrap_or(ptr::null()),
                tools_cstr
                    .as_ref()
                    .map(|c| c.as_ptr())
                    .unwrap_or(ptr::null()),
                msgs_cstr
                    .as_ref()
                    .map(|c| c.as_ptr())
                    .unwrap_or(ptr::null()),
                extra_context_cstr
                    .as_ref()
                    .map(|c| c.as_ptr())
                    .unwrap_or(ptr::null()),
                &mut error as *mut *mut c_char,
            )
        };
        self.clear_sampler_params(engine);
        if status != 0 {
            return Err(Self::take_native_error(error).unwrap_or_else(|| {
                "native LiteRT-LM bridge failed to create conversation".to_string()
            }));
        }
        Ok(())
    }

    /// Send a message to the existing persistent conversation.
    /// The conversation accumulates history and KV cache across calls.
    fn send_to_conversation(
        &self,
        on_event: Option<Channel<LocalAiStreamEvent>>,
        message_json: &str,
        max_output_tokens: i32,
    ) -> Result<NativeCompletionOutput, String> {
        let msg_cstr = CString::new(message_json)
            .map_err(|_| "message_json contains an interior NUL byte".to_string())?;

        let (mut context, emitter_handle) = self.create_streaming_context(on_event);
        let mut error: *mut c_char = ptr::null_mut();
        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let engine = {
            let guard = self
                .state
                .engine
                .lock()
                .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
            guard
                .as_ref()
                .map(|handle| handle.0)
                .ok_or_else(|| "native LiteRT-LM engine is not loaded".to_string())?
        };
        let status = unsafe {
            kf_litert_send_message_to_conversation(
                engine,
                msg_cstr.as_ptr(),
                max_output_tokens,
                native_chunk_callback,
                &mut context as *mut NativeStreamingContext as *mut c_void,
                &mut error as *mut *mut c_char,
            )
        };
        let context = self.complete_streaming(context, emitter_handle);
        if status != 0 {
            return Err(Self::take_native_error(error).unwrap_or_else(|| {
                "native LiteRT-LM bridge failed to send to conversation".to_string()
            }));
        }
        let mut time_to_first_token_seconds = 0.0;
        let mut prefill_token_count = 0;
        let mut decode_token_count = 0;
        let mut prefill_tokens_per_second = 0.0;
        let mut decode_tokens_per_second = 0.0;
        let benchmark = (unsafe {
            kf_litert_get_conversation_benchmark(
                engine,
                &mut time_to_first_token_seconds,
                &mut prefill_token_count,
                &mut decode_token_count,
                &mut prefill_tokens_per_second,
                &mut decode_tokens_per_second,
            )
        } == 0)
            .then_some(NativeBenchmarkMetrics {
                conversation_time_to_first_token_seconds: time_to_first_token_seconds,
                prefill_token_count: prefill_token_count.max(0) as u64,
                decode_token_count: decode_token_count.max(0) as u64,
                prefill_tokens_per_second,
                decode_tokens_per_second,
            });
        Ok(NativeCompletionOutput {
            content: context.chunks.join(""),
            thinking: context.thoughts.join(""),
            tool_calls: context.tool_calls,
            benchmark,
        })
    }

    /// Destroy the persistent conversation. Safe to call if none exists.
    fn destroy_conversation(&self) {
        let Ok(_generation) = self.state.generation.lock() else {
            return;
        };
        let Ok(guard) = self.state.engine.lock() else {
            return;
        };
        if let Some(engine) = guard.as_ref() {
            unsafe {
                kf_litert_destroy_conversation(engine.0);
            }
        }
    }

    /// Get the total token count in the persistent conversation KV cache.
    fn get_conversation_token_count(&self) -> Result<i32, String> {
        let _generation = self
            .state
            .generation
            .lock()
            .map_err(|_| "native LiteRT-LM bridge generation lock is poisoned".to_string())?;
        let engine = {
            let guard = self
                .state
                .engine
                .lock()
                .map_err(|_| "native LiteRT-LM bridge engine lock is poisoned".to_string())?;
            guard
                .as_ref()
                .map(|handle| handle.0)
                .ok_or_else(|| "native LiteRT-LM engine is not loaded".to_string())?
        };
        let count = unsafe { kf_litert_get_conversation_token_count(engine) };
        if count < 0 {
            return Err("native LiteRT-LM bridge failed to get token count".to_string());
        }
        Ok(count)
    }
}

unsafe extern "C" fn native_chunk_callback(chunk: *const c_char, user_data: *mut c_void) {
    if chunk.is_null() || user_data.is_null() {
        return;
    }
    let ctx = &mut *(user_data as *mut NativeStreamingContext);
    let raw_chunk = CStr::from_ptr(chunk).to_string_lossy().into_owned();
    if let Ok(value) = serde_json::from_str::<Value>(&raw_chunk) {
        if let Some(channels) = value.get("channels") {
            if let Some(thought) = channels.get("thought").and_then(Value::as_str) {
                // Thinking tokens go to the UI event ONLY — do NOT accumulate
                // them in the raw content buffer.
                ctx.thoughts.push(thought.to_string());
                if let Some(sender) = &ctx.sender {
                    let _ = sender.send(LocalAiStreamEvent::Thinking {
                        text: thought.to_string(),
                    });
                }
                return;
            }
            if channels.get("tool_call").is_some() {
                // Raw tool token streaming is not part of Kwantflow's parsing
                // contract. LiteRT supplies the authoritative parsed calls in
                // the callback message's tool_calls field.
                return;
            }
        }
        let structured_tool_calls = extract_structured_tool_calls(&value, ctx.tool_calls.len());
        if !structured_tool_calls.is_empty() {
            ctx.tool_calls.extend(structured_tool_calls);
            return;
        }
        if let Some(text) = extract_message_text(&value) {
            ctx.chunks.push(text.clone());
            if let Some(sender) = &ctx.sender {
                let _ = sender.send(LocalAiStreamEvent::Content { text });
            }
            return;
        }
    }

    ctx.chunks.push(raw_chunk.clone());
    if let Some(sender) = &ctx.sender {
        let _ = sender.send(LocalAiStreamEvent::Content { text: raw_chunk });
    }
}

fn extract_structured_tool_calls(value: &Value, fallback_id_offset: usize) -> Vec<Value> {
    let Some(calls) = value.get("tool_calls").and_then(Value::as_array) else {
        return Vec::new();
    };

    calls
        .iter()
        .enumerate()
        .filter_map(|(index, call)| {
            let function = call.get("function")?;
            let name = function.get("name").and_then(Value::as_str)?;
            let arguments_value = function
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let arguments = match arguments_value {
                Value::String(s) => s,
                other => other.to_string(),
            };
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("call_{}", fallback_id_offset + index));

            Some(json!({
                "id": id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments
                }
            }))
        })
        .collect()
}

fn extract_message_text(value: &Value) -> Option<String> {
    if let Some(channels) = value.get("channels") {
        if channels.get("thought").is_some() || channels.get("tool_call").is_some() {
            return None;
        }
    }
    let content = value.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(text) = content.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(entries) = content.as_array() {
        let mut out = String::new();
        for entry in entries {
            if entry.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = entry.get("text").and_then(Value::as_str) {
                    out.push_str(text);
                }
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }
    None
}

fn validate_native_probe_tool_call(call: &Value) -> Result<(), String> {
    let raw_arguments = call
        .get("function")
        .and_then(|function| function.get("arguments"))
        .ok_or_else(|| "native constrained-tool probe returned no arguments".to_string())?;
    let arguments = match raw_arguments {
        Value::String(value) => serde_json::from_str::<Value>(value).map_err(|error| {
            format!("native constrained-tool probe arguments were invalid JSON: {error}")
        })?,
        value => value.clone(),
    };
    let units = arguments.get("units").and_then(Value::as_array);
    let unit = units
        .and_then(|entries| (entries.len() == 1).then(|| &entries[0]))
        .filter(|entry| {
            entry.get("unitKey").and_then(Value::as_str) == Some("probe:unit:1")
                && entry.get("summary").and_then(Value::as_str) == Some("probe-ok")
        });
    if unit.is_none() {
        return Err(
            "native constrained-tool probe did not preserve the required evidence-unit payload"
                .to_string(),
        );
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LocalAiCompletionArtifact {
    Text {
        #[serde(rename = "textContent")]
        text_content: String,
    },
    Image {
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "base64Data")]
        base64_data: String,
    },
}

// NOTE: Tool choice enforcement is handled client-side.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCompletionRequest {
    pub request_id: String,
    pub stage: Option<String>,
    pub system_instruction: Option<String>,
    pub prompt: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<LocalAiCompletionArtifact>,
    #[serde(default)]
    pub tools: Vec<Value>,
    #[serde(default)]
    pub parse_tool_calls: bool,
    #[serde(default)]
    pub messages: Option<Vec<Value>>,
    pub temperature: Option<f32>,
    pub top_k: Option<i32>,
    pub top_p: Option<f32>,
    pub seed: Option<i32>,
    #[serde(default)]
    pub enable_thinking: bool,
    pub max_output_tokens: Option<i32>,
    pub visual_token_budget: Option<i32>,
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub workload_class: LocalAiWorkloadClass,
}

fn images_before_text(mut image_parts: Vec<Value>, text_parts: Vec<Value>) -> Vec<Value> {
    image_parts.extend(text_parts);
    image_parts
}

fn normalise_native_conversation_messages(messages: &[Value]) -> Result<Vec<Value>, String> {
    messages
        .iter()
        .map(|message| {
            let Value::Object(mut map) = message.clone() else {
                return Err("Local AI messages must be JSON objects.".to_string());
            };
            if !map.contains_key("role") {
                map.insert("role".to_string(), Value::String("user".to_string()));
            }
            if !map.get("role").is_some_and(Value::is_string) {
                return Err("Local AI message roles must be strings.".to_string());
            }
            match map.get("content") {
                Some(Value::String(_)) | Some(Value::Array(_)) => {}
                Some(Value::Null) | None => {
                    map.insert("content".to_string(), Value::String(String::new()));
                }
                Some(_) => {
                    return Err(
                        "Local AI message content must be a string or a canonical content-part array."
                            .to_string(),
                    );
                }
            }
            Ok(Value::Object(map))
        })
        .collect()
}

/// Validate the app's single public tool declaration shape before forwarding
/// it to the Gemma 4 v0.16 prompt template. The generic LiteRT tool guide shows
/// bare declarations, but the released Gemma 4 multi-prefill template expects
/// `tool_data.function` and fails template evaluation without this wrapper.
fn normalise_litert_tool_declarations(tools: &[Value]) -> Result<Vec<Value>, String> {
    tools
        .iter()
        .enumerate()
        .map(|(index, tool)| {
            let tool = tool
                .as_object()
                .ok_or_else(|| format!("Local AI tool declaration {index} must be an object."))?;
            if tool.get("type").and_then(Value::as_str) != Some("function") {
                return Err(format!(
                    "Local AI tool declaration {index} must have type function."
                ));
            }
            let function = tool
                .get("function")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    format!("Local AI tool declaration {index} must contain function metadata.")
                })?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| {
                    format!("Local AI tool declaration {index} must have a non-empty name.")
                })?;
            let description = function
                .get("description")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("Local AI tool declaration {name} must have a description.")
                })?;
            let parameters = function
                .get("parameters")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    format!("Local AI tool declaration {name} must have object parameters.")
                })?;
            if parameters.get("type").and_then(Value::as_str) != Some("object") {
                return Err(format!(
                    "Local AI tool declaration {name} parameters must use an object schema."
                ));
            }

            Ok(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": Value::Object(parameters.clone())
                }
            }))
        })
        .collect()
}

fn serialise_litert_tool_declarations(tools: &[Value]) -> Result<Option<String>, String> {
    if tools.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        Value::Array(normalise_litert_tool_declarations(tools)?).to_string(),
    ))
}

fn request_uses_native_tool_calls(request: &LocalAiCompletionRequest) -> bool {
    !request.tools.is_empty() || request.parse_tool_calls
}

fn validate_native_tool_request(
    request: &LocalAiCompletionRequest,
    supports_native_tool_calls: bool,
    supports_constrained_tool_calls: bool,
) -> Result<(), String> {
    if request_uses_native_tool_calls(request) {
        if !supports_native_tool_calls || !supports_constrained_tool_calls {
            return Err(NATIVE_TOOL_CALLS_DISABLED_MESSAGE.to_string());
        }
        if request
            .prompt
            .as_deref()
            .is_some_and(|prompt| !prompt.trim().is_empty())
            || request.messages.as_ref().is_none_or(Vec::is_empty)
        {
            return Err(
                "Native tool requests must use the canonical messages transport without prompt."
                    .to_string(),
            );
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiUsage {
    pub prompt_token_count: Option<u64>,
    pub candidates_token_count: Option<u64>,
    pub total_token_count: Option<u64>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCompletionTimingDiagnostics {
    pub prompt_token_count: Option<u64>,
    pub predicted_token_count: Option<u64>,
    pub cache_token_count: Option<u64>,
    pub prompt_ms: Option<f64>,
    pub predicted_ms: Option<f64>,
    pub prompt_per_second: Option<f64>,
    pub predicted_per_second: Option<f64>,
    pub time_to_first_token_ms: Option<f64>,
    pub prefill_token_count: Option<u64>,
    pub decode_token_count: Option<u64>,
    pub prefill_tokens_per_second: Option<f64>,
    pub decode_tokens_per_second: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCompletionDiagnostics {
    pub request_id: String,
    pub stage: String,
    pub queue_ms: u64,
    pub elapsed_ms: u64,
    pub runtime_kind: LocalAiRuntimeKind,
    pub timeout_seconds: u64,
    pub request_artifact_count: usize,
    pub request_image_count: usize,
    pub prompt_character_count: usize,
    pub visual_token_budget: Option<i32>,
    pub completion_reason: String,
    pub cancellation_reason: Option<String>,
    pub context_size_tokens: u64,
    pub context_token_count: Option<u64>,
    pub context_occupancy_ratio: Option<f64>,
    pub output_token_count: Option<u64>,
    pub backend: String,
    pub active_stream_count: u32,
    pub timings: LocalAiCompletionTimingDiagnostics,
    pub workload_class: LocalAiWorkloadClass,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCompletionResponse {
    pub content: Value,
    pub thinking: String,
    pub model_id: String,
    pub usage: LocalAiUsage,
    pub diagnostics: LocalAiCompletionDiagnostics,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<Value>,
}

fn local_ai_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("KWANTFLOW_LOCAL_AI_DIR") {
        return Ok(PathBuf::from(override_path));
    }

    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data directory: {error}"))
        .map(|path| {
            path.parent()
                .unwrap_or(&path)
                .join("Kwantflow")
                .join("local-ai")
        })
}

fn native_model_paths<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<NativeModelPaths, String> {
    Ok(NativeModelPaths::from_root(
        &local_ai_root(app)?,
        &descriptor_from_manifest(),
    ))
}

fn native_litert_library_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("KWANTFLOW_LITERT_LM_RUNTIME_DIR") {
        let path = PathBuf::from(override_path);
        if path.exists() {
            return Some(path);
        }
    }

    app.path()
        .resolve("local-ai/native", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists())
}

fn remote_model_url(descriptor: &LocalAiRuntimeDescriptor) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}?download=true",
        descriptor.model_repo_id, descriptor.model_revision, descriptor.remote_artifact_filename
    )
}

fn classify_local_ai_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        "timeout".to_string()
    } else if lower.contains("json") || lower.contains("parse") {
        "response_parse".to_string()
    } else if lower.contains("native litert-lm bridge") || lower.contains("load") {
        "startup".to_string()
    } else if lower.contains("request") || lower.contains("failed") {
        "request".to_string()
    } else {
        "unknown".to_string()
    }
}

fn native_error_requires_engine_reload(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("stream generation timed out")
        || lower.contains("vision_litert_compiled_model_executor")
        || lower.contains("litert_tensor_buffer")
}

fn local_ai_capability_probe_from_manifest(
    supports_native_tool_calls: bool,
    supports_constrained_tool_calls: bool,
    checked_elapsed_ms: Option<u64>,
    source: &str,
) -> LocalAiCapabilityProbeDiagnostics {
    let manifest = load_runtime_manifest();
    LocalAiCapabilityProbeDiagnostics {
        supports_constrained_tool_calls,
        supports_native_tool_calls,
        supports_reasoning_separation: manifest
            .litert_lm
            .capabilities
            .supports_reasoning_separation,
        supports_vision_inputs: manifest.litert_lm.capabilities.supports_vision_inputs,
        supports_persistent_conversation: manifest
            .litert_lm
            .capabilities
            .supports_persistent_conversation,
        supports_persistent_conversation_with_vision: manifest
            .litert_lm
            .capabilities
            .supports_persistent_conversation_with_vision,
        checked_elapsed_ms,
        source: source.to_string(),
    }
}

fn file_modified_unix_ns(path: &Path) -> Result<u128, String> {
    let modified = fs::metadata(path)
        .map_err(|error| format!("Failed to read model metadata: {error}"))?
        .modified()
        .map_err(|error| format!("Failed to read model modification time: {error}"))?;
    Ok(modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos())
}

async fn set_runtime_error<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    state: LocalAiInstallState,
    error: String,
) {
    {
        let mut guard = manager.inner.lock().await;
        guard.install_state = state;
        guard.last_error = Some(error);
        guard.active_download = None;
    }
    if let Ok(status) = build_local_ai_status(app, manager).await {
        let _ = app.emit("kwantflow-local-ai-status-changed", status);
    }
}

async fn set_runtime_state<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    state: LocalAiInstallState,
    error: Option<String>,
) {
    {
        let mut guard = manager.inner.lock().await;
        guard.install_state = state;
        guard.last_error = error;
        if !matches!(state, LocalAiInstallState::Downloading) {
            guard.active_download = None;
        }
    }
    if let Ok(status) = build_local_ai_status(app, manager).await {
        let _ = app.emit("kwantflow-local-ai-status-changed", status);
    }
}

async fn verify_model_file(
    manager: &LocalAiRuntimeManager,
    path: &Path,
    descriptor: &LocalAiRuntimeDescriptor,
) -> Result<(), String> {
    ensure_regular_file(path)?;
    let metadata =
        fs::metadata(path).map_err(|_| "Kwantflow AI model is not downloaded.".to_string())?;
    let modified_unix_ns = file_modified_unix_ns(path)?;
    {
        let guard = manager.inner.lock().await;
        if let Some(cache) = &guard.verification_cache {
            if cache.algorithm_version == 1
                && cache.path == path
                && cache.len == metadata.len()
                && cache.len == descriptor.expected_size_bytes
                && cache.modified_unix_ns == modified_unix_ns
                && cache.sha256 == descriptor.expected_sha256
                && !cache.format_sig.is_empty()
            {
                return Ok(());
            }
        }
    }
    let owned_path = path.to_path_buf();
    let expected_size = descriptor.expected_size_bytes;
    let expected_sha256 = descriptor.expected_sha256.clone();
    let fingerprint = tokio::task::spawn_blocking(move || {
        verify_file_integrity(&owned_path, expected_size, &expected_sha256)
    })
    .await
    .map_err(|error| format!("Model verification task failed: {error}"))??;
    let mut guard = manager.inner.lock().await;
    guard.verification_cache = Some(fingerprint);
    Ok(())
}

fn ensure_regular_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(_) => Err("The model path must be a regular file, not a link or directory.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot inspect the model file: {error}")),
    }
}

fn hash_file_range_with_cancel(
    path: &Path,
    offset: u64,
    length: u64,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    ensure_regular_file(path)?;
    let mut file =
        fs::File::open(path).map_err(|error| format!("Cannot read model bytes: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("Cannot seek model bytes: {error}"))?;
    let mut remaining = length;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    while remaining > 0 {
        if cancel.is_some_and(|cancel| cancel.load(Ordering::SeqCst)) {
            return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string());
        }
        let wanted = remaining.min(buffer.len() as u64) as usize;
        let count = file
            .read(&mut buffer[..wanted])
            .map_err(|error| format!("Cannot hash model bytes: {error}"))?;
        if count == 0 {
            return Err("The downloaded model file is incomplete.".to_string());
        }
        hasher.update(&buffer[..count]);
        remaining -= count as u64;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_file_integrity(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<VerificationFingerprint, String> {
    verify_file_integrity_with_cancel(path, expected_size, expected_sha256, None)
}

fn verify_file_integrity_with_cancel(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
    cancel: Option<&AtomicBool>,
) -> Result<VerificationFingerprint, String> {
    use std::io::Read;
    ensure_regular_file(path)?;
    let metadata =
        fs::metadata(path).map_err(|error| format!("Cannot inspect model bytes: {error}"))?;
    let modified_unix_ns = file_modified_unix_ns(path)?;
    if metadata.len() != expected_size || expected_size < 8 {
        return Err("The downloaded model file is incomplete or corrupted.".to_string());
    }
    let mut magic = [0u8; 8];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut magic))
        .map_err(|error| format!("Cannot read the model header: {error}"))?;
    let format_sig = if &magic == b"LITERTLM" {
        "litertlm"
    } else if &magic[4..8] == b"TFL3" {
        "tflite_flatbuffer"
    } else {
        return Err("Model file validation failed: invalid model signature.".to_string());
    };
    let sha256 = hash_file_range_with_cancel(path, 0, expected_size, cancel)?;
    if sha256 != expected_sha256 {
        return Err(
            "Model SHA-256 verification failed. Retry Download to fetch the pinned model again."
                .to_string(),
        );
    }
    if fs::metadata(path).map_err(|error| error.to_string())?.len() != expected_size
        || file_modified_unix_ns(path)? != modified_unix_ns
    {
        return Err("The model file changed during verification. Retry verification.".to_string());
    }
    Ok(VerificationFingerprint {
        algorithm_version: 1,
        path: path.to_path_buf(),
        len: expected_size,
        modified_unix_ns,
        sha256,
        format_sig: format_sig.to_string(),
    })
}

fn get_system_context_limit(manifest_limit: u64) -> u64 {
    #[cfg(target_os = "macos")]
    {
        // Try to get total system memory on macOS via sysctl
        if let Ok(output) = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
        {
            if output.status.success() {
                if let Ok(mem_str) = String::from_utf8(output.stdout) {
                    if let Ok(mem_bytes) = mem_str.trim().parse::<u64>() {
                        let gigabytes = mem_bytes / (1024 * 1024 * 1024);
                        if gigabytes <= 8 {
                            return 16384; // 16K limit for 8GB RAM devices
                        } else if gigabytes <= 16 {
                            return 32768; // 32K limit for 16GB RAM devices
                        } else if gigabytes <= 32 {
                            return 64000; // 64K limit for 32GB RAM devices
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        unsafe {
            let mut mem_info: MEMORYSTATUSEX = std::mem::zeroed();
            mem_info.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut mem_info).is_ok() {
                let mem_bytes = mem_info.ullTotalPhys;
                let gigabytes = mem_bytes / (1024 * 1024 * 1024);
                if gigabytes <= 8 {
                    return 16384; // 16K limit for 8GB RAM devices
                } else if gigabytes <= 16 {
                    return 32768; // 32K limit for 16GB RAM devices
                } else if gigabytes <= 32 {
                    return 64000; // 64K limit for 32GB RAM devices
                }
            }
        }
    }
    manifest_limit
}

/// Compute the max_num_tokens to pass to the LiteRT-LM engine.
/// Returns a value that accounts for system RAM while staying within
/// the model's magic-number cap (32003).
fn compute_native_max_tokens() -> i32 {
    const MODEL_MAGIC_NUMBER_CAP: u64 = 32003;
    let manifest = load_runtime_manifest();
    let ram_limit = get_system_context_limit(manifest.context_size_tokens);
    let target = std::cmp::min(ram_limit, MODEL_MAGIC_NUMBER_CAP);
    target as i32
}

fn active_launch_profile(engine_loaded: bool, gpu_used: bool) -> &'static str {
    if !engine_loaded {
        "not_started"
    } else if gpu_used {
        "gpu_preferred"
    } else {
        "cpu_only"
    }
}

async fn build_local_ai_status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
) -> Result<LocalAiStatus, String> {
    let descriptor = descriptor_from_manifest();
    let paths = native_model_paths(app)?;
    let manifest = load_runtime_manifest();
    let state = manager.inner.lock().await;
    let model_installed = paths.final_model_path.exists()
        && {
            if let Ok(metadata) = fs::metadata(&paths.final_model_path) {
                metadata.len() == descriptor.expected_size_bytes
            } else {
                false
            }
        }
        && paths
            .final_mmproj_path
            .as_ref()
            .map(|p| p.exists())
            .unwrap_or(true);
    let engine_loaded = manager.native_bridge.is_engine_loaded();
    let verified_model = model_installed
        && state.verification_cache.as_ref().is_some_and(|cache| {
            cache.algorithm_version == 1
                && cache.path == paths.final_model_path
                && cache.len == descriptor.expected_size_bytes
                && cache.sha256 == descriptor.expected_sha256
                && file_modified_unix_ns(&paths.final_model_path).ok()
                    == Some(cache.modified_unix_ns)
        });
    let install_state = match state.install_state {
        LocalAiInstallState::Installed
        | LocalAiInstallState::Loading
        | LocalAiInstallState::Ready
            if !verified_model =>
        {
            LocalAiInstallState::NotDownloaded
        }
        other => other,
    };
    let usable_model_installed = matches!(
        install_state,
        LocalAiInstallState::Installed | LocalAiInstallState::Loading | LocalAiInstallState::Ready
    );
    let last_error = state.last_error.clone();
    // A manifest describes what the bundled ABI claims to expose; it is not
    // evidence that this model/runtime can emit the production tool contract.
    // Stay fail-closed until the native probe has actually succeeded.
    let capability_probe = state.capability_probe.clone().unwrap_or_else(|| {
        local_ai_capability_probe_from_manifest(false, false, None, "unverified")
    });

    Ok(LocalAiStatus {
        runtime_kind: LocalAiRuntimeKind::LitertLm,
        runtime_version: descriptor.runtime_version,
        model_repo_id: descriptor.model_repo_id,
        model_artifact_id: descriptor.model_artifact_id,
        model_file_name: descriptor.model_file_name,
        mmproj_file_name: descriptor.mmproj_file_name,
        expected_download_bytes: descriptor.expected_size_bytes,
        install_state,
        runtime_available: usable_model_installed || engine_loaded,
        model_ready: engine_loaded
            && install_state == LocalAiInstallState::Ready
            && !state.runtime_poisoned
            && state.unloads_in_progress == 0
            && !state.download_in_progress,
        supports_image_inputs: manifest.litert_lm.capabilities.supports_vision_inputs,
        supports_native_tool_calls: capability_probe.supports_native_tool_calls,
        active_download: state.active_download.clone(),
        last_error,
        diagnostics: LocalAiDiagnostics {
            active_launch_profile: active_launch_profile(
                engine_loaded,
                manager.native_bridge.state.gpu_used.load(Ordering::SeqCst),
            )
            .to_string(),
            startup_elapsed_ms: None,
            image_probe_elapsed_ms: None,
            last_completion_elapsed_ms: state.last_completion_elapsed_ms,
            last_failure_class: state
                .last_error
                .as_ref()
                .map(|error| classify_local_ai_error(error)),
            last_timeout_stage: None,
            gpu_acceleration: if engine_loaded {
                if manager.native_bridge.state.gpu_used.load(Ordering::SeqCst) {
                    "gpu_active".to_string()
                } else {
                    "cpu_fallback".to_string()
                }
            } else {
                "gpu_preferred".to_string()
            },
            context_size_tokens: Some(compute_native_max_tokens() as u64),
            active_stream_count: manager.native_bridge.active_stream_count(),
            capability_probe,
        },
    })
}

async fn verify_local_ai_install_inner<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
) -> Result<LocalAiStatus, String> {
    if manager.inner.lock().await.download_in_progress {
        return build_local_ai_status(app, manager).await;
    }
    let descriptor = descriptor_from_manifest();
    let paths = native_model_paths(app)?;

    if !paths.final_model_path.exists()
        || paths
            .final_mmproj_path
            .as_ref()
            .map(|p| !p.exists())
            .unwrap_or(false)
    {
        set_runtime_state(app, manager, LocalAiInstallState::NotDownloaded, None).await;
        return build_local_ai_status(app, manager).await;
    }

    set_runtime_state(app, manager, LocalAiInstallState::Verifying, None).await;
    if let Err(error) = verify_model_file(manager, &paths.final_model_path, &descriptor).await {
        manager.inner.lock().await.verification_cache = None;
        set_runtime_state(app, manager, LocalAiInstallState::RepairNeeded, Some(error)).await;
        return build_local_ai_status(app, manager).await;
    }

    set_runtime_state(app, manager, LocalAiInstallState::Installed, None).await;
    build_local_ai_status(app, manager).await
}

async fn ensure_local_ai_runtime_ready_for_use<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    abort: Option<&AtomicBool>,
) -> Result<LocalAiStatus, String> {
    ensure_completion_not_cancelled(abort)?;
    let lifecycle_guard = acquire_runtime_lifecycle(manager, abort).await?;
    // 1. Check if already loaded/ready or active in memory
    {
        let state = manager.inner.lock().await;
        if manager.native_bridge.is_engine_loaded() {
            if state.install_state == LocalAiInstallState::Ready {
                drop(state);
                debug!("LiteRT engine is already loaded in memory and Ready");
                return build_local_ai_status(app, manager).await;
            }
            let current_state = state.install_state;
            drop(state);
            debug!(
                "LiteRT engine is loaded but state is {:?}, transitioning to Ready",
                current_state
            );
            set_runtime_state(app, manager, LocalAiInstallState::Ready, None).await;
            return build_local_ai_status(app, manager).await;
        }
    }

    // 3. If we are not loaded or loading, check installation on disk first
    ensure_completion_not_cancelled(abort)?;
    info!("Verifying local AI installation status...");
    let install_status = verify_local_ai_install_inner(app, manager).await?;
    ensure_completion_not_cancelled(abort)?;
    if matches!(
        install_status.install_state,
        LocalAiInstallState::NotDownloaded
            | LocalAiInstallState::Downloading
            | LocalAiInstallState::Verifying
            | LocalAiInstallState::Failed
            | LocalAiInstallState::RepairNeeded
            | LocalAiInstallState::Unsupported
    ) {
        warn!(
            "Local AI is not in a loadable state: {:?}",
            install_status.install_state
        );
        return Ok(install_status);
    }

    let paths = native_model_paths(app)?;
    debug!(
        "Ensuring LiteRT cache directory exists: {:?}",
        paths.cache_dir
    );
    fs::create_dir_all(&paths.cache_dir)
        .map_err(|error| format!("Failed to create LiteRT cache directory: {error}"))?;

    info!(
        "Loading LiteRT engine from model path: {:?}",
        paths.final_model_path
    );
    let native_lib_dir = native_litert_library_dir(app);
    let native_bridge = manager.native_bridge.clone();
    let final_model_path = paths.final_model_path.clone();
    let cache_dir = paths.cache_dir.clone();
    let max_num_tokens = compute_native_max_tokens();

    let native_lib_dir_clone = native_lib_dir.clone();
    let native_bridge_clone = native_bridge.clone();
    let final_model_path_clone = final_model_path.clone();
    let cache_dir_clone = cache_dir.clone();

    let load_task =
        start_runtime_initialization(app.clone(), manager.clone(), lifecycle_guard, move || {
            native_bridge_clone.load_engine(
                &final_model_path_clone,
                native_lib_dir_clone.as_deref(),
                &cache_dir_clone,
                max_num_tokens,
            )
        });
    await_runtime_initialization(load_task, abort).await
}

async fn await_runtime_initialization(
    mut task: tokio::task::JoinHandle<Result<LocalAiStatus, String>>,
    abort: Option<&AtomicBool>,
) -> Result<LocalAiStatus, String> {
    let result = loop {
        tokio::select! {
            result = &mut task => break result,
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)), if abort.is_some() => {
                // Dropping this JoinHandle leaves the independent initializer
                // running with its lifecycle lock and shared status publication.
                ensure_completion_not_cancelled(abort)?;
            }
        }
    };
    ensure_completion_not_cancelled(abort)?;
    result.map_err(|error| format!("LiteRT initialization task panicked: {error}"))?
}

fn start_runtime_initialization<R, F>(
    app: AppHandle<R>,
    manager: LocalAiRuntimeManager,
    lifecycle_guard: OwnedMutexGuard<()>,
    load_engine: F,
) -> tokio::task::JoinHandle<Result<LocalAiStatus, String>>
where
    R: tauri::Runtime,
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    // The owner outlives its caller. Dropping a request must not let unloading
    // race a still-running native constructor or strand the shared Loading state.
    tokio::spawn(async move {
        let _lifecycle_guard = lifecycle_guard;
        set_runtime_state(&app, &manager, LocalAiInstallState::Loading, None).await;
        let load_result = tokio::task::spawn_blocking(load_engine)
            .await
            .unwrap_or_else(|error| Err(format!("LiteRT engine load thread panicked: {error}")));
        match load_result {
            Ok(()) => {
                info!("LiteRT engine loaded successfully. Local AI is ready.");
                set_runtime_state(&app, &manager, LocalAiInstallState::Ready, None).await;
            }
            Err(error) if error.contains("native LiteRT-LM bridge is not linked") => {
                warn!("LiteRT engine loading unsupported: native LiteRT-LM bridge is not linked");
                set_runtime_state(&app, &manager, LocalAiInstallState::Unsupported, None).await;
            }
            Err(error) => {
                error!("LiteRT engine loading failed: {error}");
                let error = match manager.native_bridge.unload_engine() {
                    Ok(()) => error,
                    Err(cleanup_error) => {
                        mark_runtime_poisoned(&manager.inner, "initialization_failure").await;
                        format!("{error}; native cleanup failed: {cleanup_error}")
                    }
                };
                set_runtime_error(&app, &manager, LocalAiInstallState::Failed, error).await;
            }
        }
        build_local_ai_status(&app, &manager).await
    })
}

#[tauri::command]
pub async fn get_local_ai_capabilities_command() -> Result<RuntimeManifestCapabilities, String> {
    Ok(load_runtime_manifest().litert_lm.capabilities)
}

#[tauri::command]
pub async fn get_local_ai_status(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    let should_verify = {
        let state = manager.inner.lock().await;
        !state.download_in_progress
            && state.verification_cache.is_none()
            && state.install_state == LocalAiInstallState::NotDownloaded
    };
    if should_verify && native_model_paths(&app)?.final_model_path.exists() {
        return verify_local_ai_install_inner(&app, manager.inner()).await;
    }
    build_local_ai_status(&app, manager.inner()).await
}

const MODEL_DOWNLOAD_DISK_RESERVE: u64 = 64 * 1024 * 1024;

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_archived_mirror(
    mirror: &ArchivedModelMirror,
    descriptor: &LocalAiRuntimeDescriptor,
) -> Result<(), String> {
    if mirror.model_revision != descriptor.model_revision
        || mirror.model_sha256 != descriptor.expected_sha256
        || mirror.model_expected_size_bytes != descriptor.expected_size_bytes
    {
        return Err(
            "The archived model mirror does not match the pinned model revision, size and SHA-256."
                .to_string(),
        );
    }
    if mirror.parts.len() != 2 {
        return Err(
            "The archived model mirror must contain exactly two ordered parts.".to_string(),
        );
    }
    let mut total = 0u64;
    for part in &mirror.parts {
        if part.size_bytes == 0 || part.size_bytes >= 2_147_483_648 || !valid_sha256(&part.sha256) {
            return Err(
                "Each archived model part needs a SHA-256 and a size below 2 GiB.".to_string(),
            );
        }
        let url = reqwest::Url::parse(&part.url)
            .map_err(|_| "Invalid archived model URL.".to_string())?;
        let valid_scheme = url.scheme() == "https";
        #[cfg(test)]
        let valid_scheme =
            valid_scheme || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
        if !valid_scheme
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(
                "Archived model URLs must be public HTTPS URLs without credentials or fragments."
                    .to_string(),
            );
        }
        total = total
            .checked_add(part.size_bytes)
            .ok_or("Archived model sizes overflow.")?;
    }
    if total != descriptor.expected_size_bytes || mirror.parts[0].url == mirror.parts[1].url {
        return Err(
            "The two distinct archived model parts must reconstruct exactly the pinned model size."
                .to_string(),
        );
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialModelIdentity {
    version: u8,
    model_revision: String,
    model_sha256: String,
    model_expected_size_bytes: u64,
    source: String,
    etag: Option<String>,
}

impl PartialModelIdentity {
    fn new(descriptor: &LocalAiRuntimeDescriptor) -> Self {
        Self {
            version: 1,
            model_revision: descriptor.model_revision.clone(),
            model_sha256: descriptor.expected_sha256.clone(),
            model_expected_size_bytes: descriptor.expected_size_bytes,
            source: String::new(),
            etag: None,
        }
    }
    fn matches(&self, descriptor: &LocalAiRuntimeDescriptor) -> bool {
        self.version == 1
            && self.model_revision == descriptor.model_revision
            && self.model_sha256 == descriptor.expected_sha256
            && self.model_expected_size_bytes == descriptor.expected_size_bytes
    }
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("Cannot sync model directory: {error}"))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn save_partial_identity(path: &Path, identity: &PartialModelIdentity) -> Result<(), String> {
    use std::io::Write;
    ensure_regular_file(path)?;
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    let temporary = path.with_file_name(name);
    ensure_regular_file(&temporary)?;
    let bytes = serde_json::to_vec(identity).map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("Cannot save model resume identity: {error}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Cannot sync model resume identity: {error}"))?;
    drop(file);
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot save model resume identity: {error}"))?;
    sync_parent_directory(path)
}

fn prepare_partial(
    paths: &NativeModelPaths,
    descriptor: &LocalAiRuntimeDescriptor,
) -> Result<PartialModelIdentity, String> {
    ensure_regular_file(&paths.partial_model_path)?;
    ensure_regular_file(&paths.partial_identity_path)?;
    let saved = fs::read(&paths.partial_identity_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<PartialModelIdentity>(&bytes).ok())
        .filter(|identity| identity.matches(descriptor));
    let length = fs::metadata(&paths.partial_model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let identity = if saved.is_some() && length <= descriptor.expected_size_bytes {
        saved.unwrap()
    } else {
        // Unknown or obsolete partials cannot be resumed against a new model identity.
        truncate_partial(&paths.partial_model_path, 0)?;
        PartialModelIdentity::new(descriptor)
    };
    save_partial_identity(&paths.partial_identity_path, &identity)?;
    Ok(identity)
}

fn truncate_partial(path: &Path, length: u64) -> Result<(), String> {
    ensure_regular_file(path)?;
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(path)
        .and_then(|file| {
            file.set_len(length)?;
            file.sync_all()
        })
        .map_err(|error| format!("Cannot prepare the resumable model file: {error}"))
}

fn require_download_space(
    available: u64,
    expected_size: u64,
    existing_partial: u64,
) -> Result<(), String> {
    let required = expected_size
        .saturating_sub(existing_partial)
        .saturating_add(MODEL_DOWNLOAD_DISK_RESERVE);
    if available < required {
        return Err(format!("Not enough free space in the model folder. Free at least {:.2} GB and retry Download; the partial download is preserved.", required as f64 / 1_000_000_000.0));
    }
    Ok(())
}

fn preflight_download_space(path: &Path, expected_size: u64) -> Result<(), String> {
    let parent = path.parent().ok_or("The model folder is unavailable.")?;
    let available = fs2::available_space(parent)
        .map_err(|error| format!("Cannot check free space in the model folder: {error}"))?;
    let existing = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    require_download_space(available, expected_size, existing)
}

async fn claim_download(manager: &LocalAiRuntimeManager) -> bool {
    let mut state = manager.inner.lock().await;
    if state.download_in_progress {
        return false;
    }
    state.download_in_progress = true;
    state.download_cancel_requested = false;
    state.download_abort.store(false, Ordering::SeqCst);
    state.install_state = LocalAiInstallState::Downloading;
    state.last_error = None;
    true
}

struct DownloadGuard<R: tauri::Runtime> {
    app: AppHandle<R>,
    manager: LocalAiRuntimeManager,
    // An OS file lock also prevents a second application process writing this partial.
    _file_lock: Option<fs::File>,
    cancel: Arc<AtomicBool>,
    completed: bool,
}

impl<R: tauri::Runtime> Drop for DownloadGuard<R> {
    fn drop(&mut self) {
        if !self.completed {
            self.cancel.store(true, Ordering::SeqCst);
            let manager = self.manager.clone();
            let app = self.app.clone();
            tokio::spawn(async move {
                let mut state = manager.inner.lock().await;
                state.download_in_progress = false;
                state.download_cancel_requested = false;
                state.install_state = LocalAiInstallState::NotDownloaded;
                state.active_download = None;
                drop(state);
                if let Ok(status) = build_local_ai_status(&app, &manager).await {
                    let _ = app.emit("kwantflow-local-ai-status-changed", status);
                }
            });
        }
    }
}

async fn wait_download_cancel(manager: &LocalAiRuntimeManager) {
    loop {
        if manager.inner.lock().await.download_cancel_requested {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

async fn update_download_progress<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    manager: &LocalAiRuntimeManager,
    downloaded: u64,
    total: u64,
    mirror: bool,
) -> Result<(), String> {
    let mut state = manager.inner.lock().await;
    if state.download_cancel_requested {
        return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string());
    }
    state.install_state = LocalAiInstallState::Downloading;
    state.active_download = Some(LocalAiDownloadProgress {
        stage: if mirror {
            "downloading_mirror"
        } else {
            "downloading_model"
        }
        .to_string(),
        label: if mirror {
            "Downloading archived Kwantflow AI"
        } else {
            "Downloading Kwantflow AI"
        }
        .to_string(),
        downloaded_bytes: downloaded,
        total_bytes: Some(total),
        percent: Some((downloaded as f64 / total as f64 * 100.0).min(100.0)),
    });
    drop(state);
    if let Some(app) = app {
        if let Ok(status) = build_local_ai_status(app, manager).await {
            let _ = app.emit("kwantflow-local-ai-status-changed", status);
        }
    }
    Ok(())
}

// A 200 response to a range request restarts that segment. A 206 response must
// describe exactly the requested suffix; Content-Length alone is not sufficient.
fn response_resume_offset(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
    requested: u64,
    length: u64,
) -> Result<u64, String> {
    let offset = if status == reqwest::StatusCode::OK {
        0
    } else if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let raw = headers
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .ok_or("Model range response is missing Content-Range.")?;
        let expected = format!("bytes {}-{}/{}", requested, length - 1, length);
        if raw != expected {
            return Err(
                "Model range response does not match the requested offset and pinned size."
                    .to_string(),
            );
        }
        requested
    } else {
        return Err(format!("Model download request failed with HTTP {status}."));
    };
    if let Some(value) = headers.get(reqwest::header::CONTENT_LENGTH) {
        let received = value
            .to_str()
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .ok_or("Invalid model Content-Length.")?;
        if received != length - offset {
            return Err(
                "Model response length does not match the pinned artifact size.".to_string(),
            );
        }
    }
    if headers
        .get(reqwest::header::CONTENT_ENCODING)
        .is_some_and(|value| value != "identity")
    {
        return Err("Compressed model responses cannot be resumed safely.".to_string());
    }
    Ok(offset)
}

#[allow(clippy::too_many_arguments)]
async fn download_segment<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    client: &Client,
    manager: &LocalAiRuntimeManager,
    paths: &NativeModelPaths,
    identity: &mut PartialModelIdentity,
    url: &str,
    base: u64,
    length: u64,
    total: u64,
    mirror: bool,
) -> Result<(), String> {
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};
    let present = fs::metadata(&paths.partial_model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if present < base || present > base + length {
        return Err("Invalid model partial offset.".to_string());
    }
    let requested = present - base;
    if requested == length {
        return Ok(());
    }
    let previous_etag = if identity.source == url {
        identity.etag.clone()
    } else {
        None
    };
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    if requested > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={requested}-"));
        if let Some(etag) = &previous_etag {
            request = request.header(reqwest::header::IF_RANGE, etag);
        }
    }
    let response = tokio::select! {
        _ = wait_download_cancel(manager) => return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string()),
        result = tokio::time::timeout(std::time::Duration::from_secs(30), request.send()) =>
            result.map_err(|_| "Model download timed out waiting for response headers.".to_string())?
                .map_err(|error| format!("Cannot reach the model download source: {error}"))?,
    };
    let offset = response_resume_offset(response.status(), response.headers(), requested, length)?;
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with('"') && value.ends_with('"'))
        .map(str::to_string);
    if offset > 0 && previous_etag.is_some() && etag.is_some() && etag != previous_etag {
        return Err("Model source identity changed during resume. Retry Download.".to_string());
    }
    if offset != requested {
        truncate_partial(&paths.partial_model_path, base)?;
        preflight_download_space(&paths.partial_model_path, total)?;
    }
    identity.source = url.to_string();
    identity.etag = etag;
    save_partial_identity(&paths.partial_identity_path, identity)?;
    ensure_regular_file(&paths.partial_model_path)?;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&paths.partial_model_path)
        .await
        .map_err(|error| format!("Cannot open the model partial file: {error}"))?;
    file.seek(std::io::SeekFrom::Start(base + offset))
        .await
        .map_err(|error| format!("Cannot resume model bytes: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut received = offset;
    let mut last_update = Instant::now();
    let result = async {
        update_download_progress(app, manager, base + received, total, mirror).await?;
        loop {
            let next = tokio::select! {
                _ = wait_download_cancel(manager) => return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string()),
                next = tokio::time::timeout(std::time::Duration::from_secs(30), stream.next()) =>
                    next.map_err(|_| "Model download timed out waiting for network data. Retry Download to resume.".to_string())?,
            };
            let Some(chunk) = next else { break; };
            let bytes = chunk.map_err(|error| format!("Model download interrupted. Retry Download to resume: {error}"))?;
            if bytes.len() as u64 > length - received { return Err("Model source sent more bytes than the pinned artifact size.".to_string()); }
            file.write_all(&bytes).await.map_err(|error| format!("Cannot write model bytes. Check free disk space and retry Download: {error}"))?;
            received += bytes.len() as u64;
            if last_update.elapsed() >= std::time::Duration::from_millis(200) {
                update_download_progress(app, manager, base + received, total, mirror).await?;
                last_update = Instant::now();
            }
        }
        if received != length { return Err("Model source ended before the complete pinned artifact arrived. Retry Download to resume.".to_string()); }
        update_download_progress(app, manager, base + received, total, mirror).await
    }.await;
    // Persist a resumable prefix on cancellation and ordinary network failures too.
    file.flush()
        .await
        .map_err(|error| format!("Cannot flush model bytes: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("Cannot sync model bytes: {error}"))?;
    result
}

async fn verify_downloaded_partial<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    manager: &LocalAiRuntimeManager,
    paths: &NativeModelPaths,
    descriptor: &LocalAiRuntimeDescriptor,
) -> Result<VerificationFingerprint, String> {
    {
        let mut state = manager.inner.lock().await;
        state.install_state = LocalAiInstallState::Verifying;
        state.active_download = Some(LocalAiDownloadProgress {
            stage: "verifying".to_string(),
            label: "Verifying Kwantflow AI".to_string(),
            downloaded_bytes: descriptor.expected_size_bytes,
            total_bytes: Some(descriptor.expected_size_bytes),
            percent: Some(100.0),
        });
    }
    if let Some(app) = app {
        if let Ok(status) = build_local_ai_status(app, manager).await {
            let _ = app.emit("kwantflow-local-ai-status-changed", status);
        }
    }
    let path = paths.partial_model_path.clone();
    let size = descriptor.expected_size_bytes;
    let sha256 = descriptor.expected_sha256.clone();
    let cancel = manager.inner.lock().await.download_abort.clone();
    tokio::task::spawn_blocking(move || {
        verify_file_integrity_with_cancel(&path, size, &sha256, Some(&cancel))
    })
    .await
    .map_err(|error| format!("Model verification task failed: {error}"))?
}

async fn verify_mirror_part(
    manager: &LocalAiRuntimeManager,
    path: &Path,
    base: u64,
    part: &ArchivedModelPart,
) -> Result<(), String> {
    let owned_path = path.to_path_buf();
    let length = part.size_bytes;
    let expected = part.sha256.clone();
    let cancel = manager.inner.lock().await.download_abort.clone();
    tokio::task::spawn_blocking(move || {
        if hash_file_range_with_cancel(&owned_path, base, length, Some(&cancel))? != expected {
            return Err("Archived model part SHA-256 verification failed.".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Archived model verification task failed: {error}"))?
}

async fn download_mirror<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    client: &Client,
    manager: &LocalAiRuntimeManager,
    paths: &NativeModelPaths,
    identity: &mut PartialModelIdentity,
    descriptor: &LocalAiRuntimeDescriptor,
    mirror: &ArchivedModelMirror,
) -> Result<(), String> {
    let mut base = 0;
    for part in &mirror.parts {
        if manager.inner.lock().await.download_cancel_requested {
            return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string());
        }
        let mut present = fs::metadata(&paths.partial_model_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if present >= base + part.size_bytes {
            match verify_mirror_part(manager, &paths.partial_model_path, base, part).await {
                Ok(()) => {
                    base += part.size_bytes;
                    continue;
                }
                Err(error) if error == LOCAL_AI_DOWNLOAD_CANCELLED => return Err(error),
                Err(_) => {}
            }
            truncate_partial(&paths.partial_model_path, base)?;
            present = base;
        }
        let resumed_prefix = present > base;
        download_segment(
            app,
            client,
            manager,
            paths,
            identity,
            &part.url,
            base,
            part.size_bytes,
            descriptor.expected_size_bytes,
            true,
        )
        .await?;
        if let Err(error) = verify_mirror_part(manager, &paths.partial_model_path, base, part).await
        {
            if error == LOCAL_AI_DOWNLOAD_CANCELLED {
                return Err(error);
            }
            truncate_partial(&paths.partial_model_path, base)?;
            if !resumed_prefix {
                return Err(error);
            }
            // A primary-source or interrupted prefix may be corrupt. Retry this
            // part once from zero, without redownloading already verified parts.
            preflight_download_space(&paths.partial_model_path, descriptor.expected_size_bytes)?;
            identity.source.clear();
            identity.etag = None;
            download_segment(
                app,
                client,
                manager,
                paths,
                identity,
                &part.url,
                base,
                part.size_bytes,
                descriptor.expected_size_bytes,
                true,
            )
            .await?;
            verify_mirror_part(manager, &paths.partial_model_path, base, part).await?;
        }
        base += part.size_bytes;
    }
    Ok(())
}

async fn download_from_sources<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    client: &Client,
    manager: &LocalAiRuntimeManager,
    paths: &NativeModelPaths,
    identity: &mut PartialModelIdentity,
    descriptor: &LocalAiRuntimeDescriptor,
    primary_url: &str,
) -> Result<VerificationFingerprint, String> {
    let primary = match download_segment(
        app,
        client,
        manager,
        paths,
        identity,
        primary_url,
        0,
        descriptor.expected_size_bytes,
        descriptor.expected_size_bytes,
        false,
    )
    .await
    {
        Ok(()) => verify_downloaded_partial(app, manager, paths, descriptor).await,
        Err(error) => Err(error),
    };
    match primary {
        Ok(fingerprint) => return Ok(fingerprint),
        Err(error) if error == LOCAL_AI_DOWNLOAD_CANCELLED => return Err(error),
        Err(primary_error) => {
            if manager.inner.lock().await.download_cancel_requested {
                return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string());
            }
            // A complete file which failed integrity cannot provide a safe prefix.
            if fs::metadata(&paths.partial_model_path)
                .is_ok_and(|metadata| metadata.len() == descriptor.expected_size_bytes)
            {
                truncate_partial(&paths.partial_model_path, 0)?;
            }
            let mirror = descriptor.archived_mirror.as_ref().ok_or_else(|| format!(
                "{primary_error} No archived mirror is configured in this release. Retry Download when the original source is reachable, or install a release with verified archived model parts."))?;
            validate_archived_mirror(mirror, descriptor)?;
            preflight_download_space(&paths.partial_model_path, descriptor.expected_size_bytes)?;
            download_mirror(app, client, manager, paths, identity, descriptor, mirror).await
                .map_err(|error| if error == LOCAL_AI_DOWNLOAD_CANCELLED { error } else {
                    format!("Original model source failed; the archived mirror also failed. The partial is preserved. Retry Download when connected. {error}")
                })?;
            verify_downloaded_partial(app, manager, paths, descriptor).await
        }
    }
}

fn install_verified_partial(
    paths: &NativeModelPaths,
    descriptor: &LocalAiRuntimeDescriptor,
    mut fingerprint: VerificationFingerprint,
) -> Result<VerificationFingerprint, String> {
    ensure_regular_file(&paths.partial_model_path)?;
    ensure_regular_file(&paths.final_model_path)?;
    if fingerprint.algorithm_version != 1
        || fingerprint.path != paths.partial_model_path
        || fingerprint.len != descriptor.expected_size_bytes
        || fingerprint.sha256 != descriptor.expected_sha256
        || fs::metadata(&paths.partial_model_path)
            .map_err(|error| error.to_string())?
            .len()
            != fingerprint.len
        || file_modified_unix_ns(&paths.partial_model_path)? != fingerprint.modified_unix_ns
    {
        return Err(
            "The verified model partial changed before installation. Retry Download.".to_string(),
        );
    }
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&paths.partial_model_path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Cannot sync verified model: {error}"))?;
    fs::rename(&paths.partial_model_path, &paths.final_model_path)
        .map_err(|error| format!("Cannot install verified model: {error}"))?;
    sync_parent_directory(&paths.final_model_path)?;
    fingerprint.path = paths.final_model_path.clone();
    fingerprint.modified_unix_ns = file_modified_unix_ns(&paths.final_model_path)?;
    Ok(fingerprint)
}

pub async fn download_local_ai_model_inner<R: tauri::Runtime>(
    app: AppHandle<R>,
    manager: &LocalAiRuntimeManager,
) -> Result<LocalAiStatus, String> {
    validate_manifest_consistency()?;
    let descriptor = descriptor_from_manifest();
    let paths = native_model_paths(&app)?;
    if !claim_download(manager).await {
        return build_local_ai_status(&app, manager).await;
    }
    let cancel = manager.inner.lock().await.download_abort.clone();
    let mut guard = DownloadGuard {
        app: app.clone(),
        manager: manager.clone(),
        _file_lock: None,
        cancel,
        completed: false,
    };
    let result = async {
        use fs2::FileExt;
        let parent = paths.final_model_path.parent().ok_or("The model folder is unavailable.")?;
        fs::create_dir_all(parent).map_err(|error| format!("Cannot create model folder: {error}"))?;
        ensure_regular_file(&paths.download_lock_path)?;
        let lock = fs::OpenOptions::new().create(true).read(true).write(true).truncate(false)
            .open(&paths.download_lock_path).map_err(|error| format!("Cannot claim the model download: {error}"))?;
        lock.try_lock_exclusive().map_err(|_| "Another Kwantflow process is downloading this model. Wait for it to finish, then retry.".to_string())?;
        guard._file_lock = Some(lock);
        if paths.final_model_path.exists() {
            if verify_model_file(manager, &paths.final_model_path, &descriptor).await.is_ok() {
                return Ok(());
            }
            manager.inner.lock().await.verification_cache = None;
        }
        let mut identity = prepare_partial(&paths, &descriptor)?;
        preflight_download_space(&paths.partial_model_path, descriptor.expected_size_bytes)?;
        let client = Client::builder().https_only(true).connect_timeout(std::time::Duration::from_secs(15))
            .tcp_keepalive(Some(std::time::Duration::from_secs(15))).pool_max_idle_per_host(0).build()
            .map_err(|error| format!("Cannot create the model download client: {error}"))?;
        let fingerprint = download_from_sources(Some(&app), &client, manager, &paths, &mut identity, &descriptor, &remote_model_url(&descriptor)).await?;
        if manager.inner.lock().await.download_cancel_requested { return Err(LOCAL_AI_DOWNLOAD_CANCELLED.to_string()); }
        set_runtime_state(&app, manager, LocalAiInstallState::Verifying, None).await;
        // The validated partial and final path are on the same volume. Never
        // expose the final filename while downloading or hashing its contents.
        let fingerprint = install_verified_partial(&paths, &descriptor, fingerprint)?;
        manager.inner.lock().await.verification_cache = Some(fingerprint);
        let _ = fs::remove_file(&paths.partial_identity_path);
        Ok::<(), String>(())
    }.await;
    // Release the OS claim before releasing the in-process claim, and publish
    // the terminal state in that same lock so a retry cannot be overwritten.
    guard._file_lock.take();
    {
        let mut state = manager.inner.lock().await;
        let (install_state, last_error) = match result {
            Ok(()) => (LocalAiInstallState::Installed, None),
            Err(error) if error == LOCAL_AI_DOWNLOAD_CANCELLED => {
                (LocalAiInstallState::NotDownloaded, None)
            }
            Err(error) => (LocalAiInstallState::Failed, Some(error)),
        };
        state.install_state = install_state;
        state.last_error = last_error;
        state.active_download = None;
        state.download_in_progress = false;
        state.download_cancel_requested = false;
    }
    guard.completed = true;
    let status = build_local_ai_status(&app, manager).await?;
    let _ = app.emit("kwantflow-local-ai-status-changed", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn download_local_ai_model(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    download_local_ai_model_inner(app, manager.inner()).await
}

#[tauri::command]
pub async fn cancel_local_ai_download(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    {
        let mut state = manager.inner.lock().await;
        state.download_cancel_requested = true;
        state.download_abort.store(true, Ordering::SeqCst);
    }
    let status = build_local_ai_status(&app, manager.inner()).await?;
    let _ = app.emit("kwantflow-local-ai-status-changed", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn cancel_local_ai_runtime(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    let had_active_stream = {
        let state = manager.inner.lock().await;
        for abort in state.pending_completions.values() {
            abort.store(true, Ordering::SeqCst);
        }
        if let Some(active) = &state.active_completion {
            active.abort.store(true, Ordering::SeqCst);
        }
        manager.native_bridge.cancel();
        state.active_completion.is_some()
    };
    info!(
        "[local-ai] Runtime cancellation requested; active_stream={}",
        had_active_stream
    );
    info!("[local-ai] Runtime cancellation dispatched to native bridge");
    let status = build_local_ai_status(&app, manager.inner()).await?;
    let _ = app.emit("kwantflow-local-ai-status-changed", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn unload_local_ai_runtime(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    manager.unload().await?;
    let status = build_local_ai_status(&app, manager.inner()).await?;
    let _ = app.emit("kwantflow-local-ai-status-changed", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn remove_local_ai_model(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    let paths = native_model_paths(&app)?;
    if !claim_download(manager.inner()).await {
        return Err(
            "Cancel the active model download and wait for it to stop before removing the model."
                .to_string(),
        );
    }
    let cancel = manager.inner.lock().await.download_abort.clone();
    let mut guard = DownloadGuard {
        app: app.clone(),
        manager: manager.inner().clone(),
        _file_lock: None,
        cancel,
        completed: false,
    };
    ensure_regular_file(&paths.download_lock_path)?;
    if let Some(parent) = paths.download_lock_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    use fs2::FileExt;
    let lock = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&paths.download_lock_path)
        .map_err(|error| error.to_string())?;
    lock.try_lock_exclusive().map_err(|_| "Another Kwantflow process is using this model download. Close that process before removing it.".to_string())?;
    guard._file_lock = Some(lock);
    manager.unload().await?;
    for path in [
        &paths.final_model_path,
        &paths.partial_model_path,
        &paths.partial_identity_path,
    ] {
        ensure_regular_file(path)?;
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot remove model file: {error}")),
        }
    }
    guard._file_lock.take();
    let mut state = manager.inner.lock().await;
    state.install_state = LocalAiInstallState::NotDownloaded;
    state.last_error = None;
    state.verification_cache = None;
    state.download_in_progress = false;
    state.download_cancel_requested = false;
    drop(state);
    guard.completed = true;
    let status = build_local_ai_status(&app, manager.inner()).await?;
    let _ = app.emit("kwantflow-local-ai-status-changed", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn verify_local_ai_install(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    // Explicit verification rehashes even when size and timestamp did not change.
    manager.inner.lock().await.verification_cache = None;
    let status = verify_local_ai_install_inner(&app, manager.inner()).await;
    if let Ok(ref s) = status {
        let _ = app.emit("kwantflow-local-ai-status-changed", s.clone());
    }
    status
}

#[tauri::command]
pub async fn ensure_local_ai_ready(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiStatus, String> {
    let status = ensure_local_ai_runtime_ready_for_use(&app, manager.inner(), None).await;
    if let Ok(ref s) = status {
        let _ = app.emit("kwantflow-local-ai-status-changed", s.clone());
    }
    status
}

#[tauri::command]
pub async fn probe_local_ai_native_tools(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<LocalAiCapabilityProbeDiagnostics, String> {
    let status = ensure_local_ai_runtime_ready_for_use(&app, manager.inner(), None).await?;
    if !status.model_ready {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Kwantflow AI native runtime is not ready.".to_string()));
    }

    let _guard = InferenceGuard::acquire(
        manager.inner.clone(),
        &manager.native_bridge,
        LocalAiWorkloadClass::Interactive,
        None,
    )
    .await?;
    ensure_native_tool_probe_locked(manager.inner()).await
}

async fn ensure_native_tool_probe_locked(
    manager: &LocalAiRuntimeManager,
) -> Result<LocalAiCapabilityProbeDiagnostics, String> {
    if let Some(existing) = manager.inner.lock().await.capability_probe.clone() {
        if existing.source == "native_probe" {
            return Ok(existing);
        }
    }

    let started = Instant::now();
    let native_bridge = manager.native_bridge.clone();
    let mut native_task =
        tokio::task::spawn_blocking(move || native_bridge.probe_native_tool_calls());
    let probe_result = tokio::time::timeout(
        std::time::Duration::from_secs(LOCAL_AI_NATIVE_TOOL_PROBE_TIMEOUT_SECONDS),
        &mut native_task,
    )
    .await;

    let (supports_native_tools, supports_constrained, error_message) = match probe_result {
        Ok(join_result) => match join_result {
            Ok(Ok(supports_constrained)) => (true, supports_constrained, None),
            Ok(Err(error)) => (false, false, Some(error)),
            Err(error) => (
                false,
                false,
                Some(format!("LiteRT native tool probe thread panicked: {error}")),
            ),
        },
        Err(_) => {
            manager.native_bridge.cancel();
            if tokio::time::timeout(std::time::Duration::from_secs(10), &mut native_task)
                .await
                .is_err()
            {
                warn!(
                    "[local-ai] Native tool probe did not stop after cancellation; deferring engine recovery"
                );
                mark_runtime_poisoned(&manager.inner, "native_tool_probe").await;
                schedule_native_recovery_after_task(
                    manager.inner.clone(),
                    manager.native_bridge.clone(),
                    native_task,
                );
            }
            (
                false,
                false,
                Some(format!(
                    "LiteRT native tool probe timed out after {LOCAL_AI_NATIVE_TOOL_PROBE_TIMEOUT_SECONDS}s"
                )),
            )
        }
    };

    let diagnostics = local_ai_capability_probe_from_manifest(
        supports_native_tools,
        supports_constrained,
        Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64),
        "native_probe",
    );
    manager.inner.lock().await.capability_probe = Some(diagnostics.clone());
    if let Some(error) = error_message {
        return Err(error);
    }
    Ok(diagnostics)
}

fn request_prompt_character_count(request: &LocalAiCompletionRequest) -> usize {
    request
        .prompt
        .as_deref()
        .unwrap_or_default()
        .chars()
        .count()
        + request
            .system_instruction
            .as_deref()
            .unwrap_or_default()
            .chars()
            .count()
        + request
            .messages
            .as_ref()
            .and_then(|messages| serde_json::to_string(messages).ok())
            .map_or(0, |messages| messages.chars().count())
        + request
            .artifacts
            .iter()
            .map(|artifact| match artifact {
                LocalAiCompletionArtifact::Text { text_content } => text_content.chars().count(),
                LocalAiCompletionArtifact::Image { .. } => 0,
            })
            .sum::<usize>()
}

fn completion_diagnostics(
    request_id: &str,
    stage: &str,
    queue_ms: u64,
    started: Instant,
    artifact_count: usize,
    image_count: usize,
    char_count: usize,
    timeout_ms: u64,
    visual_token_budget: Option<i32>,
    context_token_count: Option<u64>,
    benchmark: Option<&NativeBenchmarkMetrics>,
    workload_class: LocalAiWorkloadClass,
    backend: &str,
    active_stream_count: u32,
) -> LocalAiCompletionDiagnostics {
    let context_size_tokens = compute_native_max_tokens() as u64;
    let measured_context_tokens = context_token_count.or_else(|| {
        benchmark.map(|metrics| {
            metrics
                .prefill_token_count
                .saturating_add(metrics.decode_token_count)
        })
    });
    let context_occupancy_ratio = measured_context_tokens.and_then(|tokens| {
        (context_size_tokens > 0).then_some(tokens as f64 / context_size_tokens as f64)
    });
    LocalAiCompletionDiagnostics {
        request_id: request_id.to_string(),
        stage: stage.to_string(),
        queue_ms,
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        runtime_kind: LocalAiRuntimeKind::LitertLm,
        timeout_seconds: timeout_ms.saturating_add(999) / 1_000,
        request_artifact_count: artifact_count,
        request_image_count: image_count,
        prompt_character_count: char_count,
        visual_token_budget,
        completion_reason: "completed".to_string(),
        cancellation_reason: None,
        context_size_tokens,
        context_token_count: measured_context_tokens,
        context_occupancy_ratio,
        output_token_count: benchmark.map(|metrics| metrics.decode_token_count),
        backend: backend.to_string(),
        active_stream_count,
        timings: LocalAiCompletionTimingDiagnostics {
            time_to_first_token_ms: benchmark
                .map(|metrics| metrics.conversation_time_to_first_token_seconds * 1_000.0),
            prefill_token_count: benchmark.map(|metrics| metrics.prefill_token_count),
            decode_token_count: benchmark.map(|metrics| metrics.decode_token_count),
            prefill_tokens_per_second: benchmark.map(|metrics| metrics.prefill_tokens_per_second),
            decode_tokens_per_second: benchmark.map(|metrics| metrics.decode_tokens_per_second),
            ..LocalAiCompletionTimingDiagnostics::default()
        },
        workload_class,
    }
}

fn completion_usage(benchmark: Option<&NativeBenchmarkMetrics>) -> LocalAiUsage {
    let prompt_token_count = benchmark.map(|metrics| metrics.prefill_token_count);
    let candidates_token_count = benchmark.map(|metrics| metrics.decode_token_count);
    LocalAiUsage {
        prompt_token_count,
        candidates_token_count,
        total_token_count: prompt_token_count
            .zip(candidates_token_count)
            .map(|(prompt, output)| prompt.saturating_add(output)),
    }
}

pub async fn run_local_ai_completion_inner<R: tauri::Runtime>(
    app: AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    request: LocalAiCompletionRequest,
    on_event: Option<Channel<LocalAiStreamEvent>>,
    abort: Arc<AtomicBool>,
) -> Result<LocalAiCompletionResponse, String> {
    let status = ensure_local_ai_runtime_ready_for_use(&app, manager, Some(&abort)).await?;
    if !status.model_ready {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Kwantflow AI native runtime is not ready.".to_string()));
    }

    let request_id = request.request_id.clone();
    let queue_started = Instant::now();
    let _guard = InferenceGuard::acquire(
        manager.inner.clone(),
        &manager.native_bridge,
        request.workload_class,
        Some(&abort),
    )
    .await?;
    let queue_ms = queue_started
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    register_active_completion(
        &manager.inner,
        &request.request_id,
        request.workload_class,
        abort.clone(),
    )
    .await?;
    ensure_completion_not_cancelled(Some(&abort))?;
    let capability_probe = if request_uses_native_tool_calls(&request) {
        ensure_native_tool_probe_locked(manager).await?
    } else {
        status.diagnostics.capability_probe.clone()
    };
    validate_native_tool_request(
        &request,
        capability_probe.supports_native_tool_calls,
        capability_probe.supports_constrained_tool_calls,
    )?;
    ensure_completion_not_cancelled(Some(&abort))?;

    let artifact_count = request.artifacts.len();
    let image_count = request
        .artifacts
        .iter()
        .filter(|artifact| matches!(artifact, LocalAiCompletionArtifact::Image { .. }))
        .count();
    let char_count = request_prompt_character_count(&request);

    let parse_tool_calls = request.parse_tool_calls;
    let workload_class = request.workload_class;
    let stage = request
        .stage
        .clone()
        .unwrap_or_else(|| "unspecified".to_string());
    let visual_token_budget = request.visual_token_budget;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(LOCAL_AI_COMPLETION_TIMEOUT_SECONDS.saturating_mul(1_000))
        .clamp(5_000, 300_000);
    let started = Instant::now();
    let native_bridge = manager.native_bridge.clone();
    let paths = native_model_paths(&app)?;
    let cache_dir = paths.cache_dir.clone();
    let enable_constrained = capability_probe.supports_constrained_tool_calls;
    let mut native_task = tokio::task::spawn_blocking(move || {
        ensure_completion_not_cancelled(Some(&abort))?;
        native_bridge.send_message_output(on_event, &cache_dir, &request, enable_constrained)
    });
    let native_result = match tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        &mut native_task,
    )
    .await
    {
        Ok(result) => {
            result.map_err(|error| format!("LiteRT stream completion thread panicked: {error}"))?
        }
        Err(_) => {
            manager.native_bridge.cancel();
            warn!(
                "[local-ai] Completion deadline reached; stage={}, timeout_ms={}, cancellation_reason=rust_total_deadline",
                stage, timeout_ms
            );
            if tokio::time::timeout(std::time::Duration::from_secs(10), &mut native_task)
                .await
                .is_err()
            {
                warn!(
                    "[local-ai] Native completion did not stop after cancellation; deferring engine recovery"
                );
                mark_runtime_poisoned(&manager.inner, &stage).await;
                schedule_native_recovery_after_task(
                    manager.inner.clone(),
                    manager.native_bridge.clone(),
                    native_task,
                );
            }
            return Err(format!(
                "LiteRT-LM completion timed out after {timeout_ms} ms."
            ));
        }
    };
    let native_output = match native_result {
        Ok(output) => output,
        Err(error) => {
            if native_error_requires_engine_reload(&error) {
                warn!(
                    "[local-ai] Resetting native engine after unrecoverable completion failure: {error}"
                );
                if let Err(cleanup_error) = manager.native_bridge.unload_engine() {
                    mark_runtime_poisoned(&manager.inner, "completion_failure").await;
                    return Err(format!("{error}; native cleanup failed: {cleanup_error}"));
                }
            }
            return Err(error);
        }
    };
    {
        let mut state = manager.inner.lock().await;
        state.last_completion_elapsed_ms = Some(started.elapsed().as_millis() as u64);
    }

    let benchmark = native_output.benchmark;
    // LiteRT-LM v0.16 owns tool-call detection and parsing. Raw marker
    // recovery would let a broken native contract masquerade as verified.
    let content = native_output.content;
    let thinking = native_output.thinking;
    info!(
        "[local-ai] Native completion channel lengths; stage={}, content_len={}, thinking_len={}, parse_tool_calls={}",
        stage,
        content.len(),
        thinking.len(),
        parse_tool_calls
    );
    let tool_calls = if parse_tool_calls {
        info!(
            "[local-ai] Native tool parsing emitted {} tool call(s), content_len={}",
            native_output.tool_calls.len(),
            content.len()
        );
        native_output.tool_calls
    } else {
        Vec::new()
    };
    if let Some(metrics) = &benchmark {
        info!(
            "[local-ai] Full-prefill benchmark; ttft_ms={:.1}, prefill_tokens={}, decode_tokens={}, prefill_tokens_per_second={:.1}, decode_tokens_per_second={:.1}",
            metrics.conversation_time_to_first_token_seconds * 1_000.0,
            metrics.prefill_token_count,
            metrics.decode_token_count,
            metrics.prefill_tokens_per_second,
            metrics.decode_tokens_per_second
        );
    }

    let diagnostics = completion_diagnostics(
        &request_id,
        &stage,
        queue_ms,
        started,
        artifact_count,
        image_count,
        char_count,
        timeout_ms,
        visual_token_budget,
        None,
        benchmark.as_ref(),
        workload_class,
        manager.native_bridge.selected_backend(),
        manager.native_bridge.active_stream_count(),
    );
    let usage = completion_usage(benchmark.as_ref());
    info!(
        "[local-ai] Completion diagnostics; stage={}, elapsed_ms={}, context_tokens={}, context_occupancy={:?}, output_tokens={:?}, completion_reason={}",
        diagnostics.stage,
        diagnostics.elapsed_ms,
        diagnostics.context_size_tokens,
        diagnostics.context_occupancy_ratio,
        diagnostics.output_token_count,
        diagnostics.completion_reason
    );
    Ok(LocalAiCompletionResponse {
        content: Value::String(content),
        thinking,
        model_id: load_runtime_manifest().client_runtime_id,
        usage,
        diagnostics,
        tool_calls,
    })
}

#[tauri::command]
pub async fn run_local_ai_completion(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
    request: LocalAiCompletionRequest,
) -> Result<LocalAiCompletionResponse, String> {
    let request_id = request.request_id.clone();
    let abort = Arc::new(AtomicBool::new(false));
    register_pending_completion(&manager.inner, &request_id, abort.clone()).await?;
    let result =
        run_local_ai_completion_inner(app, manager.inner(), request, None, abort.clone()).await;
    clear_active_completion(&manager.inner, &request_id).await;

    if abort.load(Ordering::SeqCst) {
        return Err("Kwantflow AI completion was cancelled.".to_string());
    }
    result
}

#[tauri::command]
pub async fn run_local_ai_completion_stream(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
    request: LocalAiCompletionRequest,
    on_event: Channel<LocalAiStreamEvent>,
) -> Result<LocalAiCompletionResponse, String> {
    let request_id = request.request_id.clone();
    let abort = Arc::new(AtomicBool::new(false));
    register_pending_completion(&manager.inner, &request_id, abort.clone()).await?;
    let result =
        run_local_ai_completion_inner(app, manager.inner(), request, Some(on_event), abort.clone())
            .await;
    clear_active_completion(&manager.inner, &request_id).await;

    if abort.load(Ordering::SeqCst) {
        return Err("Kwantflow AI completion was cancelled.".to_string());
    }
    result
}

#[tauri::command]
pub async fn abort_active_local_ai_completion(
    manager: State<'_, LocalAiRuntimeManager>,
    request_id: String,
) -> Result<(), String> {
    let had_request =
        request_active_completion_abort(&manager.inner, &request_id, &manager.native_bridge).await;
    info!(
        "[local-ai] Completion abort requested; matching_request={}",
        had_request
    );
    Ok(())
}

// ── Persistent Conversation Commands ──────────────────────────

/// Request payload for starting a conversation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConversationRequest {
    pub request_id: String,
    pub system_instruction: Option<String>,
    #[serde(default)]
    pub tools: Vec<Value>,
    #[serde(default)]
    pub messages: Option<Vec<Value>>,
    #[serde(default)]
    pub enable_thinking: bool,
    pub temperature: Option<f32>,
    pub top_k: Option<i32>,
    pub top_p: Option<f32>,
    pub seed: Option<i32>,
}

/// Request payload for sending a message to an existing conversation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRequest {
    pub request_id: String,
    pub stage: Option<String>,
    pub message: Value,
    #[serde(default)]
    pub parse_tool_calls: bool,
    pub max_output_tokens: Option<i32>,
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub workload_class: LocalAiWorkloadClass,
}

async fn start_local_ai_conversation_inner<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    request: StartConversationRequest,
    abort: Arc<AtomicBool>,
) -> Result<(), String> {
    let status = ensure_local_ai_runtime_ready_for_use(app, manager, Some(&abort)).await?;
    if !status.model_ready {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Kwantflow AI native runtime is not ready.".to_string()));
    }

    let _guard = InferenceGuard::acquire(
        manager.inner.clone(),
        &manager.native_bridge,
        LocalAiWorkloadClass::Interactive,
        Some(&abort),
    )
    .await?;
    register_active_completion(
        &manager.inner,
        &request.request_id,
        LocalAiWorkloadClass::Interactive,
        abort.clone(),
    )
    .await?;
    ensure_completion_not_cancelled(Some(&abort))?;
    if !request.tools.is_empty() {
        let capability_probe = ensure_native_tool_probe_locked(manager).await?;
        if !capability_probe.supports_native_tool_calls
            || !capability_probe.supports_constrained_tool_calls
        {
            return Err(NATIVE_TOOL_CALLS_DISABLED_MESSAGE.to_string());
        }
    }
    if abort.load(Ordering::SeqCst) {
        return Err("Kwantflow AI conversation setup was cancelled.".to_string());
    }

    let system_json: Option<String> = request
        .system_instruction
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| serde_json::Value::String(s.to_string()).to_string());
    let tool_count = request.tools.len();
    let history_count = request.messages.as_ref().map_or(0, Vec::len);
    let tools_json = serialise_litert_tool_declarations(&request.tools)?;

    let messages_json: Option<String> = request
        .messages
        .as_ref()
        .filter(|msgs| !msgs.is_empty())
        .map(|msgs| Value::Array(msgs.clone()).to_string());
    let extra_context_json: Option<String> = request
        .enable_thinking
        .then(|| json!({ "enable_thinking": true }).to_string());

    let native_bridge = manager.native_bridge.clone();
    let enable_thinking = request.enable_thinking;
    let mut native_task = tokio::task::spawn_blocking(move || {
        ensure_completion_not_cancelled(Some(&abort))?;
        native_bridge.create_conversation(
            system_json.as_deref(),
            tools_json.as_deref(),
            messages_json.as_deref(),
            extra_context_json.as_deref(),
            request.temperature,
            request.top_k,
            request.top_p,
            request.seed,
        )
    });
    match tokio::time::timeout(persistent_conversation_timeout(), &mut native_task).await {
        Ok(result) => {
            result.map_err(|error| format!("Conversation creation thread panicked: {error}"))??
        }
        Err(_) => {
            manager.native_bridge.cancel();
            warn!(
                "[local-ai] Persistent conversation setup deadline reached; timeout_ms={}, cancellation_reason=rust_total_deadline",
                persistent_conversation_timeout().as_millis()
            );
            if tokio::time::timeout(std::time::Duration::from_secs(10), &mut native_task)
                .await
                .is_err()
            {
                warn!(
                    "[local-ai] Persistent conversation setup did not stop after cancellation; deferring engine recovery"
                );
                mark_runtime_poisoned(&manager.inner, "persistent_conversation_setup").await;
                schedule_native_recovery_after_task(
                    manager.inner.clone(),
                    manager.native_bridge.clone(),
                    native_task,
                );
            }
            return Err(format!(
                "LiteRT-LM persistent conversation setup timed out after {} ms.",
                persistent_conversation_timeout().as_millis()
            ));
        }
    }

    info!(
        "[local-ai] Persistent conversation created; request_id={}, enableThinking={}, tool_count={}, history_count={}",
        request.request_id, enable_thinking, tool_count, history_count
    );
    Ok(())
}

#[tauri::command]
pub async fn start_local_ai_conversation(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
    request: StartConversationRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();
    let abort = Arc::new(AtomicBool::new(false));
    register_pending_completion(&manager.inner, &request_id, abort.clone()).await?;
    let result =
        start_local_ai_conversation_inner(&app, manager.inner(), request, abort.clone()).await;
    clear_active_completion(&manager.inner, &request_id).await;
    if abort.load(Ordering::SeqCst) {
        return Err("Kwantflow AI conversation setup was cancelled.".to_string());
    }
    result
}

#[tauri::command]
pub async fn send_local_ai_message(
    app: AppHandle,
    manager: State<'_, LocalAiRuntimeManager>,
    request: ConversationMessageRequest,
    on_event: Channel<LocalAiStreamEvent>,
) -> Result<LocalAiCompletionResponse, String> {
    let request_id = request.request_id.clone();
    let abort = Arc::new(AtomicBool::new(false));
    register_pending_completion(&manager.inner, &request_id, abort.clone()).await?;
    let result =
        send_local_ai_message_inner(&app, manager.inner(), request, on_event, abort.clone()).await;
    clear_active_completion(&manager.inner, &request_id).await;
    if abort.load(Ordering::SeqCst) {
        return Err("Kwantflow AI completion was cancelled.".to_string());
    }
    result
}

async fn send_local_ai_message_inner<R: tauri::Runtime>(
    app: &AppHandle<R>,
    manager: &LocalAiRuntimeManager,
    request: ConversationMessageRequest,
    on_event: Channel<LocalAiStreamEvent>,
    abort: Arc<AtomicBool>,
) -> Result<LocalAiCompletionResponse, String> {
    let status = ensure_local_ai_runtime_ready_for_use(app, manager, Some(&abort)).await?;
    if !status.model_ready {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Kwantflow AI native runtime is not ready.".to_string()));
    }

    let request_id = request.request_id.clone();
    let stage = request
        .stage
        .clone()
        .unwrap_or_else(|| "ask_kwantflow_turn".to_string());
    let workload_class = request.workload_class;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(persistent_conversation_timeout().as_millis() as u64)
        .clamp(1_000, 300_000);
    let queue_started = Instant::now();
    let _guard = InferenceGuard::acquire(
        manager.inner.clone(),
        &manager.native_bridge,
        workload_class,
        Some(&abort),
    )
    .await?;
    let queue_ms = queue_started
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    register_active_completion(
        &manager.inner,
        &request.request_id,
        workload_class,
        abort.clone(),
    )
    .await?;

    let started = Instant::now();
    let native_bridge = manager.native_bridge.clone();
    let message_str = request.message.to_string();
    let message_char_count = message_str.chars().count();
    let message_kind = if request.message.is_array() {
        "batch".to_string()
    } else {
        request
            .message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string()
    };
    info!(
        "[local-ai] Sending persistent conversation message: kind={}, bytes={}",
        message_kind,
        message_str.len()
    );
    let mut native_task = tokio::task::spawn_blocking(move || {
        ensure_completion_not_cancelled(Some(&abort))?;
        native_bridge.send_to_conversation(
            Some(on_event),
            &message_str,
            request.max_output_tokens.unwrap_or(2048).clamp(64, 8192),
        )
    });
    let native_result = match tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        &mut native_task,
    )
    .await
    {
        Ok(result) => {
            result.map_err(|error| format!("Conversation stream thread panicked: {error}"))?
        }
        Err(_) => {
            manager.native_bridge.cancel();
            warn!(
                "[local-ai] Persistent conversation deadline reached; timeout_ms={}, cancellation_reason=rust_total_deadline",
                timeout_ms
            );
            if tokio::time::timeout(std::time::Duration::from_secs(10), &mut native_task)
                .await
                .is_err()
            {
                warn!(
                    "[local-ai] Persistent conversation did not stop after cancellation; deferring engine recovery"
                );
                mark_runtime_poisoned(&manager.inner, "assistant_conversation").await;
                schedule_native_recovery_after_task(
                    manager.inner.clone(),
                    manager.native_bridge.clone(),
                    native_task,
                );
            }
            return Err(format!(
                "LiteRT-LM persistent conversation timed out after {} ms.",
                timeout_ms
            ));
        }
    };
    let native_output = match native_result {
        Ok(output) => output,
        Err(error) => {
            if native_error_requires_engine_reload(&error) {
                if let Err(cleanup_error) = manager.native_bridge.unload_engine() {
                    mark_runtime_poisoned(&manager.inner, "conversation_failure").await;
                    return Err(format!("{error}; native cleanup failed: {cleanup_error}"));
                }
            }
            return Err(error);
        }
    };

    {
        let mut state = manager.inner.lock().await;
        state.last_completion_elapsed_ms = Some(started.elapsed().as_millis() as u64);
    }
    let benchmark = native_output.benchmark;
    // Tool parsing is owned by LiteRT-LM v0.16. Do not recover raw model
    // markers, because that would hide an invalid native capability contract.
    let content = native_output.content;
    let tool_calls = if request.parse_tool_calls {
        native_output.tool_calls
    } else {
        Vec::new()
    };
    if let Some(benchmark) = &benchmark {
        info!(
            "[local-ai] Native benchmark; conversation_ttft_ms={:.1}, prefill_tokens={}, decode_tokens={}, latest_prefill_tokens_per_second={:.1}, latest_decode_tokens_per_second={:.1}",
            benchmark.conversation_time_to_first_token_seconds * 1000.0,
            benchmark.prefill_token_count,
            benchmark.decode_token_count,
            benchmark.prefill_tokens_per_second,
            benchmark.decode_tokens_per_second
        );
    }
    info!(
        "[local-ai] Conversation message processed: elapsed_ms={}, content_len={}, has_thinking={}, tool_calls={}",
        started.elapsed().as_millis(),
        content.len(),
        !native_output.thinking.is_empty(),
        tool_calls.len()
    );
    let diagnostics = completion_diagnostics(
        &request_id,
        &stage,
        queue_ms,
        started,
        0,
        0,
        message_char_count,
        timeout_ms,
        None,
        manager
            .native_bridge
            .get_conversation_token_count()
            .ok()
            .map(|count| count as u64),
        benchmark.as_ref(),
        workload_class,
        manager.native_bridge.selected_backend(),
        manager.native_bridge.active_stream_count(),
    );
    let usage = completion_usage(benchmark.as_ref());
    info!(
        "[local-ai] Completion diagnostics; stage={}, elapsed_ms={}, context_tokens={}, context_occupancy={:?}, output_tokens={:?}, completion_reason={}",
        diagnostics.stage,
        diagnostics.elapsed_ms,
        diagnostics.context_size_tokens,
        diagnostics.context_occupancy_ratio,
        diagnostics.output_token_count,
        diagnostics.completion_reason
    );
    Ok(LocalAiCompletionResponse {
        content: Value::String(content),
        thinking: native_output.thinking,
        model_id: load_runtime_manifest().client_runtime_id,
        usage,
        diagnostics,
        tool_calls,
    })
}

#[tauri::command]
pub async fn end_local_ai_conversation(
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<(), String> {
    let native_bridge = manager.native_bridge.clone();
    tokio::task::spawn_blocking(move || {
        native_bridge.destroy_conversation();
    })
    .await
    .map_err(|error| format!("Conversation destruction thread panicked: {error}"))?;

    info!("[local-ai] Persistent conversation destroyed");
    Ok(())
}

#[tauri::command]
pub async fn get_local_ai_conversation_tokens(
    manager: State<'_, LocalAiRuntimeManager>,
) -> Result<i32, String> {
    let native_bridge = manager.native_bridge.clone();
    tokio::task::spawn_blocking(move || native_bridge.get_conversation_token_count())
        .await
        .map_err(|error| format!("Token count thread panicked: {error}"))?
}

#[tauri::command]
pub async fn evaluate_estimate_expression(expression: String) -> Result<String, String> {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Err("Expression is empty".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '.' | '+' | '-' | '*' | '/' | '(' | ')' | ' '))
    {
        return Err("Expression contains unsupported characters".to_string());
    }

    let mut parser = ExpressionParser::new(trimmed);
    let value = parser.parse_expression()?;
    parser.skip_ws();
    if !parser.is_eof() {
        return Err("Expression contains trailing input".to_string());
    }
    if !value.is_finite() {
        return Err("Expression result is not finite".to_string());
    }
    Ok(format!("{value:.6}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string())
}

struct ExpressionParser<'a> {
    input: &'a [u8],
    pos: usize,
}

impl<'a> ExpressionParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input: input.as_bytes(),
            pos: 0,
        }
    }

    fn is_eof(&self) -> bool {
        self.pos >= self.input.len()
    }

    fn skip_ws(&mut self) {
        while self.pos < self.input.len() && self.input[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn parse_expression(&mut self) -> Result<f64, String> {
        let mut value = self.parse_term()?;
        loop {
            self.skip_ws();
            if self.eat(b'+') {
                value += self.parse_term()?;
            } else if self.eat(b'-') {
                value -= self.parse_term()?;
            } else {
                return Ok(value);
            }
        }
    }

    fn parse_term(&mut self) -> Result<f64, String> {
        let mut value = self.parse_factor()?;
        loop {
            self.skip_ws();
            if self.eat(b'*') {
                value *= self.parse_factor()?;
            } else if self.eat(b'/') {
                let divisor = self.parse_factor()?;
                if divisor == 0.0 {
                    return Err("Division by zero".to_string());
                }
                value /= divisor;
            } else {
                return Ok(value);
            }
        }
    }

    fn parse_factor(&mut self) -> Result<f64, String> {
        self.skip_ws();
        if self.eat(b'-') {
            return Ok(-self.parse_factor()?);
        }
        if self.eat(b'(') {
            let value = self.parse_expression()?;
            self.skip_ws();
            if !self.eat(b')') {
                return Err("Missing closing bracket".to_string());
            }
            return Ok(value);
        }
        self.parse_number()
    }

    fn parse_number(&mut self) -> Result<f64, String> {
        self.skip_ws();
        let start = self.pos;
        while self.pos < self.input.len()
            && (self.input[self.pos].is_ascii_digit() || self.input[self.pos] == b'.')
        {
            self.pos += 1;
        }
        if start == self.pos {
            return Err("Expected number".to_string());
        }
        std::str::from_utf8(&self.input[start..self.pos])
            .map_err(|_| "Invalid number".to_string())?
            .parse::<f64>()
            .map_err(|_| "Invalid number".to_string())
    }

    fn eat(&mut self, byte: u8) -> bool {
        self.skip_ws();
        if self.pos < self.input.len() && self.input[self.pos] == byte {
            self.pos += 1;
            true
        } else {
            false
        }
    }
}

pub async fn cleanup_local_ai_runtime<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(manager) = app.try_state::<LocalAiRuntimeManager>() {
        if let Err(error) = manager.unload().await {
            warn!("[local-ai] Native shutdown is incomplete: {error}");
        }
    }
}

#[cfg(test)]
#[path = "native_runtime_fingerprint.rs"]
mod native_runtime_fingerprint;

#[cfg(test)]
mod native_runtime_reset_contract_tests {
    use super::*;

    #[test]
    fn runtime_status_identity_includes_native_bytes_and_exact_model_identity() {
        let manifest = load_runtime_manifest();
        let descriptor = descriptor_from_manifest_with_runtime_override(false);
        assert_eq!(
            descriptor.runtime_version,
            format!(
                "{}+native-sha256:{}",
                manifest.litert_lm.runtime_version,
                env!("KWANTFLOW_NATIVE_RUNTIME_SHA256")
            )
        );
        assert_eq!(
            descriptor.model_artifact_id,
            format!(
                "{}@{}+sha256:{}",
                manifest.litert_lm.model_artifact_id,
                manifest.litert_lm.model_revision,
                manifest.litert_lm.model_sha256
            )
        );
    }

    #[test]
    fn runtime_status_identity_bypasses_cache_for_a_runtime_override() {
        let manifest = load_runtime_manifest();
        let descriptor = descriptor_from_manifest_with_runtime_override(true);
        assert_eq!(
            descriptor.runtime_version,
            format!(
                "{}+native-sha256:unknown",
                manifest.litert_lm.runtime_version
            )
        );
        assert_eq!(
            descriptor.model_artifact_id,
            descriptor_from_manifest_with_runtime_override(false).model_artifact_id
        );
    }

    #[test]
    fn persistent_conversation_has_a_bounded_deadline() {
        assert_eq!(
            persistent_conversation_timeout(),
            std::time::Duration::from_secs(LOCAL_AI_PERSISTENT_CONVERSATION_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn persistent_turns_forward_a_per_call_output_limit() {
        let header = include_str!("../native/litert_lm_bridge.h");
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");

        assert!(header.contains(
			"int kf_litert_send_message_to_conversation(KfLiteRtEngine* engine,\n                                           const char* message_json,\n                                           int max_output_tokens,"
		));
        assert!(bridge.contains("litert_lm_session_config_set_max_output_tokens"));
    }

    #[test]
    fn persistent_turn_request_owns_stage_deadline_and_workload() {
        let request: ConversationMessageRequest = serde_json::from_value(json!({
            "requestId": "ask-1",
            "stage": "ask_kwantflow_turn",
            "message": { "role": "user", "content": "Estimate this." },
            "parseToolCalls": true,
            "maxOutputTokens": 2048,
            "timeoutMs": 120000,
            "workloadClass": "interactive"
        }))
        .expect("canonical persistent turn request");

        assert_eq!(request.stage.as_deref(), Some("ask_kwantflow_turn"));
        assert_eq!(request.timeout_ms, Some(120_000));
        assert_eq!(request.workload_class, LocalAiWorkloadClass::Interactive);
    }

    #[test]
    fn status_reports_not_started_only_before_an_engine_exists() {
        assert_eq!(active_launch_profile(false, false), "not_started");
        assert_eq!(active_launch_profile(true, true), "gpu_preferred");
        assert_eq!(active_launch_profile(true, false), "cpu_only");
    }

    #[test]
    fn constrained_tool_probe_rejects_invalid_nested_enum_payloads() {
        let valid = json!({
            "function": {
                "arguments": "{\"units\":[{\"unitKey\":\"probe:unit:1\",\"summary\":\"probe-ok\"}]}"
            }
        });
        assert!(validate_native_probe_tool_call(&valid).is_ok());

        let wrong_unit_key = json!({
            "function": {
                "arguments": "{\"units\":[{\"unitKey\":\"wrong\",\"summary\":\"probe-ok\"}]}"
            }
        });
        assert!(validate_native_probe_tool_call(&wrong_unit_key).is_err());

        let missing_nested_summary = json!({
            "function": { "arguments": "{\"units\":[{\"unitKey\":\"probe:unit:1\"}]}" }
        });
        assert!(validate_native_probe_tool_call(&missing_nested_summary).is_err());
    }

    #[test]
    fn native_tool_capability_uses_one_constrained_production_roundtrip() {
        let source = include_str!("local_ai.rs");
        let start = source
            .find("fn probe_native_tool_calls(&self)")
            .expect("native tool probe implementation");
        let end = source[start..]
            .find("fn probe_native_tool_call_roundtrip")
            .expect("native tool roundtrip implementation");
        let implementation = &source[start..start + end];

        assert_eq!(
            implementation
                .matches("probe_native_tool_call_roundtrip(true)")
                .count(),
            1
        );
        assert!(!implementation.contains("probe_native_tool_call_roundtrip(false)"));
        assert_eq!(LOCAL_AI_NATIVE_TOOL_PROBE_TIMEOUT_SECONDS, 120);
    }

    #[test]
    fn reloads_engine_only_after_errors_that_can_poison_native_vision_state() {
        assert!(native_error_requires_engine_reload(
            "LiteRT-LM stream generation timed out (60s inactive)."
        ));
        assert!(native_error_requires_engine_reload(
            "vision_litert_compiled_model_executor.cc:641 litert_tensor_buffer.h:626"
        ));
        assert!(!native_error_requires_engine_reload(
            "The model returned malformed JSON"
        ));
    }

    #[test]
    fn native_streaming_events_use_typed_request_scoped_payloads() {
        assert_eq!(
            serde_json::to_value(LocalAiStreamEvent::Thinking {
                text: "reasoning".to_string()
            })
            .unwrap(),
            json!({"event":"thinking","data":{"text":"reasoning"}})
        );
        assert_eq!(
            serde_json::to_value(LocalAiStreamEvent::Content {
                text: "answer".to_string()
            })
            .unwrap(),
            json!({"event":"content","data":{"text":"answer"}})
        );
    }

    #[test]
    fn manifest_is_direct_model_contract_without_server_registry() {
        let manifest: serde_json::Value = serde_json::from_str(RUNTIME_MANIFEST_JSON).unwrap();

        assert!(manifest.get("serverHost").is_none());
        assert!(manifest.get("serverPort").is_none());
        assert!(manifest.get("platformArtifacts").is_none());

        let litert_lm = manifest
            .get("litertLm")
            .and_then(|v| v.as_object())
            .unwrap();
        assert_eq!(
            litert_lm.get("modelFileName").and_then(|v| v.as_str()),
            Some("gemma-4-e4b/model.litertlm")
        );
        assert_eq!(
            litert_lm
                .get("remoteArtifactFilename")
                .and_then(|v| v.as_str()),
            Some("gemma-4-E4B-it.litertlm")
        );
        assert!(litert_lm.get("sidecarName").is_none());
    }

    #[test]
    fn model_paths_use_expected_directories() {
        let base = PathBuf::from("/tmp/kwantflow-local-ai-test");
        let paths = NativeModelPaths::from_root(&base, &descriptor_from_manifest());

        assert_eq!(
            paths.final_model_path,
            base.join("models")
                .join("gemma-4-e4b")
                .join("model.litertlm")
        );
        assert_eq!(
            paths.cache_dir,
            base.join("cache").join("litert").join("gemma-4-e4b")
        );
    }

    #[test]
    fn native_bridge_load_failure_stays_native_without_python_or_server_fallback() {
        let bridge = NativeLiteRtBridge::unavailable_for_current_build();
        if cfg!(litert_lm_native) {
            // Native-enabled builds are validated by the real ABI smoke test;
            // this contract specifically covers the fail-closed stub adapter.
            return;
        }
        let result = bridge.load_engine(
            Path::new("/tmp/model.litertlm"),
            None,
            Path::new("/tmp/cache"),
            4096,
        );

        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(
            message.contains("native LiteRT-LM bridge is not linked")
                || message.contains("LiteRT-LM failed to create engine")
        );
        assert!(!message.contains("python"));
        assert!(!message.contains("localhost"));
        assert!(!message.contains("litert-lm serve"));
    }

    #[test]
    fn native_bridge_c_abi_exposes_only_required_runtime_surface() {
        let header = include_str!("../native/litert_lm_bridge.h");

        assert!(header.contains("kf_litert_create_engine"));
        assert!(header.contains("kf_litert_send_message"));
        assert!(header.contains("kf_litert_cancel"));
        assert!(header.contains("kf_litert_destroy_engine"));
        assert!(header.contains("KfLiteRtChunkCallback"));
        assert!(!header.contains("python"));
        assert!(!header.contains("localhost"));
        assert!(!header.contains("registry"));
    }

    #[test]
    fn top_p_sampling_always_has_a_positive_top_k_candidate_set() {
        assert_eq!(
            normalise_sampler_params(Some(0.2), None, None, Some(7)),
            (2, 10, 0.95, 0.2, 7)
        );
        assert_eq!(
            normalise_sampler_params(Some(0.2), None, Some(0.9), None),
            (2, 10, 0.9, 0.2, 0)
        );
        assert_eq!(
            normalise_sampler_params(Some(0.2), Some(20), Some(0.9), None),
            (2, 20, 0.9, 0.2, 0)
        );
    }

    #[test]
    fn deterministic_sampling_uses_the_v016_greedy_sampler() {
        assert_eq!(
            normalise_sampler_params(Some(0.0), None, None, Some(7)),
            (3, 1, 0.0, 0.0, 7)
        );
    }

    #[test]
    fn sampler_creation_failure_is_reported_through_the_kwantflow_abi() {
        let header = include_str!("../native/litert_lm_bridge.h");
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");

        assert!(header.contains("int kf_litert_set_sampler_params"));
        assert!(bridge.contains("if (engine->sampler_params == nullptr) return -1;"));
    }

    #[test]
    fn cancelled_native_streams_are_removed_from_the_pending_stream_registry() {
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");

        assert!(bridge.contains("litert_lm_conversation_cancel_process"));
        assert!(bridge.contains("void RemovePendingStream"));
        assert_eq!(
            bridge
                .matches("RemovePendingStream(engine, stream_state);")
                .count(),
            2
        );
        assert!(bridge.contains("generation timed out"));
        let cancel_start = bridge.find("void kf_litert_cancel").unwrap();
        let cancel_end = bridge[cancel_start..]
            .find("int kf_litert_get_active_stream_count")
            .map(|offset| cancel_start + offset)
            .unwrap();
        let cancel_body = &bridge[cancel_start..cancel_end];
        let lock_start = cancel_body
            .find("std::lock_guard<std::mutex> lock(engine->mutex);")
            .unwrap();
        let active_call = cancel_body
            .find("litert_lm_conversation_cancel_process(engine->active_conversation)")
            .unwrap();
        let lock_end = cancel_body
            .find("for (auto& stream : engine->pending_streams)")
            .unwrap();
        assert!(lock_start < active_call);
        assert!(active_call < lock_end);
    }

    #[test]
    fn native_bridge_exposes_active_stream_count_for_quiescence_checks() {
        let header = include_str!("../native/litert_lm_bridge.h");
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");

        assert!(header.contains("int kf_litert_get_active_stream_count"));
        assert!(bridge.contains("for (const auto& stream : engine->pending_streams)"));
        assert!(bridge.contains("if (!stream->done && !stream->cancelled) ++count;"));
        assert!(bridge.contains("!stream->done && !stream->cancelled"));
    }

    #[tokio::test]
    async fn active_completion_abort_and_cleanup_are_request_scoped() {
        let state = Arc::new(AsyncMutex::new(LocalAiMutableState::default()));
        let abort = Arc::new(AtomicBool::new(false));
        let bridge = NativeLiteRtBridge::new();

        register_pending_completion(&state, "request-a", abort.clone())
            .await
            .unwrap();
        register_active_completion(
            &state,
            "request-a",
            LocalAiWorkloadClass::UserBatch,
            abort.clone(),
        )
        .await
        .unwrap();
        assert!(!request_active_completion_abort(&state, "request-b", &bridge).await);
        assert!(!abort.load(Ordering::SeqCst));
        clear_active_completion(&state, "request-b").await;
        assert!(state.lock().await.active_completion.is_some());

        assert!(request_active_completion_abort(&state, "request-a", &bridge).await);
        assert!(abort.load(Ordering::SeqCst));
        clear_active_completion(&state, "request-a").await;
        assert!(state.lock().await.active_completion.is_none());
        assert!(state.lock().await.pending_completions.is_empty());
    }

    #[tokio::test]
    async fn duplicate_pending_request_ids_cannot_replace_cancellation_ownership() {
        let manager = LocalAiRuntimeManager::default();
        let original_abort = Arc::new(AtomicBool::new(false));
        let duplicate_abort = Arc::new(AtomicBool::new(false));
        register_pending_completion(&manager.inner, "same-id", original_abort.clone())
            .await
            .unwrap();
        assert!(
            register_pending_completion(&manager.inner, "same-id", duplicate_abort.clone())
                .await
                .is_err()
        );
        assert!(
            request_active_completion_abort(&manager.inner, "same-id", &manager.native_bridge)
                .await
        );
        assert!(original_abort.load(Ordering::SeqCst));
        assert!(!duplicate_abort.load(Ordering::SeqCst));
        clear_active_completion(&manager.inner, "same-id").await;
        assert!(
            register_pending_completion(&manager.inner, "same-id", duplicate_abort)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn finished_request_cleanup_cannot_clear_or_cancel_the_next_active_request() {
        let manager = LocalAiRuntimeManager::default();
        let old_abort = Arc::new(AtomicBool::new(false));
        let next_abort = Arc::new(AtomicBool::new(false));
        register_pending_completion(&manager.inner, "old", old_abort.clone())
            .await
            .unwrap();
        register_active_completion(
            &manager.inner,
            "old",
            LocalAiWorkloadClass::UserBatch,
            old_abort,
        )
        .await
        .unwrap();
        register_pending_completion(&manager.inner, "next", next_abort.clone())
            .await
            .unwrap();
        register_active_completion(
            &manager.inner,
            "next",
            LocalAiWorkloadClass::Interactive,
            next_abort.clone(),
        )
        .await
        .unwrap();
        clear_active_completion(&manager.inner, "old").await;
        assert!(
            !request_active_completion_abort(&manager.inner, "old", &manager.native_bridge).await
        );
        assert!(!next_abort.load(Ordering::SeqCst));
        let state = manager.inner.lock().await;
        assert_eq!(state.active_completion.as_ref().unwrap().request_id, "next");
        assert!(state.pending_completions.contains_key("next"));
    }

    #[tokio::test]
    async fn cancelled_queued_request_exits_without_waiting_for_or_cancelling_active_work() {
        let manager = LocalAiRuntimeManager::default();
        let active_abort = Arc::new(AtomicBool::new(false));
        register_pending_completion(&manager.inner, "running", active_abort.clone())
            .await
            .unwrap();
        let active_guard = InferenceGuard::acquire(
            manager.inner.clone(),
            &manager.native_bridge,
            LocalAiWorkloadClass::Interactive,
            Some(&active_abort),
        )
        .await
        .unwrap();
        register_active_completion(
            &manager.inner,
            "running",
            LocalAiWorkloadClass::Interactive,
            active_abort.clone(),
        )
        .await
        .unwrap();

        let queued_abort = Arc::new(AtomicBool::new(false));
        register_pending_completion(&manager.inner, "queued", queued_abort.clone())
            .await
            .unwrap();
        let queued_manager = manager.clone();
        let queued_flag = queued_abort.clone();
        let queued = tokio::spawn(async move {
            let _guard = InferenceGuard::acquire(
                queued_manager.inner.clone(),
                &queued_manager.native_bridge,
                LocalAiWorkloadClass::UserBatch,
                Some(&queued_flag),
            )
            .await?;
            register_active_completion(
                &queued_manager.inner,
                "queued",
                LocalAiWorkloadClass::UserBatch,
                queued_flag,
            )
            .await
        });
        tokio::task::yield_now().await;
        assert!(
            request_active_completion_abort(&manager.inner, "queued", &manager.native_bridge).await
        );
        let error = tokio::time::timeout(std::time::Duration::from_secs(1), queued)
            .await
            .expect("cancelled queue wait must finish while active gate is still held")
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(!active_abort.load(Ordering::SeqCst));
        assert_eq!(
            manager
                .inner
                .lock()
                .await
                .active_completion
                .as_ref()
                .unwrap()
                .request_id,
            "running"
        );
        assert!(register_active_completion(
            &manager.inner,
            "queued",
            LocalAiWorkloadClass::UserBatch,
            queued_abort
        )
        .await
        .is_err());
        clear_active_completion(&manager.inner, "queued").await;
        assert_eq!(
            manager
                .inner
                .lock()
                .await
                .active_completion
                .as_ref()
                .unwrap()
                .request_id,
            "running"
        );

        drop(active_guard);
        clear_active_completion(&manager.inner, "running").await;
        let _next_guard = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            InferenceGuard::acquire(
                manager.inner.clone(),
                &manager.native_bridge,
                LocalAiWorkloadClass::Interactive,
                None,
            ),
        )
        .await
        .expect("cancelled request must not leave its queue waiter behind")
        .unwrap();
    }

    #[tokio::test]
    async fn completion_and_conversation_requests_can_cancel_while_waiting_for_a_shared_engine_load(
    ) {
        for operation in ["completion", "conversation_setup", "conversation_message"] {
            let app = tauri::test::mock_app();
            let manager = LocalAiRuntimeManager::default();
            manager.inner.lock().await.install_state = LocalAiInstallState::Loading;
            let lifecycle_gate = manager.inner.lock().await.lifecycle_gate.clone();
            let _loading_owner = lifecycle_gate.lock_owned().await;
            let abort = Arc::new(AtomicBool::new(false));
            register_pending_completion(&manager.inner, operation, abort.clone())
                .await
                .unwrap();
            let request = async {
                match operation {
                    "completion" => {
                        let payload = serde_json::from_value(json!({"requestId": operation, "prompt": "Synthetic cancellation test"})).unwrap();
                        run_local_ai_completion_inner(
                            app.handle().clone(),
                            &manager,
                            payload,
                            None,
                            abort.clone(),
                        )
                        .await
                        .map(|_| ())
                    }
                    "conversation_setup" => {
                        let payload =
                            serde_json::from_value(json!({"requestId": operation})).unwrap();
                        start_local_ai_conversation_inner(
                            app.handle(),
                            &manager,
                            payload,
                            abort.clone(),
                        )
                        .await
                    }
                    _ => {
                        let payload = serde_json::from_value(json!({"requestId": operation, "message": {"role": "user", "content": "Synthetic cancellation test"}})).unwrap();
                        send_local_ai_message_inner(
                            app.handle(),
                            &manager,
                            payload,
                            Channel::new(|_| Ok(())),
                            abort.clone(),
                        )
                        .await
                        .map(|_| ())
                    }
                }
            };
            tokio::pin!(request);
            tokio::select! {
                result = &mut request => panic!("{operation} should wait for the shared load: {result:?}"),
                _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => {},
            }
            assert!(
                request_active_completion_abort(&manager.inner, operation, &manager.native_bridge)
                    .await
            );
            let error = tokio::time::timeout(std::time::Duration::from_secs(1), &mut request)
                .await
                .expect("cancelled request must not await the shared load forever")
                .unwrap_err();
            assert!(error.contains("cancelled"), "{operation}: {error}");
            let state = manager.inner.lock().await;
            assert_eq!(
                state.install_state,
                LocalAiInstallState::Loading,
                "request cancellation must preserve another caller's load"
            );
            assert!(state.active_completion.is_none());
            assert!(!manager.native_bridge.is_engine_loaded());
            drop(state);
            clear_active_completion(&manager.inner, operation).await;
            assert!(manager.inner.lock().await.pending_completions.is_empty());
        }
    }

    #[tokio::test]
    async fn an_already_cancelled_foreground_request_does_not_preempt_background_work() {
        let manager = LocalAiRuntimeManager::default();
        let background_abort = Arc::new(AtomicBool::new(false));
        let _background_guard = InferenceGuard::acquire(
            manager.inner.clone(),
            &manager.native_bridge,
            LocalAiWorkloadClass::Background,
            None,
        )
        .await
        .unwrap();
        register_active_completion(
            &manager.inner,
            "background",
            LocalAiWorkloadClass::Background,
            background_abort.clone(),
        )
        .await
        .unwrap();
        let cancelled = AtomicBool::new(true);
        assert!(InferenceGuard::acquire(
            manager.inner.clone(),
            &manager.native_bridge,
            LocalAiWorkloadClass::Interactive,
            Some(&cancelled)
        )
        .await
        .is_err());
        assert!(!background_abort.load(Ordering::SeqCst));
        assert_eq!(
            manager
                .inner
                .lock()
                .await
                .active_completion
                .as_ref()
                .unwrap()
                .request_id,
            "background"
        );
    }

    #[tokio::test]
    async fn unloading_waits_for_a_detached_initializer_and_cannot_leave_its_engine_resident() {
        let _test_lock = TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp.path());
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();
        let lifecycle_guard = acquire_runtime_lifecycle(&manager, None).await.unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = manager.native_bridge.clone();
        let initializer = start_runtime_initialization(
            app.handle().clone(),
            manager.clone(),
            lifecycle_guard,
            move || {
                let _ = started_tx.send(());
                release_rx.recv().unwrap();
                *bridge.state.engine.lock().unwrap() = Some(NativeEngineHandle(ptr::null_mut()));
                Ok(())
            },
        );
        started_rx.await.unwrap();
        drop(initializer); // A request/window can disappear while native creation continues.
        let unloading_manager = manager.clone();
        let unload = tokio::spawn(async move { unloading_manager.unload().await });
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        let completed_before_initialization = unload.is_finished();
        release_tx.send(()).unwrap();
        let gate = manager.inner.lock().await.lifecycle_gate.clone();
        let _finished_initialization = gate.lock_owned().await;
        unload.await.unwrap().unwrap();
        assert!(
            !completed_before_initialization,
            "unload must not report success while the constructor can still publish an engine"
        );
        assert!(
            !manager.native_bridge.is_engine_loaded(),
            "the detached constructor must not publish a resident engine after unload completed"
        );
        assert_ne!(
            manager.inner.lock().await.install_state,
            LocalAiInstallState::Loading
        );
        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }

    #[tokio::test]
    async fn concurrent_first_use_waits_for_one_initialization_owner_and_reuses_its_engine() {
        let _test_lock = TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp.path());
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();
        let lifecycle_guard = acquire_runtime_lifecycle(&manager, None).await.unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = manager.native_bridge.clone();
        let initializer = start_runtime_initialization(
            app.handle().clone(),
            manager.clone(),
            lifecycle_guard,
            move || {
                let _ = started_tx.send(());
                release_rx.recv().unwrap();
                *bridge.state.engine.lock().unwrap() = Some(NativeEngineHandle(ptr::null_mut()));
                Ok(())
            },
        );
        started_rx.await.unwrap();
        let readiness = ensure_local_ai_runtime_ready_for_use(app.handle(), &manager, None);
        tokio::pin!(readiness);
        let blocked = tokio::select! {
            _ = &mut readiness => false,
            _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => true,
        };
        release_tx.send(()).unwrap();
        initializer.await.unwrap().unwrap();
        readiness.await.unwrap();
        assert!(blocked, "concurrent readiness must not inspect or initialize the model outside the shared initialization owner");
        assert!(manager.native_bridge.is_engine_loaded());
        manager.unload().await.unwrap();
        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }

    #[tokio::test]
    async fn cancelling_the_first_request_stops_its_wait_and_preserves_the_shared_initializer() {
        let _test_lock = TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp.path());
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();
        let abort = Arc::new(AtomicBool::new(false));
        register_pending_completion(&manager.inner, "first-request", abort.clone())
            .await
            .unwrap();
        let lifecycle_guard = acquire_runtime_lifecycle(&manager, Some(&abort))
            .await
            .unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = manager.native_bridge.clone();
        let initializer = start_runtime_initialization(
            app.handle().clone(),
            manager.clone(),
            lifecycle_guard,
            move || {
                let _ = started_tx.send(());
                release_rx.recv().unwrap();
                *bridge.state.engine.lock().unwrap() = Some(NativeEngineHandle(ptr::null_mut()));
                Ok(())
            },
        );
        started_rx.await.unwrap();
        let waiting_request = await_runtime_initialization(initializer, Some(&abort));
        tokio::pin!(waiting_request);
        tokio::select! {
            _ = &mut waiting_request => panic!("first request must wait for the blocked constructor"),
            _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => {},
        }
        request_active_completion_abort(&manager.inner, "first-request", &manager.native_bridge)
            .await;
        let cancelled =
            tokio::time::timeout(std::time::Duration::from_secs(1), &mut waiting_request).await;
        let still_loading =
            manager.inner.lock().await.install_state == LocalAiInstallState::Loading;
        let unloading_manager = manager.clone();
        let unload = tokio::spawn(async move { unloading_manager.unload().await });
        release_tx.send(()).unwrap();
        unload.await.unwrap().unwrap();
        assert!(cancelled.unwrap().unwrap_err().contains("cancelled"));
        assert!(still_loading);
        assert!(!manager.native_bridge.is_engine_loaded());
        clear_active_completion(&manager.inner, "first-request").await;
        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }

    #[tokio::test]
    async fn unloading_invalidates_readiness_that_was_already_waiting_for_initialization() {
        let manager = LocalAiRuntimeManager::default();
        let gate = manager.inner.lock().await.lifecycle_gate.clone();
        let initializing = gate.lock_owned().await;
        let readiness = acquire_runtime_lifecycle(&manager, None);
        tokio::pin!(readiness);
        tokio::select! {
            _ = &mut readiness => panic!("readiness must queue behind initialization"),
            _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => {},
        }
        let unloading_manager = manager.clone();
        let unload = tokio::spawn(async move { unloading_manager.unload().await });
        tokio::task::yield_now().await;
        drop(initializing);
        let error = readiness
            .await
            .err()
            .expect("unloading must invalidate a previously queued initialization");
        assert!(error.contains("unloading"));
        unload.await.unwrap().unwrap();
        assert!(!manager.native_bridge.is_engine_loaded());
    }

    #[tokio::test]
    async fn unload_timeout_returns_failure_and_its_owner_finishes_before_readiness_can_resume() {
        let _test_lock = TEST_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp.path());
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();
        let lifecycle_guard = acquire_runtime_lifecycle(&manager, None).await.unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = manager.native_bridge.clone();
        let initializer = start_runtime_initialization(
            app.handle().clone(),
            manager.clone(),
            lifecycle_guard,
            move || {
                let _ = started_tx.send(());
                release_rx.recv().unwrap();
                *bridge.state.engine.lock().unwrap() = Some(NativeEngineHandle(ptr::null_mut()));
                Ok(())
            },
        );
        started_rx.await.unwrap();
        let unload_result = manager.unload().await;
        let blocked_readiness = acquire_runtime_lifecycle(&manager, None).await.is_err();
        release_tx.send(()).unwrap(); // Release the native owner before asserting, even on regression.
        initializer.await.unwrap().unwrap();
        let gate = manager.inner.lock().await.lifecycle_gate.clone();
        let _finished_unload = gate.lock_owned().await;
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while manager.inner.lock().await.unloads_in_progress != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(unload_result.unwrap_err().contains("still unloading"));
        assert!(blocked_readiness);
        assert!(!manager.native_bridge.is_engine_loaded());
        assert!(!manager.inner.lock().await.runtime_poisoned);
        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }

    #[tokio::test]
    async fn failed_native_unload_does_not_report_success_or_allow_new_initialization() {
        let manager = LocalAiRuntimeManager::default();
        let bridge = manager.native_bridge.clone();
        let _ = std::thread::spawn(move || {
            let _engine_lock = bridge.state.engine.lock().unwrap();
            panic!("Synthetic native engine mutex poisoning");
        })
        .join();
        let error = manager.unload().await.unwrap_err();
        assert!(error.contains("engine lock is poisoned"));
        assert!(manager.inner.lock().await.runtime_poisoned);
        assert_eq!(manager.inner.lock().await.unloads_in_progress, 0);
        assert!(acquire_runtime_lifecycle(&manager, None).await.is_err());
    }

    #[tokio::test]
    async fn model_file_removal_or_download_prevents_native_initialization() {
        let manager = LocalAiRuntimeManager::default();
        manager.inner.lock().await.download_in_progress = true;
        let error = acquire_runtime_lifecycle(&manager, None)
            .await
            .err()
            .unwrap();
        assert!(error.contains("downloaded or removed"));
        assert!(!manager.native_bridge.is_engine_loaded());
    }

    #[tokio::test]
    async fn poisoned_runtime_rejects_new_inference_work() {
        let state = Arc::new(AsyncMutex::new(LocalAiMutableState::default()));
        state.lock().await.runtime_poisoned = true;
        let bridge = NativeLiteRtBridge::new();

        let result =
            InferenceGuard::acquire(state, &bridge, LocalAiWorkloadClass::Interactive, None).await;
        assert!(
            result.is_err(),
            "poisoned runtime must reject new inference"
        );
        let error = result.err().unwrap_or_default();

        assert!(error.contains("cleanup"));
    }

    #[tokio::test]
    async fn foreground_work_cancels_only_the_active_background_request() {
        let manager = LocalAiRuntimeManager::default();
        let background_guard = InferenceGuard::acquire(
            manager.inner.clone(),
            &manager.native_bridge,
            LocalAiWorkloadClass::Background,
            None,
        )
        .await
        .unwrap();
        let background_abort = Arc::new(AtomicBool::new(false));
        register_active_completion(
            &manager.inner,
            "background-request",
            LocalAiWorkloadClass::Background,
            background_abort.clone(),
        )
        .await
        .unwrap();

        let foreground_state = manager.inner.clone();
        let foreground_bridge = manager.native_bridge.clone();
        let foreground = tokio::spawn(async move {
            InferenceGuard::acquire(
                foreground_state,
                &foreground_bridge,
                LocalAiWorkloadClass::Interactive,
                None,
            )
            .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !background_abort.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("foreground request should cancel active background work");
        drop(background_guard);
        assert!(foreground.await.unwrap().is_ok());
    }

    #[test]
    fn persistent_tool_conversation_enables_native_constrained_decoding() {
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");
        assert!(bridge.contains("litert_lm_conversation_config_set_enable_constrained_decoding"));
    }

    #[test]
    fn persistent_turns_use_a_transactional_conversation_branch() {
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");
        let start = bridge
            .find("int kf_litert_send_message_to_conversation")
            .expect("persistent send function");
        let end = start
            + bridge[start..]
                .find("void kf_litert_destroy_conversation")
                .expect("persistent destroy function");
        let body = &bridge[start..end];

        // LiteRT-LM v0.16 documents that cancelling a Conversation poisons
        // its underlying Session. The released C Conversation API exposes no
        // checkpoint/rewind handle, so clone is the cancellation-safe branch:
        // only a completed branch replaces the committed conversation.
        let clone = body
            .find("litert_lm_conversation_clone(engine->persistent_conversation)")
            .expect("persistent conversation clone");
        let cancel = body
            .find("litert_lm_conversation_cancel_process(conversation)")
            .expect("cancelled branch cleanup");
        let commit = body
            .find("engine->persistent_conversation = conversation")
            .expect("successful branch commit");
        assert!(clone < cancel);
        assert!(cancel < commit);
    }

    #[test]
    fn persistent_conversation_passes_extra_context_to_litert() {
        let header = include_str!("../native/litert_lm_bridge.h");
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");

        assert!(header.contains("const char* extra_context_json"));
        assert!(bridge.contains("litert_lm_conversation_config_set_extra_context"));
    }

    #[test]
    fn full_prefill_bridge_passes_visual_token_budget_to_litert() {
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");
        assert!(bridge.contains("litert_lm_conversation_optional_args_set_visual_token_budget"));
    }

    #[test]
    fn persistent_conversation_exposes_native_benchmark_metrics() {
        let header = include_str!("../native/litert_lm_bridge.h");
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");
        assert!(header.contains("kf_litert_get_conversation_benchmark"));
        assert!(bridge.contains("kf_litert_get_conversation_benchmark"));
        assert!(bridge.contains("return -1"));
    }

    #[test]
    fn full_prefill_completion_snapshots_benchmark_before_conversation_delete() {
        let bridge = include_str!("../native/litert_lm_bridge_litert.cc");
        let start = bridge.find("int kf_litert_send_message(").unwrap();
        let end = bridge
            .find("// ── Persistent Conversation Lifecycle")
            .unwrap();
        let body = &bridge[start..end];
        let benchmark = body
            .find("litert_lm_conversation_get_benchmark_info")
            .unwrap();
        let delete = body[benchmark..]
            .find("litert_lm_conversation_delete(conversation)")
            .map(|offset| benchmark + offset)
            .unwrap();
        assert!(benchmark < delete);
    }

    #[test]
    fn native_tool_requests_are_rejected_when_probe_disables_them() {
        let request = LocalAiCompletionRequest {
            request_id: "native-tools-disabled".to_string(),
            stage: None,
            system_instruction: Some("Use a tool.".to_string()),
            prompt: None,
            artifacts: vec![],
            tools: vec![json!({
                "type": "function",
                "function": {
                    "name": "records_search",
                    "description": "Lookup records.",
                    "parameters": {"type": "object", "properties": {}}
                }
            })],
            parse_tool_calls: true,
            enable_thinking: false,
            max_output_tokens: None,
            visual_token_budget: None,
            timeout_ms: None,
            workload_class: LocalAiWorkloadClass::UserBatch,
            messages: Some(vec![json!({
                "role": "user",
                "content": "Call records_search."
            })]),
            temperature: Some(0.0),
            top_k: None,
            top_p: None,
            seed: None,
        };

        assert_eq!(
            validate_native_tool_request(&request, false, false).unwrap_err(),
            NATIVE_TOOL_CALLS_DISABLED_MESSAGE
        );
        assert_eq!(
            validate_native_tool_request(&request, true, false).unwrap_err(),
            NATIVE_TOOL_CALLS_DISABLED_MESSAGE
        );
        assert!(validate_native_tool_request(&request, true, true).is_ok());
    }

    #[test]
    fn native_tool_requests_require_the_canonical_messages_transport() {
        let request = LocalAiCompletionRequest {
            request_id: "native-tools-prompt-transport".to_string(),
            stage: None,
            system_instruction: Some("Use a tool.".to_string()),
            prompt: Some("Call records_search.".to_string()),
            artifacts: vec![],
            tools: vec![json!({
                "type": "function",
                "function": {
                    "name": "records_search",
                    "description": "Lookup records.",
                    "parameters": {"type": "object", "properties": {}}
                }
            })],
            parse_tool_calls: true,
            enable_thinking: false,
            max_output_tokens: None,
            visual_token_budget: None,
            timeout_ms: None,
            workload_class: LocalAiWorkloadClass::UserBatch,
            messages: None,
            temperature: Some(0.0),
            top_k: None,
            top_p: None,
            seed: None,
        };

        assert_eq!(
            validate_native_tool_request(&request, true, true).unwrap_err(),
            "Native tool requests must use the canonical messages transport without prompt."
        );
    }

    #[test]
    fn completion_diagnostics_count_canonical_messages_and_text_evidence() {
        let request = LocalAiCompletionRequest {
            request_id: "diagnostic-count".to_string(),
            stage: Some("evidence_extraction".to_string()),
            system_instruction: Some("system".to_string()),
            prompt: None,
            artifacts: vec![LocalAiCompletionArtifact::Text {
                text_content: "evidence".to_string(),
            }],
            tools: vec![],
            parse_tool_calls: false,
            messages: Some(vec![json!({"role": "user", "content": "inspect"})]),
            temperature: Some(0.0),
            top_k: None,
            top_p: None,
            seed: None,
            enable_thinking: false,
            max_output_tokens: Some(256),
            visual_token_budget: None,
            timeout_ms: Some(90_000),
            workload_class: LocalAiWorkloadClass::UserBatch,
        };

        let message_count = serde_json::to_string(request.messages.as_ref().unwrap())
            .unwrap()
            .chars()
            .count();
        assert_eq!(
            request_prompt_character_count(&request),
            "system".chars().count() + "evidence".chars().count() + message_count
        );
    }

    #[test]
    fn native_text_chunk_extractor_accepts_upstream_conversation_message_shapes() {
        let v1: Value =
            serde_json::from_str(r#"{"role":"model","content":{"type":"text","text":"hello"}}"#)
                .unwrap();
        assert_eq!(extract_message_text(&v1).unwrap(), "hello");

        let v2: Value = serde_json::from_str(r#"{"role":"model","content":"hello"}"#).unwrap();
        assert_eq!(extract_message_text(&v2).unwrap(), "hello");

        let v3: Value = serde_json::from_str(r#"{"role":"model","content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}]}"#).unwrap();
        assert_eq!(extract_message_text(&v3).unwrap(), "hello world");

        let v4: Value = serde_json::from_str(r#"{"channels":{"thought":"hello"}}"#).unwrap();
        assert!(extract_message_text(&v4).is_none());
    }

    #[test]
    fn native_message_normalisation_preserves_v016_tool_response_parts() {
        let messages = vec![json!({
            "role": "tool",
            "content": [{
                "type": "tool_response",
                "tool_response": {
                    "name": "records_get",
                    "value": {"status": "ok", "recordId": "material-1"}
                }
            }]
        })];

        assert_eq!(
            normalise_native_conversation_messages(&messages).unwrap(),
            messages
        );
        assert!(normalise_native_conversation_messages(&[json!({
            "role": "tool",
            "content": {"name": "records_get", "response": {"status": "ok"}}
        })])
        .is_err());
    }

    #[test]
    fn native_multimodal_content_orders_images_before_text() {
        let content = images_before_text(
            vec![json!({"type": "image", "path": "/tmp/part.png"})],
            vec![json!({"type": "text", "text": "Inspect the part."})],
        );

        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[1]["type"], "text");
    }

    #[test]
    fn native_tool_declarations_preserve_gemma4_v016_template_shape() {
        let declarations = normalise_litert_tool_declarations(&[json!({
            "type": "function",
            "function": {
                "name": "records_get",
                "description": "Get one record.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            }
        })])
        .unwrap();

        assert_eq!(
            declarations,
            vec![json!({
                "type": "function",
                "function": {
                    "name": "records_get",
                    "description": "Get one record.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        },
                        "required": ["id"],
                        "additionalProperties": false
                    }
                }
            })]
        );
        assert_eq!(declarations[0]["type"], "function");
        assert_eq!(declarations[0]["function"]["name"], "records_get");
    }

    #[test]
    fn native_tool_declarations_reject_bare_or_malformed_app_contracts() {
        assert!(normalise_litert_tool_declarations(&[json!({
            "name": "records_get",
            "description": "Get one record.",
            "parameters": { "type": "object" }
        })])
        .is_err());
        assert!(normalise_litert_tool_declarations(&[json!({
            "type": "function",
            "function": {
                "name": "records_get",
                "description": "Get one record.",
                "parameters": { "type": "string" }
            }
        })])
        .is_err());
    }

    #[test]
    fn native_chunk_callback_accumulates_thoughts_separately_from_answer_text() {
        let chunk = CString::new(r#"{"channels":{"thought":"reasoning"}}"#).unwrap();
        let mut context = NativeStreamingContext {
            sender: None,
            chunks: Vec::new(),
            thoughts: Vec::new(),
            tool_calls: Vec::new(),
        };

        unsafe {
            native_chunk_callback(
                chunk.as_ptr(),
                &mut context as *mut NativeStreamingContext as *mut c_void,
            );
        }

        assert_eq!(context.thoughts, vec!["reasoning"]);
        assert!(context.chunks.is_empty());
    }

    #[test]
    fn native_chunk_callback_never_accumulates_streamed_tool_channel_as_answer_text() {
        let chunk =
            CString::new(r#"{"channels":{"tool_call":"{\"name\":\"inspect_current_screen\""}}"#)
                .unwrap();
        let mut context = NativeStreamingContext {
            sender: None,
            chunks: Vec::new(),
            thoughts: Vec::new(),
            tool_calls: Vec::new(),
        };

        unsafe {
            native_chunk_callback(
                chunk.as_ptr(),
                &mut context as *mut NativeStreamingContext as *mut c_void,
            );
        }

        assert!(context.chunks.is_empty());
        assert!(context.thoughts.is_empty());
        assert!(context.tool_calls.is_empty());
    }

    #[test]
    fn native_structured_tool_call_chunk_is_preserved_without_answer_text() {
        let chunk: Value = serde_json::from_str(
            r#"{"role":"assistant","tool_calls":[{"type":"function","function":{"name":"inspect_current_screen","arguments":{"includeScreenshot":false}}}]}"#,
        )
        .unwrap();

        let calls = extract_structured_tool_calls(&chunk, 0);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["type"], "function");
        assert_eq!(calls[0]["function"]["name"], "inspect_current_screen");
        let args: Value =
            serde_json::from_str(calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args, json!({ "includeScreenshot": false }));
        assert!(extract_message_text(&chunk).is_none());
    }

    #[test]
    fn native_structured_tool_calls_get_unique_fallback_ids_across_chunks() {
        let first = json!({
            "tool_calls": [{
                "type": "function",
                "function": { "name": "calculator_evaluate_decimal", "arguments": {} }
            }]
        });
        let second = json!({
            "tool_calls": [{
                "type": "function",
                "function": { "name": "units_convert", "arguments": {} }
            }]
        });

        assert_eq!(extract_structured_tool_calls(&first, 0)[0]["id"], "call_0");
        assert_eq!(extract_structured_tool_calls(&second, 1)[0]["id"], "call_1");
    }

    #[test]
    fn verify_cache_matches_file_fingerprint() {
        let cache = VerificationFingerprint {
            algorithm_version: 1,
            path: PathBuf::from("model.litertlm"),
            len: 10,
            modified_unix_ns: 20,
            sha256: "abc".to_string(),
            format_sig: "test-format".to_string(),
        };
        assert_eq!(cache.len, 10);
        assert_eq!(cache.modified_unix_ns, 20);
        assert_eq!(cache.sha256, "abc");
    }

    fn model_download_descriptor(bytes: &[u8]) -> LocalAiRuntimeDescriptor {
        let mut descriptor = descriptor_from_manifest();
        descriptor.expected_size_bytes = bytes.len() as u64;
        descriptor.expected_sha256 = format!("{:x}", Sha256::digest(bytes));
        descriptor.model_revision = "synthetic-test-revision".to_string();
        descriptor.archived_mirror = None;
        descriptor
    }

    // Real HTTP transport on loopback, with tiny synthetic model bytes only.
    fn model_download_server(
        responses: Vec<(String, Vec<u8>, u64)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (headers, body, stall_ms) in responses {
                let (mut connection, _) = listener.accept().unwrap();
                connection
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0u8; 1];
                    connection.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                requests.push(String::from_utf8(request).unwrap());
                connection.write_all(headers.as_bytes()).unwrap();
                connection.write_all(&body).unwrap();
                connection.flush().unwrap();
                if stall_ms > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(stall_ms));
                }
            }
            requests
        });
        (format!("http://{address}"), handle)
    }

    fn model_download_client() -> Client {
        Client::builder().no_proxy().build().unwrap()
    }

    fn model_download_response(status: &str, length: usize, extra: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n{extra}\r\n")
    }

    #[test]
    fn model_download_hash_rejects_same_size_corruption_and_cancel() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model");
        let bytes = b"LITERTLMcorrect";
        let descriptor = model_download_descriptor(bytes);
        fs::write(&path, bytes).unwrap();
        let verified = verify_file_integrity(
            &path,
            descriptor.expected_size_bytes,
            &descriptor.expected_sha256,
        )
        .unwrap();
        assert_eq!(verified.sha256, descriptor.expected_sha256);
        let mut corrupted = bytes.to_vec();
        corrupted[10] ^= 1;
        fs::write(&path, corrupted).unwrap();
        assert!(verify_file_integrity(
            &path,
            descriptor.expected_size_bytes,
            &descriptor.expected_sha256
        )
        .unwrap_err()
        .contains("SHA-256"));
        let cancel = AtomicBool::new(true);
        assert_eq!(
            hash_file_range_with_cancel(&path, 0, bytes.len() as u64, Some(&cancel)).unwrap_err(),
            LOCAL_AI_DOWNLOAD_CANCELLED
        );
    }

    #[tokio::test]
    async fn model_download_discards_legacy_fake_verification_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model");
        let bytes = b"LITERTLMcorrect";
        let descriptor = model_download_descriptor(bytes);
        let mut corrupted = bytes.to_vec();
        corrupted[10] ^= 1;
        fs::write(&path, corrupted).unwrap();
        let manager = LocalAiRuntimeManager::default();
        manager.inner.lock().await.verification_cache = Some(VerificationFingerprint {
            algorithm_version: 0,
            path: path.clone(),
            len: descriptor.expected_size_bytes,
            modified_unix_ns: file_modified_unix_ns(&path).unwrap(),
            sha256: descriptor.expected_sha256.clone(),
            format_sig: "litertlm".to_string(),
        });
        assert!(verify_model_file(&manager, &path, &descriptor)
            .await
            .unwrap_err()
            .contains("SHA-256"));
    }

    #[test]
    fn model_download_disk_preflight_counts_only_remaining_bytes_and_reserve() {
        assert!(require_download_space(100 + MODEL_DOWNLOAD_DISK_RESERVE, 150, 50).is_ok());
        assert!(require_download_space(99 + MODEL_DOWNLOAD_DISK_RESERVE, 150, 50).is_err());
        assert!(require_download_space(MODEL_DOWNLOAD_DISK_RESERVE, 150, 150).is_ok());
    }

    #[test]
    fn model_download_only_verified_unchanged_partial_replaces_final_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"LITERTLMtest";
        let descriptor = model_download_descriptor(bytes);
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        fs::write(&paths.final_model_path, b"preserve-existing").unwrap();
        fs::write(&paths.partial_model_path, bytes).unwrap();
        let fingerprint = verify_file_integrity(
            &paths.partial_model_path,
            descriptor.expected_size_bytes,
            &descriptor.expected_sha256,
        )
        .unwrap();
        let mut corrupted = bytes.to_vec();
        corrupted[10] ^= 1;
        fs::write(&paths.partial_model_path, corrupted).unwrap();
        assert!(install_verified_partial(&paths, &descriptor, fingerprint).is_err());
        assert_eq!(
            fs::read(&paths.final_model_path).unwrap(),
            b"preserve-existing"
        );
        fs::write(&paths.partial_model_path, bytes).unwrap();
        let fingerprint = verify_file_integrity(
            &paths.partial_model_path,
            descriptor.expected_size_bytes,
            &descriptor.expected_sha256,
        )
        .unwrap();
        let installed = install_verified_partial(&paths, &descriptor, fingerprint).unwrap();
        assert_eq!(installed.path, paths.final_model_path);
        assert_eq!(fs::read(&paths.final_model_path).unwrap(), bytes);
        assert!(!paths.partial_model_path.exists());
    }

    #[test]
    fn model_download_mirror_rejects_wrong_identity_sizes_hashes_and_part_count() {
        let descriptor = model_download_descriptor(b"LITERTLMtest");
        let mirror = ArchivedModelMirror {
            model_revision: descriptor.model_revision.clone(),
            model_sha256: descriptor.expected_sha256.clone(),
            model_expected_size_bytes: 12,
            parts: vec![
                ArchivedModelPart {
                    url: "https://example.invalid/part-1".to_string(),
                    size_bytes: 8,
                    sha256: "0".repeat(64),
                },
                ArchivedModelPart {
                    url: "https://example.invalid/part-2".to_string(),
                    size_bytes: 4,
                    sha256: "1".repeat(64),
                },
            ],
        };
        assert!(validate_archived_mirror(&mirror, &descriptor).is_ok());
        let mut invalid = mirror.clone();
        invalid.model_revision = "another-model".to_string();
        assert!(validate_archived_mirror(&invalid, &descriptor).is_err());
        let mut invalid = mirror.clone();
        invalid.parts[0].size_bytes = 2_147_483_648;
        assert!(validate_archived_mirror(&invalid, &descriptor).is_err());
        let mut invalid = mirror.clone();
        invalid.parts[0].sha256 = "not-a-hash".to_string();
        assert!(validate_archived_mirror(&invalid, &descriptor).is_err());
        let mut invalid = mirror.clone();
        invalid.parts.pop();
        assert!(validate_archived_mirror(&invalid, &descriptor).is_err());
        let mut invalid = mirror;
        invalid.parts[1].size_bytes = 3;
        assert!(validate_archived_mirror(&invalid, &descriptor).is_err());
    }

    #[tokio::test]
    async fn model_download_atomic_claim_and_cross_process_file_lock() {
        use fs2::FileExt;
        let manager = LocalAiRuntimeManager::default();
        let (first, second) = tokio::join!(claim_download(&manager), claim_download(&manager));
        assert_ne!(first, second);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lock");
        let first = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .unwrap();
        let second = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        first.try_lock_exclusive().unwrap();
        assert!(second.try_lock_exclusive().is_err());
        FileExt::unlock(&first).unwrap();
        second.try_lock_exclusive().unwrap();
    }

    #[test]
    fn model_download_resume_identity_does_not_reuse_other_revision() {
        let dir = tempfile::tempdir().unwrap();
        let descriptor = model_download_descriptor(b"LITERTLMtest");
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        let mut identity = prepare_partial(&paths, &descriptor).unwrap();
        fs::write(&paths.partial_model_path, b"LITER").unwrap();
        identity.model_revision = "obsolete".to_string();
        save_partial_identity(&paths.partial_identity_path, &identity).unwrap();
        let current = prepare_partial(&paths, &descriptor).unwrap();
        assert_eq!(current.model_revision, descriptor.model_revision);
        assert_eq!(fs::metadata(&paths.partial_model_path).unwrap().len(), 0);
        assert!(!paths.final_model_path.exists());
    }

    #[tokio::test]
    async fn model_download_resume_206_and_200_restart_without_duplicate_bytes() {
        let bytes = b"LITERTLMtest";
        for partial_response in [true, false] {
            let dir = tempfile::tempdir().unwrap();
            let descriptor = model_download_descriptor(bytes);
            let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
            fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
            let mut identity = prepare_partial(&paths, &descriptor).unwrap();
            fs::write(&paths.partial_model_path, &bytes[..5]).unwrap();
            let extra = if partial_response {
                "Content-Range: bytes 5-11/12\r\nETag: \"synthetic\"\r\n"
            } else {
                "ETag: \"synthetic\"\r\n"
            };
            let body = if partial_response {
                bytes[5..].to_vec()
            } else {
                bytes.to_vec()
            };
            let (url, server) = model_download_server(vec![(
                model_download_response(
                    if partial_response {
                        "206 Partial Content"
                    } else {
                        "200 OK"
                    },
                    body.len(),
                    extra,
                ),
                body,
                0,
            )]);
            identity.source = url.clone();
            identity.etag = Some("\"synthetic\"".to_string());
            let manager = LocalAiRuntimeManager::default();
            download_segment::<tauri::test::MockRuntime>(
                None,
                &model_download_client(),
                &manager,
                &paths,
                &mut identity,
                &url,
                0,
                12,
                12,
                false,
            )
            .await
            .unwrap();
            assert_eq!(fs::read(&paths.partial_model_path).unwrap(), bytes);
            assert!(!paths.final_model_path.exists());
            let requests = server.join().unwrap();
            assert!(requests[0].to_ascii_lowercase().contains("range: bytes=5-"));
            assert!(requests[0]
                .to_ascii_lowercase()
                .contains("if-range: \"synthetic\""));
        }
    }

    #[tokio::test]
    async fn model_download_invalid_range_leaves_existing_prefix_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let descriptor = model_download_descriptor(b"LITERTLMtest");
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        let mut identity = prepare_partial(&paths, &descriptor).unwrap();
        fs::write(&paths.partial_model_path, b"LITER").unwrap();
        let (url, server) = model_download_server(vec![(
            model_download_response("206 Partial Content", 7, "Content-Range: bytes 6-12/13\r\n"),
            b"TLMtest".to_vec(),
            0,
        )]);
        let manager = LocalAiRuntimeManager::default();
        assert!(download_segment::<tauri::test::MockRuntime>(
            None,
            &model_download_client(),
            &manager,
            &paths,
            &mut identity,
            &url,
            0,
            12,
            12,
            false
        )
        .await
        .unwrap_err()
        .contains("offset"));
        assert_eq!(fs::read(&paths.partial_model_path).unwrap(), b"LITER");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn model_download_cancel_interrupts_stalled_body_and_preserves_partial() {
        let dir = tempfile::tempdir().unwrap();
        let descriptor = model_download_descriptor(b"LITERTLMtest");
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        let mut identity = prepare_partial(&paths, &descriptor).unwrap();
        let (url, server) = model_download_server(vec![(
            model_download_response("200 OK", 12, ""),
            b"LITERTLM".to_vec(),
            1000,
        )]);
        let manager = LocalAiRuntimeManager::default();
        let client = model_download_client();
        let started = Instant::now();
        let (result, ()) = tokio::join!(
            download_segment::<tauri::test::MockRuntime>(
                None,
                &client,
                &manager,
                &paths,
                &mut identity,
                &url,
                0,
                12,
                12,
                false
            ),
            async {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let mut state = manager.inner.lock().await;
                state.download_cancel_requested = true;
                state.download_abort.store(true, Ordering::SeqCst);
            }
        );
        assert_eq!(result.unwrap_err(), LOCAL_AI_DOWNLOAD_CANCELLED);
        assert!(started.elapsed() < std::time::Duration::from_millis(900));
        assert_eq!(fs::read(&paths.partial_model_path).unwrap(), b"LITERTLM");
        assert!(!paths.final_model_path.exists());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn model_download_fallback_streams_verified_parts_into_one_partial() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"LITERTLMtest";
        let mut descriptor = model_download_descriptor(bytes);
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        let mut identity = prepare_partial(&paths, &descriptor).unwrap();
        let (url, server) = model_download_server(vec![
            (
                model_download_response("503 Service Unavailable", 0, ""),
                Vec::new(),
                0,
            ),
            (
                model_download_response("200 OK", 8, ""),
                bytes[..8].to_vec(),
                0,
            ),
            (
                model_download_response("200 OK", 4, ""),
                bytes[8..].to_vec(),
                0,
            ),
        ]);
        descriptor.archived_mirror = Some(ArchivedModelMirror {
            model_revision: descriptor.model_revision.clone(),
            model_sha256: descriptor.expected_sha256.clone(),
            model_expected_size_bytes: 12,
            parts: vec![
                ArchivedModelPart {
                    url: format!("{url}/part-1"),
                    size_bytes: 8,
                    sha256: format!("{:x}", Sha256::digest(&bytes[..8])),
                },
                ArchivedModelPart {
                    url: format!("{url}/part-2"),
                    size_bytes: 4,
                    sha256: format!("{:x}", Sha256::digest(&bytes[8..])),
                },
            ],
        });
        let manager = LocalAiRuntimeManager::default();
        let fingerprint = download_from_sources::<tauri::test::MockRuntime>(
            None,
            &model_download_client(),
            &manager,
            &paths,
            &mut identity,
            &descriptor,
            &format!("{url}/original"),
        )
        .await
        .unwrap();
        assert_eq!(fingerprint.sha256, descriptor.expected_sha256);
        assert_eq!(fs::read(&paths.partial_model_path).unwrap(), bytes);
        assert!(!paths.final_model_path.exists());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[1].starts_with("GET /part-1 "));
        assert!(requests[2].starts_with("GET /part-2 "));
    }

    #[tokio::test]
    async fn model_download_missing_mirror_reports_actionable_error_without_retry_loop() {
        let dir = tempfile::tempdir().unwrap();
        let descriptor = model_download_descriptor(b"LITERTLMtest");
        let paths = NativeModelPaths::from_root(dir.path(), &descriptor);
        fs::create_dir_all(paths.partial_model_path.parent().unwrap()).unwrap();
        let mut identity = prepare_partial(&paths, &descriptor).unwrap();
        let (url, server) = model_download_server(vec![(
            model_download_response("503 Service Unavailable", 0, ""),
            Vec::new(),
            0,
        )]);
        let manager = LocalAiRuntimeManager::default();
        let error = download_from_sources::<tauri::test::MockRuntime>(
            None,
            &model_download_client(),
            &manager,
            &paths,
            &mut identity,
            &descriptor,
            &url,
        )
        .await
        .unwrap_err();
        assert!(error.contains("No archived mirror is configured"));
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn estimate_expression_keeps_local_math_working() {
        assert_eq!(
            evaluate_estimate_expression("(10 + 20) * 3 / 2".to_string())
                .await
                .unwrap(),
            "45"
        );
        assert!(evaluate_estimate_expression("10 / 0".to_string())
            .await
            .is_err());
        assert!(evaluate_estimate_expression("10 + x".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_unload_engine_resets_state() {
        let manager = LocalAiRuntimeManager::default();

        // Simulate engine loaded and active stream running
        {
            let mut bridge_engine = manager.native_bridge.state.engine.lock().unwrap();
            *bridge_engine = Some(NativeEngineHandle(ptr::null_mut()));
        }
        let abort_flag = Arc::new(AtomicBool::new(false));
        let queued_abort = Arc::new(AtomicBool::new(false));
        {
            let mut guard = manager.inner.lock().await;
            guard.install_state = LocalAiInstallState::Ready;
            guard
                .pending_completions
                .insert("queued-unload-test".to_string(), queued_abort.clone());
            guard.active_completion = Some(ActiveCompletion {
                request_id: "unload-test".to_string(),
                workload_class: LocalAiWorkloadClass::UserBatch,
                abort: abort_flag.clone(),
            });
        }

        // Verify pre-conditions
        assert!(manager.native_bridge.is_engine_loaded());
        assert_eq!(
            manager.inner.lock().await.install_state,
            LocalAiInstallState::Ready
        );
        assert!(!abort_flag.load(Ordering::SeqCst));

        // Call unload
        manager.unload().await.unwrap();

        // Verify post-conditions
        assert!(!manager.native_bridge.is_engine_loaded());
        let guard = manager.inner.lock().await;
        assert_eq!(guard.install_state, LocalAiInstallState::Installed);
        assert!(guard.active_completion.is_none());
        assert!(abort_flag.load(Ordering::SeqCst));
        assert!(queued_abort.load(Ordering::SeqCst));
    }

    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[tokio::test]
    async fn incomplete_model_is_preserved_and_requires_repair_before_loading() {
        let _lock = TEST_LOCK.lock().unwrap();
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();
        let temp_dir = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp_dir.path());
        let paths = native_model_paths(app.handle()).unwrap();
        fs::create_dir_all(paths.final_model_path.parent().unwrap()).unwrap();
        fs::write(&paths.final_model_path, b"LITERTLMbad").unwrap();
        let status = ensure_local_ai_runtime_ready_for_use(app.handle(), &manager, None)
            .await
            .unwrap();
        assert_eq!(status.install_state, LocalAiInstallState::RepairNeeded);
        assert!(!status.model_ready);
        assert!(status.last_error.is_some());
        assert!(paths.final_model_path.exists());
        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }

    #[tokio::test]
    async fn test_download_already_in_progress_does_not_deadlock() {
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();

        // Mark download as in progress
        {
            let mut state = manager.inner.lock().await;
            state.download_in_progress = true;
            state.install_state = LocalAiInstallState::Downloading;
        }

        // Call download_local_ai_model_inner (wrapped in a timeout to verify it doesn't deadlock/hang)
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            download_local_ai_model_inner(app.handle().clone(), &manager),
        )
        .await;

        assert!(result.is_ok(), "download_local_ai_model deadlocked!");
        let status = result.unwrap().unwrap();
        assert_eq!(status.install_state, LocalAiInstallState::Downloading);
    }

    #[tokio::test]
    async fn test_incomplete_model_file_not_treated_as_installed() {
        let _lock = TEST_LOCK.lock().unwrap();
        let app = tauri::test::mock_app();
        let manager = LocalAiRuntimeManager::default();

        let temp_dir = tempfile::tempdir().unwrap();
        std::env::set_var("KWANTFLOW_LOCAL_AI_DIR", temp_dir.path());

        let paths = native_model_paths(app.handle()).unwrap();
        std::fs::create_dir_all(paths.final_model_path.parent().unwrap()).unwrap();

        // Create an incomplete/partial file (e.g. 100 bytes instead of descriptor.expected_size_bytes)
        let file = std::fs::File::create(&paths.final_model_path).unwrap();
        file.set_len(100).unwrap();

        // Get status
        let status = build_local_ai_status(app.handle(), &manager).await.unwrap();

        // It should be NotDownloaded, because size does not match descriptor
        assert_eq!(status.install_state, LocalAiInstallState::NotDownloaded);
        assert!(!status.runtime_available);

        std::env::remove_var("KWANTFLOW_LOCAL_AI_DIR");
    }
}
