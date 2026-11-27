#![recursion_limit = "256"]

mod cats;
mod config;
mod companion;
mod game_detect;
mod i18n;
mod input_hook;
#[cfg(target_os = "macos")]
mod macos_window;
mod mcp;
mod obs;
mod privacy;
mod tray;
mod updater;
#[cfg(windows)]
mod win7_layered;
#[cfg(windows)]
mod windows_display;

#[cfg(windows)]
const WIN7_OFFSCREEN_PARK_POS: i32 = -16000;

use cats::{all_cats, cat_exists, cats_path, sanitize_cat_id, CatSkinConfig};
use config::{
    config_path, load_settings, normalize_keyboard_layout, normalize_keyboard_orientation,
    normalize_tail_key_ids, normalize_tail_key_mode, save_settings, set_windows_autostart,
    try_save_settings, AppSettings,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Listener, LogicalSize, Manager, PhysicalPosition, Size, State};

pub const BASE_WIDTH: f64 = 420.0;
pub const BASE_HEIGHT: f64 = 440.0;
pub const BASE_WIDTH_108: f64 = 540.0;
pub const BASE_HEIGHT_108: f64 = 456.0;
pub const MIN_WINDOW_WIDTH: f64 = 100.0;
pub const MIN_WINDOW_HEIGHT: f64 = 100.0;
#[cfg(windows)]
pub const WIN7_MIN_WINDOW_WIDTH: f64 = 260.0;
#[cfg(windows)]
pub const WIN7_MIN_WINDOW_HEIGHT: f64 = 410.0;

pub fn base_dimensions(layout: &str) -> (f64, f64) {
    if layout == "108" {
        (BASE_WIDTH_108, BASE_HEIGHT_108)
    } else {
        (BASE_WIDTH, BASE_HEIGHT)
    }
}

pub fn window_dimensions(layout: &str, scale: f64) -> (f64, f64) {
    let (bw, bh) = base_dimensions(layout);
    let s = scale.clamp(0.20, 1.50);
    #[cfg(windows)]
    let (min_w, min_h) = if win_needs_win7_ulw() {
        (WIN7_MIN_WINDOW_WIDTH, WIN7_MIN_WINDOW_HEIGHT)
    } else {
        (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    };
    #[cfg(not(windows))]
    let (min_w, min_h) = (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
    (
        (bw * s).round().max(min_w),
        (bh * s).round().max(min_h),
    )
}

/// Clamps a dragged pet window's top-left physical position against the virtual desktop bounds
/// while explicitly allowing the transparent headspace above the cat's ears (~17% of window height)
/// to slide above the screen top edge (`y < v_top`), so the cat itself can reach the very top bezel
/// without ever getting lost off-screen.
#[cfg(any(windows, test))]
fn clamp_pet_drag_position(
    x: i32,
    y: i32,
    win_w: i32,
    win_h: i32,
    v_left: i32,
    v_top: i32,
    v_width: i32,
    v_height: i32,
) -> (i32, i32) {
    let v_right = v_left + v_width.max(320);
    let v_bottom = v_top + v_height.max(240);

    // Transparent visual padding around the cat/keyboard inside the window:
    // ~17% empty air above the ears/headset; 28% side margin allows intentional deep edge-peek push (>=24%)
    // while always keeping >=72% of the pet window safely on-screen and grabbable on primary/secondary monitors.
    let top_headroom = ((win_h as f64) * 0.17).round() as i32;
    let side_margin = ((win_w as f64) * 0.28).round() as i32;
    let min_visible_h = ((win_h as f64) * 0.56).round() as i32;

    let min_x = v_left - side_margin;
    let max_x = (v_right - win_w + side_margin).max(min_x);
    let min_y = v_top - top_headroom;
    let max_y = (v_bottom - min_visible_h).max(min_y);

    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

/// Computes the union bounding box `(min_x, min_y, max_x, max_y)` in AppKit Y-up points
/// across all connected `NSScreen` frames `(origin_x, origin_y, width, height)`.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_screens_union(frames: &[(f64, f64, f64, f64)]) -> Option<(f64, f64, f64, f64)> {
    let mut iter = frames.iter().copied();
    let (x0, y0, w0, h0) = iter.next()?;
    let mut min_x = x0;
    let mut min_y = y0;
    let mut max_x = x0 + w0.max(0.0);
    let mut max_y = y0 + h0.max(0.0);
    for (x, y, w, h) in iter {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w.max(0.0));
        max_y = max_y.max(y + h.max(0.0));
    }
    Some((min_x, min_y, max_x, max_y))
}

/// Computes valid AppKit bottom-left `frame.origin` bounds `(min_x, max_x, min_y, max_y)` for a
/// dragged pet window across the multi-screen union box, allowing ~17% transparent headspace
/// above the cat's ears to slide past the screen top edge while keeping >=68% visible above the
/// bottom edge and 28% side margins so users can deliberately push >=24% to enter Edge-Peek.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_drag_bounds(
    win_w: f64,
    win_h: f64,
    union_min_x: f64,
    union_min_y: f64,
    union_max_x: f64,
    union_max_y: f64,
) -> (f64, f64, f64, f64) {
    let win_w = win_w.max(1.0);
    let win_h = win_h.max(1.0);
    let v_width = (union_max_x - union_min_x).max(320.0);
    let v_height = (union_max_y - union_min_y).max(240.0);
    let v_right = union_min_x + v_width;
    let v_top = union_min_y + v_height;

    let top_headroom = (win_h * 0.17).round();
    let side_margin = (win_w * 0.28).round();
    let min_visible_h = (win_h * 0.68).round();

    let min_x = union_min_x - side_margin;
    let max_x = (v_right - win_w + side_margin).max(min_x);
    // AppKit Y-up: `origin.y` is the window bottom edge; `origin.y + win_h` is the top edge.
    let min_y = union_min_y + min_visible_h - win_h;
    let max_y = (v_top - win_h + top_headroom).max(min_y);

    (min_x, max_x, min_y, max_y)
}

/// Converts a Quartz Y-down point (logical pts) into AppKit Y-up global coordinates (logical pts).
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_quartz_to_appkit_point(
    cg_x: f64,
    cg_y: f64,
    primary_height: f64,
) -> (f64, f64) {
    (cg_x, primary_height - cg_y)
}

/// Finds the active macOS screen's `visibleFrame` `(vx, vy, vw, vh)` in AppKit logical points
/// containing the query point `(px, py)` (in AppKit logical points), matching against full
/// `frame` bounds so points over the Dock or menu bar still resolve to the right display.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_active_visible_frame(
    screens: &[((f64, f64, f64, f64), (f64, f64, f64, f64))],
    px: f64,
    py: f64,
) -> Option<(f64, f64, f64, f64)> {
    screens
        .iter()
        .copied()
        .find(|&((fx, fy, fw, fh), _)| px >= fx && px < fx + fw && py >= fy && py < fy + fh)
        .map(|(_, vis)| vis)
        .or_else(|| {
            screens
                .iter()
                .copied()
                .min_by(|((ax, ay, aw, ah), _), ((bx, by, bw, bh), _)| {
                    let da = (px - (ax + aw * 0.5)).hypot(py - (ay + ah * 0.5));
                    let db = (px - (bx + bw * 0.5)).hypot(py - (by + bh * 0.5));
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(_, vis)| vis)
        })
}

/// Computes the flush AppKit logical-point `frame.origin` `(sx, sy)` when snapping into
/// left/right Edge-Peek against a screen's `visibleFrame` `(vx, vy, vw, vh)`.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_peek_snap_origin(
    edge: &str,
    win_y: f64,
    win_w: f64,
    win_h: f64,
    visible_frame: (f64, f64, f64, f64),
) -> Option<(f64, f64)> {
    let (vx, vy, vw, vh) = visible_frame;
    let clamped_y = win_y.clamp(vy, (vy + vh - win_h).max(vy));
    match edge {
        "left" => Some((vx, clamped_y)),
        "right" => Some((vx + vw - win_w, clamped_y)),
        _ => None,
    }
}

/// Converts a Quartz Y-down cursor delta `(cur_cursor - start_cursor)` into a clamped AppKit
/// Y-up window `frame.origin`.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn macos_drag_target_origin(
    start_origin: (f64, f64),
    start_cursor: (f64, f64),
    cur_cursor: (f64, f64),
    bounds: (f64, f64, f64, f64),
) -> (f64, f64) {
    let dx = cur_cursor.0 - start_cursor.0;
    let dy = cur_cursor.1 - start_cursor.1;
    let raw_x = start_origin.0 + dx;
    let raw_y = start_origin.1 - dy;
    let (min_x, max_x, min_y, max_y) = bounds;
    (raw_x.clamp(min_x, max_x), raw_y.clamp(min_y, max_y))
}

/// Computes the flush physical-pixel top-left origin `(sx, sy)` when snapping into left/right
/// Edge-Peek against a monitor work area `(wx, wy, ww, wh)`.
#[cfg(any(not(target_os = "macos"), test))]
#[allow(clippy::too_many_arguments)]
fn compute_edge_peek_snap_pos(
    edge: &str,
    pos_y: i32,
    win_w: i32,
    win_h: i32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> Option<(i32, i32)> {
    let clamped_y = pos_y.clamp(wy, (wy + wh - win_h).max(wy));
    match edge {
        "left" => Some((wx, clamped_y)),
        "right" => Some((wx + ww - win_w, clamped_y)),
        _ => None,
    }
}

/// Computes the anchored window top-left `(new_x, new_y)` after changing scale or keyboard layout:
/// - In `"left"` Edge-Peek, keeps the LEFT edge flush against the bezel and preserves vertical midpoint.
/// - In `"right"` Edge-Peek, keeps the RIGHT edge flush against the bezel and preserves vertical midpoint.
/// - Otherwise preserves the classic bottom-right anchor.
fn compute_anchored_resize_pos(
    peek_edge: &str,
    old_x: i32,
    old_y: i32,
    old_w: i32,
    old_h: i32,
    new_w: i32,
    new_h: i32,
) -> (i32, i32) {
    match peek_edge {
        "left" => (old_x, old_y + (old_h - new_h) / 2),
        "right" => (old_x + old_w - new_w, old_y + (old_h - new_h) / 2),
        _ => (old_x + old_w - new_w, old_y + old_h - new_h),
    }
}

fn resize_window_anchored_bottom_right(
    win: &tauri::WebviewWindow,
    layout: &str,
    scale: f64,
) -> Option<(i32, i32)> {
    let (new_w, new_h) = window_dimensions(layout, scale);
    let active_peek_edge = win
        .state::<AppState>()
        .peek_edge
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "none".to_string());
    #[cfg(target_os = "macos")]
    if win
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .display_id
        .is_some()
    {
        macos_window::resize_pinned(win, new_w, new_h);
        return None;
    }
    #[cfg(windows)]
    {
        let preferred = win
            .state::<AppState>()
            .settings
            .lock()
            .unwrap()
            .windows_display_id
            .clone();
        if let Some(id) = preferred.as_deref() {
            if active_peek_edge == "none" {
                return windows_display::resize_pinned(win, id, new_w, new_h);
            }
        }
    }
    let sf = win.scale_factor().unwrap_or(1.0);

    #[cfg(windows)]
    if win_needs_win7_ulw() {
        let old_rect = win7_layered::get_rect();
        let _ = win.set_size(Size::Logical(LogicalSize::new(new_w, new_h)));
        let new_pw = (new_w * sf).round() as i32;
        let new_ph = (new_h * sf).round() as i32;
        if let Some((ox, oy, ow, oh)) = old_rect {
            let (new_x, new_y) = compute_anchored_resize_pos(
                &active_peek_edge,
                ox,
                oy,
                ow,
                oh,
                new_pw,
                new_ph,
            );
            if new_x != ox || new_y != oy {
                win7_layered::set_position(new_x, new_y);
            }
            if win7_layered::is_overlay_active() {
                let _ = win.set_position(PhysicalPosition::new(new_x, new_y));
            } else {
                let _ = win.set_position(PhysicalPosition::new(
                    WIN7_OFFSCREEN_PARK_POS,
                    WIN7_OFFSCREEN_PARK_POS,
                ));
            }
            return Some((new_x, new_y));
        }
        return None;
    }

    let old_pos = win.outer_position().ok();
    let old_size = win.outer_size().ok();
    let _ = win.set_size(Size::Logical(LogicalSize::new(new_w, new_h)));

    if let (Some(pos), Some(sz)) = (old_pos, old_size) {
        // Read actual post-resize physical outer_size when available so fractional DPI (125%/150%)
        // never introduces a 1px right-edge rounding seam during Edge-Peek.
        let actual_sz = win.outer_size().ok();
        let new_pw = actual_sz
            .map(|s| s.width as i32)
            .unwrap_or_else(|| (new_w * sf).round() as i32);
        let new_ph = actual_sz
            .map(|s| s.height as i32)
            .unwrap_or_else(|| (new_h * sf).round() as i32);
        let (new_x, new_y) = compute_anchored_resize_pos(
            &active_peek_edge,
            pos.x,
            pos.y,
            sz.width as i32,
            sz.height as i32,
            new_pw,
            new_ph,
        );
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let (new_x, new_y) = (new_x.max(0), new_y.max(0));
        if new_x != pos.x || new_y != pos.y {
            let _ = win.set_position(PhysicalPosition::new(new_x, new_y));
        }
        return Some((new_x, new_y));
    }
    None
}

pub fn is_pet_visible(app: &AppHandle) -> bool {
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        return win7_layered::is_visible();
    }
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true)
}

pub fn set_pet_visible(app: &AppHandle, visible: bool) {
    #[cfg(windows)]
    let on_top = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .always_on_top;
    #[cfg(target_os = "linux")]
    let saved_position = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        settings.x.zip(settings.y)
    };

    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::set_visible(visible);
        if !visible {
            let _ = app.emit("kuro-win7-close-menu", ());
            win7_layered::set_overlay_active(false);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_position(PhysicalPosition::new(
                    WIN7_OFFSCREEN_PARK_POS,
                    WIN7_OFFSCREEN_PARK_POS,
                ));
            }
        } else if on_top {
            win7_layered::reassert_topmost();
        }
        let _ = app.emit("kuro-win7-visibility", visible);
        return;
    }

    if let Some(win) = app.get_webview_window("main") {
        if visible {
            let _ = win.show();
            #[cfg(target_os = "linux")]
            if let Some((x, y)) = saved_position {
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
            #[cfg(windows)]
            if on_top {
                win_gentle_reassert_topmost(&win);
            }
        } else {
            #[cfg(target_os = "linux")]
            if let Ok(position) = win.outer_position() {
                let state = app.state::<AppState>();
                let mut settings = state.settings.lock().unwrap();
                settings.x = Some(position.x);
                settings.y = Some(position.y);
                save_settings(&settings);
            }
            let _ = win.hide();
        }
    }
}

pub fn set_pet_always_on_top(app: &AppHandle, on_top: bool) {
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::set_always_on_top(on_top);
    }
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        macos_window::configure_fullscreen(&win, on_top);
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_always_on_top(on_top);
    }
}

static APP_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static APP_HANDLE_FOR_SHUTDOWN: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

pub(crate) fn should_hide_desktop_pet(s: &AppSettings) -> bool {
    (s.obs_enabled && s.obs_hide_pet) || (s.live_capture_enabled && s.live_hide_pet)
}

pub fn shutdown_pet_windows() {
    APP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
    obs::shutdown_obs_server();
    if let Some(app) = APP_HANDLE_FOR_SHUTDOWN.get() {
        if let Some(w) = app.get_webview_window("live") {
            let _ = w.destroy();
        }
    }
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::shutdown();
    }
    release_single_instance_lock();
}

/// Synchronizes the dedicated borderless chroma-key capture window (`KuroCat Live`) used by
/// Douyin / Kuaishou / Huya / Bilibili Live Companion Window Capture + Chroma Key.
/// Always builds new WebView2 windows on a background thread guarded by `live_creating` so
/// synchronous Tauri commands and tray menu handlers never deadlock the Windows UI message loop.
pub fn sync_live_capture_window(app: &AppHandle, enabled: bool, layout: &str) {
    if !enabled {
        if let Some(w) = app.get_webview_window("live") {
            let _ = w.destroy();
        }
        return;
    }

    let (lw, lh) = window_dimensions(layout, 1.0);
    if let Some(existing) = app.get_webview_window("live") {
        let _ = existing.set_size(Size::Logical(LogicalSize::new(lw, lh)));
        let _ = existing.unminimize();
        let _ = existing.show();
        return;
    }

    let creating_flag = app.state::<AppState>().live_creating.clone();
    if creating_flag
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let app_c = app.clone();
    let layout_c = layout.to_string();
    std::thread::spawn(move || {
        struct ResetFlag(Arc<AtomicBool>);
        impl Drop for ResetFlag {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _reset_guard = ResetFlag(creating_flag);

        if APP_SHUTTING_DOWN.load(Ordering::Acquire) {
            return;
        }
        if !app_c
            .state::<AppState>()
            .settings
            .lock()
            .unwrap()
            .live_capture_enabled
        {
            return;
        }
        if let Some(existing) = app_c.get_webview_window("live") {
            let (cur_lw, cur_lh) = window_dimensions(&layout_c, 1.0);
            let _ = existing.set_size(Size::Logical(LogicalSize::new(cur_lw, cur_lh)));
            let _ = existing.unminimize();
            let _ = existing.show();
            return;
        }

        let created = match tauri::WebviewWindowBuilder::new(
            &app_c,
            "live",
            tauri::WebviewUrl::App("obs.html?live=1".into()),
        )
        .title("KuroCat Live")
        .inner_size(lw, lh)
        .min_inner_size(240.0, 170.0)
        .decorations(false)
        .resizable(true)
        .transparent(false)
        .shadow(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .additional_browser_args(WEBVIEW_BROWSER_ARGS)
        .build()
        {
            Ok(w) => w,
            Err(err) => {
                eprintln!(
                    "[kurocat] sync_live_capture_window: failed to build live window: {err}"
                );
                return;
            }
        };

        let (still_enabled, cur_layout) = {
            let state = app_c.state::<AppState>();
            let s = state.settings.lock().unwrap();
            (s.live_capture_enabled, s.keyboard_layout.clone())
        };
        if APP_SHUTTING_DOWN.load(Ordering::Acquire) || !still_enabled {
            let _ = created.destroy();
            return;
        }
        if cur_layout != layout_c {
            let (nlw, nlh) = window_dimensions(&cur_layout, 1.0);
            let _ = created.set_size(Size::Logical(LogicalSize::new(nlw, nlh)));
        }

        let app_ev = app_c.clone();
        created.on_window_event(move |event| match event {
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                if APP_SHUTTING_DOWN.load(Ordering::Acquire) {
                    return;
                }
                let state = app_ev.state::<AppState>();
                let updated_opt = {
                    let mut s = state.settings.lock().unwrap();
                    if s.live_capture_enabled || s.live_hide_pet {
                        s.live_capture_enabled = false;
                        s.live_hide_pet = false;
                        save_settings(&s);
                        Some(s.clone())
                    } else {
                        None
                    }
                };
                if let Some(updated) = updated_opt {
                    if !should_hide_desktop_pet(&updated)
                        && !state.paused_guard.load(Ordering::Relaxed)
                    {
                        set_pet_visible(&app_ev, true);
                    }
                    tray::sync_checkmarks(&updated);
                    let _ = app_ev.emit("kuro-settings", updated);
                }
            }
            _ => {}
        });
    });
}

#[tauri::command]
async fn close_live_capture_window(app: AppHandle) {
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.live_capture_enabled = false;
        s.live_hide_pet = false;
        save_settings(&s);
        s.clone()
    };
    if !should_hide_desktop_pet(&updated) && !state.paused_guard.load(Ordering::Relaxed) {
        set_pet_visible(&app, true);
    }
    tray::sync_checkmarks(&updated);
    let _ = app.emit("kuro-settings", updated);
    if let Some(w) = app.get_webview_window("live") {
        let _ = w.destroy();
    }
}

pub fn run_mcp_stdio() {
    mcp::run_stdio_mcp();
}

pub fn run_hook_cli(args: &[String]) {
    mcp::run_hook_cli(args);
}

pub struct AppState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub menu_open: Arc<AtomicBool>,
    tail_picker_bounds: Arc<Mutex<Option<TailPickerBounds>>>,
    pub menu_creating: Arc<AtomicBool>,
    pub live_creating: Arc<AtomicBool>,
    pub menu_close_gen: Arc<AtomicU64>,
    pub menu_opened_at: Arc<Mutex<Instant>>,
    pub dragging: Arc<AtomicBool>,
    pub mcp_enabled: Arc<AtomicBool>,
    pub update_banner_open: Arc<AtomicBool>,
    pub paused_guard: Arc<AtomicBool>,
    pub peek_edge: Arc<Mutex<String>>,
    pub peek_preview_edge: Arc<Mutex<String>>,
}

/// Shared Chromium / WebView2 lean runtime flags.
/// IMPORTANT: Must match `src-tauri/tauri.conf.json`'s `additionalBrowserArgs` byte-for-byte;
/// otherwise Windows WebView2 rejects creating the 2nd ("menu") window with HRESULT 0x8007139F.
const WEBVIEW_BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required --disable-background-networking --disable-sync --disable-extensions --disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints --js-flags=--max-old-space-size=96";

const SIDE_MENU_IDLE_DESTROY_SECS: u64 = 25;

fn schedule_side_menu_idle_destroy(app: AppHandle) {
    let gen = app
        .state::<AppState>()
        .menu_close_gen
        .fetch_add(1, Ordering::AcqRel)
        + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(SIDE_MENU_IDLE_DESTROY_SECS));
        let state = app.state::<AppState>();
        if state.menu_open.load(Ordering::Acquire)
            || state.menu_creating.load(Ordering::Acquire)
            || state.menu_close_gen.load(Ordering::Acquire) != gen
        {
            return;
        }
        if let Some(menu_win) = app.get_webview_window("menu") {
            // Fully destroy the hidden 2nd WebView2 renderer process after idle grace period
            // to reclaim ~35-55 MB RAM while keeping rapid reopen instant inside the window.
            let _ = menu_win.destroy();
        }
    });
}

#[tauri::command]
fn get_resolved_locale(state: State<'_, AppState>) -> String {
    let lang = state.settings.lock().unwrap().language.clone();
    i18n::effective_locale(&lang).to_string()
}

#[tauri::command]
fn trim_idle_memory() {
    #[cfg(windows)]
    {
        static LAST_TRIM_MS: AtomicU64 = AtomicU64::new(0);
        let now_ms = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let prev = LAST_TRIM_MS.load(Ordering::Relaxed);
        if now_ms.saturating_sub(prev) < 45_000 {
            return;
        }
        LAST_TRIM_MS.store(now_ms, Ordering::Relaxed);

        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn SetProcessWorkingSetSize(
                h_process: isize,
                dw_minimum_working_set_size: usize,
                dw_maximum_working_set_size: usize,
            ) -> i32;
        }
        unsafe {
            let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCursorInfo {
    rel_x: f64,
    rel_y: f64,
    inside_window: bool,
    over_cat: bool,
    alt_override: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TailPickerBounds {
    toolbar: [f64; 4],
    keyboard: [f64; 4],
    close_button: [f64; 4],
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn get_cats() -> Vec<CatSkinConfig> {
    all_cats()
}

#[tauri::command]
fn get_game_active() -> bool {
    game_detect::is_game_active()
}

#[tauri::command]
fn get_mcp_config() -> String {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "KuroCat.exe".to_string());
    // Pure, conflict-free Stdio MCP config (compatible with Antigravity, Claude Desktop/Code,
    // Cursor, Codex, WorkBuddy, Windsurf, Trae; HTTP Streamable endpoint is also live on /mcp).
    serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": {
            "kurocat": {
                "command": exe,
                "args": ["--mcp"]
            }
        }
    }))
    .unwrap_or_default()
}

