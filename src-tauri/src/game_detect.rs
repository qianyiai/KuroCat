//! Lightweight, anti-cheat-safe automatic game detector for KuroCat gaming headphones.
//!
//! - Read-only foreground window/executable metadata query ONLY (never injects DLLs, never opens
//!   game memory, uses `PROCESS_QUERY_LIMITED_INFORMATION` on Windows).
//! - Runs only when `headphone_mode == "auto"` and app is not paused (~1.8s poll interval, ~0% CPU).
//! - Includes an ~7s Alt-Tab grace period so briefly switching to WeChat/browser doesn't flicker
//!   the headphones off and back on.

use crate::config::AppSettings;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static GAME_ACTIVE: AtomicBool = AtomicBool::new(false);
static GPU_ECO_ACTIVE: AtomicBool = AtomicBool::new(false);
static TABLET_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_game_active() -> bool {
    GAME_ACTIVE.load(Ordering::Relaxed)
}

/// Returns `true` when either a PC game OR a heavy DirectX/OpenGL CAD/3D viewport app
/// (e.g. AutoCAD, Revit, SolidWorks, Blender) is active in the foreground so KuroCat
/// throttles mouse IPC to 20Hz and uses 30 FPS GPU/DWM-saving Eco Mode.
pub fn is_heavy_gpu_app_active() -> bool {
    GAME_ACTIVE.load(Ordering::Relaxed) || GPU_ECO_ACTIVE.load(Ordering::Relaxed)
}

