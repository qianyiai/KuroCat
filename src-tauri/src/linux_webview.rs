use gtk::cairo::{ImageSurface, Operator};
use gtk::glib::Propagation;
use gtk::prelude::*;
use std::cell::RefCell;
use std::rc::Rc;
use webkit2gtk::{ffi, gio, SnapshotOptions, SnapshotRegion, WebView, WebViewExt};

type ViewSize = (i32, i32, i32);

fn view_size(view: &WebView) -> ViewSize {
    (
        view.allocated_width(),
        view.allocated_height(),
        view.scale_factor(),
    )
}

#[derive(Default)]
struct Frames {
    current: Option<(ViewSize, ImageSurface)>,
    capturing: bool,
    invalidated: bool,
}

fn same_pixels(a: &ImageSurface, b: &ImageSurface) -> bool {
    if a.width() != b.width() || a.height() != b.height() || a.format() != b.format() {
        return false;
    }
    let mut equal = false;
    let _ = a.with_data(|left| {
        let _ = b.with_data(|right| equal = left == right);
    });
    equal
}

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
            if view_size(&view) != size {
                state.current = None;
            } else if let Some(image) = result.ok().and_then(|s| ImageSurface::try_from(s).ok()) {
                // GTK draws in logical coordinates. WebKit snapshots can be device-sized.
                image.set_device_scale(
                    f64::from(image.width()) / f64::from(size.0),
                    f64::from(image.height()) / f64::from(size.1),
                );
                // A presentation redraw may coalesce with new WebKit damage. Capture
                // on both, then stop the feedback loop once the pixels are unchanged.
                if !invalidated
                    && state.current.as_ref().is_some_and(|(old_size, old)| {
                        *old_size == size && same_pixels(old, &image)
                    })
                {
                    return;
                }
                state.current = Some((size, image));
            } else if state.current.take().is_none() && !invalidated {
                // WebKit paints normally while snapshots are unavailable. Retry on new damage.
                return;
            }
            drop(state);
            view.queue_draw();
        },
    );
}

// WebKit bug 319864 affects the persistent backing store. The snapshot API obtains a
// fresh transparent frame from the web process, upstream of that store.
pub(super) fn configure_transparent_webview(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // WebKitGTK 2.46 switched to Skia. 2.52.6 restored source-copy semantics.
    // These getters return the version of the library loaded at runtime.
    let version = unsafe {
        (
            ffi::webkit_get_major_version(),
            ffi::webkit_get_minor_version(),
            ffi::webkit_get_micro_version(),
        )
    };
    if !((2, 46, 0)..(2, 52, 6)).contains(&version) {
        return Ok(());
    }

    window.with_webview(|webview| {
        let view = webview.inner();
        let frames = Rc::new(RefCell::new(Frames::default()));
        view.connect_draw(move |view, cr| {
            let size = view_size(view);
            if size.0 < 1 || size.1 < 1 {
                return Propagation::Proceed;
            }
            let mut state = frames.borrow_mut();
            if state.capturing {
                state.invalidated = true;
            } else {
                state.capturing = true;
                drop(state);
                capture(view, Rc::clone(&frames), size);
                state = frames.borrow_mut();
            }
            let Some((_, image)) = state.current.as_ref().filter(|(s, _)| *s == size) else {
                return Propagation::Proceed;
            };
            if cr.save().is_err() {
                return Propagation::Proceed;
            }
            cr.set_operator(Operator::Source);
            let painted = cr
                .set_source_surface(image, 0.0, 0.0)
                .and_then(|_| cr.paint());
            let _ = cr.restore();
            if painted.is_ok() {
                Propagation::Stop
            } else {
                Propagation::Proceed
            }
        });
    })
}
