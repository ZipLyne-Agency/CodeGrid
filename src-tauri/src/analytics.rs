//! Coding analytics — derived entirely from the agent CLIs' own local logs.
//!
//! CodeGrid stores nothing about token usage itself; the data lives in the logs
//! Claude Code and Codex already write to disk:
//! - Claude Code: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
//!   one append-only line per turn; assistant lines carry `message.model`
//!   and `message.usage.{input,output,cache_creation_input,cache_read_input}`
//!   plus `timestamp`, `cwd`, `gitBranch`.
//! - Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//!   a `session_meta` line (cwd, model_provider, timestamp) and cumulative
//!   `token_count` events (take the LAST). Cumulative — never summed.
//!
//! This reads those files locally and aggregates them. Nothing leaves the
//! machine. A small JSON cache (keyed by path + mtime + size) makes re-scans of
//! the multi-GB log dir near-instant after the first pass.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;

const CACHE_VERSION: u32 = 1;
const SECS_PER_DAY: i64 = 86_400;

// ---------------------------------------------------------------------------
// Wire types (snake_case, mirrored in src/lib/ipc.ts).
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Serialize, Clone)]
pub struct TokenTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub est_cost_usd: f64,
    pub sessions: u64,
    pub assistant_turns: u64,
    pub active_days: u64,
    pub first_activity: Option<String>,
    pub last_activity: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DayBucket {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
    pub est_cost_usd: f64,
    pub sessions: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelBucket {
    pub model: String,
    pub total_tokens: u64,
    pub est_cost_usd: f64,
    pub sessions: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectBucket {
    pub project: String,
    pub name: String,
    pub total_tokens: u64,
    pub est_cost_usd: f64,
    pub sessions: u64,
    pub last_active: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ToolBucket {
    pub tool: String,
    pub total_tokens: u64,
    pub est_cost_usd: f64,
    pub sessions: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct CodingAnalytics {
    pub range_days: i64,
    pub totals: TokenTotals,
    pub by_day: Vec<DayBucket>,
    pub by_model: Vec<ModelBucket>,
    pub by_project: Vec<ProjectBucket>,
    pub by_tool: Vec<ToolBucket>,
    /// True when some usage (e.g. Codex / unknown models) has no price table entry.
    pub cost_partial: bool,
    pub cost_note: String,
}

// ---------------------------------------------------------------------------
// Cache types (persisted to ~/.config/codegrid/analytics-cache.json).
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Bucket {
    date: String,
    model: String,
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileEntry {
    mtime_ns: u128,
    size: u64,
    tool: String, // "claude" | "codex"
    cwd: String,
    first_ts: i64,
    last_ts: i64,
    turns: u64,
    buckets: Vec<Bucket>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct CacheFile {
    version: u32,
    files: HashMap<String, FileEntry>,
}

// ---------------------------------------------------------------------------
// Pricing — USD per token (per-1M public rates / 1e6). Matched by model id.
// Cost is computed for Claude models; unknown providers (e.g. Codex/openai)
// contribute 0 and flip `cost_partial`.
// ---------------------------------------------------------------------------

struct Price {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

fn price_for(model: &str) -> Option<Price> {
    let m = model.to_lowercase();
    if m.contains("opus") {
        Some(Price {
            input: 15.0,
            output: 75.0,
            cache_write: 18.75,
            cache_read: 1.5,
        })
    } else if m.contains("sonnet") {
        Some(Price {
            input: 3.0,
            output: 15.0,
            cache_write: 3.75,
            cache_read: 0.30,
        })
    } else if m.contains("haiku") {
        Some(Price {
            input: 0.80,
            output: 4.0,
            cache_write: 1.0,
            cache_read: 0.08,
        })
    } else {
        None
    }
}

fn bucket_cost(b: &Bucket) -> (f64, bool) {
    match price_for(&b.model) {
        Some(p) => (
            (b.input as f64 * p.input
                + b.output as f64 * p.output
                + b.cache_creation as f64 * p.cache_write
                + b.cache_read as f64 * p.cache_read)
                / 1_000_000.0,
            false,
        ),
        None => (
            0.0,
            b.input + b.output + b.cache_creation + b.cache_read > 0,
        ),
    }
}

fn bucket_total(b: &Bucket) -> u64 {
    b.input + b.output + b.cache_creation + b.cache_read
}

// ---------------------------------------------------------------------------
// Timestamp helpers.
// ---------------------------------------------------------------------------

/// Parse an RFC3339 timestamp → (unix_seconds, "YYYY-MM-DD" UTC).
fn parse_ts(s: &str) -> Option<(i64, String)> {
    let dt = chrono::DateTime::parse_from_rfc3339(s).ok()?;
    let utc = dt.with_timezone(&chrono::Utc);
    Some((utc.timestamp(), utc.format("%Y-%m-%d").to_string()))
}

// ---------------------------------------------------------------------------
// Parsers.
// ---------------------------------------------------------------------------

fn parse_claude_file(path: &PathBuf) -> Option<FileEntry> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut cwd = String::new();
    let mut first_ts = i64::MAX;
    let mut last_ts = 0_i64;
    let mut turns = 0_u64;
    // key: (date, model)
    let mut acc: HashMap<(String, String), Bucket> = HashMap::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let msg = match v.get("message") {
            Some(m) => m,
            None => continue,
        };
        let usage = match msg.get("usage") {
            Some(u) => u,
            None => continue,
        };
        let model = msg
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string();
        let input = usage
            .get("input_tokens")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let output = usage
            .get("output_tokens")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);

        if input + output + cache_creation + cache_read == 0 {
            continue;
        }

        if cwd.is_empty() {
            if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
                cwd = c.to_string();
            }
        }

        let (ts, date) = match v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_ts)
        {
            Some(x) => x,
            None => continue,
        };
        first_ts = first_ts.min(ts);
        last_ts = last_ts.max(ts);
        turns += 1;

        let b = acc.entry((date.clone(), model.clone())).or_insert(Bucket {
            date,
            model,
            input: 0,
            output: 0,
            cache_creation: 0,
            cache_read: 0,
        });
        b.input += input;
        b.output += output;
        b.cache_creation += cache_creation;
        b.cache_read += cache_read;
    }

    if turns == 0 {
        return None;
    }

    Some(FileEntry {
        mtime_ns: 0, // filled by caller
        size: 0,     // filled by caller
        tool: "claude".to_string(),
        cwd,
        first_ts: if first_ts == i64::MAX { 0 } else { first_ts },
        last_ts,
        turns,
        buckets: acc.into_values().collect(),
    })
}

fn parse_codex_file(path: &PathBuf) -> Option<FileEntry> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut cwd = String::new();
    let mut provider = String::from("openai");
    let mut start_ts = 0_i64;
    let mut start_date = String::new();
    // Codex stamps a top-level `timestamp` on every line; track the last event's
    // so range-filtering (last_ts) and day-bucketing reflect real activity, not
    // just the session start.
    let mut last_ts = 0_i64;
    let mut last_date = String::new();
    let mut turns = 0_u64;
    // Codex token_count is CUMULATIVE — keep only the last seen totals.
    let mut last_input = 0_u64;
    let mut last_cached = 0_u64;
    let mut last_output = 0_u64;
    let mut last_reasoning = 0_u64;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let payload = v.get("payload");

        // Every line carries a top-level timestamp — advance last-activity.
        if let Some((ts, d)) = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_ts)
        {
            if ts >= last_ts {
                last_ts = ts;
                last_date = d;
            }
        }

        if ty == "session_meta" {
            if let Some(p) = payload {
                if let Some(c) = p.get("cwd").and_then(|c| c.as_str()) {
                    cwd = c.to_string();
                }
                if let Some(pv) = p.get("model_provider").and_then(|c| c.as_str()) {
                    provider = pv.to_string();
                }
                if let Some((ts, d)) = p
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(parse_ts)
                {
                    start_ts = ts;
                    start_date = d;
                }
            }
        } else if ty == "event_msg" {
            if let Some(p) = payload {
                if p.get("type").and_then(|t| t.as_str()) == Some("token_count") {
                    if let Some(u) = p.get("info").and_then(|i| i.get("total_token_usage")) {
                        last_input = u
                            .get("input_tokens")
                            .and_then(|n| n.as_u64())
                            .unwrap_or(last_input);
                        last_cached = u
                            .get("cached_input_tokens")
                            .and_then(|n| n.as_u64())
                            .unwrap_or(last_cached);
                        last_output = u
                            .get("output_tokens")
                            .and_then(|n| n.as_u64())
                            .unwrap_or(last_output);
                        last_reasoning = u
                            .get("reasoning_output_tokens")
                            .and_then(|n| n.as_u64())
                            .unwrap_or(last_reasoning);
                        turns += 1;
                    }
                }
            }
        }
    }

    // Bucket the cumulative totals on the last-activity day (fallback to start).
    let bucket_date = if !last_date.is_empty() {
        last_date
    } else {
        start_date.clone()
    };
    let first_ts = if start_ts > 0 { start_ts } else { last_ts };
    let last_ts = if last_ts > 0 { last_ts } else { start_ts };

    if bucket_date.is_empty() || (last_input + last_output) == 0 {
        return None;
    }

    // Map OpenAI buckets → our four. input_tokens includes cached; split them.
    let non_cached_input = last_input.saturating_sub(last_cached);
    let output = last_output + last_reasoning;

    let bucket = Bucket {
        date: bucket_date,
        model: format!("Codex · {provider}"),
        input: non_cached_input,
        output,
        cache_creation: 0,
        cache_read: last_cached,
    };

    Some(FileEntry {
        mtime_ns: 0,
        size: 0,
        tool: "codex".to_string(),
        cwd,
        first_ts,
        last_ts,
        turns,
        buckets: vec![bucket],
    })
}

