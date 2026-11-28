use chrono::{Local, NaiveDate};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DailyKeyCount {
    pub date: NaiveDate,
    pub count: u64,
    pub revision: u64,
}

pub const EVENT: &str = "kuro-daily-key-count";

pub struct DailyKeyStats {
    path: PathBuf,
    counter: Mutex<DailyCounter>,
}

impl DailyKeyStats {
    pub fn load(path: PathBuf) -> Self {
        Self::load_for_date(path, local_date())
    }

    fn load_for_date(path: PathBuf, date: NaiveDate) -> Self {
        let counts = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, counter: Mutex::new(DailyCounter::new(date, counts)) }
    }

    pub fn refresh(&self) -> (DailyKeyCount, bool) {
        let mut counter = self.counter.lock().unwrap();
        let changed = counter.refresh(local_date());
        match changed {
            Some(snapshot) => (snapshot, true),
            None => (counter.snapshot(), false),
        }
    }

    pub fn record(&self) -> Option<(Option<DailyKeyCount>, DailyKeyCount)> {
        let mut counter = self.counter.lock().unwrap();
        if counter.finished {
            return None;
        }
        let rollover = counter.refresh(local_date());
        Some((rollover, counter.record()))
    }

    pub fn clear_today(&self, confirmed_date: NaiveDate) -> io::Result<DailyKeyCount> {
        self.clear_on(confirmed_date, local_date)
    }

    fn clear_on(
        &self,
        confirmed_date: NaiveDate,
        resolve_local_date: impl FnOnce() -> NaiveDate,
    ) -> io::Result<DailyKeyCount> {
        let mut counter = self.counter.lock().unwrap();
        let today = resolve_local_date();
        if confirmed_date != today {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "The local date changed. Confirm today's count again.",
            ));
        }
        if counter.finished {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "KuroCat is shutting down."));
        }

        let mut counts = counter.counts.clone();
        counts.insert(today, 0);
        crate::config::write_json_atomically(&self.path, &counts)?;
        counter.counts = counts;
        counter.date = today;
        counter.revision += 1;
        counter.dirty = false;
        Ok(counter.snapshot())
    }

    pub fn flush(&self) -> io::Result<()> {
        let mut counter = self.counter.lock().unwrap();
        self.flush_counter(&mut counter)
    }

    pub fn finish(&self) -> io::Result<()> {
        let mut counter = self.counter.lock().unwrap();
        counter.finished = true;
        self.flush_counter(&mut counter)
    }

    fn flush_counter(&self, counter: &mut DailyCounter) -> io::Result<()> {
        if counter.dirty {
            crate::config::write_json_atomically(&self.path, &counter.counts)?;
            counter.dirty = false;
        }
        Ok(())
    }
}

fn local_date() -> NaiveDate {
    Local::now().date_naive()
}

struct DailyCounter {
    date: NaiveDate,
    counts: BTreeMap<NaiveDate, u64>,
    revision: u64,
    dirty: bool,
    finished: bool,
}

impl DailyCounter {
    fn new(date: NaiveDate, counts: BTreeMap<NaiveDate, u64>) -> Self {
        Self { date, counts, revision: 0, dirty: false, finished: false }
    }

    fn snapshot(&self) -> DailyKeyCount {
        DailyKeyCount {
            date: self.date,
            count: self.counts.get(&self.date).copied().unwrap_or_default(),
            revision: self.revision,
        }
    }

    fn refresh(&mut self, date: NaiveDate) -> Option<DailyKeyCount> {
        if date == self.date {
            return None;
        }
        self.date = date;
        self.revision += 1;
        Some(self.snapshot())
    }

    fn record(&mut self) -> DailyKeyCount {
        let count = self.counts.entry(self.date).or_default();
        *count = count.saturating_add(1);
        self.revision += 1;
        self.dirty = true;
        self.snapshot()
    }
}

pub fn is_printable_key(vk: u32) -> bool {
    matches!(vk,
        0x20 | 0x30..=0x39 | 0x41..=0x5A | 0x60..=0x6F
        | 0x92 | 0xBA..=0xC0 | 0xDB..=0xDF | 0xE2
    )
}

#[cfg(any(not(windows), test))]
pub fn has_typing_shortcut_modifier(pressed: &[bool; 512]) -> bool {
    [0x11, 0x12, 0x5B, 0x5C, 0xA2, 0xA3, 0xA4]
        .iter()
        .any(|&key| pressed[key])
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Default)]
pub struct WindowsTypingModifiers {
    physical_left_control: bool,
    synthesized_left_control: bool,
}