pub fn is_tablet_active() -> bool {
    TABLET_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabletActivePayload {
    pub active: bool,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameActivePayload {
    pub active: bool,
    pub game_name: Option<String>,
    pub needs_admin: bool,
    pub gpu_eco: bool,
}

/// Kernel anti-cheat titles where we recommend "Pause & Hide (Anti-Cheat Safe Mode)"
/// rather than prompting the user to elevate KuroCat as Administrator.
const KERNEL_ANTICHEAT_EXES: &[&str] = &[
    "valorant-win64-shipping.exe",
    "deltaforceclient-win64-shipping.exe",
    "df_client.exe",
    "league of legends.exe",
];

/// Pure, unit-testable policy for whether to emit the non-intrusive "elevate as admin" hint.
pub fn should_suggest_admin_elevation(
    exe_path: &str,
    game_detected: bool,
    target_elevated: bool,
    self_elevated: bool,
) -> bool {
    if !game_detected || !target_elevated || self_elevated {
        return false;
    }
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() || KERNEL_ANTICHEAT_EXES.contains(&exe_name) {
        return false;
    }
    true
}

/// Known non-game apps (browsers, video players, office, chat, IDEs, streaming tools) that must
/// NEVER trigger gaming headphones even when playing fullscreen video or running hardware acceleration.
const EXCLUDED_EXES: &[&str] = &[
    "kurocat.exe",
    "kuro-cat-pet.exe",
    "explorer.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "lockapp.exe",
    "applicationframehost.exe",
    "dwm.exe",
    "taskmgr.exe",
    // Browsers
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
    "360chrome.exe",
    "360chromex.exe",
    "qqbrowser.exe",
    "sogouexplorer.exe",
    "quark.exe",
    // Media & video players
    "vlc.exe",
    "potplayermini64.exe",
    "potplayermini.exe",
    "mpv.exe",
    "mpc-hc64.exe",
    "mpc-be64.exe",
    "wmplayer.exe",
    "bilibili.exe",
    "douyin.exe",
    "qiyi.exe",
    "iqiyi.exe",
    "youkumedia.exe",
    "qqlive.exe",
    "cloudmusic.exe",
    "qqmusic.exe",
    "spotify.exe",
    // Office / productivity / chat / streaming
    "powerpnt.exe",
    "winword.exe",
    "excel.exe",
    "wps.exe",
    "wpp.exe",
    "et.exe",
    "acrobat.exe",
    "code.exe",
    "cursor.exe",
    "devenv.exe",
    "idea64.exe",
    "wechat.exe",
    "weixin.exe",
    "qq.exe",
    "tim.exe",
    "dingtalk.exe",
    "feishu.exe",
    "lark.exe",
    "slack.exe",
    "discord.exe",
    "zoom.exe",
    "wemeetapp.exe",
    "obs64.exe",
    "obs32.exe",
    "mstsc.exe",
    "mstscax.exe",
    "windowsterminal.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    // Drawing / 3D / CAD apps (never treat as PC games)
    "photoshop.exe",
    "clipstudiopaint.exe",
    "sai.exe",
    "sai2.exe",
    "krita.exe",
    "medibangpaintpro.exe",
    "firealpaca.exe",
    "illustrator.exe",
    "zbrush.exe",
    "blender.exe",
    "acad.exe",
    "acadlt.exe",
    "zwcad.exe",
    "gcad.exe",
    "revit.exe",
    "sldworks.exe",
    "3dsmax.exe",
    "maya.exe",
    // Game store launchers themselves (should wait until actual game launches)
    "steam.exe",
    "steamwebhelper.exe",
    "epicgameslauncher.exe",
    "wegame.exe",
    "tgp_daemon.exe",
    "riotclientservices.exe",
    "riotclientux.exe",
    "battle.net.exe",
    "hyp.exe",
    "hoyoplay.exe",
    "launcher.exe",
    "upc.exe",
    "eadesktop.exe",
];

/// Popular PC games (MOBA, FPS, Battle Royale, Action/RPG, Gacha, Sandbox, Indie, Rhythm, Party).
const KNOWN_GAME_EXES: &[(&str, &str)] = &[
    // MOBA & Competitive FPS / Battle Royale
    ("league of legends.exe", "League of Legends"),
    ("valorant-win64-shipping.exe", "VALORANT"),
    ("cs2.exe", "Counter-Strike 2"),
    ("csgo.exe", "CS:GO"),
    ("dota2.exe", "Dota 2"),
    ("r5apex.exe", "Apex Legends"),
    ("r5apex_dx12.exe", "Apex Legends"),
    ("tslgame.exe", "PUBG"),
    ("overwatch.exe", "Overwatch"),
    ("narakabladepoint.exe", "Naraka: Bladepoint"),
    ("deltaforceclient-win64-shipping.exe", "Delta Force"),
    ("df_client.exe", "Delta Force"),
    ("crossfire.exe", "CrossFire"),
    ("crossfire_x64.exe", "CrossFire"),
    ("dnf.exe", "DNF"),
    ("rainbowsix.exe", "Rainbow Six Siege"),
    ("rainbowsix_vulkan.exe", "Rainbow Six Siege"),
    ("rainbowsix_be.exe", "Rainbow Six Siege"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("cod.exe", "Call of Duty"),
    ("bf2042.exe", "Battlefield 2042"),
    ("deadlock.exe", "Deadlock"),
    ("discovery.exe", "THE FINALS"),
    ("escapefromtarkov.exe", "Escape from Tarkov"),
    ("worldoftanks.exe", "World of Tanks"),
    ("aces.exe", "War Thunder"),
    ("marvel-win64-shipping.exe", "Marvel Rivals"),
    // RPG / Open World / Gacha / Action
    ("genshinimpact.exe", "Genshin Impact"),
    ("yuanshen.exe", "原神"),
    ("starrail.exe", "崩坏：星穹铁道"),
    ("zenlesszonezero.exe", "绝区零"),
    ("honkai3rd.exe", "崩坏3"),
    ("bh3.exe", "崩坏3"),
    ("client-win64-shipping.exe", "鸣潮"),
    ("b1-win64-shipping.exe", "黑神话：悟空"),
    ("eldenring.exe", "Elden Ring"),
    ("sekiro.exe", "Sekiro"),
    ("darksoulsiii.exe", "Dark Souls III"),
    ("cyberpunk2077.exe", "Cyberpunk 2077"),
    ("gta5.exe", "GTA V"),
    ("gta5_enhanced.exe", "GTA V"),
    ("rdr2.exe", "Red Dead Redemption 2"),
    ("witcher3.exe", "The Witcher 3"),
    ("bg3.exe", "Baldur's Gate 3"),
    ("bg3_dx11.exe", "Baldur's Gate 3"),
    ("monsterhunterwilds.exe", "Monster Hunter Wilds"),
    ("monsterhunterworld.exe", "Monster Hunter: World"),
    ("monsterhunterrise.exe", "Monster Hunter Rise"),
    ("palworld-win64-shipping.exe", "Palworld"),
    ("helldivers2.exe", "Helldivers 2"),
    ("wow.exe", "World of Warcraft"),
    ("wowclassic.exe", "WoW Classic"),
    ("ffxiv_dx11.exe", "Final Fantasy XIV"),
    ("diablo iv.exe", "Diablo IV"),
    ("pathofexile.exe", "Path of Exile"),
    ("pathofexile2.exe", "Path of Exile 2"),
    ("pathofexilesteam.exe", "Path of Exile"),
    ("lostark.exe", "Lost Ark"),
    ("jx3client.exe", "剑网3"),
    ("jx3clientx64.exe", "剑网3"),
    ("nsh.exe", "逆水寒"),
    ("hearthstone.exe", "Hearthstone"),
    ("nikke.exe", "NIKKE"),
    ("identityv.exe", "第五人格"),
    ("yys.exe", "阴阳师"),
    // Sandbox / Indie / Rhythm / Strategy / Party
    ("minecraft.windows.exe", "Minecraft"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("osu!.exe", "osu!"),
    ("terraria.exe", "Terraria"),
    ("stardew valley.exe", "Stardew Valley"),
    ("hollow_knight.exe", "Hollow Knight"),
    ("celeste.exe", "Celeste"),
    ("hades.exe", "Hades"),
    ("hades2.exe", "Hades II"),
    ("balatro.exe", "Balatro"),
    ("among us.exe", "Among Us"),
    ("lethal company.exe", "Lethal Company"),
    ("partyanimals.exe", "Party Animals"),
    ("factorio.exe", "Factorio"),
    ("rimworldwin64.exe", "RimWorld"),
    ("civilizationvi.exe", "Civilization VI"),
    ("civilizationvii.exe", "Civilization VII"),
    ("eurotrucks2.exe", "Euro Truck Simulator 2"),
    ("forzahorizon5.exe", "Forza Horizon 5"),
    ("fc24.exe", "EA SPORTS FC 24"),
    ("fc25.exe", "EA SPORTS FC 25"),
    ("nba2k25.exe", "NBA 2K25"),
    ("splitfiction.exe", "Split Fiction"),
    ("ittakestwo.exe", "It Takes Two"),
    ("dontstarve_steam_x64.exe", "Don't Starve Together"),
    ("human.exe", "Human: Fall Flat"),
    ("fallguys_client_game.exe", "Fall Guys"),
    ("rocketleague.exe", "Rocket League"),
    ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
    ("phasmophobia.exe", "Phasmophobia"),
    ("rustclient.exe", "Rust"),
    ("valheim.exe", "Valheim"),
    ("subnautica.exe", "Subnautica"),
    ("left4dead2.exe", "Left 4 Dead 2"),
    ("hl2.exe", "Half-Life 2"),
    ("tf_win64.exe", "Team Fortress 2"),
    ("destiny2.exe", "Destiny 2"),
    ("warframe.x64.exe", "Warframe"),
];

const GAME_LIBRARY_PATH_MARKERS: &[&str] = &[
    "\\steamapps\\common\\",
    "\\epic games\\",
    "\\riot games\\",
    "\\wegameapps\\",
    "\\rail_apps\\",
    "\\hoyoplay\\games\\",
    "\\mihoyo\\",
    "\\ubisoft game launcher\\games\\",
    "\\ea games\\",
    "\\xboxgames\\",
    "\\gog galaxy\\games\\",
    "\\blizzard\\",
];

const NON_GAME_HELPER_WORDS: &[&str] = &[
    "launcher",
    "updater",
    "update",
    "crash",
    "reporter",
    "unins",
    "setup",
    "install",
    "redist",
    "vcredist",
    "anticheat",
    "helper",
    "cef",
    "webhelper",
    "config",
    "overlay",
    "patcher",
];

fn clean_display_name(exe_name: &str, window_title: &str) -> String {
    let title = window_title.trim();
    if !title.is_empty() && title.chars().count() <= 48 {
        return title.to_string();
    }
    exe_name
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string()
}

/// Pure, unit-testable Windows foreground game classifier.
pub fn classify_windows_foreground(
    exe_path: &str,
    window_title: &str,
    is_d3d_fullscreen: bool,
) -> Option<String> {
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() {
        return None;
    }

    if EXCLUDED_EXES.contains(&exe_name) {
        return None;
    }

    // 1) Exact match against popular PC games
    for &(known_exe, display) in KNOWN_GAME_EXES {
        if exe_name == known_exe {
            return Some(display.to_string());
        }
    }

    // 2) Java Minecraft / modded launchers
    let title_lower = window_title.to_ascii_lowercase();
    if (exe_name == "javaw.exe" || exe_name == "java.exe")
        && (title_lower.contains("minecraft") || title_lower.contains("我的世界"))
    {
        return Some("Minecraft".to_string());
    }

    // 3) Unreal Engine shipping binaries (e.g. `*-Win64-Shipping.exe`, `*-WinGDK-Shipping.exe`)
    if exe_name.ends_with("-win64-shipping.exe")
        || exe_name.ends_with("-wingdk-shipping.exe")
        || exe_name.ends_with("_shipping.exe")
    {
        return Some(clean_display_name(exe_name, window_title));
    }

    // 4) Executable located inside a major game store library directory (excluding helper tools)
    if GAME_LIBRARY_PATH_MARKERS.iter().any(|m| path_lower.contains(m))
        && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w))
    {
        return Some(clean_display_name(exe_name, window_title));
    }

    // 5) DirectX / D3D exclusive fullscreen reported by Windows Shell (excluding browsers/media above)
    if is_d3d_fullscreen && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w)) {
        return Some(clean_display_name(exe_name, window_title));
    }

    None
}