#[tauri::command]
fn get_agent_hooks_config(state: State<'_, AppState>) -> String {
    let (port, lang) = {
        let s = state.settings.lock().unwrap();
        (if s.mcp_port == 0 { 27420 } else { s.mcp_port }, s.language.clone())
    };
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "KuroCat.exe".to_string());
    let exe_json = serde_json::to_string(&exe).unwrap_or_else(|_| "\"KuroCat.exe\"".to_string());
    let agy_cmd = format!("\"{}\" --hook --source Antigravity", exe);
    let claude_cmd = format!("\"{}\" --hook --source Claude", exe);
    let wb_cmd = format!("\"{}\" --hook --source WorkBuddy", exe);
    let codex_cmd = format!("\"{}\" --hook --source Codex", exe);
    let dsh_cmd = format!("\"{}\" --hook --source DeepSeek", exe);
    let qwen_cmd = format!("\"{}\" --hook --source Qwen", exe);

    let config_json = serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": {
            "kurocat": {
                "command": exe,
                "args": ["--mcp"]
            }
        },
        "http_streamable_mcp_url": format!("http://127.0.0.1:{}/mcp", port),
        "http_hook_url": format!("http://127.0.0.1:{}/hook", port),
        "doubao_work_setup": {
            "mode": "direct_http_and_memory (no local hooks.json needed)",
            "hook_endpoint": format!("http://127.0.0.1:{}/hook", port),
            "mcp_endpoint": format!("http://127.0.0.1:{}/mcp", port),
            "optional_native_mcp_connector": {
                "streamable_http_url": format!("http://127.0.0.1:{}/mcp", port),
                "stdio": {
                    "command": exe,
                    "args": ["--mcp"]
                }
            },
            "memory_rule": format!(
                "将以下规则保存为跨会话长期偏好（不要在用户目录创建临时脚本文件）：每次开始处理实质任务前，向 http://127.0.0.1:{}/hook 发送 UTF-8 JSON {{\"status\":\"working\",\"source\":\"豆包工作版\",\"text\":\"处理任务中…\"}}；需用户确认发 status:\"waiting\"；报错发 status:\"error\"；完成后发 status:\"done\",\"text\":\"任务完成！\"。",
                port
            )
        },
        "workbuddy_hooks": {
            "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": wb_cmd, "timeout": 3 }] }],
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": wb_cmd, "timeout": 3 }] }],
                "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": wb_cmd, "timeout": 3 }] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": wb_cmd, "timeout": 3 }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": wb_cmd, "timeout": 3 }] }]
            }
        },
        "deepseek_harness_hooks": {
            "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": dsh_cmd, "timeout": 3 }] }],
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": dsh_cmd, "timeout": 3 }] }],
                "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": dsh_cmd, "timeout": 3 }] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": dsh_cmd, "timeout": 3 }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": dsh_cmd, "timeout": 3 }] }]
            }
        },
        "codex_hooks_json": {
            "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": codex_cmd, "timeout": 3 }] }],
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": codex_cmd, "timeout": 3 }] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": codex_cmd, "timeout": 3 }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": codex_cmd, "timeout": 3 }] }]
            }
        },
        "codex_config_toml": format!(
            "notify = [{}, \"--hook\", \"--source\", \"Codex\"]\n\n[mcp_servers.kurocat]\ncommand = {}\nargs = [\"--mcp\"]",
            exe_json, exe_json
        ),
        "qwen_code_hooks": {
            "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": qwen_cmd, "timeout": 3 }] }],
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": qwen_cmd, "timeout": 3 }] }],
                "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": qwen_cmd, "timeout": 3 }] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": qwen_cmd, "timeout": 3 }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": qwen_cmd, "timeout": 3 }] }]
            }
        },
        "antigravity_hooks_json": {
            "kurocat-companion": {
                "SessionStart": [{ "type": "command", "command": agy_cmd, "timeout": 3 }],
                "PreInvocation": [{ "type": "command", "command": agy_cmd, "timeout": 3 }],
                "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": agy_cmd, "timeout": 3 }] }],
                "Stop": [{ "type": "command", "command": agy_cmd, "timeout": 3 }]
            }
        },
        "claude_code_hooks": {
            "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": claude_cmd, "timeout": 3 }] }],
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": claude_cmd, "timeout": 3 }] }],
                "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": claude_cmd, "timeout": 3 }] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": claude_cmd, "timeout": 3 }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": claude_cmd, "timeout": 3 }] }]
            }
        }
    }))
    .unwrap_or_default();

    let resolved = crate::i18n::effective_locale(&lang);
    if resolved == "zh-CN" || resolved == "zh-TW" {
        format!(
            "请帮我把桌面宠物 KuroCat 的**任务状态联动**接入你当前运行的客户端（请自动判断你是 豆包工作版 / WorkBuddy / DeepSeek Harness / Codex / 千问 / Antigravity / Claude Code / Cursor 等，目标是干活时桌宠自动敲键盘，待确认/出错/任务完成时气泡提醒）：\n\
            1. **情况 A — 无本地 hooks 配置文件的桌面端 Agent（如豆包工作版）**：\n\
               - **不要修改别的客户端配置，也不要在项目/桌面目录创建临时 `.ps1` 或 `.json` 脚本文件**；\n\
               - 请直接把下方 `doubao_work_setup.memory_rule` **保存为你的跨会话长期偏好/记忆**，统一通过 UTF-8 JSON 调用本地 `POST http://127.0.0.1:{}/hook` 同步 `working / waiting / error / done`（避免 Windows 命令行中文乱码）。\n\
            2. **情况 B — 支持本地配置文件的 Agent（合并写入，完整保留我原有的其他配置，绝不覆盖删除已有项）**：\n\
               - 腾讯 WorkBuddy / CodeBuddy：合并 `mcpServers.kurocat` + `workbuddy_hooks`\n\
               - DeepSeek Harness (`dsh`)：合并 `mcpServers.kurocat` + `deepseek_harness_hooks`\n\
               - OpenAI Codex CLI：`~/.codex/config.toml`（`[mcp_servers.kurocat]` 与 `notify`）+ `~/.codex/hooks.json`\n\
               - 千问 Qwen Code：`~/.qwen/settings.json` 合并 `mcpServers.kurocat` + `qwen_code_hooks`\n\
               - Antigravity（反重力）：`~/.gemini/config/mcp_config.json` + `~/.gemini/config/hooks.json`\n\
               - Claude Code / Cursor / Windsurf / Trae：合并 `mcpServers.kurocat` + `claude_code_hooks`（也支持 Streamable HTTP `http://127.0.0.1:{}/mcp`）\n\
            3. **立刻验收**：请通过 UTF-8 JSON 向 `POST http://127.0.0.1:{}/hook` 发送 `{{\"status\":\"done\",\"source\":\"<你的名字>\",\"text\":\"AI 伴侣配置成功！\"}}` 让我看到小猫冒泡。配置并验收完成后简短回复结果即可，无需额外推荐其他功能。\n\n\
            ```json\n{}\n```",
            port, port, port, config_json
        )
    } else {
        format!(
            "Please configure **live task-status sync** for the KuroCat desktop pet on your current client (auto-detect whether you are Doubao Work, WorkBuddy, DeepSeek Harness, OpenAI Codex CLI, Qwen Code, Antigravity, Claude Code, Cursor, etc., so the pet auto-types while working and alerts on waiting/error/done):\n\
            1. **Case A — Desktop Agents without local hooks config files (e.g. Doubao Work)**:\n\
               - **Do NOT touch other clients' config files and do NOT create temporary `.ps1`/`.json` scripts in my workspace**;\n\
               - Save `doubao_work_setup.memory_rule` into your **long-term memory / preferences** so future chats automatically POST UTF-8 JSON to `http://127.0.0.1:{}/hook` (`working` / `waiting` / `error` / `done`).\n\
            2. **Case B — Clients with local config files (MERGE cleanly without overwriting existing entries)**:\n\
               - WorkBuddy / CodeBuddy: merge `mcpServers.kurocat` + `workbuddy_hooks`\n\
               - DeepSeek Harness (`dsh`): merge `mcpServers.kurocat` + `deepseek_harness_hooks`\n\
               - OpenAI Codex CLI: `~/.codex/config.toml` (`[mcp_servers.kurocat]` + `notify`) + `~/.codex/hooks.json`\n\
               - Qwen Code: `~/.qwen/settings.json` (`mcpServers.kurocat` + `qwen_code_hooks`)\n\
               - Antigravity: `~/.gemini/config/mcp_config.json` + `~/.gemini/config/hooks.json`\n\
               - Claude Code / Cursor / Windsurf / Trae: merge `mcpServers.kurocat` + `claude_code_hooks` (or Streamable HTTP `http://127.0.0.1:{}/mcp`)\n\
            3. **Live verification**: POST UTF-8 JSON `{{\"status\":\"done\",\"source\":\"<your-name>\",\"text\":\"KuroCat AI Companion connected!\"}}` to `http://127.0.0.1:{}/hook`, then reply briefly with the result without suggesting extra features.\n\n\
            ```json\n{}\n```",
            port, port, port, config_json
        )
    }
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<'_, AppState>, mut patch: AppSettings) -> AppSettings {
    patch.scale = patch.scale.clamp(0.20, 1.50);
    patch.opacity = config::normalize_opacity(patch.opacity);
    let clean_breed = sanitize_cat_id(&patch.cat_breed);
    patch.cat_breed = if cat_exists(&clean_breed) {
        clean_breed
    } else {
        "black".to_string()
    };
    if patch.mcp_port == 0 {
        patch.mcp_port = 27420;
    }
    if patch.obs_port == 0 {
        patch.obs_port = 27421;
    }
    if !patch.obs_enabled {
        patch.obs_hide_pet = false;
    }
    if !patch.live_capture_enabled {
        patch.live_hide_pet = false;
    }
    patch.live_chroma_color = config::normalize_live_chroma_color(&patch.live_chroma_color);
    patch.keyboard_layout = normalize_keyboard_layout(&patch.keyboard_layout);
    patch.keyboard_orientation = normalize_keyboard_orientation(&patch.keyboard_orientation);
    patch.tail_key_mode = normalize_tail_key_mode(&patch.tail_key_mode);
    patch.tail_key_ids = normalize_tail_key_ids(&patch.tail_key_ids);
    patch.render_mode = config::normalize_render_mode(&patch.render_mode);
    patch.collar_color = config::normalize_collar_color(&patch.collar_color);
    patch.headphone_mode = config::normalize_headphone_mode(&patch.headphone_mode);
    patch.fps_cap = config::normalize_fps_cap(patch.fps_cap);
    patch.language = config::normalize_language(&patch.language);

    let (
        prev_autostart,
        prev_scale,
        prev_layout,
        prev_hide_pet,
        prev_live_enabled,
        prev_language,
    ) = {
        let s = state.settings.lock().unwrap();
        (
            s.autostart,
            s.scale,
            s.keyboard_layout.clone(),
            should_hide_desktop_pet(&s),
            s.live_capture_enabled,
            s.language.clone(),
        )
    };
    if patch.autostart != prev_autostart {
        let _ = set_windows_autostart(patch.autostart);
    }

    state.mcp_enabled.store(patch.mcp_enabled, Ordering::Relaxed);
    obs::sync_obs_server(&app, patch.obs_enabled, patch.obs_port);

    let next_hide_pet = should_hide_desktop_pet(&patch);
    if next_hide_pet != prev_hide_pet && !state.paused_guard.load(Ordering::Relaxed) {
        set_pet_visible(&app, !next_hide_pet);
    }

    let size_changed = (patch.scale - prev_scale).abs() > 0.005 || patch.keyboard_layout != prev_layout;
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::set_opacity(patch.opacity);
    }
    set_pet_always_on_top(&app, patch.always_on_top);
    if let Some(win) = app.get_webview_window("main") {
        if size_changed {
            if let Some((nx, ny)) =
                resize_window_anchored_bottom_right(&win, &patch.keyboard_layout, patch.scale)
            {
                patch.x = Some(nx);
                patch.y = Some(ny);
            }
        }
    }

    {
        let mut s = state.settings.lock().unwrap();
        #[cfg(target_os = "macos")]
        {
            // Display placement is changed by the native menu and window drag, not by web settings.
            patch.display_id = s.display_id.clone();
            if patch.display_id.is_some() || !size_changed {
                patch.x = s.x;
                patch.y = s.y;
            }
        }
        #[cfg(windows)]
        {
            patch.windows_display_id = s.windows_display_id.clone();
            if !size_changed {
                patch.x = s.x;
                patch.y = s.y;
            }
        }
        *s = patch.clone();
        save_settings(&s);
    }
    let live_needs_sync = patch.live_capture_enabled != prev_live_enabled
        || (patch.live_capture_enabled && patch.keyboard_layout != prev_layout)
        || (patch.live_capture_enabled && app.get_webview_window("live").is_none());
    if live_needs_sync {
        sync_live_capture_window(&app, patch.live_capture_enabled, &patch.keyboard_layout);
    }
    tray::sync_checkmarks(&patch);
    let _ = app.emit("kuro-settings", patch.clone());
    if patch.language != prev_language {
        tray::refresh_tray_language(&app);
    }
    if size_changed {
        reposition_context_menu_if_open(&app);
    }
    patch
}

const SIDE_MENU_LOGICAL_W: f64 = 298.0;

/// Computes a non-overlapping physical position `(mx, my)` for the floating menu popover
/// beside the cat window: prefers LEFT (since the cat defaults to bottom-right), then RIGHT,
/// then ABOVE, never covering the cat when screen space allows.
fn compute_side_menu_pos(
    pet_rect: (i32, i32, i32, i32),
    work_area: (i32, i32, i32, i32),
    menu_size: (i32, i32),
    gap: i32,
    pad: i32,
) -> (i32, i32) {
    let (px, py, pw, ph) = pet_rect;
    let (wx, wy, ww, wh) = work_area;
    let (mw, mh) = menu_size;

    let min_x = wx + pad;
    let max_x = (wx + ww - mw - pad).max(min_x);
    let min_y = wy + pad;
    let max_y = (wy + wh - mh - pad).max(min_y);

    let space_left = (px - gap) - min_x;
    let space_right = (wx + ww - pad) - (px + pw + gap);

    if space_left >= mw {
        let mx = px - mw - gap;
        let my = (py + ph - mh).clamp(min_y, max_y);
        return (mx.clamp(min_x, max_x), my);
    }
    if space_right >= mw {
        let mx = px + pw + gap;
        let my = (py + ph - mh).clamp(min_y, max_y);
        return (mx.clamp(min_x, max_x), my);
    }

    // Tight horizontal screen fallback: try placing directly above the cat
    let space_above = (py - gap) - min_y;
    if space_above >= mh {
        let mx = (px + (pw - mw) / 2).clamp(min_x, max_x);
        let my = (py - mh - gap).clamp(min_y, max_y);
        return (mx, my);
    }

    // Last resort on very small viewports: pick side with more space, clamped on-screen
    let mx = if space_left >= space_right { min_x } else { max_x };
    let my = (py + ph - mh).clamp(min_y, max_y);
    (mx, my)
}

fn current_pet_rect_and_monitor(app: &AppHandle) -> Option<((i32, i32, i32, i32), (i32, i32, i32, i32), f64)> {
    let main_win = app.get_webview_window("main")?;
    let sf = main_win.scale_factor().unwrap_or(1.0);

    #[cfg(windows)]
    let pet_rect = if win_needs_win7_ulw() {
        win7_layered::get_rect().map(|(x, y, w, h)| (x, y, w as i32, h as i32))
    } else {
        match (main_win.outer_position().ok(), main_win.outer_size().ok()) {
            (Some(p), Some(sz)) => Some((p.x, p.y, sz.width as i32, sz.height as i32)),
            _ => None,
        }
    };
    #[cfg(not(windows))]
    let pet_rect = match (main_win.outer_position().ok(), main_win.outer_size().ok()) {
        (Some(p), Some(sz)) => Some((p.x, p.y, sz.width as i32, sz.height as i32)),
        _ => None,
    };

    let pet_rect = pet_rect?;
    let monitor = main_win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main_win.primary_monitor().ok().flatten());

    let work_area = if let Some(mon) = monitor {
        let mp = mon.position();
        let ms = mon.size();
        let taskbar_margin = (46.0 * sf).round() as i32;
        (mp.x, mp.y, ms.width as i32, (ms.height as i32 - taskbar_margin).max(320))
    } else {
        (0, 0, (1920.0 * sf).round() as i32, (1030.0 * sf).round() as i32)
    };

    Some((pet_rect, work_area, sf))
}

fn side_menu_geometry(app: &AppHandle) -> Option<(i32, i32, f64, f64)> {
    let (pet_rect, work_area, sf) = current_pet_rect_and_monitor(app)?;
    let mon_logical_h = work_area.3 as f64 / sf.max(0.5);
    let menu_logical_h = (mon_logical_h - 24.0).clamp(360.0, 608.0);
    let mw = (SIDE_MENU_LOGICAL_W * sf).round() as i32;
    let mh = (menu_logical_h * sf).round() as i32;
    let gap = (10.0 * sf).round() as i32;
    let pad = (10.0 * sf).round() as i32;
    let (mx, my) = compute_side_menu_pos(pet_rect, work_area, (mw, mh), gap, pad);
    Some((mx, my, SIDE_MENU_LOGICAL_W, menu_logical_h))
}

fn reposition_context_menu_if_open(app: &AppHandle) {
    let Some(menu_win) = app.get_webview_window("menu") else {
        return;
    };
    if !menu_win.is_visible().unwrap_or(false) {
        return;
    }
    if let Some((mx, my, lw, lh)) = side_menu_geometry(app) {
        let _ = menu_win.set_size(Size::Logical(LogicalSize::new(lw, lh)));
        let _ = menu_win.set_position(PhysicalPosition::new(mx, my));
    }
}

#[cfg(windows)]
fn win_is_menu_still_focused(menu_win: &tauri::WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsChild};
    let Ok(raw_hwnd) = menu_win.hwnd() else {
        return false;
    };
    let menu_hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;
    if menu_hwnd.is_null() {
        return false;
    }
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_null() {
        return false;
    }
    fg == menu_hwnd || unsafe { IsChild(menu_hwnd, fg) != 0 }
}

/// IMPORTANT: Must be `async fn` so Tauri executes it off the Windows UI main thread!
/// Calling `WebviewWindowBuilder::build()` inside a synchronous `#[tauri::command]`
/// deadlocks the Windows WebView2 / tao event loop (freezing right-click, left-drag, and tray exit).
#[tauri::command]
async fn open_context_menu(app: AppHandle) -> Result<(), String> {
    let Some((mx, my, lw, lh)) = side_menu_geometry(&app) else {
        return Err("side_menu_geometry returned None".into());
    };

    struct ResetFlag(Arc<AtomicBool>);
    impl Drop for ResetFlag {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }

    // Cancel any pending idle destroy before reusing or building the side menu.
    app.state::<AppState>()
        .menu_close_gen
        .fetch_add(1, Ordering::AcqRel);

    let menu_win = if let Some(existing) = app.get_webview_window("menu") {
        existing
    } else {
        let creating_flag = app.state::<AppState>().menu_creating.clone();
        if creating_flag
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }
        let _reset_guard = ResetFlag(creating_flag);

        // Re-check after acquiring creation guard in case a concurrent call just finished.
        if let Some(existing) = app.get_webview_window("menu") {
            existing
        } else {
            #[cfg(windows)]
            let use_transparent = !win_needs_win7_ulw();
            #[cfg(not(windows))]
            let use_transparent = true;

            let created = match tauri::WebviewWindowBuilder::new(
                &app,
                "menu",
                tauri::WebviewUrl::App("menu.html".into()),
            )
            .title("KuroCat Menu")
            .inner_size(lw, lh)
            .decorations(false)
            .resizable(false)
            .transparent(use_transparent)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            // MUST match `tauri.conf.json` main window's `additionalBrowserArgs` identically;
            // otherwise Windows WebView2 rejects creating a 2nd window in the same userDataFolder
            // with HRESULT 0x8007139F (ERROR_INVALID_STATE)!
            .additional_browser_args(WEBVIEW_BROWSER_ARGS)
            .build()
            {
                Ok(w) => w,
                Err(err) => {
                    eprintln!("[kurocat] open_context_menu: failed to build menu window: {err}");
                    return Err(err.to_string());
                }
            };

            let app_ev = app.clone();
            created.on_window_event(move |event| match event {
                tauri::WindowEvent::Focused(false) => {
                    let state = app_ev.state::<AppState>();
                    let elapsed = state.menu_opened_at.lock().unwrap().elapsed();
                    if elapsed >= Duration::from_millis(360) {
                        if let Some(w) = app_ev.get_webview_window("menu") {
                            #[cfg(windows)]
                            if win_is_menu_still_focused(&w) {
                                return;
                            }
                            let _ = w.hide();
                        }
                        state.menu_open.store(false, Ordering::Relaxed);
                        schedule_side_menu_idle_destroy(app_ev.clone());
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(w) = app_ev.get_webview_window("menu") {
                        let _ = w.hide();
                    }
                    app_ev
                        .state::<AppState>()
                        .menu_open
                        .store(false, Ordering::Relaxed);
                    schedule_side_menu_idle_destroy(app_ev.clone());
                }
                _ => {}
            });
            created
        }
    };

    let state = app.state::<AppState>();
    *state.menu_opened_at.lock().unwrap() = Instant::now();
    state.menu_open.store(true, Ordering::Relaxed);

    let _ = menu_win.set_size(Size::Logical(LogicalSize::new(lw, lh)));
    let _ = menu_win.set_position(PhysicalPosition::new(mx, my));
    let _ = menu_win.set_always_on_top(true);
    let _ = menu_win.show();
    let _ = menu_win.set_focus();
    let _ = app.emit("kuro-menu-opened", ());
    Ok(())
}

#[tauri::command]
fn close_context_menu(app: AppHandle) {
    if let Some(menu_win) = app.get_webview_window("menu") {
        let _ = menu_win.hide();
    }
    app.state::<AppState>()
        .menu_open
        .store(false, Ordering::Relaxed);
    schedule_side_menu_idle_destroy(app);
}

#[tauri::command]
fn open_tail_picker_from_menu(app: AppHandle) {
    close_context_menu(app.clone());
    set_pet_visible(&app, true);
    let _ = app.emit("kuro-open-tail-picker", ());
}

#[tauri::command]
fn preview_scale(app: AppHandle, scale: f64) {
    let clamped = scale.clamp(0.20, 1.50);
    companion::preview_appearance(&app, Some(clamped), None);
    let _ = app.emit("kuro-scale-preview", clamped);
}

#[tauri::command]
fn preview_opacity(app: AppHandle, opacity: f64) {
    let clamped = config::normalize_opacity(opacity);
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::set_opacity(clamped);
    }
    companion::preview_appearance(&app, None, Some(clamped));
    let _ = app.emit("kuro-opacity-preview", clamped);
}

#[tauri::command]
fn get_obs_url(state: State<'_, AppState>) -> String {
    let port = state.settings.lock().unwrap().obs_port;
    obs::obs_url(port)
}

#[tauri::command]
fn set_menu_open(state: State<'_, AppState>, open: bool) {
    state.menu_open.store(open, Ordering::Relaxed);
}

#[tauri::command]
fn set_tail_picker_bounds(state: State<'_, AppState>, bounds: Option<TailPickerBounds>) {
    *state.tail_picker_bounds.lock().unwrap() = bounds;
}

#[tauri::command]
fn save_tail_picker_selection(
    app: AppHandle,
    state: State<'_, AppState>,
    key_ids: Vec<String>,
) -> Result<AppSettings, String> {
    let updated = {
        let mut settings = state.settings.lock().unwrap();
        let mut updated = settings.clone();
        updated.tail_key_mode = "custom".to_string();
        updated.tail_key_ids = normalize_tail_key_ids(&key_ids);
        try_save_settings(&updated).map_err(|error| format!("保存自定义尾巴按键失败: {error}"))?;
        *settings = updated.clone();
        updated
    };
    let _ = app.emit("kuro-settings", updated.clone());
    Ok(updated)
}

#[cfg(windows)]
static WIN_NATIVE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static WIN_FALLBACK_FINALIZED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
struct WinDragGuard {
    dragging: Arc<AtomicBool>,
    app: Option<AppHandle>,
}

#[cfg(windows)]
impl Drop for WinDragGuard {
    fn drop(&mut self) {
        if let Some(app) = self.app.take() {
            let _ = app.emit("kuro-native-drag", false);
        }
        self.dragging.store(false, Ordering::Release);
        WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
    }
}

