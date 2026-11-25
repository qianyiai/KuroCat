use crate::config::AppSettings;
use crate::{
    apply_breed_and_save, apply_keyboard_layout_and_save, apply_keyboard_orientation_and_save,
    apply_scale_and_save, apply_tail_key_mode_and_save, is_pet_visible, reset_window_position,
    set_pet_always_on_top, set_pet_visible, shutdown_pet_windows, AppState,
};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager};

fn default_tray_tooltip() -> &'static str {
    #[cfg(windows)]
    {
        if crate::win_is_elevated() {
            return "KuroCat（管理员 · 游戏模式就绪）";
        }
    }
    "KuroCat"
}

fn refresh_character_menu(app: &AppHandle, menu: &Submenu<tauri::Wry>) -> tauri::Result<()> {
    while menu.remove_at(0)?.is_some() {}
    let settings=app.state::<AppState>().settings.lock().unwrap().clone();
    if let Ok(registry) = crate::characters::load_registry() {
        for entry in registry.characters.values() {
            let label=if registry.characters.values().filter(|other|other.name==entry.name).count()>1 {
                format!("{} ({})",entry.name,entry.id)
            }else{entry.name.clone()};
            for outfit in &entry.playable_outfits {
                let active=settings.active_character_id.as_deref()==Some(entry.id.as_str())
                    &&settings.character_outfits.get(&entry.id)==Some(outfit);
                let item = CheckMenuItem::with_id(app, format!("character:{}:{}", entry.id, outfit),
                    format!("{} · {}", label, outfit), true, active, None::<&str>)?;
                menu.append(&item)?;
            }
        }
    }
    if menu.items()?.is_empty() {
        menu.append(&MenuItem::with_id(app,"character-empty","尚无可播放的人物包",false,None::<&str>)?)?;
    }
    Ok(())
}

// Presets are exact quarter steps, representable without floating-point rounding.
// A custom value near a preset must still leave every preset unchecked.
fn scale_is_selected(scale: f64, preset: f64) -> bool {
    scale == preset
}

fn character_item_is_selected(item_id: &str, settings: &AppSettings) -> bool {
    let Some((id, outfit)) = item_id.strip_prefix("character:").and_then(|choice| choice.split_once(':')) else {
        return false;
    };
    settings.active_character_id.as_deref() == Some(id)
        && settings.character_outfits.get(id).is_some_and(|selected| selected == outfit)
}

fn sync_character_checks(menu: &Submenu<tauri::Wry>, settings: &AppSettings) -> tauri::Result<()> {
    for item in menu.items()? {
        if let Some(item) = item.as_check_menuitem() {
            item.set_checked(character_item_is_selected(item.id().as_ref(), settings))?;
        }
    }
    Ok(())
}

