use crate::cats::{all_cats, CatSkinConfig};
use crate::config::AppSettings;
use crate::i18n::{platform_click_through_key, t, tf};
use crate::{
    apply_breed_and_save, apply_keyboard_layout_and_save, apply_keyboard_orientation_and_save,
    apply_scale_and_save, apply_tail_key_mode_and_save, is_pet_visible, reset_window_position,
    set_pet_always_on_top, set_pet_visible, shutdown_pet_windows, AppState,
};
use std::sync::{Mutex, OnceLock};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, Wry};

#[derive(Clone)]
struct TrayCheckHandles {
    feed_treat: MenuItem<Wry>,
    pause_guard: CheckMenuItem<Wry>,
    click_through: CheckMenuItem<Wry>,
    key_bubbles: CheckMenuItem<Wry>,
    privacy_guard: CheckMenuItem<Wry>,
    sound_toggle: CheckMenuItem<Wry>,
    idle_purr_toggle: CheckMenuItem<Wry>,
    typing_sound_toggle: CheckMenuItem<Wry>,
    sound_muted: CheckMenuItem<Wry>,
    vol_100: CheckMenuItem<Wry>,
    vol_75: CheckMenuItem<Wry>,
    vol_50: CheckMenuItem<Wry>,
    vol_25: CheckMenuItem<Wry>,
    always_on_top: CheckMenuItem<Wry>,
    yield_on_fullscreen: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    #[cfg(windows)]
    autostart_admin: CheckMenuItem<Wry>,
    obs_toggle: CheckMenuItem<Wry>,
    obs_hide_pet: CheckMenuItem<Wry>,
    live_capture_toggle: CheckMenuItem<Wry>,
    live_hide_pet: CheckMenuItem<Wry>,
    mcp_toggle: CheckMenuItem<Wry>,
    breed_items: Vec<(String, CheckMenuItem<Wry>)>,
    scale_25: CheckMenuItem<Wry>,
    scale_50: CheckMenuItem<Wry>,
    scale_75: CheckMenuItem<Wry>,
    scale_100: CheckMenuItem<Wry>,
    scale_125: CheckMenuItem<Wry>,
    scale_150: CheckMenuItem<Wry>,
    kb_65: CheckMenuItem<Wry>,
    kb_98: CheckMenuItem<Wry>,
    kb_108: CheckMenuItem<Wry>,
    kb_macbook: CheckMenuItem<Wry>,
    finish_black: CheckMenuItem<Wry>,
    finish_white: CheckMenuItem<Wry>,
    #[cfg(target_os = "macos")]
    device_mouse: CheckMenuItem<Wry>,
    #[cfg(target_os = "macos")]
    device_pad: CheckMenuItem<Wry>,
    kb_cat: CheckMenuItem<Wry>,
    kb_viewer: CheckMenuItem<Wry>,
    tail_smart: CheckMenuItem<Wry>,
    tail_custom: CheckMenuItem<Wry>,
    tail_edge: CheckMenuItem<Wry>,
    tail_off: CheckMenuItem<Wry>,
    fps_60: CheckMenuItem<Wry>,
    fps_30: CheckMenuItem<Wry>,
    lang_auto: CheckMenuItem<Wry>,
    lang_zh_cn: CheckMenuItem<Wry>,
    lang_zh_tw: CheckMenuItem<Wry>,
    lang_en_us: CheckMenuItem<Wry>,
    lang_ja_jp: CheckMenuItem<Wry>,
    lang_ko_kr: CheckMenuItem<Wry>,
    lang_es_es: CheckMenuItem<Wry>,
    lang_pt_br: CheckMenuItem<Wry>,
    lang_ru_ru: CheckMenuItem<Wry>,
    lang_de_de: CheckMenuItem<Wry>,
}

fn active_handles() -> &'static Mutex<Option<TrayCheckHandles>> {
    static HANDLES: OnceLock<Mutex<Option<TrayCheckHandles>>> = OnceLock::new();
    HANDLES.get_or_init(|| Mutex::new(None))
}

fn default_tray_tooltip(lang: &str) -> String {
    #[cfg(windows)]
    {
        if crate::win_is_elevated() {
            return t(lang, "tray.tooltip_admin");
        }
    }
    t(lang, "tray.tooltip")
}

fn format_tray_breed_label(lang: &str, cat: &CatSkinConfig) -> String {
    let display_name = if cat.builtin {
        let key = format!("breeds.{}", cat.id);
        let localized = t(lang, &key);
        if localized == key {
            cat.name.clone()
        } else {
            localized
        }
    } else {
        cat.name.clone()
    };
    if let Some(emoji) = cat.emoji.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        if display_name.starts_with(emoji) {
            display_name
        } else {
            format!("{} {}", emoji, display_name)
        }
    } else {
        format!("🐱 {}", display_name)
    }
}

