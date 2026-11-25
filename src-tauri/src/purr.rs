//! Custom purr recording: the user picks an audio file, we keep a copy as
//! `purr.<ext>` in the app data dir, and the pet window plays it instead of the
//! built-in synthesized purr. No file → built-in purr.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

use crate::config::app_data_dir;

pub const PURR_EXTENSIONS: [&str; 5] = ["mp3", "wav", "ogg", "m4a", "flac"];
/// A purr loop never needs more than a short clip; this keeps decoding cheap.
pub const MAX_PURR_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const PURR_CHANGED_EVENT: &str = "kuro-purr-changed";

fn purr_path_for(ext: &str) -> PathBuf {
    app_data_dir().join(format!("purr.{ext}"))
}

/// Lower-cased extension of `path` if it is one we accept.
pub fn accepted_extension(path: &std::path::Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    PURR_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

pub fn custom_purr_path() -> Option<PathBuf> {
    PURR_EXTENSIONS
        .iter()
        .map(|ext| purr_path_for(ext))
        .find(|p| p.is_file())
}

fn remove_custom_purr_files() -> std::io::Result<()> {
    for ext in PURR_EXTENSIONS {
        let p = purr_path_for(ext);
        if p.is_file() {
            fs::remove_file(p)?;
        }
    }
    Ok(())
}

/// Hides the context menu and waits until it is really gone: the file picker
/// runs a modal loop on the main thread, and a hide request still queued behind
/// it would leave the always-on-top menu covering the picker.
fn hide_menu_now(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("menu") {
        let (tx, rx) = std::sync::mpsc::channel();
        if app
            .run_on_main_thread(move || {
                let _ = w.hide();
                let _ = tx.send(());
            })
            .is_ok()
        {
            let _ = rx.recv_timeout(std::time::Duration::from_millis(500));
        }
    }
    app.state::<crate::AppState>()
        .menu_open
        .store(false, Ordering::Relaxed);
}

pub const PURR_ERROR_EVENT: &str = "kuro-purr-error";

/// Opens the system file picker and installs the chosen recording.
/// Returns `false` when the user cancels. Failures are also emitted as
/// [`PURR_ERROR_EVENT`] because the menu that asked is hidden by then and the
/// pet window shows the message.
#[tauri::command]
pub async fn pick_custom_purr(app: AppHandle) -> Result<bool, String> {
    hide_menu_now(&app);
    let result = pick_and_install(&app).await;
    match &result {
        Ok(true) => {
            let _ = app.emit(PURR_CHANGED_EVENT, true);
        }
        Ok(false) => {}
        Err(msg) => {
            let _ = app.emit(PURR_ERROR_EVENT, msg.clone());
        }
    }
    result
}

/// Shows a standalone file picker. It runs on the main thread with rfd's
/// blocking API: the async API attaches the picker as a sheet to the pet
/// window on macOS, which makes the system move the pet out of the way.
async fn pick_file(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let picked = rfd::FileDialog::new()
            .set_title("选择猫咪呼噜录音")
            .add_filter("音频", &PURR_EXTENSIONS)
            .pick_file();
        let _ = tx.send(picked);
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

async fn pick_and_install(app: &AppHandle) -> Result<bool, String> {
    let Some(src) = pick_file(app).await? else {
        return Ok(false);
    };
    let ext = accepted_extension(&src)
        .ok_or_else(|| "只支持 mp3、wav、ogg、m4a、flac 格式的录音".to_string())?;
    let size = fs::metadata(&src).map_err(|e| e.to_string())?.len();
    if size > MAX_PURR_FILE_BYTES {
        return Err("录音文件超过 10 MB，请剪一段短一点的呼噜声".to_string());
    }

    fs::create_dir_all(app_data_dir()).map_err(|e| e.to_string())?;
    remove_custom_purr_files().map_err(|e| e.to_string())?;
    fs::copy(&src, purr_path_for(&ext)).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn clear_custom_purr(app: AppHandle) -> Result<(), String> {
    remove_custom_purr_files().map_err(|e| e.to_string())?;
    let _ = app.emit(PURR_CHANGED_EVENT, false);
    Ok(())
}

#[tauri::command]
pub fn has_custom_purr() -> bool {
    custom_purr_path().is_some()
}

/// Raw bytes of the custom recording; empty when none is installed.
#[tauri::command]
pub fn get_custom_purr() -> tauri::ipc::Response {
    let bytes = custom_purr_path()
        .and_then(|p| fs::read(p).ok())
        .unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn accepts_known_audio_extensions_case_insensitively() {
        assert_eq!(accepted_extension(Path::new("/a/Purr.MP3")).as_deref(), Some("mp3"));
        assert_eq!(accepted_extension(Path::new("cat.flac")).as_deref(), Some("flac"));
        assert_eq!(accepted_extension(Path::new("cat.m4a")).as_deref(), Some("m4a"));
    }

    #[test]
    fn rejects_other_files() {
        assert_eq!(accepted_extension(Path::new("cat.exe")), None);
        assert_eq!(accepted_extension(Path::new("purr")), None);
        assert_eq!(accepted_extension(Path::new("cat.mp3.txt")), None);
    }
}