// ---------------------------------------------------------------------------
// Cache load/save.
// ---------------------------------------------------------------------------

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

fn cache_path() -> PathBuf {
    let base = home()
        .map(|h| h.join(".config").join("codegrid"))
        .unwrap_or_else(|| PathBuf::from("/tmp/codegrid"));
    base.join("analytics-cache.json")
}

fn load_cache() -> CacheFile {
    let path = cache_path();
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => {
            return CacheFile {
                version: CACHE_VERSION,
                files: HashMap::new(),
            }
        }
    };
    match serde_json::from_str::<CacheFile>(&data) {
        Ok(c) if c.version == CACHE_VERSION => c,
        _ => CacheFile {
            version: CACHE_VERSION,
            files: HashMap::new(),
        },
    }
}

fn save_cache(cache: &CacheFile) {
    let path = cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(cache) {
        let _ = std::fs::write(&path, json);
    }
}

// ---------------------------------------------------------------------------
// Scan + aggregate.
// ---------------------------------------------------------------------------

fn file_stat(path: &PathBuf) -> Option<(u128, u64, i64)> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = meta.modified().ok()?;
    let dur = mtime.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some((dur.as_nanos(), size, dur.as_secs() as i64))
}

/// Core (sync) — walk logs, refresh the cache, aggregate within `range_days`
/// (<= 0 means all-time). Pure so it can be unit-tested off the Tauri runtime.
pub fn compute_analytics(range_days: i64) -> Result<CodingAnalytics, String> {
    let home = home().ok_or_else(|| "HOME not set".to_string())?;
    let now = chrono::Utc::now().timestamp();
    let cutoff = if range_days > 0 {
        now - range_days * SECS_PER_DAY
    } else {
        0
    };

    let mut cache = load_cache();
    let mut dirty = false;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Discover candidate log files from both CLIs.
    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    let claude_root = home.join(".claude").join("projects");
    if claude_root.is_dir() {
        for e in WalkDir::new(&claude_root)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = e.path();
            if p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("jsonl") {
                candidates.push((p.to_path_buf(), "claude"));
            }
        }
    }
    let codex_root = home.join(".codex").join("sessions");
    if codex_root.is_dir() {
        for e in WalkDir::new(&codex_root).into_iter().filter_map(|e| e.ok()) {
            let p = e.path();
            let name = p.file_name().and_then(|x| x.to_str()).unwrap_or("");
            if p.is_file() && name.starts_with("rollout-") && name.ends_with(".jsonl") {
                candidates.push((p.to_path_buf(), "codex"));
            }
        }
    }

    for (path, tool) in candidates {
        let key = path.to_string_lossy().to_string();
        let (mtime_ns, size, mtime_secs) = match file_stat(&path) {
            Some(s) => s,
            None => continue,
        };
        seen.insert(key.clone());

        // Reuse cached parse when the file is unchanged.
        let cached_fresh = cache
            .files
            .get(&key)
            .map(|e| e.mtime_ns == mtime_ns && e.size == size)
            .unwrap_or(false);
        if cached_fresh {
            continue;
        }

        // For bounded ranges, skip parsing files clearly older than the window
        // (a 2-day grace covers sessions that straddle the cutoff).
        if range_days > 0 && mtime_secs < cutoff - 2 * SECS_PER_DAY {
            continue;
        }

        let parsed = if tool == "claude" {
            parse_claude_file(&path)
        } else {
            parse_codex_file(&path)
        };
        if let Some(mut entry) = parsed {
            entry.mtime_ns = mtime_ns;
            entry.size = size;
            cache.files.insert(key, entry);
            dirty = true;
        }
    }

    // Prune entries for files that no longer exist.
    let before = cache.files.len();
    cache
        .files
        .retain(|k, _| seen.contains(k) || std::path::Path::new(k).exists());
    if cache.files.len() != before {
        dirty = true;
    }

    if dirty {
        save_cache(&cache);
    }

    Ok(aggregate(&cache, range_days, cutoff))
}