/// Builds a dynamic, anti-crowding Pet Skin submenu containing all built-in and custom skins
/// with live checkmarks. When a user adds many custom MCP skins, they automatically fold into
/// a clean nested submenu (and 12-item pages past 14 skins) so the native tray menu never overflows.
fn build_breed_submenu(
    app: &AppHandle,
    lang: &str,
    active_breed: &str,
) -> tauri::Result<(Submenu<Wry>, Vec<(String, CheckMenuItem<Wry>)>)> {
    let cats = all_cats();
    let mut builtins: Vec<CatSkinConfig> = Vec::new();
    let mut customs: Vec<CatSkinConfig> = Vec::new();
    for cat in cats {
        if cat.builtin {
            builtins.push(cat);
        } else {
            customs.push(cat);
        }
    }

    let mut handles: Vec<(String, CheckMenuItem<Wry>)> = Vec::new();
    let mut builtin_items: Vec<CheckMenuItem<Wry>> = Vec::with_capacity(builtins.len());
    for cat in &builtins {
        let item = CheckMenuItem::with_id(
            app,
            format!("breed_id:{}", cat.id),
            format_tray_breed_label(lang, cat),
            true,
            cat.id == active_breed,
            None::<&str>,
        )?;
        handles.push((cat.id.clone(), item.clone()));
        builtin_items.push(item);
    }

    let submenu = Submenu::new(app, t(lang, "tray.breed_menu"), true)?;
    for item in &builtin_items {
        submenu.append(item)?;
    }

    if !customs.is_empty() {
        let sep = PredefinedMenuItem::separator(app)?;
        submenu.append(&sep)?;

        if customs.len() <= 6 {
            for cat in &customs {
                let item = CheckMenuItem::with_id(
                    app,
                    format!("breed_id:{}", cat.id),
                    format_tray_breed_label(lang, cat),
                    true,
                    cat.id == active_breed,
                    None::<&str>,
                )?;
                handles.push((cat.id.clone(), item.clone()));
                submenu.append(&item)?;
            }
        } else {
            let custom_title = tf(
                lang,
                "tray.breed_custom_menu",
                &[("count", customs.len().to_string())],
            );
            let custom_submenu = Submenu::new(app, custom_title, true)?;
            if customs.len() <= 14 {
                for cat in &customs {
                    let item = CheckMenuItem::with_id(
                        app,
                        format!("breed_id:{}", cat.id),
                        format_tray_breed_label(lang, cat),
                        true,
                        cat.id == active_breed,
                        None::<&str>,
                    )?;
                    handles.push((cat.id.clone(), item.clone()));
                    custom_submenu.append(&item)?;
                }
            } else {
                const PAGE_SIZE: usize = 12;
                for (page_idx, chunk) in customs.chunks(PAGE_SIZE).enumerate() {
                    let from = page_idx * PAGE_SIZE + 1;
                    let to = from + chunk.len() - 1;
                    let page_title = tf(
                        lang,
                        "tray.breed_page",
                        &[("from", from.to_string()), ("to", to.to_string())],
                    );
                    let page_menu = Submenu::new(app, page_title, true)?;
                    for cat in chunk {
                        let item = CheckMenuItem::with_id(
                            app,
                            format!("breed_id:{}", cat.id),
                            format_tray_breed_label(lang, cat),
                            true,
                            cat.id == active_breed,
                            None::<&str>,
                        )?;
                        handles.push((cat.id.clone(), item.clone()));
                        page_menu.append(&item)?;
                    }
                    custom_submenu.append(&page_menu)?;
                }
            }
            submenu.append(&custom_submenu)?;
        }
    }

    Ok((submenu, handles))
}

pub fn sync_checkmarks(s: &AppSettings) {
    if let Ok(guard) = active_handles().lock() {
        if let Some(h) = guard.as_ref() {
            let _ = h.feed_treat.set_enabled(s.cat_breed != "dafeiyu");
            let _ = h.click_through.set_checked(s.click_through_locked);
            let _ = h.key_bubbles.set_checked(s.show_key_bubbles);
            let _ = h.privacy_guard.set_checked(s.privacy_password_guard);
            let _ = h.sound_toggle.set_checked(s.sound_enabled);
            let _ = h.idle_purr_toggle.set_checked(s.idle_purr_enabled);
            let _ = h.typing_sound_toggle.set_checked(s.typing_sound_enabled);
            let effectively_muted = s.sound_muted || s.sound_volume <= 0.001;
            let _ = h.sound_muted.set_checked(effectively_muted);
            let _ = h
                .vol_100
                .set_checked(!effectively_muted && (s.sound_volume - 1.00).abs() < 0.02);
            let _ = h
                .vol_75
                .set_checked(!effectively_muted && (s.sound_volume - 0.75).abs() < 0.02);
            let _ = h
                .vol_50
                .set_checked(!effectively_muted && (s.sound_volume - 0.50).abs() < 0.02);
            let _ = h
                .vol_25
                .set_checked(!effectively_muted && (s.sound_volume - 0.25).abs() < 0.02);
            let _ = h.always_on_top.set_checked(s.always_on_top);
            let _ = h.yield_on_fullscreen.set_checked(s.yield_on_fullscreen);
            let _ = h.autostart.set_checked(s.autostart);
            #[cfg(windows)]
            let _ = h.autostart_admin.set_checked(s.autostart && s.autostart_admin);
            let _ = h.obs_toggle.set_checked(s.obs_enabled);
            let _ = h.obs_hide_pet.set_checked(s.obs_enabled && s.obs_hide_pet);
            let _ = h.live_capture_toggle.set_checked(s.live_capture_enabled);
            let _ = h
                .live_hide_pet
                .set_checked(s.live_capture_enabled && s.live_hide_pet);
            let _ = h.mcp_toggle.set_checked(s.mcp_enabled);
            for (id, item) in &h.breed_items {
                let _ = item.set_checked(id == &s.cat_breed);
            }
            let _ = h.scale_25.set_checked((s.scale - 0.25).abs() < 0.015);
            let _ = h.scale_50.set_checked((s.scale - 0.50).abs() < 0.015);
            let _ = h.scale_75.set_checked((s.scale - 0.75).abs() < 0.015);
            let _ = h.scale_100.set_checked((s.scale - 1.00).abs() < 0.015);
            let _ = h.scale_125.set_checked((s.scale - 1.25).abs() < 0.015);
            let _ = h.scale_150.set_checked((s.scale - 1.50).abs() < 0.015);
            let _ = h.kb_65.set_checked(s.keyboard_layout == "65");
            let _ = h.kb_98.set_checked(s.keyboard_layout == "98");
            let _ = h.kb_108.set_checked(s.keyboard_layout == "108");
            let _ = h.kb_macbook.set_checked(s.keyboard_layout == "macbook");
            let _ = h.finish_black.set_checked(!s.white_keyboard);
            let _ = h.finish_white.set_checked(s.white_keyboard);
            #[cfg(target_os = "macos")]
            {
                let _ = h.device_mouse.set_checked(!s.trackpad_enabled);
                let _ = h.device_pad.set_checked(s.trackpad_enabled);
            }
            let _ = h.kb_cat.set_checked(s.keyboard_orientation != "viewer");
            let _ = h.kb_viewer.set_checked(s.keyboard_orientation == "viewer");
            let _ = h.tail_smart.set_checked(s.tail_key_mode == "smart");
            let _ = h.tail_custom.set_checked(s.tail_key_mode == "custom");
            let _ = h.tail_edge.set_checked(s.tail_key_mode == "edge");
            let _ = h.tail_off.set_checked(s.tail_key_mode == "off");
            let _ = h.fps_30.set_checked(s.fps_cap == 30);
            let _ = h.fps_60.set_checked(s.fps_cap != 30);
            let _ = h.lang_auto.set_checked(s.language == "auto");
            let _ = h.lang_zh_cn.set_checked(s.language == "zh-CN");
            let _ = h.lang_zh_tw.set_checked(s.language == "zh-TW");
            let _ = h.lang_en_us.set_checked(s.language == "en-US");
            let _ = h.lang_ja_jp.set_checked(s.language == "ja-JP");
            let _ = h.lang_ko_kr.set_checked(s.language == "ko-KR");
            let _ = h.lang_es_es.set_checked(s.language == "es-ES");
            let _ = h.lang_pt_br.set_checked(s.language == "pt-BR");
            let _ = h.lang_ru_ru.set_checked(s.language == "ru-RU");
            let _ = h.lang_de_de.set_checked(s.language == "de-DE");
        }
    }
}

