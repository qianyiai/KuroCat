//! Passive companion service. Source files are opened read-only; all writes use our app_data_dir.
mod adapters;
mod office;
mod tail;
use adapters::{Mapping, PassiveAdapter};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub dsh_enabled: bool,
    pub codex_enabled: bool,
    pub dsh_root: String,
    pub codex_root: String,
    pub layout: String,
    pub max_sessions: usize,
    pub bubble_width: u32,
    pub lines: usize,
    pub font_size: u32,
    pub gap: u32,
    pub show_projects: bool,
    pub stale_seconds: u64,
    pub office_enabled: bool,
    pub office_apps: String,
    pub idle_seconds: u32,
    pub mood_enabled: bool,
    pub mood_minutes: u32,
    pub adapter_roots: BTreeMap<String, String>,
    pub disabled_adapters: Vec<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self{
    enabled:false,dsh_enabled:true,codex_enabled:true,dsh_root:String::new(),codex_root:String::new(),
    layout:"merged".into(),max_sessions:3,bubble_width:240,lines:2,font_size:13,gap:4,
    show_projects:true,stale_seconds:180,office_enabled:false,
    office_apps:"com.microsoft.Excel\ncom.microsoft.Word\ncom.microsoft.Powerpoint\ncom.apple.iWork.Numbers\ncom.apple.iWork.Pages\ncom.kingsoft.wpsoffice.mac\nEXCEL.EXE\nWINWORD.EXE\nPOWERPNT.EXE\nwps.exe".into(),
    idle_seconds:180,mood_enabled:true,mood_minutes:20,adapter_roots:BTreeMap::new(),disabled_adapters:vec![],
}
    }
}
impl Settings {
    fn normalize(&mut self) -> Result<(), String> {
        if !["merged", "stacked", "minimal"].contains(&self.layout.as_str()) {
            return Err("Invalid bubble layout".into());
        }
        self.max_sessions = self.max_sessions.clamp(1, 6);
        self.lines = self.lines.clamp(1, 4);
        self.bubble_width = self.bubble_width.clamp(180, 360);
        self.font_size = self.font_size.clamp(11, 20);
        self.gap = self.gap.min(240);
        self.stale_seconds = self.stale_seconds.clamp(30, 1800);
        self.idle_seconds = self.idle_seconds.clamp(30, 1800);
        self.mood_minutes = self.mood_minutes.clamp(1, 180);
        if self.office_apps.len() > 8192 {
            return Err("Too many entries".into());
        }
        for root in [&self.dsh_root, &self.codex_root] {
            if !root.is_empty() && !Path::new(root).is_absolute() {
                return Err("Use an absolute session directory".into());
            }
        }
        if self.adapter_roots.len() > 32 || self.disabled_adapters.len() > 32 {
            return Err("Too many adapters".into());
        }
        for root in self.adapter_roots.values() {
            if !root.is_empty() && !Path::new(root).is_absolute() {
                return Err("Use an absolute session directory".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub key: String,
    pub source: String,
    pub project: String,
    pub label: String,
    pub activity: String,
    pub outcome: Option<String>,
    pub last_ms: u64,
    pub visible: bool,
    pub fresh: bool,
    pub progress: String,
    pub stage: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub sessions: usize,
    pub errors: usize,
    pub limited: bool,
}
/// Bubble dimensions are authored at the upstream pet default scale (100%).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub scale: f64,
    pub opacity: f64,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            scale: 1.,
            opacity: 1.,
        }
    }
}
impl Appearance {
    fn from_pet(scale: f64, opacity: f64) -> Self {
        Self {
            scale: if scale.is_finite() {
                scale.clamp(0.2, 1.5) / 1.0
            } else {
                1.
            },
            opacity: if opacity.is_finite() {
                opacity.clamp(0., 1.)
            } else {
                1.
            },
        }
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub appearance: Appearance,
    pub sources: Vec<SourceInfo>,
    pub sessions: Vec<Session>,
    pub office: Option<String>,
    pub work_seconds: u64,
    pub mood_level: u32,
    pub paused: bool,
    pub locale: String,
    pub updated_ms: u64,
    pub height_limit: u32,
}
pub struct Service {
    pub snapshot: Arc<Mutex<Snapshot>>,
    pub settings: Arc<Mutex<Settings>>,
    pub height_limit: Arc<AtomicU32>,
    preview: Arc<Mutex<Option<(Appearance, Instant)>>>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Checkpoint {
    position: tail::Position,
    mapping: Mapping,
}
#[derive(Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    files: BTreeMap<String, Checkpoint>,
}
struct Reader {
    path: PathBuf,
    adapter: usize,
    tail: tail::Tail,
    mapping: Mapping,
    catching_up: bool,
    notice_until: u64,
    error: Option<String>,
    observed_active: bool,
}

fn atomic_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create app data directory")?;
    let temp = path.with_extension("tmp");
    let bytes = serde_json::to_vec(data).map_err(|_| "Cannot serialize settings")?;
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|_| "Cannot write app settings")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot save app settings")?;
    fs::rename(temp, path).map_err(|_| "Cannot replace app settings".into())
}

