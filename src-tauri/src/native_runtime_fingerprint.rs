use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

pub fn fingerprint_native_runtime(root: &Path) -> io::Result<String> {
    let mut inputs = vec![PathBuf::from("native/litert_lm_bridge_litert.cc")];
    for (directory, extensions) in [
        ("native", &["h"][..]),
        ("native-runtime", &["a", "dylib", "dll", "lib"][..]),
    ] {
        for entry in fs::read_dir(root.join(directory))? {
            let path = entry?.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extensions.contains(&extension))
            {
                inputs.push(Path::new(directory).join(path.file_name().unwrap()));
            }
        }
    }
    inputs.sort();

    let mut fingerprint = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    for input in inputs {
        let name = input
            .to_str()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Non-UTF-8 native filename"))?
            .replace('\\', "/");
        let mut file = fs::File::open(root.join(&input))?;
        let mut content = Sha256::new();
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            content.update(&buffer[..read]);
        }
        // Length-framed names and fixed-size content digests prevent ambiguous joins.
        fingerprint.update((name.len() as u64).to_be_bytes());
        fingerprint.update(name.as_bytes());
        fingerprint.update(content.finalize());
    }
    Ok(format!("{:x}", fingerprint.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(reverse: bool) -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("native")).unwrap();
        fs::create_dir(root.path().join("native-runtime")).unwrap();
        let mut files = vec![
            ("native/engine.h", b"engine ABI".as_slice()),
            ("native/conversation.h", b"conversation ABI".as_slice()),
            ("native/litert_lm_bridge.h", b"bridge ABI".as_slice()),
            (
                "native/litert_lm_bridge_litert.cc",
                b"bridge source".as_slice(),
            ),
            ("native-runtime/litert_lm_c.dll", b"runtime".as_slice()),
            ("native-runtime/provider.dll", b"provider".as_slice()),
            (
                "native-runtime/litert_lm_c.lib",
                b"import library".as_slice(),
            ),
        ];
        if reverse {
            files.reverse();
        }
        for (name, content) in files {
            fs::write(root.path().join(name), content).unwrap();
        }
        root
    }

    #[test]
    fn native_identity_is_independent_of_location_order_and_receipt_metadata() {
        let first = stage(false);
        let second = stage(true);
        fs::write(
            second.path().join("native-runtime/receipt.json"),
            b"different",
        )
        .unwrap();
        fs::write(second.path().join("native/README.md"), b"different").unwrap();
        assert_eq!(
            fingerprint_native_runtime(first.path()).unwrap(),
            fingerprint_native_runtime(second.path()).unwrap()
        );
    }

    #[test]
    fn native_identity_changes_for_bridge_headers_and_every_staged_library() {
        let root = stage(false);
        let original = fingerprint_native_runtime(root.path()).unwrap();
        for directory in ["native", "native-runtime"] {
            for entry in fs::read_dir(root.path().join(directory)).unwrap() {
                let path = entry.unwrap().path();
                let content = fs::read(&path).unwrap();
                fs::write(&path, b"changed implementation").unwrap();
                assert_ne!(fingerprint_native_runtime(root.path()).unwrap(), original);
                fs::write(&path, content).unwrap();
            }
        }
        let provider = root.path().join("native-runtime/provider.dll");
        fs::rename(
            provider,
            root.path().join("native-runtime/new-provider.dll"),
        )
        .unwrap();
        assert_ne!(fingerprint_native_runtime(root.path()).unwrap(), original);
    }

    #[test]
    fn native_identity_hashes_the_entire_binary_and_rejects_missing_bridge() {
        let root = stage(false);
        let library = root.path().join("native-runtime/litert_lm_c.dll");
        let mut bytes = vec![0_u8; 200_000];
        fs::write(&library, &bytes).unwrap();
        let original = fingerprint_native_runtime(root.path()).unwrap();
        *bytes.last_mut().unwrap() = 1;
        fs::write(&library, bytes).unwrap();
        assert_ne!(fingerprint_native_runtime(root.path()).unwrap(), original);
        fs::remove_file(root.path().join("native/litert_lm_bridge_litert.cc")).unwrap();
        assert!(fingerprint_native_runtime(root.path()).is_err());
    }
}