#[cfg(any(target_os = "macos", test))]
pub fn classify_macos_foreground(bundle_id: &str, app_name: &str) -> Option<String> {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = app_name.trim();
    let name_lower = name.to_ascii_lowercase();
    if bid.is_empty() && name_lower.is_empty() {
        return None;
    }

    // Exclude system/browsers/media/productivity
    if bid.starts_with("com.apple.")
        || bid.contains("google.chrome")
        || bid.contains("microsoft.edgemac")
        || bid.contains("mozilla.firefox")
        || bid.contains("brave")
        || bid.contains("vscode")
        || bid.contains("wechat")
        || bid.contains("tencent.qq")
        || bid.contains("obsproject")
        || bid.contains("videolan.vlc")
        || bid.contains("iina")
        || bid.contains("kurocat")
    {
        return None;
    }

    const MAC_GAME_KEYWORDS: &[&str] = &[
        "riotgames",
        "leagueoflegends",
        "blizzard",
        "hearthstone",
        "worldofwarcraft",
        "mihoyo",
        "hoyoverse",
        "genshin",
        "starrail",
        "minecraft",
        "roblox",
        "dota2",
        "csgo",
        "baldursgate3",
        "larian",
        "stardewvalley",
        "hollowknight",
        "hades",
        "balatro",
        "factorio",
        "rimworld",
        "civilization",
        "osu!",
        "unity.player",
        "unrealengine",
        "valvesoftware.source",
    ];
    if MAC_GAME_KEYWORDS
        .iter()
        .any(|k| bid.contains(k) || name_lower.contains(k))
    {
        return Some(if name.is_empty() { bid } else { name.to_string() });
    }
    None
}

/// Known digital art / sculpting / Live2D / drawing apps where a connected HID drawing tablet
/// (including Wintab / non-Windows-Ink drivers) should automatically switch KuroCat to Tablet Mode.
const KNOWN_DRAWING_EXES: &[(&str, &str)] = &[
    ("photoshop.exe", "Photoshop"),
    ("clipstudiopaint.exe", "Clip Studio Paint"),
    ("sai.exe", "PaintTool SAI"),
    ("sai2.exe", "PaintTool SAI 2"),
    ("krita.exe", "Krita"),
    ("medibangpaintpro.exe", "MediBang Paint"),
    ("firealpaca.exe", "FireAlpaca"),
    ("painter.exe", "Corel Painter"),
    ("rebelle.exe", "Rebelle"),
    ("rebelle 7.exe", "Rebelle"),
    ("sketchbook.exe", "SketchBook"),
    ("sketchbookpro.exe", "SketchBook"),
    ("designer.exe", "Affinity Designer"),
    ("photo.exe", "Affinity Photo"),
    ("illustrator.exe", "Illustrator"),
    ("zbrush.exe", "ZBrush"),
    ("blender.exe", "Blender"),
    ("cubismeditor.exe", "Live2D Cubism"),
    ("opencanvas7.exe", "openCanvas"),
    ("paintstorm.exe", "Paintstorm Studio"),
    ("artrage.exe", "ArtRage"),
    ("aseprite.exe", "Aseprite"),
    ("osu!.exe", "osu!"),
];

pub fn classify_windows_drawing_app(exe_path: &str) -> Option<&'static str> {
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() {
        return None;
    }
    for &(known_exe, display) in KNOWN_DRAWING_EXES {
        if exe_name == known_exe {
            return Some(display);
        }
    }
    None
}

/// Heavy DirectX/OpenGL CAD, BIM, and 3D DCC viewport applications that benefit from KuroCat's
/// automatic 30 FPS GPU/DWM-saving Eco Mode without triggering gaming headphones.
const HEAVY_GPU_WORKSTATION_EXES: &[&str] = &[
    "acad.exe",
    "acadlt.exe",
    "zwcad.exe",
    "zwcadm.exe",
    "zw3d.exe",
    "gcad.exe",
    "gstarcad.exe",
    "bricscad.exe",
    "draftsight.exe",
    "caxa.exe",
    "caxacad.exe",
    "revit.exe",
    "navisworks.exe",
    "archicad.exe",
    "sketchup.exe",
    "civil3d.exe",
    "tarch.exe",
    "sldworks.exe",
    "inventor.exe",
    "ugraf.exe",
    "cnext.exe",
    "xtop.exe",
    "parametric.exe",
    "solidedge.exe",
    "fusion360.exe",
    "rhino.exe",
    "3dsmax.exe",
    "maya.exe",
    "blender.exe",
    "cinema 4d.exe",
    "houdini.exe",
    "houdinifx.exe",
    "zbrush.exe",
    "unrealeditor.exe",
    "ue4editor.exe",
    "unity.exe",
];

pub fn classify_windows_heavy_gpu_app(exe_path: &str) -> bool {
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    !exe_name.is_empty() && HEAVY_GPU_WORKSTATION_EXES.contains(&exe_name)
}

#[cfg(any(target_os = "macos", test))]
pub fn classify_macos_drawing_app(bundle_id: &str, app_name: &str) -> Option<&'static str> {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = app_name.trim().to_ascii_lowercase();
    const MAC_DRAWING_MARKERS: &[(&str, &str)] = &[
        ("com.adobe.photoshop", "Photoshop"),
        ("jp.co.celsys.clipstudiopaint", "Clip Studio Paint"),
        ("clip studio paint", "Clip Studio Paint"),
        ("org.krita", "Krita"),
        ("com.medibang", "MediBang Paint"),
        ("com.firealpaca", "FireAlpaca"),
        ("com.seriflabs.affinityphoto", "Affinity Photo"),
        ("com.seriflabs.affinitydesigner", "Affinity Designer"),
        ("com.adobe.illustrator", "Illustrator"),
        ("com.pixologic.zbrush", "ZBrush"),
        ("org.blenderfoundation.blender", "Blender"),
        ("live2d", "Live2D Cubism"),
        ("aseprite", "Aseprite"),
        ("sketchbook", "SketchBook"),
    ];
    for &(marker, display) in MAC_DRAWING_MARKERS {
        if bid.contains(marker) || name.contains(marker) {
            return Some(display);
        }
    }
    None
}

#[cfg(any(target_os = "macos", test))]
pub fn classify_macos_heavy_gpu_app(bundle_id: &str, app_name: &str) -> bool {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = app_name.trim().to_ascii_lowercase();
    const MAC_HEAVY_GPU_MARKERS: &[&str] = &[
        "org.blenderfoundation.blender",
        "com.autodesk.maya",
        "com.autodesk.autocad",
        "com.maxon.cinema4d",
        "com.sidefx.houdini",
        "com.pixologic.zbrush",
        "com.epicgames.unrealeditor",
        "com.unity3d.unityeditor",
        "com.blackmagic-design.davinciresolve",
        "org.godotengine.godot",
        "blender",
        "cinema 4d",
        "davinci resolve",
    ];
    MAC_HEAVY_GPU_MARKERS
        .iter()
        .any(|m| bid.contains(m) || name.contains(m))
}

#[cfg(any(target_os = "linux", test))]
fn extract_wine_or_proton_exe(cmdline: &str) -> Option<String> {
    // Wine / Proton cmdlines look like: `Z:\home\user\.steam\...\steamapps\common\Elden Ring\eldenring.exe`
    // or `/path/to/wine64 C:\Program Files\Genshin Impact\YuanShen.exe` (NUL-separated in /proc/pid/cmdline).
    for token in cmdline.split(|c: char| c == '\0' || c.is_ascii_whitespace()) {
        let cleaned = token.trim_matches(|c| c == '"' || c == '\'');
        let lower = cleaned.to_ascii_lowercase();
        if lower.ends_with(".exe")
            && !lower.ends_with("wine-preloader.exe")
            && !lower.ends_with("wineserver.exe")
            && !lower.ends_with("explorer.exe")
            && !lower.ends_with("start.exe")
        {
            return Some(cleaned.to_string());
        }
    }
    None
}