fn build_tray_menu(
    app: &AppHandle,
    initial: &AppSettings,
    paused: bool,
) -> tauri::Result<(Menu<Wry>, TrayCheckHandles)> {
    let lang = initial.language.as_str();

    #[cfg(windows)]
    let display_menu = crate::windows_display::create_menu(app)?;
    #[cfg(target_os = "macos")]
    let display_menu = crate::macos_window::create_display_menu(app)?;

    let open_menu = MenuItem::with_id(app, "open_menu", t(lang, "tray.open_menu"), true, None::<&str>)?;
    let feed_treat = MenuItem::with_id(
        app,
        "feed_treat",
        t(lang, "tray.feed_treat"),
        initial.cat_breed != "dafeiyu",
        None::<&str>,
    )?;
    let toggle_show = MenuItem::with_id(app, "toggle_show", t(lang, "tray.toggle_show"), true, None::<&str>)?;
    let pause_guard_label = if initial.pause_hotkey.is_empty() {
        t(lang, "tray.pause_guard")
    } else {
        format!("{} [{}]", t(lang, "tray.pause_guard"), initial.pause_hotkey)
    };
    let pause_guard = CheckMenuItem::with_id(
        app,
        "pause_guard",
        pause_guard_label,
        true,
        paused,
        None::<&str>,
    )?;
    #[cfg(windows)]
    let restart_as_admin = {
        let elevated = crate::win_is_elevated();
        let label = if elevated {
            t(lang, "tray.admin_ready")
        } else {
            t(lang, "tray.admin_restart")
        };
        MenuItem::with_id(app, "restart_as_admin", label, !elevated, None::<&str>)?
    };

    let click_through = CheckMenuItem::with_id(
        app,
        "click_through",
        t(lang, platform_click_through_key()),
        true,
        initial.click_through_locked,
        None::<&str>,
    )?;
    let key_bubbles = CheckMenuItem::with_id(
        app,
        "key_bubbles",
        t(lang, "tray.key_bubbles"),
        true,
        initial.show_key_bubbles,
        None::<&str>,
    )?;
    let privacy_guard = CheckMenuItem::with_id(
        app,
        "privacy_guard",
        t(lang, "tray.privacy_guard"),
        true,
        initial.privacy_password_guard,
        None::<&str>,
    )?;
    let sound_toggle = CheckMenuItem::with_id(
        app,
        "sound_toggle",
        t(lang, "tray.sound_toggle"),
        true,
        initial.sound_enabled,
        None::<&str>,
    )?;
    let idle_purr_toggle = CheckMenuItem::with_id(
        app,
        "idle_purr_toggle",
        t(lang, "tray.idle_purr_toggle"),
        true,
        initial.idle_purr_enabled,
        None::<&str>,
    )?;
    let typing_sound_toggle = CheckMenuItem::with_id(
        app,
        "typing_sound_toggle",
        t(lang, "tray.typing_sound_toggle"),
        true,
        initial.typing_sound_enabled,
        None::<&str>,
    )?;
    let init_muted = initial.sound_muted || initial.sound_volume <= 0.001;
    let sound_muted = CheckMenuItem::with_id(
        app,
        "sound_muted",
        t(lang, "tray.sound_muted"),
        true,
        init_muted,
        None::<&str>,
    )?;
    let vol_100 = CheckMenuItem::with_id(
        app,
        "vol_100",
        "100%",
        true,
        !init_muted && (initial.sound_volume - 1.00).abs() < 0.02,
        None::<&str>,
    )?;
    let vol_75 = CheckMenuItem::with_id(
        app,
        "vol_75",
        "75%",
        true,
        !init_muted && (initial.sound_volume - 0.75).abs() < 0.02,
        None::<&str>,
    )?;
    let vol_50 = CheckMenuItem::with_id(
        app,
        "vol_50",
        "50%",
        true,
        !init_muted && (initial.sound_volume - 0.50).abs() < 0.02,
        None::<&str>,
    )?;
    let vol_25 = CheckMenuItem::with_id(
        app,
        "vol_25",
        "25%",
        true,
        !init_muted && (initial.sound_volume - 0.25).abs() < 0.02,
        None::<&str>,
    )?;
    let vol_sep = PredefinedMenuItem::separator(app)?;
    let volume_menu = Submenu::with_items(
        app,
        t(lang, "tray.volume_menu"),
        true,
        &[
            &vol_100 as &dyn IsMenuItem<Wry>,
            &vol_75,
            &vol_50,
            &vol_25,
            &vol_sep,
            &sound_muted,
        ],
    )?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        "always_on_top",
        t(lang, "tray.always_on_top"),
        true,
        initial.always_on_top,
        None::<&str>,
    )?;
    let yield_on_fullscreen = CheckMenuItem::with_id(
        app,
        "yield_on_fullscreen",
        t(lang, "tray.yield_on_fullscreen"),
        true,
        initial.yield_on_fullscreen,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        t(lang, "tray.autostart"),
        true,
        initial.autostart,
        None::<&str>,
    )?;
    #[cfg(windows)]
    let autostart_admin = CheckMenuItem::with_id(
        app,
        "autostart_admin",
        t(lang, "tray.autostart_admin"),
        true,
        initial.autostart && initial.autostart_admin,
        None::<&str>,
    )?;
    let mcp_toggle = CheckMenuItem::with_id(
        app,
        "mcp_toggle",
        t(lang, "tray.mcp_toggle"),
        true,
        initial.mcp_enabled,
        None::<&str>,
    )?;

    let obs_port = if initial.obs_port == 0 { 27421 } else { initial.obs_port };
    let obs_toggle = CheckMenuItem::with_id(
        app,
        "obs_toggle",
        tf(lang, "tray.obs_toggle", &[("port", obs_port.to_string())]),
        true,
        initial.obs_enabled,
        None::<&str>,
    )?;
    let obs_hide_pet = CheckMenuItem::with_id(
        app,
        "obs_hide_pet",
        t(lang, "tray.obs_hide_pet"),
        true,
        initial.obs_enabled && initial.obs_hide_pet,
        None::<&str>,
    )?;
    let obs_open_browser = MenuItem::with_id(
        app,
        "obs_open_browser",
        t(lang, "tray.obs_open_browser"),
        true,
        None::<&str>,
    )?;
    let obs_sep = PredefinedMenuItem::separator(app)?;
    let live_capture_toggle = CheckMenuItem::with_id(
        app,
        "live_capture_toggle",
        t(lang, "tray.live_capture_toggle"),
        true,
        initial.live_capture_enabled,
        None::<&str>,
    )?;
    let live_hide_pet = CheckMenuItem::with_id(
        app,
        "live_hide_pet",
        t(lang, "tray.live_hide_pet"),
        true,
        initial.live_capture_enabled && initial.live_hide_pet,
        None::<&str>,
    )?;
    let obs_menu = Submenu::with_items(
        app,
        t(lang, "tray.obs_menu"),
        true,
        &[
            &obs_toggle,
            &obs_hide_pet,
            &obs_open_browser,
            &obs_sep,
            &live_capture_toggle,
            &live_hide_pet,
        ],
    )?;

    let (breed_menu, breed_items) = build_breed_submenu(app, lang, &initial.cat_breed)?;

    let scale_25 = CheckMenuItem::with_id(app, "scale_25", t(lang, "tray.scale_25"), true, (initial.scale - 0.25).abs() < 0.015, None::<&str>)?;
    let scale_50 = CheckMenuItem::with_id(app, "scale_50", t(lang, "tray.scale_50"), true, (initial.scale - 0.50).abs() < 0.015, None::<&str>)?;
    let scale_75 = CheckMenuItem::with_id(app, "scale_75", t(lang, "tray.scale_75"), true, (initial.scale - 0.75).abs() < 0.015, None::<&str>)?;
    let scale_100 = CheckMenuItem::with_id(app, "scale_100", t(lang, "tray.scale_100"), true, (initial.scale - 1.00).abs() < 0.015, None::<&str>)?;
    let scale_125 = CheckMenuItem::with_id(app, "scale_125", t(lang, "tray.scale_125"), true, (initial.scale - 1.25).abs() < 0.015, None::<&str>)?;
    let scale_150 = CheckMenuItem::with_id(app, "scale_150", t(lang, "tray.scale_150"), true, (initial.scale - 1.50).abs() < 0.015, None::<&str>)?;
    let scale_menu = Submenu::with_items(
        app,
        t(lang, "tray.scale_menu"),
        true,
        &[&scale_25, &scale_50, &scale_75, &scale_100, &scale_125, &scale_150],
    )?;

    let kb_65 = CheckMenuItem::with_id(app, "kb_65", t(lang, "tray.kb_65"), true, initial.keyboard_layout == "65", None::<&str>)?;
    let kb_98 = CheckMenuItem::with_id(app, "kb_98", t(lang, "tray.kb_98"), true, initial.keyboard_layout == "98", None::<&str>)?;
    let kb_108 = CheckMenuItem::with_id(app, "kb_108", t(lang, "tray.kb_108"), true, initial.keyboard_layout == "108", None::<&str>)?;
    let kb_macbook = CheckMenuItem::with_id(app, "kb_macbook", t(lang, "tray.kb_macbook"), true, initial.keyboard_layout == "macbook", None::<&str>)?;
    let finish_black = CheckMenuItem::with_id(app, "finish_black", t(lang, "menu.kb_black"), true, !initial.white_keyboard, None::<&str>)?;
    let finish_white = CheckMenuItem::with_id(app, "finish_white", t(lang, "menu.kb_white"), true, initial.white_keyboard, None::<&str>)?;
    let finish_menu = Submenu::with_items(app, t(lang, "menu.kb_finish"), true, &[&finish_black, &finish_white])?;
    let kb_sep = PredefinedMenuItem::separator(app)?;
    let kb_cat = CheckMenuItem::with_id(app, "kb_cat", t(lang, "tray.kb_cat"), true, initial.keyboard_orientation != "viewer", None::<&str>)?;
    let kb_viewer = CheckMenuItem::with_id(app, "kb_viewer", t(lang, "tray.kb_viewer"), true, initial.keyboard_orientation == "viewer", None::<&str>)?;
    let kb_menu = Submenu::with_items(
        app,
        t(lang, "tray.kb_menu"),
        true,
        &[
            &kb_65 as &dyn IsMenuItem<Wry>,
            &kb_98,
            &kb_108,
            &kb_macbook,
            &finish_menu,
            &kb_sep,
            &kb_cat,
            &kb_viewer,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let (device_mouse, device_pad) = {
        let dm = CheckMenuItem::with_id(app, "device_mouse", t(lang, "menu.mouse"), true, !initial.trackpad_enabled, None::<&str>)?;
        let dp = CheckMenuItem::with_id(app, "device_pad", t(lang, "menu.trackpad"), true, initial.trackpad_enabled, None::<&str>)?;
        let ptr_menu = Submenu::with_items(app, t(lang, "menu.pointer"), true, &[&dm, &dp])?;
        kb_menu.append(&ptr_menu)?;
        (dm, dp)
    };

    let tail_smart = CheckMenuItem::with_id(app, "tail_smart", t(lang, "tray.tail_smart"), true, initial.tail_key_mode == "smart", None::<&str>)?;
    let tail_custom = CheckMenuItem::with_id(app, "tail_custom", t(lang, "tray.tail_custom"), true, initial.tail_key_mode == "custom", None::<&str>)?;
    let tail_edge = CheckMenuItem::with_id(app, "tail_edge", t(lang, "tray.tail_edge"), true, initial.tail_key_mode == "edge", None::<&str>)?;
    let tail_off = CheckMenuItem::with_id(app, "tail_off", t(lang, "tray.tail_off"), true, initial.tail_key_mode == "off", None::<&str>)?;
    let tail_sep = PredefinedMenuItem::separator(app)?;
    let tail_pick = MenuItem::with_id(app, "tail_pick_keys", t(lang, "tray.tail_pick"), true, None::<&str>)?;
    let tail_menu = Submenu::with_items(
        app,
        t(lang, "tray.tail_menu"),
        true,
        &[
            &tail_smart,
            &tail_custom,
            &tail_edge,
            &tail_off,
            &tail_sep,
            &tail_pick,
        ],
    )?;

    let fps_60 = CheckMenuItem::with_id(app, "fps_60", t(lang, "tray.fps_60"), true, initial.fps_cap != 30, None::<&str>)?;
    let fps_30 = CheckMenuItem::with_id(app, "fps_30", t(lang, "tray.fps_30"), true, initial.fps_cap == 30, None::<&str>)?;
    let fps_menu = Submenu::with_items(app, t(lang, "tray.fps_menu"), true, &[&fps_60, &fps_30])?;

    let lang_auto = CheckMenuItem::with_id(app, "lang_auto", t(lang, "tray.lang_auto"), true, initial.language == "auto", None::<&str>)?;
    let lang_sep = PredefinedMenuItem::separator(app)?;
    let lang_zh_cn = CheckMenuItem::with_id(app, "lang_zh-CN", "简体中文", true, initial.language == "zh-CN", None::<&str>)?;
    let lang_zh_tw = CheckMenuItem::with_id(app, "lang_zh-TW", "繁體中文", true, initial.language == "zh-TW", None::<&str>)?;
    let lang_en_us = CheckMenuItem::with_id(app, "lang_en-US", "English", true, initial.language == "en-US", None::<&str>)?;
    let lang_ja_jp = CheckMenuItem::with_id(app, "lang_ja-JP", "日本語", true, initial.language == "ja-JP", None::<&str>)?;
    let lang_ko_kr = CheckMenuItem::with_id(app, "lang_ko-KR", "한국어", true, initial.language == "ko-KR", None::<&str>)?;
    let lang_es_es = CheckMenuItem::with_id(app, "lang_es-ES", "Español", true, initial.language == "es-ES", None::<&str>)?;
    let lang_pt_br = CheckMenuItem::with_id(app, "lang_pt-BR", "Português", true, initial.language == "pt-BR", None::<&str>)?;
    let lang_ru_ru = CheckMenuItem::with_id(app, "lang_ru-RU", "Русский", true, initial.language == "ru-RU", None::<&str>)?;
    let lang_de_de = CheckMenuItem::with_id(app, "lang_de-DE", "Deutsch", true, initial.language == "de-DE", None::<&str>)?;
    let lang_menu = Submenu::with_items(
        app,
        t(lang, "tray.lang_menu"),
        true,
        &[
            &lang_auto,
            &lang_sep,
            &lang_zh_cn,
            &lang_zh_tw,
            &lang_en_us,
            &lang_ja_jp,
            &lang_ko_kr,
            &lang_es_es,
            &lang_pt_br,
            &lang_ru_ru,
            &lang_de_de,
        ],
    )?;

    let reset_pos = MenuItem::with_id(app, "reset_pos", t(lang, "tray.reset_pos"), true, None::<&str>)?;
    #[cfg(windows)]
    let desktop_shortcut =
        MenuItem::with_id(app, "desktop_shortcut", t(lang, "tray.desktop_shortcut"), true, None::<&str>)?;
    #[cfg(target_os = "macos")]
    let mac_input_menu = {
        let mac_reset_perms = MenuItem::with_id(
            app,
            "mac_reset_permissions",
            t(lang, "tray.mac_reset_perms"),
            true,
            None::<&str>,
        )?;
        let mac_reconnect = MenuItem::with_id(
            app,
            "mac_reconnect_input",
            t(lang, "tray.mac_reconnect"),
            true,
            None::<&str>,
        )?;
        let mac_diag = MenuItem::with_id(
            app,
            "mac_diagnose_input",
            t(lang, "tray.mac_diag"),
            true,
            None::<&str>,
        )?;
        let mac_sep = PredefinedMenuItem::separator(app)?;
        let mac_open_listen = MenuItem::with_id(
            app,
            "mac_open_input_monitoring",
            t(lang, "tray.mac_open_listen"),
            true,
            None::<&str>,
        )?;
        let mac_open_ax = MenuItem::with_id(
            app,
            "mac_open_accessibility",
            t(lang, "tray.mac_open_ax"),
            true,
            None::<&str>,
        )?;
        Submenu::with_items(
            app,
            t(lang, "tray.mac_input_menu"),
            true,
            &[
                &mac_reset_perms,
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
        tf(
            lang,
            "tray.check_update",
            &[("ver", crate::updater::CURRENT_VERSION.to_string())],
        ),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", t(lang, "tray.quit"), true, None::<&str>)?;

    // Consolidate appearance/scale/keyboard/tail/interaction toggles into one clean submenu
    // so the top-level tray popup stays compact and scannable instead of sprawling vertically.
    let appearance_sep = PredefinedMenuItem::separator(app)?;
    let appearance_menu = Submenu::with_items(
        app,
        t(lang, "tray.appearance_menu"),
        true,
        &[
            &scale_menu as &dyn IsMenuItem<Wry>,
            &kb_menu,
            &tail_menu,
            &appearance_sep,
            &privacy_guard,
            &key_bubbles,
            &sound_toggle,
            &idle_purr_toggle,
            &typing_sound_toggle,
            &volume_menu,
            &always_on_top,
            &yield_on_fullscreen,
        ],
    )?;

    let sys_sep = PredefinedMenuItem::separator(app)?;
    #[cfg(windows)]
    let system_menu = Submenu::with_items(
        app,
        t(lang, "tray.system_menu"),
        true,
        &[
            &fps_menu,
            &lang_menu,
            &display_menu,
            &sys_sep,
            &autostart,
            &autostart_admin,
            &mcp_toggle,
            &desktop_shortcut,
            &reset_pos,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let system_menu = Submenu::with_items(
        app,
        t(lang, "tray.system_menu"),
        true,
        &[
            &fps_menu,
            &lang_menu,
            &display_menu,
            &mac_input_menu,
            &sys_sep,
            &autostart,
            &mcp_toggle,
            &reset_pos,
        ],
    )?;
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let system_menu = Submenu::with_items(
        app,
        t(lang, "tray.system_menu"),
        true,
        &[
            &fps_menu,
            &lang_menu,
            &sys_sep,
            &autostart,
            &mcp_toggle,
            &reset_pos,
        ],
    )?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    #[cfg(windows)]
    let menu = Menu::with_items(
        app,
        &[
            &open_menu,
            &feed_treat,
            &toggle_show,
            &click_through,
            &pause_guard,
            &restart_as_admin,
            &sep1,
            &breed_menu,
            &appearance_menu,
            &obs_menu,
            &system_menu,
            &sep2,
            &check_update,
            &quit,
        ],
    )?;

    #[cfg(not(windows))]
    let menu = Menu::with_items(
        app,
        &[
            &open_menu,
            &feed_treat,
            &toggle_show,
            &click_through,
            &pause_guard,
            &sep1,
            &breed_menu,
            &appearance_menu,
            &obs_menu,
            &system_menu,
            &sep2,
            &check_update,
            &quit,
        ],
    )?;

    let handles = TrayCheckHandles {
        feed_treat,
        pause_guard,
        click_through,
        key_bubbles,
        privacy_guard,
        sound_toggle,
        idle_purr_toggle,
        typing_sound_toggle,
        sound_muted,
        vol_100,
        vol_75,
        vol_50,
        vol_25,
        always_on_top,
        yield_on_fullscreen,
        autostart,
        #[cfg(windows)]
        autostart_admin,
        obs_toggle,
        obs_hide_pet,
        live_capture_toggle,
        live_hide_pet,
        mcp_toggle,
        breed_items,
        scale_25,
        scale_50,
        scale_75,
        scale_100,
        scale_125,
        scale_150,
        kb_65,
        kb_98,
        kb_108,
        kb_macbook,
        finish_black,
        finish_white,
        #[cfg(target_os = "macos")]
        device_mouse,
        #[cfg(target_os = "macos")]
        device_pad,
        kb_cat,
        kb_viewer,
        tail_smart,
        tail_custom,
        tail_edge,
        tail_off,
        fps_60,
        fps_30,
        lang_auto,
        lang_zh_cn,
        lang_zh_tw,
        lang_en_us,
        lang_ja_jp,
        lang_ko_kr,
        lang_es_es,
        lang_pt_br,
        lang_ru_ru,
        lang_de_de,
    };

    Ok((menu, handles))
}

pub fn refresh_tray_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let paused = state.paused_guard.load(std::sync::atomic::Ordering::SeqCst);
    if let Ok((new_menu, new_handles)) = build_tray_menu(app, &settings, paused) {
        if let Ok(mut guard) = active_handles().lock() {
            *guard = Some(new_handles);
        }
        if let Some(tray) = app.tray_by_id("kuro-tray") {
            let _ = tray.set_menu(Some(new_menu));
            let tip = if paused {
                format!("KuroCat ({})", t(&settings.language, "tray.pause_guard"))
            } else {
                default_tray_tooltip(&settings.language)
            };
            let _ = tray.set_tooltip(Some(tip));
        }
    }
}

pub fn toggle_pause_guard(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let next = !state
        .paused_guard
        .load(std::sync::atomic::Ordering::SeqCst);
    state
        .paused_guard
        .store(next, std::sync::atomic::Ordering::SeqCst);
    crate::input_hook::set_hooks_paused(next);
    if let Ok(guard) = active_handles().lock() {
        if let Some(h) = guard.as_ref() {
            let _ = h.pause_guard.set_checked(next);
        }
    }
    let (lang, should_hide) = {
        let s = state.settings.lock().unwrap();
        (s.language.clone(), crate::should_hide_desktop_pet(&s))
    };
    if let Some(tray) = app.tray_by_id("kuro-tray") {
        let tip = if next {
            format!("KuroCat ({})", t(&lang, "tray.pause_guard"))
        } else {
            default_tray_tooltip(&lang)
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    set_pet_visible(app, !next && !should_hide);
    let _ = app.emit("kuro-pause-guard", next);
    next
}

pub fn refresh_tray_language(app: &AppHandle) {
    refresh_tray_menu(app);
}

fn apply_language_and_save(app: &AppHandle, raw_lang: &str) {
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.language = crate::config::normalize_language(raw_lang);
        crate::config::save_settings(&s);
        s.clone()
    };
    refresh_tray_menu(app);
    let _ = app.emit("kuro-settings", updated);
}

fn apply_fps_cap_and_save(app: &AppHandle, cap: u16) {
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.fps_cap = crate::config::normalize_fps_cap(cap);
        crate::config::save_settings(&s);
        s.clone()
    };
    sync_checkmarks(&updated);
    let _ = app.emit("kuro-settings", updated);
}

pub fn setup_tray(app: &AppHandle, initial: &AppSettings) -> tauri::Result<()> {
    let (menu, handles) = build_tray_menu(app, initial, false)?;
    if let Ok(mut guard) = active_handles().lock() {
        *guard = Some(handles);
    }

    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    // Keep tray checkmarks synchronized when settings change from right-click menu, toast, or MCP.
    app.listen("kuro-settings", move |ev| {
        if let Ok(s) = serde_json::from_str::<AppSettings>(ev.payload()) {
            sync_checkmarks(&s);
        }
    });

    // Rebuild dynamic Pet Skin submenu whenever custom skins are added/updated/deleted via MCP.
    let app_for_cats = app.clone();
    app.listen("kuro-cats", move |_| {
        refresh_tray_menu(&app_for_cats);
    });

    TrayIconBuilder::with_id("kuro-tray")
        .icon(icon)
        .tooltip(default_tray_tooltip(&initial.language))
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(move |tray, event| {
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
                    if let Ok(guard) = active_handles().lock() {
                        if let Some(h) = guard.as_ref() {
                            let _ = h.pause_guard.set_checked(false);
                        }
                    }
                    let lang = state.settings.lock().unwrap().language.clone();
                    let _ = tray.set_tooltip(Some(default_tray_tooltip(&lang)));
                    set_pet_visible(app, true);
                } else {
                    let next_vis = !is_pet_visible(app);
                    if next_vis {
                        let mut s = state.settings.lock().unwrap();
                        if s.obs_hide_pet || s.live_hide_pet {
                            s.obs_hide_pet = false;
                            s.live_hide_pet = false;
                            crate::config::save_settings(&s);
                            sync_checkmarks(&s);
                            let _ = app.emit("kuro-settings", s.clone());
                        }
                    }
                    set_pet_visible(app, next_vis);
                }
            }
        })
        .on_menu_event(move |app, event| {
            let state = app.state::<AppState>();
            let id = event.id().as_ref();
            if let Some(breed_id) = id.strip_prefix("breed_id:") {
                apply_breed_and_save(app, breed_id);
                return;
            }
            match id {
                "open_menu" => {
                    if !state.paused_guard.load(std::sync::atomic::Ordering::SeqCst) {
                        set_pet_visible(app, true);
                    }
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::open_context_menu_from_tray(handle).await;
                    });
                }
                "feed_treat" => {
                    crate::trigger_treat_feed_internal(app, None);
                }
                "toggle_show" => {
                    if state.paused_guard.load(std::sync::atomic::Ordering::SeqCst) {
                        state
                            .paused_guard
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        crate::input_hook::set_hooks_paused(false);
                        if let Ok(guard) = active_handles().lock() {
                            if let Some(h) = guard.as_ref() {
                                let _ = h.pause_guard.set_checked(false);
                            }
                        }
                        let lang = state.settings.lock().unwrap().language.clone();
                        if let Some(tray) = app.tray_by_id("kuro-tray") {
                            let _ = tray.set_tooltip(Some(default_tray_tooltip(&lang)));
                        }
                        set_pet_visible(app, true);
                    } else {
                        let next_vis = !is_pet_visible(app);
                        if next_vis {
                            let mut s = state.settings.lock().unwrap();
                            if s.obs_hide_pet || s.live_hide_pet {
                                s.obs_hide_pet = false;
                                s.live_hide_pet = false;
                                crate::config::save_settings(&s);
                                sync_checkmarks(&s);
                                let _ = app.emit("kuro-settings", s.clone());
                            }
                        }
                        set_pet_visible(app, next_vis);
                    }
                }
                "pause_guard" => {
                    let _ = toggle_pause_guard(app);
                }
                #[cfg(windows)]
                "restart_as_admin" => {
                    if !crate::win_is_elevated() {
                        crate::win_restart_as_admin(app.clone());
                    }
                }
                "click_through" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.click_through_locked = !s.click_through_locked;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "key_bubbles" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.show_key_bubbles = !s.show_key_bubbles;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "privacy_guard" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.privacy_password_guard = !s.privacy_password_guard;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "sound_toggle" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.sound_enabled = !s.sound_enabled;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "idle_purr_toggle" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.idle_purr_enabled = !s.idle_purr_enabled;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "typing_sound_toggle" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.typing_sound_enabled = !s.typing_sound_enabled;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "sound_muted" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        let currently_muted = s.sound_muted || s.sound_volume <= 0.001;
                        if currently_muted {
                            s.sound_muted = false;
                            if s.sound_volume <= 0.001 {
                                s.sound_volume = 0.5;
                            }
                        } else {
                            s.sound_muted = true;
                        }
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                id @ ("vol_100" | "vol_75" | "vol_50" | "vol_25") => {
                    let next_vol = match id {
                        "vol_25" => 0.25,
                        "vol_50" => 0.50,
                        "vol_75" => 0.75,
                        _ => 1.00,
                    };
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.sound_volume = next_vol;
                        s.sound_muted = false;
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "always_on_top" => {
                    let (on_top, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        s.always_on_top = !s.always_on_top;
                        let on_top = s.always_on_top;
                        crate::config::save_settings(&s);
                        (on_top, s.clone())
                    };
                    sync_checkmarks(&updated);
                    set_pet_always_on_top(app, on_top);
                    let _ = app.emit("kuro-settings", updated);
                }
                "yield_on_fullscreen" => {
                    let (on_top, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        s.yield_on_fullscreen = !s.yield_on_fullscreen;
                        let on_top = s.always_on_top;
                        crate::config::save_settings(&s);
                        (on_top, s.clone())
                    };
                    sync_checkmarks(&updated);
                    set_pet_always_on_top(app, on_top);
                    let _ = app.emit("kuro-settings", updated);
                }
                "autostart" => {
                    let (next_auto, next_admin) = {
                        let s = state.settings.lock().unwrap();
                        let next = !s.autostart;
                        (next, if next { s.autostart_admin } else { false })
                    };
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        let _ = crate::apply_autostart_and_sync(&handle, next_auto, next_admin);
                    });
                }
                "autostart_admin" => {
                    #[cfg(windows)]
                    {
                        let (next_auto, next_admin) = {
                            let s = state.settings.lock().unwrap();
                            let next_adm = !(s.autostart && s.autostart_admin);
                            (true, next_adm)
                        };
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            let _ = crate::apply_autostart_and_sync(&handle, next_auto, next_admin);
                        });
                    }
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
                        crate::config::save_settings(&s);
                        (s.obs_enabled, s.obs_port, s.clone())
                    };
                    crate::obs::sync_obs_server(app, enabled, port);
                    sync_checkmarks(&updated);
                    if !enabled
                        && !crate::should_hide_desktop_pet(&updated)
                        && !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed)
                    {
                        set_pet_visible(app, true);
                    }
                    let _ = app.emit("kuro-settings", updated);
                }
                "obs_hide_pet" => {
                    let (port, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        let next_hide = !(s.obs_enabled && s.obs_hide_pet);
                        if next_hide && !s.obs_enabled {
                            s.obs_enabled = true;
                        }
                        if s.obs_port == 0 {
                            s.obs_port = 27421;
                        }
                        s.obs_hide_pet = next_hide;
                        crate::config::save_settings(&s);
                        (s.obs_port, s.clone())
                    };
                    crate::obs::sync_obs_server(app, updated.obs_enabled, port);
                    sync_checkmarks(&updated);
                    if !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed) {
                        set_pet_visible(app, !crate::should_hide_desktop_pet(&updated));
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
                            crate::config::save_settings(&s);
                        }
                        (s.obs_port, changed, s.clone())
                    };
                    crate::obs::sync_obs_server(app, true, port);
                    if enabled_changed {
                        sync_checkmarks(&updated);
                        let _ = app.emit("kuro-settings", updated);
                    }
                    crate::updater::open_url_in_browser(&crate::obs::obs_url(port));
                }
                "live_capture_toggle" => {
                    let (prev_hide, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        let prev_hide = crate::should_hide_desktop_pet(&s);
                        s.live_capture_enabled = !s.live_capture_enabled;
                        if !s.live_capture_enabled {
                            s.live_hide_pet = false;
                        }
                        crate::config::save_settings(&s);
                        (prev_hide, s.clone())
                    };
                    crate::sync_live_capture_window(
                        app,
                        updated.live_capture_enabled,
                        &updated.keyboard_layout,
                    );
                    sync_checkmarks(&updated);
                    let next_hide = crate::should_hide_desktop_pet(&updated);
                    if next_hide != prev_hide
                        && !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed)
                    {
                        set_pet_visible(app, !next_hide);
                    }
                    let _ = app.emit("kuro-settings", updated);
                }
                "live_hide_pet" => {
                    let (was_enabled, updated) = {
                        let mut s = state.settings.lock().unwrap();
                        let was_enabled = s.live_capture_enabled;
                        let next_hide = !(s.live_capture_enabled && s.live_hide_pet);
                        if next_hide && !s.live_capture_enabled {
                            s.live_capture_enabled = true;
                        }
                        s.live_hide_pet = next_hide;
                        crate::config::save_settings(&s);
                        (was_enabled, s.clone())
                    };
                    if updated.live_capture_enabled != was_enabled
                        || (updated.live_capture_enabled
                            && app.get_webview_window("live").is_none())
                    {
                        crate::sync_live_capture_window(
                            app,
                            updated.live_capture_enabled,
                            &updated.keyboard_layout,
                        );
                    }
                    sync_checkmarks(&updated);
                    if !state.paused_guard.load(std::sync::atomic::Ordering::Relaxed) {
                        set_pet_visible(app, !crate::should_hide_desktop_pet(&updated));
                    }
                    let _ = app.emit("kuro-settings", updated);
                }
                "mcp_toggle" => {
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        s.mcp_enabled = !s.mcp_enabled;
                        let enabled = s.mcp_enabled;
                        state
                            .mcp_enabled
                            .store(enabled, std::sync::atomic::Ordering::Relaxed);
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
                "scale_25" => apply_scale_and_save(app, 0.25),
                "scale_50" => apply_scale_and_save(app, 0.5),
                "scale_75" => apply_scale_and_save(app, 0.75),
                "scale_100" => apply_scale_and_save(app, 1.0),
                "scale_125" => apply_scale_and_save(app, 1.25),
                "scale_150" => apply_scale_and_save(app, 1.5),
                "kb_65" => apply_keyboard_layout_and_save(app, "65"),
                "kb_98" => apply_keyboard_layout_and_save(app, "98"),
                "kb_108" => apply_keyboard_layout_and_save(app, "108"),
                "kb_macbook" => apply_keyboard_layout_and_save(app, "macbook"),
                id @ ("finish_black" | "finish_white" | "device_mouse" | "device_pad") => {
                    let state = app.state::<AppState>();
                    let updated = {
                        let mut s = state.settings.lock().unwrap();
                        match id {
                            "finish_black" | "finish_white" => s.white_keyboard = id == "finish_white",
                            _ => s.trackpad_enabled = id == "device_pad",
                        }
                        crate::config::save_settings(&s);
                        s.clone()
                    };
                    sync_checkmarks(&updated);
                    let _ = app.emit("kuro-settings", updated);
                }
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
                "fps_60" => apply_fps_cap_and_save(app, 0),
                "fps_30" => apply_fps_cap_and_save(app, 30),
                "lang_auto" => apply_language_and_save(app, "auto"),
                "lang_zh-CN" => apply_language_and_save(app, "zh-CN"),
                "lang_zh-TW" => apply_language_and_save(app, "zh-TW"),
                "lang_en-US" => apply_language_and_save(app, "en-US"),
                "lang_ja-JP" => apply_language_and_save(app, "ja-JP"),
                "lang_ko-KR" => apply_language_and_save(app, "ko-KR"),
                "lang_es-ES" => apply_language_and_save(app, "es-ES"),
                "lang_pt-BR" => apply_language_and_save(app, "pt-BR"),
                "lang_ru-RU" => apply_language_and_save(app, "ru-RU"),
                "lang_de-DE" => apply_language_and_save(app, "de-DE"),
                "desktop_shortcut" => {
                    let _ = crate::config::create_desktop_shortcut();
                }
                #[cfg(target_os = "macos")]
                "mac_reset_permissions" => {
                    crate::input_hook::macos_hook::reset_and_request_macos_permissions();
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
                    let lang = state.settings.lock().unwrap().language.clone();
                    set_pet_visible(app, true);
                    let _ = app_clone.emit(
                        "kuro-update-status",
                        crate::updater::UpdateProgressEvent {
                            stage: "checking".to_string(),
                            message: t(&lang, "toast.checking"),
                            info: None,
                        },
                    );
                    std::thread::spawn(move || match crate::updater::check_latest_update() {
                        Ok(info) => {
                            let (stage, msg) = if info.has_update {
                                (
                                    "available",
                                    tf(&lang, "toast.available", &[("ver", info.latest_version.clone())]),
                                )
                            } else {
                                (
                                    "up_to_date",
                                    tf(&lang, "toast.up_to_date", &[("ver", info.current_version.clone())]),
                                )
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
                    crate::windows_display::handle_menu(app, id);
                    #[cfg(target_os = "macos")]
                    crate::macos_window::handle_display_menu(app, id);
                }
            }
        })
        .build(app)?;

    Ok(())
}
