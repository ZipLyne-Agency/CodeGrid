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
