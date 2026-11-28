use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

fn default_cat_breed() -> String {
    "black".to_string()
}

fn default_lao_wu_handover() -> bool {
    true
}

fn default_mcp_enabled() -> bool {
    true
}

fn default_privacy_password_guard() -> bool {
    true
}

fn default_expression_hotkeys() -> bool {
    true
}

pub fn default_pause_hotkey() -> String {
    "Alt+Shift+P".to_string()
}

/// Canonicalizes a user-configured global Pause/Resume hotkey string (e.g. `"Ctrl+Alt+P"`,
/// `"Alt+Shift+P"`, `"F9"`, or `""` when disabled). Returns `""` if disabled or invalid.
pub fn normalize_pause_hotkey(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("none")
        || trimmed.eq_ignore_ascii_case("off")
    {
        return String::new();
    }
    let mut has_ctrl = false;
    let mut has_alt = false;
    let mut has_shift = false;
    let mut key: Option<String> = None;

    for part in trimmed.split('+') {
        let token = part.trim();
        if token.is_empty() {
            continue;
        }
        let lower = token.to_ascii_lowercase();
        match lower.as_str() {
            "ctrl" | "control" | "cmd" | "command" | "meta" | "super" => {
                has_ctrl = true;
                continue;
            }
            "alt" | "option" | "opt" => {
                has_alt = true;
                continue;
            }
            "shift" => {
                has_shift = true;
                continue;
            }
            _ => {}
        }
        if key.is_some() {
            return String::new();
        }
        let canonical = canonicalize_hotkey_key(&lower);
        if canonical.is_none() {
            return String::new();
        }
        key = canonical;
    }

    let Some(k) = key else {
        return String::new();
    };
    let is_standalone_safe = matches!(
        k.as_str(),
        "F1" | "F2"
            | "F3"
            | "F4"
            | "F5"
            | "F6"
            | "F7"
            | "F8"
            | "F9"
            | "F10"
            | "F11"
            | "F12"
            | "Pause"
            | "ScrollLock"
    );
    if !is_standalone_safe && !has_ctrl && !has_alt && !has_shift {
        return String::new();
    }

    let mut out: Vec<&str> = Vec::with_capacity(4);
    if has_ctrl {
        out.push("Ctrl");
    }
    if has_alt {
        out.push("Alt");
    }
    if has_shift {
        out.push("Shift");
    }
    out.push(&k);
    out.join("+")
}

fn canonicalize_hotkey_key(lower: &str) -> Option<String> {
    if lower.len() == 1 {
        let ch = lower.chars().next()?;
        if ch.is_ascii_alphabetic() {
            return Some(ch.to_ascii_uppercase().to_string());
        }
        if ch.is_ascii_digit() {
            return Some(ch.to_string());
        }
    }
    if let Some(rest) = lower.strip_prefix("key") {
        if rest.len() == 1 && rest.chars().next()?.is_ascii_alphabetic() {
            return Some(rest.to_ascii_uppercase());
        }
    }
    if let Some(rest) = lower.strip_prefix("digit") {
        if rest.len() == 1 && rest.chars().next()?.is_ascii_digit() {
            return Some(rest.to_string());
        }
    }
    if let Some(rest) = lower.strip_prefix('f') {
        if let Ok(n) = rest.parse::<u8>() {
            if (1..=12).contains(&n) {
                return Some(format!("F{n}"));
            }
        }
    }
    let named = match lower {
        "pause" => "Pause",
        "scrolllock" | "scroll" => "ScrollLock",
        "insert" | "ins" => "Insert",
        "delete" | "del" => "Delete",
        "home" => "Home",
        "end" => "End",
        "pageup" | "pgup" => "PageUp",
        "pagedown" | "pgdn" => "PageDown",
        "space" | "spacebar" => "Space",
        "backquote" | "`" | "~" => "Backquote",
        "minus" | "-" => "Minus",
        "equal" | "=" => "Equal",
        "bracketleft" | "[" => "BracketLeft",
        "bracketright" | "]" => "BracketRight",
        "semicolon" | ";" => "Semicolon",
        "quote" | "'" => "Quote",
        "comma" | "," => "Comma",
        "period" | "." => "Period",
        "slash" | "/" => "Slash",
        "backslash" | "\\" => "Backslash",
        _ => return None,
    };
    Some(named.to_string())
}

