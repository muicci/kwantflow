//! Device-local credentials. Never include this storage in workspace exports.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Native credential storage lock is unavailable.".to_string())
}

fn remove_legacy_file(directory: &Path) -> Result<(), String> {
    // Retired credentials were base64 JSON and cannot be reused with a new OAuth
    // registration. Remove them without decoding or migrating any secret.
    match fs::remove_file(directory.join("secure_store.json")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Remove retired plaintext credentials: {error}")),
    }
}

pub(crate) fn discard_legacy_credentials(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = lock_store()?;
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    remove_legacy_file(&directory)?;
    platform::delete(&directory, "com.kwantflow.desktop.hosted-auth", "primary")
}

pub(crate) fn get_generic_password(
    app: &tauri::AppHandle,
    service: &str,
    account: &str,
) -> Result<Option<Vec<u8>>, String> {
    let _guard = lock_store()?;
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    remove_legacy_file(&directory)?;
    platform::get(&directory, service, account)
}

pub(crate) fn set_generic_password(
    app: &tauri::AppHandle,
    service: &str,
    account: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let _guard = lock_store()?;
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    remove_legacy_file(&directory)?;
    platform::set(&directory, service, account, bytes)
}

pub(crate) fn delete_generic_password(
    app: &tauri::AppHandle,
    service: &str,
    account: &str,
) -> Result<(), String> {
    let _guard = lock_store()?;
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    remove_legacy_file(&directory)?;
    platform::delete(&directory, service, account)
}

#[cfg(target_os = "macos")]
mod platform {
    use security_framework::passwords;
    use std::path::Path;
    const ITEM_NOT_FOUND: i32 = -25300;

    pub(super) fn get(_: &Path, service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        match passwords::get_generic_password(service, account) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(format!("Read macOS Keychain credential: {error}")),
        }
    }

    pub(super) fn set(_: &Path, service: &str, account: &str, bytes: &[u8]) -> Result<(), String> {
        passwords::set_generic_password(service, account, bytes)
            .map_err(|error| format!("Store macOS Keychain credential: {error}"))
    }

    pub(super) fn delete(_: &Path, service: &str, account: &str) -> Result<(), String> {
        match passwords::delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(format!("Delete macOS Keychain credential: {error}")),
        }
    }
}

#[cfg(windows)]
mod platform {
    use fs2::FileExt;
    use serde::{Deserialize, Serialize};
    use std::collections::HashMap;
    use std::fs::{self, File, OpenOptions};
    use std::io::{ErrorKind, Write};
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    #[derive(Default, Serialize, Deserialize)]
    struct Credentials {
        credentials: HashMap<String, HashMap<String, Vec<u8>>>,
    }

