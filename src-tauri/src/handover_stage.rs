use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalSize, WebviewWindow};

use crate::AppState;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StageBounds {
    base_width: f64,
    base_height: f64,
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
}

#[derive(Clone, Copy)]
struct Active {
    id: u64,
    bounds: StageBounds,
}

#[derive(Default)]
pub(crate) struct HandoverStage(Mutex<Session>);

#[derive(Default)]
struct Session {
    latest: u64,
    active: Option<Active>,
}

fn on_window_thread<T: Send + 'static>(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    // A drag can originate on the input thread. Serialize it with begin/end
    // before reading the host's width for anchoring, without locking across IPC.
    let (send, recv) = mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(action(&handle));
    })
    .map_err(|e| e.to_string())?;
    recv.recv().map_err(|e| e.to_string())?
}

fn restore(win: &WebviewWindow, active: Active) -> Result<(), String> {
    let b = active.bounds;
    if b.width == b.base_width {
        return Ok(());
    }
    let dpi = win.scale_factor().map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(
        (b.base_width * dpi).round() as u32,
        (b.base_height * dpi).round() as u32,
    ))
    .map_err(|e| e.to_string())
}

fn right_extension(left: i32, width: u32, work_right: i64, requested: u32) -> u32 {
    (work_right - i64::from(left) - i64::from(width)).clamp(0, i64::from(requested)) as u32
}

#[tauri::command]
pub(crate) fn begin_handover_stage(app: AppHandle, stage_id: u64) -> Result<StageBounds, String> {
    on_window_thread(&app, move |app| {
        let holder = app.state::<HandoverStage>();
        let old = {
            let mut session = holder.0.lock().unwrap();
            if session.latest == stage_id {
                if let Some(active) = session.active.filter(|a| a.id == stage_id) {
                    return Ok(active.bounds);
                }
            }
            if stage_id <= session.latest {
                return Err("Stage request has ended".into());
            }
            session.latest = stage_id;
            session.active
        };
        let win = app
            .get_webview_window("main")
            .ok_or("Pet window is closed")?;
        if let Some(active) = old {
            restore(&win, active)?;
            holder.0.lock().unwrap().active = None;
        }
        let state = app.state::<AppState>();
        if state.dragging.load(Ordering::Acquire) {
            return Err("Pet is being dragged".into());
        }
        let scale = {
            let s = state.settings.lock().unwrap();
            if !s.lao_wu_handover {
                return Err("Handover animation is disabled".into());
            }
            s.scale.clamp(0.2, 1.5)
        };
        let dpi = win.scale_factor().map_err(|e| e.to_string())?;
        let size = win.inner_size().map_err(|e| e.to_string())?;
        let origin = win.inner_position().map_err(|e| e.to_string())?;
        let monitor = win
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("No pet monitor")?;
        let area = monitor.work_area();
        let right = i64::from(area.position.x) + i64::from(area.size.width);
        let extension = right_extension(
            origin.x,
            size.width,
            right,
            (470.0 * scale * dpi).round() as u32,
        );
        #[cfg(windows)]
        let extension = if crate::win_needs_win7_ulw() {
            0
        } else {
            extension
        };
        if extension != 0 {
            win.set_size(PhysicalSize::new(
                size.width.saturating_add(extension),
                size.height,
            ))
            .map_err(|e| e.to_string())?;
        }
        let bounds = StageBounds {
            base_width: f64::from(size.width) / dpi,
            base_height: f64::from(size.height) / dpi,
            width: f64::from(size.width.saturating_add(extension)) / dpi,
            height: f64::from(size.height) / dpi,
            offset_x: 0.0,
            offset_y: 0.0,
        };
        holder.0.lock().unwrap().active = Some(Active {
            id: stage_id,
            bounds,
        });
        Ok(bounds)
    })
}

fn finish(app: &AppHandle, id: u64, notify: bool) -> Result<(), String> {
    on_window_thread(app, move |app| {
        let holder = app.state::<HandoverStage>();
        let active = {
            let mut session = holder.0.lock().unwrap();
            // A cancelled begin may still be queued behind this command.
            session.latest = session.latest.max(id);
            session.active.filter(|a| a.id == id)
        };
        if let Some(active) = active {
            if let Some(win) = app.get_webview_window("main") {
                restore(&win, active)?;
            }
            holder.0.lock().unwrap().active = None;
            if notify {
                let _ = app.emit_to(
                    "main",
                    "kuro-handover-stage-cancelled",
                    serde_json::json!({"stageId":id}),
                );
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn end_handover_stage(app: AppHandle, stage_id: u64) -> Result<(), String> {
    finish(&app, stage_id, false)
}

pub(crate) fn cancel(app: &AppHandle) {
    let active = app.state::<HandoverStage>().0.lock().unwrap().active;
    if let Some(active) = active {
        let _ = finish(app, active.id, true);
    }
}

pub(crate) fn dpi_changed(app: &AppHandle) {
    let active = app.state::<HandoverStage>().0.lock().unwrap().active;
    if let Some(active) = active {
        // Let the OS finish applying the suggested rectangle first, then
        // restore the logical host size at the new DPI. A later stage is safe.
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = finish(&app, active.id, true);
        });
    }
}

pub(crate) fn hit_width(app: &AppHandle, dpi: f64, actual: f64) -> f64 {
    app.state::<HandoverStage>()
        .0
        .lock()
        .unwrap()
        .active
        .map_or(actual, |a| a.bounds.base_width * dpi)
}

#[cfg(test)]
mod tests {
    use super::right_extension;
    #[test]
    fn clips_extension_at_the_current_monitor_without_moving_the_host() {
        assert_eq!(right_extension(200, 420, 1920, 470), 470);
        assert_eq!(right_extension(1450, 420, 1920, 470), 50);
        assert_eq!(right_extension(1510, 420, 1920, 470), 0);
        assert_eq!(right_extension(-1100, 630, -100, 705), 370);
    }
}