/// Parses a normalized hotkey spec into `(ctrl, alt, shift, win_vk)` for OS registration & matching.
pub fn parse_pause_hotkey_vk(raw: &str) -> Option<(bool, bool, bool, u32)> {
    let norm = normalize_pause_hotkey(raw);
    if norm.is_empty() {
        return None;
    }
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut vk: Option<u32> = None;
    for part in norm.split('+') {
        match part {
            "Ctrl" => ctrl = true,
            "Alt" => alt = true,
            "Shift" => shift = true,
            k => {
                vk = hotkey_key_to_win_vk(k);
            }
        }
    }
    Some((ctrl, alt, shift, vk?))
}

fn hotkey_key_to_win_vk(key: &str) -> Option<u32> {
    if key.len() == 1 {
        let b = key.as_bytes()[0];
        if b.is_ascii_uppercase() || b.is_ascii_digit() {
            return Some(u32::from(b));
        }
    }
    if let Some(rest) = key.strip_prefix('F') {
        if let Ok(n) = rest.parse::<u32>() {
            if (1..=12).contains(&n) {
                return Some(0x70 + (n - 1));
            }
        }
    }
    let code = match key {
        "Pause" => 0x13,
        "ScrollLock" => 0x91,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "Space" => 0x20,
        "Backquote" => 0xC0,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB,
        "BracketRight" => 0xDD,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Backslash" => 0xDC,
        _ => return None,
    };
    Some(code)
}

fn default_autostart() -> bool {
    true
}

fn default_mcp_port() -> u16 {
    27420
}

fn default_obs_enabled() -> bool {
    false
}

fn default_obs_port() -> u16 {
    27421
}

fn default_obs_hide_pet() -> bool {
    false
}

pub fn default_opacity() -> f64 {
    1.0
}

pub fn normalize_opacity(raw: f64) -> f64 {
    if !raw.is_finite() {
        return default_opacity();
    }
    let normalized = if raw >= 10.0 && raw <= 100.0 {
        raw / 100.0
    } else {
        raw
    };
    normalized.clamp(0.20, 1.0)
}

pub fn default_sound_volume() -> f64 {
    1.0
}

pub fn normalize_sound_volume(raw: f64) -> f64 {
    if !raw.is_finite() {
        return default_sound_volume();
    }
    let normalized = if raw >= 10.0 && raw <= 100.0 {
        raw / 100.0
    } else {
        raw
    };
    normalized.clamp(0.0, 1.0)
}

fn default_live_chroma_color() -> String {
    "blue".to_string()
}

pub fn normalize_live_chroma_color(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "green" => "green".to_string(),
        "magenta" => "magenta".to_string(),
        _ => "blue".to_string(),
    }
}

pub fn default_render_mode() -> String {
    "3d".to_string()
}

pub fn normalize_render_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "2d" => "2d".to_string(),
        _ => "3d".to_string(),
    }
}

pub fn default_collar_color() -> String {
    "none".to_string()
}

pub fn normalize_collar_color(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "red" => "red".to_string(),
        "blue" => "blue".to_string(),
        "pink" => "pink".to_string(),
        "green" => "green".to_string(),
        _ => "none".to_string(),
    }
}

pub fn default_headphone_mode() -> String {
    "off".to_string()
}

pub fn normalize_headphone_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "auto" => "auto".to_string(),
        "on" => "on".to_string(),
        _ => "off".to_string(),
    }
}

pub fn default_tablet_mode() -> String {
    "auto".to_string()
}

pub fn normalize_tablet_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "mouse" => "mouse".to_string(),
        "tablet" => "tablet".to_string(),
        _ => "auto".to_string(),
    }
}

pub fn default_gamepad_mode() -> String {
    "auto".to_string()
}

pub fn normalize_gamepad_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "off" => "off".to_string(),
        "on" => "on".to_string(),
        _ => "auto".to_string(),
    }
}

pub fn default_eye_gaze_mode() -> String {
    "screen".to_string()
}

pub fn normalize_eye_gaze_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "window" => "window".to_string(),
        _ => "screen".to_string(),
    }
}

pub fn default_fps_cap() -> u16 {
    0
}

