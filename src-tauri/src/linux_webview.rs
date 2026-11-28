//! Linux WebKitGTK 2.46.0–2.52.5 transparent window ghosting workaround (Issue #56, WebKit bug 319864).
//!
//! WebKitGTK 2.46 switched to Skia; until 2.52.6 restored source-copy semantics, transparent
//! overlay windows can composite new frames over stale pixels in the persistent backing store.
//! Capturing a clean transparent frame via `WebView::snapshot` (upstream of the backing store)
//! and painting it with `cairo::Operator::Source` eliminates trailing ghost frames.
//!
//! Based on community contribution by @wte-81 (`wte-81/kurocat`, commit 537c664), hardened with
//! mapped-visibility gating, device-scale bounds checks, and `KUROCAT_LINUX_SNAPSHOT_CLEAR=0|1`.

#[cfg(target_os = "linux")]
use gtk::cairo::{Context, ImageSurface, Operator};
#[cfg(target_os = "linux")]
use gtk::glib::{self, translate::FromGlibPtrBorrow, translate::IntoGlib, Propagation};
#[cfg(target_os = "linux")]
use gtk::prelude::*;
#[cfg(target_os = "linux")]
use std::cell::RefCell;
#[cfg(target_os = "linux")]
use std::rc::Rc;
#[cfg(target_os = "linux")]
use webkit2gtk::{ffi, gio, SnapshotOptions, SnapshotRegion, WebView, WebViewExt};

/// Decides whether the GTK draw-snapshot `Operator::Source` workaround should activate.
/// - `KUROCAT_LINUX_SNAPSHOT_CLEAR=0|false|off` forces it off.
/// - `KUROCAT_LINUX_SNAPSHOT_CLEAR=1|true|on` forces it on.
/// - Otherwise enabled automatically on affected WebKitGTK versions `[2.46.0, 2.52.6)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn should_enable_snapshot_clear(
    webkit_ver: (u32, u32, u32),
    env_override: Option<&str>,
) -> bool {
    if let Some(raw) = env_override {
        let v = raw.trim().to_ascii_lowercase();
        if matches!(v.as_str(), "0" | "false" | "off" | "no") {
            return false;
        }
        if matches!(v.as_str(), "1" | "true" | "on" | "yes") {
            return true;
        }
    }
    ((2, 46, 0)..(2, 52, 6)).contains(&webkit_ver)
}

#[cfg(target_os = "linux")]
type ViewSize = (i32, i32, i32);