fn aggregate(cache: &CacheFile, range_days: i64, cutoff: i64) -> CodingAnalytics {
    let mut totals = TokenTotals::default();
    let mut day_map: HashMap<String, DayBucket> = HashMap::new();
    let mut model_map: HashMap<String, ModelBucket> = HashMap::new();
    let mut project_map: HashMap<String, ProjectBucket> = HashMap::new();
    let mut tool_map: HashMap<String, ToolBucket> = HashMap::new();
    let mut active_days: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cost_partial = false;
    let mut first_ts = i64::MAX;
    let mut last_ts = 0_i64;

    for entry in cache.files.values() {
        let mut entry_tokens = 0_u64;
        let mut entry_cost = 0.0_f64;
        let mut any_in_window = false;
        let mut counted_day_for_session = false;
        let mut models_this_session: std::collections::HashSet<&str> =
            std::collections::HashSet::new();

        for b in &entry.buckets {
            let tokens = bucket_total(b);
            if tokens == 0 {
                continue;
            }
            // ONE window rule for every aggregate: a bucket counts iff its day is
            // in range. This keeps totals == sum(by_day) == sum(by_model) == … .
            if range_days > 0 && !day_in_range(&b.date, cutoff) {
                continue;
            }
            any_in_window = true;
            let (cost, partial) = bucket_cost(b);
            cost_partial = cost_partial || partial;

            entry_tokens += tokens;
            entry_cost += cost;

            // Totals
            totals.input_tokens += b.input;
            totals.output_tokens += b.output;
            totals.cache_creation_tokens += b.cache_creation;
            totals.cache_read_tokens += b.cache_read;
            totals.est_cost_usd += cost;

            active_days.insert(b.date.clone());

            // By day
            let d = day_map.entry(b.date.clone()).or_insert(DayBucket {
                date: b.date.clone(),
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                total_tokens: 0,
                est_cost_usd: 0.0,
                sessions: 0,
            });
            d.input_tokens += b.input;
            d.output_tokens += b.output;
            d.cache_read_tokens += b.cache_read;
            d.cache_creation_tokens += b.cache_creation;
            d.total_tokens += tokens;
            d.est_cost_usd += cost;
            if !counted_day_for_session {
                d.sessions += 1;
                counted_day_for_session = true;
            }

            // By model
            let m = model_map.entry(b.model.clone()).or_insert(ModelBucket {
                model: b.model.clone(),
                total_tokens: 0,
                est_cost_usd: 0.0,
                sessions: 0,
            });
            m.total_tokens += tokens;
            m.est_cost_usd += cost;
            models_this_session.insert(b.model.as_str());
        }

        if !any_in_window || entry_tokens == 0 {
            continue;
        }

        totals.total_tokens += entry_tokens;
        totals.sessions += 1;
        totals.assistant_turns += entry.turns;
        first_ts = first_ts.min(entry.first_ts);
        last_ts = last_ts.max(entry.last_ts);

        // By model session counts (one per session that used the model in-window)
        for model in models_this_session {
            if let Some(mb) = model_map.get_mut(model) {
                mb.sessions += 1;
            }
        }

        // By project
        let project = if entry.cwd.is_empty() {
            "(unknown)".to_string()
        } else {
            entry.cwd.clone()
        };
        let name = project.rsplit('/').next().unwrap_or(&project).to_string();
        let last_active = ts_to_date(entry.last_ts);
        let pb = project_map.entry(project.clone()).or_insert(ProjectBucket {
            project: project.clone(),
            name,
            total_tokens: 0,
            est_cost_usd: 0.0,
            sessions: 0,
            last_active: None,
        });
        pb.total_tokens += entry_tokens;
        pb.est_cost_usd += entry_cost;
        pb.sessions += 1;
        match (&pb.last_active, &last_active) {
            (None, Some(_)) => pb.last_active = last_active.clone(),
            (Some(a), Some(b)) if b > a => pb.last_active = last_active.clone(),
            _ => {}
        }

        // By tool
        let tb = tool_map.entry(entry.tool.clone()).or_insert(ToolBucket {
            tool: entry.tool.clone(),
            total_tokens: 0,
            est_cost_usd: 0.0,
            sessions: 0,
        });
        tb.total_tokens += entry_tokens;
        tb.est_cost_usd += entry_cost;
        tb.sessions += 1;
    }

    totals.active_days = active_days.len() as u64;
    totals.first_activity = if first_ts == i64::MAX {
        None
    } else {
        ts_to_date(first_ts)
    };
    totals.last_activity = ts_to_date(last_ts);

    let mut by_day: Vec<DayBucket> = day_map.into_values().collect();
    by_day.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_model: Vec<ModelBucket> = model_map.into_values().collect();
    by_model.sort_by_key(|item| std::cmp::Reverse(item.total_tokens));

    let mut by_project: Vec<ProjectBucket> = project_map.into_values().collect();
    by_project.sort_by_key(|item| std::cmp::Reverse(item.total_tokens));

    let mut by_tool: Vec<ToolBucket> = tool_map.into_values().collect();
    by_tool.sort_by_key(|item| std::cmp::Reverse(item.total_tokens));

    let cost_note = if cost_partial {
        "Equivalent metered API price at public rates — not what Pro/Max subscription users pay. Cache reads dominate token volume (cheap or free on a subscription). Codex/other usage shows tokens only."
            .to_string()
    } else {
        "Equivalent metered API price at public rates — not what Pro/Max subscription users pay. Cache reads dominate token volume and are far cheaper, or free on a subscription."
            .to_string()
    };

    CodingAnalytics {
        range_days,
        totals,
        by_day,
        by_model,
        by_project,
        by_tool,
        cost_partial,
        cost_note,
    }
}