#[cfg(any(target_os = "linux", test))]
pub fn classify_linux_drawing_app(
    wm_class: &str,
    exe_path: &str,
    cmdline: &str,
) -> Option<&'static str> {
    if let Some(win_exe) = extract_wine_or_proton_exe(cmdline) {
        if let Some(app) = classify_windows_drawing_app(&win_exe) {
            return Some(app);
        }
    }
    let cls = wm_class.trim().to_ascii_lowercase();
    let exe_name = exe_path
        .trim()
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    const LINUX_DRAWING_MARKERS: &[(&str, &str)] = &[
        ("krita", "Krita"),
        ("gimp", "GIMP"),
        ("inkscape", "Inkscape"),
        ("blender", "Blender"),
        ("aseprite", "Aseprite"),
        ("libresprite", "LibreSprite"),
        ("mypaint", "MyPaint"),
        ("xournalpp", "Xournal++"),
        ("drawpile", "Drawpile"),
        ("rnote", "Rnote"),
        ("lorien", "Lorien"),
        ("pencil2d", "Pencil2D"),
        ("opentoonz", "OpenToonz"),
        ("tahomap2d", "Tahoma2D"),
        ("firealpaca", "FireAlpaca"),
        ("medibang", "MediBang Paint"),
        ("osu!", "osu!"),
    ];
    for &(marker, display) in LINUX_DRAWING_MARKERS {
        if exe_name == marker
            || exe_name.starts_with(&format!("{}-", marker))
            || cls.split_whitespace().any(|tok| tok == marker || tok.contains(marker))
        {
            return Some(display);
        }
    }
    None
}

#[cfg(any(target_os = "linux", test))]
pub fn classify_linux_heavy_gpu_app(wm_class: &str, exe_path: &str) -> bool {
    let cls = wm_class.trim().to_ascii_lowercase();
    let exe_name = exe_path
        .trim()
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    const LINUX_HEAVY_GPU_MARKERS: &[&str] = &[
        "blender",
        "freecad",
        "kicad",
        "pcbnew",
        "godot",
        "unity",
        "unrealeditor",
        "houdini",
        "maya",
        "resolve",
        "davinci",
        "openscad",
        "bambu-studio",
        "orca-slicer",
        "prusa-slicer",
    ];
    LINUX_HEAVY_GPU_MARKERS
        .iter()
        .any(|m| exe_name.contains(m) || cls.contains(m))
}

#[cfg(any(target_os = "linux", test))]
pub fn classify_linux_foreground(
    wm_class: &str,
    wm_name: &str,
    exe_path: &str,
    cmdline: &str,
    is_fullscreen: bool,
) -> Option<String> {
    let cls = wm_class.trim().to_ascii_lowercase();
    let exe_lower = exe_path.trim().to_ascii_lowercase();
    let exe_name = exe_lower.rsplit('/').next().unwrap_or("");
    if cls.is_empty() && exe_name.is_empty() && cmdline.is_empty() {
        return None;
    }

    // 1) Never classify drawing apps, CAD/3D tools, browsers, terminals, IDEs, chat, video, or KuroCat as PC games
    if classify_linux_drawing_app(wm_class, exe_path, cmdline).is_some()
        || classify_linux_heavy_gpu_app(wm_class, exe_path)
    {
        return None;
    }

    const LINUX_EXCLUDED_MARKERS: &[&str] = &[
        "kurocat",
        "kuro-cat-pet",
        "firefox",
        "chromium",
        "google-chrome",
        "chrome",
        "brave-browser",
        "vivaldi",
        "opera",
        "microsoft-edge",
        "zen-browser",
        "vlc",
        "mpv",
        "celluloid",
        "totem",
        "smplayer",
        "haruna",
        "spotify",
        "rhythmbox",
        "gnome-terminal",
        "konsole",
        "kitty",
        "alacritty",
        "wezterm",
        "foot",
        "tilix",
        "xterm",
        "urxvt",
        "terminator",
        "ghostty",
        "code",
        "cursor",
        "jetbrains",
        "idea",
        "pycharm",
        "clion",
        "rustrover",
        "sublime_text",
        "emacs",
        "wechat",
        "weixin",
        "qq",
        "discord",
        "vesktop",
        "telegram",
        "slack",
        "element",
        "zoom",
        "obs",
        "libreoffice",
        "soffice",
        "wps",
        "evince",
        "okular",
        "nautilus",
        "dolphin",
        "thunar",
        "nemo",
        "pcmanfm",
        "gnome-shell",
        "plasmashell",
        "xfdesktop",
        "remmina",
        "xfreerdp",
        "rustdesk",
        "todesk",
        "steamwebhelper",
    ];
    let cls_tokens: Vec<&str> = cls.split_whitespace().collect();
    let is_excluded_token = |tok: &str| {
        LINUX_EXCLUDED_MARKERS
            .iter()
            .any(|m| tok == *m || tok.starts_with(&format!("{}-", m)) || tok.ends_with(&format!(".{}", m)))
    };
    if (!exe_name.is_empty() && is_excluded_token(exe_name))
        || cls_tokens.iter().any(|t| is_excluded_token(t))
        || (exe_name == "steam" && !cls_tokens.iter().any(|t| t.starts_with("steam_app_")))
    {
        return None;
    }

    // 2) Wine / Proton Windows executable inside cmdline -> full 100+ PC game classifier!
    if let Some(win_exe) = extract_wine_or_proton_exe(cmdline) {
        if let Some(name) = classify_windows_foreground(&win_exe, wm_name, is_fullscreen) {
            return Some(name);
        }
    }

    // 3) Steam / Proton WM_CLASS (`steam_app_<appid>`)
    if cls_tokens.iter().any(|t| t.starts_with("steam_app_")) {
        return Some(clean_display_name(
            if exe_name.is_empty() { wm_class } else { exe_name },
            wm_name,
        ));
    }

    // 4) Native Linux games & emulators
    const LINUX_GAME_MARKERS: &[(&str, &str)] = &[
        ("dota2", "Dota 2"),
        ("cs2", "Counter-Strike 2"),
        ("csgo_linux64", "CS:GO"),
        ("hl2_linux", "Half-Life 2"),
        ("tf_linux64", "Team Fortress 2"),
        ("stardewvalley", "Stardew Valley"),
        ("hollow_knight", "Hollow Knight"),
        ("celeste", "Celeste"),
        ("factorio", "Factorio"),
        ("rimworld", "RimWorld"),
        ("terraria", "Terraria"),
        ("valheim", "Valheim"),
        ("dontstarve", "Don't Starve Together"),
        ("balatro", "Balatro"),
        ("hades", "Hades"),
        ("minecraft", "Minecraft"),
        ("retroarch", "RetroArch"),
        ("ppsspp", "PPSSPP"),
        ("rpcs3", "RPCS3"),
        ("ryujinx", "Ryujinx"),
        ("yuzu", "Yuzu"),
        ("pcsx2", "PCSX2"),
        ("dolphin-emu", "Dolphin"),
    ];
    for &(marker, display) in LINUX_GAME_MARKERS {
        if exe_name.contains(marker) || cls.contains(marker) {
            return Some(display.to_string());
        }
    }

    // 5) Executable inside Steam / Lutris / Heroic / Games library directory
    let combined_path = format!("{}\0{}", exe_lower, cmdline.to_ascii_lowercase());
    const LINUX_LIBRARY_MARKERS: &[&str] = &[
        "/steamapps/common/",
        "/heroic/games/",
        "/lutris/",
        "/gog games/",
    ];
    if LINUX_LIBRARY_MARKERS.iter().any(|m| combined_path.contains(m))
        && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w))
    {
        return Some(clean_display_name(
            if exe_name.is_empty() { wm_class } else { exe_name },
            wm_name,
        ));
    }

    // 6) Java Minecraft on Linux
    let title_lower = wm_name.to_ascii_lowercase();
    if exe_name == "java" && (title_lower.contains("minecraft") || title_lower.contains("我的世界"))
    {
        return Some("Minecraft".to_string());
    }

    // 7) Fullscreen non-excluded game window
    if is_fullscreen
        && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w) || cls.contains(w))
    {
        return Some(clean_display_name(
            if exe_name.is_empty() { wm_class } else { exe_name },
            wm_name,
        ));
    }

    None
}

