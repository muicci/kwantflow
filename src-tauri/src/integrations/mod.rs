//! Integrations — native email connection metadata, OAuth, and RFQ classification state.
//!
//! Provider tokens are stored in native device credential storage. SQLite stores connection metadata,
//! sync preferences, cursors, and durable AI classifications only.

use crate::db::pool::transactional_sqlite_pool;
use crate::secure_store;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

const OAUTH_SESSION_TTL_SECS: i64 = 600;
const KEYCHAIN_SERVICE: &str = "com.kwantflow.desktop.email";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmailProviderSettings {
    pub google_client_id: String,
    pub microsoft_client_id: String,
    pub microsoft_tenant: String,
}

impl Default for EmailProviderSettings {
    fn default() -> Self {
        Self {
            google_client_id: String::new(),
            microsoft_client_id: String::new(),
            microsoft_tenant: "common".to_string(),
        }
    }
}

static PROVIDER_SETTINGS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TOKEN_OPERATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone)]
struct EmailProviderConfig {
    provider: &'static str,
    client_id: String,
    tenant: String,
    auth_url: String,
    token_url: String,
    userinfo_url: &'static str,
    scopes: &'static str,
}

// Store only a finite error classification. Provider descriptions can contain
// account details, callback URLs, or other sensitive values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OAuthProviderError {
    AccessDenied,
    InvalidRegistration,
    AccountTypeMismatch,
    ConsentRequired,
    InteractionRequired,
    InvalidGrant,
    RefreshTokenMissing,
    ProviderUnavailable,
    InvalidResponse,
    Other,
}

impl OAuthProviderError {
    fn message(self) -> &'static str {
        match self {
            Self::AccessDenied => "Mailbox authorization was denied. Reconnect and approve the requested permissions when ready. Your organization may require administrator approval. (access_denied)",
            Self::InvalidRegistration => "The provider rejected this application registration. Check the client ID, desktop client type, and requested permissions using Settings > Connections > Email setup guide. (invalid_registration)",
            Self::AccountTypeMismatch => "This Microsoft account does not match the registration's supported account types or tenant. Check Microsoft tenant in Settings, or use an account allowed by your registration. (account_type_mismatch)",
            Self::ConsentRequired => "Mailbox permission approval is required. Reconnect and approve the requested permissions; contact your organization's administrator if approval is restricted. (consent_required)",
            Self::InteractionRequired => "The provider requires a fresh sign-in or security check. Reconnect this mailbox and complete the provider's sign-in steps. Contact your administrator if access is blocked. (interaction_required)",
            Self::InvalidGrant => "Mailbox authorization has expired or is no longer valid. Reconnect this mailbox in Settings. (invalid_grant)",
            Self::RefreshTokenMissing => "No refresh access is available. Reconnect this mailbox and grant the requested permissions. (refresh_token_missing)",
            Self::ProviderUnavailable => "The mailbox provider could not complete authorization. Check your internet connection and try again later. (provider_unavailable)",
            Self::InvalidResponse => "The mailbox provider returned an incomplete authorization response. Try again later, or reconnect this mailbox. (invalid_response)",
            Self::Other => "The mailbox provider could not authorize this connection. Check your provider registration and account access, then reconnect. (authorization_error)",
        }
    }

    fn requires_reconnect(self) -> bool {
        !matches!(
            self,
            Self::ProviderUnavailable | Self::InvalidResponse | Self::Other
        )
    }
}

fn oauth_provider_error(
    provider: &str,
    error: Option<&str>,
    description: Option<&str>,
) -> OAuthProviderError {
    // Read only a bounded AADSTS prefix, never retain or display its description.
    if provider == "microsoft_outlook" {
        let aadsts = description
            .and_then(|value| value.strip_prefix("AADSTS"))
            .and_then(|value| value.get(..value.len().min(9)))
            .and_then(|value| value.split_once(':'))
            .map(|(code, _)| code);
        match aadsts {
            Some("50020" | "500207" | "500208" | "50194") => {
                return OAuthProviderError::AccountTypeMismatch;
            }
            Some("50011" | "700016" | "7000218") => {
                return OAuthProviderError::InvalidRegistration;
            }
            Some("65001" | "90094" | "90095") => {
                return OAuthProviderError::ConsentRequired;
            }
            Some("65004") => return OAuthProviderError::AccessDenied,
            _ => {}
        }
    }
    match error {
        Some("access_denied") => OAuthProviderError::AccessDenied,
        Some(
            "invalid_client"
            | "unauthorized_client"
            | "invalid_request"
            | "invalid_scope"
            | "redirect_uri_mismatch",
        ) => OAuthProviderError::InvalidRegistration,
        Some("consent_required" | "admin_policy_enforced") => OAuthProviderError::ConsentRequired,
        Some("interaction_required" | "login_required" | "account_selection_required") => {
            OAuthProviderError::InteractionRequired
        }
        Some("invalid_grant") => OAuthProviderError::InvalidGrant,
        Some("temporarily_unavailable" | "server_error") => OAuthProviderError::ProviderUnavailable,
        _ => OAuthProviderError::Other,
    }
}

#[derive(Clone)]
struct OAuthSession {
    provider: String,
    config: EmailProviderConfig,
    workspace_id: String,
    code_verifier: String,
    redirect_uri: String,
    created_at: i64,
    callback_code: Option<String>,
    callback_error: Option<OAuthProviderError>,
    completing: bool,
    cancel_sender: tokio::sync::watch::Sender<bool>,
}

struct OAuthCompletionGuard(String);

impl Drop for OAuthCompletionGuard {
    fn drop(&mut self) {
        if let Ok(mut sessions) = oauth_sessions().lock() {
            sessions.remove(&self.0);
        }
    }
}