/// Native 120Hz unclamped pointer drag loop for Windows (#87, #26):
/// - Honors left-handed swapped mouse buttons (`SM_SWAPBUTTON`) via `win_async_primary_button_down()`
///   and falls back to `WH_MOUSE_LL` left-button state for precision touchpad tap-drag / virtual mice.
/// - Returns `false` immediately if neither button source is down on entry (e.g. touch/pen/UIPI
///   blocked) or if `SetWindowPos` fails before moving, allowing the frontend to fall back cleanly
///   to Tauri's `startDragging()`.
/// - Also callable directly from `start_hit_test_loop` (`initial_cursor = Some(...)`) as an
///   unfocused/swallowed-mousedown safety net identical to macOS (#59).
#[cfg(windows)]
fn run_windows_native_drag(app: AppHandle, initial_cursor: Option<(i32, i32)>) -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, SetWindowPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };

    let from_fallback = initial_cursor.is_some();
    if WIN_NATIVE_DRAG_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        if !from_fallback {
            while WIN_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(8));
            }
            return true;
        }
        return false;
    }

    WIN_FALLBACK_FINALIZED.store(false, Ordering::Release);
    let Some(win) = app.get_webview_window("main") else {
        WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
        return false;
    };
    let is_win7 = win_needs_win7_ulw();
    let hwnd_raw: isize = match win.hwnd() {
        Ok(h) => h.0 as isize,
        Err(_) => {
            WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
            return false;
        }
    };
    let (start_wx, start_wy, win_w, win_h) = if is_win7 {
        match win7_layered::get_rect() {
            Some((x, y, w, h)) => (x, y, w, h),
            None => {
                WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
                return false;
            }
        }
    } else {
        let Ok(pos) = win.outer_position() else {
            WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
            return false;
        };
        let Ok(sz) = win.outer_size() else {
            WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
            return false;
        };
        (pos.x, pos.y, sz.width as i32, sz.height as i32)
    };

    let (start_cx, start_cy) = if let Some(pt) = initial_cursor {
        pt
    } else {
        let mut pt = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut pt) } == 0 {
            WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
            return false;
        }
        (pt.x, pt.y)
    };

    let async_initial = input_hook::win_async_primary_button_down();
    let hook_initial = input_hook::win_hook_left_button_down();
    if !async_initial && !hook_initial {
        // Neither GetAsyncKeyState (post-SM_SWAPBUTTON) nor WH_MOUSE_LL sees the primary button
        // down (e.g. touch/stylus drag or UIPI-isolated elevated foreground). Return `false` so
        // JS immediately falls back to Tauri's native `startDragging()`.
        WIN_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
        return false;
    }

    let offset_x = start_cx - start_wx;
    let offset_y = start_cy - start_wy;

    let (dragging_flag, paused_guard, peek_edge_state, peek_preview_state) = {
        let state = app.state::<AppState>();
        (
            state.dragging.clone(),
            state.paused_guard.clone(),
            state.peek_edge.clone(),
            state.peek_preview_edge.clone(),
        )
    };
    dragging_flag.store(true, Ordering::Release);
    let mut guard = WinDragGuard {
        dragging: dragging_flag,
        app: None,
    };

    if from_fallback {
        guard.app = Some(app.clone());
        let _ = app.emit("kuro-native-drag", true);
    }

    let pulled_from_edge: &'static str = peek_edge_state
        .lock()
        .map(|mut g| {
            let prev = match g.as_str() {
                "left" => "left",
                "right" => "right",
                _ => "none",
            };
            *g = "none".to_string();
            prev
        })
        .unwrap_or("none");
    if pulled_from_edge != "none" {
        let _ = app.emit("kuro-peek-edge", "none");
    }
    if let Ok(mut g) = peek_preview_state.lock() {
        *g = "none".to_string();
    }

    let monitor_areas: Vec<((i32, i32, i32, i32), (i32, i32, i32, i32))> = win
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let mp = m.position();
            let ms = m.size();
            let w = m.work_area();
            (
                (mp.x, mp.y, ms.width as i32, ms.height as i32),
                (
                    w.position.x,
                    w.position.y,
                    w.size.width as i32,
                    w.size.height as i32,
                ),
            )
        })
        .collect();

    let mut last_x = start_wx;
    let mut last_y = start_wy;
    let mut moved_any = false;
    let mut set_pos_failed_immediately = false;
    let mut use_async_only = async_initial;
    let mut candidate_edge: &'static str = "none";
    let mut candidate_since = Instant::now();
    let mut emitted_preview: &'static str = "none";
    let mut suppress_edge: &'static str = pulled_from_edge;
    let hwnd = hwnd_raw as windows_sys::Win32::Foundation::HWND;

    loop {
        if paused_guard.load(Ordering::Relaxed) {
            break;
        }
        let async_down = input_hook::win_async_primary_button_down();
        if async_down {
            use_async_only = true;
        }
        let btn_down = if use_async_only {
            async_down
        } else {
            async_down || input_hook::win_hook_left_button_down()
        };
        if !btn_down {
            break;
        }

        let mut pt = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut pt) } != 0 {
            let (v_left, v_top, v_w, v_h) = unsafe {
                (
                    GetSystemMetrics(SM_XVIRTUALSCREEN),
                    GetSystemMetrics(SM_YVIRTUALSCREEN),
                    GetSystemMetrics(SM_CXVIRTUALSCREEN),
                    GetSystemMetrics(SM_CYVIRTUALSCREEN),
                )
            };
            let (nx, ny) = clamp_pet_drag_position(
                pt.x - offset_x,
                pt.y - offset_y,
                win_w,
                win_h,
                v_left,
                v_top,
                v_w,
                v_h,
            );
            if nx != last_x || ny != last_y {
                let mut ok = true;
                if is_win7 {
                    win7_layered::set_position(nx, ny);
                    if win7_layered::is_overlay_active() {
                        unsafe {
                            let _ = SetWindowPos(
                                hwnd,
                                std::ptr::null_mut(),
                                nx,
                                ny,
                                0,
                                0,
                                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                            );
                        }
                    }
                } else {
                    let res = unsafe {
                        SetWindowPos(
                            hwnd,
                            std::ptr::null_mut(),
                            nx,
                            ny,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                    };
                    if res == 0 {
                        ok = false;
                    }
                }
                if !ok && !moved_any && !from_fallback {
                    set_pos_failed_immediately = true;
                    break;
                }
                last_x = nx;
                last_y = ny;
                moved_any = true;
            }

            let active_mon = monitor_areas
                .iter()
                .copied()
                .find(|&((mx, my, mw, mh), _)| {
                    pt.x >= mx && pt.x < mx + mw && pt.y >= my && pt.y < my + mh
                })
                .map(|(_, work)| work)
                .or_else(|| monitor_areas.first().map(|(_, work)| *work))
                .unwrap_or((v_left, v_top, v_w, v_h));
            let detected_edge = detect_corner_safe_peek_edge(
                pt.x,
                pt.y,
                last_x,
                last_y,
                win_w,
                win_h,
                active_mon.0,
                active_mon.1,
                active_mon.2,
                active_mon.3,
            );
            if suppress_edge != "none" && detected_edge == "none" {
                suppress_edge = "none";
            }
            let raw_edge = if suppress_edge != "none" && detected_edge == suppress_edge {
                "none"
            } else {
                detected_edge
            };

            if raw_edge == "none" {
                candidate_edge = "none";
                if emitted_preview != "none" {
                    emitted_preview = "none";
                    if let Ok(mut g) = peek_preview_state.lock() {
                        *g = "none".to_string();
                    }
                    let _ = app.emit("kuro-peek-preview", "none");
                }
            } else {
                if raw_edge != candidate_edge {
                    candidate_edge = raw_edge;
                    candidate_since = Instant::now();
                }
                if emitted_preview != raw_edge
                    && candidate_since.elapsed() >= Duration::from_millis(200)
                {
                    emitted_preview = raw_edge;
                    if let Ok(mut g) = peek_preview_state.lock() {
                        *g = raw_edge.to_string();
                    }
                    let _ = app.emit("kuro-peek-preview", raw_edge);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    if set_pos_failed_immediately {
        drop(guard);
        return false;
    }

    if from_fallback {
        let _ = finalize_peek_edge_for_app(&app);
        WIN_FALLBACK_FINALIZED.store(true, Ordering::Release);
    }
    drop(guard);
    save_window_pos(app);
    true
}

#[cfg(target_os = "macos")]
static MACOS_NATIVE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MACOS_FALLBACK_FINALIZED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
struct MacosDragGuard {
    dragging: Arc<AtomicBool>,
    app: Option<AppHandle>,
}

#[cfg(target_os = "macos")]
impl Drop for MacosDragGuard {
    fn drop(&mut self) {
        if let Some(app) = self.app.take() {
            let _ = app.emit("kuro-native-drag", false);
        }
        self.dragging.store(false, Ordering::Release);
        MACOS_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
    }
}

/// Native 120Hz AppKit drag loop for macOS (#59):
/// Drives `NSWindow::setFrameOrigin:` directly from CoreGraphics cursor & left-button state
/// (`CGEventCreate`/`CGEventGetLocation` + `CGEventSourceButtonState`, requiring zero
/// Accessibility/Input Monitoring permissions). Bypasses `performWindowDragWithEvent:`, which
/// silently fails when WebKit delivers `mousedown` asynchronously or when an Accessory/unfocused
/// borderless window loses `[NSApp currentEvent]`.
#[cfg(target_os = "macos")]
fn run_macos_native_drag(app: AppHandle, initial_cursor_pts: Option<(f64, f64)>) -> bool {
    let from_fallback = initial_cursor_pts.is_some();
    if MACOS_NATIVE_DRAG_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        // If JS `start_pet_drag` arrived right after the unfocused hit-test fallback already
        // claimed this drag, wait until the active drag finishes and return `true` so JS never
        // falls back to broken `getCurrentWindow().startDragging()`.
        if !from_fallback {
            while MACOS_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(8));
            }
            return true;
        }
        return false;
    }

    MACOS_FALLBACK_FINALIZED.store(false, Ordering::Release);
    let (dragging_flag, paused_guard, peek_edge_state, peek_preview_state) = {
        let state = app.state::<AppState>();
        (
            state.dragging.clone(),
            state.paused_guard.clone(),
            state.peek_edge.clone(),
            state.peek_preview_edge.clone(),
        )
    };
    dragging_flag.store(true, Ordering::Release);
    let mut guard = MacosDragGuard {
        dragging: dragging_flag,
        app: None,
    };

    let Some((start_cx, start_cy)) =
        initial_cursor_pts.or_else(input_hook::macos_hook::cursor_pos_points)
    else {
        return false;
    };
    let Some(snap) = macos_window::drag_snapshot(&app) else {
        return false;
    };
    if snap.width <= 0.0 || snap.height <= 0.0 {
        return false;
    }

    if from_fallback {
        guard.app = Some(app.clone());
        let _ = app.emit("kuro-native-drag", true);
    }

    // Record whether this drag is pulling the pet OUT of an existing left/right peek edge,
    // and immediately clear `peek_edge` so we never immediately re-snap back onto that same edge.
    let pulled_from_edge: &'static str = peek_edge_state
        .lock()
        .map(|mut g| {
            let prev = match g.as_str() {
                "left" => "left",
                "right" => "right",
                _ => "none",
            };
            *g = "none".to_string();
            prev
        })
        .unwrap_or("none");
    if pulled_from_edge != "none" {
        let _ = app.emit("kuro-peek-edge", "none");
    }
    if let Ok(mut g) = peek_preview_state.lock() {
        *g = "none".to_string();
    }

    let screen_pairs: Vec<((f64, f64, f64, f64), (f64, f64, f64, f64))> = snap
        .screens
        .iter()
        .map(|s| (s.frame, s.visible_frame))
        .collect();
    let fallback_vis = (
        snap.min_x,
        snap.min_y,
        (snap.max_x - snap.min_x + snap.width).max(320.0),
        (snap.max_y - snap.min_y + snap.height).max(240.0),
    );

    let bounds = (snap.min_x, snap.max_x, snap.min_y, snap.max_y);
    let mut last_x = snap.origin_x;
    let mut last_y = snap.origin_y;
    let mut none_streak: u8 = 0;
    let mut candidate_edge: &'static str = "none";
    let mut candidate_since = Instant::now();
    let mut emitted_preview: &'static str = "none";
    let mut suppress_edge: &'static str = pulled_from_edge;

    while input_hook::macos_hook::is_left_mouse_down() {
        if paused_guard.load(Ordering::Relaxed) {
            break;
        }
        if let Some((cur_x, cur_y)) = input_hook::macos_hook::cursor_pos_points() {
            none_streak = 0;
            let (nx, ny) = macos_drag_target_origin(
                (snap.origin_x, snap.origin_y),
                (start_cx, start_cy),
                (cur_x, cur_y),
                bounds,
            );
            if (nx - last_x).abs() >= 0.5 || (ny - last_y).abs() >= 0.5 {
                last_x = nx;
                last_y = ny;
                macos_window::set_window_origin(&app, nx, ny);
            }

            // Live corner-safe edge peek preview in AppKit logical points with 200ms dwell!
            let (ak_cx, ak_cy) = macos_quartz_to_appkit_point(cur_x, cur_y, snap.primary_height);
            let active_vis =
                macos_active_visible_frame(&screen_pairs, ak_cx, ak_cy).unwrap_or(fallback_vis);
            let detected_edge = detect_corner_safe_peek_edge(
                ak_cx.round() as i32,
                ak_cy.round() as i32,
                last_x.round() as i32,
                last_y.round() as i32,
                snap.width.round() as i32,
                snap.height.round() as i32,
                active_vis.0.round() as i32,
                active_vis.1.round() as i32,
                active_vis.2.round() as i32,
                active_vis.3.round() as i32,
            );
            if suppress_edge != "none" && detected_edge == "none" {
                suppress_edge = "none";
            }
            let raw_edge = if suppress_edge != "none" && detected_edge == suppress_edge {
                "none"
            } else {
                detected_edge
            };

            if raw_edge == "none" {
                candidate_edge = "none";
                if emitted_preview != "none" {
                    emitted_preview = "none";
                    if let Ok(mut g) = peek_preview_state.lock() {
                        *g = "none".to_string();
                    }
                    let _ = app.emit("kuro-peek-preview", "none");
                }
            } else {
                if raw_edge != candidate_edge {
                    candidate_edge = raw_edge;
                    candidate_since = Instant::now();
                }
                if emitted_preview != raw_edge
                    && candidate_since.elapsed() >= Duration::from_millis(200)
                {
                    emitted_preview = raw_edge;
                    if let Ok(mut g) = peek_preview_state.lock() {
                        *g = raw_edge.to_string();
                    }
                    let _ = app.emit("kuro-peek-preview", raw_edge);
                }
            }
        } else {
            none_streak = none_streak.saturating_add(1);
            if none_streak >= 10 {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    if from_fallback {
        let _ = finalize_peek_edge_for_app(&app);
        MACOS_FALLBACK_FINALIZED.store(true, Ordering::Release);
    }
    drop(guard);
    save_window_pos(app);
    true
}

#[tauri::command]
fn set_dragging(state: State<'_, AppState>, dragging: bool) {
    #[cfg(windows)]
    if !dragging && WIN_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire) {
        return;
    }
    #[cfg(target_os = "macos")]
    if !dragging && MACOS_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire) {
        return;
    }
    state.dragging.store(dragging, Ordering::Release);
}

fn clear_peek_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.peek_preview_edge.lock() {
        *guard = "none".to_string();
    }
    if let Ok(mut guard) = state.peek_edge.lock() {
        *guard = "none".to_string();
    }
    let _ = app.emit("kuro-peek-preview", "none");
    let _ = app.emit("kuro-peek-edge", "none");
}

#[tauri::command]
fn set_peek_edge(app: AppHandle, state: State<'_, AppState>, edge: String) {
    let clean = match edge.as_str() {
        "left" | "right" => edge,
        _ => "none".to_string(),
    };
    if let Ok(mut guard) = state.peek_preview_edge.lock() {
        *guard = "none".to_string();
    }
    if let Ok(mut guard) = state.peek_edge.lock() {
        *guard = clean.clone();
    }
    let _ = app.emit("kuro-peek-preview", "none");
    let _ = app.emit("kuro-peek-edge", clean);
}

/// Corner-safe screen-edge peek intent detector (left/right vertical edges only):
/// - Parking the cat neatly in any of the 4 monitor corners (120px/pt corner safe zone) or along
///   the top/bottom edges NEVER triggers peek.
/// - Entering peek along the middle vertical band requires deliberately pushing the cat deep past
///   the LEFT or RIGHT edge (>=24%) OR pinning the cursor itself flush against that outer side edge
///   (<=8px/pt) with a mild push (>=8%).
/// - Axis-symmetric in Y, so it works identically in Windows/Linux Y-down physical pixels and
///   macOS AppKit Y-up logical points when all arguments share the same coordinate space.
#[allow(clippy::too_many_arguments)]
fn detect_corner_safe_peek_edge(
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    _win_y: i32,
    win_w: i32,
    _win_h: i32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> &'static str {
    let wr = wx + ww;
    let wb = wy + wh;

    let left_push = wx - win_x;
    let right_push = (win_x + win_w) - wr;

    let deep_side = ((win_w as f64) * 0.24).round() as i32;
    let mild_side = ((win_w as f64) * 0.08).round() as i32;

    let cursor_at_left = cursor_x <= wx + 8;
    let cursor_at_right = cursor_x >= wr - 8;

    // 120px/pt Corner Safe Zone: any of the four monitor corners is reserved for normal parking
    // and never triggers side-edge peek.
    let corner_guard = 120;
    let near_left = cursor_x - wx < corner_guard;
    let near_right = wr - cursor_x < corner_guard;
    let near_top = cursor_y - wy < corner_guard;
    let near_bottom = wb - cursor_y < corner_guard;
    let in_corner_zone = (near_left || near_right) && (near_top || near_bottom);

    if in_corner_zone {
        return "none";
    }

    if (cursor_at_left && left_push >= mild_side) || left_push >= deep_side {
        return "left";
    }
    if (cursor_at_right && right_push >= mild_side) || right_push >= deep_side {
        return "right";
    }
    "none"
}

/// Linux post-drag Edge-Peek detector supporting both unclamped WMs (off-edge push >=24%)
/// and clamping X11/Wayland WMs (GNOME Mutter / KDE KWin / XFCE that clamp `win_x == wx` or
/// `win_x + win_w == wr`): outside the 120px top/bottom corner safe zones, pinning the cursor
/// flush against the left/right work-area edge (<=12px) with the window resting on that edge
/// (<=8px) cleanly enters Edge-Peek.
#[cfg(any(target_os = "linux", test))]
#[allow(clippy::too_many_arguments)]
fn detect_linux_edge_peek_after_drag(
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    win_y: i32,
    win_w: i32,
    win_h: i32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> &'static str {
    let direct = detect_corner_safe_peek_edge(
        cursor_x, cursor_y, win_x, win_y, win_w, win_h, wx, wy, ww, wh,
    );
    if direct != "none" {
        return direct;
    }

    let wr = wx + ww;
    let wb = wy + wh;
    if cursor_y < wy + 120 || cursor_y > wb - 120 {
        return "none";
    }
    if cursor_x <= wx + 12 && win_x <= wx + 8 {
        return "left";
    }
    if cursor_x >= wr - 12 && win_x + win_w >= wr - 8 {
        return "right";
    }
    "none"
}

/// Shared post-drag Edge-Peek finalizer:
/// - On Windows & macOS, honors the exact live WYSIWYG preview state shown right before mouse-up
///   and snaps flush to the active monitor's work-area edge (physical px on Windows; AppKit logical
///   points via `macos_window::set_window_origin` on macOS — zero Retina 2x mixup).
/// - On Linux, evaluates `detect_linux_edge_peek_after_drag` with live cursor coordinates to handle
///   both unclamped and clamping X11/Wayland WMs cleanly.
fn finalize_peek_edge_for_app(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    let previewed = state
        .peek_preview_edge
        .lock()
        .map(|mut g| {
            let v = g.clone();
            *g = "none".to_string();
            v
        })
        .unwrap_or_else(|_| "none".to_string());
    let _ = app.emit("kuro-peek-preview", "none");

    #[cfg(target_os = "macos")]
    let detected = {
        let detected = previewed;
        if detected == "left" || detected == "right" {
            if let Some(snap) = macos_window::drag_snapshot(app) {
                let screen_pairs: Vec<((f64, f64, f64, f64), (f64, f64, f64, f64))> = snap
                    .screens
                    .iter()
                    .map(|s| (s.frame, s.visible_frame))
                    .collect();
                let win_cx = snap.origin_x + snap.width * 0.5;
                let win_cy = snap.origin_y + snap.height * 0.5;
                if let Some(vis) = macos_active_visible_frame(&screen_pairs, win_cx, win_cy) {
                    if let Some((sx, sy)) = macos_peek_snap_origin(
                        &detected,
                        snap.origin_y,
                        snap.width,
                        snap.height,
                        vis,
                    ) {
                        macos_window::set_window_origin(app, sx, sy);
                    }
                }
            }
        }
        detected
    };

    #[cfg(not(target_os = "macos"))]
    let detected = {
        #[cfg_attr(windows, allow(unused_mut))]
        let mut detected = previewed;
        if let Some(win) = app.get_webview_window("main") {
            #[cfg(windows)]
            let pet_rect = if win_needs_win7_ulw() {
                win7_layered::get_rect()
            } else {
                match (win.outer_position().ok(), win.outer_size().ok()) {
                    (Some(p), Some(s)) => Some((p.x, p.y, s.width as i32, s.height as i32)),
                    _ => None,
                }
            };
            #[cfg(not(windows))]
            let pet_rect = match (win.outer_position().ok(), win.outer_size().ok()) {
                (Some(p), Some(s)) => Some((p.x, p.y, s.width as i32, s.height as i32)),
                _ => None,
            };

            if let Some((pos_x, pos_y, win_w, win_h)) = pet_rect {
                let cx = pos_x + win_w / 2;
                let cy = pos_y + win_h / 2;
                let sf = win.scale_factor().unwrap_or(1.0);
                let (probe_x, probe_y) = get_cursor_pos(sf).unwrap_or((cx, cy));
                let monitors = win.available_monitors().ok().unwrap_or_default();
                let find_mon = |px: i32, py: i32| {
                    monitors
                        .iter()
                        .find(|m| {
                            let mp = m.position();
                            let ms = m.size();
                            px >= mp.x
                                && px < mp.x + ms.width as i32
                                && py >= mp.y
                                && py < mp.y + ms.height as i32
                        })
                        .cloned()
                };
                let monitor = find_mon(probe_x, probe_y)
                    .or_else(|| find_mon(cx, cy))
                    .or_else(|| win.current_monitor().ok().flatten())
                    .or_else(|| win.primary_monitor().ok().flatten());

                if let Some(mon) = monitor {
                    let work = mon.work_area();
                    let (wx, wy, ww, wh) = if work.size.width > 0 && work.size.height > 0 {
                        (
                            work.position.x,
                            work.position.y,
                            work.size.width as i32,
                            work.size.height as i32,
                        )
                    } else {
                        let mp = mon.position();
                        let ms = mon.size();
                        (mp.x, mp.y, ms.width as i32, ms.height as i32)
                    };

                    // Linux / non-native-drag platforms evaluate post-drag edge peek here
                    // (skip fallback if `wait_linux_drag_end` already drove WYSIWYG live preview on X11)
                    #[cfg(target_os = "linux")]
                    let linux_preview_ran = LINUX_LIVE_PREVIEW_RAN.swap(false, Ordering::AcqRel);
                    #[cfg(target_os = "linux")]
                    if detected == "none" && !linux_preview_ran {
                        let (cur_x, cur_y) =
                            input_hook::linux_hook::cursor_pos().unwrap_or((cx, cy));
                        detected = detect_linux_edge_peek_after_drag(
                            cur_x, cur_y, pos_x, pos_y, win_w, win_h, wx, wy, ww, wh,
                        )
                        .to_string();
                    }
                    #[cfg(all(not(windows), not(target_os = "linux")))]
                    if detected == "none" {
                        detected = detect_corner_safe_peek_edge(
                            cx, cy, pos_x, pos_y, win_w, win_h, wx, wy, ww, wh,
                        )
                        .to_string();
                    }

                    let snap_pos = compute_edge_peek_snap_pos(
                        detected.as_str(),
                        pos_y,
                        win_w,
                        win_h,
                        wx,
                        wy,
                        ww,
                        wh,
                    );

                    if let Some((sx, sy)) = snap_pos {
                        #[cfg(windows)]
                        if win_needs_win7_ulw() {
                            win7_layered::set_position(sx, sy);
                            if win7_layered::is_overlay_active() {
                                let _ = win.set_position(PhysicalPosition::new(sx, sy));
                            }
                        } else {
                            let _ = win.set_position(PhysicalPosition::new(sx, sy));
                        }
                        #[cfg(not(windows))]
                        {
                            let _ = win.set_position(PhysicalPosition::new(sx, sy));
                        }
                    }
                }
            }
        }
        detected
    };

    if let Ok(mut guard) = state.peek_edge.lock() {
        *guard = detected.clone();
    }
    let _ = app.emit("kuro-peek-edge", detected.clone());
    detected
}

#[tauri::command]
fn sync_peek_edge_after_drag(app: AppHandle) -> String {
    #[cfg(windows)]
    if WIN_FALLBACK_FINALIZED.swap(false, Ordering::AcqRel) {
        return app
            .state::<AppState>()
            .peek_edge
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "none".to_string());
    }
    #[cfg(target_os = "macos")]
    if MACOS_FALLBACK_FINALIZED.swap(false, Ordering::AcqRel) {
        return app
            .state::<AppState>()
            .peek_edge
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "none".to_string());
    }
    finalize_peek_edge_for_app(&app)
}

/// Native 120Hz unclamped pointer drag on Windows and macOS:
/// - Windows: bypasses `WM_NCLBUTTONDOWN(HTCAPTION)` so Aero Snap never fights the user and
///   transparent headspace above the cat's ears can slide cleanly above `y = 0`. Honors
///   `SM_SWAPBUTTON` + `WH_MOUSE_LL`, and returns `false` if native button polling cannot engage
///   so the frontend falls back to `startDragging()`.
/// - macOS: bypasses `performWindowDragWithEvent:` (broken under Accessory + unfocused borderless
///   windows / async WebKit IPC on modern macOS, #59) via CoreGraphics + `NSWindow::setFrameOrigin:`.
/// Returns `true` when handled natively; `false` on other platforms so the frontend falls back
/// to Tauri's `startDragging()`.
#[tauri::command]
async fn start_pet_drag(app: AppHandle) -> bool {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || run_windows_native_drag(app, None))
            .await
            .unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || run_macos_native_drag(app, None))
            .await
            .unwrap_or(false)
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = app;
        false
    }
}

#[cfg(target_os = "linux")]
static LINUX_LIVE_PREVIEW_RAN: AtomicBool = AtomicBool::new(false);

/// On Linux, `gtk::Window::begin_move_drag` (`startDragging()`) returns immediately (~1ms)
/// before the user actually releases the mouse button. This command blocks until X11 `Button1Mask`
/// is released while running the same `pulled_from_edge` suppression + 200ms dwell live
/// `kuro-peek-preview` loop used on Windows and macOS. Returns `false` on pure Wayland without X11
/// so the frontend can fall back to awaiting `mouseUp`.
#[tauri::command]
async fn wait_linux_drag_end(app: AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        let state = app.state::<AppState>();
        let pulled_from_edge: String = state
            .peek_edge
            .lock()
            .map(|mut g| {
                let prev = g.clone();
                *g = "none".to_string();
                prev
            })
            .unwrap_or_else(|_| "none".to_string());
        if pulled_from_edge != "none" {
            let _ = app.emit("kuro-peek-edge", "none");
        }
        let peek_preview_state = state.peek_preview_edge.clone();
        if let Ok(mut g) = peek_preview_state.lock() {
            *g = "none".to_string();
        }
        if input_hook::linux_hook::query_pointer_state().is_none() {
            LINUX_LIVE_PREVIEW_RAN.store(false, Ordering::Release);
            return false;
        }
        LINUX_LIVE_PREVIEW_RAN.store(true, Ordering::Release);

        let drag_app = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let started = Instant::now();
            let mut suppress_edge: Option<String> =
                if pulled_from_edge == "left" || pulled_from_edge == "right" {
                    Some(pulled_from_edge)
                } else {
                    None
                };
            let mut candidate_edge: &'static str = "none";
            let mut candidate_since = Instant::now();
            let mut emitted_preview: &'static str = "none";

            // Brief grace window so a tap-fast click-drag doesn't exit before X11 reflects Button1Mask
            while started.elapsed() < Duration::from_secs(60) {
                let Some((cur_x, cur_y, left_down)) = input_hook::linux_hook::query_pointer_state()
                else {
                    break;
                };
                if !left_down {
                    break;
                }
                if let Some(win) = drag_app.get_webview_window("main") {
                    if let (Ok(pos), Ok(sz)) = (win.outer_position(), win.outer_size()) {
                        let win_w = sz.width as i32;
                        let win_h = sz.height as i32;
                        let monitor = win
                            .available_monitors()
                            .ok()
                            .and_then(|mons| {
                                mons.into_iter().find(|m| {
                                    let mp = m.position();
                                    let ms = m.size();
                                    cur_x >= mp.x
                                        && cur_x <= mp.x + ms.width as i32
                                        && cur_y >= mp.y
                                        && cur_y <= mp.y + ms.height as i32
                                })
                            })
                            .or_else(|| win.current_monitor().ok().flatten())
                            .or_else(|| win.primary_monitor().ok().flatten());
                        if let Some(mon) = monitor {
                            let work = mon.work_area();
                            let (wx, wy, ww, wh) = if work.size.width > 0 && work.size.height > 0 {
                                (
                                    work.position.x,
                                    work.position.y,
                                    work.size.width as i32,
                                    work.size.height as i32,
                                )
                            } else {
                                let mp = mon.position();
                                let ms = mon.size();
                                (mp.x, mp.y, ms.width as i32, ms.height as i32)
                            };
                            let detected_edge = detect_linux_edge_peek_after_drag(
                                cur_x, cur_y, pos.x, pos.y, win_w, win_h, wx, wy, ww, wh,
                            );
                            if detected_edge == "none" {
                                suppress_edge = None;
                            }
                            let raw_edge = if suppress_edge.as_deref() == Some(detected_edge) {
                                "none"
                            } else {
                                detected_edge
                            };
                            if raw_edge == "none" {
                                candidate_edge = "none";
                                if emitted_preview != "none" {
                                    emitted_preview = "none";
                                    if let Ok(mut g) = peek_preview_state.lock() {
                                        *g = "none".to_string();
                                    }
                                    let _ = drag_app.emit("kuro-peek-preview", "none");
                                }
                            } else {
                                if raw_edge != candidate_edge {
                                    candidate_edge = raw_edge;
                                    candidate_since = Instant::now();
                                }
                                if emitted_preview != raw_edge
                                    && candidate_since.elapsed() >= Duration::from_millis(200)
                                {
                                    emitted_preview = raw_edge;
                                    if let Ok(mut g) = peek_preview_state.lock() {
                                        *g = raw_edge.to_string();
                                    }
                                    let _ = drag_app.emit("kuro-peek-preview", raw_edge);
                                }
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(16));
            }
        })
        .await;
        true
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        true
    }
}

#[tauri::command]
fn set_update_banner_open(state: State<'_, AppState>, open: bool) {
    state.update_banner_open.store(open, Ordering::Relaxed);
}

#[tauri::command]
fn get_app_version() -> String {
    updater::CURRENT_VERSION.to_string()
}

#[tauri::command]
fn get_cached_update_info() -> Option<updater::UpdateInfo> {
    updater::get_cached_update_info()
}

#[tauri::command]
async fn check_for_update() -> Result<updater::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(updater::check_latest_update)
        .await
        .map_err(|e| format!("检查更新任务异常: {}", e))?
}

#[tauri::command]
async fn install_update(app: AppHandle, info: updater::UpdateInfo) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || updater::perform_update_install(&app, info))
        .await
        .map_err(|e| format!("安装更新任务异常: {}", e))?
}

#[tauri::command]
fn open_release_page(url: String) {
    updater::open_url_in_browser(&url);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminStatus {
    supported: bool,
    elevated: bool,
    mac_input_diag: bool,
}

#[tauri::command]
fn get_admin_status() -> AdminStatus {
    #[cfg(windows)]
    {
        AdminStatus {
            supported: true,
            elevated: win_is_elevated(),
            mac_input_diag: false,
        }
    }
    #[cfg(target_os = "macos")]
    {
        AdminStatus {
            supported: false,
            elevated: false,
            mac_input_diag: true,
        }
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        AdminStatus {
            supported: false,
            elevated: false,
            mac_input_diag: false,
        }
    }
}

#[tauri::command]
fn diagnose_macos_input() {
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| {
            input_hook::macos_hook::show_macos_diagnostics_dialog();
        });
    }
}

#[tauri::command]
fn restart_as_admin(app: AppHandle) {
    #[cfg(windows)]
    if !win_is_elevated() {
        win_restart_as_admin(app);
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
#[cfg(windows)]
fn save_window_pos(app: AppHandle) {
    if win_needs_win7_ulw() {
        if let Some((x, y, _, _)) = win7_layered::get_rect() {
            windows_display::remember_dragged_position(&app, PhysicalPosition::new(x, y));
        }
    } else if let Some(position) = app
        .get_webview_window("main")
        .and_then(|win| win.outer_position().ok())
    {
        windows_display::remember_dragged_position(&app, position);
    }
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn save_window_pos(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(win) = handle.get_webview_window("main") else {
            return;
        };
        let Ok(position) = win.outer_position() else {
            return;
        };
        let state = handle.state::<AppState>();
        let unpinned = {
            let mut settings = state.settings.lock().unwrap();
            let unpinned = settings
                .display_id
                .as_deref()
                .is_some_and(|id| !macos_window::is_at_display_corner(&win, id));
            if unpinned {
                settings.display_id = None;
            }
            settings.x = Some(position.x);
            settings.y = Some(position.y);
            save_settings(&settings);
            unpinned.then(|| settings.clone())
        };
        if let Some(settings) = unpinned {
            let _ = macos_window::refresh_menu(&handle);
            let _ = handle.emit("kuro-settings", settings);
        }
    });
}

#[tauri::command]
#[cfg(all(not(windows), not(target_os = "macos")))]
fn save_window_pos(app: AppHandle, state: State<'_, AppState>) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(pos) = win.outer_position() {
            let mut s = state.settings.lock().unwrap();
            s.x = Some(pos.x);
            s.y = Some(pos.y);
            save_settings(&s);
        }
    }
}