#[tauri::command]
pub fn get_companion_snapshot(state: State<'_, Service>) -> Snapshot {
    state.snapshot.lock().unwrap().clone()
}
#[tauri::command]
pub fn save_companion_settings(
    settings: Settings,
    state: State<'_, Service>,
) -> Result<Settings, String> {
    let mut settings = settings;
    settings.normalize()?;
    let mut guard = state.settings.lock().map_err(|_| "Settings unavailable")?;
    atomic_json(
        &crate::config::app_data_dir().join("companion.json"),
        &settings,
    )?;
    *guard = settings.clone();
    Ok(settings)
}

fn root(settings: &Settings, adapter: &dyn PassiveAdapter) -> PathBuf {
    let id = adapter.id();
    let explicit = match id {
        "dsh" => settings.dsh_root.as_str(),
        "codex" => settings.codex_root.as_str(),
        _ => settings
            .adapter_roots
            .get(id)
            .map(String::as_str)
            .unwrap_or(""),
    };
    if !explicit.is_empty() {
        return explicit.into();
    }
    adapter.default_root()
}

fn discover(root: &Path, adapter: &dyn PassiveAdapter) -> Result<(Vec<PathBuf>, bool), String> {
    let mut pending = vec![(root.to_path_buf(), 0)];
    let mut files = vec![];
    let mut visited = 0;
    let mut limited = false;
    while let Some((dir, depth)) = pending.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                "permission"
            } else {
                "unavailable"
            }
            .to_string()
        })?;
        for entry in entries.flatten() {
            visited += 1;
            if visited > 12000 {
                limited = true;
                break;
            }
            let Ok(ty) = entry.file_type() else { continue };
            let p = entry.path();
            if ty.is_symlink() {
                continue;
            }
            if ty.is_dir() && depth < 5 {
                pending.push((p, depth + 1));
            } else if ty.is_file() && adapter.matches(&p) {
                files.push(p);
            }
        }
        if limited {
            break;
        }
    }
    files.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
    if files.len() > 32 {
        files.truncate(32);
        limited = true;
    }
    Ok((files, limited))
}

#[derive(Default)]
struct Mood {
    seconds: f64,
}
impl Mood {
    fn tick(&mut self, elapsed: f64, busy: bool, enabled: bool) {
        if !enabled {
            self.seconds = 0.;
            return;
        }
        if elapsed > 3. {
            return;
        } // suspend/resume or delayed worker: never add unseen time
        if busy {
            self.seconds = (self.seconds + elapsed).min(86400.);
        } else {
            self.seconds = (self.seconds - elapsed * 2.).max(0.);
        }
    }
}

