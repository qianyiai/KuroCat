//! Daily typing statistics.
//!
//! Counts non-repeat, non-password key presses received by the native hook.
//! The local day index and UTC offset are supplied by the webview (JS has
//! reliable local-time APIs); this keeps the module dependency-free.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::app_data_dir;

const DAY_SECS: i64 = 86_400;
const SAVE_INTERVAL_MS: u64 = 10_000;
const SAVE_EVERY_PRESSES: u64 = 25;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KeyStats {
    /// Local-calendar day index (days since Unix epoch, local time).
    pub day: i64,
    /// `Date.prototype.getTimezoneOffset()` minutes, cached to keep rollover correct.
    pub tz_offset_minutes: i64,
    pub total: u64,
}

impl Default for KeyStats {
    fn default() -> Self {
        Self {
            day: 0,
            tz_offset_minutes: 0,
            total: 0,
        }
    }
}

static STATE: OnceLock<Mutex<KeyStats>> = OnceLock::new();
static LAST_SAVE_MS: AtomicU64 = AtomicU64::new(0);

fn stats_path() -> PathBuf {
    app_data_dir().join("stats.json")
}

fn load() -> KeyStats {
    fs::read_to_string(stats_path())
        .ok()
        .and_then(|text| serde_json::from_str::<KeyStats>(&text).ok())
        .unwrap_or_default()
}

fn state() -> &'static Mutex<KeyStats> {
    STATE.get_or_init(|| Mutex::new(load()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn local_day_at(now_ms: u64, offset_minutes: i64) -> i64 {
    ((now_ms / 1000) as i64 - offset_minutes * 60).div_euclid(DAY_SECS)
}

fn local_day(offset_minutes: i64) -> i64 {
    local_day_at(now_ms(), offset_minutes)
}

fn persist(stats: &KeyStats) {
    let path = stats_path();
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(stats) else {
        return;
    };
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    if fs::write(&temp, json).and_then(|()| fs::rename(&temp, &path)).is_err() {
        let _ = fs::remove_file(temp);
    }
}

/// Called once per real (non-repeat, non-password) key press from the input hook.
pub fn record_key_press() {
    let Ok(mut stats) = state().lock() else {
        return;
    };
    let today = local_day(stats.tz_offset_minutes);
    if stats.day != today {
        stats.day = today;
        stats.total = 0;
    }
    stats.total = stats.total.saturating_add(1);

    let now = now_ms();
    let last = LAST_SAVE_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) >= SAVE_INTERVAL_MS || stats.total % SAVE_EVERY_PRESSES == 0 {
        persist(&stats);
        LAST_SAVE_MS.store(now, Ordering::Relaxed);
    }
}

/// Syncs the webview's local day/offset and returns the current stats.
pub fn get_stats(day: i64, tz_offset_minutes: i64) -> KeyStats {
    let Ok(mut stats) = state().lock() else {
        return KeyStats::default();
    };
    stats.tz_offset_minutes = tz_offset_minutes;
    if stats.day != day {
        stats.day = day;
        stats.total = 0;
    }
    persist(&stats);
    LAST_SAVE_MS.store(now_ms(), Ordering::Relaxed);
    stats.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_day_matches_js_wall_clock_day() {
        // Epoch day 1000, 00:30 UTC.
        let now = 1000 * DAY_SECS as u64 * 1000 + 30 * 60 * 1000;
        // UTC+8 (JS offset -480): local 08:30, still day 1000.
        assert_eq!(local_day_at(now, -480), 1000);
        // UTC-10 (JS offset +600): local 14:30 of the previous day.
        assert_eq!(local_day_at(now, 600), 999);
        // Exactly local midnight belongs to the new day.
        let midnight = 1000 * DAY_SECS as u64 * 1000;
        assert_eq!(local_day_at(midnight, 0), 1000);
        assert_eq!(local_day_at(midnight - 1, 0), 999);
    }

    #[test]
    fn default_stats_are_empty() {
        let stats = KeyStats::default();
        assert_eq!(stats.total, 0);
        assert_eq!(stats.day, 0);
    }
}