/// Pure, unit-testable `/sys/class/input/event*/device/name` matcher for physical pen/drawing tablets
/// on Linux (Wacom, Huion, XP-Pen, Gaomon, Veikk, Ugee, etc.), excluding touchpads/touchscreens.
#[cfg(any(target_os = "linux", test))]
pub fn looks_like_linux_pen_tablet_name(device_name: &str) -> bool {
    let lower = device_name.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    const EXCLUDE: &[&str] = &[
        "touchpad",
        "trackpad",
        "touchscreen",
        "touch screen",
        "finger",
        "mouse",
        "keyboard",
        "consumer control",
        "system control",
        "gamepad",
        "joystick",
    ];
    if EXCLUDE.iter().any(|e| lower.contains(e)) {
        return false;
    }
    const TABLET_BRANDS: &[&str] = &[
        "wacom",
        "huion",
        "xp-pen",
        "xppen",
        "gaomon",
        "veikk",
        "ugee",
        "parblo",
        "artisul",
        "intuos",
        "cintiq",
        "bamboo",
        "bosto",
        "xencelabs",
        "hanvon",
        "uclogic",
    ];
    if TABLET_BRANDS.iter().any(|b| lower.contains(b)) {
        return true;
    }
    lower.contains("stylus")
        || lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|tok| tok == "pen" || tok == "digitizer")
}

/// Pure policy combining live stylus signals (Windows Ink / macOS TabletSubtype / Linux evdev)
/// with plugged-in HID drawing tablet + active drawing app (catches Wintab / non-Windows-Ink SAI & PS).
pub fn decide_auto_tablet_active(
    live_pen: bool,
    hid_tablet_present: bool,
    drawing_app: Option<&str>,
) -> Option<String> {
    if live_pen {
        return Some("pen".to_string());
    }
    if hid_tablet_present {
        if let Some(app_name) = drawing_app {
            return Some(app_name.to_string());
        }
    }
    None
}

/// Starts a super-lightweight background watcher that detects active PC games for BOTH
/// automatic Game Eco Mode (30 FPS GPU-saving pacing) and optional auto gaming headphones,
/// emitting `kuro-game-active` to the frontend and OBS.
pub fn start_game_detection_watcher(
    app: AppHandle,
    _settings: Arc<Mutex<AppSettings>>,
    paused_guard: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut active = false;
        let mut active_name: Option<String> = None;
        let mut active_needs_admin = false;
        let mut clear_streak: u8 = 0;
        let mut gpu_eco = false;
        let mut gpu_eco_clear_streak: u8 = 0;
        // ~8s Alt-Tab grace window (4 ticks * 2000ms) so quick Alt-Tabs don't flicker Eco Mode / headphones
        const CLEAR_GRACE_TICKS: u8 = 4;

        let mut tablet_active = false;
        let mut tablet_source: Option<String> = None;
        let mut tablet_clear_streak: u8 = 0;
        // ~2s grace window (5 ticks * 400ms) when switching out of drawing apps / lifting pen
        const TABLET_CLEAR_GRACE_TICKS: u8 = 5;
        let mut cached_drawing_app: Option<&'static str> = None;
        let mut cached_hid_tablet = false;
        let mut tick: u32 = 0;

        #[cfg(windows)]
        let mut fg_cache = win_impl::ForegroundCache::default();

        loop {
            std::thread::sleep(Duration::from_millis(400));
            tick = tick.wrapping_add(1);

            let watcher_enabled = !paused_guard.load(Ordering::Relaxed);

            if !watcher_enabled {
                if active || gpu_eco {
                    active = false;
                    active_name = None;
                    active_needs_admin = false;
                    clear_streak = 0;
                    gpu_eco = false;
                    gpu_eco_clear_streak = 0;
                    GAME_ACTIVE.store(false, Ordering::Relaxed);
                    GPU_ECO_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-game-active",
                        GameActivePayload {
                            active: false,
                            game_name: None,
                            needs_admin: false,
                            gpu_eco: false,
                        },
                    );
                }
                if tablet_active {
                    tablet_active = false;
                    tablet_source = None;
                    tablet_clear_streak = 0;
                    TABLET_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-tablet-active",
                        TabletActivePayload {
                            active: false,
                            source: None,
                        },
                    );
                }
                continue;
            }

            // Every 5 ticks (~2000ms): refresh foreground game + drawing app + heavy CAD/3D GPU classification;
            // every 15 ticks (~6000ms): refresh plugged-in HID drawing tablet hardware probe.
            let run_fg_scan = tick == 1 || tick % 5 == 0;
            let run_hid_scan = tick == 1 || tick % 15 == 0;

            if run_hid_scan {
                #[cfg(windows)]
                {
                    cached_hid_tablet = win_impl::has_hid_drawing_tablet();
                }
                #[cfg(target_os = "linux")]
                {
                    cached_hid_tablet = linux_impl::has_hid_drawing_tablet();
                }
                #[cfg(all(not(windows), not(target_os = "linux")))]
                {
                    cached_hid_tablet = false;
                }
            }

            if run_fg_scan {
                #[cfg(windows)]
                let (detected, needs_admin, drawing_app, heavy_gpu) =
                    win_impl::detect_foreground_cached(&mut fg_cache);
                #[cfg(target_os = "macos")]
                let (detected, needs_admin, drawing_app, heavy_gpu) = {
                    let (g, d, h) = mac_impl::detect_foreground();
                    (g, false, d, h)
                };
                #[cfg(target_os = "linux")]
                let (detected, needs_admin, drawing_app, heavy_gpu) = {
                    let (g, d, h) = linux_impl::detect_foreground();
                    (g, false, d, h)
                };
                #[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
                let (detected, needs_admin, drawing_app, heavy_gpu): (
                    Option<String>,
                    bool,
                    Option<&'static str>,
                    bool,
                ) = (None, false, None, false);

                cached_drawing_app = drawing_app;

                let mut emit_game_update = false;
                if let Some(game_name) = detected {
                    clear_streak = 0;
                    if !active
                        || active_name.as_deref() != Some(game_name.as_str())
                        || active_needs_admin != needs_admin
                    {
                        active = true;
                        active_name = Some(game_name);
                        active_needs_admin = needs_admin;
                        GAME_ACTIVE.store(true, Ordering::Relaxed);
                        emit_game_update = true;
                    }
                } else if active {
                    clear_streak = clear_streak.saturating_add(1);
                    if clear_streak >= CLEAR_GRACE_TICKS {
                        active = false;
                        active_name = None;
                        active_needs_admin = false;
                        clear_streak = 0;
                        GAME_ACTIVE.store(false, Ordering::Relaxed);
                        emit_game_update = true;
                    }
                }

                if heavy_gpu {
                    gpu_eco_clear_streak = 0;
                    if !gpu_eco {
                        gpu_eco = true;
                        GPU_ECO_ACTIVE.store(true, Ordering::Relaxed);
                        emit_game_update = true;
                    }
                } else if gpu_eco {
                    gpu_eco_clear_streak = gpu_eco_clear_streak.saturating_add(1);
                    if gpu_eco_clear_streak >= 2 {
                        gpu_eco = false;
                        gpu_eco_clear_streak = 0;
                        GPU_ECO_ACTIVE.store(false, Ordering::Relaxed);
                        emit_game_update = true;
                    }
                }

                if emit_game_update {
                    let _ = app.emit(
                        "kuro-game-active",
                        GameActivePayload {
                            active,
                            game_name: active_name.clone(),
                            needs_admin: active_needs_admin,
                            gpu_eco: active || gpu_eco,
                        },
                    );
                }
            }

            // Every tick (~400ms): responsive live stylus/pen check + HID tablet + drawing app policy.
            let live_pen = crate::input_hook::is_live_pen_active();
            let detected_tablet =
                decide_auto_tablet_active(live_pen, cached_hid_tablet, cached_drawing_app);
            if let Some(src) = detected_tablet {
                tablet_clear_streak = 0;
                if !tablet_active || tablet_source.as_deref() != Some(src.as_str()) {
                    tablet_active = true;
                    tablet_source = Some(src.clone());
                    TABLET_ACTIVE.store(true, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-tablet-active",
                        TabletActivePayload {
                            active: true,
                            source: Some(src),
                        },
                    );
                }
            } else if tablet_active {
                tablet_clear_streak = tablet_clear_streak.saturating_add(1);
                if tablet_clear_streak >= TABLET_CLEAR_GRACE_TICKS {
                    tablet_active = false;
                    tablet_source = None;
                    tablet_clear_streak = 0;
                    TABLET_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-tablet-active",
                        TabletActivePayload {
                            active: false,
                            source: None,
                        },
                    );
                }
            }
        }
    });
}