#[cfg(any(windows, test))]
impl WindowsTypingModifiers {
    pub fn observe(&mut self, vk: u32, scan: u32, down: bool, left_control_down: bool) {
        if vk == 0xA2 {
            // WH_KEYBOARD_LL reports the AltGr companion Ctrl with scancode 0x021D.
            if scan == 0x021D {
                if down && !self.synthesized_left_control {
                    self.physical_left_control = left_control_down;
                }
                self.synthesized_left_control = down;
            } else {
                self.physical_left_control = down;
            }
        } else if vk == 0xA5 && !down {
            self.synthesized_left_control = false;
        }
    }

    pub fn permits_typing(self, left_control_down: bool, right_alt_down: bool) -> bool {
        if self.synthesized_left_control && right_alt_down {
            !self.physical_left_control
        } else {
            !left_control_down && !right_alt_down
        }
    }
}

#[cfg(any(target_os = "linux", test))]
pub fn count_x11_press(last_release: &mut Option<u32>, time: u32, synthetic: bool) -> bool {
    let repeat = last_release.take() == Some(time);
    !repeat && !synthetic
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, day).unwrap()
    }

    fn scratch_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "kurocat-daily-key-count-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ))
    }

    #[test]
    fn counts_printable_keys_and_leaves_navigation_out() {
        for key in [0x20, 0x31, 0x41, 0x60, 0x6E, 0xBA, 0xE2] {
            assert!(is_printable_key(key), "{key:#x}");
        }
        for key in [0x08, 0x09, 0x0D, 0x25, 0x70, 0xA0, 0xE7, 0x10D] {
            assert!(!is_printable_key(key), "{key:#x}");
        }
    }

    #[test]
    fn excludes_shortcuts_but_allows_shift_and_alt_graph() {
        let mut held = [false; 512];
        for modifier in [0x11, 0x12, 0x5B, 0x5C, 0xA2, 0xA3, 0xA4] {
            held[modifier] = true;
            assert!(has_typing_shortcut_modifier(&held), "{modifier:#x}");
            held[modifier] = false;
        }
        held[0xA0] = true;
        assert!(!has_typing_shortcut_modifier(&held));
        held[0xA5] = true;
        assert!(!has_typing_shortcut_modifier(&held));
    }

    #[test]
    fn windows_excludes_a_physical_left_control_and_right_alt_chord() {
        let mut modifiers = WindowsTypingModifiers::default();
        modifiers.observe(0xA2, 0x001D, true, false);
        assert!(!modifiers.permits_typing(true, true));
        modifiers.observe(0xA2, 0x001D, false, true);
        assert!(!modifiers.permits_typing(false, true));
    }

    #[test]
    fn windows_allows_altgr_only_without_a_physical_left_control() {
        let mut modifiers = WindowsTypingModifiers::default();
        modifiers.observe(0xA2, 0x021D, true, false);
        assert!(modifiers.permits_typing(true, true));
        modifiers.observe(0xA2, 0x001D, true, true);
        assert!(!modifiers.permits_typing(true, true));
        modifiers.observe(0xA2, 0x001D, false, true);
        assert!(modifiers.permits_typing(true, true));
        modifiers.observe(0xA5, 0x0038, false, true);
        assert!(!modifiers.permits_typing(false, true));
    }

    #[test]
    fn windows_excludes_control_held_before_the_hook_started() {
        let mut modifiers = WindowsTypingModifiers::default();
        assert!(!modifiers.permits_typing(true, false));
        modifiers.observe(0xA2, 0x021D, true, true);
        assert!(!modifiers.permits_typing(true, true));
    }

    #[test]
    fn reloads_existing_counts_with_a_new_revision_sequence() {
        let mut counter = DailyCounter::new(date(27), BTreeMap::from([(date(27), 4)]));
        assert_eq!(counter.snapshot().count, 4);
        assert_eq!(counter.snapshot().revision, 0);
        assert_eq!(counter.record().count, 5);
        assert_eq!(counter.snapshot().revision, 1);
    }

    #[test]
    fn rolls_to_the_new_day_and_recovers_counts_after_clock_changes() {
        let mut counter = DailyCounter::new(date(27), BTreeMap::from([(date(27), 4)]));
        let midnight = counter.refresh(date(28)).unwrap();
        assert_eq!((midnight.date, midnight.count, midnight.revision), (date(28), 0, 1));
        assert!(counter.refresh(date(28)).is_none());
        assert_eq!(counter.record().count, 1);
        let returned = counter.refresh(date(27)).unwrap();
        assert_eq!((returned.count, returned.revision), (4, 3));
        assert_eq!(counter.refresh(date(28)).unwrap().count, 1);
    }

    #[test]
    fn excludes_x11_repeat_pairs_and_synthetic_presses() {
        assert!(!count_x11_press(&mut Some(55), 55, false));
        assert!(count_x11_press(&mut Some(55), 56, false));
        assert!(!count_x11_press(&mut None, 56, true));
    }

    #[test]
    fn saves_daily_totals_and_final_count_without_key_details() {
        let scratch = scratch_path();
        let today = local_date();
        let stats = DailyKeyStats::load_for_date(scratch.clone(), today);
        let (_, snapshot) = stats.record().unwrap();
        assert_eq!(snapshot.count, 1);
        stats.flush().unwrap();
        stats.record().unwrap();
        stats.finish().unwrap();
        assert!(stats.record().is_none());

        let restarted = DailyKeyStats::load_for_date(scratch.clone(), today);
        let (reloaded, _) = restarted.refresh();
        assert_eq!(reloaded.count, 2);
        assert_eq!(reloaded.revision, 0);
        let stored: BTreeMap<NaiveDate, u64> =
            serde_json::from_slice(&std::fs::read(&scratch).unwrap()).unwrap();
        assert_eq!(stored, BTreeMap::from([(today, 2)]));
        assert_eq!(
            serde_json::to_value(reloaded).unwrap(),
            serde_json::json!({ "date": today.to_string(), "count": 2, "revision": 0 }),
        );
        std::fs::remove_file(scratch).unwrap();
    }

    #[test]
    fn clears_only_today_and_persists_before_returning() {
        let scratch = scratch_path();
        let today = date(27);
        let yesterday = date(26);
        let stored = BTreeMap::from([(yesterday, 2_u64), (today, 5)]);
        crate::config::write_json_atomically(&scratch, &stored).unwrap();
        let stats = DailyKeyStats::load_for_date(scratch.clone(), today);

        let cleared = stats.clear_on(today, || today).unwrap();
        assert_eq!(cleared, DailyKeyCount { date: today, count: 0, revision: 1 });
        let restarted = DailyKeyStats::load_for_date(scratch.clone(), today);
        {
            let mut counter = restarted.counter.lock().unwrap();
            assert_eq!(counter.snapshot().count, 0);
            assert_eq!(counter.counts.get(&yesterday), Some(&2));
            let recorded = counter.record();
            assert_eq!((recorded.count, recorded.revision), (1, 1));
        }
        restarted.finish().unwrap();
        let restored = DailyKeyStats::load_for_date(scratch.clone(), today);
        assert_eq!(restored.counter.lock().unwrap().snapshot().count, 1);
        std::fs::remove_file(scratch).unwrap();
    }

    #[test]
    fn rejects_a_reset_confirmed_before_midnight() {
        let scratch = scratch_path();
        let yesterday = date(26);
        let today = date(27);
        let stored = BTreeMap::from([(yesterday, 2_u64), (today, 5)]);
        crate::config::write_json_atomically(&scratch, &stored).unwrap();
        let stats = DailyKeyStats::load_for_date(scratch.clone(), yesterday);
        let before = stats.counter.lock().unwrap().snapshot();

        let error = stats.clear_on(yesterday, || today).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(stats.counter.lock().unwrap().snapshot(), before);
        let reloaded = DailyKeyStats::load_for_date(scratch.clone(), today);
        assert_eq!(reloaded.counter.lock().unwrap().counts, stored);
        std::fs::remove_file(scratch).unwrap();
    }

    #[test]
    fn preserves_memory_and_pending_count_on_write_failure() {
        let scratch = scratch_path();
        std::fs::create_dir(&scratch).unwrap();
        let today = date(27);
        let stats = DailyKeyStats::load_for_date(scratch.clone(), today);
        let before = stats.counter.lock().unwrap().record();

        assert!(stats.clear_on(today, || today).is_err());
        let counter = stats.counter.lock().unwrap();
        assert_eq!(counter.snapshot(), before);
        assert!(counter.dirty);
        std::fs::remove_dir(scratch).unwrap();
    }

    #[test]
    fn serializes_clear_and_record_updates() {
        let scratch = scratch_path();
        let today = date(27);
        let stats = DailyKeyStats::load_for_date(scratch.clone(), today);
        let (recorded, cleared) = std::thread::scope(|scope| {
            let record = scope.spawn(|| stats.counter.lock().unwrap().record());
            let clear = scope.spawn(|| stats.clear_on(today, || today).unwrap());
            (record.join().unwrap(), clear.join().unwrap())
        });

        let final_snapshot = stats.counter.lock().unwrap().snapshot();
        assert_eq!(final_snapshot.revision, 2);
        assert_eq!(final_snapshot.count, u64::from(recorded.revision > cleared.revision));
        stats.finish().unwrap();
        let restored = DailyKeyStats::load_for_date(scratch.clone(), today);
        assert_eq!(restored.counter.lock().unwrap().snapshot().count, final_snapshot.count);
        std::fs::remove_file(scratch).unwrap();
    }
}