#[tauri::command]
fn reset_position(app: AppHandle) {
    reset_window_position(&app);
}

#[tauri::command]
fn create_desktop_shortcut() -> Result<String, String> {
    config::create_desktop_shortcut()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    shutdown_pet_windows();
    if let Some(w) = app.get_webview_window("live") {
        let _ = w.destroy();
    }
    app.exit(0);
}

pub fn apply_breed_and_save(app: &AppHandle, breed: &str) {
    let clean = sanitize_cat_id(breed);
    let normalized = if cat_exists(&clean) {
        clean
    } else {
        "black".to_string()
    };
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.cat_breed = normalized;
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn reload_and_emit_all(app: &AppHandle) {
    let cats = all_cats();
    let state = app.state::<AppState>();

    let (
        disk_settings,
        size_changed,
        top_changed,
        display_changed,
        hide_pet_changed,
        live_needs_sync,
        lang_changed,
    ) = {
        let mut s = state.settings.lock().unwrap();
        let disk_settings = load_settings();
        let sc = (s.scale - disk_settings.scale).abs() > 0.01
            || s.keyboard_layout != disk_settings.keyboard_layout;
        let tc = s.always_on_top != disk_settings.always_on_top;
        let hpc = should_hide_desktop_pet(&s) != should_hide_desktop_pet(&disk_settings);
        let lns = s.live_capture_enabled != disk_settings.live_capture_enabled
            || (disk_settings.live_capture_enabled
                && s.keyboard_layout != disk_settings.keyboard_layout);
        let lc = s.language != disk_settings.language;
        #[cfg(target_os = "macos")]
        let display_changed = s.display_id != disk_settings.display_id;
        #[cfg(windows)]
        let display_changed = s.windows_display_id != disk_settings.windows_display_id;
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let display_changed = false;
        *s = disk_settings.clone();
        (disk_settings, sc, tc, display_changed, hpc, lns, lc)
    };
    state
        .mcp_enabled
        .store(disk_settings.mcp_enabled, Ordering::Relaxed);
    obs::sync_obs_server(app, disk_settings.obs_enabled, disk_settings.obs_port);
    if live_needs_sync
        || (disk_settings.live_capture_enabled && app.get_webview_window("live").is_none())
    {
        sync_live_capture_window(
            app,
            disk_settings.live_capture_enabled,
            &disk_settings.keyboard_layout,
        );
    }
    if hide_pet_changed && !state.paused_guard.load(Ordering::Relaxed) {
        set_pet_visible(app, !should_hide_desktop_pet(&disk_settings));
    }
    tray::sync_checkmarks(&disk_settings);
    if lang_changed {
        tray::refresh_tray_language(app);
    }

    if top_changed {
        set_pet_always_on_top(app, disk_settings.always_on_top);
    }
    #[cfg(windows)]
    if win_needs_win7_ulw() {
        win7_layered::set_opacity(disk_settings.opacity);
    }
    #[cfg(target_os = "macos")]
    if display_changed {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            macos_window::restore_pinned_position(&handle);
            let _ = macos_window::refresh_menu(&handle);
        });
    }
    #[cfg(windows)]
    if display_changed {
        windows_display::refresh_placement(app);
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let _ = display_changed;
    if let Some(win) = app.get_webview_window("main") {
        if size_changed {
            let _ = resize_window_anchored_bottom_right(
                &win,
                &disk_settings.keyboard_layout,
                disk_settings.scale,
            );
        }
    }

    let _ = app.emit("kuro-cats", cats);
    let _ = app.emit("kuro-settings", disk_settings);
}

fn file_mtime(path: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

fn start_storage_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let c_path = cats_path();
        let s_path = config_path();
        let mut last_cats_m = file_mtime(&c_path);
        let mut last_settings_m = file_mtime(&s_path);

        loop {
            std::thread::sleep(Duration::from_millis(400));
            let cur_c = file_mtime(&c_path);
            let cur_s = file_mtime(&s_path);
            if cur_c != last_cats_m || cur_s != last_settings_m {
                last_cats_m = cur_c;
                last_settings_m = cur_s;
                reload_and_emit_all(&app);
            }
        }
    });
}

pub fn apply_scale_and_save(app: &AppHandle, scale: f64) {
    let clamped = scale.clamp(0.20, 1.50);
    let state = app.state::<AppState>();
    let layout = { state.settings.lock().unwrap().keyboard_layout.clone() };
    let new_pos = app
        .get_webview_window("main")
        .and_then(|win| resize_window_anchored_bottom_right(&win, &layout, clamped));
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.scale = clamped;
        if let Some((nx, ny)) = new_pos {
            s.x = Some(nx);
            s.y = Some(ny);
        }
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn apply_keyboard_layout_and_save(app: &AppHandle, layout: &str) {
    let normalized = normalize_keyboard_layout(layout);
    let state = app.state::<AppState>();
    let cur_scale = { state.settings.lock().unwrap().scale };
    let new_pos = app
        .get_webview_window("main")
        .and_then(|win| resize_window_anchored_bottom_right(&win, &normalized, cur_scale));
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.keyboard_layout = normalized;
        if let Some((nx, ny)) = new_pos {
            s.x = Some(nx);
            s.y = Some(ny);
        }
        save_settings(&s);
        s.clone()
    };
    if updated.live_capture_enabled {
        sync_live_capture_window(app, true, &updated.keyboard_layout);
    }
    let _ = app.emit("kuro-settings", updated);
}

pub fn apply_keyboard_orientation_and_save(app: &AppHandle, orientation: &str) {
    let normalized = normalize_keyboard_orientation(orientation);
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.keyboard_orientation = normalized;
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn apply_tail_key_mode_and_save(app: &AppHandle, mode: &str) {
    let normalized = normalize_tail_key_mode(mode);
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.tail_key_mode = normalized;
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

#[cfg(target_os = "macos")]
pub fn reset_window_position(app: &AppHandle) {
    clear_peek_state(app);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(win) = handle.get_webview_window("main") else {
            return;
        };
        let state = handle.state::<AppState>();
        let mut settings = state.settings.lock().unwrap();
        if macos_window::place(&win, settings.display_id.as_deref()) {
            if let Ok(position) = win.outer_position() {
                settings.x = Some(position.x);
                settings.y = Some(position.y);
                save_settings(&settings);
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn reset_window_position(app: &AppHandle) {
    clear_peek_state(app);
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(windows)]
        if windows_display::reset_position(app, &win) {
            return;
        }
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize::new(420, 440));
        let sf = win.scale_factor().unwrap_or(1.0);
        #[cfg(windows)]
        let (w_px, h_px) = if win_needs_win7_ulw() {
            win7_layered::get_rect()
                .map(|(_, _, w, h)| (w, h))
                .unwrap_or((size.width as i32, size.height as i32))
        } else {
            (size.width as i32, size.height as i32)
        };
        #[cfg(not(windows))]
        let (w_px, h_px) = (size.width as i32, size.height as i32);

        let (target_x, target_y) = default_bottom_right_position(w_px, h_px, sf);
        #[cfg(windows)]
        if win_needs_win7_ulw() {
            win7_layered::set_position(target_x, target_y);
            if win7_layered::is_overlay_active() {
                let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
            }
        } else {
            let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
        }
        #[cfg(not(windows))]
        {
            let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
        }

        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        s.x = Some(target_x);
        s.y = Some(target_y);
        save_settings(&s);
    }
}

#[cfg(windows)]
fn default_bottom_right_position(win_w: i32, win_h: i32, _scale_factor: f64) -> (i32, i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        ((sw - win_w - 28).max(20), (sh - win_h - 68).max(20))
    }
}

#[cfg(target_os = "linux")]
fn default_bottom_right_position(win_w: i32, win_h: i32, _scale_factor: f64) -> (i32, i32) {
    let (sw, sh) = input_hook::linux_hook::primary_screen_size();
    ((sw - win_w - 28).max(20), (sh - win_h - 68).max(20))
}

#[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
fn default_bottom_right_position(_win_w: i32, _win_h: i32, _scale_factor: f64) -> (i32, i32) {
    (900, 500)
}

#[cfg(windows)]
fn get_cursor_pos(_scale_factor: f64) -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn get_cursor_pos(scale_factor: f64) -> Option<(i32, i32)> {
    input_hook::macos_hook::cursor_pos_points().map(|(x, y)| {
        (
            (x * scale_factor).round() as i32,
            (y * scale_factor).round() as i32,
        )
    })
}

#[cfg(target_os = "linux")]
fn get_cursor_pos(_scale_factor: f64) -> Option<(i32, i32)> {
    input_hook::linux_hook::cursor_pos()
}

#[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
fn get_cursor_pos(_scale_factor: f64) -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
fn win_is_click_through(win: &tauri::WebviewWindow) -> Option<bool> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };
    let hwnd = win.hwnd().ok()?.0 as windows_sys::Win32::Foundation::HWND;
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    Some((ex & (WS_EX_TRANSPARENT as isize)) != 0)
}

#[cfg(windows)]
fn win_force_click_through(win: &tauri::WebviewWindow, ignore: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    let Ok(raw_hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;
    let is_win7 = win_needs_win7_ulw();
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex = if ignore {
            ex | (WS_EX_TRANSPARENT as isize) | (WS_EX_LAYERED as isize)
        } else if is_win7 {
            // Keep the offscreen/overlay WebView2 HWND free of WS_EX_LAYERED so popup overlays
            // (context menu / toast) never hit Win7's layered-alpha=0 invisibility quirk.
            ex & !(WS_EX_TRANSPARENT as isize) & !(WS_EX_LAYERED as isize)
        } else {
            ex & !(WS_EX_TRANSPARENT as isize)
        };
        if new_ex != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);
            let _ = SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(windows)]
fn win_foreground_hwnd() -> windows_sys::Win32::Foundation::HWND {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() }
}

#[cfg(windows)]
fn win_is_topmost(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOPMOST,
    };
    if hwnd.is_null() {
        return false;
    }
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    (ex & (WS_EX_TOPMOST as isize)) != 0
}

#[cfg(windows)]
fn win_is_iconic(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsIconic;
    if hwnd.is_null() {
        return false;
    }
    unsafe { IsIconic(hwnd) != 0 }
}

/// Returns true for Windows remote-desktop / VM console windows that should NEVER be covered by
/// KuroCat when running fullscreen on the same monitor (#40).
#[cfg(any(windows, test))]
pub(crate) fn is_remote_desktop_window(class_name: &str, exe_name: &str) -> bool {
    if class_name.eq_ignore_ascii_case("TscShellContainerClass") {
        return true;
    }
    let lower_exe = exe_name.to_ascii_lowercase();
    matches!(
        lower_exe.as_str(),
        "mstsc.exe"
            | "msrdc.exe"
            | "windowsapp.exe"
            | "rdclient.exe"
            | "wfica32.exe"
            | "vmware-view.exe"
            | "vmplayer.exe"
            | "vmware.exe"
            | "virtualboxvm.exe"
            | "rustdesk.exe"
            | "todesk.exe"
            | "sunloginclient.exe"
            | "parsec.exe"
    )
}

/// Returns true for Windows system flyouts / notification surfaces (Win11 Calendar, Notification
/// Center, Quick Settings, Start/Search, Tray Overflow, Alt-Tab) that have higher user priority
/// than a desktop pet and should NEVER be occluded when visible & overlapping (#40).
#[cfg(any(windows, test))]
pub(crate) fn is_system_shell_flyout_class(class_name: &str) -> bool {
    matches!(
        class_name,
        "Windows.UI.Core.CoreWindow"
            | "XamlExplorerHostIslandWindow"
            | "ControlCenterWindow"
            | "TopLevelWindowForOverflowXamlIsland"
            | "NotifyIconOverflowWindow"
            | "MultitaskingViewFrame"
            | "TaskListThumbnailWnd"
            | "PopupHost"
    )
}

/// Returns true if a non-activating / tool topmost popup from another process has plausible
/// notification-toast dimensions (e.g. Telegram, WeChat, QQ, Slack, or OS corner toast popups)
/// across 100%–250% DPI (#40).
#[cfg(any(windows, test))]
pub(crate) fn is_plausible_toast_popup_size(width: i32, height: i32) -> bool {
    (100..=960).contains(&width) && (44..=640).contains(&height)
}

#[cfg(windows)]
fn win_window_class_name(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buf = [0u16; 96];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

#[cfg(windows)]
fn win_process_exe_name(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut pid: u32 = 0;
    unsafe {
        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid == 0 {
        return String::new();
    }
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 520];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        let _ = CloseHandle(handle);
        if ok == 0 || size == 0 {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        std::path::Path::new(&full)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    }
}

#[cfg(windows)]
fn win_is_window_cloaked(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            hwnd: HWND,
            dwattribute: u32,
            pvattribute: *mut std::ffi::c_void,
            cbattribute: u32,
        ) -> i32;
    }
    const DWMWA_CLOAKED: u32 = 14;
    let mut cloaked: u32 = 0;
    let hr = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    hr == 0 && cloaked != 0
}

#[cfg(windows)]
fn win_is_fullscreen_on_monitor(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut rc = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe {
        if GetWindowRect(hwnd, &mut rc) == 0 {
            return false;
        }
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if mon.is_null() {
            return false;
        }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return false;
        }
        let mw = (mi.rcMonitor.right - mi.rcMonitor.left).max(1);
        let mh = (mi.rcMonitor.bottom - mi.rcMonitor.top).max(1);
        let rw = rc.right - rc.left;
        let rh = rc.bottom - rc.top;
        rw * 100 >= mw * 96
            && rh * 100 >= mh * 96
            && rc.left <= mi.rcMonitor.left + 8
            && rc.top <= mi.rcMonitor.top + 8
    }
}

#[cfg(windows)]
fn win_point_belongs_to_pet(
    x: i32,
    y: i32,
    our_hwnd: windows_sys::Win32::Foundation::HWND,
) -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};
    if our_hwnd.is_null() {
        return false;
    }
    unsafe {
        let hit = WindowFromPoint(POINT { x, y });
        if hit.is_null() {
            return false;
        }
        if hit == our_hwnd {
            return true;
        }
        GetAncestor(hit, GA_ROOT) == our_hwnd
    }
}

#[cfg(windows)]
fn win_is_ignored_shell_window(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    let class_name = win_window_class_name(hwnd);
    if class_name.is_empty() {
        return false;
    }
    matches!(
        class_name.as_str(),
        "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "Progman"
            | "WorkerW"
            | "Windows.UI.Core.CoreWindow"
            | "XamlExplorerHostIslandWindow"
            | "ControlCenterWindow"
            | "TopLevelWindowForOverflowXamlIsland"
            | "NotifyIconOverflowWindow"
            | "MultitaskingViewFrame"
            | "TaskListThumbnailWnd"
            | "PopupHost"
    )
}

#[cfg(windows)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum WinYieldAction {
    None,
    /// An overlapping shell flyout or toast popup is already above KuroCat; suppress topmost fight.
    HoldBelow,
    /// Place KuroCat directly beneath a topmost flyout/toast while staying above normal windows.
    PlaceBelowTopmost(isize),
    /// Temporarily drop HWND_TOPMOST behind a fullscreen Remote Desktop or non-topmost shell flyout.
    DemoteBehind(isize),
}

/// Checks whether KuroCat should yield its `HWND_TOPMOST` Z-order on Windows (#40):
/// 1. Fullscreen Remote Desktop (`mstsc.exe` / `TscShellContainerClass`, etc.) overlapping KuroCat.
/// 2. Visible, uncloaked Windows 10/11 Shell flyouts overlapping KuroCat (Clock Calendar,
///    Notification Center, Quick Settings, Tray Overflow, Windows Toast Notifications).
/// 3. Small/medium `WS_EX_TOPMOST` + (`WS_EX_TOOLWINDOW` | `WS_EX_NOACTIVATE`) notification toast
///    popups from other apps (e.g. Telegram, WeChat, QQ, Slack) overlapping KuroCat.
#[cfg(windows)]
fn win_detect_yield_action(
    our_hwnd: windows_sys::Win32::Foundation::HWND,
    fg_hwnd: windows_sys::Win32::Foundation::HWND,
) -> WinYieldAction {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT,
    };

    if our_hwnd.is_null() {
        return WinYieldAction::None;
    }

    // 1. Fullscreen Remote Desktop client in the foreground overlapping KuroCat -> yield behind it.
    if !fg_hwnd.is_null() && fg_hwnd != our_hwnd && !win_is_iconic(fg_hwnd) {
        let fg_cls = win_window_class_name(fg_hwnd);
        let fg_exe = win_process_exe_name(fg_hwnd);
        if is_remote_desktop_window(&fg_cls, &fg_exe)
            && win_is_fullscreen_on_monitor(fg_hwnd)
            && win_rects_overlap(fg_hwnd, our_hwnd)
        {
            return WinYieldAction::DemoteBehind(fg_hwnd as isize);
        }
    }

    // 2. Overlapping visible, uncloaked system flyouts (Calendar / Notifications / Quick Settings)
    //    and third-party topmost toast popups (e.g. Telegram notifications).
    let mut our_rc = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(our_hwnd, &mut our_rc) } == 0 {
        return WinYieldAction::None;
    }

    #[repr(C)]
    struct YieldScanCtx {
        our_hwnd: HWND,
        our_pid: u32,
        our_rc: RECT,
        seen_our_hwnd: bool,
        any_blocker_above: bool,
        lowest_topmost_below: isize,
        lowest_non_topmost_flyout_below: isize,
    }

    unsafe extern "system" fn scan_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut YieldScanCtx);
        if hwnd == ctx.our_hwnd {
            ctx.seen_our_hwnd = true;
            return 1;
        }
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return 1;
        }
        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == ctx.our_pid {
            return 1;
        }

        let mut rc = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rc) == 0 {
            return 1;
        }
        let w = rc.right - rc.left;
        let h = rc.bottom - rc.top;
        if w < 40 || h < 40 {
            return 1;
        }
        if !(rc.left < ctx.our_rc.right
            && rc.right > ctx.our_rc.left
            && rc.top < ctx.our_rc.bottom
            && rc.bottom > ctx.our_rc.top)
        {
            return 1;
        }

        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Never yield to click-through transparent overlays (e.g. HUDs / crosshair / other pets).
        if (ex & (WS_EX_TRANSPARENT as isize)) != 0 {
            return 1;
        }

        let is_topmost = (ex & (WS_EX_TOPMOST as isize)) != 0;
        let cls = win_window_class_name(hwnd);
        let is_flyout = is_system_shell_flyout_class(&cls);
        let is_toast = !is_flyout
            && is_topmost
            && ((ex & (WS_EX_TOOLWINDOW as isize)) != 0 || (ex & (WS_EX_NOACTIVATE as isize)) != 0)
            && is_plausible_toast_popup_size(w, h);

        if !is_flyout && !is_toast {
            return 1;
        }
        if win_is_window_cloaked(hwnd) {
            return 1;
        }

        if !ctx.seen_our_hwnd {
            ctx.any_blocker_above = true;
        } else if is_topmost {
            ctx.lowest_topmost_below = hwnd as isize;
        } else if is_flyout {
            ctx.lowest_non_topmost_flyout_below = hwnd as isize;
        }
        1
    }

    let mut ctx = YieldScanCtx {
        our_hwnd,
        our_pid: std::process::id(),
        our_rc,
        seen_our_hwnd: false,
        any_blocker_above: false,
        lowest_topmost_below: 0,
        lowest_non_topmost_flyout_below: 0,
    };
    unsafe {
        let _ = EnumWindows(Some(scan_proc), (&mut ctx as *mut YieldScanCtx) as LPARAM);
    }

    if ctx.lowest_non_topmost_flyout_below != 0 {
        WinYieldAction::DemoteBehind(ctx.lowest_non_topmost_flyout_below)
    } else if ctx.lowest_topmost_below != 0 {
        WinYieldAction::PlaceBelowTopmost(ctx.lowest_topmost_below)
    } else if ctx.any_blocker_above {
        WinYieldAction::HoldBelow
    } else {
        WinYieldAction::None
    }
}

#[cfg(windows)]
fn win_place_below_hwnd(
    our_hwnd: windows_sys::Win32::Foundation::HWND,
    target_hwnd: windows_sys::Win32::Foundation::HWND,
    drop_topmost: bool,
) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if our_hwnd.is_null() {
        return;
    }
    unsafe {
        if drop_topmost {
            let _ = SetWindowPos(
                our_hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            // If `target_hwnd` is itself WS_EX_TOPMOST, HWND_NOTOPMOST already placed `our_hwnd`
            // strictly beneath it — calling SetWindowPos(our_hwnd, target_hwnd) would re-promote
            // `our_hwnd` back into the topmost band! Only insert below non-topmost targets.
            if !target_hwnd.is_null() && target_hwnd != our_hwnd && !win_is_topmost(target_hwnd) {
                let _ = SetWindowPos(
                    our_hwnd,
                    target_hwnd,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        } else if !target_hwnd.is_null() && target_hwnd != our_hwnd {
            let _ = SetWindowPos(
                our_hwnd,
                target_hwnd,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(windows)]
fn win_rects_overlap(
    a: windows_sys::Win32::Foundation::HWND,
    b: windows_sys::Win32::Foundation::HWND,
) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut ra = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let mut rb = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe {
        if GetWindowRect(a, &mut ra) == 0 || GetWindowRect(b, &mut rb) == 0 {
            return true;
        }
    }
    ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top
}

/// Inspired by BongoCat ADR-0096: determine whether the foreground window is
/// currently stacked above our pet window in Windows Z-order using early-exit
/// synchronous EnumWindows (covering both WS_EX_TOPMOST fullscreen windows and
/// Shell-elevated borderless / FSO fullscreen windows on any monitor).
#[cfg(windows)]
fn win_window_is_above(
    candidate: windows_sys::Win32::Foundation::HWND,
    model: windows_sys::Win32::Foundation::HWND,
) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;

    if candidate.is_null() || model.is_null() || candidate == model {
        return false;
    }
    if win_is_ignored_shell_window(candidate) || !win_rects_overlap(candidate, model) {
        return false;
    }

    #[repr(C)]
    struct OrderCtx {
        candidate: HWND,
        model: HWND,
        candidate_above: bool,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut OrderCtx);
        if hwnd == ctx.candidate {
            ctx.candidate_above = true;
            0
        } else if hwnd == ctx.model {
            0
        } else {
            1
        }
    }

    let mut ctx = OrderCtx {
        candidate,
        model,
        candidate_above: false,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), (&mut ctx as *mut OrderCtx) as LPARAM);
    }
    ctx.candidate_above
}

#[cfg(windows)]
pub fn win_gentle_reassert_topmost(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let Ok(raw_hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(windows)]
pub fn win_is_elevated() -> bool {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{BOOL, CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(
            process_handle: HANDLE,
            desired_access: u32,
            token_handle: *mut HANDLE,
        ) -> BOOL;
        fn GetTokenInformation(
            token_handle: HANDLE,
            token_information_class: u32,
            token_information: *mut c_void,
            token_information_length: u32,
            return_length: *mut u32,
        ) -> BOOL;
    }

    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_ELEVATION_CLASS: u32 = 20;

    #[repr(C)]
    struct TokenElevation {
        token_is_elevated: u32,
    }

    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 || token.is_null() {
            return false;
        }
        let mut elevation = TokenElevation {
            token_is_elevated: 0,
        };
        let mut ret_len: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TOKEN_ELEVATION_CLASS,
            (&mut elevation as *mut TokenElevation).cast(),
            std::mem::size_of::<TokenElevation>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        ok != 0 && elevation.token_is_elevated != 0
    }
}

#[cfg(windows)]
static WIN_ADMIN_RESTART_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static WIN_HANDOFF_NONCE: AtomicU64 = AtomicU64::new(1);

#[cfg(windows)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct WinStartupHandoffArgs {
    wait_pid: Option<u32>,
    handoff_event: Option<String>,
    cleanup_old_exe: Option<String>,
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct WinStartupHandoff {
    waited_for_prev: bool,
    prev_exited_cleanly: bool,
    had_handoff_event: bool,
}

#[cfg(windows)]
fn parse_win_startup_handoff_args<I, S>(args: I) -> WinStartupHandoffArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut parsed = WinStartupHandoffArgs::default();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_ref() {
            "--wait-pid" => {
                if let Some(pid_str) = iter.next() {
                    parsed.wait_pid = pid_str.as_ref().parse::<u32>().ok();
                }
            }
            "--handoff-event" => {
                if let Some(ev_name) = iter.next() {
                    let trimmed = ev_name.as_ref().trim();
                    if !trimmed.is_empty() {
                        parsed.handoff_event = Some(trimmed.to_string());
                    }
                }
            }
            "--cleanup-old-exe" => {
                if let Some(path) = iter.next() {
                    let trimmed = path.as_ref().trim();
                    if !trimmed.is_empty() {
                        parsed.cleanup_old_exe = Some(trimmed.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    parsed
}

/// Creates a per-session named Win32 Event (`Local\...`) with a permissive DACL so both
/// standard-integrity and elevated (or cross-admin-credential UAC) KuroCat processes within
/// the same interactive logon session can reliably signal each other.
#[cfg(windows)]
fn win_create_session_event(
    name: &str,
    manual_reset: bool,
) -> windows_sys::Win32::Foundation::HANDLE {
    use windows_sys::Win32::Security::{
        InitializeSecurityDescriptor, SetSecurityDescriptorDacl, SECURITY_ATTRIBUTES,
        SECURITY_DESCRIPTOR,
    };
    use windows_sys::Win32::System::Threading::CreateEventW;

    const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut sd: SECURITY_DESCRIPTOR = std::mem::zeroed();
        let sd_ok = InitializeSecurityDescriptor(
            (&mut sd as *mut SECURITY_DESCRIPTOR).cast(),
            SECURITY_DESCRIPTOR_REVISION,
        ) != 0
            && SetSecurityDescriptorDacl(
                (&mut sd as *mut SECURITY_DESCRIPTOR).cast(),
                1,
                std::ptr::null(),
                0,
            ) != 0;
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: (&mut sd as *mut SECURITY_DESCRIPTOR).cast(),
            bInheritHandle: 0,
        };
        let sa_ptr = if sd_ok { &sa as *const _ } else { std::ptr::null() };
        CreateEventW(sa_ptr, if manual_reset { 1 } else { 0 }, 0, wide.as_ptr())
    }
}

#[cfg(windows)]
fn win_signal_named_event(name: &str) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenEventW, SetEvent};

    const EVENT_MODIFY_STATE: u32 = 0x0002;
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let ev = OpenEventW(EVENT_MODIFY_STATE, 0, wide.as_ptr());
        if ev.is_null() {
            return false;
        }
        let ok = SetEvent(ev) != 0;
        let _ = CloseHandle(ev);
        ok
    }
}

