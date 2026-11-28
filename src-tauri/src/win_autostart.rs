//! Windows Task Scheduler (native COM `ITaskService`) elevated autostart + mutual-exclusion policy.
//!
//! Architecture:
//! - Standard autostart uses `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\KuroCat` (no UAC).
//! - Elevated autostart uses Task Scheduler `\KuroCat\AutoStartAdmin` (`LogonTrigger` + `HighestAvailable`).
//!   Users only approve UAC once when enabling/disabling (or 0 times if KuroCat is already elevated);
//!   every subsequent Windows logon launches KuroCat silently with Administrator privileges.
//! - The two channels are strictly mutually exclusive so Windows never double-launches normal + admin copies.

pub const ADMIN_TASK_FOLDER_NAME: &str = "KuroCat";
pub const ADMIN_TASK_NAME: &str = "AutoStartAdmin";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdminAutostartCliAction {
    Enable { user_sid: Option<String> },
    Disable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdminTaskQuery {
    Absent,
    Present { exe_path: Option<String> },
    AccessDenied,
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartApplyErrorKind {
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutostartApplyError {
    pub kind: AutostartApplyErrorKind,
    pub message: String,
}

impl AutostartApplyError {
    pub fn cancelled() -> Self {
        Self {
            kind: AutostartApplyErrorKind::Cancelled,
            message: "UAC_CANCELLED".to_string(),
        }
    }

    pub fn failed(msg: impl Into<String>) -> Self {
        Self {
            kind: AutostartApplyErrorKind::Failed,
            message: msg.into(),
        }
    }
}

/// Validates a Windows security identifier string such as `S-1-5-21-...`.
pub fn is_valid_windows_user_sid(sid: &str) -> bool {
    let trimmed = sid.trim();
    if !trimmed.starts_with("S-1-") || trimmed.len() < 7 || trimmed.len() > 96 {
        return false;
    }
    let mut parts = trimmed.split('-');
    let Some("S") = parts.next() else {
        return false;
    };
    let mut count = 0usize;
    for seg in parts {
        if seg.is_empty() || !seg.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        count += 1;
    }
    count >= 2
}

/// Parses `--admin-autostart enable [--user-sid S-1-...] | disable`.
/// Intentionally does NOT accept an arbitrary executable path: elevated registration always binds
/// to `std::env::current_exe()` so local callers cannot abuse the helper to register other binaries.
pub fn parse_admin_autostart_cli_action<I, S>(args: I) -> Option<AdminAutostartCliAction>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let list: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
    let idx = list.iter().position(|a| a == "--admin-autostart")?;
    let mode = list.get(idx + 1)?.trim().to_ascii_lowercase();
    match mode.as_str() {
        "enable" => {
            let mut user_sid = None;
            if let Some(sid_idx) = list.iter().position(|a| a == "--user-sid") {
                if let Some(raw) = list.get(sid_idx + 1) {
                    let trimmed = raw.trim();
                    if is_valid_windows_user_sid(trimmed) {
                        user_sid = Some(trimmed.to_string());
                    }
                }
            }
            Some(AdminAutostartCliAction::Enable { user_sid })
        }
        "disable" => Some(AdminAutostartCliAction::Disable),
        _ => None,
    }
}

pub fn xml_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

pub fn xml_unescape(raw: &str) -> String {
    raw.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Builds Task Scheduler 1.2 XML for silent, elevated logon startup:
/// - `HighestAvailable` + `InteractiveToken` bound to the interactive user SID (zero UAC at logon)
/// - `Delay = PT3S` so Explorer & system tray are ready before KuroCat registers its tray icon
/// - `DisallowStartIfOnBatteries = false` & `StopIfGoingOnBatteries = false` (laptop safe)
/// - `ExecutionTimeLimit = PT0S` (never killed after 72 hours)
/// - `MultipleInstancesPolicy = IgnoreNew`
pub fn build_admin_autostart_task_xml(exe_path: &str, working_dir: &str, user_id: &str) -> String {
    let command = if exe_path.starts_with('"') && exe_path.ends_with('"') {
        exe_path.to_string()
    } else {
        format!("\"{}\"", exe_path)
    };
    let cmd_xml = xml_escape(&command);
    let dir_xml = xml_escape(working_dir);
    let user_xml = xml_escape(user_id);

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n\
<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n\
  <RegistrationInfo>\r\n\
    <Author>KuroCat</Author>\r\n\
    <Description>KuroCat desktop companion elevated autostart</Description>\r\n\
  </RegistrationInfo>\r\n\
  <Triggers>\r\n\
    <LogonTrigger>\r\n\
      <Enabled>true</Enabled>\r\n\
      <UserId>{user_xml}</UserId>\r\n\
      <Delay>PT3S</Delay>\r\n\
    </LogonTrigger>\r\n\
  </Triggers>\r\n\
  <Principals>\r\n\
    <Principal id=\"Author\">\r\n\
      <UserId>{user_xml}</UserId>\r\n\
      <LogonType>InteractiveToken</LogonType>\r\n\
      <RunLevel>HighestAvailable</RunLevel>\r\n\
    </Principal>\r\n\
  </Principals>\r\n\
  <Settings>\r\n\
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n\
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n\
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n\
    <AllowHardTerminate>true</AllowHardTerminate>\r\n\
    <StartWhenAvailable>false</StartWhenAvailable>\r\n\
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\r\n\
    <IdleSettings>\r\n\
      <StopOnIdleEnd>false</StopOnIdleEnd>\r\n\
      <RestartOnIdle>false</RestartOnIdle>\r\n\
    </IdleSettings>\r\n\
    <AllowStartOnDemand>true</AllowStartOnDemand>\r\n\
    <Enabled>true</Enabled>\r\n\
    <Hidden>false</Hidden>\r\n\
    <RunOnlyIfIdle>false</RunOnlyIfIdle>\r\n\
    <WakeToRun>false</WakeToRun>\r\n\
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n\
    <Priority>7</Priority>\r\n\
  </Settings>\r\n\
  <Actions Context=\"Author\">\r\n\
    <Exec>\r\n\
      <Command>{cmd_xml}</Command>\r\n\
      <WorkingDirectory>{dir_xml}</WorkingDirectory>\r\n\
    </Exec>\r\n\
  </Actions>\r\n\
</Task>\r\n"
    )
}

/// Extracts the unquoted executable path from Task Scheduler `<Command>...</Command>` XML.
pub fn extract_command_from_task_xml(xml: &str) -> Option<String> {
    let start_tag = "<Command>";
    let end_tag = "</Command>";
    let start = xml.find(start_tag)? + start_tag.len();
    let end = start + xml[start..].find(end_tag)?;
    let unescaped = xml_unescape(xml[start..end].trim());
    let cleaned = unescaped.trim().trim_matches('"').trim();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

pub fn paths_match_windows_exe(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.trim()
            .trim_matches('"')
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    norm(a) == norm(b)
}

/// Pure startup reconciliation logic comparing persisted settings against actual Windows state.
/// Returns `(next_autostart, next_autostart_admin, needs_refresh_run, needs_refresh_task)`.
pub fn reconcile_windows_autostart_state(
    saved_autostart: bool,
    saved_autostart_admin: bool,
    run_entry: Option<&str>,
    task_query: &AdminTaskQuery,
    current_exe: &str,
    self_elevated: bool,
) -> (bool, bool, bool, bool) {
    match task_query {
        AdminTaskQuery::Present { exe_path } => {
            let stale_task = exe_path
                .as_deref()
                .map(|p| !paths_match_windows_exe(p, current_exe))
                .unwrap_or(true);
            // If admin task exists, make sure Run entry is absent so Windows never double-starts.
            let needs_refresh_task = self_elevated && stale_task;
            let needs_cleanup_run = run_entry.is_some();
            (true, true, needs_cleanup_run, needs_refresh_task)
        }
        AdminTaskQuery::Absent => {
            if let Some(run_path) = run_entry {
                let stale_run = !paths_match_windows_exe(run_path, current_exe);
                (true, false, stale_run, false)
            } else {
                // Neither Task Scheduler entry nor HKCU Run entry exists on the system.
                (false, false, false, false)
            }
        }
        AdminTaskQuery::AccessDenied | AdminTaskQuery::Error(_) => {
            // Do not overwrite user intent if Task Scheduler could not be queried.
            let norm_admin = saved_autostart && saved_autostart_admin;
            let stale_run = if saved_autostart && !norm_admin {
                run_entry
                    .map(|p| !paths_match_windows_exe(p, current_exe))
                    .unwrap_or(false)
            } else {
                false
            };
            (saved_autostart, norm_admin, stale_run, false)
        }
    }
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{BSTR, VARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::System::TaskScheduler::{
        ITaskFolder, ITaskService, TaskScheduler, TASK_CREATE_OR_UPDATE,
        TASK_LOGON_INTERACTIVE_TOKEN,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, BOOL, HANDLE};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
        REG_SZ,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetExitCodeProcess, WaitForSingleObject,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    const ERROR_CANCELLED: u32 = 1223;
    const WAIT_OBJECT_0: u32 = 0;
    const HRESULT_FILE_NOT_FOUND: i32 = 0x80070002u32 as i32;
    const HRESULT_PATH_NOT_FOUND: i32 = 0x80070003u32 as i32;
    const HRESULT_ACCESS_DENIED: i32 = 0x80070005u32 as i32;

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    fn init_com_sta() -> ComGuard {
        let ok = unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok()
        };
        ComGuard(ok)
    }

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    /// Queries the current process user SID (`S-1-5-21-...`) via Advapi32.
    pub fn current_user_sid() -> Option<String> {
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
            fn ConvertSidToStringSidW(sid: *mut c_void, string_sid: *mut *mut u16) -> BOOL;
        }

        #[repr(C)]
        struct SidAndAttributes {
            sid: *mut c_void,
            attributes: u32,
        }

        const TOKEN_QUERY: u32 = 0x0008;
        const TOKEN_USER_CLASS: u32 = 1;

        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0
                || token.is_null()
            {
                return None;
            }
            let mut needed: u32 = 0;
            let _ = GetTokenInformation(token, TOKEN_USER_CLASS, std::ptr::null_mut(), 0, &mut needed);
            if needed == 0 {
                let _ = CloseHandle(token);
                return None;
            }
            let mut buf = vec![0u8; needed as usize];
            let ok = GetTokenInformation(
                token,
                TOKEN_USER_CLASS,
                buf.as_mut_ptr().cast(),
                needed,
                &mut needed,
            );
            let _ = CloseHandle(token);
            if ok == 0 {
                return None;
            }
            let user = &*(buf.as_ptr().cast::<SidAndAttributes>());
            if user.sid.is_null() {
                return None;
            }
            let mut str_ptr: *mut u16 = std::ptr::null_mut();
            if ConvertSidToStringSidW(user.sid, &mut str_ptr) == 0 || str_ptr.is_null() {
                return None;
            }
            let mut len = 0usize;
            while *str_ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(str_ptr, len);
            let sid = String::from_utf16_lossy(slice);
            let _ = LocalFree(str_ptr.cast());
            if is_valid_windows_user_sid(&sid) {
                Some(sid)
            } else {
                None
            }
        }
    }

    fn connect_task_service() -> Result<(ITaskService, ITaskFolder), windows::core::Error> {
        unsafe {
            let service: ITaskService =
                CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
            let empty = VARIANT::default();
            service.Connect(&empty, &empty, &empty, &empty)?;
            let root = service.GetFolder(&BSTR::from("\\"))?;
            Ok((service, root))
        }
    }

    pub fn query_admin_autostart_task() -> AdminTaskQuery {
        let _com = init_com_sta();
        let (_service, root) = match connect_task_service() {
            Ok(v) => v,
            Err(e) => {
                if e.code().0 == HRESULT_ACCESS_DENIED {
                    return AdminTaskQuery::AccessDenied;
                }
                return AdminTaskQuery::Error(e.to_string());
            }
        };

        let folder = match unsafe { root.GetFolder(&BSTR::from(ADMIN_TASK_FOLDER_NAME)) } {
            Ok(f) => f,
            Err(e) => {
                let code = e.code().0;
                if code == HRESULT_FILE_NOT_FOUND || code == HRESULT_PATH_NOT_FOUND {
                    return AdminTaskQuery::Absent;
                }
                if code == HRESULT_ACCESS_DENIED {
                    return AdminTaskQuery::AccessDenied;
                }
                return AdminTaskQuery::Error(e.to_string());
            }
        };

        match unsafe { folder.GetTask(&BSTR::from(ADMIN_TASK_NAME)) } {
            Ok(task) => {
                let exe_path = unsafe { task.Xml().ok() }
                    .map(|b| b.to_string())
                    .and_then(|xml| extract_command_from_task_xml(&xml));
                AdminTaskQuery::Present { exe_path }
            }
            Err(e) => {
                let code = e.code().0;
                if code == HRESULT_FILE_NOT_FOUND || code == HRESULT_PATH_NOT_FOUND {
                    AdminTaskQuery::Absent
                } else if code == HRESULT_ACCESS_DENIED {
                    AdminTaskQuery::AccessDenied
                } else {
                    AdminTaskQuery::Error(e.to_string())
                }
            }
        }
    }

    /// Queries the existing `HKCU\...\Run\KuroCat` string value, if present.
    pub fn query_windows_run_autostart() -> Option<String> {
        let subkey = to_wide(OsStr::new("Software\\Microsoft\\Windows\\CurrentVersion\\Run"));
        let value_name = to_wide(OsStr::new("KuroCat"));
        unsafe {
            let mut hkey: HKEY = std::ptr::null_mut();
            if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey) != 0
            {
                return None;
            }
            let mut value_type: u32 = 0;
            let mut byte_len: u32 = 0;
            let st = RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                std::ptr::null_mut(),
                &mut byte_len,
            );
            if st != 0 || value_type != REG_SZ || byte_len < 2 {
                RegCloseKey(hkey);
                return None;
            }
            let mut buf = vec![0u16; (byte_len as usize + 1) / 2];
            let st2 = RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                std::ptr::null_mut(),
                &mut value_type,
                buf.as_mut_ptr().cast(),
                &mut byte_len,
            );
            RegCloseKey(hkey);
            if st2 != 0 {
                return None;
            }
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let raw = String::from_utf16_lossy(&buf[..end]);
            let trimmed = raw.trim().trim_matches('"').trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
    }

    /// Registers `\KuroCat\AutoStartAdmin` directly using the current elevated token.
    pub fn register_admin_autostart_task_direct(user_sid: Option<&str>) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy().to_string();
        let work_dir = exe
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let resolved_sid = user_sid
            .filter(|s| is_valid_windows_user_sid(s))
            .map(|s| s.to_string())
            .or_else(current_user_sid)
            .ok_or_else(|| "Unable to determine Windows user SID".to_string())?;

        let xml = build_admin_autostart_task_xml(&exe_str, &work_dir, &resolved_sid);

        let _com = init_com_sta();
        let (_service, root) = connect_task_service().map_err(|e| e.to_string())?;
        let empty = VARIANT::default();
        let folder = unsafe {
            match root.GetFolder(&BSTR::from(ADMIN_TASK_FOLDER_NAME)) {
                Ok(f) => f,
                Err(_) => root
                    .CreateFolder(&BSTR::from(ADMIN_TASK_FOLDER_NAME), &empty)
                    .map_err(|e| format!("CreateFolder failed: {}", e))?,
            }
        };
        unsafe {
            folder
                .RegisterTask(
                    &BSTR::from(ADMIN_TASK_NAME),
                    &BSTR::from(xml),
                    TASK_CREATE_OR_UPDATE.0,
                    &empty,
                    &empty,
                    TASK_LOGON_INTERACTIVE_TOKEN,
                    &empty,
                )
                .map_err(|e| format!("RegisterTask failed: {}", e))?;
        }
        Ok(())
    }

    /// Deletes `\KuroCat\AutoStartAdmin` (and best-effort removes empty `\KuroCat` folder).
    pub fn delete_admin_autostart_task_direct() -> Result<(), String> {
        let _com = init_com_sta();
        let (_service, root) = connect_task_service().map_err(|e| e.to_string())?;
        let folder = match unsafe { root.GetFolder(&BSTR::from(ADMIN_TASK_FOLDER_NAME)) } {
            Ok(f) => f,
            Err(e) => {
                let code = e.code().0;
                if code == HRESULT_FILE_NOT_FOUND || code == HRESULT_PATH_NOT_FOUND {
                    return Ok(());
                }
                return Err(format!("GetFolder failed: {}", e));
            }
        };

        if let Err(e) = unsafe { folder.DeleteTask(&BSTR::from(ADMIN_TASK_NAME), 0) } {
            let code = e.code().0;
            if code != HRESULT_FILE_NOT_FOUND && code != HRESULT_PATH_NOT_FOUND {
                return Err(format!("DeleteTask failed: {}", e));
            }
        }
        let _ = unsafe { root.DeleteFolder(&BSTR::from(ADMIN_TASK_FOLDER_NAME), 0) };
        Ok(())
    }

    /// Runs a short-lived elevated helper (`KuroCat.exe --admin-autostart enable|disable`) via UAC.
    fn run_elevated_autostart_helper(enable: bool) -> Result<(), AutostartApplyError> {
        let exe = std::env::current_exe().map_err(|e| AutostartApplyError::failed(e.to_string()))?;
        let _com = init_com_sta();

        let verb = to_wide(OsStr::new("runas"));
        let file = to_wide(exe.as_os_str());
        let params_str = if enable {
            if let Some(sid) = current_user_sid() {
                format!("--admin-autostart enable --user-sid {}", sid)
            } else {
                "--admin-autostart enable".to_string()
            }
        } else {
            "--admin-autostart disable".to_string()
        };
        let params = to_wide(OsStr::new(&params_str));
        let dir = exe.parent().map(|p| to_wide(p.as_os_str()));
        let dir_ptr = dir.as_ref().map_or(std::ptr::null(), |v| v.as_ptr());

        let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        sei.lpVerb = verb.as_ptr();
        sei.lpFile = file.as_ptr();
        sei.lpParameters = params.as_ptr();
        sei.lpDirectory = dir_ptr;
        sei.nShow = SW_HIDE;

        let launched = unsafe { ShellExecuteExW(&mut sei) != 0 };
        if !launched {
            let err = unsafe { GetLastError() };
            if err == ERROR_CANCELLED {
                return Err(AutostartApplyError::cancelled());
            }
            return Err(AutostartApplyError::failed(format!(
                "ShellExecuteExW error {}",
                err
            )));
        }

        let proc_handle: HANDLE = sei.hProcess;
        if proc_handle.is_null() {
            return Err(AutostartApplyError::failed("Missing helper process handle"));
        }

        let wait = unsafe { WaitForSingleObject(proc_handle, 20_000) };
        let mut exit_code: u32 = 1;
        let got_exit = if wait == WAIT_OBJECT_0 {
            unsafe { GetExitCodeProcess(proc_handle, &mut exit_code) != 0 }
        } else {
            false
        };
        unsafe {
            let _ = CloseHandle(proc_handle);
        }

        if wait != WAIT_OBJECT_0 {
            return Err(AutostartApplyError::failed("Elevated helper timed out"));
        }
        if got_exit && exit_code == 0 {
            Ok(())
        } else {
            Err(AutostartApplyError::failed(format!(
                "Elevated helper exited with code {}",
                exit_code
            )))
        }
    }

    pub fn ensure_admin_task(enable: bool) -> Result<(), AutostartApplyError> {
        if crate::win_is_elevated() {
            let res = if enable {
                register_admin_autostart_task_direct(None)
            } else {
                delete_admin_autostart_task_direct()
            };
            res.map_err(AutostartApplyError::failed)
        } else {
            run_elevated_autostart_helper(enable)
        }
    }

    pub fn apply_windows_autostart_mode(
        autostart: bool,
        autostart_admin: bool,
    ) -> Result<(bool, bool), AutostartApplyError> {
        let want_admin = autostart && autostart_admin;
        if want_admin {
            // 1) Create/update Task Scheduler entry first; only remove HKCU\Run after success
            //    so cancelling UAC leaves any existing normal autostart untouched.
            ensure_admin_task(true)?;
            let _ = crate::config::set_windows_autostart(false);
            Ok((true, true))
        } else if autostart {
            // 2) Normal autostart: if admin task exists, remove it first (keeps mutual exclusion).
            if matches!(
                query_admin_autostart_task(),
                AdminTaskQuery::Present { .. } | AdminTaskQuery::AccessDenied
            ) {
                ensure_admin_task(false)?;
            }
            crate::config::set_windows_autostart(true).map_err(AutostartApplyError::failed)?;
            Ok((true, false))
        } else {
            // 3) Fully disabled: remove admin task first (if UAC is cancelled, report honestly
            //    so the UI does not falsely show autostart off while the admin task remains active).
            if matches!(
                query_admin_autostart_task(),
                AdminTaskQuery::Present { .. } | AdminTaskQuery::AccessDenied
            ) {
                ensure_admin_task(false)?;
            }
            crate::config::set_windows_autostart(false).map_err(AutostartApplyError::failed)?;
            Ok((false, false))
        }
    }

    pub fn run_admin_autostart_cli(action: AdminAutostartCliAction) -> i32 {
        if !crate::win_is_elevated() {
            eprintln!("[kurocat] --admin-autostart requires Administrator privileges");
            return 2;
        }
        let result = match action {
            AdminAutostartCliAction::Enable { user_sid } => {
                register_admin_autostart_task_direct(user_sid.as_deref())
            }
            AdminAutostartCliAction::Disable => delete_admin_autostart_task_direct(),
        };
        match result {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("[kurocat] --admin-autostart failed: {}", e);
                1
            }
        }
    }
}