#[cfg(target_os = "linux")]
fn view_size(view: &WebView) -> ViewSize {
    (
        view.allocated_width(),
        view.allocated_height(),
        view.scale_factor(),
    )
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct Frames {
    current: Option<(ViewSize, ImageSurface)>,
    capturing: bool,
    invalidated: bool,
    presenting: bool,
}

#[cfg(target_os = "linux")]
fn slice_has_nonzero(bytes: &[u8]) -> bool {
    let chunks = bytes.chunks_exact(8);
    let rem = chunks.remainder();
    for chunk in chunks {
        if u64::from_ne_bytes([
            chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
        ]) != 0
        {
            return true;
        }
    }
    rem.iter().any(|&b| b != 0)
}

/// Fast visible-pixel check (center-first `u64` scan): hits the cat's body/face in < 1us on
/// normal frames while still scanning the entire buffer before declaring a frame blank.
#[cfg(target_os = "linux")]
fn has_visible_pixels(img: &ImageSurface) -> bool {
    let mut visible = false;
    let _ = img.with_data(|bytes| {
        let mid = (bytes.len() / 2) & !7;
        visible = slice_has_nonzero(&bytes[mid..]) || slice_has_nonzero(&bytes[..mid]);
    });
    visible
}

#[cfg(target_os = "linux")]
fn capture(view: &WebView, frames: Rc<RefCell<Frames>>, size: ViewSize) {
    let weak_view = view.downgrade();
    view.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        None::<&gio::Cancellable>,
        move |result| {
            let Some(view) = weak_view.upgrade() else {
                return;
            };
            let mut state = frames.borrow_mut();
            state.capturing = false;
            let invalidated = std::mem::take(&mut state.invalidated);
            if !view.is_mapped() || !view.is_visible() {
                state.current = None;
                return;
            }
            let cur_size = view_size(&view);
            if cur_size != size {
                state.current = None;
                if cur_size.0 >= 1 && cur_size.1 >= 1 {
                    state.capturing = true;
                    drop(state);
                    capture(&view, Rc::clone(&frames), cur_size);
                }
                return;
            }
            if let Some(image) = result.ok().and_then(|s| ImageSurface::try_from(s).ok()) {
                if image.width() < 1 || image.height() < 1 {
                    return;
                }
                // Guard against blank all-zero snapshots (e.g. unreadable GPU DMA-BUF readback):
                // never overwrite WebKit's live draw with an empty transparent rectangle!
                if !has_visible_pixels(&image) {
                    if state.current.take().is_some() {
                        state.presenting = true;
                        drop(state);
                        view.queue_draw();
                        return;
                    }
                    if invalidated {
                        state.capturing = true;
                        drop(state);
                        capture(&view, Rc::clone(&frames), size);
                    }
                    return;
                }
                // GTK draws in logical coordinates while WebKit snapshots can be device-sized.
                image.set_device_scale(
                    f64::from(image.width()) / f64::from(size.0),
                    f64::from(image.height()) / f64::from(size.1),
                );
                state.current = Some((size, image));
                state.presenting = true;
                let need_recapture = invalidated;
                if need_recapture {
                    state.capturing = true;
                }
                drop(state);
                view.queue_draw();
                if need_recapture {
                    capture(&view, Rc::clone(&frames), size);
                }
            } else {
                let had_frame = state.current.take().is_some();
                if had_frame {
                    state.presenting = true;
                }
                let need_recapture = invalidated;
                if need_recapture {
                    state.capturing = true;
                }
                drop(state);
                if had_frame {
                    view.queue_draw();
                }
                if need_recapture {
                    capture(&view, Rc::clone(&frames), size);
                }
            }
        },
    );
}

/// Connects a `GtkWidget::draw` handler with `G_CONNECT_AFTER` so it runs right after
/// `WebKitWebViewBase::draw()` on the same `cairo::Context` (letting WebKit's default draw
/// always dispatch `frameComplete` to `ThreadedCompositor`, then cleanly replacing the buffer
/// with `Operator::Source` before presentation).
#[cfg(target_os = "linux")]
fn connect_draw_after<F: Fn(&WebView, &Context) -> Propagation + 'static>(view: &WebView, f: F) {
    unsafe extern "C" fn draw_after_trampoline<
        F: Fn(&WebView, &Context) -> Propagation + 'static,
    >(
        this: *mut gtk::ffi::GtkWidget,
        cr: *mut gtk::cairo::ffi::cairo_t,
        data: glib::ffi::gpointer,
    ) -> glib::ffi::gboolean {
        let cb: &F = &*(data as *const F);
        let widget = gtk::Widget::from_glib_borrow(this);
        let cr = Context::from_glib_borrow(cr);
        cb(widget.unsafe_cast_ref::<WebView>(), &cr).into_glib()
    }
    unsafe extern "C" fn destroy_cb<F>(data: glib::ffi::gpointer, _closure: *mut glib::gobject_ffi::GClosure) {
        drop(Box::from_raw(data as *mut F));
    }
    unsafe {
        let boxed = Box::into_raw(Box::new(f));
        glib::gobject_ffi::g_signal_connect_data(
            view.as_ptr() as *mut glib::gobject_ffi::GObject,
            b"draw\0".as_ptr() as *const _,
            Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(),
            >(draw_after_trampoline::<F> as *const ())),
            boxed as glib::ffi::gpointer,
            Some(destroy_cb::<F>),
            glib::gobject_ffi::G_CONNECT_AFTER,
        );
    }
}

