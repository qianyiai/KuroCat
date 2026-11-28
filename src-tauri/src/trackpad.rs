use crate::{input_hook, AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime};
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
    fn kc_pad_device_count() -> i32;
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
        let mut bound_devices: i32 = -1;
        let mut last_wall = SystemTime::now();
        let mut last_hotplug_check = Instant::now();
        let mut previous = Vec::new();
        let mut sample = [PadPoint::default(); 16];
        loop {
            let now = Instant::now();
            let wall_now = SystemTime::now();
            // Recover seamlessly after macOS sleep/wake (Instant pauses during sleep, SystemTime advances).
            if active
                && wall_now
                    .duration_since(last_wall)
                    .map(|d| d > Duration::from_secs(3))
                    .unwrap_or(false)
            {
                unsafe { kc_pad_stop() };
                active = false;
                bound_devices = -1;
            }
            last_wall = wall_now;

            let wanted = enabled && !input_hook::trackpad_suspended();
            // Periodically detect Bluetooth/USB Magic Trackpad connect/disconnect while idle.
            if wanted
                && active
                && previous.is_empty()
                && now.saturating_duration_since(last_hotplug_check) >= Duration::from_secs(4)
            {
                last_hotplug_check = now;
                let current_devices = unsafe { kc_pad_device_count() };
                if current_devices >= 0 && current_devices != bound_devices {
                    unsafe { kc_pad_stop() };
                    active = false;
                    bound_devices = -1;
                }
            }

            if wanted && !active {
                active = unsafe { kc_pad_start() } == 0;
                bound_devices = if active {
                    unsafe { kc_pad_device_count() }
                } else {
                    -1
                };
                last_hotplug_check = now;
            } else if !wanted && active {
                unsafe { kc_pad_stop() };
                active = false;
                bound_devices = -1;
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
                let _ = app.emit("kuro-input", event);
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