/// If `child_process` unexpectedly ended up inside our kill-on-close Job Object (e.g. when UAC
/// is disabled and `ShellExecuteExW("runas")` spawns a direct child instead of going through
/// `AppInfo`), clear `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before exiting so the OS kernel does
/// not terminate the newly restarted KuroCat instance when the old process exits.
#[cfg(windows)]
fn win_disarm_job_kill_if_child_in_job(
    child_process: windows_sys::Win32::Foundation::HANDLE,
) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        IsProcessInJob, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    };

    if child_process.is_null() {
        return false;
    }
    let raw_job = WINDOWS_JOB_HANDLE.load(Ordering::Relaxed);
    if raw_job == 0 {
        return false;
    }
    let job = raw_job as HANDLE;
    unsafe {
        let mut in_job: BOOL = 0;
        if IsProcessInJob(child_process, job, &mut in_job) == 0 || in_job == 0 {
            return false;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) != 0
    }
}

#[cfg(windows)]
fn win_show_message_box(title: &str, body: &str, is_error: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_TOPMOST,
    };

    let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let body_w: Vec<u16> = body.encode_utf16().chain(std::iter::once(0)).collect();
    let style = MB_OK | MB_TOPMOST | if is_error { MB_ICONERROR } else { MB_ICONWARNING };
    unsafe {
        MessageBoxW(std::ptr::null_mut(), body_w.as_ptr(), title_w.as_ptr(), style);
    }
}

#[cfg(windows)]
fn win_admin_restart_alert_text(lang: &str, kind: &str, detail: Option<&str>) -> (String, String) {
    let suffix = detail
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n\n({})", s.trim()))
        .unwrap_or_default();
    match (lang, kind) {
        ("zh-TW", "handoff_timeout") => (
            "KuroCat 無法切換為管理員模式".to_string(),
            format!(
                "新的管理員實例未能順利啟動，已保留目前執行中的 KuroCat。\n如需管理員權限，請先完全退出 KuroCat，再右鍵以管理員身分執行。{}",
                suffix
            ),
        ),
        ("zh-TW", "lock_busy") => (
            "KuroCat 重新啟動交接逾時".to_string(),
            format!(
                "舊的 KuroCat 實例仍佔用單實例鎖，新的實例無法接管並已取消啟動。\n請先完全退出原本的 KuroCat 後再試一次。{}",
                suffix
            ),
        ),
        ("zh-TW", "startup_error") => (
            "KuroCat 啟動失敗".to_string(),
            format!("KuroCat 初始化視窗或 WebView2 時發生錯誤。{}", suffix),
        ),
        ("ja-JP", "handoff_timeout") => (
            "KuroCat 管理者モードへの切り替えに失敗".to_string(),
            format!(
                "管理者権限の新しいインスタンスが起動しなかったため、現在の KuroCat を維持しました。\n完全に終了してから右クリックで「管理者として実行」をお試しください。{}",
                suffix
            ),
        ),
        ("ja-JP", "lock_busy") => (
            "KuroCat 再起動の引き継ぎがタイムアウト".to_string(),
            format!(
                "以前の KuroCat がまだ終了していないため、新しいインスタンスを起動できませんでした。\n一度終了してから再度起動してください。{}",
                suffix
            ),
        ),
        ("ja-JP", "startup_error") => (
            "KuroCat の起動に失敗".to_string(),
            format!("ウィンドウまたは WebView2 の初期化中にエラーが発生しました。{}", suffix),
        ),
        ("ko-KR", "handoff_timeout") => (
            "KuroCat 관리자 모드 전환 실패".to_string(),
            format!(
                "새 관리자 인스턴스가 정상적으로 시작되지 않아 현재 KuroCat을 계속 유지했습니다.\n완전히 종료한 뒤 마우스 오른쪽 버튼으로 '관리자 권한으로 실행'을 시도해 주세요.{}",
                suffix
            ),
        ),
        ("ko-KR", "lock_busy") => (
            "KuroCat 재시작 인수 시간 초과".to_string(),
            format!(
                "이전 KuroCat 인스턴스가 아직 종료되지 않아 새 인스턴스를 시작하지 못했습니다.\n기존 KuroCat을 완전히 종료한 뒤 다시 실행해 주세요.{}",
                suffix
            ),
        ),
        ("ko-KR", "startup_error") => (
            "KuroCat 시작 실패".to_string(),
            format!("창 또는 WebView2 초기화 중 오류가 발생했습니다.{}", suffix),
        ),
        ("en-US", "handoff_timeout") => (
            "KuroCat Admin Restart Failed".to_string(),
            format!(
                "The elevated KuroCat instance did not finish starting, so the current instance was kept running.\nTo run as administrator, fully quit KuroCat first and then choose \"Run as administrator\".{}",
                suffix
            ),
        ),
        ("en-US", "lock_busy") => (
            "KuroCat Restart Handoff Timed Out".to_string(),
            format!(
                "The previous KuroCat instance is still holding the single-instance lock, so the new instance could not take over.\nPlease fully quit KuroCat and launch it again.{}",
                suffix
            ),
        ),
        ("en-US", "startup_error") => (
            "KuroCat Failed to Start".to_string(),
            format!("KuroCat failed to initialize its window or WebView2 runtime.{}", suffix),
        ),
        (_, "handoff_timeout") => (
            "KuroCat 管理员重启未完成".to_string(),
            format!(
                "新的管理员实例未能顺利启动，已为你保留当前运行中的 KuroCat。\n如需管理员权限，请先完全退出 KuroCat，再右键选择「以管理员身份运行」。{}",
                suffix
            ),
        ),
        (_, "lock_busy") => (
            "KuroCat 重启交接超时".to_string(),
            format!(
                "旧的 KuroCat 实例尚未完全退出并释放单实例锁，新实例未能接管。\n请先完全退出旧实例后重新启动。{}",
                suffix
            ),
        ),
        _ => (
            "KuroCat 启动失败".to_string(),
            format!("KuroCat 初始化窗口或 WebView2 时发生错误。{}", suffix),
        ),
    }
}

#[cfg(windows)]
pub fn win_restart_as_admin(app: AppHandle) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
    use windows_sys::Win32::System::Threading::{WaitForMultipleObjects, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    const ERROR_CANCELLED: u32 = 1223;
    const WAIT_OBJECT_0: u32 = 0;

    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    if WIN_ADMIN_RESTART_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let current_pid = std::process::id();
    let lang = i18n::effective_locale(&load_settings().language);

    std::thread::spawn(move || {
        struct ResetRestartFlag;
        impl Drop for ResetRestartFlag {
            fn drop(&mut self) {
                WIN_ADMIN_RESTART_IN_PROGRESS.store(false, Ordering::Release);
            }
        }
        struct ComStaGuard(bool);
        impl Drop for ComStaGuard {
            fn drop(&mut self) {
                if self.0 {
                    unsafe {
                        CoUninitialize();
                    }
                }
            }
        }

        let reset_guard = ResetRestartFlag;
        let com_init_ok = unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok()
        };
        let _com_guard = ComStaGuard(com_init_ok);

        let to_wide = |s: &std::ffi::OsStr| -> Vec<u16> {
            s.encode_wide().chain(std::iter::once(0)).collect()
        };

        let nonce = WIN_HANDOFF_NONCE.fetch_add(1, Ordering::Relaxed);
        let event_name = format!("Local\\KuroCat.AdminHandoff.{}.{}", current_pid, nonce);
        let handoff_ev = win_create_session_event(&event_name, true);

        let verb = to_wide(std::ffi::OsStr::new("runas"));
        let file = to_wide(exe.as_os_str());
        let params_str = if !handoff_ev.is_null() {
            format!("--wait-pid {} --handoff-event {}", current_pid, event_name)
        } else {
            format!("--wait-pid {}", current_pid)
        };
        let params = to_wide(std::ffi::OsStr::new(&params_str));
        let dir = exe.parent().map(|p| to_wide(p.as_os_str()));
        let dir_ptr = dir.as_ref().map_or(std::ptr::null(), |v| v.as_ptr());

        let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        sei.lpVerb = verb.as_ptr();
        sei.lpFile = file.as_ptr();
        sei.lpParameters = params.as_ptr();
        sei.lpDirectory = dir_ptr;
        sei.nShow = SW_SHOWNORMAL;

        let launched = unsafe { ShellExecuteExW(&mut sei) != 0 };
        if !launched {
            let err = unsafe { GetLastError() };
            if !handoff_ev.is_null() {
                unsafe {
                    let _ = CloseHandle(handoff_ev);
                }
            }
            if err != ERROR_CANCELLED {
                let detail = format!("ShellExecuteExW error {}", err);
                let (title, body) = win_admin_restart_alert_text(lang, "handoff_timeout", Some(&detail));
                win_show_message_box(&title, &body, false);
            }
            return;
        }

        // Wait for the elevated child to prove it actually launched and reached `run()` before
        // tearing down the current instance (#98). If the child dies early or never checks in,
        // keep the current instance alive instead of disappearing.
        let child_proc: HANDLE = sei.hProcess;
        let handoff_confirmed = if !handoff_ev.is_null() {
            unsafe {
                if !child_proc.is_null() {
                    let handles = [handoff_ev, child_proc];
                    WaitForMultipleObjects(2, handles.as_ptr(), 0, 15_000) == WAIT_OBJECT_0
                } else {
                    WaitForSingleObject(handoff_ev, 15_000) == WAIT_OBJECT_0
                }
            }
        } else if !child_proc.is_null() {
            // Fallback when creating the named event failed: ensure child stays alive briefly.
            unsafe { WaitForSingleObject(child_proc, 300) != WAIT_OBJECT_0 }
        } else {
            true
        };

        if !handoff_ev.is_null() {
            unsafe {
                let _ = CloseHandle(handoff_ev);
            }
        }

        if !handoff_confirmed {
            if !child_proc.is_null() {
                unsafe {
                    let _ = CloseHandle(child_proc);
                }
            }
            let (title, body) = win_admin_restart_alert_text(lang, "handoff_timeout", None);
            win_show_message_box(&title, &body, false);
            return;
        }

        // Protect against UAC-disabled direct-child spawns inheriting our kill-on-close job.
        let _ = win_disarm_job_kill_if_child_in_job(child_proc);
        if !child_proc.is_null() {
            unsafe {
                let _ = CloseHandle(child_proc);
            }
        }

        // Handoff confirmed: prevent re-entry and tear down cleanly.
        // Deliberately keep the single-instance mutex held until our process actually exits so
        // the elevated child wakes up from `WaitForSingleObject(old_pid)` only once our windows
        // and Job-Object WebView2 helpers are being reaped. A hard-exit watchdog guarantees the
        // old instance cannot stall `app.exit(0)` and starve the elevated child.
        std::mem::forget(reset_guard);
        APP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
        crate::input_hook::set_hooks_paused(true);
        obs::shutdown_obs_server();
        if win_needs_win7_ulw() {
            win7_layered::shutdown();
        }

        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(3500));
            release_single_instance_lock();
            std::process::exit(0);
        });

        let app_exit = app.clone();
        if app
            .run_on_main_thread(move || {
                if let Some(w) = app_exit.get_webview_window("live") {
                    let _ = w.destroy();
                }
                app_exit.exit(0);
            })
            .is_err()
        {
            app.exit(0);
        }
    });
}

