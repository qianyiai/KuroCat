//! Read-only foreground application identity; never reads document/window content.
pub fn matches(name: &str, id: &str, entries: &str) -> bool {
    let name = name.to_lowercase();
    let id = id.to_lowercase();
    entries
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|entry| {
            let e = entry.to_lowercase();
            name == e || id == e || name.strip_suffix(".exe") == Some(&e)
        })
}

#[cfg(target_os = "macos")]
pub fn foreground() -> Option<(String, String)> {
    use objc2::{
        msg_send,
        runtime::{AnyClass, AnyObject},
    };
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let cls = AnyClass::get(c"NSWorkspace")?;
        let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
        if ws.is_null() {
            return None;
        }
        let app: *mut AnyObject = msg_send![ws, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let name: *const NSString = msg_send![app, localizedName];
        let id: *const NSString = msg_send![app, bundleIdentifier];
        if name.is_null() || id.is_null() {
            return None;
        }
        Some(((*name).to_string(), (*id).to_string()))
    })
}
#[cfg(target_os = "macos")]
pub fn idle_seconds() -> f64 {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
    }
    unsafe { CGEventSourceSecondsSinceLastEventType(1, u32::MAX) }
}
#[cfg(windows)]
pub fn foreground() -> Option<(String, String)> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut b = [0u16; 32768];
        let mut n = b.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, b.as_mut_ptr(), &mut n);
        CloseHandle(h);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&b[..n as usize]);
        let name = path.rsplit('\\').next()?.to_string();
        Some((name.clone(), name))
    }
}
#[cfg(windows)]
pub fn idle_seconds() -> f64 {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }
    unsafe {
        let mut i = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut i) == 0 {
            return f64::INFINITY;
        }
        GetTickCount().wrapping_sub(i.dwTime) as f64 / 1000.
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn foreground() -> Option<(String, String)> {
    None
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn idle_seconds() -> f64 {
    f64::INFINITY
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_application_match() {
        let list = "Microsoft Excel\ncom.microsoft.Word\nEXCEL.EXE";
        assert!(matches("Microsoft Excel", "com.microsoft.Excel", list));
        assert!(matches("Word", "com.microsoft.Word", list));
        assert!(!matches("Microsoft Edge", "com.microsoft.edgemac", list));
        assert!(!matches("Microsoft Excel Fake", "fake", list));
    }
}
