use serde::Serialize;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    KeyDown {
        vk: u32,
        scan: u32,
        repeat: bool,
    },
    KeyUp {
        vk: u32,
        scan: u32,
    },
    MouseDown {
        button: String,
    },
    MouseUp {
        button: String,
    },
    MouseWheel {
        delta: i16,
    },
    MouseMove {
        x: i32,
        y: i32,
        nx: f64,
        ny: f64,
    },
}

enum RawHookMsg {
    KeyDown { vk: u32, scan: u32 },
    KeyUp { vk: u32, scan: u32 },
    MouseDown(&'static str),
    MouseUp(&'static str),
    MouseWheel(i16),
    MouseMove { x: i32, y: i32 },
}

static HOOK_TX: OnceLock<mpsc::Sender<RawHookMsg>> = OnceLock::new();

pub fn start_global_hooks(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<RawHookMsg>();
    let _ = HOOK_TX.set(tx);

    // Dispatcher thread: deduplicates held key repeats & throttles mouse moves to ~60Hz
    std::thread::spawn(move || {
        let mut pressed = [false; 512];
        let mut last_mouse_emit = Instant::now() - Duration::from_secs(1);

        while let Ok(msg) = rx.recv() {
            match msg {
                RawHookMsg::KeyDown { vk, scan } => {
                    let repeat = if (vk as usize) < 512 {
                        let was = pressed[vk as usize];
                        pressed[vk as usize] = true;
                        was
                    } else {
                        false
                    };
                    #[cfg(debug_assertions)]
                    eprintln!("[kurocat] emit keyDown vk={vk:#x} repeat={repeat}");
                    let _ = app.emit("kuro-input", InputEvent::KeyDown { vk, scan, repeat });
                }
                RawHookMsg::KeyUp { vk, scan } => {
                    if (vk as usize) < 512 {
                        pressed[vk as usize] = false;
                    }
                    let _ = app.emit("kuro-input", InputEvent::KeyUp { vk, scan });
                }
                RawHookMsg::MouseDown(btn) => {
                    let _ = app.emit(
                        "kuro-input",
                        InputEvent::MouseDown {
                            button: btn.to_string(),
                        },
                    );
                }
                RawHookMsg::MouseUp(btn) => {
                    let _ = app.emit(
                        "kuro-input",
                        InputEvent::MouseUp {
                            button: btn.to_string(),
                        },
                    );
                }
                RawHookMsg::MouseWheel(delta) => {
                    let _ = app.emit("kuro-input", InputEvent::MouseWheel { delta });
                }
                RawHookMsg::MouseMove { x, y } => {
                    let now = Instant::now();
                    if now.duration_since(last_mouse_emit) >= Duration::from_millis(16) {
                        last_mouse_emit = now;
                        let (nx, ny) = normalize_screen_point(x, y);
                        let _ = app.emit("kuro-input", InputEvent::MouseMove { x, y, nx, ny });
                    }
                }
            }
        }
    });

    #[cfg(windows)]
    std::thread::spawn(|| {
        run_windows_hook_loop();
    });

    #[cfg(target_os = "macos")]
    std::thread::spawn(|| {
        macos_hook::run_macos_hook_loop();
    });
}

#[cfg(windows)]
fn normalize_screen_point(x: i32, y: i32) -> (f64, f64) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN) as f64;
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN) as f64;
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as f64;
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as f64;
        let nx = ((x as f64 - vx) / vw).clamp(0.0, 1.0);
        let ny = ((y as f64 - vy) / vh).clamp(0.0, 1.0);
        (nx, ny)
    }
}