#[cfg(windows)]
fn win_wait_for_previous_pid_if_requested() -> WinStartupHandoff {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    const PROCESS_SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_OBJECT_0: u32 = 0;

    let parsed = parse_win_startup_handoff_args(std::env::args().skip(1));
    let mut result = WinStartupHandoff {
        waited_for_prev: parsed.wait_pid.is_some(),
        prev_exited_cleanly: false,
        had_handoff_event: parsed.handoff_event.is_some(),
    };

    // Signal the outgoing instance FIRST so it begins its clean shutdown right away while we
    // wait on its PID to finish exiting (#98).
    if let Some(ref ev_name) = parsed.handoff_event {
        let _ = win_signal_named_event(ev_name);
    }

    if let Some(pid) = parsed.wait_pid {
        if pid != 0 && pid != std::process::id() {
            unsafe {
                let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
                if !handle.is_null() {
                    let wait_rc = WaitForSingleObject(handle, 15_000);
                    result.prev_exited_cleanly = wait_rc == WAIT_OBJECT_0;
                    let _ = CloseHandle(handle);
                } else {
                    // Process already exited before we could open it.
                    result.prev_exited_cleanly = true;
                }
            }
            // Give the kernel a short moment to finalize Job-Object WebView2 child teardown.
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    if let Some(old_path) = parsed.cleanup_old_exe {
        let path = std::path::PathBuf::from(old_path);
        for _ in 0..10 {
            if !path.exists() || std::fs::remove_file(&path).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    // Opportunistically remove any leftover `.exe.old` renamed aside by NSIS_HOOK_PREINSTALL (#73).
    if let Ok(exe) = std::env::current_exe() {
        let stale_old = exe.with_extension("exe.old");
        if stale_old.exists() {
            let _ = std::fs::remove_file(&stale_old);
        }
    }

    result
}

fn is_over_interactive_silhouette(rx: f64, ry: f64, is_108: bool, peek_edge: &str) -> (bool, bool) {
    if peek_edge == "left" {
        let dx = (rx - 0.16) / 0.28;
        let dy = (ry - 0.50) / 0.34;
        let over_head = (dx * dx + dy * dy) <= 1.0;
        return (over_head, over_head);
    }
    if peek_edge == "right" {
        let dx = (rx - 0.84) / 0.28;
        let dy = (ry - 0.50) / 0.34;
        let over_head = (dx * dx + dy * dy) <= 1.0;
        return (over_head, over_head);
    }

    // Cat body/head oval centered around (0.48, 0.49) for 65% or (0.51, 0.48) for 108-key
    let (cat_cx, cat_rx) = if is_108 { (0.51, 0.21) } else { (0.48, 0.25) };
    let dx_cat = (rx - cat_cx) / cat_rx;
    let dy_cat = (ry - 0.49) / 0.27;
    let over_cat = (dx_cat * dx_cat + dy_cat * dy_cat) <= 1.0;

    // Tail curve extending to the right of the cat's hip so users can poke the tail without click-through
    let over_tail = if is_108 {
        rx >= 0.64 && rx <= 0.85 && ry >= 0.48 && ry <= 0.72
    } else {
        rx >= 0.64 && rx <= 0.90 && ry >= 0.48 && ry <= 0.72
    };

    // Keyboard & mouse lower area
    let over_desk = if is_108 {
        rx >= 0.04 && rx <= 0.94 && ry >= 0.65 && ry <= 0.94
    } else {
        rx >= 0.06 && rx <= 0.92 && ry >= 0.65 && ry <= 0.91
    };

    (over_cat || over_tail || over_desk, over_cat)
}

fn tail_picker_captures_cursor(
    bounds: Option<TailPickerBounds>,
    rx: f64,
    ry: f64,
    allow_keyboard: bool,
) -> bool {
    let Some(bounds) = bounds else {
        return false;
    };
    let contains = |[left, top, right, bottom]: [f64; 4]| {
        (left..=right).contains(&rx) && (top..=bottom).contains(&ry)
    };
    if contains(bounds.toolbar) || (allow_keyboard && contains(bounds.keyboard)) {
        return true;
    }

    let [left, top, right, bottom] = bounds.close_button;
    let radius_x = (right - left) * 0.5;
    let radius_y = (bottom - top) * 0.5;
    // The close button is circular in screen pixels, with separate radii in normalized space.
    radius_x > 0.0
        && radius_y > 0.0
        && ((rx - left - radius_x) / radius_x).powi(2)
            + ((ry - top - radius_y) / radius_y).powi(2)
            <= 1.0
}

#[cfg(test)]
mod tail_picker_hit_tests {
    use super::{tail_picker_captures_cursor, TailPickerBounds};

    #[test]
    fn captures_picker_controls_and_keyboard_only_while_open() {
        let bounds = Some(TailPickerBounds {
            toolbar: [0.05, 0.02, 0.95, 0.16],
            keyboard: [0.13, 0.65, 0.95, 0.91],
            close_button: [0.96, 0.08, 0.995, 0.16],
        });
        assert!(tail_picker_captures_cursor(bounds, 0.87, 0.05, false));
        assert!(tail_picker_captures_cursor(bounds, 0.5, 0.8, true));
        assert!(tail_picker_captures_cursor(bounds, 0.9775, 0.12, true));
        assert!(tail_picker_captures_cursor(bounds, 0.9775, 0.12, false));
        assert!(tail_picker_captures_cursor(bounds, 0.9775, 0.152, false));
        assert!(!tail_picker_captures_cursor(bounds, 0.961, 0.081, true));
        assert!(!tail_picker_captures_cursor(bounds, 0.955, 0.12, true));
        assert!(!tail_picker_captures_cursor(bounds, 0.5, 0.8, false));
        assert!(!tail_picker_captures_cursor(bounds, 0.99, 0.05, true));
        assert!(!tail_picker_captures_cursor(bounds, 0.10, 0.89, true));
        assert!(!tail_picker_captures_cursor(bounds, 0.5, 0.45, true));
        assert!(!tail_picker_captures_cursor(None, 0.87, 0.05, false));
        assert!(!tail_picker_captures_cursor(None, 0.5, 0.8, true));
        assert!(!tail_picker_captures_cursor(None, 0.9775, 0.12, false));
    }
}

/// Ensures the top update/unlock toast pill (up to ~54px tall including top margin)
/// remains clickable even when the pet window is scaled down to 20%-36%.
pub(crate) fn banner_hit_ry_limit(win_log_h: f64) -> f64 {
    (54.0 / win_log_h.max(1.0)).clamp(0.19, 0.55)
}

/// Shared Remote Desktop app detector for macOS (#40 parity with Windows RDP yield).
#[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
pub(crate) fn macos_is_remote_desktop_app(bundle_id: &str, localized_name: &str) -> bool {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = localized_name.trim().to_ascii_lowercase();
    const RDP_BUNDLES: &[&str] = &[
        "com.microsoft.rdc.macos",
        "com.microsoft.rdc.osx",
        "com.microsoft.rdc.mac",
        "com.apple.screensharing",
        "com.carriez.rustdesk",
        "com.youqu.todesk.mac",
        "tv.parsec.www",
        "com.teamviewer.teamviewer",
        "com.philandro.anydesk",
        "com.realvnc.vncviewer",
        "com.moonlight-stream.moonlight",
        "com.sunlogin.client",
        "com.oray.sunlogin",
        "com.vmware.horizon",
        "com.citrix.receiver",
        "com.citrix.icaclient",
        "com.parallels.desktop.console",
    ];
    if RDP_BUNDLES.iter().any(|p| bid == *p || bid.starts_with(p)) {
        return true;
    }
    matches!(
        name.as_str(),
        "windows app"
            | "microsoft remote desktop"
            | "screen sharing"
            | "屏幕共享"
            | "rustdesk"
            | "todesk"
            | "parsec"
            | "anydesk"
            | "teamviewer"
            | "vnc viewer"
            | "moonlight"
    )
}

/// Shared Remote Desktop `WM_CLASS` detector for Linux X11 (#40 parity with Windows RDP yield).
#[cfg_attr(all(not(target_os = "linux"), not(test)), allow(dead_code))]
pub(crate) fn linux_is_remote_desktop_wm_class(wm_class: &str) -> bool {
    let lower = wm_class.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    const RDP_CLASSES: &[&str] = &[
        "remmina",
        "org.remmina.remmina",
        "xfreerdp",
        "wlfreerdp",
        "freerdp",
        "rdesktop",
        "rustdesk",
        "todesk",
        "parsec",
        "teamviewer",
        "anydesk",
        "vncviewer",
        "tigervnc",
        "realvnc",
        "sunloginclient",
        "moonlight",
        "virt-viewer",
        "remote-viewer",
        "spicy",
        "wfica",
        "vmware-view",
    ];
    lower
        .split_whitespace()
        .any(|tok| RDP_CLASSES.iter().any(|&c| tok == c || tok.contains(c)))
}

fn start_hit_test_loop(
    app: AppHandle,
    settings: Arc<Mutex<AppSettings>>,
    menu_open: Arc<AtomicBool>,
    dragging: Arc<AtomicBool>,
    update_banner_open: Arc<AtomicBool>,
    paused_guard: Arc<AtomicBool>,
) {
    let tail_picker_bounds = app.state::<AppState>().tail_picker_bounds.clone();
    let peek_edge_state = app.state::<AppState>().peek_edge.clone();
    std::thread::spawn(move || {
        let mut last_ignore: Option<bool> = None;
        let mut last_cursor: (i32, i32) = (i32::MIN, i32::MIN);
        let mut last_over_cat = false;
        let mut last_inside_pet = false;
        let mut last_alt_override = false;
        let mut last_effective_locked = false;
        let mut last_cursor_emit = Instant::now() - Duration::from_secs(1);
        let mut sleep_ms: u64 = 25;
        #[cfg(windows)]
        let mut drift_ticks: u8 = 0;
        #[cfg(windows)]
        let mut last_drift_check = Instant::now() - Duration::from_secs(1);
        #[cfg(windows)]
        let mut last_fg_hwnd: isize = 0;
        #[cfg(windows)]
        let mut last_topmost_check = Instant::now() - Duration::from_secs(1);
        #[cfg(windows)]
        let mut last_enum_check = Instant::now() - Duration::from_secs(2);
        #[cfg(windows)]
        let mut fg_just_changed = false;
        #[cfg(windows)]
        let mut fg_above_attempts: u8 = 0;
        #[cfg(windows)]
        let mut last_topmost_reassert = Instant::now() - Duration::from_secs(5);
        #[cfg(windows)]
        let mut yielded_notopmost = false;
        #[cfg(windows)]
        let mut win_lbtn_was_down = false;
        #[cfg(windows)]
        let mut win_press_start: Option<(i32, i32, Instant)> = None;
        #[cfg(target_os = "macos")]
        let mut mac_lbtn_was_down = false;
        #[cfg(target_os = "macos")]
        let mut mac_press_start: Option<(f64, f64)> = None;
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let mut unix_last_rdp_check = Instant::now() - Duration::from_secs(5);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let mut unix_yielded_rdp = false;

        loop {
            std::thread::sleep(Duration::from_millis(sleep_ms));

            if paused_guard.load(Ordering::Relaxed) {
                #[cfg(windows)]
                {
                    win_press_start = None;
                    win_lbtn_was_down = true;
                }
                #[cfg(target_os = "macos")]
                {
                    mac_press_start = None;
                    mac_lbtn_was_down = true;
                }
                sleep_ms = 120;
                continue;
            }
            let Some(win) = app.get_webview_window("main") else {
                #[cfg(windows)]
                {
                    win_press_start = None;
                    win_lbtn_was_down = true;
                }
                #[cfg(target_os = "macos")]
                {
                    mac_press_start = None;
                    mac_lbtn_was_down = true;
                }
                sleep_ms = 120;
                continue;
            };
            #[cfg(windows)]
            let is_win7_ulw = win_needs_win7_ulw();
            #[cfg(not(windows))]
            let is_win7_ulw = false;

            if is_win7_ulw {
                #[cfg(windows)]
                if !win7_layered::is_visible() {
                    win_press_start = None;
                    win_lbtn_was_down = true;
                    sleep_ms = 120;
                    continue;
                }
            } else if !win.is_visible().unwrap_or(false) {
                #[cfg(windows)]
                {
                    win_press_start = None;
                    win_lbtn_was_down = true;
                }
                #[cfg(target_os = "macos")]
                {
                    mac_press_start = None;
                    mac_lbtn_was_down = true;
                }
                sleep_ms = 120;
                continue;
            }
            let sf = win.scale_factor().unwrap_or(1.0);
            let Some((cx, cy)) = get_cursor_pos(sf) else {
                continue;
            };

            let (win_x, win_y, w, h) = if is_win7_ulw {
                #[cfg(windows)]
                {
                    let Some((ux, uy, uw, uh)) = win7_layered::get_rect() else {
                        continue;
                    };
                    (ux, uy, uw.max(1) as f64, uh.max(1) as f64)
                }
                #[cfg(not(windows))]
                unreachable!()
            } else {
                let Ok(pos) = win.outer_position() else {
                    continue;
                };
                let Ok(size) = win.outer_size() else {
                    continue;
                };
                (pos.x, pos.y, size.width.max(1) as f64, size.height.max(1) as f64)
            };
            let rx = (cx - win_x) as f64 / w;
            let ry = (cy - win_y) as f64 / h;
            let inside = rx >= 0.0 && rx <= 1.0 && ry >= 0.0 && ry <= 1.0;
            let (locked, always_on_top, is_108, cur_scale) = {
                let s = settings.lock().unwrap();
                (
                    s.click_through_locked,
                    s.always_on_top,
                    s.keyboard_layout == "108",
                    s.scale.clamp(0.20, 1.50),
                )
            };
            let layout_str = if is_108 { "108" } else { "65" };
            #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
            let _ = always_on_top;

            let is_menu = menu_open.load(Ordering::Relaxed);
            let picker_bounds = *tail_picker_bounds.lock().unwrap();
            #[cfg(windows)]
            let is_drag =
                dragging.load(Ordering::Acquire) || WIN_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire);
            #[cfg(target_os = "macos")]
            let is_drag =
                dragging.load(Ordering::Acquire) || MACOS_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire);
            #[cfg(all(not(windows), not(target_os = "macos")))]
            let is_drag = dragging.load(Ordering::Relaxed);
            let is_banner = update_banner_open.load(Ordering::Relaxed);

            // Continuous ADR-0096-style Windows Z-order guard with #40 yield support:
            // - Yields below fullscreen Remote Desktop (`mstsc.exe`, etc.), visible Windows 10/11
            //   system flyouts (Calendar, Notification Center, Quick Settings), and overlapping
            //   topmost notification toasts (e.g. Telegram) without hiding the pet.
            // - Restores `HWND_TOPMOST` promptly once the Remote Desktop / flyout / toast closes.
            // - Keeps borderless/FSO games underneath when no yield blocker is active.
            #[cfg(windows)]
            if always_on_top && !is_menu && picker_bounds.is_none() && !is_drag {
                let fg_raw = win_foreground_hwnd();
                let fg_id = fg_raw as isize;
                if fg_id != last_fg_hwnd {
                    last_fg_hwnd = fg_id;
                    fg_above_attempts = 0;
                    fg_just_changed = true;
                }
                let need_check =
                    fg_just_changed || last_topmost_check.elapsed() >= Duration::from_millis(200);
                if need_check {
                    let run_enum = fg_just_changed
                        || fg_above_attempts > 0
                        || yielded_notopmost
                        || last_enum_check.elapsed() >= Duration::from_millis(450);
                    fg_just_changed = false;
                    last_topmost_check = Instant::now();
                    let our_hwnd_opt = if is_win7_ulw {
                        win7_layered::hwnd()
                    } else {
                        win.hwnd()
                            .ok()
                            .map(|h| h.0 as windows_sys::Win32::Foundation::HWND)
                    };
                    if let Some(our_hwnd) = our_hwnd_opt {
                        if !win_is_iconic(our_hwnd) {
                            let yield_action = if run_enum {
                                win_detect_yield_action(our_hwnd, fg_raw)
                            } else {
                                WinYieldAction::None
                            };

                            match yield_action {
                                WinYieldAction::DemoteBehind(target_raw) => {
                                    fg_above_attempts = 0;
                                    let needs_demote = !yielded_notopmost
                                        || win_is_topmost(our_hwnd)
                                        || win_window_is_above(
                                            our_hwnd,
                                            target_raw as windows_sys::Win32::Foundation::HWND,
                                        );
                                    if needs_demote {
                                        yielded_notopmost = true;
                                        if is_win7_ulw {
                                            win7_layered::set_always_on_top(false);
                                            win_place_below_hwnd(
                                                our_hwnd,
                                                target_raw as windows_sys::Win32::Foundation::HWND,
                                                true,
                                            );
                                        } else {
                                            let app_for_yield = app.clone();
                                            let _ = app.run_on_main_thread(move || {
                                                if let Some(w) =
                                                    app_for_yield.get_webview_window("main")
                                                {
                                                    if let Ok(h) = w.hwnd() {
                                                        win_place_below_hwnd(
                                                            h.0 as windows_sys::Win32::Foundation::HWND,
                                                            target_raw
                                                                as windows_sys::Win32::Foundation::HWND,
                                                            true,
                                                        );
                                                    }
                                                }
                                            });
                                        }
                                    }
                                    last_enum_check = Instant::now();
                                }
                                WinYieldAction::PlaceBelowTopmost(target_raw) => {
                                    fg_above_attempts = 0;
                                    if is_win7_ulw {
                                        win_place_below_hwnd(
                                            our_hwnd,
                                            target_raw as windows_sys::Win32::Foundation::HWND,
                                            false,
                                        );
                                    } else {
                                        let app_for_yield = app.clone();
                                        let _ = app.run_on_main_thread(move || {
                                            if let Some(w) =
                                                app_for_yield.get_webview_window("main")
                                            {
                                                if let Ok(h) = w.hwnd() {
                                                    win_place_below_hwnd(
                                                        h.0 as windows_sys::Win32::Foundation::HWND,
                                                        target_raw
                                                            as windows_sys::Win32::Foundation::HWND,
                                                        false,
                                                    );
                                                }
                                            }
                                        });
                                    }
                                    last_enum_check = Instant::now();
                                }
                                WinYieldAction::HoldBelow => {
                                    fg_above_attempts = 0;
                                    last_enum_check = Instant::now();
                                }
                                WinYieldAction::None => {
                                    if yielded_notopmost && run_enum {
                                        yielded_notopmost = false;
                                        if is_win7_ulw {
                                            win7_layered::set_always_on_top(true);
                                        } else {
                                            let app_for_top = app.clone();
                                            let _ = app.run_on_main_thread(move || {
                                                if let Some(w) =
                                                    app_for_top.get_webview_window("main")
                                                {
                                                    if w.is_visible().unwrap_or(false) {
                                                        win_gentle_reassert_topmost(&w);
                                                    }
                                                }
                                            });
                                        }
                                        last_topmost_reassert = Instant::now();
                                        last_enum_check = Instant::now();
                                    } else if !yielded_notopmost {
                                        let lost_topmost = !win_is_topmost(our_hwnd);
                                        let fg_above = if !lost_topmost
                                            && run_enum
                                            && !fg_raw.is_null()
                                            && fg_raw != our_hwnd
                                        {
                                            last_enum_check = Instant::now();
                                            win_window_is_above(fg_raw, our_hwnd)
                                        } else {
                                            false
                                        };

                                        if !lost_topmost && !fg_above {
                                            if run_enum {
                                                fg_above_attempts = 0;
                                            }
                                        } else if lost_topmost {
                                            if last_topmost_reassert.elapsed()
                                                >= Duration::from_millis(250)
                                            {
                                                if is_win7_ulw {
                                                    win7_layered::reassert_topmost();
                                                } else {
                                                    let app_for_top = app.clone();
                                                    let _ = app.run_on_main_thread(move || {
                                                        if let Some(w) =
                                                            app_for_top.get_webview_window("main")
                                                        {
                                                            if w.is_visible().unwrap_or(false) {
                                                                win_gentle_reassert_topmost(&w);
                                                            }
                                                        }
                                                    });
                                                }
                                                last_topmost_reassert = Instant::now();
                                            }
                                        } else if fg_above_attempts < 3 {
                                            let cooldown = match fg_above_attempts {
                                                0 => Duration::from_millis(0),
                                                1 => Duration::from_millis(350),
                                                _ => Duration::from_millis(900),
                                            };
                                            if last_topmost_reassert.elapsed() >= cooldown {
                                                if is_win7_ulw {
                                                    win7_layered::reassert_topmost();
                                                } else {
                                                    let app_for_top = app.clone();
                                                    let _ = app.run_on_main_thread(move || {
                                                        if let Some(w) =
                                                            app_for_top.get_webview_window("main")
                                                        {
                                                            if w.is_visible().unwrap_or(false) {
                                                                win_gentle_reassert_topmost(&w);
                                                            }
                                                        }
                                                    });
                                                }
                                                last_topmost_reassert = Instant::now();
                                                fg_above_attempts =
                                                    fg_above_attempts.saturating_add(1);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                fg_just_changed = false;
                fg_above_attempts = 0;
                if !always_on_top {
                    yielded_notopmost = false;
                }
            }
            // Cross-platform #40 Remote Desktop yield for macOS: temporarily drop from
            // `NSStatusWindowLevel` to `NSNormalWindowLevel` while a Remote Desktop client is
            // frontmost so KuroCat never obscures the remote session, then restore promptly.
            #[cfg(target_os = "macos")]
            if always_on_top && !is_menu && picker_bounds.is_none() && !is_drag {
                if unix_last_rdp_check.elapsed() >= Duration::from_millis(450) {
                    unix_last_rdp_check = Instant::now();
                    let rdp_active = macos_window::frontmost_is_remote_desktop();
                    if rdp_active != unix_yielded_rdp {
                        unix_yielded_rdp = rdp_active;
                        macos_window::set_yielded_below_remote_desktop(&win, rdp_active);
                    }
                }
            } else if !always_on_top {
                unix_yielded_rdp = false;
            }
            // Cross-platform #40 Remote Desktop yield for Linux X11: yield beneath fullscreen
            // Remote Desktop sessions (`remmina`, `xfreerdp`, `rustdesk`, `todesk`, etc.).
            #[cfg(target_os = "linux")]
            if always_on_top && !is_menu && picker_bounds.is_none() && !is_drag {
                if unix_last_rdp_check.elapsed() >= Duration::from_millis(450) {
                    unix_last_rdp_check = Instant::now();
                    let rdp_fullscreen = input_hook::linux_hook::query_active_window_fullscreen_wm_class()
                        .is_some_and(|(cls, fs)| fs && linux_is_remote_desktop_wm_class(&cls));
                    if rdp_fullscreen != unix_yielded_rdp {
                        unix_yielded_rdp = rdp_fullscreen;
                        let app_for_top = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            if let Some(w) = app_for_top.get_webview_window("main") {
                                let _ = w.set_always_on_top(!rdp_fullscreen);
                            }
                        });
                    }
                }
            } else if !always_on_top {
                unix_yielded_rdp = false;
            }
            let alt_override = input_hook::is_alt_pressed();
            let effective_locked = locked && !alt_override;

            // Map window-relative (rx, ry) into exact pet-local (pet_rx, pet_ry),
            // since at small scales (20%..90%) the pet is anchored bottom-right inside a min-safe menu window!
            let (bw, bh) = base_dimensions(layout_str);
            let win_log_w = (w / sf).max(1.0);
            let win_log_h = (h / sf).max(1.0);
            let pet_w_frac = ((bw * cur_scale) / win_log_w).clamp(0.05, 1.0);
            let pet_h_frac = ((bh * cur_scale) / win_log_h).clamp(0.05, 1.0);
            let pet_x0 = 1.0 - pet_w_frac;
            let pet_y0 = 1.0 - pet_h_frac;
            let pet_rx = (rx - pet_x0) / pet_w_frac;
            let pet_ry = (ry - pet_y0) / pet_h_frac;
            let inside_pet = pet_rx >= 0.0 && pet_rx <= 1.0 && pet_ry >= 0.0 && pet_ry <= 1.0;

            let cur_peek = peek_edge_state
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| "none".to_string());
            let (over_interactive, raw_over_cat) = if cur_peek == "left" || cur_peek == "right" {
                if inside {
                    is_over_interactive_silhouette(rx, ry, is_108, &cur_peek)
                } else {
                    (false, false)
                }
            } else if inside_pet {
                is_over_interactive_silhouette(pet_rx, pet_ry, is_108, &cur_peek)
            } else {
                (false, false)
            };
            // While click-through is locked (and Alt is not held), suppress petting hover so users
            // aren't misled by squinting eyes when the cat is intentionally click-through.
            let over_cat = if effective_locked { false } else { raw_over_cat };

            #[cfg(windows)]
            if is_win7_ulw {
                win7_layered::set_over_cat(over_cat);
            }

            let over_banner = is_banner && inside && ry <= banner_hit_ry_limit(win_log_h);
            // The picker lives inside the pet window, unlike the separate side menu.
            let over_tail_picker =
                inside && tail_picker_captures_cursor(picker_bounds, rx, ry, !is_win7_ulw);

            // Windows unfocused / swallowed-mousedown drag fallback (#87, #26):
            // 1. Keep `WS_EX_TRANSPARENT` cleared while the user is holding the primary button
            //    after pressing over the interactive pet silhouette (eliminates fast-drag edge
            //    cutoff before JS reaches the 4px threshold).
            // 2. If WebView2 drops/delays `mousedown` (e.g. unfocused `focus:false` borderless
            //    window on Win11 25H2/26H2), launch the native 120Hz Windows drag loop directly
            //    once the pointer moves >= 6px while still confirming via `WindowFromPoint` that
            //    the initial press landed on our own pet window (never hijacking overlapping apps).
            #[cfg(windows)]
            let win_drag_armed = {
                let lbtn = input_hook::win_async_primary_button_down()
                    || input_hook::win_hook_left_button_down();
                if is_drag
                    || is_win7_ulw
                    || effective_locked
                    || is_menu
                    || is_banner
                    || picker_bounds.is_some()
                {
                    win_press_start = None;
                } else if !win_lbtn_was_down && lbtn {
                    let hit_pet = if over_interactive {
                        win.hwnd()
                            .ok()
                            .map(|h| {
                                win_point_belongs_to_pet(
                                    cx,
                                    cy,
                                    h.0 as windows_sys::Win32::Foundation::HWND,
                                )
                            })
                            .unwrap_or(false)
                    } else {
                        false
                    };
                    win_press_start = if hit_pet {
                        Some((cx, cy, Instant::now()))
                    } else {
                        None
                    };
                } else if lbtn {
                    if let Some((px, py, pressed_at)) = win_press_start {
                        if !dragging.load(Ordering::Acquire)
                            && !WIN_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire)
                        {
                            let dist = ((cx - px) as f64).hypot((cy - py) as f64);
                            if (dist >= 6.0 && pressed_at.elapsed() >= Duration::from_millis(45))
                                || dist >= 10.0
                            {
                                win_press_start = None;
                                let app_for_drag = app.clone();
                                std::thread::spawn(move || {
                                    let _ = run_windows_native_drag(app_for_drag, Some((px, py)));
                                });
                            }
                        } else {
                            win_press_start = None;
                        }
                    }
                } else {
                    win_press_start = None;
                }
                win_lbtn_was_down = lbtn;
                win_press_start.is_some()
            };
            #[cfg(not(windows))]
            let win_drag_armed = false;

            let should_ignore = if is_drag || win_drag_armed || over_banner || over_tail_picker {
                false
            } else if effective_locked {
                true
            } else if is_win7_ulw {
                false
            } else {
                !over_interactive
            };

            if last_ignore != Some(should_ignore) {
                #[cfg(windows)]
                if is_win7_ulw {
                    win7_layered::set_click_through(should_ignore);
                } else {
                    let _ = win.set_ignore_cursor_events(should_ignore);
                }
                #[cfg(not(windows))]
                {
                    let _ = win.set_ignore_cursor_events(should_ignore);
                }
                last_ignore = Some(should_ignore);
                #[cfg(windows)]
                {
                    drift_ticks = 0;
                }
            } else {
                // Self-heal Windows WS_EX_TRANSPARENT if DWM / Wallpaper Engine / Show-Desktop drifted it
                #[cfg(windows)]
                if inside || last_drift_check.elapsed() >= Duration::from_millis(250) {
                    last_drift_check = Instant::now();
                    let actual_opt = if is_win7_ulw {
                        win7_layered::is_click_through()
                    } else {
                        win_is_click_through(&win)
                    };
                    if let Some(actual_transparent) = actual_opt {
                        if actual_transparent != should_ignore {
                            drift_ticks = drift_ticks.saturating_add(1);
                            if drift_ticks >= 3 {
                                if is_win7_ulw {
                                    win7_layered::set_click_through(should_ignore);
                                } else {
                                    win_force_click_through(&win, should_ignore);
                                    let _ = win.set_ignore_cursor_events(should_ignore);
                                }
                                drift_ticks = 0;
                            }
                        } else {
                            drift_ticks = 0;
                        }
                    }
                }
            }

            // macOS unfocused first-click drag fallback (#59):
            // Under ActivationPolicy::Accessory + focus:false, WKWebView may swallow or delay the
            // first left-mouse press when another app is active (`acceptsFirstMouse`). Detect a
            // left-button drag gesture >= 4pt over the interactive pet silhouette directly via
            // CoreGraphics and launch the native drag loop without waiting on WebKit.
            #[cfg(target_os = "macos")]
            {
                let lbtn = input_hook::macos_hook::is_left_mouse_down();
                if is_drag || effective_locked || is_menu || is_banner || picker_bounds.is_some() {
                    mac_press_start = None;
                } else if !mac_lbtn_was_down && lbtn {
                    mac_press_start = if over_interactive {
                        input_hook::macos_hook::cursor_pos_points()
                    } else {
                        None
                    };
                } else if lbtn {
                    if let Some((px, py)) = mac_press_start {
                        if !dragging.load(Ordering::Acquire)
                            && !MACOS_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire)
                        {
                            if let Some((cur_x, cur_y)) = input_hook::macos_hook::cursor_pos_points()
                            {
                                if (cur_x - px).hypot(cur_y - py) >= 4.0 {
                                    mac_press_start = None;
                                    let app_for_drag = app.clone();
                                    std::thread::spawn(move || {
                                        let _ = run_macos_native_drag(app_for_drag, Some((px, py)));
                                    });
                                }
                            }
                        } else {
                            mac_press_start = None;
                        }
                    }
                } else {
                    mac_press_start = None;
                }
                mac_lbtn_was_down = lbtn;
            }

            let state_changed = over_cat != last_over_cat
                || inside_pet != last_inside_pet
                || alt_override != last_alt_override
                || effective_locked != last_effective_locked;
            let cursor_moved = last_cursor.0 == i32::MIN
                || (cx - last_cursor.0).abs() > 1
                || (cy - last_cursor.1).abs() > 1;
            let game_now = game_detect::is_game_active();
            let min_emit_gap = if inside_pet {
                Duration::from_millis(30)
            } else if game_now {
                Duration::from_millis(65)
            } else {
                Duration::from_millis(45)
            };

            if state_changed || (cursor_moved && last_cursor_emit.elapsed() >= min_emit_gap) {
                last_cursor = (cx, cy);
                last_over_cat = over_cat;
                last_inside_pet = inside_pet;
                last_alt_override = alt_override;
                last_effective_locked = effective_locked;
                last_cursor_emit = Instant::now();
                let _ = app.emit(
                    "kuro-cursor",
                    WindowCursorInfo {
                        rel_x: pet_rx,
                        rel_y: pet_ry,
                        inside_window: inside_pet,
                        over_cat,
                        alt_override,
                    },
                );
            }

            // Adaptive polling interval: fast 25ms near/over pet window, low-overhead 50-65ms elsewhere!
            let near_window = rx >= -0.15 && rx <= 1.15 && ry >= -0.15 && ry <= 1.15;
            #[cfg(target_os = "macos")]
            let mac_drag_armed = mac_press_start.is_some();
            #[cfg(not(target_os = "macos"))]
            let mac_drag_armed = false;
            sleep_ms = if mac_drag_armed || win_drag_armed {
                12
            } else if near_window
                || is_drag
                || is_menu
                || picker_bounds.is_some()
                || alt_override
            {
                25
            } else if game_now {
                65
            } else {
                50
            };
        }
    });
}

#[cfg(windows)]
fn win_needs_win7_ulw() -> bool {
    use std::sync::OnceLock;
    static NEEDS_ULW: OnceLock<bool> = OnceLock::new();
    *NEEDS_ULW.get_or_init(|| {
        for var in ["KUROCAT_WIN7_ULW", "KUROCAT_WIN7_MASK"] {
            if let Ok(v) = std::env::var(var) {
                let t = v.trim();
                if t == "1" || t.eq_ignore_ascii_case("true") {
                    return true;
                }
                if t == "0" || t.eq_ignore_ascii_case("false") {
                    return false;
                }
            }
        }
        // Query real OS version via ntdll!RtlGetVersion (immune to compatibility manifest lies).
        // Windows 7 = 6.1, Windows 8 = 6.2, Windows 8.1 = 6.3, Windows 10/11 = 10.0+.
        #[repr(C)]
        struct RtlOsVersionInfoW {
            dw_os_version_info_size: u32,
            dw_major_version: u32,
            dw_minor_version: u32,
            dw_build_number: u32,
            dw_platform_id: u32,
            sz_csd_version: [u16; 128],
        }
        #[link(name = "ntdll")]
        extern "system" {
            fn RtlGetVersion(lpVersionInformation: *mut RtlOsVersionInfoW) -> i32;
        }
        unsafe {
            let mut info: RtlOsVersionInfoW = std::mem::zeroed();
            info.dw_os_version_info_size = std::mem::size_of::<RtlOsVersionInfoW>() as u32;
            if RtlGetVersion(&mut info) == 0 {
                return info.dw_major_version < 10;
            }
        }
        false
    })
}

/// Build a rounded GDI HRGN from `[left, top, right, bottom, corner_radius_px]` tuples
/// for on-demand DOM overlays (`#context-menu` and `#update-toast`) on Windows 7/8.
#[cfg(windows)]
fn build_rounded_overlay_hrgn(rects: &[i32]) -> windows_sys::Win32::Graphics::Gdi::HRGN {
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRoundRectRgn, DeleteObject, HRGN, RGN_OR,
    };

    let mut final_rgn: HRGN = std::ptr::null_mut();
    for chunk in rects.chunks_exact(5) {
        let (l, t, r, b, radius) = (chunk[0], chunk[1], chunk[2], chunk[3], chunk[4]);
        if r <= l || b <= t {
            continue;
        }
        let w = r - l;
        let h = b - t;
        let diam = (radius.max(0) * 2).min(w).min(h);
        unsafe {
            let ov = CreateRoundRectRgn(l, t, r + 1, b + 1, diam, diam);
            if ov.is_null() {
                continue;
            }
            if final_rgn.is_null() {
                final_rgn = ov;
            } else {
                CombineRgn(final_rgn, final_rgn, ov, RGN_OR);
                DeleteObject(ov as _);
            }
        }
    }
    final_rgn
}

#[tauri::command]
fn is_win7_ulw_mode() -> bool {
    #[cfg(windows)]
    {
        return win_needs_win7_ulw();
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
fn win7_present_frame(request: tauri::ipc::Request<'_>) {
    #[cfg(windows)]
    {
        if !win_needs_win7_ulw() {
            return;
        }
        let w = request
            .headers()
            .get("x-w")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let h = request
            .headers()
            .get("x-h")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        if w == 0 || h == 0 || w > 4096 || h > 4096 {
            return;
        }
        if let tauri::ipc::InvokeBody::Raw(bytes) = request.body() {
            win7_layered::submit_rgba_frame(w, h, bytes);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = request;
    }
}

#[tauri::command]
fn win7_sync_overlay(window: tauri::WebviewWindow, rects: Vec<i32>, focus_menu: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{DeleteObject, SetWindowRgn};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE,
            SWP_NOZORDER,
        };
        if !win_needs_win7_ulw() {
            return;
        }
        let Ok(raw_hwnd) = window.hwnd() else {
            return;
        };
        let main_hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;

        let rgn = build_rounded_overlay_hrgn(&rects);
        if rgn.is_null() {
            win7_layered::set_overlay_active(false);
            unsafe {
                let _ = SetWindowRgn(main_hwnd, std::ptr::null_mut(), 0);
                let _ = SetWindowPos(
                    main_hwnd,
                    std::ptr::null_mut(),
                    WIN7_OFFSCREEN_PARK_POS,
                    WIN7_OFFSCREEN_PARK_POS,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            return;
        }

        // Ensure WebView2 overlay HWND is opaque & clickable on Win7 (no WS_EX_LAYERED/TRANSPARENT)
        win_force_click_through(&window, false);
        let Some((ux, uy, _, _)) = win7_layered::get_rect() else {
            unsafe {
                DeleteObject(rgn as _);
            }
            return;
        };
        win7_layered::set_overlay_active(true);
        unsafe {
            if SetWindowRgn(main_hwnd, rgn, 1) == 0 {
                DeleteObject(rgn as _);
            }
            let flags = if focus_menu {
                SWP_NOSIZE
            } else {
                SWP_NOSIZE | SWP_NOACTIVATE
            };
            let _ = SetWindowPos(main_hwnd, HWND_TOPMOST, ux, uy, 0, 0, flags);
            if focus_menu {
                let _ = SetForegroundWindow(main_hwnd);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, rects, focus_menu);
    }
}

#[cfg(windows)]
fn win_elevated_webview2_user_data_folder(
    local_app_data: Option<&std::path::Path>,
    exe_dir: &std::path::Path,
) -> std::path::PathBuf {
    local_app_data
        .map(|base| base.join("com.kurocat.pet").join("EBWebView-Admin"))
        .unwrap_or_else(|| exe_dir.join("WebView2Data-Admin"))
}

#[cfg(windows)]
fn win_configure_local_webview2_runtime() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let mut found_local_rt = false;
    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_none() {
        for candidate in ["WebView2Runtime", "WebView2"] {
            let rt = dir.join(candidate);
            if rt.join("msedgewebview2.exe").is_file() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &rt);
                found_local_rt = true;
                break;
            }
        }
    }
    // Isolate Fixed-Version WebView2 (v109 for Win7) user data folder so it never collides
    // with a newer system WebView2 (Chromium 13x/14x) profile when tested or co-installed.
    if (found_local_rt || cfg!(feature = "win7"))
        && std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none()
    {
        let udf = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .map(|base| base.join("KuroCat").join("EBWebView-Win7"))
            .unwrap_or_else(|| dir.join("WebView2Data"));
        let _ = std::fs::create_dir_all(&udf);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &udf);
    } else if win_is_elevated() && std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        // Isolate elevated (High-integrity) WebView2 from the standard (Medium-integrity)
        // `EBWebView` profile so "Restart as Administrator" can never hit WebView2's cross-
        // integrity `E_ACCESSDENIED` / `ERROR_INVALID_STATE` lock conflict while the previous
        // non-elevated `msedgewebview2.exe` is still flushing disk (#98).
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
        let udf = win_elevated_webview2_user_data_folder(local_app_data.as_deref(), dir);
        let _ = std::fs::create_dir_all(&udf);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &udf);
    }
    if win_needs_win7_ulw() {
        // Dark surface matching `#context-menu` / `#update-toast` so rounded overlays blend cleanly.
        if std::env::var_os("WEBVIEW2_DEFAULT_BACKGROUND_COLOR").is_none() {
            std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF18191E");
        }
        // Keep offscreen-parked WebView2 rendering smoothly at 30-60 FPS without Chromium occlusion throttling!
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let mut merged = existing.trim().to_string();
        for flag in [
            "--autoplay-policy=no-user-gesture-required",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ] {
            if !merged.contains(flag) {
                if !merged.is_empty() {
                    merged.push(' ');
                }
                merged.push_str(flag);
            }
        }
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
    }
}

/// Keeps the kill-on-close job object handle alive for the whole process lifetime.
/// The handle must never be closed: closing it is what triggers the kill, so it is the
/// job's only owner and dies with us (the kernel closes it on exit, which is the point).
#[cfg(windows)]
static WINDOWS_JOB_HANDLE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(windows)]
pub(crate) fn win_has_kill_on_close_job() -> bool {
    WINDOWS_JOB_HANDLE.load(Ordering::Relaxed) != 0
}

#[cfg(windows)]
const WIN_JOB_LIMIT_FLAGS: u32 = {
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK
};

/// WebView2 spawns its `msedgewebview2.exe` browser/GPU/renderer helpers as ordinary
/// child processes. When KuroCat dies hard (crash or Task Manager "End task"), nothing
/// gets to run our exit code and the whole helper tree can survive as orphans.
///
/// Assigning ourselves to a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object before Tauri
/// starts moves cleanup into the kernel (matching Electron/Chromium). We also set
/// `JOB_OBJECT_LIMIT_BREAKAWAY_OK` so self-update installers and restarted binaries spawned
/// by `updater.rs` with `CREATE_BREAKAWAY_FROM_JOB` survive `app.exit(0)`.
#[cfg(windows)]
fn win_kill_webview2_children_on_exit() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = WIN_JOB_LIMIT_FLAGS;
        let configured = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if configured == 0 || AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            // Best effort only: Windows 7 cannot nest job objects, so being launched from
            // a process that already owns a job (some terminals / installers) makes the
            // assignment fail. Leave the old behaviour untouched in that case.
            let _ = CloseHandle(job);
            return;
        }
        // Deliberately never closed: the handle must outlive everything else, because
        // closing it is precisely what fires the kill.
        WINDOWS_JOB_HANDLE.store(job as usize, Ordering::Relaxed);
    }
}

/// Process-lifetime single-instance guard (Fixes #74 duplicate tray icons/processes).
/// Note: `--mcp` stdio mode exits in `main.rs` before `run()`, so AI MCP clients are never blocked.
#[cfg(windows)]
static WINDOWS_SINGLE_INSTANCE_MUTEX: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(windows)]
const WIN_SINGLE_INSTANCE_MUTEX_NAME: &str = "Local\\KuroCat.SingleInstance.Mutex";
#[cfg(windows)]
const WIN_SINGLE_INSTANCE_WAKE_EVENT: &str = "Local\\KuroCat.ShowExisting.Event";

#[cfg(windows)]
fn win_try_acquire_named_mutex(name: &str) -> Result<usize, bool> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS,
    };
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let handle = CreateMutexW(std::ptr::null(), 0, wide.as_ptr());
        let err = GetLastError();
        if handle.is_null() {
            if err == ERROR_ACCESS_DENIED {
                // Another (e.g. elevated admin) instance owns the mutex in this session.
                return Err(true);
            }
            // Unexpected OS error: fail open so we never prevent startup.
            return Err(false);
        }
        if err == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(handle);
            return Err(true);
        }
        Ok(handle as usize)
    }
}

#[cfg(windows)]
fn win_signal_existing_instance() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenEventW, SetEvent};

    const EVENT_MODIFY_STATE: u32 = 0x0002;
    let wide: Vec<u16> = WIN_SINGLE_INSTANCE_WAKE_EVENT
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let ev = OpenEventW(EVENT_MODIFY_STATE, 0, wide.as_ptr());
        if !ev.is_null() {
            let _ = SetEvent(ev);
            let _ = CloseHandle(ev);
        }
    }
}

#[cfg(windows)]
fn win_start_single_instance_wake_listener(app: AppHandle) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::WaitForSingleObject;

    const INFINITE: u32 = 0xFFFF_FFFF;
    const WAIT_OBJECT_0: u32 = 0;

    std::thread::spawn(move || {
        let ev = win_create_session_event(WIN_SINGLE_INSTANCE_WAKE_EVENT, false);
        if ev.is_null() {
            return;
        }
        loop {
            let wait_res = unsafe { WaitForSingleObject(ev, INFINITE) };
            if wait_res != WAIT_OBJECT_0 {
                break;
            }
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                set_pet_visible(&handle, true);
            });
        }
        unsafe {
            let _ = CloseHandle(ev);
        }
    });
}