pub fn normalize_fps_cap(raw: u16) -> u16 {
    match raw {
        30 => 30,
        60 => 60,
        _ => 0,
    }
}

pub fn default_language() -> String {
    "auto".to_string()
}

pub fn default_treat_flavor() -> String {
    "tuna".to_string()
}

pub fn normalize_treat_flavor(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "chicken" => "chicken".to_string(),
        "salmon" => "salmon".to_string(),
        "bonito" => "bonito".to_string(),
        _ => "tuna".to_string(),
    }
}

pub fn normalize_language(raw: &str) -> String {
    crate::i18n::normalize_language_setting(raw)
}

pub fn default_keyboard_layout() -> String {
    if cfg!(feature = "layout-108") {
        "108".to_string()
    } else if cfg!(target_os = "macos") {
        "macbook".to_string()
    } else {
        "65".to_string()
    }
}

pub fn normalize_keyboard_layout(raw: &str) -> String {
    match raw.trim() {
        "108" => "108".to_string(),
        "98" => "98".to_string(),
        "macbook" => "macbook".to_string(),
        _ => "65".to_string(),
    }
}

pub fn default_keyboard_orientation() -> String {
    "cat".to_string()
}

pub fn normalize_keyboard_orientation(raw: &str) -> String {
    if raw.trim() == "viewer" {
        "viewer".to_string()
    } else {
        "cat".to_string()
    }
}

pub fn default_tail_key_mode() -> String {
    "smart".to_string()
}

pub fn normalize_tail_key_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "custom" => "custom".to_string(),
        "edge" => "edge".to_string(),
        "off" => "off".to_string(),
        _ => "smart".to_string(),
    }
}

pub fn default_tail_key_ids() -> Vec<String> {
    vec![
        "enter".to_string(),
        "space".to_string(),
        "bs".to_string(),
        "esc".to_string(),
    ]
}