#[cfg(windows)]
mod win_impl {
    use super::{
        classify_windows_drawing_app, classify_windows_foreground,
        classify_windows_heavy_gpu_app, should_suggest_admin_elevation,
    };
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{
        BOOL, CloseHandle, ERROR_ACCESS_DENIED, GetLastError, HANDLE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    #[link(name = "user32")]
    extern "system" {
        fn GetRawInputDeviceList(
            p_raw_input_device_list: *mut RawInputDeviceList,
            pui_num_devices: *mut u32,
            cb_size: u32,
        ) -> u32;
        fn GetRawInputDeviceInfoW(
            h_device: HANDLE,
            ui_command: u32,
            p_data: *mut c_void,
            pcb_size: *mut u32,
        ) -> u32;
    }

    const RIM_TYPEHID: u32 = 2;
    const RIDI_DEVICEINFO: u32 = 0x2000_000B;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RawInputDeviceList {
        h_device: HANDLE,
        dw_type: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RidDeviceInfoHid {
        dw_vendor_id: u32,
        dw_product_id: u32,
        dw_version_number: u32,
        us_usage_page: u16,
        us_usage: u16,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RidDeviceInfo {
        cb_size: u32,
        dw_type: u32,
        hid: RidDeviceInfoHid,
        _union_pad: [u32; 2],
    }

    /// Zero-dependency Win32 HID Digitizer check: returns `true` if a physical drawing tablet /
    /// pen digitizer (Usage Page `0x0D`, Usage `0x01` Digitizer or `0x02` Pen — strictly excluding
    /// laptop touchscreens `0x04` and touchpads `0x05`) is currently connected.
    pub fn has_hid_drawing_tablet() -> bool {
        unsafe {
            let mut count: u32 = 0;
            let item_sz = std::mem::size_of::<RawInputDeviceList>() as u32;
            if GetRawInputDeviceList(std::ptr::null_mut(), &mut count, item_sz) == u32::MAX
                || count == 0
            {
                return false;
            }
            let capped = (count as usize).min(256);
            let mut list = vec![
                RawInputDeviceList {
                    h_device: std::ptr::null_mut(),
                    dw_type: 0,
                };
                capped
            ];
            let mut n = capped as u32;
            let got = GetRawInputDeviceList(list.as_mut_ptr(), &mut n, item_sz);
            if got == u32::MAX {
                return false;
            }
            let info_sz = std::mem::size_of::<RidDeviceInfo>() as u32;
            for dev in list.iter().take((got as usize).min(capped)) {
                if dev.dw_type != RIM_TYPEHID || dev.h_device.is_null() {
                    continue;
                }
                let mut info = RidDeviceInfo {
                    cb_size: info_sz,
                    dw_type: 0,
                    hid: RidDeviceInfoHid {
                        dw_vendor_id: 0,
                        dw_product_id: 0,
                        dw_version_number: 0,
                        us_usage_page: 0,
                        us_usage: 0,
                    },
                    _union_pad: [0; 2],
                };
                let mut sz = info_sz;
                let res = GetRawInputDeviceInfoW(
                    dev.h_device,
                    RIDI_DEVICEINFO,
                    (&mut info as *mut RidDeviceInfo).cast(),
                    &mut sz,
                );
                if res != u32::MAX
                    && info.dw_type == RIM_TYPEHID
                    && info.hid.us_usage_page == 0x0D
                    && matches!(info.hid.us_usage, 0x01 | 0x02)
                {
                    return true;
                }
            }
            false
        }
    }

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

    /// Read-only check whether a foreground process runs at a higher privilege level than us.
    /// From a non-elevated (Medium-IL) process, `OpenProcessToken(TOKEN_QUERY)` on a High-IL
    /// (Administrator) process fails with `ERROR_ACCESS_DENIED`, while on a Medium-IL process
    /// it succeeds with `token_is_elevated == 0`.
    unsafe fn is_process_elevated(hproc: HANDLE) -> bool {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(hproc, TOKEN_QUERY, &mut token) == 0 || token.is_null() {
            return GetLastError() == ERROR_ACCESS_DENIED;
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

    #[derive(Default)]
    pub struct ForegroundCache {
        last_fg: isize,
        last_d3d_fs: bool,
        last_result: (Option<String>, bool, Option<&'static str>, bool),
    }

    pub fn detect_foreground_cached(
        cache: &mut ForegroundCache,
    ) -> (Option<String>, bool, Option<&'static str>, bool) {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                cache.last_fg = 0;
                cache.last_d3d_fs = false;
                cache.last_result = (None, false, None, false);
                return (None, false, None, false);
            }

            let mut quns: i32 = 0;
            let is_d3d_fs = SHQueryUserNotificationState(&mut quns) == 0
                && quns == QUNS_RUNNING_D3D_FULL_SCREEN;
            let fg_id = fg as isize;
            if fg_id == cache.last_fg && is_d3d_fs == cache.last_d3d_fs {
                return cache.last_result.clone();
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(fg, &mut pid);
            if pid == 0 {
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false, None, false);
                return (None, false, None, false);
            }

            let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if hproc.is_null() {
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false, None, false);
                return (None, false, None, false);
            }

            let mut path_buf = [0u16; 512];
            let mut path_len: u32 = path_buf.len() as u32;
            let ok = QueryFullProcessImageNameW(hproc, 0, path_buf.as_mut_ptr(), &mut path_len);
            if ok == 0 || path_len == 0 {
                CloseHandle(hproc);
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false, None, false);
                return (None, false, None, false);
            }
            let exe_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);

            let mut title_buf = [0u16; 160];
            let title_len = GetWindowTextW(fg, title_buf.as_mut_ptr(), title_buf.len() as i32);
            let window_title = if title_len > 0 {
                String::from_utf16_lossy(&title_buf[..title_len as usize])
            } else {
                String::new()
            };

            let result = classify_windows_foreground(&exe_path, &window_title, is_d3d_fs);
            let drawing_app = classify_windows_drawing_app(&exe_path);
            let heavy_gpu = classify_windows_heavy_gpu_app(&exe_path);
            let self_elevated = crate::win_is_elevated();
            let target_elevated = if result.is_some() && !self_elevated {
                is_process_elevated(hproc)
            } else {
                false
            };
            CloseHandle(hproc);

            let needs_admin = should_suggest_admin_elevation(
                &exe_path,
                result.is_some(),
                target_elevated,
                self_elevated,
            );

            cache.last_fg = fg_id;
            cache.last_d3d_fs = is_d3d_fs;
            cache.last_result = (result.clone(), needs_admin, drawing_app, heavy_gpu);
            (result, needs_admin, drawing_app, heavy_gpu)
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::{
        classify_macos_drawing_app, classify_macos_foreground, classify_macos_heavy_gpu_app,
    };
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    pub fn detect_foreground() -> (Option<String>, Option<&'static str>, bool) {
        unsafe {
            let Some(cls) = AnyClass::get(c"NSWorkspace") else {
                return (None, None, false);
            };
            let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if ws.is_null() {
                return (None, None, false);
            }
            let app: *mut AnyObject = msg_send![ws, frontmostApplication];
            if app.is_null() {
                return (None, None, false);
            }
            let bid_obj: *const NSString = msg_send![app, bundleIdentifier];
            let name_obj: *const NSString = msg_send![app, localizedName];
            let bid = if !bid_obj.is_null() {
                (*bid_obj).to_string()
            } else {
                String::new()
            };
            let name = if !name_obj.is_null() {
                (*name_obj).to_string()
            } else {
                String::new()
            };
            (
                classify_macos_foreground(&bid, &name),
                classify_macos_drawing_app(&bid, &name),
                classify_macos_heavy_gpu_app(&bid, &name),
            )
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::{
        classify_linux_drawing_app, classify_linux_foreground, classify_linux_heavy_gpu_app,
        looks_like_linux_pen_tablet_name,
    };

    /// Pure `sysfs` scan for connected pen/stylus drawing tablets (~0% CPU, zero dependencies).
    pub fn has_hid_drawing_tablet() -> bool {
        let Ok(entries) = std::fs::read_dir("/sys/class/input") else {
            return false;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !name.to_string_lossy().starts_with("event") {
                continue;
            }
            let dev_name_path = entry.path().join("device/name");
            if let Ok(dev_name) = std::fs::read_to_string(dev_name_path) {
                if looks_like_linux_pen_tablet_name(&dev_name) {
                    return true;
                }
            }
        }
        false
    }

    pub fn detect_foreground() -> (Option<String>, Option<&'static str>, bool) {
        let Some(info) = crate::input_hook::linux_hook::query_active_window_info() else {
            return (None, None, false);
        };
        let (exe_path, cmdline) = if let Some(pid) = info.pid {
            let exe = std::fs::read_link(format!("/proc/{}/exe", pid))
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let cmd = std::fs::read(format!("/proc/{}/cmdline", pid))
                .ok()
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                .unwrap_or_default();
            (exe, cmd)
        } else {
            (String::new(), String::new())
        };
        let game = classify_linux_foreground(
            &info.wm_class,
            &info.wm_name,
            &exe_path,
            &cmdline,
            info.is_fullscreen,
        );
        let drawing = classify_linux_drawing_app(&info.wm_class, &exe_path, &cmdline);
        let heavy_gpu = classify_linux_heavy_gpu_app(&info.wm_class, &exe_path);
        (game, drawing, heavy_gpu)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_macos_drawing_app, classify_macos_foreground, classify_windows_drawing_app,
        classify_windows_foreground, decide_auto_tablet_active, should_suggest_admin_elevation,
    };

    #[test]
    fn detects_drawing_apps_and_pen_tablet_policy() {
        assert_eq!(
            classify_windows_drawing_app(r"C:\Program Files\Adobe\Photoshop.exe"),
            Some("Photoshop")
        );
        assert_eq!(
            classify_windows_drawing_app(r"D:\Art\SAI2\sai2.exe"),
            Some("PaintTool SAI 2")
        );
        assert_eq!(
            classify_windows_drawing_app(r"C:\Program Files\CELSYS\CLIP STUDIO 1.5\CLIP STUDIO PAINT\CLIPStudioPaint.exe"),
            Some("Clip Studio Paint")
        );
        assert!(classify_windows_drawing_app(r"C:\Windows\notepad.exe").is_none());
        assert_eq!(
            classify_macos_drawing_app("com.adobe.Photoshop", "Adobe Photoshop"),
            Some("Photoshop")
        );
        assert_eq!(
            decide_auto_tablet_active(true, false, None).as_deref(),
            Some("pen")
        );
        assert_eq!(
            decide_auto_tablet_active(false, true, Some("PaintTool SAI 2")).as_deref(),
            Some("PaintTool SAI 2")
        );
        assert!(decide_auto_tablet_active(false, false, Some("Photoshop")).is_none());
        assert!(decide_auto_tablet_active(false, true, None).is_none());
        // Windows Ink pen signature check (excludes touch bit 0x80 and regular mouse 0)
        assert!(crate::input_hook::is_windows_pen_extra_info(0xFF51_5700));
        assert!(crate::input_hook::is_windows_pen_extra_info(0xFF51_5704));
        assert!(!crate::input_hook::is_windows_pen_extra_info(0xFF51_5780));
        assert!(!crate::input_hook::is_windows_pen_extra_info(0));
    }

    #[test]
    fn suggests_admin_hint_only_for_elevated_non_kernel_anticheat_games() {
        assert!(should_suggest_admin_elevation(
            r"D:\Games\Genshin Impact\YuanShen.exe",
            true,
            true,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\Games\Genshin Impact\YuanShen.exe",
            true,
            true,
            true
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\SteamLibrary\steamapps\common\Hades\Hades.exe",
            true,
            false,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe",
            true,
            true,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\WeGameApps\DeltaForce\DeltaForceClient-Win64-Shipping.exe",
            true,
            true,
            false
        ));
    }

    #[test]
    fn recognizes_known_games_and_engine_paths() {
        assert_eq!(
            classify_windows_foreground(r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe", "VALORANT  ", false).as_deref(),
            Some("VALORANT")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\Games\Genshin Impact\Genshin Impact Game\YuanShen.exe", "原神", false).as_deref(),
            Some("原神")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\SteamLibrary\steamapps\common\Hollow Knight Silksong\Silksong.exe", "Silksong", false).as_deref(),
            Some("Silksong")
        );
        assert_eq!(
            classify_windows_foreground(r"C:\Program Files\Java\bin\javaw.exe", "Minecraft 1.21.4", false).as_deref(),
            Some("Minecraft")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\Indie\MyCoolGame-Win64-Shipping.exe", "My Cool Game", false).as_deref(),
            Some("My Cool Game")
        );
        // Unknown D3D fullscreen game should be detected
        assert!(
            classify_windows_foreground(r"D:\CustomGames\SpaceRacer.exe", "Space Racer", true).is_some()
        );
    }

    #[test]
    fn rejects_browsers_video_players_office_and_launchers() {
        assert!(classify_windows_foreground(r"C:\Program Files\Google\Chrome\Application\chrome.exe", "YouTube", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\VideoLAN\VLC\vlc.exe", "Movie.mp4", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Tencent\WeChat\WeChat.exe", "微信", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files (x86)\Steam\steam.exe", "Steam", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Autodesk\AutoCAD 2024\acad.exe", "Drawing1.dwg", true).is_none());
        assert!(super::classify_windows_heavy_gpu_app(r"C:\Program Files\Autodesk\AutoCAD 2024\acad.exe"));
        assert!(super::classify_windows_heavy_gpu_app("ZWCAD.exe"));
        assert!(super::classify_windows_heavy_gpu_app("SLDWORKS.exe"));
        assert!(!super::classify_windows_heavy_gpu_app("chrome.exe"));
        assert!(classify_windows_foreground(r"D:\SteamLibrary\steamapps\common\SomeGame\CrashReporter.exe", "Crash Reporter", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Java\bin\javaw.exe", "IntelliJ Helper", false).is_none());
        assert!(classify_macos_foreground("com.google.Chrome", "Google Chrome").is_none());
        assert!(classify_macos_foreground("com.riotgames.LeagueOfLegends", "League of Legends").is_some());
        assert!(super::classify_macos_heavy_gpu_app("org.blenderfoundation.blender", "Blender"));
        assert!(!super::classify_macos_heavy_gpu_app("com.google.Chrome", "Google Chrome"));
    }

    #[test]
    fn classifies_linux_games_proton_drawing_apps_cad_and_pen_tablets() {
        use super::{
            classify_linux_drawing_app, classify_linux_foreground, classify_linux_heavy_gpu_app,
            looks_like_linux_pen_tablet_name,
        };

        // Steam Proton / Wine games & native Linux games
        assert_eq!(
            classify_linux_foreground(
                "steam_app_1245620 steam_app_1245620",
                "ELDEN RING",
                "/usr/bin/wine64-preloader",
                "Z:\\home\\u\\.local\\share\\Steam\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe\0",
                true
            )
            .as_deref(),
            Some("Elden Ring")
        );
        assert_eq!(
            classify_linux_foreground("dota2 dota2", "Dota 2", "/home/u/.steam/dota2", "", false)
                .as_deref(),
            Some("Dota 2")
        );
        assert_eq!(
            classify_linux_foreground(
                "steam_app_1145360",
                "Hades",
                "/home/u/steamapps/common/Hades/x64/Hades",
                "",
                false
            )
            .as_deref(),
            Some("Hades")
        );
        assert_eq!(
            classify_linux_foreground("Minecraft", "Minecraft 1.21.4", "/usr/bin/java", "", false)
                .as_deref(),
            Some("Minecraft")
        );

        // Reject browsers, terminals, IDEs, video players, drawing apps, and CAD tools as games
        assert!(classify_linux_foreground("Navigator firefox", "YouTube", "/usr/lib/firefox/firefox", "", true).is_none());
        assert!(classify_linux_foreground("google-chrome Google-chrome", "Twitch", "/opt/google/chrome/chrome", "", true).is_none());
        assert!(classify_linux_foreground("vlc vlc", "Movie.mkv", "/usr/bin/vlc", "", true).is_none());
        assert!(classify_linux_foreground("kitty kitty", "zsh", "/usr/bin/kitty", "", true).is_none());
        assert!(classify_linux_foreground("code Code", "main.rs", "/usr/share/code/code", "", false).is_none());
        assert!(classify_linux_foreground("krita krita", "Illustration.kra", "/usr/bin/krita", "", false).is_none());
        assert!(classify_linux_foreground("Blender Blender", "Scene.blend", "/usr/bin/blender", "", true).is_none());

        // Linux native + Wine drawing apps
        assert_eq!(classify_linux_drawing_app("krita krita", "/usr/bin/krita", ""), Some("Krita"));
        assert_eq!(classify_linux_drawing_app("gimp-2.10 Gimp-2.10", "/usr/bin/gimp-2.10", ""), Some("GIMP"));
        assert_eq!(
            classify_linux_drawing_app("wine", "/usr/bin/wine64", "C:\\CELSYS\\CLIPStudioPaint.exe\0"),
            Some("Clip Studio Paint")
        );
        assert!(classify_linux_drawing_app("firefox", "/usr/bin/firefox", "").is_none());

        // Linux heavy GPU CAD/3D Eco Mode
        assert!(classify_linux_heavy_gpu_app("Blender", "/usr/bin/blender"));
        assert!(classify_linux_heavy_gpu_app("FreeCAD", "/usr/bin/freecad"));
        assert!(classify_linux_heavy_gpu_app("kicad", "/usr/bin/pcbnew"));
        assert!(!classify_linux_heavy_gpu_app("firefox", "/usr/bin/firefox"));

        // Linux /sys/class/input pen tablet hardware detection
        assert!(looks_like_linux_pen_tablet_name("Wacom Intuos Pro S Pen"));
        assert!(looks_like_linux_pen_tablet_name("HUION Huion Tablet_H640P Pen"));
        assert!(looks_like_linux_pen_tablet_name("UGTABLET 10 inch PenTablet stylus"));
        assert!(!looks_like_linux_pen_tablet_name("Wacom Intuos Pro S Finger"));
        assert!(!looks_like_linux_pen_tablet_name("SynPS/2 Synaptics TouchPad"));
        assert!(!looks_like_linux_pen_tablet_name("ELAN Touchscreen"));
        assert!(!looks_like_linux_pen_tablet_name("Logitech Wireless Mouse"));
    }
}
