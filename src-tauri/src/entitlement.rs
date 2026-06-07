//! Premium entitlement storage.
//!
//! Stores the short-lived, EdDSA-signed entitlement JWT minted by the
//! grid-verifier Worker in the OS keychain (macOS Keychain via the `keyring`
//! crate). The token is a *bearer of a claim*, not a secret key — but it still
//! belongs in the keychain rather than plaintext on disk.
//!
//! The frontend is responsible for verifying the JWT signature + expiry
//! (offline, against the bundled Ed25519 public key) before trusting it. This
//! module only persists and retrieves the opaque string.

use keyring::Entry;

const SERVICE: &str = "app.codegrid.entitlement";
const ACCOUNT: &str = "premium-jwt";

/// Ed25519 public key (the `x` of the JWK bundled in src/lib/entitlement.ts).
/// Rust-side twin of the frontend's offline verification — used to gate
/// non-bypassable backend features (voice) without trusting the webview.
const ENTITLEMENT_PUBKEY_B64URL: &str = "nI2-PrApCZn-BNEqhlXPoMXUI5Bw5ht81gi70ypBakU";
const JWT_ISSUER: &str = "https://codegrid.app";
const JWT_AUDIENCE: &str = "codegrid-desktop";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain entry: {e}"))
}

/// Persist the entitlement JWT to the keychain.
#[tauri::command]
pub fn store_entitlement(token: String) -> Result<(), String> {
    entry()?
        .set_password(&token)
        .map_err(|e| format!("keychain store: {e}"))
}

/// Read the entitlement JWT, or `None` if not present.
#[tauri::command]
pub fn get_entitlement() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read: {e}")),
    }
}

/// Remove the stored entitlement (sign-out / wallet switch).
#[tauri::command]
pub fn clear_entitlement() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain clear: {e}")),
    }
}

/// Verify the stored entitlement JWT (EdDSA signature, issuer, audience,
/// expiry) entirely in Rust and return its tier. `0` when no/invalid token.
///
/// This is the non-bypassable twin of the frontend's `verifyEntitlementToken`,
/// for backend-gated features that mustn't trust webview state. Currently
/// unused (voice went BYOK-for-everyone) but kept for the next Pro feature
/// that needs a Rust-side gate.
#[allow(dead_code)]
pub fn verified_tier() -> Result<u8, String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let Some(token) = get_entitlement()? else {
        return Ok(0);
    };

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Ok(0);
    }

    let decode = |s: &str| B64.decode(s).map_err(|e| format!("jwt b64: {e}"));

    // Header must actually be EdDSA — reject alg confusion outright.
    let header: serde_json::Value =
        serde_json::from_slice(&decode(parts[0])?).map_err(|e| format!("jwt header: {e}"))?;
    if header.get("alg").and_then(|v| v.as_str()) != Some("EdDSA") {
        return Ok(0);
    }

    // Signature over "header.payload" against the bundled public key.
    let key_bytes: [u8; 32] = decode(ENTITLEMENT_PUBKEY_B64URL)?
        .try_into()
        .map_err(|_| "entitlement pubkey is not 32 bytes".to_string())?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("pubkey: {e}"))?;
    let sig_bytes = decode(parts[2])?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|e| format!("jwt sig: {e}"))?;
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    if key.verify(signing_input.as_bytes(), &sig).is_err() {
        return Ok(0);
    }

    let payload: serde_json::Value =
        serde_json::from_slice(&decode(parts[1])?).map_err(|e| format!("jwt payload: {e}"))?;

    // Claims: issuer, audience (string or array), expiry.
    if payload.get("iss").and_then(|v| v.as_str()) != Some(JWT_ISSUER) {
        return Ok(0);
    }
    let aud_ok = match payload.get("aud") {
        Some(serde_json::Value::String(s)) => s == JWT_AUDIENCE,
        Some(serde_json::Value::Array(a)) => a.iter().any(|v| v.as_str() == Some(JWT_AUDIENCE)),
        _ => false,
    };
    if !aud_ok {
        return Ok(0);
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("clock: {e}"))?
        .as_secs();
    if payload.get("exp").and_then(|v| v.as_u64()).unwrap_or(0) <= now {
        return Ok(0);
    }

    Ok(payload.get("tier").and_then(|v| v.as_u64()).unwrap_or(0) as u8)
}