fn day_in_range(date: &str, cutoff: i64) -> bool {
    // date is YYYY-MM-DD (UTC midnight). Keep the day if its END is >= cutoff.
    match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => {
            let end = d
                .and_hms_opt(23, 59, 59)
                .unwrap_or_default()
                .and_utc()
                .timestamp();
            end >= cutoff
        }
        Err(_) => true,
    }
}

fn ts_to_date(ts: i64) -> Option<String> {
    if ts <= 0 {
        return None;
    }
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.format("%Y-%m-%d").to_string())
}

/// Tauri command — runs the (blocking) scan off the async runtime.
#[tauri::command]
pub async fn get_coding_analytics(range_days: Option<i64>) -> Result<CodingAnalytics, String> {
    let days = range_days.unwrap_or(30);
    tokio::task::spawn_blocking(move || compute_analytics(days))
        .await
        .map_err(|e| format!("analytics task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_against_real_logs_without_error() {
        // Runs against the developer's real ~/.claude / ~/.codex logs. It must
        // never panic and totals must be internally consistent.
        let a = compute_analytics(90).expect("analytics should compute");
        let sum_models: u64 = a.by_model.iter().map(|m| m.total_tokens).sum();
        assert_eq!(
            sum_models, a.totals.total_tokens,
            "by_model token sum must equal totals.total_tokens"
        );
        let sum_tools: u64 = a.by_tool.iter().map(|t| t.total_tokens).sum();
        assert_eq!(
            sum_tools, a.totals.total_tokens,
            "by_tool sum must equal totals"
        );
        let sum_projects: u64 = a.by_project.iter().map(|p| p.total_tokens).sum();
        assert_eq!(
            sum_projects, a.totals.total_tokens,
            "by_project sum must equal totals"
        );
        let sum_days: u64 = a.by_day.iter().map(|d| d.total_tokens).sum();
        assert_eq!(
            sum_days, a.totals.total_tokens,
            "by_day sum must equal totals (chart == headline)"
        );
        eprintln!(
            "analytics(90d): {} sessions, {} tokens, ${:.2}, {} models, {} projects",
            a.totals.sessions,
            a.totals.total_tokens,
            a.totals.est_cost_usd,
            a.by_model.len(),
            a.by_project.len()
        );
    }
}
