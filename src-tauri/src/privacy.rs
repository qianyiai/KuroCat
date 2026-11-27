use crate::config::AppSettings;
use crate::input_hook;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Starts a lightweight background watcher that detects when the OS focus is inside a
/// password field (Windows UI Automation `IsPassword` + Win32 `ES_PASSWORD`; macOS native
/// `IsSecureEventInputEnabled` + `AXSecureTextField`), immediately suppressing keystroke
/// forwarding in `input_hook` and notifying the frontend to close the cat's eyes / cover BigFish's eyes.
pub fn start_password_privacy_watcher(
    app: AppHandle,
    settings: Arc<Mutex<AppSettings>>,
    paused_guard: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        #[cfg(windows)]
        let mut uia = win_impl::UiaDetector::new();

        let mut active = false;
        let mut clear_streak: u8 = 0;

        loop {
            std::thread::sleep(Duration::from_millis(140));

            let guard_enabled = !paused_guard.load(Ordering::Relaxed)
                && settings
                    .lock()
                    .map(|s| s.privacy_password_guard)
                    .unwrap_or(true);

            if !guard_enabled {
                if active {
                    active = false;
                    clear_streak = 0;
                    input_hook::set_password_privacy_active(false);
                    let _ = app.emit("kuro-privacy", false);
                }
                continue;
            }

            #[cfg(windows)]
            let is_pwd = win_impl::is_focused_password_field(uia.as_mut());
            #[cfg(target_os = "macos")]
            let is_pwd = mac_impl::is_focused_password_field();
            #[cfg(all(not(windows), not(target_os = "macos")))]
            let is_pwd = false;

            if is_pwd {
                clear_streak = 0;
                if !active {
                    active = true;
                    input_hook::set_password_privacy_active(true);
                    let _ = app.emit("kuro-privacy", true);
                }
            } else if active {
                // Brief 2-tick (~280ms) debounce before exiting so focus flickers inside a login form don't flash open
                clear_streak = clear_streak.saturating_add(1);
                if clear_streak >= 2 {
                    active = false;
                    clear_streak = 0;
                    input_hook::set_password_privacy_active(false);
                    let _ = app.emit("kuro-privacy", false);
                }
            }
        }
    });
}

/// Strict semantic password-field label matcher shared across Windows (UIA/MSAA) and macOS
/// (AXUIElement) for single-line editable inputs (e.g. financial CefSharp/Electron/web login
/// pages like 同花顺 that mask a custom text field without exposing `IsPassword` / `AXSecureTextField`).
#[cfg_attr(all(not(windows), not(target_os = "macos"), not(test)), allow(dead_code))]
pub(crate) fn looks_like_password_field_label(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 64 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();

    // Explicit denylist prevents false positives on search bars, browser omniboxes, account/OTP
    // fields, or chat/editor inputs whose surrounding copy mentions passwords.
    const DENY_SUBSTRINGS: &[&str] = &[
        "搜索",
        "查找",
        "地址",
        "网址",
        "用户名",
        "账号",
        "帐号",
        "手机",
        "邮箱",
        "验证码",
        "动态码",
        "短信",
        "图形码",
        "备注",
        "标题",
        "正文",
        "评论",
        "聊天",
        "消息",
        "search",
        "find",
        "address",
        "url",
        "username",
        "user name",
        "account",
        "email",
        "phone",
        "captcha",
        "verify",
        "otp",
        "sms",
        "filter",
        "query",
        "chat",
        "message",
        "comment",
        "editor",
        "console",
        "terminal",
    ];
    if DENY_SUBSTRINGS.iter().any(|bad| lower.contains(bad)) {
        return false;
    }

    if trimmed.contains("密码") || trimmed.contains("口令") {
        return true;
    }

    // Split ASCII identifiers on non-alphanumeric boundaries AND camelCase transitions so
    // `loginPassword`, `trade_pwd`, `user-passcode` match while unrelated words do not.
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            if ch.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            prev_lower = ch.is_ascii_lowercase();
            cur.push(ch.to_ascii_lowercase());
        } else {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }

    for tok in &tokens {
        if matches!(
            tok.as_str(),
            "password" | "passcode" | "passwd" | "passphrase" | "pwd" | "pin"
        ) {
            return true;
        }
    }
    false
}

