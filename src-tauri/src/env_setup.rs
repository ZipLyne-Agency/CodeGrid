//! PATH resolution for GUI-launched app bundles.
//!
//! On macOS, an app launched from Finder/Dock inherits the minimal launchd
//! PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) — not the user's shell PATH. So
//! Homebrew (`/opt/homebrew/bin`), `~/.local/bin`, and Node version managers
//! (nvm/fnm/asdf/volta/mise) are invisible, and `which::which("node")` /
//! `which::which("claude")` fail even though the tools are installed. That is
//! what produces the "Node.js not found" / "agent not installed" onboarding
//! errors for users who installed via Homebrew or a version manager.
//!
//! [`apply`] resolves the real user PATH once at startup and writes it onto the
//! process environment, so every later `which::which` call and child-process
//! spawn (PTY shells included) inherits it.

/// Build the augmented PATH: the user's login-shell PATH (best effort) plus a
/// set of known-good install locations, de-duplicated and order-preserving.
pub fn resolve_user_path() -> String {
    let mut sources: Vec<String> = Vec::new();

    // 1) Ask the user's login+interactive shell for its PATH. This is the only
    //    way to capture version-manager shims (nvm, fnm, asdf, mise, volta) and
    //    any custom rc setup that a hardcoded list can't know about. Unix only —
    //    Windows GUI apps already inherit the user PATH.
    #[cfg(unix)]
    if let Some(shell_path) = probe_login_shell_path() {
        sources.push(shell_path);
    }

    // 2) Known-good fallbacks, in case the shell probe was unavailable or
    //    missed something (e.g. the app was launched outside any shell). These
    //    install locations are unix-specific; on Windows we rely on the
    //    inherited PATH below.
    #[cfg(unix)]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            sources.push(format!("{home}/.local/bin"));
            sources.push(format!("{home}/.nvm/versions/node/default/bin"));
            sources.push(format!("{home}/.fnm/aliases/default/bin"));
            sources.push(format!("{home}/.cargo/bin"));
            sources.push(format!("{home}/.bun/bin"));
            // Grok installs here and isn't on PATH during onboarding.
            sources.push(format!("{home}/.grok/bin"));
        }
        if let Ok(fnm) = std::env::var("FNM_MULTISHELL_PATH") {
            sources.push(format!("{fnm}/bin"));
        }
        // Homebrew (Apple Silicon and Intel) and the classic /usr/local.
        sources.push("/opt/homebrew/bin".to_string());
        sources.push("/opt/homebrew/sbin".to_string());
        sources.push("/usr/local/bin".to_string());
    }

    // 3) Whatever PATH we already had (the launchd minimal set on macOS;
    //    the full user PATH on Windows).
    if let Ok(sys) = std::env::var("PATH") {
        sources.push(sys);
    }

    dedup_path(&sources)
}

/// Platform PATH separator: `:` on unix, `;` on Windows.
const SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Resolve the user PATH and write it onto this process's environment.
/// Returns the value that was set. Call once, early in startup.
pub fn apply() -> String {
    let path = resolve_user_path();
    std::env::set_var("PATH", &path);
    path
}

/// Run the user's `$SHELL` as a login+interactive shell and capture its `$PATH`.
/// Best effort: returns `None` if `$SHELL` is unset or the probe fails.
#[cfg(unix)]
fn probe_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    // `-ilc` = interactive + login, so both profile (.zprofile/.bash_profile)
    // and rc (.zshrc/.bashrc) files run — version managers live in either.
    //
    // We read PATH from `env` rather than echoing `$PATH` directly: `env`'s
    // `PATH=` line is always colon-joined regardless of shell, which sidesteps
    // fish (where `$PATH` is a space-separated list). Take the LAST `PATH=`
    // line so any banner/notice an rc file prints can't shadow the real one.
    let raw = run_with_timeout(&shell, "command env", std::time::Duration::from_secs(5))?;
    let path = raw
        .lines()
        .filter_map(|l| l.strip_prefix("PATH="))
        .next_back()?
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Spawn `<shell> -ilc <script>` and return its stdout, killing it if it does
/// not finish within `timeout` (an rc file that blocks on input must not stall
/// app startup). Returns `None` on spawn failure, non-zero exit, or timeout.
#[cfg(unix)]
fn run_with_timeout(shell: &str, script: &str, timeout: std::time::Duration) -> Option<String> {
    use std::sync::mpsc;
    let mut child = std::process::Command::new(shell)
        .args(["-ilc", script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    // Wait for completion on a side thread so the main thread can time out.
    let (tx, rx) = mpsc::channel();
    let mut taken = child.stdout.take();
    let waiter = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        if let Some(mut out) = taken.take() {
            let _ = out.read_to_string(&mut buf);
        }
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(buf) => {
            let _ = child.wait();
            let _ = waiter.join();
            Some(buf)
        }
        Err(_) => {
            // Timed out: kill the shell and give up on the probe.
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// Flatten separator-joined entries, drop empties, de-duplicate while
/// preserving first-seen order, and re-join with the platform separator.
fn dedup_path(sources: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for entry in sources.iter().flat_map(|s| s.split(SEP)) {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        if seen.insert(entry) {
            out.push(entry);
        }
    }
    out.join(&SEP.to_string())
}

#[cfg(test)]
mod tests {
    use super::dedup_path;

    #[test]
    fn dedups_and_preserves_order() {
        let got = dedup_path(&[
            "/opt/homebrew/bin:/usr/bin".to_string(),
            "/usr/bin:/bin".to_string(),
            "  ".to_string(),
            "/opt/homebrew/bin".to_string(),
        ]);
        assert_eq!(got, "/opt/homebrew/bin:/usr/bin:/bin");
    }
}