pub fn normalize_tail_key_ids(raw: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(raw.len().min(120));
    for item in raw {
        let clean: String = item
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .take(24)
            .collect();
        if !clean.is_empty() && !out.contains(&clean) {
            out.push(clean);
            if out.len() >= 120 {
                break;
            }
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub x: Option<i32>,
    pub y: Option<i32>,
    #[cfg(target_os = "macos")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
    #[cfg(windows)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows_display_id: Option<String>,
    pub scale: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    pub always_on_top: bool,
    #[serde(default)]
    pub yield_on_fullscreen: bool,
    pub click_through_locked: bool,
    pub show_key_bubbles: bool,
    pub sound_enabled: bool,
    #[serde(default)]
    pub idle_purr_enabled: bool,
    #[serde(default)]
    pub typing_sound_enabled: bool,
    #[serde(default = "default_sound_volume")]
    pub sound_volume: f64,
    #[serde(default)]
    pub sound_muted: bool,
    #[serde(default = "default_expression_hotkeys")]
    pub expression_hotkeys: bool,
    #[serde(default = "default_pause_hotkey")]
    pub pause_hotkey: String,
    #[serde(default = "default_autostart")]
    pub autostart: bool,
    #[serde(default)]
    pub autostart_admin: bool,
    #[serde(default = "default_cat_breed")]
    pub cat_breed: String,
    #[serde(default = "default_lao_wu_handover")]
    pub lao_wu_handover: bool,
    #[serde(default = "default_mcp_enabled")]
    pub mcp_enabled: bool,
    #[serde(default = "default_mcp_port")]
    pub mcp_port: u16,
    #[serde(default = "default_keyboard_layout")]
    pub keyboard_layout: String,
    #[serde(default)]
    pub trackpad_enabled: bool,
    #[serde(default)]
    pub white_keyboard: bool,
    #[serde(default = "default_keyboard_orientation")]
    pub keyboard_orientation: String,
    #[serde(default = "default_privacy_password_guard")]
    pub privacy_password_guard: bool,
    #[serde(default = "default_tail_key_mode")]
    pub tail_key_mode: String,
    #[serde(default = "default_tail_key_ids")]
    pub tail_key_ids: Vec<String>,
    #[serde(default = "default_obs_enabled")]
    pub obs_enabled: bool,
    #[serde(default = "default_obs_port")]
    pub obs_port: u16,
    #[serde(default = "default_obs_hide_pet")]
    pub obs_hide_pet: bool,
    #[serde(default)]
    pub live_capture_enabled: bool,
    #[serde(default = "default_live_chroma_color")]
    pub live_chroma_color: String,
    #[serde(default)]
    pub live_hide_pet: bool,
    #[serde(default = "default_render_mode")]
    pub render_mode: String,
    #[serde(default = "default_collar_color")]
    pub collar_color: String,
    #[serde(default = "default_headphone_mode")]
    pub headphone_mode: String,
    #[serde(default = "default_tablet_mode")]
    pub tablet_mode: String,
    #[serde(default = "default_gamepad_mode")]
    pub gamepad_mode: String,
    #[serde(default = "default_eye_gaze_mode")]
    pub eye_gaze_mode: String,
    #[serde(default = "default_fps_cap")]
    pub fps_cap: u16,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_treat_flavor")]
    pub treat_flavor: String,
    #[serde(default)]
    pub treat_fed_count: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            #[cfg(target_os = "macos")]
            display_id: None,
            #[cfg(windows)]
            windows_display_id: None,
            scale: 1.0,
            opacity: default_opacity(),
            always_on_top: true,
            yield_on_fullscreen: false,
            click_through_locked: false,
            show_key_bubbles: true,
            sound_enabled: true,
            idle_purr_enabled: false,
            typing_sound_enabled: false,
            sound_volume: default_sound_volume(),
            sound_muted: false,
            expression_hotkeys: default_expression_hotkeys(),
            pause_hotkey: default_pause_hotkey(),
            autostart: default_autostart(),
            autostart_admin: false,
            cat_breed: default_cat_breed(),
            lao_wu_handover: default_lao_wu_handover(),
            mcp_enabled: default_mcp_enabled(),
            mcp_port: default_mcp_port(),
            keyboard_layout: default_keyboard_layout(),
            trackpad_enabled: false,
            white_keyboard: false,
            keyboard_orientation: default_keyboard_orientation(),
            privacy_password_guard: default_privacy_password_guard(),
            tail_key_mode: default_tail_key_mode(),
            tail_key_ids: default_tail_key_ids(),
            obs_enabled: default_obs_enabled(),
            obs_port: default_obs_port(),
            obs_hide_pet: default_obs_hide_pet(),
            live_capture_enabled: false,
            live_chroma_color: default_live_chroma_color(),
            live_hide_pet: false,
            render_mode: default_render_mode(),
            collar_color: default_collar_color(),
            headphone_mode: default_headphone_mode(),
            tablet_mode: default_tablet_mode(),
            gamepad_mode: default_gamepad_mode(),
            eye_gaze_mode: default_eye_gaze_mode(),
            fps_cap: default_fps_cap(),
            language: default_language(),
            treat_flavor: default_treat_flavor(),
            treat_fed_count: 0,
        }
    }
}

pub fn app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        base.join("kuro-cat-pet")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        home.join("Library")
            .join("Application Support")
            .join("kuro-cat-pet")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        home.join(".config").join("kuro-cat-pet")
    }
}

pub fn config_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn load_settings() -> AppSettings {
    let path = config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<AppSettings>(&content) {
            parsed.scale = parsed.scale.clamp(0.20, 1.50);
            parsed.opacity = normalize_opacity(parsed.opacity);
            parsed.sound_volume = normalize_sound_volume(parsed.sound_volume);
            parsed.keyboard_layout = normalize_keyboard_layout(&parsed.keyboard_layout);
            parsed.tail_key_mode = normalize_tail_key_mode(&parsed.tail_key_mode);
            parsed.tail_key_ids = normalize_tail_key_ids(&parsed.tail_key_ids);
            parsed.render_mode = normalize_render_mode(&parsed.render_mode);
            parsed.live_chroma_color = normalize_live_chroma_color(&parsed.live_chroma_color);
            parsed.collar_color = normalize_collar_color(&parsed.collar_color);
            parsed.headphone_mode = normalize_headphone_mode(&parsed.headphone_mode);
            parsed.tablet_mode = normalize_tablet_mode(&parsed.tablet_mode);
            parsed.gamepad_mode = normalize_gamepad_mode(&parsed.gamepad_mode);
            parsed.eye_gaze_mode = normalize_eye_gaze_mode(&parsed.eye_gaze_mode);
            parsed.fps_cap = normalize_fps_cap(parsed.fps_cap);
            parsed.language = normalize_language(&parsed.language);
            parsed.pause_hotkey = normalize_pause_hotkey(&parsed.pause_hotkey);
            parsed.treat_flavor = normalize_treat_flavor(&parsed.treat_flavor);
            return parsed;
        }
    }
    AppSettings::default()
}