#[cfg(windows)]
mod win_impl {
    use super::looks_like_password_field_label;
    use std::time::{Duration, Instant};
    use windows::core::{IUnknown, Interface, VARIANT};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        AccessibleObjectFromWindow, CUIAutomation, IAccessible, IUIAutomation,
        IUIAutomationCondition, IUIAutomationElement, IUIAutomationLegacyIAccessiblePattern,
        TreeScope_Subtree, UIA_CustomControlTypeId, UIA_EditControlTypeId,
        UIA_HasKeyboardFocusPropertyId, UIA_LegacyIAccessiblePatternId, UIA_TextControlTypeId,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongPtrW,
        GetWindowThreadProcessId, SendMessageTimeoutW, GUITHREADINFO, GWL_STYLE, OBJID_CLIENT,
        SMTO_ABORTIFHUNG, SMTO_BLOCK, STATE_SYSTEM_PROTECTED, WM_GETOBJECT,
    };

    const ES_MULTILINE: isize = 0x0004;
    const ES_PASSWORD: isize = 0x0020;
    const EM_GETPASSWORDCHAR: u32 = 0x00D2;
    const MAX_PASSWORD_BOX_HEIGHT_PX: i32 = 140;
    const MAX_SEMANTIC_PASSWORD_BOX_HEIGHT_PX: i32 = 100;
    const STATE_SYSTEM_READONLY: u32 = 0x0000_0040;
    const ROLE_SYSTEM_CLIENT: i32 = 0x0A;
    const ROLE_SYSTEM_STATICTEXT: i32 = 0x29;
    const ROLE_SYSTEM_TEXT: i32 = 0x2A;
    const CHROMIUM_WAKE_COOLDOWN: Duration = Duration::from_secs(3);

    pub(super) fn is_plausible_password_rect(top: i32, bottom: i32) -> bool {
        let h = bottom.saturating_sub(top);
        // Real visible single-line password boxes are always between 8px and 140px tall.
        // Reject both empty/unimplemented (0px) MSAA/UIA proxies and tall document editors
        // (e.g. WPS Word / Word / Notepad canvases at 300-1000px).
        (8..=MAX_PASSWORD_BOX_HEIGHT_PX).contains(&h)
    }

    pub(super) fn is_classic_edit_class(class_name: &str) -> bool {
        let lower = class_name.to_ascii_lowercase();
        lower == "edit"
            || lower.starts_with("richedit")
            || lower == "tedit"
            || lower == "tmaskedit"
            || lower == "wedit"
            || (lower.starts_with("thunder") && lower.contains("textbox"))
    }

    pub(super) fn is_possible_custom_edit_class(class_name: &str) -> bool {
        if is_classic_edit_class(class_name) {
            return true;
        }
        let lower = class_name.to_ascii_lowercase();
        if lower.contains("treeview")
            || lower.contains("listview")
            || lower.contains("tabcontrol")
            || lower.contains("combobox")
            || lower.contains("scrollbar")
            || lower.contains("toolbar")
            || lower.contains("statusbar")
            || lower.contains("button")
        {
            return false;
        }
        lower.contains("edit")
            || lower.contains("pwd")
            || lower.contains("pass")
            || lower.contains("textbox")
            || lower.contains("textinput")
            || lower.contains("safeinput")
    }

    pub(super) fn is_chromium_or_embedded_web_class(class_name: &str) -> bool {
        let lower = class_name.to_ascii_lowercase();
        lower == "chrome_renderwidgethosthwnd"
            || lower.starts_with("chrome_widgetwin")
            || lower == "cefbrowserwindow"
            || lower == "internet explorer_server"
            || lower == "intermediate d3d window"
    }

    struct Win32FocusSnapshot {
        fg: windows_sys::Win32::Foundation::HWND,
        hwnd_focus: windows_sys::Win32::Foundation::HWND,
        cls_name: String,
        is_classic_password: bool,
    }

    fn inspect_win32_focus() -> Option<Win32FocusSnapshot> {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return None;
            }
            let tid = GetWindowThreadProcessId(fg, std::ptr::null_mut());
            if tid == 0 {
                return None;
            }
            let mut info: GUITHREADINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            if GetGUIThreadInfo(tid, &mut info) == 0 {
                return Some(Win32FocusSnapshot {
                    fg,
                    hwnd_focus: std::ptr::null_mut(),
                    cls_name: String::new(),
                    is_classic_password: false,
                });
            }
            let hwnd_focus = info.hwndFocus;
            if hwnd_focus.is_null() {
                return Some(Win32FocusSnapshot {
                    fg,
                    hwnd_focus,
                    cls_name: String::new(),
                    is_classic_password: false,
                });
            }

            let mut cls_buf = [0u16; 128];
            let cls_len = GetClassNameW(hwnd_focus, cls_buf.as_mut_ptr(), cls_buf.len() as i32);
            let cls_name = if cls_len > 0 {
                String::from_utf16_lossy(&cls_buf[..cls_len as usize])
            } else {
                String::new()
            };

            let style = GetWindowLongPtrW(hwnd_focus, GWL_STYLE);
            let is_multiline = (style & ES_MULTILINE) != 0;

            // ES_PASSWORD (0x0020) is ONLY valid on Edit / RichEdit window classes!
            // On other Win32 controls (e.g. SysTreeView32 TVS_SHOWSELALWAYS, SysTabControl32
            // TCS_FORCELABELLEFT, Explorer/WPS widgets), bit 0x0020 has an unrelated meaning
            // and would falsely lock KuroCat in closed-eyes password mode.
            let mut is_classic_password =
                is_classic_edit_class(&cls_name) && (style & ES_PASSWORD) != 0 && !is_multiline;

            // Also probe EM_GETPASSWORDCHAR on custom security edit subclasses (e.g. SafeEdit /
            // financial password widgets) that set a dynamic mask character without ES_PASSWORD.
            if !is_classic_password && !is_multiline && is_possible_custom_edit_class(&cls_name) {
                let mut mask_char: usize = 0;
                let ok = SendMessageTimeoutW(
                    hwnd_focus,
                    EM_GETPASSWORDCHAR,
                    0,
                    0,
                    SMTO_ABORTIFHUNG | SMTO_BLOCK,
                    30,
                    &mut mask_char,
                );
                if ok != 0 && (0x21..=0xFFFF).contains(&mask_char) {
                    is_classic_password = true;
                }
            }

            Some(Win32FocusSnapshot {
                fg,
                hwnd_focus,
                cls_name,
                is_classic_password,
            })
        }
    }

    pub struct UiaDetector {
        uia: IUIAutomation,
        has_focus_cond: Option<IUIAutomationCondition>,
        last_woken_hwnd: Option<(isize, Instant)>,
        com_inited: bool,
    }

    impl UiaDetector {
        pub fn new() -> Option<Self> {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                let com_inited = hr.is_ok();
                let uia: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                let has_focus_cond = uia
                    .CreatePropertyCondition(UIA_HasKeyboardFocusPropertyId, &VARIANT::from(true))
                    .ok();
                Some(Self {
                    uia,
                    has_focus_cond,
                    last_woken_hwnd: None,
                    com_inited,
                })
            }
        }

        fn maybe_wake_embedded_accessibility(
            &mut self,
            hwnd_focus: windows_sys::Win32::Foundation::HWND,
            cls_name: &str,
        ) -> bool {
            if hwnd_focus.is_null() || !is_chromium_or_embedded_web_class(cls_name) {
                return false;
            }
            let key = hwnd_focus as isize;
            if let Some((prev, at)) = self.last_woken_hwnd {
                if prev == key && at.elapsed() < CHROMIUM_WAKE_COOLDOWN {
                    return false;
                }
            }
            self.last_woken_hwnd = Some((key, Instant::now()));
            unsafe {
                let mut result: usize = 0;
                // Trigger lazy Blink/CEF accessibility activation on Chrome_RenderWidgetHostHWND
                // when hosted inside WPF (e.g. 同花顺远航版 CefSharp), where WPF's HwndHost UIA
                // bridge often fails to forward WM_GETOBJECT to the embedded Chromium child HWND.
                let _ = SendMessageTimeoutW(
                    hwnd_focus,
                    WM_GETOBJECT,
                    0,
                    OBJID_CLIENT as isize,
                    SMTO_ABORTIFHUNG,
                    40,
                    &mut result,
                );
            }
            true
        }

        unsafe fn element_is_password(el: &IUIAutomationElement) -> bool {
            let Ok(ctrl_type) = el.CurrentControlType() else {
                return false;
            };
            // Guard against buggy third-party UIA/MSAA providers (e.g. WPS Office on Windows 7)
            // that falsely report IsPassword=TRUE on Document/Pane editor surfaces: only allow
            // Edit / Custom / Text leaf inputs with plausible single-line height (8..=140px).
            let is_edit = ctrl_type == UIA_EditControlTypeId;
            if !is_edit
                && ctrl_type != UIA_CustomControlTypeId
                && ctrl_type != UIA_TextControlTypeId
            {
                return false;
            }

            let Ok(rc) = el.CurrentBoundingRectangle() else {
                return false;
            };
            if !is_plausible_password_rect(rc.top, rc.bottom) {
                return false;
            }

            if el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false) {
                return true;
            }

            let legacy = el
                .GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
                    UIA_LegacyIAccessiblePatternId,
                )
                .ok();
            let legacy_state = legacy
                .as_ref()
                .and_then(|pat| pat.CurrentState().ok())
                .unwrap_or(0);
            if (legacy_state & STATE_SYSTEM_PROTECTED) != 0 {
                return true;
            }

            // Semantic fallback ONLY for editable single-line Edit controls (<=100px tall, not
            // read-only) whose own accessible Name / AutomationId / HelpText explicitly marks them
            // as a password input (covers JS-masked `<input type="text">` boxes in financial apps).
            let height = rc.bottom.saturating_sub(rc.top);
            if is_edit
                && height <= MAX_SEMANTIC_PASSWORD_BOX_HEIGHT_PX
                && (legacy_state & STATE_SYSTEM_READONLY) == 0
            {
                let mut candidates: Vec<String> = Vec::with_capacity(5);
                if let Ok(s) = el.CurrentName() {
                    candidates.push(s.to_string());
                }
                if let Ok(s) = el.CurrentAutomationId() {
                    candidates.push(s.to_string());
                }
                if let Ok(s) = el.CurrentHelpText() {
                    candidates.push(s.to_string());
                }
                if let Some(pat) = legacy.as_ref() {
                    if let Ok(s) = pat.CurrentName() {
                        candidates.push(s.to_string());
                    }
                    if let Ok(s) = pat.CurrentDescription() {
                        candidates.push(s.to_string());
                    }
                }
                if candidates
                    .iter()
                    .any(|label| looks_like_password_field_label(label))
                {
                    return true;
                }
            }

            false
        }

        fn focused_is_password(&mut self, focus: Option<&Win32FocusSnapshot>) -> bool {
            unsafe {
                if let Ok(el) = self.uia.GetFocusedElement() {
                    if Self::element_is_password(&el) {
                        return true;
                    }
                }

                let Some(snap) = focus else {
                    return false;
                };
                if snap.hwnd_focus.is_null() {
                    return false;
                }

                let is_embedded = is_chromium_or_embedded_web_class(&snap.cls_name);
                let woke_now = self.maybe_wake_embedded_accessibility(snap.hwnd_focus, &snap.cls_name);
                if woke_now {
                    if let Ok(el) = self.uia.GetFocusedElement() {
                        if Self::element_is_password(&el) {
                            return true;
                        }
                    }
                }

                // Cross WPF HwndHost / CefSharp boundary by probing the focused child HWND directly.
                if snap.hwnd_focus != snap.fg || is_embedded {
                    if let Ok(root_el) = self.uia.ElementFromHandle(HWND(snap.hwnd_focus)) {
                        if Self::element_is_password(&root_el) {
                            return true;
                        }
                        if let Some(cond) = self.has_focus_cond.as_ref() {
                            if let Ok(desc_el) = root_el.FindFirst(TreeScope_Subtree, cond) {
                                if Self::element_is_password(&desc_el) {
                                    return true;
                                }
                            }
                        }
                    }
                }

                false
            }
        }
    }

    impl Drop for UiaDetector {
        fn drop(&mut self) {
            if self.com_inited {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    /// Direct MSAA (`IAccessible`) fallback for older CefSharp/CEF (pre-Chromium 126 UIA) and
    /// WPF-hosted embedded web login views where UIA focus does not cross the HwndHost boundary.
    fn msaa_hwnd_focused_is_password(hwnd_focus: windows_sys::Win32::Foundation::HWND) -> bool {
        if hwnd_focus.is_null() {
            return false;
        }
        unsafe {
            let mut raw_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
            if AccessibleObjectFromWindow(
                HWND(hwnd_focus),
                OBJID_CLIENT as u32,
                &IAccessible::IID,
                &mut raw_ptr,
            )
            .is_err()
                || raw_ptr.is_null()
            {
                return false;
            }
            let mut cur: IAccessible = IAccessible::from_raw(raw_ptr);
            let mut child_id: i32 = 0; // CHILDID_SELF

            // Descend through nested IAccessible focus objects (e.g. Document -> Form -> Input).
            for _ in 0..6 {
                let Ok(focus_var) = cur.accFocus() else {
                    break;
                };
                if let Ok(unk) = IUnknown::try_from(&focus_var) {
                    if let Ok(next_acc) = unk.cast::<IAccessible>() {
                        if next_acc.as_raw() == cur.as_raw() {
                            child_id = 0;
                            break;
                        }
                        cur = next_acc;
                        child_id = 0;
                        continue;
                    }
                    break;
                }
                if let Ok(id) = i32::try_from(&focus_var) {
                    child_id = id;
                }
                break;
            }

            let child_var = VARIANT::from(child_id);
            let role = cur
                .get_accRole(&child_var)
                .ok()
                .and_then(|v| i32::try_from(&v).ok())
                .unwrap_or(0);
            if !matches!(role, ROLE_SYSTEM_TEXT | ROLE_SYSTEM_CLIENT | ROLE_SYSTEM_STATICTEXT) {
                return false;
            }

            let (mut x, mut y, mut w, mut h) = (0i32, 0i32, 0i32, 0i32);
            if cur
                .accLocation(&mut x, &mut y, &mut w, &mut h, &child_var)
                .is_err()
            {
                return false;
            }
            if !is_plausible_password_rect(y, y.saturating_add(h)) {
                return false;
            }

            let state = cur
                .get_accState(&child_var)
                .ok()
                .and_then(|v| i32::try_from(&v).ok())
                .unwrap_or(0) as u32;
            if (state & STATE_SYSTEM_PROTECTED) != 0 {
                return true;
            }

            if role == ROLE_SYSTEM_TEXT
                && h <= MAX_SEMANTIC_PASSWORD_BOX_HEIGHT_PX
                && (state & STATE_SYSTEM_READONLY) == 0
            {
                if let Ok(name) = cur.get_accName(&child_var) {
                    if looks_like_password_field_label(&name.to_string()) {
                        return true;
                    }
                }
            }

            false
        }
    }

    pub fn is_focused_password_field(uia: Option<&mut UiaDetector>) -> bool {
        let snap = inspect_win32_focus();
        if let Some(ref s) = snap {
            if s.is_classic_password {
                return true;
            }
        }
        if let Some(det) = uia {
            if det.focused_is_password(snap.as_ref()) {
                return true;
            }
        }
        if let Some(ref s) = snap {
            if !s.hwnd_focus.is_null()
                && (s.hwnd_focus != s.fg
                    || is_chromium_or_embedded_web_class(&s.cls_name)
                    || is_possible_custom_edit_class(&s.cls_name))
                && msaa_hwnd_focused_is_password(s.hwnd_focus)
            {
                return true;
            }
        }
        false
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::looks_like_password_field_label;
    use std::ffi::c_void;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_rep: u8,
        ) -> *mut c_void;
        fn CFStringGetCString(
            the_string: *const c_void,
            buffer: *mut u8,
            buffer_size: isize,
            encoding: u32,
        ) -> u8;
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFEqual(cf1: *const c_void, cf2: *const c_void) -> u8;
    }

    unsafe fn make_cf_string(s: &str) -> *mut c_void {
        CFStringCreateWithBytes(
            std::ptr::null(),
            s.as_ptr(),
            s.len() as isize,
            K_CF_STRING_ENCODING_UTF8,
            0,
        )
    }

    unsafe fn ax_copy_string_attr(element: *mut c_void, attr_name: &str) -> Option<String> {
        let attr = make_cf_string(attr_name);
        if attr.is_null() {
            return None;
        }
        let mut val: *mut c_void = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(element, attr, &mut val);
        CFRelease(attr);
        if err != 0 || val.is_null() {
            return None;
        }
        let out = if CFGetTypeID(val) == CFStringGetTypeID() {
            let mut buf = [0u8; 512];
            if CFStringGetCString(val, buf.as_mut_ptr(), buf.len() as isize, K_CF_STRING_ENCODING_UTF8) != 0 {
                let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                std::str::from_utf8(&buf[..len]).ok().map(|s| s.to_string())
            } else {
                None
            }
        } else {
            None
        };
        CFRelease(val);
        out
    }

    unsafe fn ax_focused_is_secure_text_field() -> bool {
        if !AXIsProcessTrusted() {
            return false;
        }
        let sys_wide = AXUIElementCreateSystemWide();
        if sys_wide.is_null() {
            return false;
        }
        let attr_focused = make_cf_string("AXFocusedUIElement");
        let attr_subrole = make_cf_string("AXSubrole");
        let secure_subrole = make_cf_string("AXSecureTextField");

        let mut is_secure = false;
        if !attr_focused.is_null() && !attr_subrole.is_null() && !secure_subrole.is_null() {
            let mut focused: *mut c_void = std::ptr::null_mut();
            let err1 = AXUIElementCopyAttributeValue(sys_wide, attr_focused, &mut focused);
            if err1 == 0 && !focused.is_null() {
                let mut subrole: *mut c_void = std::ptr::null_mut();
                let err2 = AXUIElementCopyAttributeValue(focused, attr_subrole, &mut subrole);
                if err2 == 0 && !subrole.is_null() {
                    if CFGetTypeID(subrole) == CFStringGetTypeID()
                        && CFEqual(subrole, secure_subrole) != 0
                    {
                        is_secure = true;
                    }
                    CFRelease(subrole);
                }

                // Fallback for Electron / Chromium / CEF / financial login forms on macOS (#80)
                // that expose an `AXTextField` without `AXSecureTextField` or SecureEventInput.
                if !is_secure {
                    if let Some(role) = ax_copy_string_attr(focused, "AXRole") {
                        if role == "AXTextField" || role == "AXComboBox" {
                            if let Some(role_desc) = ax_copy_string_attr(focused, "AXRoleDescription") {
                                let lower = role_desc.to_ascii_lowercase();
                                if lower.contains("secure")
                                    || role_desc.contains("安全")
                                    || role_desc.contains("密码")
                                    || role_desc.contains("密碼")
                                {
                                    is_secure = true;
                                }
                            }
                            if !is_secure && role == "AXTextField" {
                                for attr in ["AXDescription", "AXPlaceholderValue", "AXTitle"] {
                                    if let Some(label) = ax_copy_string_attr(focused, attr) {
                                        if looks_like_password_field_label(&label) {
                                            is_secure = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                CFRelease(focused);
            }
        }

        if !secure_subrole.is_null() {
            CFRelease(secure_subrole);
        }
        if !attr_subrole.is_null() {
            CFRelease(attr_subrole);
        }
        if !attr_focused.is_null() {
            CFRelease(attr_focused);
        }
        CFRelease(sys_wide);
        is_secure
    }

    pub fn is_focused_password_field() -> bool {
        unsafe {
            if IsSecureEventInputEnabled() != 0 {
                return true;
            }
            ax_focused_is_secure_text_field()
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_password_detector_initializes_and_probes_safely() {
        let mut det = super::win_impl::UiaDetector::new();
        assert!(det.is_some(), "CUIAutomation COM object should initialize cleanly on Windows");
        let _ = super::win_impl::is_focused_password_field(det.as_mut());
    }

    #[cfg(windows)]
    #[test]
    fn classic_edit_class_filter_rejects_non_edit_win32_controls() {
        assert!(super::win_impl::is_classic_edit_class("Edit"));
        assert!(super::win_impl::is_classic_edit_class("RICHEDIT50W"));
        assert!(super::win_impl::is_classic_edit_class("RichEdit20W"));
        assert!(!super::win_impl::is_classic_edit_class("SysTreeView32"));
        assert!(!super::win_impl::is_classic_edit_class("SysListView32"));
        assert!(!super::win_impl::is_classic_edit_class("SysTabControl32"));
        assert!(!super::win_impl::is_classic_edit_class("DirectUIHWND"));
        assert!(!super::win_impl::is_classic_edit_class("Chrome_RenderWidgetHostHWND"));
        assert!(super::win_impl::is_possible_custom_edit_class("THSPwdEdit"));
        assert!(super::win_impl::is_possible_custom_edit_class("SafeEdit"));
        assert!(!super::win_impl::is_possible_custom_edit_class("SysTreeView32"));
        assert!(super::win_impl::is_chromium_or_embedded_web_class("Chrome_RenderWidgetHostHWND"));
        assert!(super::win_impl::is_chromium_or_embedded_web_class("Chrome_WidgetWin_1"));
        assert!(super::win_impl::is_plausible_password_rect(100, 132)); // 32px real password box
        assert!(super::win_impl::is_plausible_password_rect(100, 180)); // 80px HiDPI password box
        assert!(!super::win_impl::is_plausible_password_rect(0, 0));    // broken empty UIA proxy
        assert!(!super::win_impl::is_plausible_password_rect(100, 720)); // 620px WPS Word document
    }

    #[test]
    fn semantic_password_label_matches_financial_inputs_without_false_positives() {
        // Real password labels (including CefSharp / Electron / 同花顺 financial login screens)
        assert!(super::looks_like_password_field_label("密码"));
        assert!(super::looks_like_password_field_label("请输入登录密码"));
        assert!(super::looks_like_password_field_label("交易密码"));
        assert!(super::looks_like_password_field_label("资金密码"));
        assert!(super::looks_like_password_field_label("Password"));
        assert!(super::looks_like_password_field_label("loginPassword"));
        assert!(super::looks_like_password_field_label("trade_pwd"));
        assert!(super::looks_like_password_field_label("Enter passcode"));
        assert!(super::looks_like_password_field_label("PIN"));

        // Must NEVER false-positive on search bars, omniboxes, accounts, OTP, or normal prose
        assert!(!super::looks_like_password_field_label(""));
        assert!(!super::looks_like_password_field_label("地址和搜索栏"));
        assert!(!super::looks_like_password_field_label("Address and search bar"));
        assert!(!super::looks_like_password_field_label("搜索密码管理器"));
        assert!(!super::looks_like_password_field_label("请输入账号或手机号"));
        assert!(!super::looks_like_password_field_label("请输入验证码"));
        assert!(!super::looks_like_password_field_label("Username"));
        assert!(!super::looks_like_password_field_label("Shipping address"));
        assert!(!super::looks_like_password_field_label("spinner"));
        assert!(!super::looks_like_password_field_label("Search password"));
        assert!(!super::looks_like_password_field_label(
            "这是一段超过六十四个字符的非常长的普通文档内容，哪怕里面提到了密码两个字也绝对不能被误判为密码输入框以免正文编辑闭眼"
        ));
    }
}
