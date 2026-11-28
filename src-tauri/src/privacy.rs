use crate::config::AppSettings;
use crate::input_hook;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Starts a lightweight background watcher that detects when the OS focus is inside a
/// password field (Windows UI Automation `IsPassword` + Win32 `ES_PASSWORD`; macOS native
/// `IsSecureEventInputEnabled` + `AXSecureTextField`; Linux passive AT-SPI2 D-Bus focus
/// events + native polkit/pinentry/gcr auth prompt detection), immediately suppressing
/// keystroke forwarding in `input_hook` and notifying the frontend to close/cover eyes.
pub fn start_password_privacy_watcher(
    app: AppHandle,
    settings: Arc<Mutex<AppSettings>>,
    paused_guard: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        #[cfg(windows)]
        let mut uia = win_impl::UiaDetector::new();
        #[cfg(target_os = "macos")]
        let mut mac_ax = mac_impl::MacAxGuard::new();

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
            let is_pwd = mac_impl::is_focused_password_field(&mut mac_ax);
            #[cfg(target_os = "linux")]
            let is_pwd = linux_impl::is_focused_password_field();
            #[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
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

#[cfg(any(windows, target_os = "macos", test))]
const MAX_SLOW_BREAKER_PIDS: usize = 64;
#[cfg(any(windows, target_os = "macos", test))]
const UIA_SLOW_STRIKE_MS: u64 = 22;
#[cfg(any(windows, target_os = "macos", test))]
const UIA_HARD_STALL_MS: u64 = 55;
#[cfg(any(windows, target_os = "macos", test))]
const UIA_BREAKER_FIRST_COOLDOWN: Duration = Duration::from_secs(300);
#[cfg(any(windows, target_os = "macos", test))]
const UIA_BREAKER_REPEAT_COOLDOWN: Duration = Duration::from_secs(900);

#[cfg(any(windows, target_os = "macos", test))]
#[derive(Clone, Copy)]
struct SlowPidEntry {
    pid: u32,
    strikes: u8,
    trips: u8,
    cooldown_until: Option<std::time::Instant>,
}

/// Universal adaptive latency circuit breaker shared by Windows UIA and macOS AXUIElement:
/// if cross-process accessibility polling against ANY slow/heavy app stalls (`>= 55ms` once or
/// `>= 22ms` twice in a row), trip AX/UIA off for that PID (5 min -> 15 min) while preserving
/// zero-cost OS checks (`ES_PASSWORD` on Windows, `IsSecureEventInputEnabled` on macOS).
#[cfg(any(windows, target_os = "macos", test))]
pub(crate) struct SlowPidBreaker {
    entries: Vec<SlowPidEntry>,
}

#[cfg(any(windows, target_os = "macos", test))]
impl SlowPidBreaker {
    pub(crate) fn new() -> Self {
        Self {
            entries: Vec::with_capacity(16),
        }
    }

    pub(crate) fn is_tripped(&self, pid: u32, now: std::time::Instant) -> bool {
        if pid == 0 {
            return false;
        }
        self.entries
            .iter()
            .find(|e| e.pid == pid)
            .and_then(|e| e.cooldown_until)
            .map(|until| now < until)
            .unwrap_or(false)
    }

    pub(crate) fn record_sample(
        &mut self,
        pid: u32,
        elapsed: Duration,
        now: std::time::Instant,
    ) -> bool {
        if pid == 0 {
            return false;
        }
        let ms = elapsed.as_millis() as u64;
        if ms < UIA_SLOW_STRIKE_MS {
            if let Some(entry) = self.entries.iter_mut().find(|e| e.pid == pid) {
                entry.strikes = 0;
            }
            return false;
        }

        if let Some(pos) = self.entries.iter().position(|e| e.pid == pid) {
            let entry = &mut self.entries[pos];
            entry.strikes = entry.strikes.saturating_add(1);
            if ms >= UIA_HARD_STALL_MS || entry.strikes >= 2 {
                entry.strikes = 0;
                entry.trips = entry.trips.saturating_add(1);
                let cd = if entry.trips >= 2 {
                    UIA_BREAKER_REPEAT_COOLDOWN
                } else {
                    UIA_BREAKER_FIRST_COOLDOWN
                };
                entry.cooldown_until = Some(now + cd);
                return true;
            }
            return false;
        }

        if self.entries.len() >= MAX_SLOW_BREAKER_PIDS {
            self.entries.remove(0);
        }
        let immediate_trip = ms >= UIA_HARD_STALL_MS;
        self.entries.push(SlowPidEntry {
            pid,
            strikes: if immediate_trip { 0 } else { 1 },
            trips: if immediate_trip { 1 } else { 0 },
            cooldown_until: if immediate_trip {
                Some(now + UIA_BREAKER_FIRST_COOLDOWN)
            } else {
                None
            },
        });
        immediate_trip
    }
}

#[cfg(windows)]
mod win_impl {
    use super::looks_like_password_field_label;
    pub(super) use super::SlowPidBreaker;
    use std::time::{Duration, Instant};
    use windows::core::{IUnknown, Interface, VARIANT};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        AccessibleObjectFromWindow, CUIAutomation, IAccessible, IUIAutomation,
        IUIAutomationElement, IUIAutomationLegacyIAccessiblePattern, UIA_CustomControlTypeId,
        UIA_EditControlTypeId, UIA_GroupControlTypeId, UIA_LegacyIAccessiblePatternId,
        UIA_PaneControlTypeId, UIA_TextControlTypeId, UIA_WindowControlTypeId,
    };
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId,
        SendMessageTimeoutW, GUITHREADINFO, GWL_STYLE, OBJID_CLIENT, SMTO_ABORTIFHUNG, SMTO_BLOCK,
        STATE_SYSTEM_PROTECTED, WM_GETOBJECT,
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
    const SEMANTIC_CACHE_TTL: Duration = Duration::from_millis(1200);
    const EM_PROBE_TTL: Duration = Duration::from_millis(900);
    const EMBEDDED_FALLBACK_TTL_IDLE: Duration = Duration::from_millis(900);
    const EMBEDDED_FALLBACK_TTL_ACTIVE: Duration = Duration::from_millis(450);
    const IDLE_UIA_BACKOFF_TTL: Duration = Duration::from_millis(560);
    const MAX_WOKEN_HWNDS: usize = 32;
    const MAX_EXE_CACHE_PIDS: usize = 32;

    /// Heavy CAD / BIM / EDA / 3D / DCC / game-engine binaries whose single-threaded MFC/WPF/DX
    /// UI loops suffer catastrophic stalls when external tools poll `IUIAutomation::GetFocusedElement()`
    /// (activating WPF `AutomationPeer` trees / `WM_GETOBJECT` storms on AutoCAD, ZWCAD, Revit, etc.).
    /// Native Win32 `ES_PASSWORD` dialogs inside these apps STILL trigger privacy guard at zero cost.
    const UIA_SKIP_EXES: &[&str] = &[
        // CAD / Architecture / BIM
        "acad.exe",
        "acadlt.exe",
        "accoreconsole.exe",
        "zwcad.exe",
        "zwcadm.exe",
        "zw3d.exe",
        "gcad.exe",
        "gstarcad.exe",
        "bricscad.exe",
        "draftsight.exe",
        "nanocad.exe",
        "caxa.exe",
        "caxacad.exe",
        "revit.exe",
        "navisworks.exe",
        "archicad.exe",
        "sketchup.exe",
        "layout.exe",
        "civil3d.exe",
        "tarch.exe",
        "pkpm.exe",
        "yjk.exe",
        "glodon.exe",
        "bimmake.exe",
        "tekla.exe",
        // MCAD / CAE / CAM / EDA
        "sldworks.exe",
        "inventor.exe",
        "ugraf.exe",
        "cnext.exe",
        "catstart.exe",
        "xtop.exe",
        "parametric.exe",
        "creoagent.exe",
        "solidedge.exe",
        "fusion360.exe",
        "rhino.exe",
        "ansys.exe",
        "abaqus.exe",
        "comsol.exe",
        "mastercam.exe",
        "altium.exe",
        "allegro.exe",
        "pads.exe",
        "kicad.exe",
        "pcbnew.exe",
        "eeschema.exe",
        "lceda.exe",
        // 3D / DCC / Painting / Video / Game Engines
        "3dsmax.exe",
        "maya.exe",
        "blender.exe",
        "cinema 4d.exe",
        "houdini.exe",
        "houdinifx.exe",
        "zbrush.exe",
        "substance painter.exe",
        "adobe substance 3d painter.exe",
        "marmoset.exe",
        "photoshop.exe",
        "illustrator.exe",
        "afterfx.exe",
        "premiere pro.exe",
        "adobe premiere pro.exe",
        "resolve.exe",
        "clipstudiopaint.exe",
        "sai.exe",
        "sai2.exe",
        "krita.exe",
        "cubismeditor.exe",
        "unrealeditor.exe",
        "ue4editor.exe",
        "unity.exe",
        "godot.exe",
    ];

    /// Microsoft Office desktop executables (Word / Excel / PowerPoint). Word 2010 and other
    /// Office builds hang or freeze their status bar / document canvas when external processes
    /// send `WM_GETOBJECT` / UIA probes during typing (#118). Native Win32 `ES_PASSWORD` dialogs
    /// (e.g. document encryption password) are checked BEFORE UIA, and embedded Chromium/WebView2
    /// sign-in popups inside Office 365 are still inspected when focused.
    const OFFICE_UIA_SKIP_EXES: &[&str] = &["winword.exe", "excel.exe", "powerpnt.exe"];

    pub(super) fn is_office_exe(exe_path_or_name: &str) -> bool {
        let lower = exe_path_or_name.trim().replace('/', "\\").to_ascii_lowercase();
        let exe_name = lower.rsplit('\\').next().unwrap_or("");
        !exe_name.is_empty() && OFFICE_UIA_SKIP_EXES.contains(&exe_name)
    }

    pub(super) fn should_skip_uia_for_exe(exe_path_or_name: &str) -> bool {
        let lower = exe_path_or_name.trim().replace('/', "\\").to_ascii_lowercase();
        let exe_name = lower.rsplit('\\').next().unwrap_or("");
        if exe_name.is_empty() {
            return false;
        }
        UIA_SKIP_EXES.contains(&exe_name)
    }

    /// Document & CAD viewport HWND classes that NEVER contain web/custom password fields
    /// (e.g. Word 2010/Office `_WwG`/`_WwF`/`_WwB`/`_WwN`/`_WwC`/`OpusApp`/`NetUIHWND`,
    /// Excel `EXCEL7`/`XLMAIN`, PowerPoint `paneClassDC`/`PPTFrameClass`, AutoCAD/MFC
    /// viewports `AfxFrameOrView*` / `AcApDocWindow`, Scintilla editors). Embedded login popups
    /// inside Office use separate `Edit` / `Chrome_RenderWidgetHostHWND` HWNDs and still work!
    pub(super) fn is_known_document_canvas_class(class_name: &str) -> bool {
        let lower = class_name.to_ascii_lowercase();
        lower == "_wwg"
            || lower == "_wwf"
            || lower == "_wwb"
            || lower == "_wwn"
            || lower == "_wwc"
            || lower == "opusapp"
            || lower == "netuihwnd"
            || lower == "msocommandbar"
            || lower == "excel7"
            || lower == "xlmain"
            || lower == "paneclassdc"
            || lower == "pptframeclass"
            || lower == "mdiclass"
            || lower == "scintilla"
            || lower == "acapdocwindow"
            || lower.starts_with("afxframeorview")
            || lower.starts_with("afxmdiframe")
    }

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

    /// Pure decision gate preventing catastrophic cross-process UIA/MSAA/WM_GETOBJECT spam on
    /// regular Chromium/Electron apps (Chrome, Edge, VS Code, QQ NT, WeChat, Doubao, Cursor).
    ///
    /// Embedded fallback (single-shot wake + throttled MSAA `accFocus` descent) is ONLY needed
    /// when focus lives inside an embedded child HWND (`hwnd_focus != fg`, e.g. WPF `HwndHost`
    /// wrapping CefSharp in financial apps like 同花顺远航版) AND UIA `GetFocusedElement()` failed
    /// to cross into that child control.
    pub(super) fn should_run_embedded_hwnd_fallback(
        fg_is_same_as_focus: bool,
        uia_resolved_inside_focus: bool,
        cls_name: &str,
    ) -> bool {
        if fg_is_same_as_focus || uia_resolved_inside_focus {
            return false;
        }
        is_chromium_or_embedded_web_class(cls_name) || is_possible_custom_edit_class(cls_name)
    }

    struct Win32FocusSnapshot {
        fg: windows_sys::Win32::Foundation::HWND,
        fg_pid: u32,
        hwnd_focus: windows_sys::Win32::Foundation::HWND,
        cls_name: String,
        is_classic_password: bool,
        is_multiline_classic_edit: bool,
        needs_em_probe: bool,
    }

    fn inspect_win32_focus() -> Option<Win32FocusSnapshot> {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return None;
            }
            let mut fg_pid: u32 = 0;
            let tid = GetWindowThreadProcessId(fg, &mut fg_pid);
            if tid == 0 {
                return None;
            }
            let mut info: GUITHREADINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
            if GetGUIThreadInfo(tid, &mut info) == 0 {
                return Some(Win32FocusSnapshot {
                    fg,
                    fg_pid,
                    hwnd_focus: std::ptr::null_mut(),
                    cls_name: String::new(),
                    is_classic_password: false,
                    is_multiline_classic_edit: false,
                    needs_em_probe: false,
                });
            }
            let hwnd_focus = info.hwndFocus;
            if hwnd_focus.is_null() {
                return Some(Win32FocusSnapshot {
                    fg,
                    fg_pid,
                    hwnd_focus,
                    cls_name: String::new(),
                    is_classic_password: false,
                    is_multiline_classic_edit: false,
                    needs_em_probe: false,
                });
            }

            let mut cls_buf = [0u16; 128];
            let cls_len = GetClassNameW(hwnd_focus, cls_buf.as_mut_ptr(), cls_buf.len() as i32);
            let cls_name = if cls_len > 0 {
                String::from_utf16_lossy(&cls_buf[..cls_len as usize])
            } else {
                String::new()
            };

            let style = crate::win_get_window_long_ptr_w(hwnd_focus, GWL_STYLE);
            let is_multiline = (style & ES_MULTILINE) != 0;
            let is_classic = is_classic_edit_class(&cls_name);

            // ES_PASSWORD (0x0020) is ONLY valid on Edit / RichEdit window classes!
            // On other Win32 controls (e.g. SysTreeView32 TVS_SHOWSELALWAYS, SysTabControl32
            // TCS_FORCELABELLEFT, Explorer/WPS widgets), bit 0x0020 has an unrelated meaning
            // and would falsely lock KuroCat in closed-eyes password mode.
            let is_classic_password = is_classic && (style & ES_PASSWORD) != 0 && !is_multiline;
            let is_multiline_classic_edit = is_classic && is_multiline;

            let needs_em_probe =
                !is_classic_password && !is_multiline && is_possible_custom_edit_class(&cls_name);

            Some(Win32FocusSnapshot {
                fg,
                fg_pid,
                hwnd_focus,
                cls_name,
                is_classic_password,
                is_multiline_classic_edit,
                needs_em_probe,
            })
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    struct SemanticCacheKey {
        hwnd_focus: isize,
        ctrl_type: i32,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    pub struct UiaDetector {
        uia: IUIAutomation,
        woken_hwnds: Vec<isize>,
        exe_cache: Vec<(u32, String)>,
        slow_breaker: SlowPidBreaker,
        last_idle_uia: Option<((isize, isize), Instant, bool)>,
        last_em_probe: Option<(isize, Instant, bool)>,
        last_semantic: Option<(SemanticCacheKey, Instant, bool)>,
        last_embedded_fallback: Option<((isize, isize), Instant, bool)>,
        com_inited: bool,
    }

    impl UiaDetector {
        pub fn new() -> Option<Self> {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                let com_inited = hr.is_ok();
                let uia: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                Some(Self {
                    uia,
                    woken_hwnds: Vec::with_capacity(MAX_WOKEN_HWNDS),
                    exe_cache: Vec::with_capacity(MAX_EXE_CACHE_PIDS),
                    slow_breaker: SlowPidBreaker::new(),
                    last_idle_uia: None,
                    last_em_probe: None,
                    last_semantic: None,
                    last_embedded_fallback: None,
                    com_inited,
                })
            }
        }

        fn resolve_exe_name_cached(&mut self, pid: u32) -> String {
            if pid == 0 {
                return String::new();
            }
            if let Some((_, name)) = self.exe_cache.iter().find(|(p, _)| *p == pid) {
                return name.clone();
            }
            let name = unsafe {
                let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if hproc.is_null() {
                    String::new()
                } else {
                    let mut buf = [0u16; 320];
                    let mut len = buf.len() as u32;
                    let ok = QueryFullProcessImageNameW(hproc, 0, buf.as_mut_ptr(), &mut len);
                    let _ = CloseHandle(hproc);
                    if ok != 0 && len > 0 {
                        let full = String::from_utf16_lossy(&buf[..len as usize]);
                        full.rsplit('\\')
                            .next()
                            .unwrap_or("")
                            .to_ascii_lowercase()
                    } else {
                        String::new()
                    }
                }
            };
            if self.exe_cache.len() >= MAX_EXE_CACHE_PIDS {
                self.exe_cache.remove(0);
            }
            self.exe_cache.push((pid, name.clone()));
            name
        }

        fn probe_em_password_char_cached(
            &mut self,
            hwnd_focus: windows_sys::Win32::Foundation::HWND,
        ) -> bool {
            let key = hwnd_focus as isize;
            if let Some((prev_key, at, cached)) = self.last_em_probe {
                if prev_key == key && at.elapsed() < EM_PROBE_TTL {
                    return cached;
                }
            }
            let mut mask_char: usize = 0;
            let ok = unsafe {
                SendMessageTimeoutW(
                    hwnd_focus,
                    EM_GETPASSWORDCHAR,
                    0,
                    0,
                    SMTO_ABORTIFHUNG | SMTO_BLOCK,
                    30,
                    &mut mask_char,
                )
            };
            let is_pwd = ok != 0 && (0x21..=0xFFFF).contains(&mask_char);
            self.last_em_probe = Some((key, Instant::now(), is_pwd));
            is_pwd
        }

        fn maybe_wake_embedded_accessibility_once(
            &mut self,
            hwnd_focus: windows_sys::Win32::Foundation::HWND,
            cls_name: &str,
        ) -> bool {
            if hwnd_focus.is_null() || !is_chromium_or_embedded_web_class(cls_name) {
                return false;
            }
            let key = hwnd_focus as isize;
            if self.woken_hwnds.contains(&key) {
                return false;
            }
            if self.woken_hwnds.len() >= MAX_WOKEN_HWNDS {
                self.woken_hwnds.remove(0);
            }
            self.woken_hwnds.push(key);
            unsafe {
                let mut result: usize = 0;
                // One-shot lazy Blink/CEF accessibility activation ONLY for un-bridged embedded
                // child HWNDs (e.g. WPF HwndHost wrapping CefSharp in 同花顺远航版).
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

        /// Returns `(is_password, resolved_inside_focus)`.
        unsafe fn inspect_uia_element(
            &mut self,
            el: &IUIAutomationElement,
            hwnd_focus: windows_sys::Win32::Foundation::HWND,
        ) -> (bool, bool) {
            let Ok(ctrl_type) = el.CurrentControlType() else {
                return (false, false);
            };
            let is_outer_container = ctrl_type == UIA_WindowControlTypeId
                || ctrl_type == UIA_PaneControlTypeId
                || ctrl_type == UIA_GroupControlTypeId;
            let resolved_inside_focus = if !is_outer_container {
                true
            } else if !hwnd_focus.is_null() {
                el.CurrentNativeWindowHandle()
                    .map(|h| h.0 as isize == hwnd_focus as isize)
                    .unwrap_or(false)
            } else {
                true
            };

            // Guard against buggy third-party UIA/MSAA providers (e.g. WPS Office on Windows 7)
            // that falsely report IsPassword=TRUE on Document/Pane editor surfaces: only allow
            // Edit / Custom / Text leaf inputs with plausible single-line height (8..=140px).
            let is_edit = ctrl_type == UIA_EditControlTypeId;
            if !is_edit
                && ctrl_type != UIA_CustomControlTypeId
                && ctrl_type != UIA_TextControlTypeId
            {
                return (false, resolved_inside_focus);
            }

            let Ok(rc) = el.CurrentBoundingRectangle() else {
                return (false, resolved_inside_focus);
            };
            if !is_plausible_password_rect(rc.top, rc.bottom) {
                return (false, resolved_inside_focus);
            }

            // Fast native IsPassword check always runs live (handles show/hide eye toggles immediately).
            if el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false) {
                return (true, resolved_inside_focus);
            }

            // Cache the heavier LegacyIAccessible + 5-string semantic COM probes while typing in
            // the exact same control rectangle, so steady typing pays zero extra cross-process BSTR calls.
            let cache_key = SemanticCacheKey {
                hwnd_focus: hwnd_focus as isize,
                ctrl_type: ctrl_type.0,
                left: rc.left,
                top: rc.top,
                right: rc.right,
                bottom: rc.bottom,
            };
            if let Some((prev_key, at, cached_pwd)) = self.last_semantic {
                if prev_key == cache_key && at.elapsed() < SEMANTIC_CACHE_TTL {
                    return (cached_pwd, resolved_inside_focus);
                }
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
                self.last_semantic = Some((cache_key, Instant::now(), true));
                return (true, resolved_inside_focus);
            }

            // Semantic fallback ONLY for editable single-line Edit controls (<=100px tall, not
            // read-only) whose own accessible Name / AutomationId / HelpText explicitly marks them
            // as a password input (covers JS-masked `<input type="text">` boxes in financial apps).
            let height = rc.bottom.saturating_sub(rc.top);
            let mut semantic_match = false;
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
                semantic_match = candidates
                    .iter()
                    .any(|label| looks_like_password_field_label(label));
            }

            self.last_semantic = Some((cache_key, Instant::now(), semantic_match));
            (semantic_match, resolved_inside_focus)
        }

        fn focused_is_password(&mut self, focus: Option<&Win32FocusSnapshot>) -> bool {
            unsafe {
                let hwnd_focus = focus.map(|s| s.hwnd_focus).unwrap_or(std::ptr::null_mut());
                let mut uia_resolved_inside_focus = false;

                if let Ok(el) = self.uia.GetFocusedElement() {
                    let (is_pwd, resolved) = self.inspect_uia_element(&el, hwnd_focus);
                    if is_pwd {
                        return true;
                    }
                    uia_resolved_inside_focus = resolved;
                }

                let Some(snap) = focus else {
                    return false;
                };
                if snap.hwnd_focus.is_null() {
                    return false;
                }

                let fg_is_same = snap.hwnd_focus == snap.fg;
                if !should_run_embedded_hwnd_fallback(
                    fg_is_same,
                    uia_resolved_inside_focus,
                    &snap.cls_name,
                ) {
                    return false;
                }

                // Only reached for un-bridged embedded child HWNDs (e.g. WPF HwndHost + CefSharp).
                // One-shot wake + lightweight O(depth <= 6) MSAA `accFocus` descent (never TreeScope_Subtree!).
                if self.maybe_wake_embedded_accessibility_once(snap.hwnd_focus, &snap.cls_name) {
                    if let Ok(el) = self.uia.GetFocusedElement() {
                        let (is_pwd, _) = self.inspect_uia_element(&el, snap.hwnd_focus);
                        if is_pwd {
                            return true;
                        }
                    }
                }

                let pair = (snap.fg as isize, snap.hwnd_focus as isize);
                if let Some((prev_pair, at, cached)) = self.last_embedded_fallback {
                    let ttl = if cached {
                        EMBEDDED_FALLBACK_TTL_ACTIVE
                    } else {
                        EMBEDDED_FALLBACK_TTL_IDLE
                    };
                    if prev_pair == pair && at.elapsed() < ttl {
                        return cached;
                    }
                }

                let is_pwd = msaa_hwnd_focused_is_password(snap.hwnd_focus);
                self.last_embedded_fallback = Some((pair, Instant::now(), is_pwd));
                is_pwd
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

    pub fn is_focused_password_field(mut uia: Option<&mut UiaDetector>) -> bool {
        let snap = inspect_win32_focus();
        if let Some(ref s) = snap {
            // Fast, zero-IPC Win32 ES_PASSWORD bit check ALWAYS runs first — covers native
            // password dialogs even inside CAD / Office / circuit-broken processes!
            if s.is_classic_password {
                return true;
            }
            if s.fg_pid == std::process::id()
                || s.is_multiline_classic_edit
                || is_known_document_canvas_class(&s.cls_name)
            {
                return false;
            }
        }

        let Some(det) = uia.as_deref_mut() else {
            return false;
        };

        let now = Instant::now();
        let fg_pid = snap.as_ref().map(|s| s.fg_pid).unwrap_or(0);
        let mut is_browser_fg = false;
        if fg_pid != 0 {
            let exe_name = det.resolve_exe_name_cached(fg_pid);
            is_browser_fg = matches!(
                exe_name.as_str(),
                "chrome.exe"
                    | "msedge.exe"
                    | "firefox.exe"
                    | "brave.exe"
                    | "opera.exe"
                    | "vivaldi.exe"
                    | "arc.exe"
                    | "360chrome.exe"
                    | "360se.exe"
                    | "qqbrowser.exe"
                    | "sogouexplorer.exe"
                    | "quark.exe"
                    | "waterfox.exe"
                    | "librewolf.exe"
            );
            let focused_is_embedded_web = snap
                .as_ref()
                .is_some_and(|s| is_chromium_or_embedded_web_class(&s.cls_name));
            if should_skip_uia_for_exe(&exe_name)
                || (is_office_exe(&exe_name) && !focused_is_embedded_web)
                || det.slow_breaker.is_tripped(fg_pid, now)
            {
                return false;
            }
        }

        if let Some(ref s) = snap {
            if s.needs_em_probe && det.probe_em_password_char_cached(s.hwnd_focus) {
                return true;
            }
            // Smart idle backoff: when the same non-password window/control stays focused and the
            // user hasn't clicked or typed in the last 1.2s, throttle UIA from 140ms to 560ms.
            let focus_pair = (s.fg as isize, s.hwnd_focus as isize);
            if let Some((prev_pair, checked_at, prev_pwd)) = det.last_idle_uia {
                if !prev_pwd
                    && prev_pair == focus_pair
                    && now.duration_since(checked_at) < IDLE_UIA_BACKOFF_TTL
                    && !crate::input_hook::has_recent_key_or_click(1200)
                {
                    return false;
                }
            }
        }

        let probe_start = Instant::now();
        let is_pwd = det.focused_is_password(snap.as_ref());
        let elapsed = probe_start.elapsed();
        // Never trip the slow breaker on a confirmed password hit, and give web browsers enough
        // headroom (~220ms) for one-time Chromium/Gecko accessibility tree warm-up.
        if fg_pid != 0 && !is_pwd && (!is_browser_fg || elapsed >= Duration::from_millis(220)) {
            det.slow_breaker.record_sample(fg_pid, elapsed, Instant::now());
        }
        if let Some(ref s) = snap {
            det.last_idle_uia = Some(((s.fg as isize, s.hwnd_focus as isize), Instant::now(), is_pwd));
        }
        is_pwd
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::{looks_like_password_field_label, SlowPidBreaker};
    use objc2::msg_send;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::c_void;
    use std::time::{Duration, Instant};

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const IDLE_AX_BACKOFF_TTL: Duration = Duration::from_millis(700);
    const AX_MESSAGING_TIMEOUT_SECS: f32 = 0.08;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementSetMessagingTimeout(element: *mut c_void, timeout_in_seconds: f32) -> i32;
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

    pub struct MacAxGuard {
        breaker: SlowPidBreaker,
        last_ax: Option<(u32, Instant, bool)>,
    }

    impl MacAxGuard {
        pub fn new() -> Self {
            Self {
                breaker: SlowPidBreaker::new(),
                last_ax: None,
            }
        }
    }

    fn frontmost_pid() -> u32 {
        autoreleasepool(|_| unsafe {
            let Some(cls) = AnyClass::get(c"NSWorkspace") else {
                return 0;
            };
            let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if ws.is_null() {
                return 0;
            }
            let app: *mut AnyObject = msg_send![ws, frontmostApplication];
            if app.is_null() {
                return 0;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            if pid > 0 {
                pid as u32
            } else {
                0
            }
        })
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
        let _ = AXUIElementSetMessagingTimeout(sys_wide, AX_MESSAGING_TIMEOUT_SECS);
        let attr_focused = make_cf_string("AXFocusedUIElement");
        let attr_subrole = make_cf_string("AXSubrole");
        let secure_subrole = make_cf_string("AXSecureTextField");

        let mut is_secure = false;
        if !attr_focused.is_null() && !attr_subrole.is_null() && !secure_subrole.is_null() {
            let mut focused: *mut c_void = std::ptr::null_mut();
            let err1 = AXUIElementCopyAttributeValue(sys_wide, attr_focused, &mut focused);
            if err1 == 0 && !focused.is_null() {
                let _ = AXUIElementSetMessagingTimeout(focused, AX_MESSAGING_TIMEOUT_SECS);
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

    pub fn is_focused_password_field(guard: &mut MacAxGuard) -> bool {
        unsafe {
            // Fast, zero-IPC kernel flag always runs every tick (~140ms)
            if IsSecureEventInputEnabled() != 0 {
                return true;
            }
            if !AXIsProcessTrusted() {
                return false;
            }
            let fg_pid = frontmost_pid();
            // Never hammer KuroCat's own WKWebView/menu process with cross-process AX probes
            if fg_pid == std::process::id() {
                return false;
            }
            let now = Instant::now();
            if guard.breaker.is_tripped(fg_pid, now) {
                return false;
            }
            // Back off cross-process AX IPC while the user is only reading/watching video/moving mouse;
            // the moment any keystroke or mouse click occurs, resume immediate 140ms polling.
            if let Some((prev_pid, checked_at, prev_pwd)) = guard.last_ax {
                if !prev_pwd
                    && prev_pid == fg_pid
                    && now.duration_since(checked_at) < IDLE_AX_BACKOFF_TTL
                    && !crate::input_hook::has_recent_key_or_click(1200)
                {
                    return false;
                }
            }

            let probe_start = Instant::now();
            let is_pwd = ax_focused_is_secure_text_field();
            let elapsed = probe_start.elapsed();
            if fg_pid != 0 && !is_pwd {
                guard.breaker.record_sample(fg_pid, elapsed, Instant::now());
            }
            guard.last_ax = Some((fg_pid, Instant::now(), is_pwd));
            is_pwd
        }
    }
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_atspi_password_role_or_label(role_name: &str, accessible_name: &str) -> bool {
    let role = role_name.trim().to_ascii_lowercase();
    if role == "password text" {
        return true;
    }
    if matches!(role.as_str(), "entry" | "text" | "combo box") {
        return looks_like_password_field_label(accessible_name);
    }
    false
}

/// Strict native Linux authentication / password prompt window classifier (polkit, pinentry,
/// gcr-prompter, ssh-askpass, kwallet unlock) used alongside AT-SPI2 so password prompts are
/// still shielded even on minimal X11 setups where `at-spi2-core` is disabled.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_linux_password_prompt_window(wm_class: &str, wm_name: &str) -> bool {
    let cls = wm_class.trim().to_ascii_lowercase();
    let title = wm_name.trim().to_ascii_lowercase();
    if cls.is_empty() && title.is_empty() {
        return false;
    }
    const PROMPT_CLASSES: &[&str] = &[
        "gcr-prompter",
        "polkit-gnome-authentication-agent",
        "polkit-kde-authentication-agent",
        "polkit-mate-authentication-agent",
        "lxqt-policykit-agent",
        "xfce-polkit",
        "pinentry",
        "ssh-askpass",
        "ksshaskpass",
        "gnome-keyring-prompt",
        "seahorse-prompt",
        "kwalletd",
    ];
    if PROMPT_CLASSES.iter().any(|p| cls.contains(p)) {
        return true;
    }
    // Strict title fallback ONLY for standalone dialog apps (never browsers/terminals/IDEs/chat)
    const NEVER_TITLE_CLASSES: &[&str] = &[
        "firefox",
        "chrome",
        "chromium",
        "brave",
        "edge",
        "vivaldi",
        "code",
        "cursor",
        "kitty",
        "alacritty",
        "konsole",
        "gnome-terminal",
        "xterm",
        "wechat",
        "qq",
        "discord",
        "telegram",
        "slack",
        "kurocat",
    ];
    if NEVER_TITLE_CLASSES.iter().any(|b| cls.contains(b)) {
        return false;
    }
    title == "authentication required"
        || title == "authenticate"
        || title == "unlock keyring"
        || title == "需要身份验证"
        || title == "解锁密钥环"
        || title.starts_with("enter password for")
        || title.starts_with("unlock login keyring")
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::{is_atspi_password_role_or_label, is_linux_password_prompt_window};
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, Once};

    const RTLD_LAZY: c_int = 0x1;
    const RTLD_LOCAL: c_int = 0x0;
    const G_BUS_TYPE_SESSION: c_int = 2;
    const G_DBUS_CONN_AUTH_AND_BUS: u32 = 1 | 2;
    const G_DBUS_CALL_FLAGS_NONE: u32 = 0;
    const G_DBUS_SIGNAL_FLAGS_NONE: u32 = 0;

    extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    type GDBusSignalCallback = unsafe extern "C" fn(
        connection: *mut c_void,
        sender_name: *const c_char,
        object_path: *const c_char,
        interface_name: *const c_char,
        signal_name: *const c_char,
        parameters: *mut c_void,
        user_data: *mut c_void,
    );

    type GMainContextNewFn = unsafe extern "C" fn() -> *mut c_void;
    type GMainContextPushDefaultFn = unsafe extern "C" fn(*mut c_void);
    type GMainLoopNewFn = unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_void;
    type GMainLoopRunFn = unsafe extern "C" fn(*mut c_void);
    type GBusGetSyncFn = unsafe extern "C" fn(c_int, *mut c_void, *mut *mut c_void) -> *mut c_void;
    type GDBusConnForAddrSyncFn = unsafe extern "C" fn(
        *const c_char,
        u32,
        *mut c_void,
        *mut c_void,
        *mut *mut c_void,
    ) -> *mut c_void;
    type GDBusConnCallSyncFn = unsafe extern "C" fn(
        *mut c_void,
        *const c_char,
        *const c_char,
        *const c_char,
        *const c_char,
        *mut c_void,
        *const c_void,
        u32,
        c_int,
        *mut c_void,
        *mut *mut c_void,
    ) -> *mut c_void;
    type GDBusSignalSubscribeFn = unsafe extern "C" fn(
        *mut c_void,
        *const c_char,
        *const c_char,
        *const c_char,
        *const c_char,
        *const c_char,
        u32,
        GDBusSignalCallback,
        *mut c_void,
        *const c_void,
    ) -> u32;
    type GVariantNewStringFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;
    type GVariantNewTupleFn = unsafe extern "C" fn(*const *mut c_void, usize) -> *mut c_void;
    type GVariantNChildrenFn = unsafe extern "C" fn(*mut c_void) -> usize;
    type GVariantGetChildValueFn = unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void;
    type GVariantGetStringFn = unsafe extern "C" fn(*mut c_void, *mut usize) -> *const c_char;
    type GVariantGetInt32Fn = unsafe extern "C" fn(*mut c_void) -> i32;
    type GVariantGetVariantFn = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
    type GVariantIsOfTypeFn = unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int;
    type GVariantUnrefFn = unsafe extern "C" fn(*mut c_void);
    type GObjectUnrefFn = unsafe extern "C" fn(*mut c_void);
    type GErrorFreeFn = unsafe extern "C" fn(*mut c_void);

    struct GioDbusApi {
        main_context_new: GMainContextNewFn,
        main_context_push_default: GMainContextPushDefaultFn,
        main_loop_new: GMainLoopNewFn,
        main_loop_run: GMainLoopRunFn,
        bus_get_sync: GBusGetSyncFn,
        conn_for_address_sync: GDBusConnForAddrSyncFn,
        conn_call_sync: GDBusConnCallSyncFn,
        signal_subscribe: GDBusSignalSubscribeFn,
        variant_new_string: GVariantNewStringFn,
        variant_new_tuple: GVariantNewTupleFn,
        variant_n_children: GVariantNChildrenFn,
        variant_get_child_value: GVariantGetChildValueFn,
        variant_get_string: GVariantGetStringFn,
        variant_get_int32: GVariantGetInt32Fn,
        variant_get_variant: GVariantGetVariantFn,
        variant_is_of_type: GVariantIsOfTypeFn,
        variant_unref: GVariantUnrefFn,
        object_unref: GObjectUnrefFn,
        error_free: GErrorFreeFn,
    }

    static ATSPI_INIT: Once = Once::new();
    static ATSPI_PWD_FOCUSED: AtomicBool = AtomicBool::new(false);
    static ATSPI_LAST_PWD_TARGET: Mutex<Option<(String, String)>> = Mutex::new(None);

    unsafe fn load_sym<T>(libs: &[*mut c_void], name: &'static [u8]) -> Option<T> {
        for &lib in libs {
            if lib.is_null() {
                continue;
            }
            let ptr = dlsym(lib, name.as_ptr() as *const c_char);
            if !ptr.is_null() {
                return Some(std::mem::transmute_copy(&ptr));
            }
        }
        None
    }

    unsafe fn load_gio_dbus_api() -> Option<GioDbusApi> {
        let lib_gio = dlopen(b"libgio-2.0.so.0\0".as_ptr() as *const c_char, RTLD_LAZY | RTLD_LOCAL);
        let lib_glib = dlopen(b"libglib-2.0.so.0\0".as_ptr() as *const c_char, RTLD_LAZY | RTLD_LOCAL);
        let lib_gobj = dlopen(b"libgobject-2.0.so.0\0".as_ptr() as *const c_char, RTLD_LAZY | RTLD_LOCAL);
        let libs = [lib_gio, lib_glib, lib_gobj];
        if lib_gio.is_null() {
            return None;
        }
        Some(GioDbusApi {
            main_context_new: load_sym(&libs, b"g_main_context_new\0")?,
            main_context_push_default: load_sym(&libs, b"g_main_context_push_thread_default\0")?,
            main_loop_new: load_sym(&libs, b"g_main_loop_new\0")?,
            main_loop_run: load_sym(&libs, b"g_main_loop_run\0")?,
            bus_get_sync: load_sym(&libs, b"g_bus_get_sync\0")?,
            conn_for_address_sync: load_sym(&libs, b"g_dbus_connection_new_for_address_sync\0")?,
            conn_call_sync: load_sym(&libs, b"g_dbus_connection_call_sync\0")?,
            signal_subscribe: load_sym(&libs, b"g_dbus_connection_signal_subscribe\0")?,
            variant_new_string: load_sym(&libs, b"g_variant_new_string\0")?,
            variant_new_tuple: load_sym(&libs, b"g_variant_new_tuple\0")?,
            variant_n_children: load_sym(&libs, b"g_variant_n_children\0")?,
            variant_get_child_value: load_sym(&libs, b"g_variant_get_child_value\0")?,
            variant_get_string: load_sym(&libs, b"g_variant_get_string\0")?,
            variant_get_int32: load_sym(&libs, b"g_variant_get_int32\0")?,
            variant_get_variant: load_sym(&libs, b"g_variant_get_variant\0")?,
            variant_is_of_type: load_sym(&libs, b"g_variant_is_of_type\0")?,
            variant_unref: load_sym(&libs, b"g_variant_unref\0")?,
            object_unref: load_sym(&libs, b"g_object_unref\0")?,
            error_free: load_sym(&libs, b"g_error_free\0")?,
        })
    }

    unsafe fn read_gvariant_string(api: &GioDbusApi, val: *mut c_void) -> Option<String> {
        if val.is_null() {
            return None;
        }
        if (api.variant_is_of_type)(val, b"s\0".as_ptr() as *const c_char) == 0 {
            return None;
        }
        let ptr = (api.variant_get_string)(val, std::ptr::null_mut());
        if ptr.is_null() {
            return None;
        }
        Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
    }

    unsafe fn query_atspi_role_name(
        api: &GioDbusApi,
        conn: *mut c_void,
        sender: *const c_char,
        path: *const c_char,
    ) -> Option<String> {
        let mut err: *mut c_void = std::ptr::null_mut();
        let reply = (api.conn_call_sync)(
            conn,
            sender,
            path,
            b"org.a11y.atspi.Accessible\0".as_ptr() as *const c_char,
            b"GetRoleName\0".as_ptr() as *const c_char,
            std::ptr::null_mut(),
            std::ptr::null(),
            G_DBUS_CALL_FLAGS_NONE,
            80,
            std::ptr::null_mut(),
            &mut err,
        );
        if !err.is_null() {
            (api.error_free)(err);
        }
        if reply.is_null() {
            return None;
        }
        let out = if (api.variant_n_children)(reply) >= 1 {
            let child = (api.variant_get_child_value)(reply, 0);
            let s = read_gvariant_string(api, child);
            if !child.is_null() {
                (api.variant_unref)(child);
            }
            s
        } else {
            None
        };
        (api.variant_unref)(reply);
        out
    }

    unsafe fn query_atspi_accessible_name(
        api: &GioDbusApi,
        conn: *mut c_void,
        sender: *const c_char,
        path: *const c_char,
    ) -> Option<String> {
        let iface = (api.variant_new_string)(
            b"org.a11y.atspi.Accessible\0".as_ptr() as *const c_char,
        );
        let prop = (api.variant_new_string)(b"Name\0".as_ptr() as *const c_char);
        let items = [iface, prop];
        let params = (api.variant_new_tuple)(items.as_ptr(), 2);
        let mut err: *mut c_void = std::ptr::null_mut();
        let reply = (api.conn_call_sync)(
            conn,
            sender,
            path,
            b"org.freedesktop.DBus.Properties\0".as_ptr() as *const c_char,
            b"Get\0".as_ptr() as *const c_char,
            params,
            std::ptr::null(),
            G_DBUS_CALL_FLAGS_NONE,
            80,
            std::ptr::null_mut(),
            &mut err,
        );
        if !err.is_null() {
            (api.error_free)(err);
        }
        if reply.is_null() {
            return None;
        }
        let out = if (api.variant_n_children)(reply) >= 1 {
            let v_wrap = (api.variant_get_child_value)(reply, 0);
            let s = if !v_wrap.is_null()
                && (api.variant_is_of_type)(v_wrap, b"v\0".as_ptr() as *const c_char) != 0
            {
                let inner = (api.variant_get_variant)(v_wrap);
                let text = read_gvariant_string(api, inner);
                if !inner.is_null() {
                    (api.variant_unref)(inner);
                }
                text
            } else {
                read_gvariant_string(api, v_wrap)
            };
            if !v_wrap.is_null() {
                (api.variant_unref)(v_wrap);
            }
            s
        } else {
            None
        };
        (api.variant_unref)(reply);
        out
    }

    unsafe extern "C" fn on_atspi_state_changed(
        conn: *mut c_void,
        sender_name: *const c_char,
        object_path: *const c_char,
        _interface_name: *const c_char,
        _signal_name: *const c_char,
        parameters: *mut c_void,
        user_data: *mut c_void,
    ) {
        if conn.is_null()
            || sender_name.is_null()
            || object_path.is_null()
            || parameters.is_null()
            || user_data.is_null()
        {
            return;
        }
        let api = &*(user_data as *const GioDbusApi);
        if (api.variant_n_children)(parameters) < 2 {
            return;
        }
        let c0 = (api.variant_get_child_value)(parameters, 0);
        let detail_name = read_gvariant_string(api, c0);
        if !c0.is_null() {
            (api.variant_unref)(c0);
        }
        if detail_name.as_deref() != Some("focused") {
            return;
        }
        let c1 = (api.variant_get_child_value)(parameters, 1);
        let focused = if !c1.is_null()
            && (api.variant_is_of_type)(c1, b"i\0".as_ptr() as *const c_char) != 0
        {
            (api.variant_get_int32)(c1) != 0
        } else {
            false
        };
        if !c1.is_null() {
            (api.variant_unref)(c1);
        }

        let sender_str = CStr::from_ptr(sender_name).to_string_lossy().into_owned();
        let path_str = CStr::from_ptr(object_path).to_string_lossy().into_owned();

        if !focused {
            if let Ok(mut guard) = ATSPI_LAST_PWD_TARGET.lock() {
                if guard.as_ref().is_some_and(|(s, p)| s == &sender_str && p == &path_str) {
                    *guard = None;
                    ATSPI_PWD_FOCUSED.store(false, Ordering::Relaxed);
                }
            }
            return;
        }

        let role = query_atspi_role_name(api, conn, sender_name, object_path).unwrap_or_default();
        let is_pwd = if is_atspi_password_role_or_label(&role, "") {
            true
        } else if matches!(
            role.trim().to_ascii_lowercase().as_str(),
            "entry" | "text" | "combo box"
        ) {
            let name = query_atspi_accessible_name(api, conn, sender_name, object_path)
                .unwrap_or_default();
            is_atspi_password_role_or_label(&role, &name)
        } else {
            false
        };

        if let Ok(mut guard) = ATSPI_LAST_PWD_TARGET.lock() {
            if is_pwd {
                *guard = Some((sender_str, path_str));
            } else {
                *guard = None;
            }
        }
        ATSPI_PWD_FOCUSED.store(is_pwd, Ordering::Relaxed);
    }

    fn ensure_atspi_listener_started() {
        ATSPI_INIT.call_once(|| {
            std::thread::spawn(|| unsafe {
                let Some(api) = load_gio_dbus_api() else {
                    return;
                };
                let ctx = (api.main_context_new)();
                if ctx.is_null() {
                    return;
                }
                (api.main_context_push_default)(ctx);

                let mut err: *mut c_void = std::ptr::null_mut();
                let session = (api.bus_get_sync)(G_BUS_TYPE_SESSION, std::ptr::null_mut(), &mut err);
                if !err.is_null() {
                    (api.error_free)(err);
                    err = std::ptr::null_mut();
                }
                if session.is_null() {
                    return;
                }

                // Resolve AT-SPI2 dedicated accessibility bus address via org.a11y.Bus.GetAddress()
                let reply = (api.conn_call_sync)(
                    session,
                    b"org.a11y.Bus\0".as_ptr() as *const c_char,
                    b"/org/a11y/bus\0".as_ptr() as *const c_char,
                    b"org.a11y.Bus\0".as_ptr() as *const c_char,
                    b"GetAddress\0".as_ptr() as *const c_char,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    G_DBUS_CALL_FLAGS_NONE,
                    1500,
                    std::ptr::null_mut(),
                    &mut err,
                );
                (api.object_unref)(session);
                if !err.is_null() {
                    (api.error_free)(err);
                    err = std::ptr::null_mut();
                }
                if reply.is_null() {
                    return;
                }
                let addr_str = if (api.variant_n_children)(reply) >= 1 {
                    let c0 = (api.variant_get_child_value)(reply, 0);
                    let s = read_gvariant_string(&api, c0);
                    if !c0.is_null() {
                        (api.variant_unref)(c0);
                    }
                    s
                } else {
                    None
                };
                (api.variant_unref)(reply);
                let Some(addr_cstr) = addr_str.and_then(|s| CString::new(s).ok()) else {
                    return;
                };

                let a11y_conn = (api.conn_for_address_sync)(
                    addr_cstr.as_ptr(),
                    G_DBUS_CONN_AUTH_AND_BUS,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut err,
                );
                if !err.is_null() {
                    (api.error_free)(err);
                    err = std::ptr::null_mut();
                }
                if a11y_conn.is_null() {
                    return;
                }

                // Register passive interest in focus state changes with AT-SPI2 Registry
                let ev_str = (api.variant_new_string)(
                    b"object:state-changed:focused\0".as_ptr() as *const c_char,
                );
                let params = (api.variant_new_tuple)(&ev_str as *const *mut c_void, 1);
                let reg_reply = (api.conn_call_sync)(
                    a11y_conn,
                    b"org.a11y.atspi.Registry\0".as_ptr() as *const c_char,
                    b"/org/a11y/atspi/registry\0".as_ptr() as *const c_char,
                    b"org.a11y.atspi.Registry\0".as_ptr() as *const c_char,
                    b"RegisterEvent\0".as_ptr() as *const c_char,
                    params,
                    std::ptr::null(),
                    G_DBUS_CALL_FLAGS_NONE,
                    1500,
                    std::ptr::null_mut(),
                    &mut err,
                );
                if !err.is_null() {
                    (api.error_free)(err);
                }
                if !reg_reply.is_null() {
                    (api.variant_unref)(reg_reply);
                }

                let api_box = Box::into_raw(Box::new(api));
                ((*api_box).signal_subscribe)(
                    a11y_conn,
                    std::ptr::null(),
                    b"org.a11y.atspi.Event.Object\0".as_ptr() as *const c_char,
                    b"StateChanged\0".as_ptr() as *const c_char,
                    std::ptr::null(),
                    b"focused\0".as_ptr() as *const c_char,
                    G_DBUS_SIGNAL_FLAGS_NONE,
                    on_atspi_state_changed,
                    api_box as *mut c_void,
                    std::ptr::null(),
                );

                let main_loop = ((*api_box).main_loop_new)(ctx, 0);
                if !main_loop.is_null() {
                    ((*api_box).main_loop_run)(main_loop);
                }
            });
        });
    }

    pub fn is_focused_password_field() -> bool {
        ensure_atspi_listener_started();
        if ATSPI_PWD_FOCUSED.load(Ordering::Relaxed) {
            return true;
        }
        if let Some(info) = crate::input_hook::linux_hook::query_active_window_info() {
            if is_linux_password_prompt_window(&info.wm_class, &info.wm_name) {
                return true;
            }
        }
        false
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

        // Regression guard: NEVER run embedded fallback on regular top-level Chrome/Electron
        // or when UIA GetFocusedElement already resolved inside the focused control!
        assert!(!super::win_impl::should_run_embedded_hwnd_fallback(
            true,
            false,
            "Chrome_WidgetWin_1"
        ));
        assert!(!super::win_impl::should_run_embedded_hwnd_fallback(
            false,
            true,
            "Chrome_RenderWidgetHostHWND"
        ));
        // Only run when embedded child HWND != foreground AND UIA failed to cross into it
        assert!(super::win_impl::should_run_embedded_hwnd_fallback(
            false,
            false,
            "Chrome_RenderWidgetHostHWND"
        ));
        assert!(super::win_impl::should_run_embedded_hwnd_fallback(
            false,
            false,
            "SafeEdit"
        ));
        assert!(!super::win_impl::should_run_embedded_hwnd_fallback(
            false,
            false,
            "SysListView32"
        ));
    }

    #[cfg(windows)]
    #[test]
    fn skips_uia_on_heavy_cad_3d_apps_and_office_document_canvases() {
        assert!(super::win_impl::should_skip_uia_for_exe(r"C:\Program Files\Autodesk\AutoCAD 2024\acad.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("acadlt.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("ZWCAD.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("gcad.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("Revit.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("SLDWORKS.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("ugraf.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("CNEXT.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("blender.exe"));
        assert!(super::win_impl::should_skip_uia_for_exe("Photoshop.exe"));
        // Browsers, chat, and financial clients MUST remain protected by UIA!
        assert!(!super::win_impl::should_skip_uia_for_exe("chrome.exe"));
        assert!(!super::win_impl::should_skip_uia_for_exe("msedge.exe"));
        assert!(!super::win_impl::should_skip_uia_for_exe("WeChat.exe"));
        assert!(!super::win_impl::should_skip_uia_for_exe("hexin.exe"));
        assert!(!super::win_impl::should_skip_uia_for_exe("WINWORD.EXE"));

        // Office apps skip UIA on native surfaces (fixes Word 2010 status bar freeze #118)
        // while keeping zero-IPC ES_PASSWORD and embedded WebView2/Chromium sign-in popups active.
        assert!(super::win_impl::is_office_exe("WINWORD.EXE"));
        assert!(super::win_impl::is_office_exe(r"C:\Program Files (x86)\Microsoft Office\Office14\WINWORD.EXE"));
        assert!(super::win_impl::is_office_exe("EXCEL.EXE"));
        assert!(super::win_impl::is_office_exe("POWERPNT.EXE"));
        assert!(!super::win_impl::is_office_exe("chrome.exe"));

        // Office document surfaces & MFC/AutoCAD viewports skip UIA directly (fixes Word 2010 #118!)
        assert!(super::win_impl::is_known_document_canvas_class("_WwG"));
        assert!(super::win_impl::is_known_document_canvas_class("_WwF"));
        assert!(super::win_impl::is_known_document_canvas_class("OpusApp"));
        assert!(super::win_impl::is_known_document_canvas_class("NetUIHWND"));
        assert!(super::win_impl::is_known_document_canvas_class("EXCEL7"));
        assert!(super::win_impl::is_known_document_canvas_class("XLMAIN"));
        assert!(super::win_impl::is_known_document_canvas_class("paneClassDC"));
        assert!(super::win_impl::is_known_document_canvas_class("PPTFrameClass"));
        assert!(super::win_impl::is_known_document_canvas_class("AfxFrameOrView140u"));
        assert!(super::win_impl::is_known_document_canvas_class("AcApDocWindow"));
        assert!(!super::win_impl::is_known_document_canvas_class("Edit"));
        assert!(!super::win_impl::is_known_document_canvas_class("Chrome_RenderWidgetHostHWND"));
    }

    #[cfg(windows)]
    #[test]
    fn slow_pid_circuit_breaker_trips_and_escalates_cleanly() {
        use std::time::{Duration, Instant};
        let mut br = super::win_impl::SlowPidBreaker::new();
        let t0 = Instant::now();

        // Fast probes never trip
        assert!(!br.record_sample(42, Duration::from_millis(3), t0));
        assert!(!br.record_sample(42, Duration::from_millis(8), t0));
        assert!(!br.is_tripped(42, t0));

        // 1 slow probe (25ms) arms strike 1 without tripping; a fast probe resets strikes
        assert!(!br.record_sample(42, Duration::from_millis(25), t0));
        assert!(!br.is_tripped(42, t0));
        assert!(!br.record_sample(42, Duration::from_millis(4), t0));
        assert!(!br.record_sample(42, Duration::from_millis(25), t0));
        assert!(!br.is_tripped(42, t0));

        // 2 consecutive slow probes (>= 22ms) trip for 300s
        assert!(br.record_sample(42, Duration::from_millis(26), t0));
        assert!(br.is_tripped(42, t0 + Duration::from_secs(299)));
        assert!(!br.is_tripped(42, t0 + Duration::from_secs(301)));

        // Single hard stall (>= 55ms) on a fresh PID trips immediately
        assert!(br.record_sample(99, Duration::from_millis(65), t0));
        assert!(br.is_tripped(99, t0 + Duration::from_secs(10)));

        // Repeat trip escalates cooldown to 900s
        let t1 = t0 + Duration::from_secs(310);
        assert!(br.record_sample(99, Duration::from_millis(60), t1));
        assert!(br.is_tripped(99, t1 + Duration::from_secs(890)));
        assert!(!br.is_tripped(99, t1 + Duration::from_secs(905)));
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

    #[test]
    fn linux_atspi_role_and_native_auth_prompt_classifiers_work_safely() {
        use super::{is_atspi_password_role_or_label, is_linux_password_prompt_window};

        assert!(is_atspi_password_role_or_label("password text", ""));
        assert!(is_atspi_password_role_or_label("entry", "请输入密码"));
        assert!(is_atspi_password_role_or_label("text", "loginPassword"));
        assert!(!is_atspi_password_role_or_label("entry", "Search messages"));
        assert!(!is_atspi_password_role_or_label("push button", "Password"));

        assert!(is_linux_password_prompt_window("gcr-prompter Gcr-prompter", "Unlock Keyring"));
        assert!(is_linux_password_prompt_window("polkit-gnome-authentication-agent-1", "Authenticate"));
        assert!(is_linux_password_prompt_window("pinentry-gtk-2", "PIN Entry"));
        assert!(is_linux_password_prompt_window("dialog", "Authentication Required"));
        assert!(!is_linux_password_prompt_window("Navigator firefox", "Authentication Required"));
        assert!(!is_linux_password_prompt_window("kitty kitty", "sudo"));
    }
}
