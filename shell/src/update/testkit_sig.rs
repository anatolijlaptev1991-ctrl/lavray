// SPDX-License-Identifier: GPL-3.0-only

//! Подставка проверки подписи для тестов установки.

use super::error::ApplyError;
use super::ports::{SignatureVerifier, SignedFacts};
use super::testkit::Log;
use std::cell::RefCell;
use std::path::{Path, PathBuf};

/// Подставка проверки подписи: отвечает заданным результатом и помнит вызовы
/// (путь установщика, путь подписи, `allow_older`).
pub struct FakeSignature {
    pub result: Result<SignedFacts, ApplyError>,
    pub log: Option<Log>,
    pub calls: RefCell<Vec<(PathBuf, PathBuf, bool)>>,
}

impl FakeSignature {
    pub fn ok(version: &str, sha256: &str, log: Option<Log>) -> Self {
        Self::answering(
            Ok(SignedFacts {
                version: version.to_string(),
                sha256: sha256.to_string(),
            }),
            log,
        )
    }

    pub fn answering(result: Result<SignedFacts, ApplyError>, log: Option<Log>) -> Self {
        Self {
            result,
            log,
            calls: RefCell::default(),
        }
    }
}

impl SignatureVerifier for FakeSignature {
    fn verify(
        &self,
        installer: &Path,
        signature: &Path,
        allow_older: bool,
    ) -> Result<SignedFacts, ApplyError> {
        if let Some(log) = &self.log {
            log.push("signature.verify");
        }
        self.calls.borrow_mut().push((
            installer.to_path_buf(),
            signature.to_path_buf(),
            allow_older,
        ));
        self.result.clone()
    }
}