#[cfg(target_os = "macos")]
fn normalize_screen_point(x: i32, y: i32) -> (f64, f64) {
    let (w, h) = macos_hook::main_display_size();
    let nx = (x as f64 / w.max(1.0)).clamp(0.0, 1.0);
    let ny = (y as f64 / h.max(1.0)).clamp(0.0, 1.0);
    (nx, ny)
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn normalize_screen_point(_x: i32, _y: i32) -> (f64, f64) {
    (0.5, 0.5)
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    if code >= 0 {
        let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
        let msg = wparam as u32;
        // Distinguish Numpad Enter (VK_RETURN with LLKHF_EXTENDED=0x01) from main Enter for 108-key layouts
        let mapped_vk = if kb.vkCode == 0x0d && (kb.flags & 0x01) != 0 {
            0x10d
        } else {
            kb.vkCode
        };
        if let Some(tx) = HOOK_TX.get() {
            match msg {
                WM_KEYDOWN | WM_SYSKEYDOWN => {
                    let _ = tx.send(RawHookMsg::KeyDown {
                        vk: mapped_vk,
                        scan: kb.scanCode,
                    });
                }
                WM_KEYUP | WM_SYSKEYUP => {
                    let _ = tx.send(RawHookMsg::KeyUp {
                        vk: mapped_vk,
                        scan: kb.scanCode,
                    });
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    if code >= 0 {
        let ms = &*(lparam as *const MSLLHOOKSTRUCT);
        let msg = wparam as u32;
        if let Some(tx) = HOOK_TX.get() {
            match msg {
                WM_MOUSEMOVE => {
                    let _ = tx.send(RawHookMsg::MouseMove {
                        x: ms.pt.x,
                        y: ms.pt.y,
                    });
                }
                WM_LBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("left"));
                }
                WM_LBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("left"));
                }
                WM_RBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("right"));
                }
                WM_RBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("right"));
                }
                WM_MBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("middle"));
                }
                WM_MBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("middle"));
                }
                WM_MOUSEWHEEL => {
                    let delta = ((ms.mouseData >> 16) & 0xffff) as i16;
                    let _ = tx.send(RawHookMsg::MouseWheel(delta));
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
fn run_windows_hook_loop() {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL,
    };

    unsafe {
        let hmod = GetModuleHandleW(std::ptr::null());
        let kb_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0);
        let ms_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}

        if !kb_hook.is_null() {
            UnhookWindowsHookEx(kb_hook);
        }
        if !ms_hook.is_null() {
            UnhookWindowsHookEx(ms_hook);
        }
    }
}

#[cfg(target_os = "macos")]
pub mod macos_hook {
    use super::{RawHookMsg, HOOK_TX};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::time::Duration;

    type CGEventTapProxy = *mut c_void;
    type CGEventRef = *mut c_void;
    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CGEventType = u32;
    type CGEventMask = u64;
    type CGDirectDisplayID = u32;

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
    const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
    const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
    const K_CG_EVENT_KEY_DOWN: u32 = 10;
    const K_CG_EVENT_KEY_UP: u32 = 11;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const K_CG_EVENT_SCROLL_WHEEL: u32 = 22;
    const K_CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
    const K_CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
    const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
    const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;

    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1: u32 = 11;

    const K_CG_SESSION_EVENT_TAP: u32 = 1;
    const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
    const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;

    // CGEventFlags modifier masks
    const FLAG_CAPS_LOCK: u64 = 0x00010000;
    const FLAG_SHIFT: u64 = 0x00020000;
    const FLAG_CONTROL: u64 = 0x00040000;
    const FLAG_OPTION: u64 = 0x00080000;
    const FLAG_COMMAND: u64 = 0x00100000;

    type CGEventTapCallBack = extern "C" fn(
        proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: CGEventMask,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGMainDisplayID() -> CGDirectDisplayID;
        fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
        fn CGEventCreate(source: *const c_void) -> CGEventRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: CFStringRef;
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        fn CFRelease(cf: *const c_void);
    }

    static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

    pub fn main_display_size() -> (f64, f64) {
        unsafe {
            let bounds = CGDisplayBounds(CGMainDisplayID());
            (bounds.size.width.max(1.0), bounds.size.height.max(1.0))
        }
    }

    pub fn cursor_pos_points() -> Option<(f64, f64)> {
        unsafe {
            let ev = CGEventCreate(std::ptr::null());
            if ev.is_null() {
                return None;
            }
            let pt = CGEventGetLocation(ev);
            CFRelease(ev as *const c_void);
            Some((pt.x, pt.y))
        }
    }