    fn file_lock(directory: &Path) -> Result<File, String> {
        fs::create_dir_all(directory).map_err(|e| format!("Create credential directory: {e}"))?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("credentials.lock"))
            .map_err(|e| format!("Open credential lock: {e}"))?;
        FileExt::lock_exclusive(&file).map_err(|e| format!("Lock credential storage: {e}"))?;
        Ok(file)
    }

    fn crypt(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(bytes.len()).map_err(|_| "Credential data is too large.")?,
            pbData: bytes.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // No LOCAL_MACHINE flag: protection belongs to the current Windows user.
        // No prompt or plaintext fallback is permitted.
        let result = unsafe {
            if encrypt {
                CryptProtectData(
                    &input,
                    PCWSTR::null(),
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    None,
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        };
        result.map_err(|e| format!("Windows credential protection failed: {e}"))?;
        let data = if output.cbData == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec()
        };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        }
        Ok(data)
    }

    fn read(directory: &Path) -> Result<Credentials, String> {
        let encrypted = match fs::read(directory.join("credentials.dpapi")) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Credentials::default()),
            Err(e) => return Err(format!("Read protected credentials: {e}")),
        };
        let bytes = crypt(&encrypted, false)?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Read protected credential data: {e}"))
    }

    fn write(directory: &Path, data: &Credentials) -> Result<(), String> {
        let bytes = serde_json::to_vec(data).map_err(|e| format!("Encode credentials: {e}"))?;
        let encrypted = crypt(&bytes, true)?;
        let mut temporary = tempfile::NamedTempFile::new_in(directory)
            .map_err(|e| format!("Create protected credential file: {e}"))?;
        temporary
            .write_all(&encrypted)
            .map_err(|e| format!("Write protected credentials: {e}"))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|e| format!("Sync protected credentials: {e}"))?;
        temporary
            .persist(directory.join("credentials.dpapi"))
            .map_err(|e| format!("Replace protected credentials: {}", e.error))?;
        Ok(())
    }

    pub(super) fn get(
        directory: &Path,
        service: &str,
        account: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let _file_lock = file_lock(directory)?;
        Ok(read(directory)?
            .credentials
            .get(service)
            .and_then(|items| items.get(account))
            .cloned())
    }

    pub(super) fn set(
        directory: &Path,
        service: &str,
        account: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        let _file_lock = file_lock(directory)?;
        let mut data = read(directory)?;
        data.credentials
            .entry(service.to_string())
            .or_default()
            .insert(account.to_string(), bytes.to_vec());
        write(directory, &data)
    }

    pub(super) fn delete(directory: &Path, service: &str, account: &str) -> Result<(), String> {
        let _file_lock = file_lock(directory)?;
        let mut data = read(directory)?;
        let changed = data
            .credentials
            .get_mut(service)
            .and_then(|items| items.remove(account))
            .is_some();
        if changed {
            write(directory, &data)?;
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use std::path::Path;
    pub(super) fn get(_: &Path, _: &str, _: &str) -> Result<Option<Vec<u8>>, String> {
        Err("Native credential storage requires macOS or Windows.".to_string())
    }
    pub(super) fn set(_: &Path, _: &str, _: &str, _: &[u8]) -> Result<(), String> {
        Err("Native credential storage requires macOS or Windows.".to_string())
    }
    pub(super) fn delete(_: &Path, _: &str, _: &str) -> Result<(), String> {
        Err("Native credential storage requires macOS or Windows.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retires_plaintext_credentials_without_reading_or_migrating_them() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("secure_store.json");
        fs::write(&path, b"synthetic retired credential file").unwrap();
        remove_legacy_file(directory.path()).unwrap();
        assert!(!path.exists());
        remove_legacy_file(directory.path()).unwrap();
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    #[ignore = "Uses the current user's native credential store with synthetic data only"]
    fn native_credentials_roundtrip_update_and_delete() {
        let directory = tempfile::tempdir().unwrap();
        let service = format!("com.kwantflow.test.{}", uuid::Uuid::new_v4());
        let account = "synthetic";
        let payload = vec![b'x'; 8192];
        assert!(platform::get(directory.path(), &service, account)
            .unwrap()
            .is_none());
        struct TestCredentialCleanup<'a> {
            directory: &'a Path,
            service: &'a str,
            account: &'a str,
        }
        impl Drop for TestCredentialCleanup<'_> {
            fn drop(&mut self) {
                if let Err(error) = platform::delete(self.directory, self.service, self.account) {
                    eprintln!("Synthetic credential cleanup failed: {error}");
                }
            }
        }
        let _cleanup = TestCredentialCleanup {
            directory: directory.path(),
            service: &service,
            account,
        };
        platform::set(directory.path(), &service, account, &payload).unwrap();
        assert_eq!(
            platform::get(directory.path(), &service, account).unwrap(),
            Some(payload)
        );
        #[cfg(windows)]
        {
            let path = directory.path().join("credentials.dpapi");
            let protected = fs::read(&path).unwrap();
            assert!(!protected
                .windows(service.len())
                .any(|part| part == service.as_bytes()));
            assert!(!protected.windows(128).any(|part| part == vec![b'x'; 128]));
            fs::write(&path, b"synthetic corrupt protected data").unwrap();
            assert!(platform::get(directory.path(), &service, account).is_err());
            fs::write(&path, protected).unwrap();
        }
        platform::set(
            directory.path(),
            &service,
            account,
            b"updated synthetic payload",
        )
        .unwrap();
        assert_eq!(
            platform::get(directory.path(), &service, account).unwrap(),
            Some(b"updated synthetic payload".to_vec())
        );
        platform::delete(directory.path(), &service, account).unwrap();
        assert!(platform::get(directory.path(), &service, account)
            .unwrap()
            .is_none());
        platform::delete(directory.path(), &service, account).unwrap();
    }
}
