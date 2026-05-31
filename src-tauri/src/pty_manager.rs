use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Bounded PTY output channel capacity (chunks). Bounding gives natural
/// backpressure — a chatty CLI that outruns the consumer pauses at the PTY
/// instead of growing memory without limit across many concurrent sessions.
const OUTPUT_CHANNEL_CAP: usize = 2048;

/// Per-session rolling output buffer cap (bytes). Retains the tail of each
/// pane's output so the agent-bus can let one agent read another's pane.
const OUTPUT_BUFFER_CAP: usize = 64 * 1024;

type OutputBuffers = Arc<Mutex<HashMap<String, VecDeque<u8>>>>;

/// Grace period between SIGTERM and SIGKILL when terminating a session's
/// process group, so well-behaved children can flush and exit cleanly.
const TERM_GRACE_MS: u64 = 120;

pub struct PtyInstance {
    pub master: Box<dyn MasterPty + Send>,
    /// Writer is behind its own lock so writes never hold the instances map
    /// lock during blocking IO (one stuck PTY must not freeze every session).
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Box<dyn portable_pty::Child + Send>,
    /// OS process id of the session leader. Because portable_pty makes the
    /// child a session leader, this is also the process-group id, so we can
    /// signal the whole group (the agent plus any dev servers it spawned).
    pub pid: Option<u32>,
}

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
    /// Rolling tail of each session's output, for the agent-bus `read_pane`.
    output_buffers: OutputBuffers,
}