pub fn start(
    app: &tauri::AppHandle,
    app_settings: Arc<Mutex<crate::config::AppSettings>>,
    paused: Arc<AtomicBool>,
) {
    let saved_settings = fs::read(crate::config::app_data_dir().join("companion.json")).ok();
    let compact_migration = saved_settings
        .as_ref()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(b).ok())
        .is_some_and(|v| v.get("bubbleWidth").is_none());
    let mut settings: Settings = saved_settings
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    if compact_migration {
        settings.gap = 4;
    }
    if settings.normalize().is_err() {
        settings = Settings::default();
    }
    let settings = Arc::new(Mutex::new(settings));
    let snapshot = Arc::new(Mutex::new(Snapshot::default()));
    let height_limit = Arc::new(AtomicU32::new(600));
    let preview = Arc::new(Mutex::new(None::<(Appearance, Instant)>));
    app.manage(Service {
        snapshot: snapshot.clone(),
        settings: settings.clone(),
        height_limit: height_limit.clone(),
        preview: preview.clone(),
    });
    if let Some(main) = app.get_webview_window("main") {
        let follow_app = app.clone();
        let follow_snapshot = snapshot.clone();
        main.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                let snap = follow_snapshot.lock().unwrap().clone();
                let app = follow_app.clone();
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || sync_window(&handle, &snap));
            }
        });
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let adapters = adapters::registry();
        let cache_path = crate::config::app_data_dir().join("companion-cursors-v2.json");
        let mut cache: Cache = fs::read(&cache_path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if cache.version != 2 {
            cache = Cache {
                version: 2,
                ..Default::default()
            };
        }
        let mut readers: BTreeMap<String, Reader> = BTreeMap::new();
        let mut sources = vec![];
        let mut scanned = Instant::now() - Duration::from_secs(20);
        let mut saved = Instant::now();
        let mut last = Instant::now();
        let mut previous = Settings::default();
        let mut titles: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        let mut mood = Mood::default();
        let mut round = 0;
        let mut resume_floor = 0;
        let mut language = String::new();
        let mut locale = String::new();
        loop {
            let s = settings.lock().unwrap().clone();
            let now = now_ms();
            let dt = last.elapsed().as_secs_f64();
            last = Instant::now();
            let suspend_gap = dt > 3.;
            let hidden = paused.load(Ordering::Relaxed);
            if suspend_gap {
                resume_floor = now;
            }
            if scanned.elapsed() >= Duration::from_secs(10) || s != previous {
                let mut next = BTreeMap::new();
                sources.clear();
                for (index, adapter) in adapters.iter().enumerate() {
                    let id = adapter.id();
                    let enabled = s.enabled
                        && !s.disabled_adapters.iter().any(|v| v == id)
                        && match id {
                            "dsh" => s.dsh_enabled,
                            "codex" => s.codex_enabled,
                            _ => true,
                        };
                    let mut info = SourceInfo {
                        id: id.into(),
                        name: adapter.display_name().into(),
                        status: if enabled { "ready" } else { "disabled" }.into(),
                        ..Default::default()
                    };
                    if enabled {
                        titles.insert(id.into(), adapter.titles(&root(&s, adapter.as_ref())));
                        match discover(&root(&s, adapter.as_ref()), adapter.as_ref()) {
                            Ok((paths, limited)) => {
                                info.limited = limited;
                                if paths.is_empty() {
                                    info.status = "empty".into();
                                }
                                for path in paths {
                                    let key =
                                        tail::digest(format!("{id}:{}", path.display()).as_bytes());
                                    let reader = readers
                                        .remove(&key)
                                        .map(|mut r| {
                                            // Retry transient I/O without losing an observed open turn.
                                            if matches!(
                                                r.error.as_deref(),
                                                Some("permission" | "unavailable" | "read")
                                            ) {
                                                r.error = None;
                                            }
                                            r
                                        })
                                        .filter(|r| r.error.is_none())
                                        .unwrap_or_else(|| {
                                            let c =
                                                cache.files.get(&key).cloned().unwrap_or_default();
                                            Reader {
                                                path,
                                                adapter: index,
                                                tail: tail::Tail::new(
                                                    adapter.compressed(),
                                                    c.position,
                                                ),
                                                mapping: c.mapping,
                                                catching_up: true,
                                                notice_until: 0,
                                                error: None,
                                                observed_active: false,
                                            }
                                        });
                                    next.insert(key, reader);
                                }
                            }
                            Err(e) => {
                                info.status = e.clone();
                                let old_keys: Vec<_> = readers
                                    .iter()
                                    .filter(|(_, r)| {
                                        r.adapter == index
                                            && r.path.starts_with(root(&s, adapter.as_ref()))
                                    })
                                    .map(|(k, _)| k.clone())
                                    .collect();
                                for key in old_keys {
                                    if let Some(mut r) = readers.remove(&key) {
                                        r.error = Some(e.clone());
                                        next.insert(key, r);
                                    }
                                }
                            }
                        }
                    }
                    sources.push(info);
                }
                readers = next;
                scanned = Instant::now();
                previous = s.clone();
            }
            // Fair bounded work: <= 16 * 128KiB source bytes per tick; rotates through readers.
            let keys: Vec<_> = readers.keys().cloned().collect();
            for i in 0..keys.len().min(16) {
                let key = &keys[(round + i) % keys.len()];
                let r = readers.get_mut(key).unwrap();
                if r.error.is_some() {
                    continue;
                }
                match r.tail.read(&r.path) {
                    Ok(batch) => {
                        if batch.reset {
                            r.mapping = Mapping::default();
                            r.catching_up = true;
                            r.notice_until = 0;
                            r.observed_active = false;
                        }
                        for e in batch.records {
                            match adapters[r.adapter].fold(&e, &mut r.mapping) {
                                Ok(changed) => {
                                    if changed
                                        && !r.catching_up
                                        && r.mapping.outcome.is_some()
                                        && now.saturating_sub(r.mapping.last_ms) < 10000
                                    {
                                        r.notice_until = now + 8000;
                                    }
                                }
                                Err(e) => {
                                    r.error = Some(e);
                                    break;
                                }
                            }
                        }
                        if batch.caught_up {
                            r.catching_up = false;
                            if r.mapping.outcome.is_some() {
                                r.observed_active = false;
                            } else if !r.mapping.run.is_empty()
                                && now.saturating_sub(r.mapping.last_ms) <= s.stale_seconds * 1000
                            {
                                r.observed_active = true;
                            }
                            if r.error.is_none() && r.tail.clean() {
                                cache.files.insert(
                                    key.clone(),
                                    Checkpoint {
                                        position: r.tail.position.clone(),
                                        mapping: r.mapping.clone(),
                                    },
                                );
                            }
                        }
                    }
                    Err(e) => r.error = Some(e),
                }
            }
            if !keys.is_empty() {
                round = (round + 16) % keys.len();
            }
            let mut sessions = vec![];
            let mut infos = sources.clone();
            for (key, r) in &readers {
                let id = adapters[r.adapter].id();
                let info = infos.iter_mut().find(|i| i.id == id).unwrap();
                if let Some(error) = &r.error {
                    info.errors += 1;
                    info.status = error.clone();
                }
                if r.catching_up && !r.observed_active {
                    if info.errors == 0 {
                        info.status = "reading".into();
                    }
                    continue;
                }
                if r.mapping.id.is_empty() {
                    continue;
                }
                info.sessions += 1;
                let m = &r.mapping;
                let age = now.saturating_sub(m.last_ms);
                let fresh = r.error.is_none()
                    && !r.catching_up
                    && m.last_ms >= resume_floor
                    && m.last_ms <= now + 5000
                    && age <= s.stale_seconds * 1000
                    && !suspend_gap;
                let activity = if fresh {
                    m.activity.as_str()
                } else if r.observed_active && m.outcome.is_none() {
                    "waiting-update"
                } else {
                    "unknown"
                };
                let active = m.outcome.is_none() && !m.run.is_empty();
                sessions.push(Session {
                    key: key.clone(),
                    source: id.into(),
                    project: if s.show_projects {
                        m.project.clone()
                    } else {
                        String::new()
                    },
                    label: titles
                        .get(id)
                        .and_then(|t| t.get(&m.id))
                        .filter(|t| !t.is_empty())
                        .cloned()
                        .unwrap_or_else(|| {
                            if !m.title.is_empty() {
                                m.title.clone()
                            } else {
                                m.project.clone()
                            }
                        }),
                    activity: if activity.is_empty() {
                        "unknown"
                    } else {
                        activity
                    }
                    .into(),
                    outcome: m.outcome.clone(),
                    last_ms: m.last_ms,
                    fresh,
                    progress: m.progress.clone(),
                    stage: m.stage.clone(),
                    visible: should_display(active, fresh, r.observed_active),
                });
            }
            sessions.retain(|r| r.visible);
            sessions.sort_by_key(|row| std::cmp::Reverse(row.last_ms));
            let idle = office::idle_seconds();
            let office = if s.enabled && s.office_enabled && !hidden && idle < s.idle_seconds as f64
            {
                office::foreground()
                    .filter(|(n, id)| office::matches(n, id, &s.office_apps))
                    .map(|(n, _)| n)
            } else {
                None
            };
            let busy = !hidden
                && !suspend_gap
                && s.enabled
                && (office.is_some()
                    || sessions
                        .iter()
                        .any(|r| r.visible && r.activity == "working"));
            mood.tick(dt, busy, s.mood_enabled && s.enabled);
            let pet = app_settings.lock().unwrap().clone();
            let selected_language = pet.language;
            if language != selected_language || locale.is_empty() {
                locale = crate::i18n::effective_locale(&selected_language).to_string();
                language = selected_language;
            }
            let next = Snapshot {
                settings: s.clone(),
                appearance: preview
                    .lock()
                    .unwrap()
                    .as_ref()
                    .filter(|(_, time)| time.elapsed() < Duration::from_secs(1))
                    .map(|(appearance, _)| appearance.clone())
                    .unwrap_or_else(|| Appearance::from_pet(pet.scale, pet.opacity)),
                sources: infos,
                sessions,
                office,
                work_seconds: mood.seconds as u64,
                mood_level: (mood.seconds / (s.mood_minutes as f64 * 60.))
                    .floor()
                    .min(3.) as u32,
                paused: hidden,
                locale: locale.clone(),
                updated_ms: now,
                height_limit: height_limit.load(Ordering::Relaxed),
            };
            *snapshot.lock().unwrap() = next.clone();
            let _ = app.emit("kuro-work-companion", &next);
            if next.settings.enabled
                && !next.paused
                && (next.office.is_some() || next.sessions.iter().any(|r| r.visible))
            {
                ensure_window(&app);
            }
            let handle = app.clone();
            let window_snapshot = next.clone();
            let _ = app.run_on_main_thread(move || sync_window(&handle, &window_snapshot));
            if saved.elapsed() > Duration::from_secs(15) {
                // Cache only selected files and never raw transcript records. A failed write is non-fatal.
                cache.files.retain(|k, _| readers.contains_key(k));
                let _ = atomic_json(&cache_path, &cache);
                saved = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// Preview follows the same slider events as the pet; saved settings take over after release.
pub fn preview_appearance(app: &tauri::AppHandle, scale: Option<f64>, opacity: Option<f64>) {
    let Some(service) = app.try_state::<Service>() else {
        return;
    };
    let mut snapshot = service.snapshot.lock().unwrap().clone();
    if let Some(scale) = scale {
        snapshot.appearance.scale = Appearance::from_pet(scale, 1.).scale;
    }
    if let Some(opacity) = opacity {
        snapshot.appearance.opacity = opacity;
    }
    snapshot.updated_ms = now_ms();
    *service.preview.lock().unwrap() = Some((snapshot.appearance.clone(), Instant::now()));
    *service.snapshot.lock().unwrap() = snapshot.clone();
    let _ = app.emit("kuro-work-companion", &snapshot);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || sync_window(&handle, &snapshot));
}

// Build from the worker, not the UI thread (WebView2 creation must not block its event loop).
fn ensure_window(app: &tauri::AppHandle) {
    if app.get_webview_window("companion").is_some() {
        return;
    }
    if let Ok(w) = tauri::WebviewWindowBuilder::new(
        app,
        "companion",
        tauri::WebviewUrl::App("companion.html".into()),
    )
    .title("KuroCat Status")
    .inner_size(360., 220.)
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .additional_browser_args(crate::WEBVIEW_BROWSER_ARGS)
    .build()
    {
        let _ = w.set_ignore_cursor_events(true);
    }
}
fn sync_window(app: &tauri::AppHandle, snapshot: &Snapshot) {
    let rows = snapshot.sessions.iter().filter(|r| r.visible).count()
        + usize::from(snapshot.office.is_some());
    let visible = snapshot.settings.enabled && !snapshot.paused && rows > 0;
    if !visible {
        if let Some(w) = app.get_webview_window("companion") {
            let _ = w.hide();
        }
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    if !main.is_visible().unwrap_or(false) {
        if let Some(w) = app.get_webview_window("companion") {
            let _ = w.hide();
        }
        return;
    }
    let Some(overlay) = app.get_webview_window("companion") else {
        return;
    };
    let Ok(pos) = main.outer_position() else {
        return;
    };
    let Ok(size) = main.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = main.current_monitor() else {
        return;
    };
    let sf = monitor.scale_factor();
    let unit = sf * snapshot.appearance.scale;
    let cfg = &snapshot.settings;
    let width = ((cfg.bubble_width as f64 + 8.) * unit).round() as u32;
    let count = if cfg.layout == "minimal" {
        1
    } else {
        rows.min(cfg.max_sessions)
    };
    let (row_h, padding) = if cfg.layout == "minimal" {
        ((cfg.font_size as f64 * 1.4).ceil() as usize + 14, 8)
    } else {
        (cfg.font_size as usize * (cfg.lines * 3 + 6) + 32, 62)
    };
    let height = ((count * row_h + padding) as f64 * unit).round() as u32;
    let bounds = monitor.size();
    let origin = monitor.position();
    let width = width.min(bounds.width);
    let head_y = pos.y + (size.height as f64 * 0.12) as i32;
    let above = (head_y - origin.y - (cfg.gap as f64 * unit) as i32).max(0) as u32;
    let below = (origin.y + bounds.height as i32 - pos.y - size.height as i32).max(0) as u32;
    let use_below = above < 120 && (below > above);
    let available = if use_below { below } else { above }
        .max(80)
        .min(bounds.height);
    app.state::<Service>()
        .height_limit
        .store((available as f64 / unit) as u32, Ordering::Relaxed);
    let height = height.min(available);
    let x = (pos.x + (size.width as i32 - width as i32) / 2)
        .clamp(origin.x, origin.x + (bounds.width - width) as i32);
    let y = if use_below {
        pos.y + size.height as i32 + (cfg.gap as f64 * unit) as i32
    } else {
        head_y - height as i32 - (cfg.gap as f64 * unit) as i32
    };
    let y = y.clamp(origin.y, origin.y + (bounds.height - height) as i32);
    let _ = overlay.set_size(tauri::PhysicalSize::new(width, height));
    let _ = overlay.set_position(tauri::PhysicalPosition::new(x, y));
    #[cfg(target_os = "macos")]
    crate::macos_window::sync_companion_layer(&main, &overlay);
    #[cfg(not(target_os = "macos"))]
    let _ = overlay.set_always_on_top(main.is_always_on_top().unwrap_or(true));
    let _ = overlay.show();
}

fn should_display(active: bool, fresh: bool, observed_active: bool) -> bool {
    active && (fresh || observed_active)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bubble_appearance_tracks_pet_and_rejects_nonfinite_values() {
        assert_eq!(Appearance::from_pet(1., 0.8).scale, 1.);
        let large = Appearance::from_pet(1.5, 0.4);
        assert_eq!(large.scale, 1.5);
        assert_eq!(large.opacity, 0.4);
        assert_eq!(Appearance::from_pet(f64::NAN, f64::INFINITY).scale, 1.);
        assert_eq!(Appearance::from_pet(0.1, 0.).opacity, 0.);
    }
    #[test]
    fn long_running_turn_keeps_its_bubble_without_fabricating_fresh_progress() {
        assert!(should_display(true, false, true));
        assert!(!should_display(true, false, false));
        assert!(!should_display(false, true, true));
    }
    #[test]
    fn minimal_layout_survives_settings_round_trip() {
        let mut s = Settings {
            layout: "minimal".into(),
            max_sessions: 6,
            ..Default::default()
        };
        s.normalize().unwrap();
        let mut restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        restored.normalize().unwrap();
        assert_eq!(restored.layout, "minimal");
        assert_eq!(restored.max_sessions, 6); // Preserve the detailed-mode preference.
    }
    #[test]
    fn settings_limits() {
        let mut s = Settings {
            max_sessions: 900,
            font_size: 1,
            gap: 900,
            ..Default::default()
        };
        s.normalize().unwrap();
        assert_eq!(s.max_sessions, 6);
        assert_eq!(s.font_size, 11);
        assert_eq!(s.gap, 240);
    }
    #[test]
    fn mood_counts_union_and_excludes_sleep() {
        let mut m = Mood::default();
        m.tick(1., true, true);
        m.tick(100., true, true);
        assert_eq!(m.seconds, 1.);
        m.tick(1., false, true);
        assert_eq!(m.seconds, 0.);
        m.tick(1., true, false);
        assert_eq!(m.seconds, 0.);
    }
    #[test]
    fn roots_are_not_host_config_writes() {
        let s = Settings::default();
        assert!(root(&s, &adapters::Dsh).ends_with("sessions"));
        assert!(root(&s, &adapters::Codex).ends_with("sessions"));
    }
    #[test]
    #[ignore = "reads real local logs, run explicitly on a development machine"]
    fn local_read_only_adapters() {
        for adapter in adapters::registry() {
            let (paths, _) = discover(
                &root(&Settings::default(), adapter.as_ref()),
                adapter.as_ref(),
            )
            .unwrap();
            assert!(!paths.is_empty(), "no local fixture for {}", adapter.id());
            let mut count = 0;
            for p in paths.iter().take(32) {
                let mut t = tail::Tail::new(adapter.compressed(), tail::Position::default());
                let mut m = Mapping::default();
                let mut caught = false;
                for _ in 0..512 {
                    let batch = t.read(p).unwrap_or_else(|e| {
                        panic!(
                            "{} source {}: {}",
                            adapter.id(),
                            &tail::digest(p.to_string_lossy().as_bytes())[..12],
                            e
                        )
                    });
                    for event in batch.records {
                        adapter.fold(&event, &mut m).unwrap();
                        count += 1;
                    }
                    if batch.caught_up {
                        caught = true;
                        break;
                    }
                }
                assert!(caught);
                assert!(!m.id.is_empty());
            }
            println!(
                "{}: decoded {} records in real local logs, no source writes",
                adapter.id(),
                count
            );
        }
    }
}
