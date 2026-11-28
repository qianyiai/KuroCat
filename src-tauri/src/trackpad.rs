use crate::{input_hook, AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct PadPoint {
    id: i32,
    x: f32,
    y: f32,
}

extern "C" {
    fn kc_pad_start() -> i32;
    fn kc_pad_stop();
    fn kc_pad_snapshot(out: *mut PadPoint) -> i32;
    fn kc_pad_click(out: *mut PadPoint) -> bool;
}

pub static UNAVAILABLE: AtomicBool = AtomicBool::new(false);

pub fn click_point() -> Option<PadPoint> {
    let mut point = PadPoint::default();
    (!input_hook::trackpad_suspended() && unsafe { kc_pad_click(&mut point) }).then_some(point)
}

pub fn watch(app: AppHandle) {
    let settings = app.state::<AppState>().settings.clone();
    let (send, recv) = mpsc::channel();
    app.listen("kuro-settings", move |event| {
        if let Ok(value) = serde_json::from_str::<crate::config::AppSettings>(event.payload()) {
            let _ = send.send(value.trackpad_enabled);
        }
    });
    std::thread::spawn(move || {
        let mut enabled = settings.lock().unwrap().trackpad_enabled;
        let mut active = false;
        let mut previous = Vec::new();
        let mut sample = [PadPoint::default(); 16];
        loop {
            let wanted = enabled && !input_hook::trackpad_suspended();
            if wanted && !active {
                active = unsafe { kc_pad_start() } == 0;
            } else if !wanted && active {
                unsafe { kc_pad_stop() };
                active = false;
            }
            let unavailable = wanted && !active;
            if UNAVAILABLE.swap(unavailable, Ordering::Relaxed) != unavailable {
                let _ = app.emit("kuro-trackpad-unavailable", unavailable);
            }
            let count = if active {
                (unsafe { kc_pad_snapshot(sample.as_mut_ptr()) }) as usize
            } else {
                0
            };
            let frame = &sample[..count.min(sample.len())];
            if previous.as_slice() != frame {
                previous.clear();
                previous.extend_from_slice(frame);
                let event = input_hook::InputEvent::Trackpad {
                    points: previous.clone(),
                };
                crate::obs::broadcast_input(&event);
                let _ = app.emit_to("main", "kuro-input", event);
            }
            if enabled {
                let delay = if active {
                    16
                } else if unavailable {
                    3000
                } else {
                    200
                };
                match recv.recv_timeout(Duration::from_millis(delay)) {
                    Ok(value) => enabled = value,
                    Err(RecvTimeoutError::Timeout) => (),
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            } else if let Ok(value) = recv.recv() {
                enabled = value;
            } else {
                break;
            }
        }
        if active {
            unsafe { kc_pad_stop() };
        }
    });
}