#[cfg(target_os = "linux")]
pub(super) fn configure_transparent_webview(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let version = unsafe {
        (
            ffi::webkit_get_major_version(),
            ffi::webkit_get_minor_version(),
            ffi::webkit_get_micro_version(),
        )
    };
    let env_override = std::env::var("KUROCAT_LINUX_SNAPSHOT_CLEAR").ok();
    let enabled = should_enable_snapshot_clear(version, env_override.as_deref());
    eprintln!(
        "[kurocat] linux transparent snapshot-clear: webkit={:?} enabled={}",
        version, enabled
    );
    if !enabled {
        return Ok(());
    }

    window.with_webview(|webview| {
        let view = webview.inner();
        let frames = Rc::new(RefCell::new(Frames::default()));

        // Before-handler: schedule a coalesced clean snapshot on real WebKit damage,
        // and ALWAYS return `Propagation::Proceed` so WebKitWebViewBase::draw() sends
        // `frameComplete` back to WebKitWebProcess (preventing 0.3 FPS WebGL stalls on WSLg/Wayland!).
        let frames_before = Rc::clone(&frames);
        view.connect_draw(move |view, _cr| {
            if !view.is_mapped() || !view.is_visible() {
                return Propagation::Proceed;
            }
            let size = view_size(view);
            if size.0 < 1 || size.1 < 1 {
                return Propagation::Proceed;
            }
            let mut state = frames_before.borrow_mut();
            if state.presenting {
                state.presenting = false;
            } else if state.capturing {
                state.invalidated = true;
            } else {
                state.capturing = true;
                drop(state);
                capture(view, Rc::clone(&frames_before), size);
            }
            Propagation::Proceed
        });

        // After-handler: runs right after WebKitWebViewBase::draw() on the same Cairo context,
        // replacing any ghosted backing-store pixels with `Operator::Source` before X11/Wayland flush.
        let frames_after = Rc::clone(&frames);
        connect_draw_after(&view, move |view, cr| {
            if !view.is_mapped() || !view.is_visible() {
                return Propagation::Proceed;
            }
            let size = view_size(view);
            if size.0 < 1 || size.1 < 1 {
                return Propagation::Proceed;
            }
            let state = frames_after.borrow();
            let Some((_, image)) = state.current.as_ref().filter(|(s, _)| *s == size) else {
                return Propagation::Proceed;
            };
            if cr.save().is_ok() {
                cr.set_operator(Operator::Source);
                let _ = cr.set_source_surface(image, 0.0, 0.0).and_then(|_| cr.paint());
                let _ = cr.restore();
            }
            Propagation::Proceed
        });
    })
}