pub fn save_settings(settings: &AppSettings) {
    let _ = try_save_settings(settings);
}

pub fn try_save_settings(settings: &AppSettings) -> std::io::Result<()> {
    static NEXT_WRITE: AtomicUsize = AtomicUsize::new(0);
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    let write_id = NEXT_WRITE.fetch_add(1, Ordering::Relaxed);
    let temporary_path = path.with_extension(format!("json.{}.{write_id}.tmp", std::process::id()));
    let result = fs::write(&temporary_path, json).and_then(|()| fs::rename(&temporary_path, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

#[cfg(windows)]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_SET_VALUE, REG_SZ,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let subkey = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let value_name = to_wide("KuroCat");
    let legacy_value_name = to_wide("KuroCatPet");

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        );
        if status != 0 {
            return Err(format!("RegOpenKeyExW failed with code {}", status));
        }

        // Clean up legacy autostart key so users upgrading from <=v4.2 never run two copies
        let _ = RegDeleteValueW(hkey, legacy_value_name.as_ptr());

        let result = if enabled {
            let exe = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            let quoted = format!("\"{}\"", exe);
            let data = to_wide(&quoted);
            let byte_len = (data.len() * std::mem::size_of::<u16>()) as u32;
            let st = RegSetValueExW(
                hkey,
                value_name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr() as *const u8,
                byte_len,
            );
            if st == 0 {
                Ok(())
            } else {
                Err(format!("RegSetValueExW failed with code {}", st))
            }
        } else {
            let _ = RegDeleteValueW(hkey, value_name.as_ptr());
            Ok(())
        };

        RegCloseKey(hkey);
        result
    }
}

#[cfg(target_os = "macos")]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let agents_dir = PathBuf::from(home).join("Library").join("LaunchAgents");
    let plist_path = agents_dir.join("com.kurocat.pet.plist");

    if enabled {
        fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kurocat.pet</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
            exe
        );
        fs::write(plist_path, plist).map_err(|e| e.to_string())
    } else {
        if plist_path.exists() {
            let _ = fs::remove_file(plist_path);
        }
        Ok(())
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    let config_root = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join(".config")
        });
    let autostart_dir = config_root.join("autostart");
    let desktop_path = autostart_dir.join("kurocat.desktop");

    if enabled {
        fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let entry = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=KuroCat\n\
             Comment=Minimalist desktop cat typing & mouse companion\n\
             Exec=\"{exe}\"\n\
             Icon=KuroCat\n\
             Terminal=false\n\
             X-GNOME-Autostart-enabled=true\n",
            exe = exe.replace('"', "\\\"")
        );
        fs::write(desktop_path, entry).map_err(|e| e.to_string())
    } else {
        if desktop_path.exists() {
            let _ = fs::remove_file(desktop_path);
        }
        Ok(())
    }
}

#[cfg(windows)]
pub fn create_desktop_shortcut() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().replace('\'', "''");
    let work_dir = exe_path
        .parent()
        .map(|p| p.to_string_lossy().replace('\'', "''"))
        .unwrap_or_default();

    let script = format!(
        "$desktop = [Environment]::GetFolderPath('Desktop'); \
         $lnk = Join-Path $desktop 'KuroCat.lnk'; \
         $ws = New-Object -ComObject WScript.Shell; \
         $s = $ws.CreateShortcut($lnk); \
         $s.TargetPath = '{exe}'; \
         $s.WorkingDirectory = '{wd}'; \
         $s.IconLocation = '{exe},0'; \
         $s.Description = 'KuroCat Desktop Companion'; \
         $s.Save(); \
         Write-Output $lnk",
        exe = exe_str,
        wd = work_dir,
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to invoke PowerShell: {}", e))?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(path)
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err.is_empty() {
            "Failed to create desktop shortcut".to_string()
        } else {
            err
        })
    }
}