#[cfg(windows)]
pub use win_impl::{
    apply_windows_autostart_mode, query_admin_autostart_task, query_windows_run_autostart,
    register_admin_autostart_task_direct, run_admin_autostart_cli,
};

#[cfg(not(windows))]
pub fn run_admin_autostart_cli(_action: AdminAutostartCliAction) -> i32 {
    1
}

#[cfg(not(windows))]
pub fn apply_windows_autostart_mode(
    autostart: bool,
    _autostart_admin: bool,
) -> Result<(bool, bool), AutostartApplyError> {
    crate::config::set_windows_autostart(autostart).map_err(AutostartApplyError::failed)?;
    Ok((autostart, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_windows_user_sids_strictly() {
        assert!(is_valid_windows_user_sid("S-1-5-21-3623811015-3361044348-30300820-1001"));
        assert!(is_valid_windows_user_sid("S-1-5-18"));
        assert!(!is_valid_windows_user_sid(""));
        assert!(!is_valid_windows_user_sid("S-1-"));
        assert!(!is_valid_windows_user_sid("S-1-5--1001"));
        assert!(!is_valid_windows_user_sid("DOMAIN\\User"));
        assert!(!is_valid_windows_user_sid("S-1-5-21-1001; calc.exe"));
    }

    #[test]
    fn parses_admin_autostart_cli_args_safely() {
        assert_eq!(
            parse_admin_autostart_cli_action(["KuroCat.exe", "--admin-autostart", "enable"]),
            Some(AdminAutostartCliAction::Enable { user_sid: None })
        );
        assert_eq!(
            parse_admin_autostart_cli_action([
                "KuroCat.exe",
                "--admin-autostart",
                "enable",
                "--user-sid",
                "S-1-5-21-123-456-789-1001"
            ]),
            Some(AdminAutostartCliAction::Enable {
                user_sid: Some("S-1-5-21-123-456-789-1001".to_string())
            })
        );
        // Invalid SID must be ignored rather than injected into XML
        assert_eq!(
            parse_admin_autostart_cli_action([
                "KuroCat.exe",
                "--admin-autostart",
                "enable",
                "--user-sid",
                "S-1-5<evil>"
            ]),
            Some(AdminAutostartCliAction::Enable { user_sid: None })
        );
        assert_eq!(
            parse_admin_autostart_cli_action(["KuroCat.exe", "--admin-autostart", "disable"]),
            Some(AdminAutostartCliAction::Disable)
        );
        assert_eq!(
            parse_admin_autostart_cli_action(["KuroCat.exe", "--admin-autostart", "bogus"]),
            None
        );
        assert_eq!(parse_admin_autostart_cli_action(["KuroCat.exe"]), None);
    }

    #[test]
    fn builds_safe_task_xml_with_laptop_and_unlimited_runtime_flags() {
        let exe = r"D:\My Apps & Cats\小黑猫\KuroCat.exe";
        let dir = r"D:\My Apps & Cats\小黑猫";
        let sid = "S-1-5-21-111-222-333-1001";
        let xml = build_admin_autostart_task_xml(exe, dir, sid);

        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<LogonType>InteractiveToken</LogonType>"));
        assert!(xml.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(xml.contains("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>"));
        assert!(xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
        assert!(xml.contains("<Delay>PT3S</Delay>"));
        assert!(xml.contains("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>"));
        assert!(xml.contains("&amp;"));
        assert_eq!(
            extract_command_from_task_xml(&xml).as_deref(),
            Some(exe)
        );
    }

    #[test]
    fn reconciles_autostart_channels_and_detects_moved_exe() {
        let exe = r"D:\Tools\KuroCat.exe";
        let old = r"C:\Downloads\KuroCat.exe";

        // Admin task present + stale path + stray HKCU\Run entry -> heal both when elevated
        let (a, adm, fix_run, fix_task) = reconcile_windows_autostart_state(
            true,
            true,
            Some(old),
            &AdminTaskQuery::Present {
                exe_path: Some(old.to_string()),
            },
            exe,
            true,
        );
        assert_eq!((a, adm, fix_run, fix_task), (true, true, true, true));

        // Admin task manually deleted by user, no Run key -> reflect honest off state
        let (a2, adm2, fix_run2, fix_task2) = reconcile_windows_autostart_state(
            true,
            true,
            None,
            &AdminTaskQuery::Absent,
            exe,
            false,
        );
        assert_eq!((a2, adm2, fix_run2, fix_task2), (false, false, false, false));

        // Normal Run entry present with moved EXE -> refresh Run path
        let (a3, adm3, fix_run3, fix_task3) = reconcile_windows_autostart_state(
            true,
            false,
            Some(old),
            &AdminTaskQuery::Absent,
            exe,
            false,
        );
        assert_eq!((a3, adm3, fix_run3, fix_task3), (true, false, true, false));

        // Access denied reading Task Scheduler -> preserve persisted flags without false reset
        let (a4, adm4, fix_run4, fix_task4) = reconcile_windows_autostart_state(
            true,
            true,
            None,
            &AdminTaskQuery::AccessDenied,
            exe,
            false,
        );
        assert_eq!((a4, adm4, fix_run4, fix_task4), (true, true, false, false));
    }
}