fn ensure_oauth_not_cancelled(session: &OAuthSession) -> Result<(), String> {
    if *session.cancel_sender.borrow() {
        return Err("Mailbox authorization was cancelled. Start the connection again.".to_string());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct TokenBundle {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64,
    scope: String,
    email: Option<String>,
    provider: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    tenant: String,
}

static OAUTH_SESSIONS: OnceLock<Mutex<HashMap<String, OAuthSession>>> = OnceLock::new();

fn oauth_sessions() -> &'static Mutex<HashMap<String, OAuthSession>> {
    OAUTH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOAuthResult {
    pub auth_url: String,
    pub state: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationInfo {
    pub id: String,
    pub workspace_id: String,
    pub provider: String,
    pub label: String,
    pub external_id: Option<String>,
    pub external_name: Option<String>,
    pub status: String,
    pub token_expires_at: Option<i64>,
    pub last_error: Option<String>,
    pub rfq_detection_enabled: bool,
    pub polling_interval: String,
    pub last_synced_at: Option<String>,
}

fn integration_info_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<IntegrationInfo, String> {
    Ok(IntegrationInfo {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        workspace_id: row.try_get("workspace_id").map_err(|e| e.to_string())?,
        provider: row.try_get("provider").map_err(|e| e.to_string())?,
        label: row.try_get("label").map_err(|e| e.to_string())?,
        external_id: row.try_get("external_id").map_err(|e| e.to_string())?,
        external_name: row.try_get("external_name").map_err(|e| e.to_string())?,
        status: row.try_get("status").map_err(|e| e.to_string())?,
        token_expires_at: row.try_get("token_expires_at").map_err(|e| e.to_string())?,
        last_error: row.try_get("last_error").map_err(|e| e.to_string())?,
        rfq_detection_enabled: row
            .try_get::<i64, _>("rfq_detection_enabled")
            .map_err(|e| e.to_string())?
            != 0,
        polling_interval: row.try_get("polling_interval").map_err(|e| e.to_string())?,
        last_synced_at: row.try_get("last_synced_at").map_err(|e| e.to_string())?,
    })
}

async fn read_email_connection(
    pool: &sqlx::SqlitePool,
    connection_id: &str,
) -> Result<IntegrationInfo, String> {
    let row = sqlx::query(
        "SELECT id, workspace_id, provider, label, external_id, external_name, status, \
         token_expires_at, last_error, rfq_detection_enabled, polling_interval, last_synced_at \
         FROM workspace_integrations WHERE id = ?",
    )
    .bind(connection_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read saved email connection: {error}"))?
    .ok_or_else(|| "Email connection was not found in the active workspace".to_string())?;
    integration_info_from_row(&row)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailRfqClassification {
    pub integration_id: String,
    pub provider_message_id: String,
    pub classifier_version: String,
    pub verdict: String,
    pub model_id: String,
    pub classified_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteOAuthResult {
    pub integration: IntegrationInfo,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageSummary {
    pub id: String,
    pub thread_id: String,
    pub from: String,
    pub subject: String,
    pub date: String,
    pub snippet: String,
    pub is_unread: bool,
    pub has_attachments: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailListResult {
    pub messages: Vec<GmailMessageSummary>,
    pub next_page_token: Option<String>,
    pub result_size_estimate: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageDetail {
    pub id: String,
    pub thread_id: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub subject: String,
    pub date: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub snippet: String,
    pub labels: Vec<String>,
    pub has_attachments: bool,
    pub attachment_names: Vec<String>,
    pub attachment_ids: Vec<String>,
    pub attachment_mime_types: Vec<String>,
}

pub(crate) fn validate_provider_settings(
    mut settings: EmailProviderSettings,
) -> Result<EmailProviderSettings, String> {
    settings.google_client_id = settings.google_client_id.trim().to_string();
    settings.microsoft_client_id = settings.microsoft_client_id.trim().to_lowercase();
    settings.microsoft_tenant = settings.microsoft_tenant.trim().to_lowercase();
    if !settings.google_client_id.is_empty() {
        let suffix = ".apps.googleusercontent.com";
        let prefix = settings.google_client_id.strip_suffix(suffix)
            .ok_or("Google setup requires a Desktop OAuth client ID ending in .apps.googleusercontent.com.")?;
        if prefix.is_empty()
            || prefix.len() > 256
            || !prefix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Google Desktop OAuth client ID is invalid.".to_string());
        }
    }
    if !settings.microsoft_client_id.is_empty() {
        settings.microsoft_client_id = Uuid::parse_str(&settings.microsoft_client_id)
            .map_err(|_| "Microsoft setup requires an application client ID in UUID format.")?
            .to_string();
    }
    if !matches!(
        settings.microsoft_tenant.as_str(),
        "common" | "organizations" | "consumers"
    ) {
        settings.microsoft_tenant = Uuid::parse_str(&settings.microsoft_tenant)
            .map_err(|_| {
                "Microsoft tenant must be common, organizations, consumers, or a tenant UUID."
            })?
            .to_string();
    }
    Ok(settings)
}

fn provider_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("email-provider-settings.json"))
}

pub(crate) fn read_provider_settings(app: &AppHandle) -> Result<EmailProviderSettings, String> {
    let _guard = PROVIDER_SETTINGS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Email provider settings lock is unavailable.")?;
    let bytes = match std::fs::read(provider_settings_path(app)?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(EmailProviderSettings::default())
        }
        Err(error) => return Err(format!("Read email provider settings: {error}")),
    };
    let settings = serde_json::from_slice(&bytes)
        .map_err(|_| "Email provider settings are invalid. Reconfigure them in Settings.")?;
    validate_provider_settings(settings)
}

#[tauri::command]
pub fn get_email_provider_settings(app: AppHandle) -> Result<EmailProviderSettings, String> {
    secure_store::discard_legacy_credentials(&app)?;
    read_provider_settings(&app)
}

#[tauri::command]
pub fn set_email_provider_settings(
    app: AppHandle,
    settings: EmailProviderSettings,
) -> Result<EmailProviderSettings, String> {
    let settings = validate_provider_settings(settings)?;
    let _file_guard = crate::backup::backup_file_mutation_guard()?;
    let path = provider_settings_path(&app)?;
    let directory = path
        .parent()
        .ok_or("Email provider settings directory is unavailable.")?;
    let _guard = PROVIDER_SETTINGS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Email provider settings lock is unavailable.")?;
    std::fs::create_dir_all(directory)
        .map_err(|e| format!("Create email provider settings directory: {e}"))?;
    let bytes = serde_json::to_vec(&settings)
        .map_err(|e| format!("Encode email provider settings: {e}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|e| format!("Create email provider settings file: {e}"))?;
    temporary
        .write_all(&bytes)
        .map_err(|e| format!("Write email provider settings: {e}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("Sync email provider settings: {e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("Replace email provider settings: {}", e.error))?;
    // Consent in progress belongs to the registration that started it. Cancel
    // it rather than accepting a callback after configuration was changed.
    let mut sessions = oauth_sessions()
        .lock()
        .map_err(|_| "Email authorization lock is unavailable.")?;
    sessions.retain(|_, session| {
        let unchanged = provider_config_from_settings(&session.provider, &settings)
            .map(|config| {
                config.client_id == session.config.client_id
                    && config.tenant == session.config.tenant
            })
            .unwrap_or(false);
        if !unchanged {
            session.cancel_sender.send_replace(true);
        }
        unchanged
    });
    Ok(settings)
}

fn provider_config_from_settings(
    provider: &str,
    settings: &EmailProviderSettings,
) -> Result<EmailProviderConfig, String> {
    let config = match provider {
        "google_gmail" => EmailProviderConfig {
            provider: "google_gmail",
            client_id: settings.google_client_id.clone(),
            tenant: String::new(),
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
            userinfo_url: "https://www.googleapis.com/oauth2/v2/userinfo",
            scopes: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email",
        },
        "microsoft_outlook" => EmailProviderConfig {
            provider: "microsoft_outlook",
            client_id: settings.microsoft_client_id.clone(),
            tenant: settings.microsoft_tenant.clone(),
            auth_url: format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", settings.microsoft_tenant),
            token_url: format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", settings.microsoft_tenant),
            userinfo_url: "https://graph.microsoft.com/v1.0/me",
            scopes: "Mail.ReadWrite Mail.Send offline_access User.Read",
        },
        _ => return Err("Unknown email provider. Supported providers: google_gmail, microsoft_outlook".to_string()),
    };
    if config.client_id.is_empty() {
        let label = if provider == "google_gmail" {
            "Google Desktop"
        } else {
            "Microsoft native"
        };
        return Err(format!(
            "Configure your own {label} OAuth client ID in Settings before connecting a mailbox."
        ));
    }
    Ok(config)
}

fn provider_config(app: &AppHandle, provider: &str) -> Result<EmailProviderConfig, String> {
    provider_config_from_settings(provider, &read_provider_settings(app)?)
}

fn token_matches_registration(bundle: &TokenBundle, config: &EmailProviderConfig) -> bool {
    bundle.provider == config.provider
        && bundle.client_id == config.client_id
        && bundle.tenant == config.tenant
}

fn validate_granted_scopes(config: &EmailProviderConfig, scope: &str) -> Result<(), String> {
    let granted: Vec<&str> = scope.split_whitespace().collect();
    let required: &[&str] = if config.provider == "google_gmail" {
        &[
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/userinfo.email",
        ]
    } else {
        &["Mail.ReadWrite", "Mail.Send", "User.Read"]
    };
    if required.iter().any(|required| {
        !granted.iter().any(|scope| {
            let scope = if config.provider == "microsoft_outlook" {
                scope
                    .strip_prefix("https://graph.microsoft.com/")
                    .unwrap_or(scope)
            } else {
                scope
            };
            scope.eq_ignore_ascii_case(required)
        })
    }) {
        return Err("Mailbox permissions were incomplete. Reconnect and grant the requested mail and profile permissions.".to_string());
    }
    Ok(())
}

fn urlencode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}

fn generate_code_verifier() -> String {
    let mut bytes = Vec::with_capacity(80);
    for _ in 0..5 {
        bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    }
    URL_SAFE_NO_PAD.encode(bytes)
}

fn compute_code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn build_auth_url(
    config: &EmailProviderConfig,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    let mut url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        config.auth_url,
        urlencode(&config.client_id),
        urlencode(redirect_uri),
        urlencode(config.scopes),
        urlencode(state),
        urlencode(challenge),
    );
    if config.provider == "google_gmail" {
        url.push_str("&access_type=offline&prompt=consent");
    } else {
        url.push_str("&response_mode=query");
    }
    url
}

fn extract_query_param<'a>(query: &'a str, param: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next()? == param {
            return parts.next().map(|value| {
                percent_encoding::percent_decode_str(value)
                    .decode_utf8_lossy()
                    .to_string()
            });
        }
    }
    None
}

fn keychain_account(integration_id: &str) -> String {
    format!("email-token:{integration_id}")
}

fn save_token_bundle(
    app: &tauri::AppHandle,
    integration_id: &str,
    bundle: &TokenBundle,
) -> Result<(), String> {
    let data =
        serde_json::to_vec(bundle).map_err(|error| format!("Serialize token bundle: {error}"))?;
    secure_store::set_generic_password(
        app,
        KEYCHAIN_SERVICE,
        &keychain_account(integration_id),
        &data,
    )
    .map_err(|error| format!("Store email token in secure storage: {error}"))
}

fn load_token_bundle(app: &tauri::AppHandle, integration_id: &str) -> Result<TokenBundle, String> {
    let data = secure_store::get_generic_password(
        app,
        KEYCHAIN_SERVICE,
        &keychain_account(integration_id),
    )?
    .ok_or_else(|| {
        "Email token was not found in secure storage. Reconnect the mailbox.".to_string()
    })?;
    serde_json::from_slice(&data)
        .map_err(|error| format!("Read email token from secure storage: {error}"))
}

fn delete_token_bundle(app: &tauri::AppHandle, integration_id: &str) -> Result<(), String> {
    secure_store::delete_generic_password(app, KEYCHAIN_SERVICE, &keychain_account(integration_id))
}

pub(crate) fn delete_workspace_token_bundles(
    app: &tauri::AppHandle,
    integration_ids: &[String],
) -> Result<(), String> {
    for integration_id in integration_ids {
        delete_token_bundle(app, integration_id)?;
    }
    Ok(())
}

async fn spawn_callback_listener(
    state: String,
    listener: tokio::net::TcpListener,
    mut cancel_receiver: tokio::sync::watch::Receiver<bool>,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(OAUTH_SESSION_TTL_SECS as u64);
    loop {
        let accepted = tokio::select! {
            result = listener.accept() => Some(result),
            _ = cancel_receiver.changed() => None,
            _ = tokio::time::sleep_until(deadline) => None,
        };
        let Some(Ok((mut stream, _))) = accepted else {
            oauth_sessions().lock().unwrap().remove(&state);
            return;
        };
        let mut buffer = vec![0u8; 8192];
        let read_line = async {
            let mut read_len = 0;
            while read_len < buffer.len() {
                let length = stream.read(&mut buffer[read_len..]).await?;
                if length == 0 {
                    return Ok::<_, std::io::Error>(None);
                }
                read_len += length;
                if buffer[..read_len].contains(&b'\n') {
                    return Ok(Some(read_len));
                }
            }
            Ok(None)
        };
        let read_len = match tokio::time::timeout(Duration::from_secs(2), read_line).await {
            Ok(Ok(Some(length))) => length,
            _ => continue,
        };
        let request = String::from_utf8_lossy(&buffer[..read_len]);
        let request_path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");
        let query = request_path.split_once('?').map(|(_, q)| q).unwrap_or("");
        let valid_state = extract_query_param(query, "state").as_deref() == Some(state.as_str());
        let code = extract_query_param(query, "code");
        let provider_error = extract_query_param(query, "error");
        let denied = provider_error.is_some();
        let completed = valid_state && (code.is_some() || denied);
        let (status, title, message) = if completed {
            if let Some(session) = oauth_sessions().lock().unwrap().get_mut(&state) {
                session.callback_error = provider_error.as_deref().map(|error| {
                    oauth_provider_error(
                        session.config.provider,
                        Some(error),
                        extract_query_param(query, "error_description").as_deref(),
                    )
                });
                // A callback containing an error cannot also redeem a code.
                session.callback_code = if denied { None } else { code };
            }
            if denied {
                (
                    "200 OK",
                    "Authorization failed",
                    "Return to Kwantflow for the connection error and next steps.",
                )
            } else {
                (
                    "200 OK",
                    "Authorization received",
                    "You can close this tab and return to Kwantflow.",
                )
            }
        } else {
            ("400 Bad Request", "Connection rejected", "The authorization callback was invalid. Return to the provider sign-in tab to finish connecting.")
        };
        let body = format!(
            "<html><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;\"><h1>{title}</h1><p>{message}</p></body></html>"
        );
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n{body}", body.len()
        );
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if completed {
            return;
        }
    }
}

async fn exchange_code(
    config: &EmailProviderConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenBundle, String> {
    let params: Vec<(&str, &str)> = vec![
        ("code", code),
        ("client_id", &config.client_id),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
    ];
    let response = reqwest::Client::new()
        .post(&config.token_url)
        .timeout(Duration::from_secs(30))
        .form(&params)
        .send()
        .await
        .map_err(|error| format!("Token exchange request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse token exchange response: {error}"))?;
    if !status.is_success() {
        return Err(oauth_provider_error(
            config.provider,
            body.get("error").and_then(|value| value.as_str()),
            body.get("error_description")
                .and_then(|value| value.as_str()),
        )
        .message()
        .to_string());
    }
    let access_token = body
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Token exchange did not return an access token".to_string())?
        .to_string();
    let refresh_token = body
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let expires_in = body
        .get("expires_in")
        .and_then(|value| value.as_i64())
        .unwrap_or(3600);
    Ok(TokenBundle {
        access_token,
        refresh_token,
        expires_at: Utc::now().timestamp() + expires_in,
        scope: body
            .get("scope")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        email: None,
        provider: config.provider.to_string(),
        client_id: config.client_id.clone(),
        tenant: config.tenant.clone(),
    })
}

async fn refresh_token(
    config: &EmailProviderConfig,
    bundle: &TokenBundle,
) -> Result<TokenBundle, OAuthProviderError> {
    let refresh_token = bundle
        .refresh_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or(OAuthProviderError::RefreshTokenMissing)?;
    let params: Vec<(&str, &str)> = vec![
        ("refresh_token", refresh_token),
        ("client_id", &config.client_id),
        ("grant_type", "refresh_token"),
    ];
    let response = reqwest::Client::new()
        .post(&config.token_url)
        .timeout(Duration::from_secs(30))
        .form(&params)
        .send()
        .await
        .map_err(|_| OAuthProviderError::ProviderUnavailable)?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| OAuthProviderError::InvalidResponse)?;
    if !status.is_success() {
        // A provider outage must not retire an otherwise usable connection,
        // even if its response happens to contain a terminal OAuth error.
        if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(OAuthProviderError::ProviderUnavailable);
        }
        return Err(oauth_provider_error(
            config.provider,
            body.get("error").and_then(|value| value.as_str()),
            body.get("error_description")
                .and_then(|value| value.as_str()),
        ));
    }
    let access_token = body
        .get("access_token")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or(OAuthProviderError::InvalidResponse)?
        .to_string();
    let expires_in = body
        .get("expires_in")
        .and_then(|value| value.as_i64())
        .unwrap_or(3600);
    Ok(TokenBundle {
        access_token,
        refresh_token: body
            .get("refresh_token")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| bundle.refresh_token.clone()),
        expires_at: Utc::now().timestamp() + expires_in,
        scope: body
            .get("scope")
            .and_then(|value| value.as_str())
            .unwrap_or(&bundle.scope)
            .to_string(),
        email: bundle.email.clone(),
        provider: bundle.provider.clone(),
        client_id: bundle.client_id.clone(),
        tenant: bundle.tenant.clone(),
    })
}

async fn fetch_userinfo(
    config: &EmailProviderConfig,
    access_token: &str,
) -> Result<(String, Option<String>), String> {
    let response = reqwest::Client::new()
        .get(config.userinfo_url)
        .timeout(Duration::from_secs(30))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Prefer", r#"IdType="ImmutableId""#)
        .send()
        .await
        .map_err(|error| format!("Userinfo request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse userinfo response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Userinfo failed ({})", status.as_u16()));
    }
    provider_profile(&body)
}

fn provider_profile(body: &serde_json::Value) -> Result<(String, Option<String>), String> {
    let email = ["email", "mail", "userPrincipalName"]
        .iter()
        .find_map(|key| {
            body.get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| "Provider profile did not return an email address".to_string())?
        .to_string();
    let name = ["name", "displayName"]
        .iter()
        .find_map(|key| {
            body.get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(str::to_string);
    Ok((email, name))
}

async fn connection_provider(app: &AppHandle, integration_id: &str) -> Result<String, String> {
    let pool = transactional_sqlite_pool(app).await?;
    connection_provider_from_pool(&pool, integration_id).await
}

async fn connection_provider_from_pool(
    pool: &sqlx::SqlitePool,
    integration_id: &str,
) -> Result<String, String> {
    sqlx::query_scalar::<_, String>("SELECT provider FROM workspace_integrations WHERE id = ? AND status IN ('active', 'expired')")
        .bind(integration_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Read email connection provider: {error}"))?
        .ok_or_else(|| "Email connection was not found in the active workspace".to_string())
}

async fn record_refresh_failure(
    pool: &sqlx::SqlitePool,
    integration_id: &str,
    error: OAuthProviderError,
) -> Result<(), String> {
    if error.requires_reconnect() {
        sqlx::query("UPDATE workspace_integrations SET status = 'expired', token_expires_at = NULL, last_error = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('active', 'expired')")
            .bind(error.message())
            .bind(integration_id)
            .execute(pool)
            .await
            .map_err(|error| format!("Record mailbox reconnection requirement: {error}"))?;
    }
    Ok(())
}

async fn get_valid_token_bundle(
    app: &AppHandle,
    integration_id: &str,
) -> Result<TokenBundle, String> {
    // Serialize refresh and disconnect so a late refresh cannot restore a
    // credential after the user has disconnected that mailbox.
    let _token_guard = TOKEN_OPERATION_LOCK.lock().await;
    // Keep ownership of this workspace through refresh and metadata writes.
    let pool = transactional_sqlite_pool(app).await?;
    let provider = connection_provider_from_pool(&pool, integration_id).await?;
    let config = provider_config(app, &provider)?;
    let bundle = load_token_bundle(app, integration_id)?;
    if !token_matches_registration(&bundle, &config) {
        delete_token_bundle(app, integration_id)?;
        return Err("Email provider setup changed. Reconnect the mailbox in Settings.".to_string());
    }
    if Utc::now().timestamp() >= bundle.expires_at - 300 {
        let refreshed = match refresh_token(&config, &bundle).await {
            Ok(refreshed) => refreshed,
            Err(error) => {
                record_refresh_failure(&pool, integration_id, error).await?;
                return Err(error.message().to_string());
            }
        };
        validate_granted_scopes(&config, &refreshed.scope)?;
        if !token_matches_registration(&refreshed, &provider_config(app, &provider)?) {
            delete_token_bundle(app, integration_id)?;
            return Err(
                "Email provider setup changed. Reconnect the mailbox in Settings.".to_string(),
            );
        }
        save_token_bundle(app, integration_id, &refreshed)?;
        sqlx::query("UPDATE workspace_integrations SET status = 'active', token_expires_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('active', 'expired')")
            .bind(refreshed.expires_at)
            .bind(integration_id)
            .execute(&pool)
            .await
            .map_err(|error| format!("Update mailbox refresh metadata: {error}"))?;
        return Ok(refreshed);
    }
    validate_granted_scopes(&config, &bundle.scope)?;
    Ok(bundle)
}

fn decode_gmail_body(data: &str) -> String {
    let cleaned = data.replace('-', "+").replace('_', "/");
    let padded = match cleaned.len() % 4 {
        0 => cleaned,
        n => cleaned + &"=".repeat(4 - n),
    };
    base64::engine::general_purpose::STANDARD
        .decode(&padded)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

fn extract_header(headers: &[serde_json::Value], name: &str) -> String {
    let lower = name.to_lowercase();
    headers
        .iter()
        .find(|header| {
            header
                .get("name")
                .and_then(|value| value.as_str())
                .map(|value| value.eq_ignore_ascii_case(&lower))
                .unwrap_or(false)
        })
        .and_then(|header| header.get("value").and_then(|value| value.as_str()))
        .unwrap_or("")
        .to_string()
}

fn extract_part_body(part: &serde_json::Value) -> (String, Option<String>) {
    let mime = part
        .get("mimeType")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if mime == "text/plain" {
        let data = part
            .get("body")
            .and_then(|body| body.get("data"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        return (decode_gmail_body(data), None);
    }
    if mime == "text/html" {
        let data = part
            .get("body")
            .and_then(|body| body.get("data"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        return (String::new(), Some(decode_gmail_body(data)));
    }
    if let Some(parts) = part.get("parts").and_then(|value| value.as_array()) {
        let mut text = String::new();
        let mut html = None;
        for child in parts {
            let (child_text, child_html) = extract_part_body(child);
            if !child_text.is_empty() {
                text = child_text;
            }
            if html.is_none() {
                html = child_html;
            }
        }
        return (text, html);
    }
    (String::new(), None)
}

#[derive(Debug)]
struct GmailAttachmentInfo {
    name: String,
    attachment_id: String,
    mime_type: String,
}

fn collect_attachment_info(part: &serde_json::Value, attachments: &mut Vec<GmailAttachmentInfo>) {
    if let Some(filename) = part.get("filename").and_then(|value| value.as_str()) {
        if !filename.is_empty() {
            attachments.push(GmailAttachmentInfo {
                name: filename.to_string(),
                attachment_id: part
                    .get("body")
                    .and_then(|body| body.get("attachmentId"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                mime_type: part
                    .get("mimeType")
                    .and_then(|value| value.as_str())
                    .unwrap_or("application/octet-stream")
                    .to_string(),
            });
        }
    }
    if let Some(parts) = part.get("parts").and_then(|value| value.as_array()) {
        for child in parts {
            collect_attachment_info(child, attachments);
        }
    }
}

fn detect_attachments(
    payload: &serde_json::Value,
) -> (bool, Vec<String>, Vec<String>, Vec<String>) {
    let mut attachments = Vec::new();
    collect_attachment_info(payload, &mut attachments);
    (
        !attachments.is_empty(),
        attachments.iter().map(|item| item.name.clone()).collect(),
        attachments
            .iter()
            .map(|item| item.attachment_id.clone())
            .collect(),
        attachments
            .iter()
            .map(|item| item.mime_type.clone())
            .collect(),
    )
}

#[tauri::command]
pub async fn start_integration_oauth(
    app: AppHandle,
    provider: String,
) -> Result<StartOAuthResult, String> {
    let config = provider_config(&app, &provider)?;
    let pool = transactional_sqlite_pool(&app).await?;
    let workspace_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("Read OAuth workspace identity: {error}"))?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Start OAuth callback listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Read OAuth callback listener address: {error}"))?
        .port();
    let redirect_uri = if provider == "microsoft_outlook" {
        format!("http://localhost:{port}")
    } else {
        format!("http://127.0.0.1:{port}")
    };
    let state = Uuid::new_v4().to_string();
    let code_verifier = generate_code_verifier();
    let code_challenge = compute_code_challenge(&code_verifier);
    let auth_url = build_auth_url(&config, &redirect_uri, &state, &code_challenge);
    let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);

    {
        let mut sessions = oauth_sessions().lock().unwrap();
        sessions.retain(|_, session| {
            Utc::now().timestamp() - session.created_at <= OAUTH_SESSION_TTL_SECS
        });
        sessions.insert(
            state.clone(),
            OAuthSession {
                provider: provider.clone(),
                config,
                workspace_id,
                code_verifier,
                redirect_uri,
                created_at: Utc::now().timestamp(),
                callback_code: None,
                callback_error: None,
                completing: false,
                cancel_sender,
            },
        );
    }
    tokio::spawn(spawn_callback_listener(
        state.clone(),
        listener,
        cancel_receiver,
    ));
    Ok(StartOAuthResult {
        auth_url,
        state,
        port,
    })
}

#[tauri::command]
pub async fn cancel_integration_oauth(state: String) -> Result<(), String> {
    let session = oauth_sessions().lock().unwrap().remove(&state);
    if let Some(session) = session {
        session.cancel_sender.send_replace(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn complete_integration_oauth(
    app: AppHandle,
    provider: String,
    state: String,
) -> Result<CompleteOAuthResult, String> {
    let session = {
        let mut sessions = oauth_sessions().lock().unwrap();
        let Some(session) = sessions.get(&state).cloned() else {
            return Err("No OAuth session found. Start the connection again.".to_string());
        };
        if session.provider != provider {
            return Err("OAuth provider mismatch. Start the connection again.".to_string());
        }
        if Utc::now().timestamp() - session.created_at > OAUTH_SESSION_TTL_SECS {
            sessions.remove(&state);
            return Err("OAuth session expired. Start the connection again.".to_string());
        }
        if let Some(error) = session.callback_error {
            sessions.remove(&state);
            return Err(error.message().to_string());
        }
        if session.callback_code.is_none() {
            return Err(
                "No OAuth callback received. Please finish sign-in in the browser.".to_string(),
            );
        }
        if session.completing {
            return Err("Mailbox authorization is already completing.".to_string());
        }
        sessions.get_mut(&state).expect("session exists").completing = true;
        session
    };
    let _completion_guard = OAuthCompletionGuard(state);
    ensure_oauth_not_cancelled(&session)?;
    let code = session.callback_code.as_deref().ok_or_else(|| {
        "No OAuth callback received. Please finish sign-in in the browser.".to_string()
    })?;
    let config = provider_config(&app, &provider)?;
    if config.client_id != session.config.client_id || config.tenant != session.config.tenant {
        return Err("Email provider setup changed. Start the connection again.".to_string());
    }
    let mut token_bundle = exchange_code(
        &config,
        &code,
        &session.code_verifier,
        &session.redirect_uri,
    )
    .await?;
    ensure_oauth_not_cancelled(&session)?;
    validate_granted_scopes(&config, &token_bundle.scope)?;
    let (email, name) = fetch_userinfo(&config, &token_bundle.access_token).await?;
    ensure_oauth_not_cancelled(&session)?;
    token_bundle.email = Some(email.clone());
    let current_config = provider_config(&app, &provider)?;
    if !token_matches_registration(&token_bundle, &current_config) {
        return Err("Email provider setup changed. Start the connection again.".to_string());
    }

    // Every operation that needs both locks takes the token mutex first.
    let token_guard = TOKEN_OPERATION_LOCK.lock().await;
    let pool = transactional_sqlite_pool(&app).await?;
    let workspace_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("Read active workspace identity: {error}"))?;
    if workspace_id != session.workspace_id {
        return Err(
            "Workspace changed during mailbox authorization. Reconnect in the intended workspace."
                .to_string(),
        );
    }
    let integration_id = format!("email-{}", Uuid::new_v4());
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Start mailbox connection transaction: {error}"))?;
    sqlx::query(
        "INSERT INTO workspace_integrations \
         (id, workspace_id, provider, label, status, external_id, external_name, token_expires_at, rfq_detection_enabled, polling_interval) \
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 1, 'off') \
         ON CONFLICT(workspace_id, provider, external_id) DO UPDATE SET \
         label = excluded.label, external_name = excluded.external_name, status = 'active', \
         token_expires_at = excluded.token_expires_at, last_error = NULL, \
         rfq_detection_enabled = COALESCE(workspace_integrations.rfq_detection_enabled, 1), \
         polling_interval = COALESCE(workspace_integrations.polling_interval, 'off'), updated_at = datetime('now')",
    )
    .bind(&integration_id)
    .bind(&workspace_id)
    .bind(&provider)
    .bind(&email)
    .bind(&email)
    .bind(name.as_deref().unwrap_or(&email))
    .bind(token_bundle.expires_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Persist email connection metadata: {error}"))?;

    let stored_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM workspace_integrations WHERE workspace_id = ? AND provider = ? AND external_id = ?",
    )
    .bind(&workspace_id)
    .bind(&provider)
    .bind(&email)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("Read saved email connection: {error}"))?;
    ensure_oauth_not_cancelled(&session)?;
    if !token_matches_registration(&token_bundle, &provider_config(&app, &provider)?) {
        return Err("Email provider setup changed. Start the connection again.".to_string());
    }
    save_token_bundle(&app, &stored_id, &token_bundle)?;
    if let Err(error) = transaction.commit().await {
        delete_token_bundle(&app, &stored_id)?;
        return Err(format!("Commit mailbox connection metadata: {error}"));
    }
    if let Err(error) = ensure_oauth_not_cancelled(&session) {
        delete_token_bundle(&app, &stored_id)?;
        sqlx::query("UPDATE workspace_integrations SET status = 'revoked', token_expires_at = NULL, updated_at = datetime('now') WHERE id = ?")
            .bind(&stored_id).execute(&pool).await
            .map_err(|error| format!("Cancel completed mailbox connection: {error}"))?;
        return Err(error);
    }
    let integration = read_email_connection(&pool, &stored_id).await?;
    drop(token_guard);
    Ok(CompleteOAuthResult { integration })
}

#[tauri::command]
pub async fn revoke_integration(
    app: AppHandle,
    integration_id: String,
    _provider: String,
) -> Result<(), String> {
    let _token_guard = TOKEN_OPERATION_LOCK.lock().await;
    delete_token_bundle(&app, &integration_id)?;
    let pool = transactional_sqlite_pool(&app).await?;
    sqlx::query(
        "UPDATE workspace_integrations SET status = 'revoked', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(integration_id)
    .execute(&pool)
    .await
    .map_err(|error| format!("Revoke email connection metadata: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn list_email_messages(
    app: AppHandle,
    connection_id: String,
    max_results: Option<u32>,
    page_token: Option<String>,
    query: Option<String>,
) -> Result<GmailListResult, String> {
    match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => {
            list_outlook_messages_impl(
                app,
                connection_id,
                "microsoft_outlook".to_string(),
                max_results,
                page_token,
                query,
            )
            .await
        }
        "google_gmail" => {
            list_gmail_messages_impl(
                app,
                connection_id,
                "google_gmail".to_string(),
                max_results,
                page_token,
                query.or_else(|| Some("in:inbox".to_string())),
            )
            .await
        }
        _ => Err("Unsupported email provider for this connection".to_string()),
    }
}

#[tauri::command]
pub async fn synchronize_email_messages(
    app: AppHandle,
    connection_id: String,
    max_results: Option<u32>,
) -> Result<GmailListResult, String> {
    match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => synchronize_outlook_messages(app, connection_id, max_results).await,
        "google_gmail" => synchronize_gmail_messages(app, connection_id, max_results).await,
        _ => Err("Unsupported email provider for this connection".to_string()),
    }
}

async fn read_sync_cursor(app: &AppHandle, connection_id: &str) -> Result<Option<String>, String> {
    let pool = transactional_sqlite_pool(app).await?;
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT sync_cursor FROM workspace_integrations WHERE id = ?",
    )
    .bind(connection_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read email sync cursor: {error}"))?
    .flatten()
    .map_or(Ok(None), |cursor| {
        if cursor.trim().is_empty() {
            Ok(None)
        } else {
            Ok(Some(cursor))
        }
    })
}

async fn write_sync_cursor(
    app: &AppHandle,
    connection_id: &str,
    cursor: Option<String>,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(app).await?;
    sqlx::query(
        "UPDATE workspace_integrations SET sync_cursor = COALESCE(?, sync_cursor), \
         last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
    .bind(cursor)
    .bind(connection_id)
    .execute(&pool)
    .await
    .map_err(|error| format!("Store email sync cursor: {error}"))?;
    Ok(())
}

async fn synchronize_gmail_messages(
    app: AppHandle,
    connection_id: String,
    max_results: Option<u32>,
) -> Result<GmailListResult, String> {
    let token_bundle = get_valid_token_bundle(&app, &connection_id).await?;
    let client = reqwest::Client::new();
    let max = max_results.unwrap_or(25).min(50);
    let Some(cursor) = read_sync_cursor(&app, &connection_id).await? else {
        let result = list_gmail_messages_impl(
            app.clone(),
            connection_id.clone(),
            "google_gmail".to_string(),
            Some(max),
            None,
            Some("in:inbox".to_string()),
        )
        .await?;
        let profile = client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
            .header(
                "Authorization",
                format!("Bearer {}", token_bundle.access_token),
            )
            .send()
            .await
            .map_err(|error| format!("Gmail profile request failed: {error}"))?;
        if profile.status().is_success() {
            if let Ok(body) = profile.json::<serde_json::Value>().await {
                let history_id = body
                    .get("historyId")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                write_sync_cursor(&app, &connection_id, history_id).await?;
            }
        } else {
            write_sync_cursor(&app, &connection_id, None).await?;
        }
        return Ok(result);
    };

    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId={}&historyTypes=messageAdded&maxResults={max}",
        urlencode(&cursor)
    );
    let response = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .send()
        .await
        .map_err(|error| format!("Gmail history request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Gmail history response: {error}"))?;
    if status.as_u16() == 404 {
        sqlx::query("UPDATE workspace_integrations SET sync_cursor = NULL WHERE id = ?")
            .bind(&connection_id)
            .execute(&transactional_sqlite_pool(&app).await?)
            .await
            .map_err(|error| format!("Reset stale Gmail sync cursor: {error}"))?;
        let result = list_gmail_messages_impl(
            app.clone(),
            connection_id.clone(),
            "google_gmail".to_string(),
            Some(max),
            None,
            Some("in:inbox".to_string()),
        )
        .await?;
        let profile = client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
            .header(
                "Authorization",
                format!("Bearer {}", token_bundle.access_token),
            )
            .send()
            .await
            .map_err(|error| format!("Gmail profile request failed: {error}"))?;
        if profile.status().is_success() {
            if let Ok(body) = profile.json::<serde_json::Value>().await {
                let history_id = body
                    .get("historyId")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                write_sync_cursor(&app, &connection_id, history_id).await?;
            }
        }
        return Ok(result);
    }
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Gmail history failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let mut ids = Vec::<String>::new();
    if let Some(history) = body.get("history").and_then(|value| value.as_array()) {
        for entry in history {
            if let Some(added) = entry
                .get("messagesAdded")
                .and_then(|value| value.as_array())
            {
                for item in added {
                    if let Some(id) = item
                        .get("message")
                        .and_then(|message| message.get("id"))
                        .and_then(|value| value.as_str())
                    {
                        if !ids.iter().any(|existing| existing == id) {
                            ids.push(id.to_string());
                        }
                    }
                }
            }
        }
    }
    let mut messages = Vec::new();
    for id in ids.into_iter().take(max as usize) {
        if let Ok(detail) = get_gmail_message_impl(
            app.clone(),
            connection_id.clone(),
            "google_gmail".to_string(),
            id,
        )
        .await
        {
            messages.push(GmailMessageSummary {
                id: detail.id,
                thread_id: detail.thread_id,
                from: detail.from,
                subject: detail.subject,
                date: detail.date,
                snippet: detail.snippet,
                is_unread: detail.labels.iter().any(|label| label == "UNREAD"),
                has_attachments: detail.has_attachments,
            });
        }
    }
    let cursor = body
        .get("historyId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    write_sync_cursor(&app, &connection_id, cursor).await?;
    Ok(GmailListResult {
        messages,
        next_page_token: None,
        result_size_estimate: 0,
    })
}

async fn synchronize_outlook_messages(
    app: AppHandle,
    connection_id: String,
    max_results: Option<u32>,
) -> Result<GmailListResult, String> {
    let max = max_results.unwrap_or(25).min(50);
    let url = read_sync_cursor(&app, &connection_id)
        .await?
        .unwrap_or_else(|| {
            format!(
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top={max}&$select=id,conversationId,from,subject,receivedDateTime,bodyPreview,isRead,hasAttachments"
            )
        });
    let url = outlook_cursor_url(&url)?;
    let token_bundle = get_valid_token_bundle(&app, &connection_id).await?;
    let response = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Create Outlook delta client: {error}"))?
        .get(url)
        .bearer_auth(&token_bundle.access_token)
        .header("Prefer", r#"IdType="ImmutableId""#)
        .send()
        .await
        .map_err(|error| format!("Outlook delta request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Outlook delta response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Outlook delta failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let values = body
        .get("value")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let messages = values
        .iter()
        .filter(|message| message.get("@removed").is_none())
        .filter_map(|message| {
            let id = message.get("id").and_then(|value| value.as_str())?;
            let from_name = message
                .get("from")
                .and_then(|value| value.get("emailAddress"))
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let from_address = message
                .get("from")
                .and_then(|value| value.get("emailAddress"))
                .and_then(|value| value.get("address"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let from = if from_name.is_empty() {
                from_address.to_string()
            } else {
                format!("{from_name} <{from_address}>")
            };
            Some(GmailMessageSummary {
                id: id.to_string(),
                thread_id: message
                    .get("conversationId")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                from,
                subject: message
                    .get("subject")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                date: message
                    .get("receivedDateTime")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                snippet: message
                    .get("bodyPreview")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                is_unread: !message
                    .get("isRead")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(true),
                has_attachments: message
                    .get("hasAttachments")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            })
        })
        .take(max as usize)
        .collect::<Vec<_>>();
    let next_page_token = outlook_response_cursor(&body, "@odata.nextLink")?;
    let cursor =
        outlook_response_cursor(&body, "@odata.deltaLink")?.or_else(|| next_page_token.clone());
    write_sync_cursor(&app, &connection_id, cursor.clone()).await?;
    Ok(GmailListResult {
        messages,
        next_page_token,
        result_size_estimate: values.len() as u32,
    })
}

#[tauri::command]
pub async fn get_email_message(
    app: AppHandle,
    connection_id: String,
    message_id: String,
) -> Result<GmailMessageDetail, String> {
    match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => {
            get_outlook_message_impl(
                app,
                connection_id,
                "microsoft_outlook".to_string(),
                message_id,
            )
            .await
        }
        "google_gmail" => {
            get_gmail_message_impl(app, connection_id, "google_gmail".to_string(), message_id).await
        }
        _ => Err("Unsupported email provider for this connection".to_string()),
    }
}

#[tauri::command]
pub async fn download_email_attachment(
    app: AppHandle,
    connection_id: String,
    message_id: String,
    attachment_id: String,
    filename: String,
    open_file: Option<bool>,
) -> Result<String, String> {
    let path = match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => {
            download_outlook_attachment_impl(
                app.clone(),
                connection_id,
                "microsoft_outlook".to_string(),
                message_id,
                attachment_id,
                filename,
            )
            .await
        }
        "google_gmail" => {
            download_gmail_attachment_impl(
                app.clone(),
                connection_id,
                "google_gmail".to_string(),
                message_id,
                attachment_id,
                filename,
            )
            .await
        }
        _ => Err("Unsupported email provider for this connection".to_string()),
    }?;
    if open_file.unwrap_or(false) {
        let _ = app.opener().open_path(path.clone(), None::<&str>);
    }
    Ok(path)
}

#[tauri::command]
pub async fn set_email_message_read_status(
    app: AppHandle,
    connection_id: String,
    message_id: String,
    is_read: bool,
) -> Result<(), String> {
    match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => {
            set_outlook_message_read_status_impl(
                app,
                connection_id,
                "microsoft_outlook".to_string(),
                message_id,
                is_read,
            )
            .await
        }
        "google_gmail" => {
            set_gmail_message_read_status_impl(
                app,
                connection_id,
                "google_gmail".to_string(),
                message_id,
                is_read,
            )
            .await
        }
        _ => Err("Unsupported email provider for this connection".to_string()),
    }
}

#[tauri::command]
pub async fn send_email_message(
    app: AppHandle,
    connection_id: String,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body: String,
    attachment_filename: Option<String>,
    attachment_base64: Option<String>,
) -> Result<String, String> {
    match connection_provider(&app, &connection_id).await?.as_str() {
        "microsoft_outlook" => {
            send_outlook_message_impl(
                app,
                connection_id,
                "microsoft_outlook".to_string(),
                to,
                cc,
                bcc,
                subject,
                body,
                attachment_filename,
                attachment_base64,
            )
            .await
        }
        "google_gmail" => {
            send_gmail_message_impl(
                app,
                connection_id,
                "google_gmail".to_string(),
                to,
                cc,
                bcc,
                subject,
                body,
                attachment_filename,
                attachment_base64,
            )
            .await
        }
        _ => Err("Unsupported email provider for this connection".to_string()),
    }
}

pub async fn list_gmail_messages_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    max_results: Option<u32>,
    page_token: Option<String>,
    query: Option<String>,
) -> Result<GmailListResult, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let max = max_results.unwrap_or(25).min(50);
    let query_param = query.unwrap_or_else(|| "in:inbox".to_string());
    let mut url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={max}&q={}",
        urlencode(&query_param)
    );
    if let Some(page_token) = page_token {
        url.push_str("&pageToken=");
        url.push_str(&urlencode(&page_token));
    }
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .send()
        .await
        .map_err(|error| format!("Gmail list request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Gmail list response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!("Gmail list failed ({}): {reason}", status.as_u16()));
    }
    let ids = body
        .get("messages")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut messages = Vec::with_capacity(ids.len());
    for item in ids {
        let Some(message_id) = item.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let detail_url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
        );
        let Ok(detail_response) = client
            .get(&detail_url)
            .header(
                "Authorization",
                format!("Bearer {}", token_bundle.access_token),
            )
            .send()
            .await
        else {
            continue;
        };
        if !detail_response.status().is_success() {
            continue;
        }
        let detail = detail_response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let headers = detail
            .get("payload")
            .and_then(|payload| payload.get("headers"))
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let labels: Vec<String> = detail
            .get("labelIds")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let has_attachments = detail
            .get("payload")
            .map(|payload| detect_attachments(payload).0)
            .unwrap_or(false);
        messages.push(GmailMessageSummary {
            id: message_id.to_string(),
            thread_id: detail
                .get("threadId")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
            from: extract_header(&headers, "From"),
            subject: extract_header(&headers, "Subject"),
            date: extract_header(&headers, "Date"),
            snippet: detail
                .get("snippet")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
            is_unread: labels.iter().any(|label| label == "UNREAD"),
            has_attachments,
        });
    }
    Ok(GmailListResult {
        messages,
        next_page_token: body
            .get("nextPageToken")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        result_size_estimate: body
            .get("resultSizeEstimate")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
    })
}

pub async fn send_gmail_message_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body: String,
    attachment_filename: Option<String>,
    attachment_base64: Option<String>,
) -> Result<String, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let from = token_bundle
        .email
        .clone()
        .unwrap_or_else(|| "me".to_string());
    let boundary = format!("kwantflow-{}", Uuid::new_v4());
    let mut mime_parts = vec![format!(
        "--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{body}\r\n"
    )];
    if let (Some(filename), Some(data)) = (attachment_filename, attachment_base64) {
        mime_parts.push(format!(
            "--{boundary}\r\nContent-Type: application/pdf; name=\"{}\"\r\nContent-Disposition: attachment; filename=\"{}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
            filename.replace('"', ""),
            filename.replace('"', ""),
            data
        ));
    }
    mime_parts.push(format!("--{boundary}--"));
    let cc_header = cc
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("Cc: {value}\r\n"))
        .unwrap_or_default();
    let bcc_header = bcc
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("Bcc: {value}\r\n"))
        .unwrap_or_default();
    let encoded_subject = if subject.bytes().any(|byte| byte > 127) {
        format!(
            "=?UTF-8?B?{}?=",
            base64::engine::general_purpose::STANDARD.encode(subject.as_bytes())
        )
    } else {
        subject
    };
    let raw = format!(
        "From: {from}\r\nTo: {to}\r\n{cc_header}{bcc_header}Subject: {encoded_subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n{}",
        mime_parts.join("\r\n")
    );
    let response = reqwest::Client::new()
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .json(&serde_json::json!({
            "raw": URL_SAFE_NO_PAD.encode(raw.as_bytes())
        }))
        .send()
        .await
        .map_err(|error| format!("Gmail send request failed: {error}"))?;
    let status = response.status();
    let response_body = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_default();
    if status.is_success() {
        Ok(response_body
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("sent")
            .to_string())
    } else {
        let reason = response_body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        Err(format!("Gmail send failed ({}): {reason}", status.as_u16()))
    }
}

pub async fn get_gmail_message_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
) -> Result<GmailMessageDetail, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let url =
        format!("https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?format=full");
    let response = reqwest::Client::new()
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .send()
        .await
        .map_err(|error| format!("Gmail get request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Gmail message response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!("Gmail get failed ({}): {reason}", status.as_u16()));
    }
    let payload = body.get("payload");
    let headers = payload
        .and_then(|payload| payload.get("headers"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let (body_text, body_html) = payload
        .map(extract_part_body)
        .unwrap_or((String::new(), None));
    let (has_attachments, attachment_names, attachment_ids, attachment_mime_types) = payload
        .map(detect_attachments)
        .unwrap_or((false, Vec::new(), Vec::new(), Vec::new()));
    let labels = body
        .get("labelIds")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(GmailMessageDetail {
        id: body
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        thread_id: body
            .get("threadId")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        from: extract_header(&headers, "From"),
        to: extract_header(&headers, "To"),
        cc: extract_header(&headers, "Cc"),
        subject: extract_header(&headers, "Subject"),
        date: extract_header(&headers, "Date"),
        body_text,
        body_html,
        snippet: body
            .get("snippet")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        labels,
        has_attachments,
        attachment_names,
        attachment_ids,
        attachment_mime_types,
    })
}

pub async fn download_gmail_attachment_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
    attachment_id: String,
    filename: String,
) -> Result<String, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/attachments/{attachment_id}"
    );
    let response = reqwest::Client::new()
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .send()
        .await
        .map_err(|error| format!("Gmail attachment request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Gmail attachment response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Gmail attachment download failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let data = body
        .get("data")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Gmail attachment response did not contain data".to_string())?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data)
        .map_err(|error| format!("Decode Gmail attachment: {error}"))?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Resolve app data directory: {error}"))?;
    let file_path = store_downloaded_attachment(&data_dir, &filename, &decoded).await?;
    Ok(file_path.to_string_lossy().to_string())
}

async fn store_downloaded_attachment(
    data_dir: &Path,
    filename: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let safe_name = crate::resolve_safe_path_segment(filename, "Attachment filename")?;
    let stem = safe_name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    if safe_name.ends_with(['.', ' '])
        || safe_name.chars().any(|character| {
            character.is_control() || ['<', '>', ':', '"', '|', '?', '*'].contains(&character)
        })
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || matches!(
            stem.as_str(),
            "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    {
        return Err(
            "Attachment filename is not supported. Rename the attachment and try again."
                .to_string(),
        );
    }
    let attachment_dir = data_dir.join("attachments");
    tokio::fs::create_dir_all(&attachment_dir)
        .await
        .map_err(|error| format!("Create attachment directory: {error}"))?;
    let attachment_dir = crate::resolve_existing_path_within_root(&attachment_dir, data_dir)?;
    let download_dir = tempfile::Builder::new()
        .prefix("email-")
        .tempdir_in(&attachment_dir)
        .map_err(|error| format!("Create attachment download directory: {error}"))?;
    let download_root =
        crate::resolve_existing_path_within_root(download_dir.path(), &attachment_dir)?;
    let file_path = download_root.join(safe_name);
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
        .await
        .map_err(|error| format!("Create attachment file: {error}"))?;
    file.write_all(bytes)
        .await
        .map_err(|error| format!("Write attachment file: {error}"))?;
    file.flush()
        .await
        .map_err(|error| format!("Flush attachment file: {error}"))?;
    drop(file);
    let file_path = crate::resolve_existing_path_within_root(&file_path, &download_root)?;
    let _ = download_dir.keep();
    Ok(file_path)
}

pub async fn set_gmail_message_read_status_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
    is_read: bool,
) -> Result<(), String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let (remove, add) = if is_read {
        (vec!["UNREAD"], Vec::<&str>::new())
    } else {
        (Vec::<&str>::new(), vec!["UNREAD"])
    };
    let response = reqwest::Client::new()
        .post(format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/modify"
        ))
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .json(&serde_json::json!({
            "removeLabelIds": remove,
            "addLabelIds": add,
        }))
        .send()
        .await
        .map_err(|error| format!("Gmail modify request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        Err(format!(
            "Gmail modify failed ({}): {reason}",
            status.as_u16()
        ))
    }
}

#[tauri::command]
pub async fn restore_integrations(app: AppHandle) -> Result<Vec<IntegrationInfo>, String> {
    let _token_guard = TOKEN_OPERATION_LOCK.lock().await;
    let pool = transactional_sqlite_pool(&app).await?;
    let rows = sqlx::query(
        "SELECT id, workspace_id, provider, label, external_id, external_name, status, \
         token_expires_at, last_error, rfq_detection_enabled, polling_interval, last_synced_at \
         FROM workspace_integrations ORDER BY connected_at ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("Restore email integrations: {error}"))?;
    secure_store::discard_legacy_credentials(&app)?;
    let settings = read_provider_settings(&app)?;
    let mut integrations = Vec::with_capacity(rows.len());
    for row in rows {
        let mut integration = integration_info_from_row(&row)?;
        if matches!(
            integration.provider.as_str(),
            "google_gmail" | "microsoft_outlook"
        ) && integration.status != "revoked"
        {
            let bytes = secure_store::get_generic_password(
                &app,
                KEYCHAIN_SERVICE,
                &keychain_account(&integration.id),
            )?;
            let bundle = bytes
                .as_deref()
                .and_then(|bytes| serde_json::from_slice::<TokenBundle>(bytes).ok());
            let config = provider_config_from_settings(&integration.provider, &settings).ok();
            let valid = match (bundle.as_ref(), config.as_ref()) {
                (Some(bundle), Some(config)) => token_matches_registration(bundle, config),
                _ => false,
            };
            if !valid {
                delete_token_bundle(&app, &integration.id)?;
                let message = "Configure your own provider registration and reconnect this mailbox. Imported RFQs and files remain available.";
                sqlx::query("UPDATE workspace_integrations SET status = 'revoked', token_expires_at = NULL, last_error = ?, sync_cursor = NULL, updated_at = datetime('now') WHERE id = ?")
                    .bind(message).bind(&integration.id).execute(&pool).await
                    .map_err(|error| format!("Retire previous mailbox registration: {error}"))?;
                integration.status = "revoked".to_string();
                integration.token_expires_at = None;
                integration.last_error = Some(message.to_string());
            }
        }
        integrations.push(integration);
    }
    Ok(integrations)
}

#[tauri::command]
pub async fn update_email_connection_settings(
    app: AppHandle,
    connection_id: String,
    rfq_detection_enabled: Option<bool>,
    polling_interval: Option<String>,
) -> Result<IntegrationInfo, String> {
    if let Some(value) = polling_interval.as_deref() {
        if !matches!(value, "off" | "15m" | "30m" | "1h") {
            return Err("Unsupported polling interval".to_string());
        }
    }
    let pool = transactional_sqlite_pool(&app).await?;
    let result = sqlx::query(
        "UPDATE workspace_integrations SET \
         rfq_detection_enabled = COALESCE(?, rfq_detection_enabled), \
         polling_interval = COALESCE(?, polling_interval), updated_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(rfq_detection_enabled.map(i64::from))
    .bind(polling_interval)
    .bind(&connection_id)
    .execute(&pool)
    .await
    .map_err(|error| format!("Update email connection settings: {error}"))?;
    if result.rows_affected() != 1 {
        return Err("Email connection was not found in the active workspace".to_string());
    }
    read_email_connection(&pool, &connection_id).await
}

#[tauri::command]
pub async fn list_email_rfq_classifications(
    app: AppHandle,
    connection_id: String,
    classifier_version: String,
) -> Result<Vec<EmailRfqClassification>, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let rows = sqlx::query(
        "SELECT integration_id, provider_message_id, classifier_version, verdict, model_id, classified_at \
         FROM email_rfq_classifications WHERE integration_id = ? AND classifier_version = ?",
    )
    .bind(connection_id)
    .bind(classifier_version)
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("Load email RFQ classifications: {error}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(EmailRfqClassification {
                integration_id: row.try_get("integration_id").map_err(|e| e.to_string())?,
                provider_message_id: row
                    .try_get("provider_message_id")
                    .map_err(|e| e.to_string())?,
                classifier_version: row
                    .try_get("classifier_version")
                    .map_err(|e| e.to_string())?,
                verdict: row.try_get("verdict").map_err(|e| e.to_string())?,
                model_id: row.try_get("model_id").map_err(|e| e.to_string())?,
                classified_at: row.try_get("classified_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn save_email_rfq_classification(
    app: AppHandle,
    connection_id: String,
    provider_message_id: String,
    classifier_version: String,
    verdict: String,
    model_id: String,
) -> Result<(), String> {
    if !matches!(verdict.as_str(), "rfq" | "not_rfq") {
        return Err("Unsupported RFQ classification verdict".to_string());
    }
    let pool = transactional_sqlite_pool(&app).await?;
    let result = sqlx::query(
        "INSERT INTO email_rfq_classifications \
         (integration_id, provider_message_id, classifier_version, verdict, model_id) \
         SELECT id, ?, ?, ?, ? FROM workspace_integrations WHERE id = ? \
         ON CONFLICT(integration_id, provider_message_id, classifier_version) DO UPDATE SET \
         verdict = excluded.verdict, model_id = excluded.model_id, \
         classified_at = datetime('now'), updated_at = datetime('now')",
    )
    .bind(provider_message_id)
    .bind(classifier_version)
    .bind(verdict)
    .bind(model_id)
    .bind(connection_id)
    .execute(&pool)
    .await
    .map_err(|error| format!("Store email RFQ classification: {error}"))?;
    if result.rows_affected() == 0 {
        return Err("Email connection was not found in the active workspace".to_string());
    }
    Ok(())
}

// Graph state tokens are opaque, but their destination is not. Validate imported
// sync cursors and IPC paging links before loading credentials or making a request.
fn outlook_cursor_url(raw: &str) -> Result<reqwest::Url, String> {
    let invalid = "Outlook paging or sync cursor is invalid. Refresh or reconnect this mailbox.";
    let url = reqwest::Url::parse(raw).map_err(|_| invalid.to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("graph.microsoft.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/v1.0/")
    {
        return Err(invalid.to_string());
    }
    Ok(url)
}

fn outlook_response_cursor(
    body: &serde_json::Value,
    field: &str,
) -> Result<Option<String>, String> {
    body.get(field)
        .and_then(|value| value.as_str())
        .map(|raw| outlook_cursor_url(raw).map(|_| raw.to_string()))
        .transpose()
}

pub async fn list_outlook_messages_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    max_results: Option<u32>,
    page_token: Option<String>,
    query: Option<String>,
) -> Result<GmailListResult, String> {
    let max = max_results.unwrap_or(25).min(50);
    let url = if let Some(page_token) = page_token {
        page_token
    } else {
        let mut url = format!(
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top={max}&$select=id,conversationId,from,subject,receivedDateTime,bodyPreview,isRead,hasAttachments&$orderby=receivedDateTime desc"
        );
        if let Some(query) = query.as_deref().filter(|value| !value.trim().is_empty()) {
            url.push_str("&$search=");
            url.push_str(&urlencode(&format!("\"{}\"", query.replace('"', ""))));
        }
        url
    };
    let url = outlook_cursor_url(&url)?;
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let response = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Create Outlook list client: {error}"))?
        .get(url)
        .bearer_auth(&token_bundle.access_token)
        .header("Prefer", r#"IdType="ImmutableId""#)
        .send()
        .await
        .map_err(|error| format!("Outlook list request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Outlook list response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Outlook list failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let values = body
        .get("value")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let messages = values
        .iter()
        .filter_map(|message| {
            let id = message.get("id").and_then(|value| value.as_str())?;
            let from_name = message
                .get("from")
                .and_then(|value| value.get("emailAddress"))
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let from_address = message
                .get("from")
                .and_then(|value| value.get("emailAddress"))
                .and_then(|value| value.get("address"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let from = if from_name.is_empty() {
                from_address.to_string()
            } else {
                format!("{from_name} <{from_address}>")
            };
            Some(GmailMessageSummary {
                id: id.to_string(),
                thread_id: message
                    .get("conversationId")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                from,
                subject: message
                    .get("subject")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                date: message
                    .get("receivedDateTime")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                snippet: message
                    .get("bodyPreview")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                is_unread: !message
                    .get("isRead")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(true),
                has_attachments: message
                    .get("hasAttachments")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    Ok(GmailListResult {
        messages,
        next_page_token: outlook_response_cursor(&body, "@odata.nextLink")?,
        result_size_estimate: values.len() as u32,
    })
}

pub async fn get_outlook_message_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
) -> Result<GmailMessageDetail, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "https://graph.microsoft.com/v1.0/me/messages/{message_id}"
        ))
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .header("Prefer", r#"IdType="ImmutableId""#)
        .send()
        .await
        .map_err(|error| format!("Outlook get request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Outlook message response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Outlook get failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let format_address = |key: &str| -> String {
        let Some(email) = body.get(key).and_then(|value| value.get("emailAddress")) else {
            return String::new();
        };
        let name = email
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let address = email
            .get("address")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if name.is_empty() {
            address.to_string()
        } else {
            format!("{name} <{address}>")
        }
    };
    let format_recipients = |key: &str| -> String {
        body.get(key)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let email = item.get("emailAddress")?;
                        let name = email
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        let address = email
                            .get("address")
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        if address.is_empty() {
                            None
                        } else if name.is_empty() {
                            Some(address.to_string())
                        } else {
                            Some(format!("{name} <{address}>"))
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    };
    let content_type = body
        .get("body")
        .and_then(|value| value.get("contentType"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let content = body
        .get("body")
        .and_then(|value| value.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let (body_text, body_html) = if content_type.eq_ignore_ascii_case("html") {
        (String::new(), Some(content.to_string()))
    } else {
        (content.to_string(), None)
    };
    let mut attachment_names = Vec::new();
    let mut attachment_ids = Vec::new();
    let mut attachment_mime_types = Vec::new();
    if body
        .get("hasAttachments")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        let attachments_response = client
            .get(format!(
                "https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments?$select=id,name,contentType"
            ))
            .header("Authorization", format!("Bearer {}", token_bundle.access_token))
            .header("Prefer", r#"IdType="ImmutableId""#)
            .send()
            .await;
        if let Ok(response) = attachments_response {
            if response.status().is_success() {
                if let Ok(attachments) = response.json::<serde_json::Value>().await {
                    if let Some(values) =
                        attachments.get("value").and_then(|value| value.as_array())
                    {
                        for item in values {
                            if let Some(name) = item.get("name").and_then(|value| value.as_str()) {
                                attachment_names.push(name.to_string());
                                attachment_ids.push(
                                    item.get("id")
                                        .and_then(|value| value.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                );
                                attachment_mime_types.push(
                                    item.get("contentType")
                                        .and_then(|value| value.as_str())
                                        .unwrap_or("application/octet-stream")
                                        .to_string(),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(GmailMessageDetail {
        id: message_id,
        thread_id: body
            .get("conversationId")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        from: format_address("from"),
        to: format_recipients("toRecipients"),
        cc: format_recipients("ccRecipients"),
        subject: body
            .get("subject")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        date: body
            .get("receivedDateTime")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        body_text,
        body_html,
        snippet: body
            .get("bodyPreview")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        labels: if body
            .get("isRead")
            .and_then(|value| value.as_bool())
            .unwrap_or(true)
        {
            Vec::new()
        } else {
            vec!["UNREAD".to_string()]
        },
        has_attachments: !attachment_ids.is_empty(),
        attachment_names,
        attachment_ids,
        attachment_mime_types,
    })
}

pub async fn download_outlook_attachment_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
    attachment_id: String,
    filename: String,
) -> Result<String, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let response = reqwest::Client::new()
        .get(format!(
            "https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments/{attachment_id}"
        ))
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .header("Prefer", r#"IdType="ImmutableId""#)
        .send()
        .await
        .map_err(|error| format!("Outlook attachment request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Parse Outlook attachment response: {error}"))?;
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "Outlook attachment download failed ({}): {reason}",
            status.as_u16()
        ));
    }
    let data = body
        .get("contentBytes")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Outlook attachment response did not contain content bytes".to_string())?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| format!("Decode Outlook attachment: {error}"))?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Resolve app data directory: {error}"))?;
    let file_path = store_downloaded_attachment(&data_dir, &filename, &decoded).await?;
    Ok(file_path.to_string_lossy().to_string())
}

pub async fn set_outlook_message_read_status_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    message_id: String,
    is_read: bool,
) -> Result<(), String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let response = reqwest::Client::new()
        .patch(format!(
            "https://graph.microsoft.com/v1.0/me/messages/{message_id}"
        ))
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .header("Prefer", r#"IdType="ImmutableId""#)
        .json(&serde_json::json!({ "isRead": is_read }))
        .send()
        .await
        .map_err(|error| format!("Outlook modify request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let reason = body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        Err(format!(
            "Outlook modify failed ({}): {reason}",
            status.as_u16()
        ))
    }
}

pub async fn send_outlook_message_impl(
    app: AppHandle,
    integration_id: String,
    _provider: String,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body: String,
    attachment_filename: Option<String>,
    attachment_base64: Option<String>,
) -> Result<String, String> {
    let token_bundle = get_valid_token_bundle(&app, &integration_id).await?;
    let recipients = |value: &str| -> Vec<serde_json::Value> {
        value
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|address| serde_json::json!({ "emailAddress": { "address": address } }))
            .collect()
    };
    let mut message = serde_json::json!({
        "subject": subject,
        "body": {
            "contentType": "Text",
            "content": body
        },
        "toRecipients": recipients(&to),
        "ccRecipients": recipients(cc.as_deref().unwrap_or("")),
        "bccRecipients": recipients(bcc.as_deref().unwrap_or(""))
    });
    if let (Some(filename), Some(data)) = (attachment_filename, attachment_base64) {
        message["attachments"] = serde_json::json!([{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": filename,
            "contentBytes": data
        }]);
    }
    let response = reqwest::Client::new()
        .post("https://graph.microsoft.com/v1.0/me/sendMail")
        .header(
            "Authorization",
            format!("Bearer {}", token_bundle.access_token),
        )
        .header("Prefer", r#"IdType="ImmutableId""#)
        .json(&serde_json::json!({
            "message": message,
            "saveToSentItems": true
        }))
        .send()
        .await
        .map_err(|error| format!("Outlook send request failed: {error}"))?;
    if response.status().is_success() {
        Ok(format!("outlook-sent-{}", Uuid::new_v4()))
    } else {
        let status = response.status();
        let response_body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let reason = response_body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        Err(format!(
            "Outlook send failed ({}): {reason}",
            status.as_u16()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outlook_cursors_preserve_opaque_graph_state_tokens() {
        for raw in [
            "https://graph.microsoft.com/v1.0/me/messages?$skip=27&$select=id,subject",
            "https://graph.microsoft.com:443/v1.0/me/mailFolders/inbox/messages?$skiptoken=a%2Bb%2F%3D",
            "https://graph.microsoft.com/v1.0/me/mailfolders('synthetic-id')/messages/delta?$deltatoken=a%2Fb%2B%3D",
            "https://graph.microsoft.com/v1.0/users('synthetic-user')/mailFolders('synthetic-folder')/messages?$skiptoken=opaque",
        ] {
            let parsed = outlook_cursor_url(raw).unwrap();
            let expected_query = raw.split_once('?').unwrap().1;
            assert_eq!(parsed.query(), Some(expected_query));
            for field in ["@odata.nextLink", "@odata.deltaLink"] {
                let body = serde_json::json!({ field: raw });
                assert_eq!(outlook_response_cursor(&body, field).unwrap().as_deref(), Some(raw));
            }
        }
    }

    #[test]
    fn outlook_cursors_reject_untrusted_destinations_before_authorization() {
        for raw in [
            "http://graph.microsoft.com/v1.0/me/messages",
            "http://127.0.0.1:12345/collect",
            "https://example.invalid/v1.0/me/messages",
            "https://graph.microsoft.com.example.invalid/v1.0/me/messages",
            "https://graph.microsoft.com@other.invalid/v1.0/me/messages",
            "https://user:password@graph.microsoft.com/v1.0/me/messages",
            "https://graph.microsoft.com:444/v1.0/me/messages",
            "https://graph.microsoft.com/v1.0/me/messages#ignored",
            "https://graph.microsoft.com/beta/me/messages",
            "https://graph.microsoft.com/v1.0/../../collect",
            "/v1.0/me/messages",
        ] {
            assert!(
                outlook_cursor_url(raw).is_err(),
                "accepted unsafe cursor: {raw}"
            );
            for field in ["@odata.nextLink", "@odata.deltaLink"] {
                let body = serde_json::json!({ field: raw });
                assert!(outlook_response_cursor(&body, field).is_err());
            }
        }
        assert_eq!(
            outlook_response_cursor(&serde_json::json!({}), "@odata.nextLink").unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn downloaded_attachments_with_the_same_filename_keep_separate_contents() {
        let data_dir = tempfile::tempdir().unwrap();
        let first = store_downloaded_attachment(data_dir.path(), "drawing.dxf", b"first drawing")
            .await
            .unwrap();
        let second = store_downloaded_attachment(data_dir.path(), "drawing.dxf", b"second drawing")
            .await
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(first.file_name().unwrap(), "drawing.dxf");
        assert_eq!(second.file_name().unwrap(), "drawing.dxf");
        assert_eq!(std::fs::read(first).unwrap(), b"first drawing");
        assert_eq!(std::fs::read(second).unwrap(), b"second drawing");
    }

    #[tokio::test]
    async fn downloaded_attachments_reject_unsafe_and_windows_device_filenames() {
        let data_dir = tempfile::tempdir().unwrap();
        for filename in [
            "../drawing.dxf",
            "/drawing.dxf",
            "drawing.dxf:other",
            "CON",
            "con .pdf",
            "aux.txt",
            "COM1.pdf",
            "drawing.pdf.",
            "drawing\n.pdf",
        ] {
            assert!(
                store_downloaded_attachment(data_dir.path(), filename, b"synthetic drawing")
                    .await
                    .is_err(),
                "accepted unsafe filename: {filename:?}"
            );
        }
        assert!(!data_dir.path().join("attachments").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn downloaded_attachments_reject_a_symlinked_cache_directory() {
        let data_dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), data_dir.path().join("attachments")).unwrap();
        assert!(
            store_downloaded_attachment(data_dir.path(), "drawing.dxf", b"synthetic drawing")
                .await
                .is_err()
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn downloaded_attachments_do_not_follow_an_old_filename_symlink() {
        let data_dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("original.dxf");
        std::fs::write(&target, b"original drawing").unwrap();
        let cache = data_dir.path().join("attachments");
        std::fs::create_dir(&cache).unwrap();
        std::os::unix::fs::symlink(&target, cache.join("drawing.dxf")).unwrap();
        let downloaded =
            store_downloaded_attachment(data_dir.path(), "drawing.dxf", b"new drawing")
                .await
                .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"original drawing");
        assert_eq!(std::fs::read(downloaded).unwrap(), b"new drawing");
    }

    fn test_settings() -> EmailProviderSettings {
        EmailProviderSettings {
            google_client_id: "123-synthetic.apps.googleusercontent.com".to_string(),
            microsoft_client_id: "ac6bd346-e3c3-472a-a645-e21b1a375c4d".to_string(),
            microsoft_tenant: "common".to_string(),
        }
    }

    #[test]
    fn default_provider_setup_never_uses_a_founder_registration() {
        let settings = EmailProviderSettings::default();
        assert!(provider_config_from_settings("google_gmail", &settings).is_err());
        assert!(provider_config_from_settings("microsoft_outlook", &settings).is_err());
    }

    #[test]
    fn provider_setup_accepts_public_identifiers_and_rejects_authority_urls() {
        let mut settings = test_settings();
        settings.microsoft_tenant = "https://example.invalid".to_string();
        assert!(validate_provider_settings(settings.clone()).is_err());
        settings.microsoft_tenant = " organizations ".to_string();
        settings.google_client_id = " 123-synthetic.apps.googleusercontent.com ".to_string();
        let accepted = validate_provider_settings(settings).unwrap();
        assert_eq!(accepted.microsoft_tenant, "organizations");
        assert_eq!(
            accepted.google_client_id,
            "123-synthetic.apps.googleusercontent.com"
        );
        let config = provider_config_from_settings("microsoft_outlook", &accepted).unwrap();
        assert_eq!(
            config.token_url,
            "https://login.microsoftonline.com/organizations/oauth2/v2.0/token"
        );
    }

    #[test]
    fn partial_mail_permissions_cannot_create_a_usable_connection() {
        let settings = test_settings();
        let google = provider_config_from_settings("google_gmail", &settings).unwrap();
        assert!(
            validate_granted_scopes(&google, "https://www.googleapis.com/auth/userinfo.email")
                .is_err()
        );
        assert!(validate_granted_scopes(&google, google.scopes).is_ok());
        let microsoft = provider_config_from_settings("microsoft_outlook", &settings).unwrap();
        assert!(validate_granted_scopes(&microsoft, "Mail.ReadWrite User.Read").is_err());
        assert!(validate_granted_scopes(&microsoft, "Mail.ReadWrite Mail.Send User.Read").is_ok());
        assert!(validate_granted_scopes(&microsoft, "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read").is_ok());
    }

    #[test]
    fn tokens_remain_bound_to_their_issuing_registration() {
        let config = provider_config_from_settings("microsoft_outlook", &test_settings()).unwrap();
        let mut bundle = TokenBundle {
            access_token: "synthetic-access-token".to_string(),
            refresh_token: None,
            expires_at: 0,
            scope: config.scopes.to_string(),
            email: None,
            provider: config.provider.to_string(),
            client_id: config.client_id.clone(),
            tenant: config.tenant.clone(),
        };
        assert!(token_matches_registration(&bundle, &config));
        bundle.tenant = "consumers".to_string();
        assert!(!token_matches_registration(&bundle, &config));
        bundle.tenant = config.tenant.clone();
        bundle.client_id.clear();
        assert!(!token_matches_registration(&bundle, &config));
    }

    #[test]
    fn provider_profiles_keep_the_first_nonempty_string_and_trim_it() {
        let profile = serde_json::json!({
            "email": "  first@example.invalid \n",
            "mail": "second@example.invalid",
            "userPrincipalName": "third@example.invalid",
            "name": "  First Operator \n",
            "displayName": "Second Operator"
        });
        assert_eq!(
            provider_profile(&profile).unwrap(),
            (
                "first@example.invalid".to_string(),
                Some("First Operator".to_string())
            )
        );
    }

    #[test]
    fn provider_profiles_skip_null_empty_and_wrong_type_fields() {
        for unusable in [
            serde_json::Value::Null,
            serde_json::json!(""),
            serde_json::json!(" \t\n "),
            serde_json::json!(false),
            serde_json::json!(42),
            serde_json::json!([]),
            serde_json::json!({ "address": "not-a-string@example.invalid" }),
        ] {
            let mut profile = serde_json::json!({
                "email": unusable,
                "mail": "  mailbox@example.invalid  ",
                "userPrincipalName": "  principal@example.invalid  ",
                "name": unusable,
                "displayName": "  Mailbox Operator  "
            });
            assert_eq!(
                provider_profile(&profile).unwrap(),
                (
                    "mailbox@example.invalid".to_string(),
                    Some("Mailbox Operator".to_string())
                )
            );
            profile["mail"] = unusable;
            assert_eq!(
                provider_profile(&profile).unwrap(),
                (
                    "principal@example.invalid".to_string(),
                    Some("Mailbox Operator".to_string())
                )
            );
        }
    }

    #[test]
    fn provider_profiles_reject_missing_email_but_allow_missing_display_name() {
        let profile = serde_json::json!({
            "email": " ", "mail": null, "userPrincipalName": false,
            "name": null, "displayName": " "
        });
        assert_eq!(
            provider_profile(&profile).unwrap_err(),
            "Provider profile did not return an email address"
        );
        assert_eq!(
            provider_profile(&serde_json::json!({ "mail": "operator@example.invalid" })).unwrap(),
            ("operator@example.invalid".to_string(), None)
        );
    }

    #[test]
    fn oauth_errors_distinguish_setup_consent_and_interactive_sign_in() {
        for (code, description, expected) in [
            ("access_denied", None, OAuthProviderError::AccessDenied),
            (
                "invalid_client",
                None,
                OAuthProviderError::InvalidRegistration,
            ),
            (
                "invalid_request",
                Some("AADSTS50194: synthetic private details"),
                OAuthProviderError::AccountTypeMismatch,
            ),
            (
                "access_denied",
                Some("AADSTS90094: synthetic private details"),
                OAuthProviderError::ConsentRequired,
            ),
            (
                "access_denied",
                Some("AADSTS65004: synthetic private details"),
                OAuthProviderError::AccessDenied,
            ),
            (
                "invalid_client",
                Some("AADSTS7000218: synthetic private details"),
                OAuthProviderError::InvalidRegistration,
            ),
            (
                "consent_required",
                None,
                OAuthProviderError::ConsentRequired,
            ),
            (
                "interaction_required",
                None,
                OAuthProviderError::InteractionRequired,
            ),
            (
                "login_required",
                None,
                OAuthProviderError::InteractionRequired,
            ),
            ("invalid_grant", None, OAuthProviderError::InvalidGrant),
        ] {
            let classified = oauth_provider_error("microsoft_outlook", Some(code), description);
            assert_eq!(classified, expected);
            assert!(classified.requires_reconnect());
            assert!(!classified.message().contains("synthetic private details"));
        }
        assert_eq!(
            oauth_provider_error(
                "google_gmail",
                Some("access_denied"),
                Some("AADSTS50194: synthetic")
            ),
            OAuthProviderError::AccessDenied
        );
    }

    #[test]
    fn unknown_oauth_errors_never_reflect_provider_values_or_descriptions() {
        for code in [
            "",
            "unexpected-synthetic-token",
            "<script>synthetic</script>",
            "access_denied\r\nsynthetic",
            "invalid_grant?code=synthetic",
        ] {
            let classified = oauth_provider_error(
                "microsoft_outlook",
                Some(code),
                Some("AADSTS501940000000: https://localhost/?code=synthetic-private-value"),
            );
            assert_eq!(classified, OAuthProviderError::Other);
            assert!(!classified.message().contains("synthetic"));
            assert!(classified.message().len() < 350);
            assert!(!classified.requires_reconnect());
        }
        for description in [
            "AADSTS50194extra: synthetic",
            "AADSTS: synthetic",
            "AADSTSéééé: synthetic",
        ] {
            assert_eq!(
                oauth_provider_error("microsoft_outlook", Some("unknown"), Some(description)),
                OAuthProviderError::Other
            );
        }
    }

    #[tokio::test]
    async fn connection_readback_uses_original_workspace_while_switch_is_queued() {
        use crate::db::runtime::DatabaseRuntime;

        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let runtime = DatabaseRuntime::open(
            root_path.join("control.db"),
            root_path.join("workspaces"),
            root_path.join("recovery"),
        )
        .await
        .unwrap();
        let first = DatabaseRuntime::create_workspace_pool(&root_path.join("first.db"))
            .await
            .unwrap();
        let second = DatabaseRuntime::create_workspace_pool(&root_path.join("second.db"))
            .await
            .unwrap();
        runtime
            .activate_workspace_pool("workspace-a".to_string(), first)
            .await;
        let token_guard = TOKEN_OPERATION_LOCK.lock().await;
        let lease = runtime.workspace_pool().await.unwrap();
        sqlx::query("INSERT INTO workspace_integrations (id, workspace_id, provider, label, external_id, external_name, token_expires_at) VALUES ('connected', 'workspace-a', 'microsoft_outlook', 'operator@example.invalid', 'operator@example.invalid', 'Operator', 123456)")
            .execute(&lease).await.unwrap();

        let switch = runtime.activate_workspace_pool("workspace-b".to_string(), second);
        tokio::pin!(switch);
        assert!(futures_util::poll!(switch.as_mut()).is_pending());
        let next_lease = runtime.workspace_pool();
        tokio::pin!(next_lease);
        assert!(futures_util::poll!(next_lease.as_mut()).is_pending());

        let connected = tokio::time::timeout(
            Duration::from_secs(1),
            read_email_connection(&lease, "connected"),
        )
        .await
        .expect("Readback must not request a second workspace lease")
        .unwrap();
        assert_eq!(connected.workspace_id, "workspace-a");
        assert_eq!(connected.status, "active");
        assert_eq!(connected.token_expires_at, Some(123456));
        assert_eq!(connected.external_name.as_deref(), Some("Operator"));
        assert!(connected.rfq_detection_enabled);

        sqlx::query("UPDATE workspace_integrations SET rfq_detection_enabled = 0, polling_interval = '30m' WHERE id = 'connected'")
            .execute(&lease).await.unwrap();
        let updated = tokio::time::timeout(
            Duration::from_secs(1),
            read_email_connection(&lease, "connected"),
        )
        .await
        .expect("Settings readback must stay on the original workspace lease")
        .unwrap();
        assert_eq!(updated.workspace_id, "workspace-a");
        assert!(!updated.rfq_detection_enabled);
        assert_eq!(updated.polling_interval, "30m");

        drop(lease);
        drop(token_guard);
        tokio::time::timeout(Duration::from_secs(1), switch)
            .await
            .expect("Workspace switch must complete after readback releases its lease");
        let next_lease = next_lease.await.unwrap();
        assert!(read_email_connection(&next_lease, "connected")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn terminal_refresh_failures_expire_only_the_selected_live_connection() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE workspace_integrations (id TEXT PRIMARY KEY, status TEXT NOT NULL, token_expires_at INTEGER, last_error TEXT, external_id TEXT, sync_cursor TEXT, rfq_detection_enabled INTEGER, polling_interval TEXT, updated_at TEXT)")
            .execute(&pool).await.unwrap();
        for (id, status) in [
            ("selected", "active"),
            ("other", "active"),
            ("disconnected", "revoked"),
        ] {
            sqlx::query("INSERT INTO workspace_integrations VALUES (?, ?, 123456, 'previous error', 'operator@example.invalid', 'opaque-cursor', 1, '30m', 'previous timestamp')")
                .bind(id).bind(status).execute(&pool).await.unwrap();
        }
        let before: Vec<(String, String, Option<i64>, String, String)> = sqlx::query_as(
            "SELECT id, status, token_expires_at, last_error, updated_at FROM workspace_integrations ORDER BY id",
        ).fetch_all(&pool).await.unwrap();
        for error in [
            OAuthProviderError::ProviderUnavailable,
            OAuthProviderError::InvalidResponse,
            OAuthProviderError::Other,
        ] {
            record_refresh_failure(&pool, "selected", error)
                .await
                .unwrap();
        }
        let after_transient: Vec<(String, String, Option<i64>, String, String)> = sqlx::query_as(
            "SELECT id, status, token_expires_at, last_error, updated_at FROM workspace_integrations ORDER BY id",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(after_transient, before);

        record_refresh_failure(&pool, "selected", OAuthProviderError::InvalidGrant)
            .await
            .unwrap();
        record_refresh_failure(&pool, "disconnected", OAuthProviderError::InvalidGrant)
            .await
            .unwrap();
        record_refresh_failure(&pool, "missing", OAuthProviderError::InvalidGrant)
            .await
            .unwrap();
        let selected: (String, Option<i64>, String, String, String, i64, String) = sqlx::query_as(
            "SELECT status, token_expires_at, last_error, external_id, sync_cursor, rfq_detection_enabled, polling_interval FROM workspace_integrations WHERE id = 'selected'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(
            selected,
            (
                "expired".to_string(),
                None,
                OAuthProviderError::InvalidGrant.message().to_string(),
                "operator@example.invalid".to_string(),
                "opaque-cursor".to_string(),
                1,
                "30m".to_string()
            )
        );
        let untouched: Vec<(String, String, Option<i64>, String, String)> = sqlx::query_as(
            "SELECT id, status, token_expires_at, last_error, updated_at FROM workspace_integrations WHERE id != 'selected' ORDER BY id",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(
            untouched,
            before
                .into_iter()
                .filter(|row| row.0 != "selected")
                .collect::<Vec<_>>()
        );
        pool.close().await;
    }

    #[test]
    fn oauth_query_parameters_are_percent_decoded() {
        assert_eq!(
            extract_query_param("code=abc%2Fdef%2Bghi&state=state-1", "code"),
            Some("abc/def+ghi".to_string())
        );
    }

    #[tokio::test]
    async fn cancelling_oauth_removes_session_and_notifies_listener() {
        let state = format!("test-{}", Uuid::new_v4());
        let (cancel_sender, mut cancel_receiver) = tokio::sync::watch::channel(false);
        oauth_sessions().lock().unwrap().insert(
            state.clone(),
            OAuthSession {
                provider: "google_gmail".to_string(),
                config: provider_config_from_settings("google_gmail", &test_settings()).unwrap(),
                workspace_id: "synthetic-workspace".to_string(),
                code_verifier: "verifier".to_string(),
                redirect_uri: "http://127.0.0.1:1".to_string(),
                created_at: Utc::now().timestamp(),
                callback_code: None,
                callback_error: None,
                completing: false,
                cancel_sender,
            },
        );

        cancel_integration_oauth(state.clone()).await.unwrap();
        cancel_receiver.changed().await.unwrap();

        assert!(*cancel_receiver.borrow());
        assert!(!oauth_sessions().lock().unwrap().contains_key(&state));
    }

    #[tokio::test]
    async fn cancellation_remains_observable_after_the_callback_listener_exits() {
        let state = format!("test-{}", Uuid::new_v4());
        let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
        drop(cancel_receiver);
        let session = OAuthSession {
            provider: "google_gmail".to_string(),
            config: provider_config_from_settings("google_gmail", &test_settings()).unwrap(),
            workspace_id: "synthetic-workspace".to_string(),
            code_verifier: "synthetic-verifier".to_string(),
            redirect_uri: "http://127.0.0.1:1".to_string(),
            created_at: Utc::now().timestamp(),
            callback_code: Some("synthetic-code".to_string()),
            callback_error: None,
            completing: true,
            cancel_sender,
        };
        oauth_sessions()
            .lock()
            .unwrap()
            .insert(state.clone(), session.clone());
        assert!(ensure_oauth_not_cancelled(&session).is_ok());
        cancel_integration_oauth(state).await.unwrap();
        assert!(ensure_oauth_not_cancelled(&session).is_err());
    }

    #[tokio::test]
    async fn fragmented_callback_request_lines_wait_for_state_and_error_completion() {
        for with_error in [false, true] {
            let state = format!("test-{}", Uuid::new_v4());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
            oauth_sessions().lock().unwrap().insert(
                state.clone(),
                OAuthSession {
                    provider: "google_gmail".to_string(),
                    config: provider_config_from_settings("google_gmail", &test_settings())
                        .unwrap(),
                    workspace_id: "synthetic-workspace".to_string(),
                    code_verifier: "synthetic-verifier".to_string(),
                    redirect_uri: format!("http://{address}"),
                    created_at: Utc::now().timestamp(),
                    callback_code: None,
                    callback_error: None,
                    completing: false,
                    cancel_sender,
                },
            );
            let task = tokio::spawn(spawn_callback_listener(
                state.clone(),
                listener,
                cancel_receiver,
            ));
            let (first, rest) = if with_error {
                (
                    format!("GET /?state={state}&code=synthetic-code"),
                    "&error=access_denied HTTP/1.1\r\n\r\n".to_string(),
                )
            } else {
                (
                    format!("GET /?state={}", &state[..8]),
                    format!("{}&code=synthetic-code HTTP/1.1\r\n\r\n", &state[8..]),
                )
            };
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream.write_all(first.as_bytes()).await.unwrap();
            let mut response_byte = [0u8; 1];
            assert!(
                tokio::time::timeout(Duration::from_millis(50), stream.read(&mut response_byte))
                    .await
                    .is_err(),
                "An incomplete request line must not receive or finalize a callback"
            );
            {
                let sessions = oauth_sessions().lock().unwrap();
                let session = sessions.get(&state).unwrap();
                assert!(session.callback_code.is_none());
                assert!(session.callback_error.is_none());
            }
            stream.write_all(rest.as_bytes()).await.unwrap();
            let mut response = Vec::new();
            tokio::time::timeout(Duration::from_secs(1), stream.read_to_end(&mut response))
                .await
                .unwrap()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap();
            assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
            let session = oauth_sessions().lock().unwrap().remove(&state).unwrap();
            if with_error {
                assert_eq!(
                    session.callback_error,
                    Some(OAuthProviderError::AccessDenied)
                );
                assert!(session.callback_code.is_none());
            } else {
                assert!(session.callback_error.is_none());
                assert_eq!(session.callback_code.as_deref(), Some("synthetic-code"));
            }
        }
    }

    #[tokio::test]
    async fn unrelated_loopback_request_does_not_consume_the_oauth_callback() {
        let state = format!("test-{}", Uuid::new_v4());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
        oauth_sessions().lock().unwrap().insert(
            state.clone(),
            OAuthSession {
                provider: "google_gmail".to_string(),
                config: provider_config_from_settings("google_gmail", &test_settings()).unwrap(),
                workspace_id: "synthetic-workspace".to_string(),
                code_verifier: "synthetic-verifier".to_string(),
                redirect_uri: format!("http://{address}"),
                created_at: Utc::now().timestamp(),
                callback_code: None,
                callback_error: None,
                completing: false,
                cancel_sender,
            },
        );
        let task = tokio::spawn(spawn_callback_listener(
            state.clone(),
            listener,
            cancel_receiver,
        ));
        let mut invalid = tokio::net::TcpStream::connect(address).await.unwrap();
        invalid
            .write_all(b"GET /?state=wrong&code=synthetic HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        invalid.read_to_end(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 400"));
        assert!(oauth_sessions()
            .lock()
            .unwrap()
            .get(&state)
            .unwrap()
            .callback_code
            .is_none());
        let mut valid = tokio::net::TcpStream::connect(address).await.unwrap();
        valid
            .write_all(format!("GET /?state={state}&code=synthetic HTTP/1.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        response.clear();
        valid.read_to_end(&mut response).await.unwrap();
        task.await.unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
        assert_eq!(
            oauth_sessions()
                .lock()
                .unwrap()
                .remove(&state)
                .unwrap()
                .callback_code
                .as_deref(),
            Some("synthetic")
        );
    }

    #[tokio::test]
    async fn callback_errors_require_matching_state_and_never_retain_private_values() {
        let state = format!("test-{}", Uuid::new_v4());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
        oauth_sessions().lock().unwrap().insert(
            state.clone(),
            OAuthSession {
                provider: "microsoft_outlook".to_string(),
                config: provider_config_from_settings("microsoft_outlook", &test_settings())
                    .unwrap(),
                workspace_id: "synthetic-workspace".to_string(),
                code_verifier: "synthetic-verifier".to_string(),
                redirect_uri: format!("http://localhost:{}", address.port()),
                created_at: Utc::now().timestamp(),
                callback_code: None,
                callback_error: None,
                completing: false,
                cancel_sender,
            },
        );
        let task = tokio::spawn(spawn_callback_listener(
            state.clone(),
            listener,
            cancel_receiver,
        ));
        let mut response = Vec::new();
        let mut invalid = tokio::net::TcpStream::connect(address).await.unwrap();
        invalid
            .write_all(b"GET /?state=wrong&error=access_denied HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), invalid.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 400"));
        assert!(oauth_sessions()
            .lock()
            .unwrap()
            .get(&state)
            .unwrap()
            .callback_error
            .is_none());

        let description = urlencode(
            "AADSTS50194: synthetic-private-account https://localhost/?code=synthetic-private-code",
        );
        let mut valid = tokio::net::TcpStream::connect(address).await.unwrap();
        valid.write_all(format!("GET /?state={state}&error=invalid_request&code=synthetic-private-code&error_description={description} HTTP/1.1\r\n\r\n").as_bytes()).await.unwrap();
        response.clear();
        tokio::time::timeout(Duration::from_secs(5), valid.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        task.await.unwrap();
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.contains("Authorization failed"));
        assert!(!response.contains("synthetic-private"));
        assert!(!response.contains("invalid_request"));
        let session = oauth_sessions().lock().unwrap().remove(&state).unwrap();
        assert_eq!(
            session.callback_error,
            Some(OAuthProviderError::AccountTypeMismatch)
        );
        assert!(session.callback_code.is_none());
    }

    #[tokio::test]
    async fn refresh_classifies_terminal_errors_without_replaying_or_retiring_on_outages() {
        for (status, error, expected) in [
            (
                "400 Bad Request",
                "invalid_grant",
                OAuthProviderError::InvalidGrant,
            ),
            (
                "400 Bad Request",
                "interaction_required",
                OAuthProviderError::InteractionRequired,
            ),
            (
                "503 Service Unavailable",
                "invalid_grant",
                OAuthProviderError::ProviderUnavailable,
            ),
            (
                "429 Too Many Requests",
                "invalid_grant",
                OAuthProviderError::ProviderUnavailable,
            ),
            (
                "400 Bad Request",
                "unexpected-synthetic-private-token",
                OAuthProviderError::Other,
            ),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let body = serde_json::json!({
                "error": error, "error_description": "synthetic-private-account-and-token"
            })
            .to_string();
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 4096];
                stream.read(&mut request).await.unwrap();
                let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
                // This listener permits one token request; production does not retry it.
            });
            let mut config =
                provider_config_from_settings("microsoft_outlook", &test_settings()).unwrap();
            config.token_url = format!("http://{address}");
            let bundle = TokenBundle {
                access_token: "synthetic-access".to_string(),
                refresh_token: Some("synthetic-refresh".to_string()),
                expires_at: 0,
                scope: config.scopes.to_string(),
                email: None,
                provider: config.provider.to_string(),
                client_id: config.client_id.clone(),
                tenant: config.tenant.clone(),
            };
            let classified = refresh_token(&config, &bundle).await.err().unwrap();
            task.await.unwrap();
            assert_eq!(classified, expected);
            assert!(!classified.message().contains("synthetic-private"));
        }
    }
}