#[cfg(not(windows))]
pub fn create_desktop_shortcut() -> Result<String, String> {
    Ok("Desktop shortcut is managed via Applications on this OS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_key_mode_normalizes_safely() {
        assert_eq!(normalize_tail_key_mode("smart"), "smart");
        assert_eq!(normalize_tail_key_mode(" CUSTOM "), "custom");
        assert_eq!(normalize_tail_key_mode("edge"), "edge");
        assert_eq!(normalize_tail_key_mode("OFF"), "off");
        assert_eq!(normalize_tail_key_mode("invalid"), "smart");
    }

    #[test]
    fn tail_key_ids_dedupes_and_sanitizes() {
        let raw = vec![
            "Enter".to_string(),
            " enter ".to_string(),
            "NP_0".to_string(),
            "bad-key!$".to_string(),
            "".to_string(),
        ];
        assert_eq!(
            normalize_tail_key_ids(&raw),
            vec!["enter".to_string(), "np_0".to_string(), "badkey".to_string()]
        );
    }

    #[test]
    fn legacy_settings_json_deserializes_with_tail_defaults() {
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert_eq!(parsed.tail_key_mode, "smart");
        assert_eq!(parsed.tail_key_ids, default_tail_key_ids());
        assert!(!parsed.typing_sound_enabled);
    }

    #[test]
    fn typing_sound_enabled_round_trips_camel_case() {
        let raw = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "typingSoundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(raw).expect("settings with typingSoundEnabled should parse");
        assert!(parsed.typing_sound_enabled);

        let serialized = serde_json::to_value(&parsed).expect("settings should serialize");
        assert_eq!(serialized.get("typingSoundEnabled").and_then(|v| v.as_bool()), Some(true));

        let round_tripped: AppSettings = serde_json::from_value(serialized).expect("round-trip should parse");
        assert!(round_tripped.typing_sound_enabled);
    }

    #[test]
    fn live_capture_defaults_normalize_and_round_trip() {
        // Legacy JSON missing liveCapture* fields deserializes with safe defaults
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert!(!parsed.live_capture_enabled);
        assert_eq!(parsed.live_chroma_color, "blue");
        assert!(!parsed.live_hide_pet);

        // Normalization accepts blue / green / magenta case-insensitively and defaults to blue
        assert_eq!(normalize_live_chroma_color("blue"), "blue");
        assert_eq!(normalize_live_chroma_color(" GREEN "), "green");
        assert_eq!(normalize_live_chroma_color("MaGeNtA"), "magenta");
        assert_eq!(normalize_live_chroma_color("red"), "blue");
        assert_eq!(normalize_live_chroma_color(""), "blue");

        // CamelCase round-trip
        let mut s = AppSettings::default();
        s.live_capture_enabled = true;
        s.live_chroma_color = normalize_live_chroma_color("MAGENTA");
        s.live_hide_pet = true;

        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(
            serialized.get("liveCaptureEnabled").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            serialized.get("liveChromaColor").and_then(|v| v.as_str()),
            Some("magenta")
        );
        assert_eq!(
            serialized.get("liveHidePet").and_then(|v| v.as_bool()),
            Some(true)
        );

        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert!(round_tripped.live_capture_enabled);
        assert_eq!(round_tripped.live_chroma_color, "magenta");
        assert!(round_tripped.live_hide_pet);
    }

    #[test]
    fn opacity_defaults_normalize_and_round_trip() {
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert!((parsed.opacity - 1.0).abs() < 1e-6);

        assert!((normalize_opacity(0.65) - 0.65).abs() < 1e-6);
        assert!((normalize_opacity(65.0) - 0.65).abs() < 1e-6);
        assert!((normalize_opacity(0.05) - 0.20).abs() < 1e-6);
        assert!((normalize_opacity(1.8) - 1.0).abs() < 1e-6);
        assert!((normalize_opacity(150.0) - 1.0).abs() < 1e-6);
        assert!((normalize_opacity(f64::NAN) - 1.0).abs() < 1e-6);

        let mut s = AppSettings::default();
        s.opacity = normalize_opacity(0.55);
        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(serialized.get("opacity").and_then(|v| v.as_f64()), Some(0.55));
        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert!((round_tripped.opacity - 0.55).abs() < 1e-6);
    }

    #[test]
    fn sound_volume_and_mute_defaults_normalize_and_round_trip() {
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert!((parsed.sound_volume - 1.0).abs() < 1e-6);
        assert!(!parsed.sound_muted);
        assert!(!parsed.idle_purr_enabled);

        assert!((normalize_sound_volume(0.0) - 0.0).abs() < 1e-6);
        assert!((normalize_sound_volume(0.65) - 0.65).abs() < 1e-6);
        assert!((normalize_sound_volume(65.0) - 0.65).abs() < 1e-6);
        assert!((normalize_sound_volume(-0.2) - 0.0).abs() < 1e-6);
        assert!((normalize_sound_volume(1.8) - 1.0).abs() < 1e-6);
        assert!((normalize_sound_volume(150.0) - 1.0).abs() < 1e-6);
        assert!((normalize_sound_volume(f64::NAN) - 1.0).abs() < 1e-6);

        let mut s = AppSettings::default();
        assert!(!s.idle_purr_enabled);
        s.idle_purr_enabled = true;
        s.sound_volume = normalize_sound_volume(0.42);
        s.sound_muted = true;
        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(serialized.get("idlePurrEnabled").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(serialized.get("soundVolume").and_then(|v| v.as_f64()), Some(0.42));
        assert_eq!(serialized.get("soundMuted").and_then(|v| v.as_bool()), Some(true));
        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert!(round_tripped.idle_purr_enabled);
        assert!((round_tripped.sound_volume - 0.42).abs() < 1e-6);
        assert!(round_tripped.sound_muted);
    }

    #[test]
    fn layout_98_and_yield_on_fullscreen_round_trip() {
        assert_eq!(normalize_keyboard_layout("65"), "65");
        assert_eq!(normalize_keyboard_layout("98"), "98");
        assert_eq!(normalize_keyboard_layout(" 98 "), "98");
        assert_eq!(normalize_keyboard_layout("108"), "108");
        assert_eq!(normalize_keyboard_layout("unknown"), "65");

        let mut s = AppSettings::default();
        assert!(!s.yield_on_fullscreen);
        s.keyboard_layout = normalize_keyboard_layout("98");
        s.yield_on_fullscreen = true;
        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(
            serialized.get("keyboardLayout").and_then(|v| v.as_str()),
            Some("98")
        );
        assert_eq!(
            serialized.get("yieldOnFullscreen").and_then(|v| v.as_bool()),
            Some(true)
        );
        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert_eq!(round_tripped.keyboard_layout, "98");
        assert!(round_tripped.yield_on_fullscreen);
    }

    #[test]
    fn autostart_admin_defaults_false_and_round_trips() {
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": true
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert!(parsed.autostart);
        assert!(!parsed.autostart_admin);

        let mut s = AppSettings::default();
        assert!(s.autostart);
        assert!(!s.autostart_admin);
        // Existing user settings.json with explicit autostart=false must stay false across upgrades
        let existing_off = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed_off: AppSettings =
            serde_json::from_str(existing_off).expect("existing off json should parse");
        assert!(!parsed_off.autostart);
        s.autostart = true;
        s.autostart_admin = true;
        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(
            serialized.get("autostartAdmin").and_then(|v| v.as_bool()),
            Some(true)
        );
        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert!(round_tripped.autostart);
        assert!(round_tripped.autostart_admin);
    }

    #[test]
    fn treat_flavor_and_fed_count_defaults_and_round_trip() {
        assert_eq!(normalize_treat_flavor("tuna"), "tuna");
        assert_eq!(normalize_treat_flavor("CHICKEN"), "chicken");
        assert_eq!(normalize_treat_flavor(" salmon "), "salmon");
        assert_eq!(normalize_treat_flavor("bonito"), "bonito");
        assert_eq!(normalize_treat_flavor("invalid"), "tuna");

        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert_eq!(parsed.treat_flavor, "tuna");
        assert_eq!(parsed.treat_fed_count, 0);

        let mut s = AppSettings::default();
        s.treat_flavor = normalize_treat_flavor("salmon");
        s.treat_fed_count = 7;
        let serialized = serde_json::to_value(&s).expect("settings should serialize");
        assert_eq!(
            serialized.get("treatFlavor").and_then(|v| v.as_str()),
            Some("salmon")
        );
        assert_eq!(
            serialized.get("treatFedCount").and_then(|v| v.as_u64()),
            Some(7)
        );
        let round_tripped: AppSettings =
            serde_json::from_value(serialized).expect("round-trip should parse");
        assert_eq!(round_tripped.treat_flavor, "salmon");
        assert_eq!(round_tripped.treat_fed_count, 7);
    }

    #[test]
    fn lao_wu_handover_defaults_true_and_round_trips() {
        let fresh = AppSettings::default();
        assert!(fresh.lao_wu_handover);
        let mut legacy = serde_json::to_value(fresh).unwrap();
        legacy.as_object_mut().unwrap().remove("laoWuHandover");
        legacy["scale"] = serde_json::json!(0.8);
        for previous in [None, Some(false), Some(true)] {
            if let Some(previous) = previous {
                legacy["switchAnimation"] = serde_json::json!(previous);
            }
            let mut settings: AppSettings = serde_json::from_value(legacy.clone()).unwrap();
            assert!(settings.lao_wu_handover);
            for chosen in [false, true] {
                settings.lao_wu_handover = chosen;
                let saved = serde_json::to_value(&settings).unwrap();
                assert_eq!(saved["laoWuHandover"].as_bool(), Some(chosen));
                assert_eq!(
                    saved.get("switchAnimation").and_then(|v| v.as_bool()),
                    None
                );
                settings = serde_json::from_value(saved).unwrap();
                assert_eq!(settings.lao_wu_handover, chosen);
                assert_eq!(settings.scale, 0.8);
            }
        }
    }

    #[test]
    fn pause_hotkey_normalizes_parses_and_round_trips() {
        assert_eq!(default_pause_hotkey(), "Alt+Shift+P");
        assert_eq!(normalize_pause_hotkey("shift+alt+p"), "Alt+Shift+P");
        assert_eq!(normalize_pause_hotkey("ctrl + alt + KeyH"), "Ctrl+Alt+H");
        assert_eq!(normalize_pause_hotkey("f9"), "F9");
        assert_eq!(normalize_pause_hotkey("a"), "");
        assert_eq!(normalize_pause_hotkey("off"), "");
        assert_eq!(normalize_pause_hotkey(""), "");
        assert_eq!(parse_pause_hotkey_vk("Alt+Shift+P"), Some((false, true, true, 0x50)));
        assert_eq!(parse_pause_hotkey_vk("Ctrl+F9"), Some((true, false, false, 0x78)));
        assert_eq!(parse_pause_hotkey_vk(""), None);

        let mut s = AppSettings::default();
        assert_eq!(s.pause_hotkey, "Alt+Shift+P");
        s.pause_hotkey = normalize_pause_hotkey("ctrl+shift+k");
        let saved = serde_json::to_value(&s).unwrap();
        assert_eq!(saved["pauseHotkey"].as_str(), Some("Ctrl+Shift+K"));
        let back: AppSettings = serde_json::from_value(saved).unwrap();
        assert_eq!(back.pause_hotkey, "Ctrl+Shift+K");
    }

    #[test]
    fn eye_gaze_mode_defaults_screen_and_round_trips() {
        assert_eq!(default_eye_gaze_mode(), "screen");
        assert_eq!(normalize_eye_gaze_mode("window"), "window");
        assert_eq!(normalize_eye_gaze_mode(" WINDOW "), "window");
        assert_eq!(normalize_eye_gaze_mode("screen"), "screen");
        assert_eq!(normalize_eye_gaze_mode("unknown"), "screen");

        let mut s = AppSettings::default();
        assert_eq!(s.eye_gaze_mode, "screen");
        s.eye_gaze_mode = normalize_eye_gaze_mode("window");
        let saved = serde_json::to_value(&s).unwrap();
        assert_eq!(saved["eyeGazeMode"].as_str(), Some("window"));
        let back: AppSettings = serde_json::from_value(saved).unwrap();
        assert_eq!(back.eye_gaze_mode, "window");
    }

    #[test]
    fn default_keyboard_layout_uses_macbook_on_macos() {
        let expected = if cfg!(feature = "layout-108") {
            "108"
        } else if cfg!(target_os = "macos") {
            "macbook"
        } else {
            "65"
        };
        assert_eq!(default_keyboard_layout(), expected);
        assert_eq!(AppSettings::default().keyboard_layout, expected);
    }
}