fn lock_instances(
    instances: &Mutex<HashMap<String, PtyInstance>>,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtyInstance>>, String> {
    instances
        .lock()
        .map_err(|_| "Internal error: PTY manager lock poisoned".to_string())
}

/// Terminate a session's entire process group (graceful SIGTERM, then SIGKILL)
/// and reap the leader. Killing the group prevents orphaned grandchildren —
/// dev servers, build watchers, and tools the agent launched.
fn terminate_instance(instance: &mut PtyInstance) {
    #[cfg(unix)]
    {
        if let Some(pid) = instance.pid {
            let pgid = pid as i32;
            unsafe {
                // Negative pid targets the whole process group.
                libc::kill(-pgid, libc::SIGTERM);
            }
            std::thread::sleep(std::time::Duration::from_millis(TERM_GRACE_MS));
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        }
    }
    // Always kill+reap the direct child (covers non-unix and the leader itself).
    let _ = instance.child.kill();
    let _ = instance.child.wait();
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            output_buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Read the tail (up to `max_bytes`) of a session's buffered output.
    pub fn read_output(&self, session_id: &str, max_bytes: usize) -> Option<Vec<u8>> {
        let buffers = self.output_buffers.lock().ok()?;
        let buf = buffers.get(session_id)?;
        let start = buf.len().saturating_sub(max_bytes);
        Some(buf.iter().skip(start).copied().collect())
    }

    pub fn spawn_session(
        &self,
        session_id: &str,
        working_dir: &str,
        command: &str,
        args: &[String],
        cols: u16,
        rows: u16,
    ) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let mut cmd = CommandBuilder::new(command);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(working_dir);

        // Inherit environment
        #[cfg(unix)]
        {
            cmd.env("TERM", "xterm-256color");
            cmd.env("COLORTERM", "truecolor");
            cmd.env("FORCE_COLOR", "1");
            if let Ok(home) = std::env::var("HOME") {
                cmd.env("HOME", &home);
            }
            // Inherit the augmented PATH that env_setup::apply() resolved at
            // startup (Homebrew, ~/.local/bin, version managers). It's already
            // on the process env, so no need to re-probe the shell per spawn.
            if let Ok(path) = std::env::var("PATH") {
                cmd.env("PATH", path);
            }
            if let Ok(shell) = std::env::var("SHELL") {
                cmd.env("SHELL", &shell);
            }
            if let Ok(user) = std::env::var("USER") {
                cmd.env("USER", &user);
            }
            if let Ok(lang) = std::env::var("LANG") {
                cmd.env("LANG", &lang);
            }
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {e}"))?;

        let pid = child.process_id();

        // If any post-spawn setup fails, kill+reap the child we just started
        // so a spawn error never leaks a running process.
        let writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to get PTY writer: {e}"));
            }
        };

        let reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to clone PTY reader: {e}"));
            }
        };

        // Bounded output channel — backpressure instead of unbounded growth.
        let (tx, rx) = mpsc::channel::<Vec<u8>>(OUTPUT_CHANNEL_CAP);

        let sid = session_id.to_string();
        let mut reader = reader;
        let buffers = self.output_buffers.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Retain the tail for the agent-bus read_pane.
                        if let Ok(mut map) = buffers.lock() {
                            let entry = map.entry(sid.clone()).or_default();
                            entry.extend(buf[..n].iter().copied());
                            while entry.len() > OUTPUT_BUFFER_CAP {
                                entry.pop_front();
                            }
                        }
                        // blocking_send applies backpressure: if the consumer is
                        // behind, this thread blocks, which flow-controls the PTY.
                        if tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        // EIO is expected when PTY child exits on Unix.
                        // On macOS this surfaces as ErrorKind::Other with raw_os_error 5 (EIO).
                        // Only log unexpected errors.
                        let is_eio = e.raw_os_error() == Some(5); // libc::EIO
                        if !is_eio {
                            eprintln!("PTY read error for session {}: {} (kind={:?}, os_error={:?})", sid, e, e.kind(), e.raw_os_error());
                        }
                        break;
                    }
                }
            }
        });

        let instance = PtyInstance {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            pid,
        };

        lock_instances(&self.instances)?
            .insert(session_id.to_string(), instance);

        Ok(rx)
    }

    pub fn write_to_pty(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        // Clone the writer handle out under the map lock, then release the map
        // lock before doing blocking IO so a slow/stuck PTY can't block writes,
        // resizes, or kills for every other session.
        let writer = {
            let instances = lock_instances(&self.instances)?;
            match instances.get(session_id) {
                Some(instance) => instance.writer.clone(),
                None => return Err(format!("Session {session_id} not found")),
            }
        };
        let mut writer = writer
            .lock()
            .map_err(|_| "Internal error: PTY writer lock poisoned".to_string())?;
        writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {e}"))?;
        Ok(())
    }

    pub fn resize_pty(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let instances = lock_instances(&self.instances)?;
        if let Some(instance) = instances.get(session_id) {
            instance
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {e}"))?;
            Ok(())
        } else {
            Err(format!("Session {session_id} not found"))
        }
    }

    pub fn kill_session(&self, session_id: &str) -> Result<(), String> {
        // Remove from the map under the lock, then terminate OUTSIDE the lock so
        // a slow kill/reap never freezes operations on other sessions.
        let removed = {
            let mut instances = lock_instances(&self.instances)?;
            instances.remove(session_id)
        };
        if let Ok(mut bufs) = self.output_buffers.lock() {
            bufs.remove(session_id);
        }
        match removed {
            Some(mut instance) => {
                terminate_instance(&mut instance);
                Ok(())
            }
            None => Err(format!("Session {session_id} not found")),
        }
    }

    pub fn remove_session(&self, session_id: &str) -> Result<(), String> {
        let removed = {
            let mut instances = lock_instances(&self.instances)?;
            instances.remove(session_id)
        };
        if let Ok(mut bufs) = self.output_buffers.lock() {
            bufs.remove(session_id);
        }
        if let Some(mut instance) = removed {
            let _ = instance.child.wait();
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_alive(&self, session_id: &str) -> bool {
        let Ok(mut instances) = lock_instances(&self.instances) else {
            return false;
        };
        if let Some(instance) = instances.get_mut(session_id) {
            match instance.child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) | Err(_) => false,
            }
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub fn session_count(&self) -> usize {
        lock_instances(&self.instances).map(|i| i.len()).unwrap_or(0)
    }

    /// Kill all PTY sessions. Called on app exit to prevent orphaned processes.
    /// SIGTERM every group first, wait one grace period, then SIGKILL+reap —
    /// so shutdown is bounded regardless of session count.
    pub fn kill_all(&self) {
        if let Ok(mut bufs) = self.output_buffers.lock() {
            bufs.clear();
        }
        let mut drained: Vec<(String, PtyInstance)> = {
            match self.instances.lock() {
                Ok(mut instances) => instances.drain().collect(),
                Err(_) => return,
            }
        };
        if drained.is_empty() {
            return;
        }

        #[cfg(unix)]
        {
            for (sid, instance) in &drained {
                eprintln!("[CodeGrid] Killing PTY session {sid} on shutdown");
                if let Some(pid) = instance.pid {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGTERM);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(TERM_GRACE_MS));
            for (_, instance) in &drained {
                if let Some(pid) = instance.pid {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
            }
        }

        for (_, instance) in drained.iter_mut() {
            let _ = instance.child.kill();
            let _ = instance.child.wait();
        }
    }

    /// Returns the list of active session IDs (for diagnostics).
    #[allow(dead_code)]
    pub fn active_session_ids(&self) -> Vec<String> {
        lock_instances(&self.instances)
            .map(|i| i.keys().cloned().collect())
            .unwrap_or_default()
    }
}

/// Safety net: kill all child processes if `PtyManager` is dropped without
/// an explicit `kill_all` call (e.g. during a panic unwind).
impl Drop for PtyManager {
    fn drop(&mut self) {
        self.kill_all();
    }
}