    fn macos_keycode_to_vk(kc: u16) -> Option<u32> {
        let vk = match kc {
            // Letters
            0x00 => 0x41, // A
            0x0B => 0x42, // B
            0x08 => 0x43, // C
            0x02 => 0x44, // D
            0x0E => 0x45, // E
            0x03 => 0x46, // F
            0x05 => 0x47, // G
            0x04 => 0x48, // H
            0x22 => 0x49, // I
            0x26 => 0x4A, // J
            0x28 => 0x4B, // K
            0x25 => 0x4C, // L
            0x2E => 0x4D, // M
            0x2D => 0x4E, // N
            0x1F => 0x4F, // O
            0x23 => 0x50, // P
            0x0C => 0x51, // Q
            0x0F => 0x52, // R
            0x01 => 0x53, // S
            0x11 => 0x54, // T
            0x20 => 0x55, // U
            0x09 => 0x56, // V
            0x0D => 0x57, // W
            0x07 => 0x58, // X
            0x10 => 0x59, // Y
            0x06 => 0x5A, // Z
            // Digits
            0x1D => 0x30, // 0
            0x12 => 0x31, // 1
            0x13 => 0x32, // 2
            0x14 => 0x33, // 3
            0x15 => 0x34, // 4
            0x17 => 0x35, // 5
            0x16 => 0x36, // 6
            0x1A => 0x37, // 7
            0x1C => 0x38, // 8
            0x19 => 0x39, // 9
            // Punctuation
            0x1B => 0xBD, // -
            0x18 => 0xBB, // =
            0x21 => 0xDB, // [
            0x1E => 0xDD, // ]
            0x2A => 0xDC, // \
            0x29 => 0xBA, // ;
            0x27 => 0xDE, // '
            0x2B => 0xBC, // ,
            0x2F => 0xBE, // .
            0x2C => 0xBF, // /
            0x32 => 0xC0, // `
            // Control & editing
            0x35 => 0x1B, // Esc
            0x30 => 0x09, // Tab
            0x31 => 0x20, // Space
            0x24 => 0x0D, // Return
            0x4C => 0x10D, // Numpad Enter
            0x33 => 0x08, // Backspace (Delete)
            0x75 => 0x2E, // Forward Delete
            0x39 => 0x14, // CapsLock
            // Numpad
            0x47 => 0x90, // Clear / NumLock
            0x4B => 0x6F, // Numpad /
            0x43 => 0x6A, // Numpad *
            0x4E => 0x6D, // Numpad -
            0x45 => 0x6B, // Numpad +
            0x41 => 0x6E, // Numpad .
            0x52 => 0x60, // Numpad 0
            0x53 => 0x61, // Numpad 1
            0x54 => 0x62, // Numpad 2
            0x55 => 0x63, // Numpad 3
            0x56 => 0x64, // Numpad 4
            0x57 => 0x65, // Numpad 5
            0x58 => 0x66, // Numpad 6
            0x59 => 0x67, // Numpad 7
            0x5B => 0x68, // Numpad 8
            0x5C => 0x69, // Numpad 9
            // Modifiers
            0x38 => 0xA0, // LShift
            0x3C => 0xA1, // RShift
            0x3B => 0xA2, // LCtrl
            0x3E => 0xA3, // RCtrl
            0x3A => 0xA4, // LOption (Alt)
            0x3D => 0xA5, // ROption (Alt)
            0x37 => 0x5B, // LCommand (Win)
            0x36 => 0x5C, // RCommand (Win)
            // Arrows & navigation
            0x7B => 0x25, // Left
            0x7C => 0x27, // Right
            0x7D => 0x28, // Down
            0x7E => 0x26, // Up
            0x73 => 0x24, // Home
            0x77 => 0x23, // End
            0x74 => 0x21, // PgUp
            0x79 => 0x22, // PgDn
            // Function keys
            0x7A => 0x70, // F1
            0x78 => 0x71, // F2
            0x63 => 0x72, // F3
            0x76 => 0x73, // F4
            0x60 => 0x74, // F5
            0x61 => 0x75, // F6
            0x62 => 0x76, // F7
            0x64 => 0x77, // F8
            0x65 => 0x78, // F9
            0x6D => 0x79, // F10
            0x67 => 0x7A, // F11
            0x6F => 0x7B, // F12
            _ => return None,
        };
        Some(vk)
    }

    extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        _user_info: *mut c_void,
    ) -> CGEventRef {
        if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            let tap = TAP_PORT.load(Ordering::Relaxed);
            if !tap.is_null() {
                unsafe { CGEventTapEnable(tap, true) };
            }
            return event;
        }

        if let Some(tx) = HOOK_TX.get() {
            unsafe {
                match event_type {
                    K_CG_EVENT_KEY_DOWN => {
                        let kc = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            let _ = tx.send(RawHookMsg::KeyDown { vk, scan: kc as u32 });
                        }
                    }
                    K_CG_EVENT_KEY_UP => {
                        let kc = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            let _ = tx.send(RawHookMsg::KeyUp { vk, scan: kc as u32 });
                        }
                    }
                    K_CG_EVENT_FLAGS_CHANGED => {
                        let kc = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        let flags = CGEventGetFlags(event);
                        let is_down = match kc {
                            0x38 | 0x3C => (flags & FLAG_SHIFT) != 0,
                            0x3B | 0x3E => (flags & FLAG_CONTROL) != 0,
                            0x3A | 0x3D => (flags & FLAG_OPTION) != 0,
                            0x37 | 0x36 => (flags & FLAG_COMMAND) != 0,
                            0x39 => (flags & FLAG_CAPS_LOCK) != 0,
                            _ => false,
                        };
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            if is_down {
                                let _ = tx.send(RawHookMsg::KeyDown { vk, scan: kc as u32 });
                            } else {
                                let _ = tx.send(RawHookMsg::KeyUp { vk, scan: kc as u32 });
                            }
                        }
                    }
                    K_CG_EVENT_MOUSE_MOVED
                    | K_CG_EVENT_LEFT_MOUSE_DRAGGED
                    | K_CG_EVENT_RIGHT_MOUSE_DRAGGED => {
                        let pt = CGEventGetLocation(event);
                        let _ = tx.send(RawHookMsg::MouseMove {
                            x: pt.x.round() as i32,
                            y: pt.y.round() as i32,
                        });
                    }
                    K_CG_EVENT_LEFT_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("left"));
                    }
                    K_CG_EVENT_LEFT_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("left"));
                    }
                    K_CG_EVENT_RIGHT_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("right"));
                    }
                    K_CG_EVENT_RIGHT_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("right"));
                    }
                    K_CG_EVENT_OTHER_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("middle"));
                    }
                    K_CG_EVENT_OTHER_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("middle"));
                    }
                    K_CG_EVENT_SCROLL_WHEEL => {
                        let delta = CGEventGetIntegerValueField(
                            event,
                            K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1,
                        ) as i16;
                        let _ = tx.send(RawHookMsg::MouseWheel(delta));
                    }
                    _ => {}
                }
            }
        }
        event
    }

    pub fn run_macos_hook_loop() {
        // Do NOT gate on AXIsProcessTrusted. For adhoc/unsigned builds the
        // Accessibility grant is flaky and re-prompts every launch, while a
        // listen-only CGEventTap only requires Input Monitoring. Just create
        // the tap; if it fails we retry in the loop below.

        let mask: CGEventMask = (1u64 << K_CG_EVENT_LEFT_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_LEFT_MOUSE_UP)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_UP)
            | (1u64 << K_CG_EVENT_MOUSE_MOVED)
            | (1u64 << K_CG_EVENT_LEFT_MOUSE_DRAGGED)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_DRAGGED)
            | (1u64 << K_CG_EVENT_KEY_DOWN)
            | (1u64 << K_CG_EVENT_KEY_UP)
            | (1u64 << K_CG_EVENT_FLAGS_CHANGED)
            | (1u64 << K_CG_EVENT_SCROLL_WHEEL)
            | (1u64 << K_CG_EVENT_OTHER_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_OTHER_MOUSE_UP);

        loop {
            unsafe {
                let tap = CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                    mask,
                    tap_callback,
                    std::ptr::null_mut(),
                );
                if tap.is_null() {
                    #[cfg(debug_assertions)]
                    eprintln!("[kurocat] CGEventTapCreate returned null (needs Input Monitoring?) - retrying");
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
                #[cfg(debug_assertions)]
                eprintln!("[kurocat] event tap created OK");
                TAP_PORT.store(tap, Ordering::Relaxed);
                let src = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
                if src.is_null() {
                    #[cfg(debug_assertions)]
                    eprintln!("[kurocat] CFMachPortCreateRunLoopSource failed");
                    CFRelease(tap as *const c_void);
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
                let rl = CFRunLoopGetCurrent();
                CFRunLoopAddSource(rl, src, kCFRunLoopCommonModes);
                CGEventTapEnable(tap, true);
                CFRunLoopRun();
                CFRelease(src as *const c_void);
                CFRelease(tap as *const c_void);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    }
}