#[cfg(unix)]
fn unix_wait_for_previous_pid_if_requested() -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    const ESRCH: i32 = 3;

    let mut wait_pid: Option<u32> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--wait-pid" {
            if let Some(pid_str) = args.next() {
                wait_pid = pid_str.parse::<u32>().ok();
            }
        }
    }

    let waited = wait_pid.is_some();
    if let Some(pid) = wait_pid {
        if pid != 0 && pid != std::process::id() && pid <= i32::MAX as u32 {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(15) {
                let rc = unsafe { kill(pid as i32, 0) };
                if rc != 0 && std::io::Error::last_os_error().raw_os_error() == Some(ESRCH) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    waited
}

#[cfg(unix)]
fn unix_single_instance_slot() -> &'static Mutex<Option<std::fs::File>> {
    use std::sync::OnceLock;
    static SLOT: OnceLock<Mutex<Option<std::fs::File>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn acquire_single_instance_lock(wait_briefly: bool) -> bool {
    #[cfg(windows)]
    {
        let attempts = if wait_briefly { 80 } else { 1 };
        for i in 0..attempts {
            match win_try_acquire_named_mutex(WIN_SINGLE_INSTANCE_MUTEX_NAME) {
                Ok(handle) => {
                    WINDOWS_SINGLE_INSTANCE_MUTEX.store(handle, Ordering::Relaxed);
                    return true;
                }
                Err(true) => {
                    if i + 1 < attempts {
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }
                    win_signal_existing_instance();
                    return false;
                }
                Err(false) => return true,
            }
        }
        win_signal_existing_instance();
        false
    }
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::os::unix::io::AsRawFd;

        extern "C" {
            fn flock(fd: i32, operation: i32) -> i32;
        }
        const LOCK_EX: i32 = 2;
        const LOCK_NB: i32 = 4;

        let dir = config::app_data_dir();
        let _ = std::fs::create_dir_all(&dir);
        let lock_path = dir.join("kurocat.lock");
        let (attempts, delay_ms) = if wait_briefly { (80, 100) } else { (6, 60) };
        for i in 0..attempts {
            let Ok(file) = OpenOptions::new()
                .create(true)
                .read(true)
                .write(true)
                .open(&lock_path)
            else {
                return true;
            };
            let rc = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
            if rc == 0 {
                if let Ok(mut guard) = unix_single_instance_slot().lock() {
                    *guard = Some(file);
                }
                return true;
            }
            if i + 1 < attempts {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
        }
        false
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = wait_briefly;
        true
    }
}

pub(crate) fn release_single_instance_lock() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        let raw = WINDOWS_SINGLE_INSTANCE_MUTEX.swap(0, Ordering::AcqRel);
        if raw != 0 {
            unsafe {
                let _ = CloseHandle(raw as HANDLE);
            }
        }
    }
    #[cfg(unix)]
    {
        if let Ok(mut guard) = unix_single_instance_slot().lock() {
            *guard = None;
        }
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LinuxWebkitEnvPlan {
    force_shm: bool,
    disable_dmabuf: bool,
    disable_nv_explicit_sync: bool,
    prefer_x11: bool,
}

/// Decides Linux WebKitGTK & GDK environment defaults before GTK/WebKit initializes.
///
/// Historically setting `WEBKIT_DISABLE_DMABUF_RENDERER=1` unconditionally prevented crashes
/// on NVIDIA/VMs/KylinOS, but on WebKitGTK 2.44+ (including Ubuntu 22.04 LTS security updates
/// 2.46–2.54) it forces transparent overlay windows onto the legacy non-DMABUF backing store,
/// causing persistent animation ghosting/trails (Issue #56, tauri#14924) and blanking/crashes
/// on 2.54+. Instead:
/// - Explicit user/packager env overrides always win.
/// - Healthy Mesa hardware GPUs (Intel/AMD/etc.) keep native DMA-BUF compositing (clean RGBA swap).
/// - NVIDIA / VMs / KylinOS / software GL use `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` on WebKitGTK
///   >= 2.44 (preserving the modern full-frame swap chain while bypassing hardware DMA-BUF/GBM
///   imports), falling back to `WEBKIT_DISABLE_DMABUF_RENDERER=1` only on WebKitGTK < 2.44.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[allow(clippy::too_many_arguments)]
fn select_linux_webkit_env(
    webkit_ver: Option<(u32, u32, u32)>,
    has_explicit_webkit_override: bool,
    has_nv_explicit_sync_override: bool,
    nvidia_driver: bool,
    kylin_or_software_gl: bool,
    has_wayland_display: bool,
    has_x11_display: bool,
    has_gdk_backend_override: bool,
    has_kurocat_wayland_override: bool,
) -> LinuxWebkitEnvPlan {
    let needs_shm_fallback = nvidia_driver || kylin_or_software_gl;
    let supports_force_shm = webkit_ver.map_or(true, |(maj, min, _)| (maj, min) >= (2, 44));

    let (force_shm, disable_dmabuf) = if has_explicit_webkit_override || !needs_shm_fallback {
        (false, false)
    } else if supports_force_shm {
        (true, false)
    } else {
        (false, true)
    };

    let disable_nv_explicit_sync = nvidia_driver && !has_nv_explicit_sync_override;
    let prefer_x11 = has_wayland_display
        && has_x11_display
        && !has_gdk_backend_override
        && !has_kurocat_wayland_override;

    LinuxWebkitEnvPlan {
        force_shm,
        disable_dmabuf,
        disable_nv_explicit_sync,
        prefer_x11,
    }
}

#[cfg(target_os = "linux")]
fn probe_linux_webkitgtk_version() -> Option<(u32, u32, u32)> {
    use std::ffi::{c_char, c_int, c_void};

    const RTLD_LAZY: c_int = 0x00001;
    const RTLD_NOLOAD: c_int = 0x00004;
    extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    type VersionFn = unsafe extern "C" fn() -> u32;

    unsafe {
        // Check already-linked symbols first (RTLD_DEFAULT = NULL on glibc), and only
        // fall back to libwebkit2gtk-4.1.so.0 (NEVER dlopen libwebkit2gtk-4.0.so.37,
        // which pulls in libsoup2 alongside wry's libsoup3 and aborts with SIGTRAP!).
        let try_handle = |h: *mut c_void| -> Option<(u32, u32, u32)> {
            let maj_sym = dlsym(h, b"webkit_get_major_version\0".as_ptr() as *const c_char);
            let min_sym = dlsym(h, b"webkit_get_minor_version\0".as_ptr() as *const c_char);
            let mic_sym = dlsym(h, b"webkit_get_micro_version\0".as_ptr() as *const c_char);
            if !maj_sym.is_null() && !min_sym.is_null() && !mic_sym.is_null() {
                let maj: VersionFn = std::mem::transmute(maj_sym);
                let min: VersionFn = std::mem::transmute(min_sym);
                let mic: VersionFn = std::mem::transmute(mic_sym);
                let v = (maj(), min(), mic());
                if v.0 > 0 {
                    return Some(v);
                }
            }
            None
        };

        if let Some(v) = try_handle(std::ptr::null_mut()) {
            return Some(v);
        }
        let h_noload = dlopen(
            b"libwebkit2gtk-4.1.so.0\0".as_ptr() as *const c_char,
            RTLD_LAZY | RTLD_NOLOAD,
        );
        if !h_noload.is_null() {
            if let Some(v) = try_handle(h_noload) {
                return Some(v);
            }
        }
        let h_41 = dlopen(
            b"libwebkit2gtk-4.1.so.0\0".as_ptr() as *const c_char,
            RTLD_LAZY,
        );
        if !h_41.is_null() {
            if let Some(v) = try_handle(h_41) {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn probe_linux_nvidia_driver() -> bool {
    use std::path::Path;
    if Path::new("/proc/driver/nvidia/version").exists()
        || Path::new("/sys/module/nvidia").exists()
        || Path::new("/sys/module/nvidia_drm").exists()
    {
        return true;
    }
    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("card") || name.contains('-') {
            return false;
        }
        let device = entry.path().join("device");
        let vendor = std::fs::read_to_string(device.join("vendor")).unwrap_or_default();
        let driver = std::fs::read_link(device.join("driver")).ok();
        vendor.trim().eq_ignore_ascii_case("0x10de")
            && driver
                .as_deref()
                .and_then(Path::file_name)
                .is_some_and(|d| d == "nvidia")
    })
}

#[cfg(target_os = "linux")]
fn probe_linux_kylin_or_software_gl() -> bool {
    use std::path::Path;
    if Path::new("/etc/kylin-release").exists() {
        return true;
    }
    if std::env::var("LIBGL_ALWAYS_SOFTWARE")
        .map(|v| !v.is_empty() && v != "0")
        .unwrap_or(false)
    {
        return true;
    }
    const HW_MESA_DRIVERS: &[&str] = &[
        "amdgpu", "asahi", "etnaviv", "i915", "lima", "msm", "nouveau", "panfrost", "panthor",
        "radeon", "v3d", "xe",
    ];
    let has_hw_mesa = std::fs::read_dir("/sys/class/drm")
        .ok()
        .map(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !name.starts_with("card") || name.contains('-') {
                    return false;
                }
                std::fs::read_link(entry.path().join("device/driver"))
                    .ok()
                    .and_then(|p| p.file_name().map(|s| s.to_string_lossy().into_owned()))
                    .is_some_and(|drv| HW_MESA_DRIVERS.iter().any(|&hw| hw == drv))
            })
        })
        .unwrap_or(false);

    if has_hw_mesa {
        return false;
    }

    // No hardware Mesa GPU detected: check common VM DMI markers (VMware/VirtualBox/QEMU/KVM/etc.)
    for dmi_path in [
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/sys_vendor",
    ] {
        if let Ok(text) = std::fs::read_to_string(dmi_path) {
            let lower = text.to_ascii_lowercase();
            if ["vmware", "virtualbox", "qemu", "kvm", "parallels", "bochs", "hyper-v"]
                .iter()
                .any(|vm| lower.contains(vm))
            {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn linux_configure_display_env() {
    let webkit_ver = probe_linux_webkitgtk_version();
    let has_explicit_webkit_override = [
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
        "WEBKIT_FORCE_DMABUF_RENDERER",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
    ]
    .iter()
    .any(|k| std::env::var_os(k).is_some());

    let has_nv_explicit_sync_override = std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_some();
    let nvidia_driver = probe_linux_nvidia_driver();
    let kylin_or_software_gl = probe_linux_kylin_or_software_gl();
    let has_wayland_display = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_x11_display = std::env::var("DISPLAY")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let has_gdk_backend_override = std::env::var_os("GDK_BACKEND").is_some();
    let has_kurocat_wayland_override = std::env::var_os("KUROCAT_WAYLAND").is_some();

    let plan = select_linux_webkit_env(
        webkit_ver,
        has_explicit_webkit_override,
        has_nv_explicit_sync_override,
        nvidia_driver,
        kylin_or_software_gl,
        has_wayland_display,
        has_x11_display,
        has_gdk_backend_override,
        has_kurocat_wayland_override,
    );

    if plan.force_shm {
        std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
    }
    if plan.disable_dmabuf {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if plan.disable_nv_explicit_sync {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
    if plan.prefer_x11 {
        // Prefer X11/XWayland when DISPLAY is available so bottom-right window placement,
        // XShape click-through, and zero-root XRecord global input work reliably across desktop environments.
        std::env::set_var("GDK_BACKEND", "x11");
    }

    eprintln!(
        "[kurocat] linux display: webkit={:?} nvidia={} kylin_or_vm={} force_shm={} disable_dmabuf={} nv_no_sync={} prefer_x11={}",
        webkit_ver,
        nvidia_driver,
        kylin_or_software_gl,
        plan.force_shm,
        plan.disable_dmabuf,
        plan.disable_nv_explicit_sync,
        plan.prefer_x11
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Emergency CLI escape hatch: launching with `--unlock` clears click-through lock immediately,
    // even if an existing instance is already running (its storage watcher reloads within 400ms).
    let unlock_requested = std::env::args().any(|a| a == "--unlock");
    if unlock_requested {
        let mut s = load_settings();
        if s.click_through_locked {
            s.click_through_locked = false;
            save_settings(&s);
        }
    }

    #[cfg(windows)]
    let handoff = win_wait_for_previous_pid_if_requested();
    #[cfg(windows)]
    let wait_briefly = handoff.waited_for_prev;
    #[cfg(unix)]
    let wait_briefly = unix_wait_for_previous_pid_if_requested();
    #[cfg(not(any(windows, unix)))]
    let wait_briefly = false;

    if !acquire_single_instance_lock(wait_briefly) {
        #[cfg(windows)]
        if handoff.waited_for_prev || handoff.had_handoff_event {
            let lang = i18n::effective_locale(&load_settings().language);
            let detail = if handoff.prev_exited_cleanly {
                Some("single-instance mutex still occupied after exit")
            } else {
                Some("previous PID did not exit within 15s")
            };
            let (title, body) = win_admin_restart_alert_text(lang, "lock_busy", detail);
            win_show_message_box(&title, &body, false);
        }
        #[cfg(unix)]
        if wait_briefly {
            eprintln!("[kurocat] single-instance lock still occupied after --wait-pid handoff");
        }
        return;
    }

    #[cfg(windows)]
    {
        win_kill_webview2_children_on_exit();
        win_configure_local_webview2_runtime();
    }
    #[cfg(target_os = "linux")]
    {
        linux_configure_display_env();
    }

    let initial_settings = load_settings();
    let settings_arc = Arc::new(Mutex::new(initial_settings.clone()));
    let menu_open = Arc::new(AtomicBool::new(false));
    let menu_creating = Arc::new(AtomicBool::new(false));
    let menu_opened_at = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    let dragging = Arc::new(AtomicBool::new(false));
    let mcp_enabled = Arc::new(AtomicBool::new(initial_settings.mcp_enabled));
    let update_banner_open = Arc::new(AtomicBool::new(false));
    let paused_guard = Arc::new(AtomicBool::new(false));

    let settings_for_setup = settings_arc.clone();
    let menu_for_setup = menu_open.clone();
    let drag_for_setup = dragging.clone();
    let mcp_for_setup = mcp_enabled.clone();
    let banner_for_setup = update_banner_open.clone();
    let paused_for_setup = paused_guard.clone();

    let run_result = tauri::Builder::default()
        .manage(AppState {
            settings: settings_arc,
            menu_open,
            tail_picker_bounds: Arc::new(Mutex::new(None)),
            menu_creating,
            live_creating: Arc::new(AtomicBool::new(false)),
            menu_close_gen: Arc::new(AtomicU64::new(0)),
            menu_opened_at,
            dragging,
            mcp_enabled,
            update_banner_open,
            paused_guard,
            peek_edge: Arc::new(Mutex::new("none".to_string())),
            peek_preview_edge: Arc::new(Mutex::new("none".to_string())),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let _ = APP_HANDLE_FOR_SHUTDOWN.set(handle.clone());
            let s = settings_for_setup.lock().unwrap().clone();

            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            if let Some(win) = app.get_webview_window("main") {
                let (win_w, win_h) = window_dimensions(&s.keyboard_layout, s.scale);
                let _ = win.set_size(Size::Logical(LogicalSize::new(win_w, win_h)));
                #[cfg(not(target_os = "macos"))]
                let (target_x, target_y, sz) = {
                    let sz = win.outer_size().unwrap_or(tauri::PhysicalSize::new(420, 440));
                    let sf = win.scale_factor().unwrap_or(1.0);
                    let (x, y) = if let (Some(x), Some(y)) = (s.x, s.y) {
                        (x, y)
                    } else {
                        default_bottom_right_position(sz.width as i32, sz.height as i32, sf)
                    };
                    (x, y, sz)
                };
                #[cfg(all(not(windows), not(target_os = "macos")))]
                let _ = sz;

                #[cfg(windows)]
                let (target_x, target_y, sz, anchored) = {
                    match windows_display::initial_placement(&win, &s) {
                        Some(target) => (target.position.x, target.position.y, target.size, true),
                        None => (target_x, target_y, sz, false),
                    }
                };

                #[cfg(windows)]
                if win_needs_win7_ulw() {
                    // On Windows 7/8: spawn our dedicated Win32 UpdateLayeredWindow (ULW_ALPHA)
                    // 256-level anti-aliased presenter window at (target_x, target_y), and park the
                    // WebView2 offscreen renderer at (-16000, -16000) so there is ZERO white box!
                    win_force_click_through(&win, false);
                    let _ = win.set_always_on_top(s.always_on_top);
                    let _ = win.set_position(PhysicalPosition::new(
                        WIN7_OFFSCREEN_PARK_POS,
                        WIN7_OFFSCREEN_PARK_POS,
                    ));
                    if anchored {
                        let _ = win.set_size(sz);
                    }
                    win7_layered::init(
                        handle.clone(),
                        target_x,
                        target_y,
                        sz.width,
                        sz.height,
                        s.always_on_top,
                    );
                    win7_layered::set_opacity(s.opacity);
                    win7_layered::set_click_through(s.click_through_locked);
                } else {
                    let _ = win.set_always_on_top(s.always_on_top);
                    let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
                    if anchored {
                        let _ = win.set_size(sz);
                    }
                }

                #[cfg(all(not(windows), not(target_os = "macos")))]
                {
                    let _ = win.set_always_on_top(s.always_on_top);
                    #[cfg(target_os = "linux")]
                    {
                        let _ = win.set_visible_on_all_workspaces(true);
                        let _ = win.set_skip_taskbar(true);
                    }
                    let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
                }

                #[cfg(target_os = "macos")]
                {
                    macos_window::configure_fullscreen(&win, s.always_on_top);
                    match (s.display_id.as_deref(), s.x, s.y) {
                        (None, Some(x), Some(y)) => {
                            let _ = win.set_position(PhysicalPosition::new(x, y));
                        }
                        (preferred, _, _) => {
                            macos_window::place(&win, preferred);
                        }
                    }
                }
            }

            tray::setup_tray(&handle, &s)?;
            input_hook::start_global_hooks(handle.clone());
            privacy::start_password_privacy_watcher(
                handle.clone(),
                settings_for_setup.clone(),
                paused_for_setup.clone(),
            );
            game_detect::start_game_detection_watcher(
                handle.clone(),
                settings_for_setup.clone(),
                paused_for_setup.clone(),
            );
            companion::start(&handle, settings_for_setup.clone(), paused_for_setup.clone());
            start_hit_test_loop(
                handle.clone(),
                settings_for_setup,
                menu_for_setup,
                drag_for_setup,
                banner_for_setup,
                paused_for_setup,
            );
            start_storage_watcher(handle.clone());
            #[cfg(windows)]
            win_start_single_instance_wake_listener(handle.clone());
            updater::start_background_update_checker(handle.clone());

            let http_handle = handle.clone();
            let agent_handle = handle.clone();
            let mcp_port = if s.mcp_port == 0 { 27420 } else { s.mcp_port };
            mcp::start_http_mcp_server(
                mcp_port,
                mcp_for_setup,
                move || {
                    reload_and_emit_all(&http_handle);
                },
                move |ev| {
                    let _ = agent_handle.emit("kuro-agent-event", &ev);
                    if let Ok(raw) = serde_json::to_string(&ev) {
                        obs::broadcast_raw("agentEvent", &raw);
                    }
                },
            );

            // Forward settings / cats / privacy broadcasts to OBS SSE clients (1ns no-op when OBS is off)
            handle.listen("kuro-settings", |ev| {
                obs::broadcast_raw("settings", ev.payload());
            });
            handle.listen("kuro-cats", |ev| {
                obs::broadcast_raw("cats", ev.payload());
            });
            handle.listen("kuro-privacy", |ev| {
                let active = ev.payload().trim() == "true";
                obs::set_privacy_active(active);
            });
            handle.listen("kuro-game-active", |ev| {
                let raw = ev.payload();
                let active = serde_json::from_str::<serde_json::Value>(raw)
                    .ok()
                    .and_then(|v| v.get("active").and_then(|a| a.as_bool()))
                    .unwrap_or(false);
                obs::set_game_active(active, raw);
            });
            obs::sync_obs_server(&handle, s.obs_enabled, s.obs_port);
            if s.live_capture_enabled {
                sync_live_capture_window(&handle, true, &s.keyboard_layout);
            }
            if should_hide_desktop_pet(&s) {
                set_pet_visible(&handle, false);
            }

            if std::env::args().any(|a| a == "--demo") {
                let demo_handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    let keys: &[u32] = &[0x46, 0x53, 0x41, 0x45, 0x20, 0xA0, 0x4B];
                    for &vk in keys {
                        let _ = demo_handle.emit(
                            "kuro-input",
                            serde_json::json!({ "kind": "keyDown", "vk": vk, "scan": 0, "repeat": false }),
                        );
                        std::thread::sleep(Duration::from_millis(100));
                        let _ = demo_handle.emit(
                            "kuro-input",
                            serde_json::json!({ "kind": "keyUp", "vk": vk, "scan": 0 }),
                        );
                    }
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "mouseMove", "x": 400, "y": 400, "nx": 0.25, "ny": 0.4 }),
                    );
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "mouseDown", "button": "left" }),
                    );
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "keyDown", "vk": 0x4B, "scan": 0, "repeat": false }),
                    );
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            companion::get_companion_snapshot,
            companion::save_companion_settings,
            get_settings,
            get_resolved_locale,
            trim_idle_memory,
            get_cats,
            get_game_active,
            get_admin_status,
            diagnose_macos_input,
            restart_as_admin,
            get_mcp_config,
            get_agent_hooks_config,
            get_obs_url,
            get_app_version,
            update_settings,
            open_context_menu,
            close_context_menu,
            close_live_capture_window,
            open_tail_picker_from_menu,
            preview_scale,
            preview_opacity,
            set_menu_open,
            set_tail_picker_bounds,
            save_tail_picker_selection,
            set_dragging,
            set_peek_edge,
            sync_peek_edge_after_drag,
            start_pet_drag,
            wait_linux_drag_end,
            set_update_banner_open,
            is_win7_ulw_mode,
            win7_present_frame,
            win7_sync_overlay,
            save_window_pos,
            reset_position,
            create_desktop_shortcut,
            get_cached_update_info,
            check_for_update,
            install_update,
            open_release_page,
            quit_app,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = run_result {
        #[cfg(windows)]
        {
            let lang = i18n::effective_locale(&load_settings().language);
            let detail = err.to_string();
            let (title, body) = win_admin_restart_alert_text(lang, "startup_error", Some(&detail));
            win_show_message_box(&title, &body, true);
        }
        #[cfg(not(windows))]
        panic!("error while running KuroCat: {}", err);
    }
}

#[cfg(all(test, windows))]
mod windows_zorder_tests {
    use super::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    static ZORDER_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn detects_and_recovers_topmost_zorder_without_stealing_focus() {
        let _guard = ZORDER_TEST_LOCK.lock().unwrap();
        let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "KuroCatZOrderTest\0".encode_utf16().collect();
        unsafe {
            let hinst = GetModuleHandleW(std::ptr::null());
            let ex = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            let model = CreateWindowExW(
                ex,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                100,
                100,
                200,
                200,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            let fg = CreateWindowExW(
                ex,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                120,
                120,
                200,
                200,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            assert!(!model.is_null() && !fg.is_null());
            assert!(win_is_topmost(model));
            assert!(win_is_topmost(fg));

            // Place simulated foreground topmost window above model
            SetWindowPos(
                fg,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            assert!(
                win_window_is_above(fg, model),
                "expected fg topmost window to be detected above model"
            );

            // Reassert model to HWND_TOPMOST (same call as win_gentle_reassert_topmost)
            SetWindowPos(
                model,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            assert!(
                !win_window_is_above(fg, model),
                "expected model to sit above fg after HWND_TOPMOST reassert"
            );

            // Move fg away so rectangles no longer overlap (e.g. another monitor)
            SetWindowPos(fg, HWND_TOPMOST, 2000, 2000, 200, 200, SWP_NOACTIVATE);
            assert!(
                !win_window_is_above(fg, model),
                "non-overlapping fg window should never trigger topmost reorder"
            );

            // Verify SetWindowPos allows borderless pet window top headroom above y=0 (no Aero top-edge lock!)
            SetWindowPos(
                model,
                std::ptr::null_mut(),
                300,
                -70,
                0,
                0,
                SWP_NOSIZE
                    | windows_sys::Win32::UI::WindowsAndMessaging::SWP_NOZORDER
                    | SWP_NOACTIVATE,
            );
            let mut rc = windows_sys::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            assert_ne!(
                windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(model, &mut rc),
                0
            );
            assert_eq!(rc.top, -70, "SetWindowPos should place pet window cleanly at y=-70 without top-edge clamp");

            let _ = DestroyWindow(fg);
            let _ = DestroyWindow(model);
        }

        // Verify elevation query runs safely without panicking
        let _ = win_is_elevated();
    }

    #[test]
    fn yields_below_topmost_toast_and_classifies_rdp_and_shell_flyouts() {
        let _guard = ZORDER_TEST_LOCK.lock().unwrap();
        assert!(is_remote_desktop_window("TscShellContainerClass", "mstsc.exe"));
        assert!(is_remote_desktop_window("AnyClass", "MSTSC.EXE"));
        assert!(is_remote_desktop_window("AnyClass", "msrdc.exe"));
        assert!(is_remote_desktop_window("AnyClass", "RustDesk.exe"));
        assert!(!is_remote_desktop_window("Chrome_WidgetWin_1", "chrome.exe"));
        assert!(!is_remote_desktop_window("UnrealWindow", "Game.exe"));

        assert!(is_system_shell_flyout_class("Windows.UI.Core.CoreWindow"));
        assert!(is_system_shell_flyout_class("XamlExplorerHostIslandWindow"));
        assert!(is_system_shell_flyout_class("ControlCenterWindow"));
        assert!(is_system_shell_flyout_class("NotifyIconOverflowWindow"));
        assert!(!is_system_shell_flyout_class("Shell_TrayWnd"));
        assert!(!is_system_shell_flyout_class("Progman"));

        assert!(is_plausible_toast_popup_size(360, 120)); // Telegram / Windows toast at 100% DPI
        assert!(is_plausible_toast_popup_size(720, 240)); // Toast at 200% DPI
        assert!(!is_plausible_toast_popup_size(20, 20));  // tiny hidden helper window
        assert!(!is_plausible_toast_popup_size(1920, 1080)); // fullscreen game/app

        // Verify win_place_below_hwnd cleanly slips model beneath a topmost notification popup
        // while keeping model topmost (drop_topmost = false) AND demotes when drop_topmost = true.
        let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "KuroCatYieldTest\0".encode_utf16().collect();
        unsafe {
            let hinst = GetModuleHandleW(std::ptr::null());
            let ex = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            let toast = CreateWindowExW(
                ex,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                200,
                200,
                340,
                110,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            let model = CreateWindowExW(
                ex,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                220,
                210,
                260,
                260,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            assert!(!toast.is_null() && !model.is_null());

            // Put model above toast first, then yield directly below toast.
            SetWindowPos(
                model,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            assert!(win_window_is_above(model, toast));

            win_place_below_hwnd(model, toast, false);
            assert!(
                win_window_is_above(toast, model),
                "toast popup must sit above model after yielding"
            );
            assert!(
                win_is_topmost(model),
                "model must retain WS_EX_TOPMOST when yielding below a topmost toast"
            );

            // Simulate fullscreen Remote Desktop demotion (drop_topmost = true)
            win_place_below_hwnd(model, toast, true);
            assert!(
                !win_is_topmost(model),
                "model must drop WS_EX_TOPMOST when demoting behind fullscreen RDP"
            );

            let _ = DestroyWindow(model);
            let _ = DestroyWindow(toast);
        }
    }

    #[test]
    fn win7_rounded_overlay_region_clips_menu_and_toast_cleanly() {
        use windows_sys::Win32::Graphics::Gdi::{DeleteObject, PtInRegion};
        // Context menu card (radius 12) + update toast pill (radius 20)
        let rects = vec![
            10, 10, 224, 310, 12,
            60, 8, 340, 42, 20,
        ];
        unsafe {
            let rgn = build_rounded_overlay_hrgn(&rects);
            assert!(!rgn.is_null(), "CreateRoundRectRgn + CombineRgn should produce valid HRGN");
            assert_ne!(PtInRegion(rgn, 100, 150), 0, "inside context menu");
            assert_ne!(PtInRegion(rgn, 200, 24), 0, "inside update toast");
            assert_eq!(PtInRegion(rgn, 10, 10), 0, "sharp 12px corner tip should be rounded off");
        assert_eq!(PtInRegion(rgn, 350, 200), 0, "empty area outside overlays must be clipped away");
        DeleteObject(rgn as _);
    }
}
}

#[cfg(test)]
mod side_menu_layout_tests {
    use super::compute_side_menu_pos;

    #[test]
    fn places_menu_to_left_of_bottom_right_cat_with_zero_overlap() {
        // 1920x1040 monitor, cat at bottom-right (1580, 620, 315, 410)
        let pet = (1580, 620, 315, 410);
        let work = (0, 0, 1920, 1040);
        let menu = (266, 620);
        let (mx, my) = compute_side_menu_pos(pet, work, menu, 10, 10);
        assert_eq!(mx, 1580 - 266 - 10, "should open cleanly to the left of the cat");
        assert!(mx + menu.0 <= pet.0, "menu must NOT overlap the cat horizontally");
        assert_eq!(my, 620 + 410 - 620, "should align cleanly to cat bottom edge");
    }

    #[test]
    fn flips_menu_to_right_when_cat_sits_near_left_edge() {
        let pet = (16, 620, 315, 410);
        let work = (0, 0, 1920, 1040);
        let menu = (266, 620);
        let (mx, _my) = compute_side_menu_pos(pet, work, menu, 10, 10);
        assert_eq!(mx, 16 + 315 + 10, "should flip cleanly to the right of the cat");
        assert!(mx >= pet.0 + pet.2, "menu must NOT overlap the cat horizontally");
    }

    #[test]
    fn places_menu_above_cat_when_horizontal_space_is_tight() {
        let pet = (100, 560, 300, 300);
        let work = (0, 0, 520, 900);
        let menu = (266, 400);
        let (_mx, my) = compute_side_menu_pos(pet, work, menu, 10, 10);
        assert!(my + menu.1 <= pet.1, "should open cleanly above the cat");
    }

    #[test]
    fn places_scheme_a_298px_side_menu_with_zero_overlap() {
        assert!((super::SIDE_MENU_LOGICAL_W - 298.0).abs() < 1e-6);
        let pet = (1580, 620, 315, 410);
        let work = (0, 0, 1920, 1040);
        let menu = (298, 568);
        let (mx, my) = compute_side_menu_pos(pet, work, menu, 10, 10);
        assert_eq!(mx, 1580 - 298 - 10);
        assert!(mx + menu.0 <= pet.0);
        assert_eq!(my, 620 + 410 - 568);
    }

    #[test]
    fn drag_clamp_allows_cat_ears_to_reach_top_of_screen_without_losing_window() {
        // 1920x1080 virtual desktop, 420x440 window: transparent top headroom (~75px) may go above y=0
        let (x, y) = super::clamp_pet_drag_position(500, -140, 420, 440, 0, 0, 1920, 1080);
        assert_eq!(x, 500);
        assert_eq!(y, -75, "cat window should smoothly slide up by ~17% headroom so ears touch y=0");

        // Trying to drag way off-screen left/right/bottom allows intentional deep peek push (>=24%)
        // while keeping >=72% of the pet window safely reachable on-screen.
        let (lx, by) = super::clamp_pet_drag_position(-500, 2000, 420, 440, 0, 0, 1920, 1080);
        assert_eq!(lx, -118);
        let (rx, _) = super::clamp_pet_drag_position(4000, 300, 420, 440, 0, 0, 1920, 1080);
        assert_eq!(rx, 1920 - 420 + 118);
        assert!(by <= 1080 - 240 && by >= 700, "pet body stays safely visible at bottom edge");
    }

    #[test]
    fn peek_silhouette_hitbox_covers_head_and_gripping_hands_on_both_edges() {
        // Left peek: head & gripping hands near left edge are interactive; far right is click-through
        assert_eq!(super::is_over_interactive_silhouette(0.05, 0.50, false, "left"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.35, 0.50, false, "left"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.16, 0.25, false, "left"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.80, 0.50, false, "left"), (false, false));

        // Right peek: head & gripping hands near right edge are interactive; far left is click-through
        assert_eq!(super::is_over_interactive_silhouette(0.95, 0.50, false, "right"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.65, 0.50, false, "right"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.84, 0.75, false, "right"), (true, true));
        assert_eq!(super::is_over_interactive_silhouette(0.20, 0.50, false, "right"), (false, false));

        // Normal stance: tail hitbox is interactive so users can poke the tail without click-through
        assert_eq!(super::is_over_interactive_silhouette(0.80, 0.58, false, "none"), (true, false));
    }

    #[test]
    fn corner_safe_peek_detection_guards_all_four_corners_and_triggers_on_mid_edge() {
        // 1920x1040 work area, 420x440 pet window (deep_side = 101px, mild_side = 34px)
        let (wx, wy, ww, wh) = (0, 0, 1920, 1040);
        let (win_w, win_h) = (420, 440);

        // All four 120px corner safe zones NEVER trigger — even with deep push OR cursor pinned in corner!
        assert_eq!(super::detect_corner_safe_peek_edge(1860, 980, 1618, 600, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(1918, 1035, 1618, 600, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(1860, 60, 1618, 0, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(1918, 5, 1618, 0, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(60, 980, -118, 600, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(2, 1035, -118, 600, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(60, 60, -118, 0, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(2, 5, -118, 0, win_w, win_h, wx, wy, ww, wh), "none");

        // Mid-edge deep push (>= 24% = 101px) triggers left/right cleanly
        assert_eq!(super::detect_corner_safe_peek_edge(90, 500, -105, 300, win_w, win_h, wx, wy, ww, wh), "left");
        assert_eq!(super::detect_corner_safe_peek_edge(1820, 500, 1605, 300, win_w, win_h, wx, wy, ww, wh), "right");

        // Mid-edge cursor pinned (<= 8px) with mild push (>= 8% = 34px) triggers left/right cleanly
        assert_eq!(super::detect_corner_safe_peek_edge(6, 500, -40, 300, win_w, win_h, wx, wy, ww, wh), "left");
        assert_eq!(super::detect_corner_safe_peek_edge(1914, 500, 1540, 300, win_w, win_h, wx, wy, ww, wh), "right");

        // Mild push WITHOUT cursor pin does NOT trigger
        assert_eq!(super::detect_corner_safe_peek_edge(90, 500, -40, 300, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(1820, 500, 1540, 300, win_w, win_h, wx, wy, ww, wh), "none");

        // Top / bottom mid-edges NEVER trigger (left/right vertical edges only)
        assert_eq!(super::detect_corner_safe_peek_edge(960, 2, 750, -75, win_w, win_h, wx, wy, ww, wh), "none");
        assert_eq!(super::detect_corner_safe_peek_edge(960, 1038, 750, 700, win_w, win_h, wx, wy, ww, wh), "none");
    }

    #[test]
    fn macos_drag_delta_converts_quartz_y_down_to_appkit_y_up_with_clamping() {
        // Single M3 MacBook Retina logical display: 1512x982 pts, AppKit origin (0, 0)
        let union = super::macos_screens_union(&[(0.0, 0.0, 1512.0, 982.0)]).unwrap();
        assert_eq!(union, (0.0, 0.0, 1512.0, 982.0));

        let bounds = super::macos_drag_bounds(420.0, 440.0, union.0, union.1, union.2, union.3);
        // side_margin = round(420 * 0.28) = 118, top_headroom = 75, min_visible_h = 299
        assert_eq!(bounds, (-118.0, 1210.0, -141.0, 617.0));

        // Dragging right +100pt and UP -120pt in Quartz Y-down must move AppKit origin (+100, +120)
        let (nx, ny) =
            super::macos_drag_target_origin((500.0, 200.0), (600.0, 500.0), (700.0, 380.0), bounds);
        assert_eq!((nx, ny), (600.0, 320.0));

        // Dragging far UP lets ~17% transparent headspace slide past top bezel (982 - 440 + 75 = 617)
        let (tx, ty) =
            super::macos_drag_target_origin((500.0, 200.0), (600.0, 500.0), (600.0, -400.0), bounds);
        assert_eq!((tx, ty), (500.0, 617.0));

        // Dragging far DOWN keeps >=68% visible above bottom edge (0 + 299 - 440 = -141)
        let (bx, by) =
            super::macos_drag_target_origin((500.0, 200.0), (600.0, 500.0), (600.0, 1800.0), bounds);
        assert_eq!((bx, by), (500.0, -141.0));

        // Dragging far LEFT / RIGHT clamps to 28% side margins (enough for >=24% Edge-Peek push!)
        let (lx, _) =
            super::macos_drag_target_origin((500.0, 200.0), (600.0, 500.0), (-900.0, 500.0), bounds);
        let (rx, _) =
            super::macos_drag_target_origin((500.0, 200.0), (600.0, 500.0), (2900.0, 500.0), bounds);
        assert_eq!(lx, -118.0);
        assert_eq!(rx, 1210.0);
    }

    #[test]
    fn macos_drag_spans_multi_monitor_union_across_negative_external_display() {
        // External monitor to the left at (-2304, 120, 2304x1296) + primary at (0, 0, 1512x982)
        let union = super::macos_screens_union(&[
            (0.0, 0.0, 1512.0, 982.0),
            (-2304.0, 120.0, 2304.0, 1296.0),
        ])
        .unwrap();
        assert_eq!(union, (-2304.0, 0.0, 1512.0, 1416.0));
        assert_eq!(super::macos_screens_union(&[]), None);

        let bounds = super::macos_drag_bounds(420.0, 440.0, union.0, union.1, union.2, union.3);
        assert_eq!(bounds, (-2422.0, 1210.0, -141.0, 1051.0));

        // Moving left by 800pt and up by 500pt crosses cleanly into the negative-X external display
        let (nx, ny) = super::macos_drag_target_origin(
            (100.0, 200.0),
            (300.0, 600.0),
            (-500.0, 100.0),
            bounds,
        );
        assert_eq!((nx, ny), (-700.0, 700.0));
    }

    #[test]
    fn macos_retina_logical_edge_peek_bounds_and_snap_origin() {
        // Retina 2x primary 1512x982 logical pts (visibleFrame excludes 70pt Dock + 37pt Menu Bar)
        // plus negative-X external display (-2304, 120, 2304x1296, visibleFrame height 1271).
        let primary_h = 982.0;
        let screens = [
            ((0.0, 0.0, 1512.0, 982.0), (0.0, 70.0, 1512.0, 875.0)),
            ((-2304.0, 120.0, 2304.0, 1296.0), (-2304.0, 120.0, 2304.0, 1271.0)),
        ];

        // Quartz cursor at mid-height on primary right edge: cg=(1506, 482) -> AppKit=(1506, 500)
        let (ak_x, ak_y) = super::macos_quartz_to_appkit_point(1506.0, 482.0, primary_h);
        assert_eq!((ak_x, ak_y), (1506.0, 500.0));
        let vis = super::macos_active_visible_frame(&screens, ak_x, ak_y).unwrap();
        assert_eq!(vis, (0.0, 70.0, 1512.0, 875.0));

        // Deep right push (110pt >= 24% of 420pt) at AppKit origin (1202, 280) triggers "right"
        let edge = super::detect_corner_safe_peek_edge(
            ak_x.round() as i32,
            ak_y.round() as i32,
            1202,
            280,
            420,
            440,
            vis.0 as i32,
            vis.1 as i32,
            vis.2 as i32,
            vis.3 as i32,
        );
        assert_eq!(edge, "right");

        // Flush logical-point snap aligns right edge cleanly to 1512 - 420 = 1092 (ZERO 2x scaling bug!)
        let snap = super::macos_peek_snap_origin("right", 280.0, 420.0, 440.0, vis).unwrap();
        assert_eq!(snap, (1092.0, 280.0));
        // Out-of-range Y clamps into [70, 70 + 875 - 440 = 505] (never under Dock or menu bar)
        assert_eq!(super::macos_peek_snap_origin("right", 10.0, 420.0, 440.0, vis), Some((1092.0, 70.0)));
        assert_eq!(super::macos_peek_snap_origin("right", 700.0, 420.0, 440.0, vis), Some((1092.0, 505.0)));

        // Bottom-right corner above Dock (Quartz y = 892 -> AppKit y = 90, only 20pt above Dock vy=70) NEVER triggers
        let (corner_x, corner_y) = super::macos_quartz_to_appkit_point(1480.0, 892.0, primary_h);
        assert_eq!((corner_x, corner_y), (1480.0, 90.0));
        assert_eq!(
            super::detect_corner_safe_peek_edge(
                corner_x as i32,
                corner_y as i32,
                1202,
                70,
                420,
                440,
                vis.0 as i32,
                vis.1 as i32,
                vis.2 as i32,
                vis.3 as i32,
            ),
            "none"
        );

        // External negative-X display left edge: Quartz (-2300, 232) -> AppKit (-2300, 750)
        let (ext_x, ext_y) = super::macos_quartz_to_appkit_point(-2300.0, 232.0, primary_h);
        assert_eq!((ext_x, ext_y), (-2300.0, 750.0));
        let ext_vis = super::macos_active_visible_frame(&screens, ext_x, ext_y).unwrap();
        assert_eq!(ext_vis, (-2304.0, 120.0, 2304.0, 1271.0));
        assert_eq!(
            super::detect_corner_safe_peek_edge(
                ext_x as i32,
                ext_y as i32,
                -2348,
                520,
                420,
                440,
                ext_vis.0 as i32,
                ext_vis.1 as i32,
                ext_vis.2 as i32,
                ext_vis.3 as i32,
            ),
            "left"
        );
        assert_eq!(
            super::macos_peek_snap_origin("left", 520.0, 420.0, 440.0, ext_vis),
            Some((-2304.0, 520.0))
        );
    }

    #[test]
    fn linux_wm_clamped_edge_peek_triggers_mid_edge_and_never_in_corners() {
        // 1920x1040 work area (e.g. GNOME Mutter / KDE KWin / XFCE clamping window inside work area)
        let (wx, wy, ww, wh) = (0, 0, 1920, 1040);
        let (win_w, win_h) = (420, 440);

        // Clamped left edge (`win_x == 0`) with cursor pinned mid-height -> triggers "left"
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(4, 500, 0, 280, win_w, win_h, wx, wy, ww, wh),
            "left"
        );
        // Clamped right edge (`win_x + win_w == 1920`) with cursor pinned mid-height -> triggers "right"
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(1914, 500, 1500, 280, win_w, win_h, wx, wy, ww, wh),
            "right"
        );

        // All four 120px corners NEVER trigger even when clamped & cursor pinned!
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(2, 60, 0, 0, win_w, win_h, wx, wy, ww, wh),
            "none"
        );
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(2, 980, 0, 600, win_w, win_h, wx, wy, ww, wh),
            "none"
        );
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(1918, 60, 1500, 0, win_w, win_h, wx, wy, ww, wh),
            "none"
        );
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(1918, 980, 1500, 600, win_w, win_h, wx, wy, ww, wh),
            "none"
        );

        // Normal edge parking with cursor inside the cat (NOT pinned <= 12px) does NOT trigger
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(180, 500, 0, 280, win_w, win_h, wx, wy, ww, wh),
            "none"
        );
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(1740, 500, 1500, 280, win_w, win_h, wx, wy, ww, wh),
            "none"
        );

        // Unclamped Linux WM (deep off-edge push >= 24% mid-height) also triggers cleanly
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(95, 500, -110, 280, win_w, win_h, wx, wy, ww, wh),
            "left"
        );
        assert_eq!(
            super::detect_linux_edge_peek_after_drag(1825, 500, 1610, 280, win_w, win_h, wx, wy, ww, wh),
            "right"
        );
    }

    #[test]
    fn banner_hit_limit_covers_toast_at_mini_scales() {
        // 100% scale (~440px tall): preserves classic 19% top band (~83.6px)
        assert!((super::banner_hit_ry_limit(440.0) - 0.19).abs() < 1e-6);
        // 36% scale (~160px tall): 54/160 = 0.3375 so 54px toast stays 100% clickable
        let lim36 = super::banner_hit_ry_limit(160.0);
        assert!(lim36 * 160.0 >= 53.9 && lim36 <= 0.55);
        // 20% mini scale (~95px tall): clamped at 55% so toast never steals the whole cat
        let lim20 = super::banner_hit_ry_limit(95.0);
        assert!((lim20 - 0.55).abs() < 1e-6);
    }

    #[test]
    fn linux_webkit_env_avoids_stale_shm_ghosting_on_modern_webkit() {
        // Intel/AMD Mesa on Ubuntu 22.04/24.04 (WebKitGTK 2.50.4): native DMABUF stays enabled
        let mesa = super::select_linux_webkit_env(
            Some((2, 50, 4)),
            false,
            false,
            false,
            false,
            true,
            true,
            false,
            false,
        );
        assert!(!mesa.disable_dmabuf);
        assert!(!mesa.force_shm);
        assert!(!mesa.disable_nv_explicit_sync);
        assert!(mesa.prefer_x11);

        // NVIDIA on WebKitGTK 2.50.4: uses WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 instead of DISABLE_DMABUF
        let nv_modern = super::select_linux_webkit_env(
            Some((2, 50, 4)),
            false,
            false,
            true,
            false,
            true,
            true,
            false,
            false,
        );
        assert!(nv_modern.force_shm);
        assert!(!nv_modern.disable_dmabuf);
        assert!(nv_modern.disable_nv_explicit_sync);

        // Legacy KylinOS WebKitGTK 2.38 (< 2.44): keeps WEBKIT_DISABLE_DMABUF_RENDERER=1
        let kylin_legacy = super::select_linux_webkit_env(
            Some((2, 38, 6)),
            false,
            false,
            false,
            true,
            false,
            true,
            false,
            false,
        );
        assert!(!kylin_legacy.force_shm);
        assert!(kylin_legacy.disable_dmabuf);
        assert!(!kylin_legacy.prefer_x11);

        // Explicit user override always wins
        let overridden = super::select_linux_webkit_env(
            Some((2, 54, 1)),
            true,
            true,
            true,
            true,
            true,
            true,
            false,
            true,
        );
        assert!(!overridden.force_shm);
        assert!(!overridden.disable_dmabuf);
        assert!(!overridden.disable_nv_explicit_sync);
        assert!(!overridden.prefer_x11);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_webkit_version_probe_never_loads_webkit_4_0() {
        // Must safely query the linked webkit2gtk-4.1 (libsoup3) without pulling in libsoup2.
        let ver = super::probe_linux_webkitgtk_version();
        if let Some((major, minor, _)) = ver {
            assert_eq!(major, 2);
            assert!(minor >= 32);
        }
    }

    #[test]
    fn edge_peek_snap_and_resize_preserve_flush_bezel_alignment() {
        let (wx, wy, ww, wh) = (0, 0, 1920, 1040);
        // 65% & 108% layouts across 0.5x / 1.0x / 1.25x scales snap flush to wx (left) & wx+ww (right)
        for (layout, scale) in [
            ("65", 0.5),
            ("65", 1.0),
            ("65", 1.25),
            ("108", 0.5),
            ("108", 1.0),
            ("108", 1.25),
        ] {
            let (lw, lh) = super::window_dimensions(layout, scale);
            let (w, h) = (lw as i32, lh as i32);
            let left = super::compute_edge_peek_snap_pos("left", 300, w, h, wx, wy, ww, wh).unwrap();
            assert_eq!(left.0, wx, "left edge must be flush for {layout} @ {scale}");
            let right = super::compute_edge_peek_snap_pos("right", 300, w, h, wx, wy, ww, wh).unwrap();
            assert_eq!(right.0 + w, wx + ww, "right edge must be flush for {layout} @ {scale}");
        }

        // Resizing while in LEFT Edge-Peek stays flush at x=0 instead of pulling inward!
        let left_resized = super::compute_anchored_resize_pos("left", 0, 280, 420, 440, 540, 456);
        assert_eq!(left_resized.0, 0);
        assert_eq!(left_resized.1, 272);

        // Resizing while in RIGHT Edge-Peek stays flush at x+w == 1920!
        let right_resized = super::compute_anchored_resize_pos("right", 1500, 280, 420, 440, 540, 456);
        assert_eq!(right_resized.0 + 540, 1920);
        assert_eq!(right_resized.1, 272);

        // Normal (non-peek) resize keeps bottom-right anchor
        let normal_resized = super::compute_anchored_resize_pos("none", 1472, 532, 420, 440, 540, 456);
        assert_eq!(normal_resized, (1352, 516));
    }

    #[test]
    fn click_through_lock_persists_in_settings_json() {
        let mut s = crate::config::AppSettings::default();
        s.click_through_locked = true;
        let json = serde_json::to_string(&s).expect("serialize settings");
        let parsed: crate::config::AppSettings = serde_json::from_str(&json).expect("deserialize settings");
        assert!(parsed.click_through_locked, "clickThroughLocked must round-trip as true");
    }

    #[test]
    fn should_hide_desktop_pet_respects_both_obs_and_live_capture_flags() {
        let mut s = crate::config::AppSettings::default();
        assert!(!super::should_hide_desktop_pet(&s));

        s.obs_hide_pet = true;
        assert!(!super::should_hide_desktop_pet(&s), "obs_hide_pet alone without obs_enabled must not hide");
        s.obs_enabled = true;
        assert!(super::should_hide_desktop_pet(&s));

        s.obs_enabled = false;
        s.obs_hide_pet = false;
        s.live_hide_pet = true;
        assert!(!super::should_hide_desktop_pet(&s), "live_hide_pet alone without live_capture_enabled must not hide");
        s.live_capture_enabled = true;
        assert!(super::should_hide_desktop_pet(&s));

        s.obs_enabled = true;
        s.obs_hide_pet = true;
        assert!(super::should_hide_desktop_pet(&s));

        s.live_capture_enabled = false;
        assert!(super::should_hide_desktop_pet(&s), "still hidden while OBS hide is active");
        s.obs_hide_pet = false;
        assert!(!super::should_hide_desktop_pet(&s));
    }

    #[cfg(windows)]
    #[test]
    fn windows_job_object_configures_kill_on_close_and_breakaway() {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, QueryInformationJobObject,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            assert!(!job.is_null(), "CreateJobObjectW must succeed");
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = super::WIN_JOB_LIMIT_FLAGS;
            let set_ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            assert_ne!(set_ok, 0, "SetInformationJobObject must succeed");

            let mut queried: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            let mut returned = 0u32;
            let query_ok = QueryInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &mut queried as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                &mut returned,
            );
            let _ = CloseHandle(job);

            assert_ne!(query_ok, 0, "QueryInformationJobObject must succeed");
            let flags = queried.BasicLimitInformation.LimitFlags;
            assert_ne!(flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 0);
            assert_ne!(flags & JOB_OBJECT_LIMIT_BREAKAWAY_OK, 0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn single_instance_mutex_blocks_duplicate_until_released() {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

        let name = format!("Local\\KuroCat.UnitTest.Mutex.{}", std::process::id());
        let first = super::win_try_acquire_named_mutex(&name)
            .expect("first acquire of fresh named mutex must succeed");
        assert_eq!(
            super::win_try_acquire_named_mutex(&name),
            Err(true),
            "second acquire while first handle is open must report duplicate"
        );
        unsafe {
            let _ = CloseHandle(first as HANDLE);
        }
        let reacquired = super::win_try_acquire_named_mutex(&name)
            .expect("acquire after closing previous handle must succeed");
        unsafe {
            let _ = CloseHandle(reacquired as HANDLE);
        }
    }

    #[cfg(windows)]
    #[test]
    fn parses_admin_restart_handoff_cli_args() {
        let parsed = super::parse_win_startup_handoff_args([
            "--wait-pid",
            "4242",
            "--handoff-event",
            "Local\\KuroCat.AdminHandoff.4242.1",
            "--cleanup-old-exe",
            "C:\\Users\\test\\KuroCat.exe.old",
        ]);
        assert_eq!(parsed.wait_pid, Some(4242));
        assert_eq!(
            parsed.handoff_event.as_deref(),
            Some("Local\\KuroCat.AdminHandoff.4242.1")
        );
        assert_eq!(
            parsed.cleanup_old_exe.as_deref(),
            Some("C:\\Users\\test\\KuroCat.exe.old")
        );
    }

    #[cfg(windows)]
    #[test]
    fn session_handoff_event_signals_and_wakes_waiter() {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        const WAIT_OBJECT_0: u32 = 0;
        const WAIT_TIMEOUT: u32 = 258;

        let name = format!("Local\\KuroCat.UnitTest.Handoff.{}", std::process::id());
        let ev = super::win_create_session_event(&name, true);
        assert!(!ev.is_null(), "session event creation must succeed");
        unsafe {
            assert_eq!(WaitForSingleObject(ev, 0), WAIT_TIMEOUT);
        }
        assert!(
            super::win_signal_named_event(&name),
            "signaling session handoff event by name must succeed"
        );
        unsafe {
            assert_eq!(WaitForSingleObject(ev, 0), WAIT_OBJECT_0);
            let _ = CloseHandle(ev);
        }
    }

    #[cfg(windows)]
    #[test]
    fn elevated_webview2_user_data_folder_isolates_from_standard_profile() {
        let local = std::path::Path::new(r"C:\Users\alice\AppData\Local");
        let exe_dir = std::path::Path::new(r"C:\Users\alice\AppData\Local\KuroCat");
        let isolated = super::win_elevated_webview2_user_data_folder(Some(local), exe_dir);
        assert_eq!(
            isolated,
            std::path::PathBuf::from(r"C:\Users\alice\AppData\Local\com.kurocat.pet\EBWebView-Admin")
        );
        let fallback = super::win_elevated_webview2_user_data_folder(None, exe_dir);
        assert_eq!(
            fallback,
            std::path::PathBuf::from(r"C:\Users\alice\AppData\Local\KuroCat\WebView2Data-Admin")
        );
    }

    #[test]
    fn cross_platform_remote_desktop_classifiers_match_rdp_without_false_positives() {
        assert!(super::macos_is_remote_desktop_app(
            "com.microsoft.rdc.macos",
            "Windows App"
        ));
        assert!(super::macos_is_remote_desktop_app(
            "com.carriez.rustdesk",
            "RustDesk"
        ));
        assert!(super::macos_is_remote_desktop_app(
            "com.apple.ScreenSharing",
            "Screen Sharing"
        ));
        assert!(!super::macos_is_remote_desktop_app(
            "com.google.Chrome",
            "Google Chrome"
        ));
        assert!(!super::macos_is_remote_desktop_app(
            "com.microsoft.VSCode",
            "Code"
        ));

        assert!(super::linux_is_remote_desktop_wm_class("org.remmina.Remmina Remmina"));
        assert!(super::linux_is_remote_desktop_wm_class("xfreerdp xfreerdp"));
        assert!(super::linux_is_remote_desktop_wm_class("rustdesk Rustdesk"));
        assert!(super::linux_is_remote_desktop_wm_class("todesk ToDesk"));
        assert!(!super::linux_is_remote_desktop_wm_class("google-chrome Google-chrome"));
        assert!(!super::linux_is_remote_desktop_wm_class("code Code"));
    }
}