/// Specification of the native GTK/X11/Wayland input hit-test shape (`XShapeInput` /
/// `wl_surface.set_input_region`) for the Linux pet window.
///
/// Using a static silhouette region instead of toggling `set_ignore_cursor_events(true/false)`
/// from `XQueryPointer` polling eliminates the XWayland/WSLg/Wayland click-through deadlock
/// (GitHub #116): on Wayland compositors (GNOME, KDE, Hyprland, WSLg Weston), collapsing
/// `ShapeInput` to 1x1 stops pointer events from ever reaching XWayland again, freezing
/// `XQueryPointer` permanently outside the cat.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LinuxInputRegionSpec {
    pub win_log_w: i32,
    pub win_log_h: i32,
    pub full_capture: bool,
    pub locked: bool,
    pub layout: &'static str,
    pub scale_millis: u16,
    pub peek_edge: &'static str,
    pub banner_open: bool,
    pub picker_rects: Option<[(i32, i32, i32, i32); 3]>,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LinuxInputRegionShape {
    FullWindow,
    Empty,
    Rects(Vec<(i32, i32, i32, i32)>),
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn norm_box_to_logical_rect(
    bounds: [f64; 4],
    win_log_w: i32,
    win_log_h: i32,
) -> (i32, i32, i32, i32) {
    let w_f = f64::from(win_log_w.max(1));
    let h_f = f64::from(win_log_h.max(1));
    let x0 = (bounds[0] * w_f).floor() as i32;
    let y0 = (bounds[1] * h_f).floor() as i32;
    let x1 = (bounds[2] * w_f).ceil() as i32;
    let y1 = (bounds[3] * h_f).ceil() as i32;
    let cx0 = x0.clamp(0, win_log_w);
    let cy0 = y0.clamp(0, win_log_h);
    let cx1 = x1.clamp(cx0, win_log_w);
    let cy1 = y1.clamp(cy0, win_log_h);
    (cx0, cy0, cx1 - cx0, cy1 - cy0)
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn push_clamped_norm_rect(
    rects: &mut Vec<(i32, i32, i32, i32)>,
    nx0: f64,
    ny0: f64,
    nx1: f64,
    ny1: f64,
    win_log_w: i32,
    win_log_h: i32,
) {
    let rect = norm_box_to_logical_rect([nx0, ny0, nx1, ny1], win_log_w, win_log_h);
    if rect.2 > 0 && rect.3 > 0 {
        rects.push(rect);
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[allow(clippy::too_many_arguments)]
fn push_oval_scanline_bands(
    rects: &mut Vec<(i32, i32, i32, i32)>,
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    x_off: f64,
    y_off: f64,
    x_scale: f64,
    y_scale: f64,
    win_log_w: i32,
    win_log_h: i32,
    bands: usize,
) {
    let n = bands.max(1);
    let step = 2.0 / (n as f64);
    for i in 0..n {
        let dy0 = -1.0 + (i as f64) * step;
        let dy1 = (dy0 + step).min(1.0);
        // Use the minimum |dy| within the strip so each band conservatively covers the oval.
        let min_abs_dy = if dy0 <= 0.0 && dy1 >= 0.0 {
            0.0
        } else {
            dy0.abs().min(dy1.abs())
        };
        let half_w = rx * (1.0 - min_abs_dy * min_abs_dy).max(0.0).sqrt();
        if half_w <= 0.001 {
            continue;
        }
        let nx0 = x_off + (cx - half_w) * x_scale;
        let nx1 = x_off + (cx + half_w) * x_scale;
        let ny0 = y_off + (cy + dy0 * ry) * y_scale;
        let ny1 = y_off + (cy + dy1 * ry) * y_scale;
        push_clamped_norm_rect(rects, nx0, ny0, nx1, ny1, win_log_w, win_log_h);
    }
}

/// Computes the exact logical-pixel input region matching `is_over_interactive_silhouette`,
/// update banner, and tail-picker overlays.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn build_linux_input_region_shape(
    spec: &LinuxInputRegionSpec,
) -> LinuxInputRegionShape {
    if spec.win_log_w < 1 || spec.win_log_h < 1 || spec.full_capture {
        return LinuxInputRegionShape::FullWindow;
    }
    if spec.locked {
        return LinuxInputRegionShape::Empty;
    }

    let mut rects: Vec<(i32, i32, i32, i32)> = Vec::with_capacity(18);
    let win_w = spec.win_log_w;
    let win_h = spec.win_log_h;

    if spec.peek_edge == "left" {
        push_oval_scanline_bands(
            &mut rects, 0.16, 0.50, 0.28, 0.34, 0.0, 0.0, 1.0, 1.0, win_w, win_h, 10,
        );
    } else if spec.peek_edge == "right" {
        push_oval_scanline_bands(
            &mut rects, 0.84, 0.50, 0.28, 0.34, 0.0, 0.0, 1.0, 1.0, win_w, win_h, 10,
        );
    } else {
        let (bw, bh) = crate::base_dimensions(spec.layout);
        let cur_scale = (f64::from(spec.scale_millis) / 1000.0).clamp(0.20, 1.50);
        let pet_w_frac = ((bw * cur_scale) / f64::from(win_w)).clamp(0.05, 1.0);
        let pet_h_frac = ((bh * cur_scale) / f64::from(win_h)).clamp(0.05, 1.0);
        let pet_x0 = 1.0 - pet_w_frac;
        let pet_y0 = 1.0 - pet_h_frac;

        let (cat_cx, cat_rx, tail_max_x, desk_min_x, desk_max_x, desk_max_y) = match spec.layout {
            "108" => (0.51, 0.21, 0.85, 0.04, 0.96, 0.95),
            "98" => (0.495, 0.23, 0.875, 0.05, 0.96, 0.94),
            _ => (0.48, 0.25, 0.90, 0.06, 0.95, 0.94),
        };
        push_oval_scanline_bands(
            &mut rects,
            cat_cx,
            0.49,
            cat_rx,
            0.27,
            pet_x0,
            pet_y0,
            pet_w_frac,
            pet_h_frac,
            win_w,
            win_h,
            10,
        );
        // Tail zone
        push_clamped_norm_rect(
            &mut rects,
            pet_x0 + 0.64 * pet_w_frac,
            pet_y0 + 0.48 * pet_h_frac,
            pet_x0 + tail_max_x * pet_w_frac,
            pet_y0 + 0.72 * pet_h_frac,
            win_w,
            win_h,
        );
        // Keyboard & mouse desk zone
        push_clamped_norm_rect(
            &mut rects,
            pet_x0 + desk_min_x * pet_w_frac,
            pet_y0 + 0.65 * pet_h_frac,
            pet_x0 + desk_max_x * pet_w_frac,
            pet_y0 + desk_max_y * pet_h_frac,
            win_w,
            win_h,
        );
    }

    if spec.banner_open {
        let limit = crate::banner_hit_ry_limit(f64::from(win_h));
        push_clamped_norm_rect(&mut rects, 0.0, 0.0, 1.0, limit, win_w, win_h);
    }

    if let Some(picker_rects) = spec.picker_rects {
        for &(x, y, w, h) in &picker_rects {
            if w > 0 && h > 0 {
                let cx0 = x.clamp(0, win_w);
                let cy0 = y.clamp(0, win_h);
                let cx1 = (x + w).clamp(cx0, win_w);
                let cy1 = (y + h).clamp(cy0, win_h);
                if cx1 > cx0 && cy1 > cy0 {
                    rects.push((cx0, cy0, cx1 - cx0, cy1 - cy0));
                }
            }
        }
    }

    if rects.is_empty() {
        LinuxInputRegionShape::FullWindow
    } else {
        LinuxInputRegionShape::Rects(rects)
    }
}

/// Applies the computed input region directly to the GTK/GDK window (must run on GTK main thread).
#[cfg(target_os = "linux")]
pub(super) fn apply_input_region(window: &tauri::WebviewWindow, shape: &LinuxInputRegionShape) {
    let Ok(gtk_win) = window.gtk_window() else {
        return;
    };
    match shape {
        LinuxInputRegionShape::FullWindow => {
            gtk_win.input_shape_combine_region(None);
            if let Some(gdk_win) = gtk_win.window() {
                let full = gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(
                    0,
                    0,
                    gtk_win.allocated_width().max(1),
                    gtk_win.allocated_height().max(1),
                ));
                gdk_win.input_shape_combine_region(&full, 0, 0);
            }
        }
        LinuxInputRegionShape::Empty => {
            let empty = gtk::cairo::Region::create();
            gtk_win.input_shape_combine_region(Some(&empty));
            if let Some(gdk_win) = gtk_win.window() {
                gdk_win.input_shape_combine_region(&empty, 0, 0);
            }
        }
        LinuxInputRegionShape::Rects(rects) => {
            let cairo_rects: Vec<gtk::cairo::RectangleInt> = rects
                .iter()
                .filter(|&&(_, _, w, h)| w > 0 && h > 0)
                .map(|&(x, y, w, h)| gtk::cairo::RectangleInt::new(x, y, w, h))
                .collect();
            let region = gtk::cairo::Region::create_rectangles(&cairo_rects);
            gtk_win.input_shape_combine_region(Some(&region));
            if let Some(gdk_win) = gtk_win.window() {
                gdk_win.input_shape_combine_region(&region, 0, 0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_linux_input_region_shape, should_enable_snapshot_clear, LinuxInputRegionShape,
        LinuxInputRegionSpec,
    };

    fn point_in_shape(shape: &LinuxInputRegionShape, x: i32, y: i32) -> bool {
        match shape {
            LinuxInputRegionShape::FullWindow => true,
            LinuxInputRegionShape::Empty => false,
            LinuxInputRegionShape::Rects(rects) => rects
                .iter()
                .any(|&(rx, ry, rw, rh)| x >= rx && x < rx + rw && y >= ry && y < ry + rh),
        }
    }

    #[test]
    fn snapshot_clear_targets_affected_webkitgtk_skia_versions() {
        assert!(!should_enable_snapshot_clear((2, 44, 4), None));
        assert!(should_enable_snapshot_clear((2, 46, 0), None));
        assert!(should_enable_snapshot_clear((2, 50, 4), None));
        assert!(should_enable_snapshot_clear((2, 52, 5), None));
        assert!(!should_enable_snapshot_clear((2, 52, 6), None));
        assert!(!should_enable_snapshot_clear((2, 54, 0), None));
    }

    #[test]
    fn snapshot_clear_honors_explicit_env_override() {
        assert!(!should_enable_snapshot_clear((2, 50, 4), Some("0")));
        assert!(!should_enable_snapshot_clear((2, 50, 4), Some("false")));
        assert!(should_enable_snapshot_clear((2, 54, 0), Some("1")));
        assert!(should_enable_snapshot_clear((2, 44, 0), Some("true")));
    }

    #[test]
    fn linux_input_region_covers_cat_and_passes_through_transparent_corners() {
        let base = LinuxInputRegionSpec {
            win_log_w: 420,
            win_log_h: 440,
            full_capture: false,
            locked: false,
            layout: "65",
            scale_millis: 1000,
            peek_edge: "none",
            banner_open: false,
            picker_rects: None,
        };
        let shape = build_linux_input_region_shape(&base);
        // Cat center, tail, and keyboard must ALWAYS be clickable
        assert!(point_in_shape(&shape, 200, 215)); // cat head/body center
        assert!(point_in_shape(&shape, 330, 260)); // tail curve
        assert!(point_in_shape(&shape, 200, 350)); // keyboard desk
        // Transparent top-left & top-right corners must pass straight through
        assert!(!point_in_shape(&shape, 10, 10));
        assert!(!point_in_shape(&shape, 405, 15));

        // Dragging expands to full window; click-through lock empties region completely
        let drag_shape = build_linux_input_region_shape(&LinuxInputRegionSpec {
            full_capture: true,
            ..base.clone()
        });
        assert_eq!(drag_shape, LinuxInputRegionShape::FullWindow);

        let locked_shape = build_linux_input_region_shape(&LinuxInputRegionSpec {
            locked: true,
            ..base.clone()
        });
        assert_eq!(locked_shape, LinuxInputRegionShape::Empty);

        // Update banner makes top bar clickable
        let banner_shape = build_linux_input_region_shape(&LinuxInputRegionSpec {
            banner_open: true,
            ..base
        });
        assert!(point_in_shape(&banner_shape, 10, 10));
    }
}