pub fn setup_tray(app: &AppHandle, initial: &AppSettings) -> tauri::Result<()> {
    #[cfg(windows)]
    let display_menu = crate::windows_display::create_menu(app)?;
    #[cfg(target_os = "macos")]
    let display_menu = crate::macos_window::create_display_menu(app)?;
    let toggle_show = MenuItem::with_id(app, "toggle_show", "显示 / 隐藏小黑猫", true, None::<&str>)?;
    let pause_guard = CheckMenuItem::with_id(
        app,
        "pause_guard",
        "暂停监听并隐藏（游戏反作弊护航）",
        true,
        false,
        None::<&str>,
    )?;
    #[cfg(windows)]
    let restart_as_admin = {
        let elevated = crate::win_is_elevated();
        let label = if elevated {
            "✓ 已管理员运行（游戏键鼠就绪）"
        } else {
            "以管理员身份重启（捕获游戏键鼠）"
        };
        MenuItem::with_id(app, "restart_as_admin", label, !elevated, None::<&str>)?
    };
    let click_through_label = if cfg!(target_os = "macos") {
        "锁定鼠标穿透（按住 Option 可临时操作）"
    } else {
        "锁定鼠标穿透（按住 Alt 可临时操作）"
    };
    let click_through = CheckMenuItem::with_id(
        app,
        "click_through",
        click_through_label,
        true,
        initial.click_through_locked,
        None::<&str>,
    )?;
    let key_bubbles = CheckMenuItem::with_id(
        app,
        "key_bubbles",
        "显示悬浮按键气泡",
        true,
        initial.show_key_bubbles,
        None::<&str>,
    )?;
    let privacy_guard = CheckMenuItem::with_id(
        app,
        "privacy_guard",
        "输入密码自动闭眼防偷窥",
        true,
        initial.privacy_password_guard,
        None::<&str>,
    )?;
    let sound_toggle = CheckMenuItem::with_id(
        app,
        "sound_toggle",
        "摸头呼噜声",
        true,
        initial.sound_enabled,
        None::<&str>,
    )?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        "always_on_top",
        "始终置顶显示",
        true,
        initial.always_on_top,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机自动启动",
        true,
        initial.autostart,
        None::<&str>,
    )?;
    let mcp_toggle = CheckMenuItem::with_id(
        app,
        "mcp_toggle",
        "开启 MCP 扩展服务",
        true,
        initial.mcp_enabled,
        None::<&str>,
    )?;

    let obs_port = if initial.obs_port == 0 { 27421 } else { initial.obs_port };
    let obs_toggle = CheckMenuItem::with_id(
        app,
        "obs_toggle",
        format!("开启 OBS 透明直播源 (127.0.0.1:{})", obs_port),
        true,
        initial.obs_enabled,
        None::<&str>,
    )?;
    let obs_hide_pet = CheckMenuItem::with_id(
        app,
        "obs_hide_pet",
        "仅 OBS 显示（隐藏桌面猫）",
        true,
        initial.obs_enabled && initial.obs_hide_pet,
        None::<&str>,
    )?;
    let obs_open_browser = MenuItem::with_id(
        app,
        "obs_open_browser",
        "在浏览器中预览 OBS 透明源",
        true,
        None::<&str>,
    )?;
    let obs_menu = Submenu::with_items(
        app,
        "OBS 透明直播源",
        true,
        &[&obs_toggle, &obs_hide_pet, &obs_open_browser],
    )?;

    let cat_active = initial.active_character_id.is_none();
    let breed_black = CheckMenuItem::with_id(app, "breed_black", "经典小黑猫", true, cat_active && initial.cat_breed == "black", None::<&str>)?;
    let breed_ragdoll = CheckMenuItem::with_id(app, "breed_ragdoll", "暖奶茶布偶猫", true, cat_active && initial.cat_breed == "ragdoll", None::<&str>)?;
    let breed_orange = CheckMenuItem::with_id(app, "breed_orange", "大橘猫（虎斑）", true, cat_active && initial.cat_breed == "orange-tabby", None::<&str>)?;
    let breed_calico = CheckMenuItem::with_id(app, "breed_calico", "三花猫", true, cat_active && initial.cat_breed == "calico", None::<&str>)?;
    let breed_tuxedo = CheckMenuItem::with_id(app, "breed_tuxedo", "奶牛猫", true, cat_active && initial.cat_breed == "tuxedo", None::<&str>)?;
    let breed_siamese = CheckMenuItem::with_id(app, "breed_siamese", "暹罗猫", true, cat_active && initial.cat_breed == "siamese", None::<&str>)?;
    let breed_dafeiyu = CheckMenuItem::with_id(app, "breed_dafeiyu", "🐳 大肥鱼（鲸鱼娘）", true, cat_active && initial.cat_breed == "dafeiyu", None::<&str>)?;
    let breed_menu = Submenu::with_items(
        app,
        "角色外观",
        true,
        &[
            &breed_black,
            &breed_ragdoll,
            &breed_orange,
            &breed_calico,
            &breed_tuxedo,
            &breed_siamese,
            &breed_dafeiyu,
        ],
    )?;

    let scale_25 = CheckMenuItem::with_id(app, "scale_25", "25%（迷你）", true, scale_is_selected(initial.scale, 0.25), None::<&str>)?;
    let scale_50 = CheckMenuItem::with_id(app, "scale_50", "50%（小巧）", true, scale_is_selected(initial.scale, 0.5), None::<&str>)?;
    let scale_75 = CheckMenuItem::with_id(app, "scale_75", "75%（适中）", true, scale_is_selected(initial.scale, 0.75), None::<&str>)?;
    let scale_100 = CheckMenuItem::with_id(app, "scale_100", "100%（默认）", true, scale_is_selected(initial.scale, 1.0), None::<&str>)?;
    let scale_125 = CheckMenuItem::with_id(app, "scale_125", "125%（偏大）", true, scale_is_selected(initial.scale, 1.25), None::<&str>)?;
    let scale_150 = CheckMenuItem::with_id(app, "scale_150", "150%（大号）", true, scale_is_selected(initial.scale, 1.5), None::<&str>)?;
    let scale_menu = Submenu::with_items(
        app,
        format!("缩放大小（当前 {:.0}%）",initial.scale*100.0),
        true,
        &[&scale_25, &scale_50, &scale_75, &scale_100, &scale_125, &scale_150],
    )?;

    let kb_65 = CheckMenuItem::with_id(app, "kb_65", "65% 紧凑键盘", true, initial.keyboard_layout=="65", None::<&str>)?;
    let kb_108 = CheckMenuItem::with_id(app, "kb_108", "108 键全尺寸（含小键盘）", true, initial.keyboard_layout=="108", None::<&str>)?;
    let kb_sep = PredefinedMenuItem::separator(app)?;
    let kb_cat = CheckMenuItem::with_id(app, "kb_cat", "面向猫咪（180° 真实视角）", true, initial.keyboard_orientation=="cat", None::<&str>)?;
    let kb_viewer = CheckMenuItem::with_id(app, "kb_viewer", "面向观众（正向字母易读）", true, initial.keyboard_orientation=="viewer", None::<&str>)?;
    let kb_menu = Submenu::with_items(
        app,
        "键盘配列与方向",
        true,
        &[&kb_65, &kb_108, &kb_sep, &kb_cat, &kb_viewer],
    )?;

    let tail_smart = CheckMenuItem::with_id(app, "tail_smart", "智能第三只手（忙时出尾）", true, cat_active && initial.tail_key_mode=="smart", None::<&str>)?;
    let tail_custom = CheckMenuItem::with_id(app, "tail_custom", "自定义尾巴按键", true, cat_active && initial.tail_key_mode=="custom", None::<&str>)?;
    let tail_edge = CheckMenuItem::with_id(app, "tail_edge", "近尾边缘区（不拆 WASD）", true, cat_active && initial.tail_key_mode=="edge", None::<&str>)?;
    let tail_off = CheckMenuItem::with_id(app, "tail_off", "仅摆动不拍键", true, cat_active && initial.tail_key_mode=="off", None::<&str>)?;
    let tail_sep = PredefinedMenuItem::separator(app)?;
    let tail_pick = MenuItem::with_id(app, "tail_pick_keys", "🐾 在键盘上点选尾巴按键…", true, None::<&str>)?;
    let tail_menu = Submenu::with_items(
        app,
        if cat_active {"尾巴拍键模式"} else {"尾巴拍键模式（由人物包控制）"},
        cat_active,
        &[
            &tail_smart,
            &tail_custom,
            &tail_edge,
            &tail_off,
            &tail_sep,
            &tail_pick,
        ],
    )?;

    let reset_pos = MenuItem::with_id(app, "reset_pos", "重置位置到右下角", true, None::<&str>)?;
    #[cfg(windows)]
    let desktop_shortcut =
        MenuItem::with_id(app, "desktop_shortcut", "创建桌面快捷方式 (KuroCat)", true, None::<&str>)?;
    #[cfg(target_os = "macos")]
    let mac_input_menu = {
        let mac_reconnect = MenuItem::with_id(
            app,
            "mac_reconnect_input",
            "重新连接键盘监听（兼容 Karabiner）",
            true,
            None::<&str>,
        )?;
        let mac_diag = MenuItem::with_id(
            app,
            "mac_diagnose_input",
            "查看键盘监听与权限诊断",
            true,
            None::<&str>,
        )?;
        let mac_sep = PredefinedMenuItem::separator(app)?;
        let mac_open_listen = MenuItem::with_id(
            app,
            "mac_open_input_monitoring",
            "打开「输入监控」隐私设置",
            true,
            None::<&str>,
        )?;
        let mac_open_ax = MenuItem::with_id(
            app,
            "mac_open_accessibility",
            "打开「辅助功能」隐私设置",
            true,
            None::<&str>,
        )?;
        Submenu::with_items(
            app,
            "键盘监听与权限",
            true,
            &[
                &mac_reconnect,
                &mac_diag,
                &mac_sep,
                &mac_open_listen,
                &mac_open_ax,
            ],
        )?
    };
    let check_update = MenuItem::with_id(
        app,
        "check_update",
        format!("检查更新 (v{})", crate::updater::CURRENT_VERSION),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出 KuroCat", true, None::<&str>)?;

    let character_menu = Submenu::with_id(app,"character-menu","导入人物 · 2D",true)?;
    refresh_character_menu(app,&character_menu)?;
    let character_menu_for_click = character_menu.clone();
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    #[cfg(windows)]
    let menu = Menu::with_items(
        app,
        &[
            &toggle_show,
            &pause_guard,
            &restart_as_admin,
            &sep1,
            &click_through,
            &privacy_guard,
            &key_bubbles,
            &sound_toggle,
            &always_on_top,
            &breed_menu,
            &character_menu,
            &kb_menu,
            &tail_menu,
            &scale_menu,
            &desktop_shortcut,
            &display_menu,
            &reset_pos,
            &autostart,
            &obs_menu,
            &mcp_toggle,
            &check_update,
            &sep2,
            &quit,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &toggle_show,
            &pause_guard,
            &sep1,
            &click_through,
            &privacy_guard,
            &key_bubbles,
            &sound_toggle,
            &always_on_top,
            &breed_menu,
            &character_menu,
            &kb_menu,
            &tail_menu,
            &scale_menu,
            &mac_input_menu,
            &display_menu,
            &reset_pos,
            &autostart,
            &obs_menu,
            &mcp_toggle,
            &check_update,
            &sep2,
            &quit,
        ],
    )?;

    #[cfg(all(not(windows), not(target_os = "macos")))]
    let menu = Menu::with_items(
        app,
        &[
            &toggle_show,
            &pause_guard,
            &sep1,
            &click_through,
            &privacy_guard,
            &key_bubbles,
            &sound_toggle,
            &always_on_top,
            &breed_menu,
            &character_menu,
            &kb_menu,
            &tail_menu,
            &scale_menu,
            &reset_pos,
            &autostart,
            &obs_menu,
            &mcp_toggle,
            &check_update,
            &sep2,
            &quit,
        ],
    )?;

    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
    let pause_guard_for_click = pause_guard.clone();

    // Keep tray checkmarks synchronized when settings change from right-click menu, toast, or MCP.
    {
        let ct = click_through.clone();
        let kb = key_bubbles.clone();
        let pg = privacy_guard.clone();
        let st = sound_toggle.clone();
        let aot = always_on_top.clone();
        let auto = autostart.clone();
        let ot = obs_toggle.clone();
        let oh = obs_hide_pet.clone();
        let mt = mcp_toggle.clone();
        let breeds = [
            (breed_black.clone(), "black"), (breed_ragdoll.clone(), "ragdoll"),
            (breed_orange.clone(), "orange-tabby"), (breed_calico.clone(), "calico"),
            (breed_tuxedo.clone(), "tuxedo"), (breed_siamese.clone(), "siamese"),
            (breed_dafeiyu.clone(), "dafeiyu"),
        ];
        let layouts = [(kb_65.clone(), "65"), (kb_108.clone(), "108")];
        let orientations = [(kb_cat.clone(), "cat"), (kb_viewer.clone(), "viewer")];
        let tails = [(tail_smart.clone(), "smart"), (tail_custom.clone(), "custom"), (tail_edge.clone(), "edge"), (tail_off.clone(), "off")];
        let scales = [(scale_25.clone(), 0.25), (scale_50.clone(), 0.5), (scale_75.clone(), 0.75), (scale_100.clone(), 1.0), (scale_125.clone(), 1.25), (scale_150.clone(), 1.5)];
        let character_menu_state = character_menu.clone();
        let scale_menu_state = scale_menu.clone();
        let tail_menu_state = tail_menu.clone();
        app.listen("kuro-settings", move |ev| {
            if let Ok(s) = serde_json::from_str::<AppSettings>(ev.payload()) {
                let _ = sync_character_checks(&character_menu_state, &s);
                for (item, id) in &breeds {
                    let _ = item.set_checked(s.active_character_id.is_none() && s.cat_breed == *id);
                }
                for (item, id) in &layouts { let _ = item.set_checked(s.keyboard_layout == *id); }
                for (item, id) in &orientations { let _ = item.set_checked(s.keyboard_orientation == *id); }
                for (item, id) in &tails { let _ = item.set_checked(s.active_character_id.is_none() && s.tail_key_mode == *id); }
                for (item, value) in &scales { let _ = item.set_checked(scale_is_selected(s.scale, *value)); }
                let _ = scale_menu_state.set_text(format!("缩放大小（当前 {:.0}%）",s.scale*100.0));
                let _ = tail_menu_state.set_enabled(s.active_character_id.is_none());
                let _ = tail_menu_state.set_text(if s.active_character_id.is_none() {"尾巴拍键模式"} else {"尾巴拍键模式（由人物包控制）"});
                let _ = ct.set_checked(s.click_through_locked);
                let _ = kb.set_checked(s.show_key_bubbles);
                let _ = pg.set_checked(s.privacy_password_guard);
                let _ = st.set_checked(s.sound_enabled);
                let _ = aot.set_checked(s.always_on_top);
                let _ = auto.set_checked(s.autostart);
                let _ = ot.set_checked(s.obs_enabled);
                let _ = oh.set_checked(s.obs_enabled && s.obs_hide_pet);
                let _ = mt.set_checked(s.mcp_enabled);
            }
        });
    }

    TrayIconBuilder::with_id("kuro-tray")
        .icon(icon)
        .tooltip(default_tray_tooltip())
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(move |tray, event| {
            if matches!(&event, TrayIconEvent::Click { .. }) {
                let _ = refresh_character_menu(tray.app_handle(), &character_menu_for_click);
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let state = app.state::<AppState>();
                if state.paused_guard.load(std::sync::atomic::Ordering::SeqCst) {
                    state
                        .paused_guard
                        .store(false, std::sync::atomic::Ordering::SeqCst);
                    crate::input_hook::set_hooks_paused(false);
                    let _ = pause_guard_for_click.set_checked(false);
                    let _ = tray.set_tooltip(Some(default_tray_tooltip()));
                    set_pet_visible(app, true);
                } else {
                    let vis = is_pet_visible(app);
                    set_pet_visible(app, !vis);
                }
            }
        })
        .on_menu_event(move |app, event| {
            if let Some(choice) = event.id().as_ref().strip_prefix("character:") {
                if let Some((id,outfit)) = choice.split_once(':') {
                    match crate::character_selection::choose(id,Some(outfit),true) {
                        Ok(_) => {
                            crate::reload_and_emit_all(app);
                            let _ = app.emit("kuro-character-selection-error", "");
                            if let Some(tray) = app.tray_by_id("kuro-tray") {
                                let paused = app.state::<AppState>().paused_guard.load(std::sync::atomic::Ordering::SeqCst);
                                let tooltip = if paused { "KuroCat（已暂停监听 · 反作弊护航中）" } else { default_tray_tooltip() };
                                let _ = tray.set_tooltip(Some(tooltip));
                            }
                        }
                        Err(error) => {
                            let message = format!("人物切换失败（{}）：{}；保留原选择，请重试或重新导入。", error.code, error.message);
                            eprintln!("{message}");
                            let _ = app.emit("kuro-character-selection-error", &message);
                            if let Some(tray) = app.tray_by_id("kuro-tray") {
                                let _ = tray.set_tooltip(Some(&message));
                            }
                        }
                    }
                }
                // Native check items toggle before dispatch, including when selection fails
                // or the already-selected outfit is clicked again. Restore committed state.
                let settings = app.state::<AppState>().settings.lock().unwrap().clone();
                let _ = sync_character_checks(&character_menu, &settings);
                return;
            }
            let state = app.state::<AppState>();
            match event.id().as_ref() {
                "toggle_show" => {
                    if state.paused_guard.load(std::sync::atomic::Ordering::SeqCst) {
                        state
                            .paused_guard
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        crate::input_hook::set_hooks_paused(false);
                        let _ = pause_guard.set_checked(false);
                        if let Some(tray) = app.tray_by_id("kuro-tray") {
                            let _ = tray.set_tooltip(Some(default_tray_tooltip()));
                        }
                        set_pet_visible(app, true);
                    } else {
                        let next_vis = !is_pet_visible(app);
                        if next_vis {
                            let mut s = state.settings.lock().unwrap();
                            if s.obs_hide_pet {
                                s.obs_hide_pet = false;
                                crate::config::save_settings(&mut s,&["obsHidePet"]);
                                let _ = obs_hide_pet.set_checked(false);
                                let _ = app.emit("kuro-settings", s.clone());
                            }
                        }
                        set_pet_visible(app, next_vis);
                    }
                }
                "pause_guard" => {
                    let next = !state
                        .paused_guard
                        .load(std::sync::atomic::Ordering::SeqCst);
                    state
                        .paused_guard
                        .store(next, std::sync::atomic::Ordering::SeqCst);
                    crate::input_hook::set_hooks_paused(next);
                    let _ = pause_guard.set_checked(next);
                    if let Some(tray) = app.tray_by_id("kuro-tray") {
                        let tip = if next {
                            "KuroCat（已暂停监听 · 反作弊护航中）"
                        } else {
                            default_tray_tooltip()
                        };
                        let _ = tray.set_tooltip(Some(tip));
                    }
                    set_pet_visible(app, !next);
                }
                #[cfg(windows)]
                "restart_as_admin" => {
                    if !crate::win_is_elevated() {
                        crate::win_restart_as_admin(app.clone());
                    }
                }
                "click_through" => {
                    let mut s = state.settings.lock().unwrap();
                    s.click_through_locked = !s.click_through_locked;
                    crate::config::save_settings(&mut s,&["clickThroughLocked"]);
                    let locked = s.click_through_locked;
                    let _ = click_through.set_checked(locked);
                    let _ = app.emit("kuro-settings", s.clone());
                }
                "key_bubbles" => {
                    let mut s = state.settings.lock().unwrap();
                    s.show_key_bubbles = !s.show_key_bubbles;
                    crate::config::save_settings(&mut s,&["showKeyBubbles"]);
                    let enabled = s.show_key_bubbles;
                    let _ = key_bubbles.set_checked(enabled);
                    let _ = app.emit("kuro-settings", s.clone());
                }
                "privacy_guard" => {
                    let mut s = state.settings.lock().unwrap();
                    s.privacy_password_guard = !s.privacy_password_guard;
                    crate::config::save_settings(&mut s,&["privacyPasswordGuard"]);
                    let enabled = s.privacy_password_guard;
                    let _ = privacy_guard.set_checked(enabled);
                    let _ = app.emit("kuro-settings", s.clone());
                }
                "sound_toggle" => {
                    let mut s = state.settings.lock().unwrap();
                    s.sound_enabled = !s.sound_enabled;
                    crate::config::save_settings(&mut s,&["soundEnabled"]);
                    let enabled = s.sound_enabled;
                    let _ = sound_toggle.set_checked(enabled);
                    let _ = app.emit("kuro-settings", s.clone());
                }
                "always_on_top" => {
                    let (on_top, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        s.always_on_top = !s.always_on_top;
                        crate::config::save_settings(&mut s,&["alwaysOnTop"]);
                        let on_top = s.always_on_top;
                        (on_top, s.clone())
                    };
                    let _ = always_on_top.set_checked(on_top);
                    set_pet_always_on_top(app, on_top);
                    let _ = app.emit("kuro-settings", updated);
                }
                "autostart" => {
                    let mut s = state.settings.lock().unwrap();
                    let next = !s.autostart;
                    if crate::config::set_windows_autostart(next).is_ok() {
                        s.autostart = next;
                        crate::config::save_settings(&mut s,&["autostart"]);
                        let _ = app.emit("kuro-settings", s.clone());
                    }
                    // A rejected system operation must undo the native auto-toggle too.
                    let _ = autostart.set_checked(s.autostart);
                }
                "obs_toggle" => {
                    let (enabled, port, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        s.obs_enabled = !s.obs_enabled;
                        if !s.obs_enabled {
                            s.obs_hide_pet = false;
                        }
                        if s.obs_port == 0 {
                            s.obs_port = 27421;
                        }
                        crate::config::save_settings(&mut s,&["obsEnabled","obsHidePet","obsPort"]);
                        (s.obs_enabled, s.obs_port, s.clone())
                    };
                    crate::obs::sync_obs_server(app, enabled, port);
                    let _ = obs_toggle.set_checked(enabled);
                    if !enabled {
                        let _ = obs_hide_pet.set_checked(false);
                        if !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed) {
                            set_pet_visible(app, true);
                        }
                    }
                    let _ = app.emit("kuro-settings", updated);
                }
                "obs_hide_pet" => {
                    let (hide_now, port, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        let next_hide = !(s.obs_enabled && s.obs_hide_pet);
                        if next_hide && !s.obs_enabled {
                            s.obs_enabled = true;
                        }
                        if s.obs_port == 0 {
                            s.obs_port = 27421;
                        }
                        s.obs_hide_pet = next_hide;
                        crate::config::save_settings(&mut s,&["obsEnabled","obsHidePet","obsPort"]);
                        (s.obs_enabled&&s.obs_hide_pet, s.obs_port, s.clone())
                    };
                    crate::obs::sync_obs_server(app, updated.obs_enabled, port);
                    let _ = obs_toggle.set_checked(updated.obs_enabled);
                    let _ = obs_hide_pet.set_checked(hide_now);
                    if !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed) {
                        set_pet_visible(app, !hide_now);
                    }
                    let _ = app.emit("kuro-settings", updated);
                }
                "obs_open_browser" => {
                    let (port, enabled_changed, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        if s.obs_port == 0 {
                            s.obs_port = 27421;
                        }
                        let changed = !s.obs_enabled;
                        if changed {
                            s.obs_enabled = true;
                            crate::config::save_settings(&mut s,&["obsEnabled","obsPort"]);
                        }
                        (s.obs_port, changed, s.clone())
                    };
                    crate::obs::sync_obs_server(app, true, port);
                    if enabled_changed {
                        let _ = obs_toggle.set_checked(true);
                        let _ = app.emit("kuro-settings", updated);
                    }
                    crate::updater::open_url_in_browser(&crate::obs::obs_url(port));
                }
                "mcp_toggle" => {
                    let mut s = state.settings.lock().unwrap();
                    s.mcp_enabled = !s.mcp_enabled;
                    crate::config::save_settings(&mut s,&["mcpEnabled"]);
                    let enabled = s.mcp_enabled;
                    state
                        .mcp_enabled
                        .store(enabled, std::sync::atomic::Ordering::Relaxed);
                    let _ = mcp_toggle.set_checked(enabled);
                    let _ = app.emit("kuro-settings", s.clone());
                }
                "breed_black" => apply_breed_and_save(app, "black"),
                "breed_ragdoll" => apply_breed_and_save(app, "ragdoll"),
                "breed_orange" => apply_breed_and_save(app, "orange-tabby"),
                "breed_calico" => apply_breed_and_save(app, "calico"),
                "breed_tuxedo" => apply_breed_and_save(app, "tuxedo"),
                "breed_siamese" => apply_breed_and_save(app, "siamese"),
                "breed_dafeiyu" => apply_breed_and_save(app, "dafeiyu"),
                "scale_25" => apply_scale_and_save(app, 0.25),
                "scale_50" => apply_scale_and_save(app, 0.5),
                "scale_75" => apply_scale_and_save(app, 0.75),
                "scale_100" => apply_scale_and_save(app, 1.0),
                "scale_125" => apply_scale_and_save(app, 1.25),
                "scale_150" => apply_scale_and_save(app, 1.5),
                "kb_65" => apply_keyboard_layout_and_save(app, "65"),
                "kb_108" => apply_keyboard_layout_and_save(app, "108"),
                "kb_cat" => apply_keyboard_orientation_and_save(app, "cat"),
                "kb_viewer" => apply_keyboard_orientation_and_save(app, "viewer"),
                "tail_smart" => apply_tail_key_mode_and_save(app, "smart"),
                "tail_custom" => apply_tail_key_mode_and_save(app, "custom"),
                "tail_edge" => apply_tail_key_mode_and_save(app, "edge"),
                "tail_off" => apply_tail_key_mode_and_save(app, "off"),
                "tail_pick_keys" => {
                    set_pet_visible(app, true);
                    let _ = app.emit("kuro-open-tail-picker", ());
                }
                "desktop_shortcut" => {
                    let _ = crate::config::create_desktop_shortcut();
                }
                #[cfg(target_os = "macos")]
                "mac_reconnect_input" => {
                    crate::input_hook::macos_hook::trigger_macos_reconnect();
                }
                #[cfg(target_os = "macos")]
                "mac_diagnose_input" => {
                    crate::input_hook::macos_hook::show_macos_diagnostics_dialog();
                }
                #[cfg(target_os = "macos")]
                "mac_open_input_monitoring" => {
                    crate::input_hook::macos_hook::open_macos_privacy_pane("input_monitoring");
                }
                #[cfg(target_os = "macos")]
                "mac_open_accessibility" => {
                    crate::input_hook::macos_hook::open_macos_privacy_pane("accessibility");
                }
                "check_update" => {
                    let app_clone = app.clone();
                    set_pet_visible(app, true);
                    let _ = app_clone.emit(
                        "kuro-update-status",
                        crate::updater::UpdateProgressEvent {
                            stage: "checking".to_string(),
                            message: "正在检查新版本...".to_string(),
                            info: None,
                        },
                    );
                    std::thread::spawn(move || match crate::updater::check_latest_update() {
                        Ok(info) => {
                            let (stage, msg) = if info.has_update {
                                ("available", format!("发现新版本 v{}", info.latest_version))
                            } else {
                                ("up_to_date", format!("已是最新版本 v{}", info.current_version))
                            };
                            let _ = app_clone.emit(
                                "kuro-update-status",
                                crate::updater::UpdateProgressEvent {
                                    stage: stage.to_string(),
                                    message: msg,
                                    info: Some(info),
                                },
                            );
                        }
                        Err(err) => {
                            let _ = app_clone.emit(
                                "kuro-update-status",
                                crate::updater::UpdateProgressEvent {
                                    stage: "error".to_string(),
                                    message: err,
                                    info: None,
                                },
                            );
                        }
                    });
                }
                "reset_pos" => reset_window_position(app),
                "quit" => {
                    shutdown_pet_windows();
                    app.exit(0);
                }
                _ => {
                    #[cfg(windows)]
                    crate::windows_display::handle_menu(app, event.id().as_ref());
                    #[cfg(target_os = "macos")]
                    crate::macos_window::handle_display_menu(app, event.id().as_ref());
                }
            }
        })
        .build(app)?;

    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_checks_require_an_exact_preset() {
        let presets = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
        for selected in presets {
            let checked: Vec<_> = presets.into_iter().filter(|preset| scale_is_selected(selected, *preset)).collect();
            assert_eq!(checked, vec![selected]);
        }
        for custom in [0.2, 0.76, 0.749999, 0.750001, 1.000001, f64::NAN] {
            assert!(presets.into_iter().all(|preset| !scale_is_selected(custom, preset)));
        }
    }

    #[test]
    fn character_checks_follow_identity_outfit_and_legacy_exit() {
        let mut settings = AppSettings::default();
        settings.character_outfits.insert("motion-fixture".into(), "primary".into());
        settings.character_outfits.insert("native-race".into(), "alternate".into());
        let choices = ["character:motion-fixture:primary", "character:motion-fixture:alternate", "character:native-race:alternate"];
        let checked = |settings: &AppSettings| choices.into_iter().filter(|id| character_item_is_selected(id, settings)).collect::<Vec<_>>();
        assert!(checked(&settings).is_empty());
        settings.active_character_id = Some("motion-fixture".into());
        assert_eq!(checked(&settings), vec![choices[0]]);
        settings.character_outfits.insert("motion-fixture".into(), "alternate".into());
        assert_eq!(checked(&settings), vec![choices[1]]);
        settings.active_character_id = Some("native-race".into());
        assert_eq!(checked(&settings), vec![choices[2]]);
        settings.active_character_id = None;
        assert!(checked(&settings).is_empty());
    }
}
