//! Lightweight, zero-dependency, anti-cheat-safe native gamepad watcher.
//!
//! - Windows: dual-engine passive reader combining:
//!   1. `xinput1_4.dll` / `xinput9_1_0.dll` / `xinput1_3.dll` (`XInputGetState`) for Xbox &
//!      XInput-mode controllers (and virtual Xbox controllers from Steam Input / DS4Windows).
//!   2. Win32 Raw Input (`RIDEV_INPUTSINK` on an invisible `HWND_MESSAGE` window) + `hid.dll`
//!      (`HidP_*`) for native USB & Bluetooth HID controllers: PlayStation 5 DualSense &
//!      DualSense Edge (USB `0x01`, BT Simple `0x01`, BT Enhanced `0x31`), PlayStation 4
//!      DualShock 4 (USB `0x01`, BT `0x11`), Nintendo Switch Pro (`0x30` / `0x3F`), and
//!      generic DirectInput/HID gamepads.
//!   Both engines are 100% read-only, work globally in the background even during fullscreen
//!   games, and sleep at ~0% CPU when idle.
//! - Linux: non-blocking read of `/dev/input/js0..js3` standard joystick events.
//! - macOS: passive non-exclusive `IOKit` (`IOHIDManager`) element watcher supporting Xbox
//!   Wireless/USB, PlayStation DualSense / DualShock 4, Nintendo Switch Pro, and generic HID
//!   controllers without extra dependencies or Input Monitoring permission.
//! - Automatically activates when any stick/trigger/button moves and yields back to keyboard &
//!   mouse after inactivity once keyboard/mouse input resumes.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

static GAMEPAD_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_gamepad_active() -> bool {
    GAMEPAD_ACTIVE.load(Ordering::Relaxed)
}

/// Bit positions in `GamepadSnapshot::buttons`.
pub const BTN_A: u16 = 1 << 0;
pub const BTN_B: u16 = 1 << 1;
pub const BTN_X: u16 = 1 << 2;
pub const BTN_Y: u16 = 1 << 3;
pub const BTN_LB: u16 = 1 << 4;
pub const BTN_RB: u16 = 1 << 5;
pub const BTN_UP: u16 = 1 << 6;
pub const BTN_DOWN: u16 = 1 << 7;
pub const BTN_LEFT: u16 = 1 << 8;
pub const BTN_RIGHT: u16 = 1 << 9;
pub const BTN_START: u16 = 1 << 10;
pub const BTN_BACK: u16 = 1 << 11;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamepadSnapshot {
    pub active: bool,
    pub lx: f32,
    pub ly: f32,
    pub rx: f32,
    pub ry: f32,
    pub lt: f32,
    pub rt: f32,
    pub buttons: u16,
}

impl Default for GamepadSnapshot {
    fn default() -> Self {
        Self {
            active: false,
            lx: 0.0,
            ly: 0.0,
            rx: 0.0,
            ry: 0.0,
            lt: 0.0,
            rt: 0.0,
            buttons: 0,
        }
    }
}

impl GamepadSnapshot {
    pub fn has_input(&self) -> bool {
        self.buttons != 0
            || self.lx.abs() >= 0.01
            || self.ly.abs() >= 0.01
            || self.rx.abs() >= 0.01
            || self.ry.abs() >= 0.01
            || self.lt >= 0.01
            || self.rt >= 0.01
    }

    fn differs_visibly(&self, other: &Self) -> bool {
        self.active != other.active
            || self.buttons != other.buttons
            || (self.lx - other.lx).abs() >= 0.025
            || (self.ly - other.ly).abs() >= 0.025
            || (self.rx - other.rx).abs() >= 0.025
            || (self.ry - other.ry).abs() >= 0.025
            || (self.lt - other.lt).abs() >= 0.04
            || (self.rt - other.rt).abs() >= 0.04
    }
}

/// Normalizes a signed 16-bit thumbstick axis with radial/linear deadzone into `-1.0..=1.0`.
pub fn normalize_stick_axis(raw: i16, deadzone: f32) -> f32 {
    let norm = if raw < 0 {
        (raw as f32) / 32768.0
    } else {
        (raw as f32) / 32767.0
    };
    let mag = norm.abs();
    if mag <= deadzone {
        return 0.0;
    }
    let scaled = ((mag - deadzone) / (1.0 - deadzone)).clamp(0.0, 1.0);
    scaled.copysign(norm)
}

/// Normalizes an unsigned 8-bit trigger into `0.0..=1.0` with a small threshold deadzone.
pub fn normalize_trigger(raw: u8) -> f32 {
    let norm = (raw as f32) / 255.0;
    if norm <= 0.10 {
        0.0
    } else {
        ((norm - 0.10) / 0.90).clamp(0.0, 1.0)
    }
}

/// Normalizes an unsigned 8-bit stick axis (`0..=255`, center `128`) into `-1.0..=1.0`.
/// When `invert_y` is true, `0` (HID up) maps to `+1.0` and `255` (HID down) maps to `-1.0`.
pub fn normalize_u8_stick(raw: u8, deadzone: f32, invert_y: bool) -> f32 {
    let centered = ((raw as f32) - 127.5) / 127.5;
    let signed = if invert_y { -centered } else { centered };
    let mag = signed.abs();
    if mag <= deadzone {
        return 0.0;
    }
    let scaled = ((mag - deadzone) / (1.0 - deadzone)).clamp(0.0, 1.0);
    scaled.copysign(signed)
}

/// Normalizes an arbitrary HID integer range `[logical_min..=logical_max]` into `-1.0..=1.0`.
pub fn normalize_hid_stick(
    raw_u32: u32,
    logical_min: i32,
    logical_max: i32,
    bit_size: u16,
    deadzone: f32,
    invert: bool,
) -> f32 {
    let (val, min_f, max_f) = decode_hid_axis_value(raw_u32, logical_min, logical_max, bit_size);
    let span = max_f - min_f;
    if span <= 1.0 {
        return 0.0;
    }
    let norm = ((val - min_f) / span) * 2.0 - 1.0;
    let signed = if invert { -norm } else { norm };
    let mag = signed.abs();
    if mag <= deadzone {
        return 0.0;
    }
    let scaled = ((mag - deadzone) / (1.0 - deadzone)).clamp(0.0, 1.0);
    scaled.copysign(signed)
}

/// Normalizes an arbitrary HID trigger range `[logical_min..=logical_max]` into `0.0..=1.0`.
pub fn normalize_hid_trigger(raw_u32: u32, logical_min: i32, logical_max: i32, bit_size: u16) -> f32 {
    let (val, min_f, max_f) = decode_hid_axis_value(raw_u32, logical_min, logical_max, bit_size);
    let span = max_f - min_f;
    if span <= 1.0 {
        return 0.0;
    }
    let norm = ((val - min_f) / span).clamp(0.0, 1.0);
    if norm <= 0.10 {
        0.0
    } else {
        ((norm - 0.10) / 0.90).clamp(0.0, 1.0)
    }
}

fn decode_hid_axis_value(raw_u32: u32, logical_min: i32, logical_max: i32, bit_size: u16) -> (f32, f32, f32) {
    let bits = bit_size.clamp(1, 32) as u32;
    let mask: u32 = if bits >= 32 { u32::MAX } else { (1u32 << bits) - 1 };
    let masked = raw_u32 & mask;
    if logical_min < 0 {
        // Sign-extend `bits`-wide two's complement value
        let signed = if bits < 32 {
            let sign_bit = 1u32 << (bits - 1);
            if (masked & sign_bit) != 0 {
                (masked | !mask) as i32
            } else {
                masked as i32
            }
        } else {
            masked as i32
        };
        let eff_max = if logical_max <= logical_min {
            ((1i64 << (bits.saturating_sub(1).min(31))) - 1) as f32
        } else {
            logical_max as f32
        };
        (signed as f32, logical_min as f32, eff_max)
    } else {
        // Unsigned HID axis; guard common firmware quirk where logical_max == -1 represents all-ones
        let eff_max = if logical_max <= logical_min {
            mask as f32
        } else {
            logical_max as f32
        };
        (masked as f32, logical_min as f32, eff_max)
    }
}

/// Converts a standard 8-way HID hat switch value (`0..=7`: N, NE, E, SE, S, SW, W, NW)
/// into `BTN_UP | BTN_DOWN | BTN_LEFT | BTN_RIGHT` flags. Any other value returns `0`.
pub fn dpad_from_hat(hat: u8) -> u16 {
    match hat {
        0 => BTN_UP,
        1 => BTN_UP | BTN_RIGHT,
        2 => BTN_RIGHT,
        3 => BTN_DOWN | BTN_RIGHT,
        4 => BTN_DOWN,
        5 => BTN_DOWN | BTN_LEFT,
        6 => BTN_LEFT,
        7 => BTN_UP | BTN_LEFT,
        _ => 0,
    }
}

/// Returns true when a Windows Raw Input HID device path belongs to an XInput-managed
/// Xbox controller (`&IG_00`..`&IG_03`), per Microsoft's documented XInput detection rule.
pub fn is_xinput_device_path(path: &str) -> bool {
    path.as_bytes()
        .windows(3)
        .any(|w| (w[0] == b'I' || w[0] == b'i') && (w[1] == b'G' || w[1] == b'g') && w[2] == b'_')
}

fn decode_sony_buttons(b0: u8, b1: u8) -> (u16, bool, bool) {
    let mut buttons = dpad_from_hat(b0 & 0x0F);
    // Physical diamond positions match Xbox A/B/X/Y:
    // Square (left) -> X, Cross (bottom) -> A, Circle (right) -> B, Triangle (top) -> Y
    if (b0 & 0x10) != 0 {
        buttons |= BTN_X;
    }
    if (b0 & 0x20) != 0 {
        buttons |= BTN_A;
    }
    if (b0 & 0x40) != 0 {
        buttons |= BTN_B;
    }
    if (b0 & 0x80) != 0 {
        buttons |= BTN_Y;
    }
    if (b1 & 0x01) != 0 {
        buttons |= BTN_LB;
    }
    if (b1 & 0x02) != 0 {
        buttons |= BTN_RB;
    }
    let l2_digital = (b1 & 0x04) != 0;
    let r2_digital = (b1 & 0x08) != 0;
    if (b1 & 0x10) != 0 {
        buttons |= BTN_BACK;
    }
    if (b1 & 0x20) != 0 {
        buttons |= BTN_START;
    }
    (buttons, l2_digital, r2_digital)
}

/// Parses a Sony DualSense (PS5 / DualSense Edge) full input payload starting at `lx`:
/// - USB Report ID `0x01`: payload starts at `&report[1..]`
/// - Bluetooth Enhanced Report ID `0x31`: payload starts at `&report[2..]`
pub fn parse_dualsense_full_payload(p: &[u8]) -> Option<GamepadSnapshot> {
    if p.len() < 9 {
        return None;
    }
    let (buttons, l2_dig, r2_dig) = decode_sony_buttons(p[7], p[8]);
    let mut lt = normalize_trigger(p[4]);
    let mut rt = normalize_trigger(p[5]);
    if lt < 0.01 && l2_dig {
        lt = 1.0;
    }
    if rt < 0.01 && r2_dig {
        rt = 1.0;
    }
    Some(GamepadSnapshot {
        active: false,
        lx: normalize_u8_stick(p[0], 0.18, false),
        ly: normalize_u8_stick(p[1], 0.18, true),
        rx: normalize_u8_stick(p[2], 0.18, false),
        ry: normalize_u8_stick(p[3], 0.18, true),
        lt,
        rt,
        buttons,
    })
}

/// Parses a Sony DualSense Bluetooth Enhanced report (`report[0] == 0x31`, 78 bytes).
pub fn parse_dualsense_bt_0x31(report: &[u8]) -> Option<GamepadSnapshot> {
    if report.len() < 11 || report[0] != 0x31 {
        return None;
    }
    parse_dualsense_full_payload(&report[2..])
}

/// Parses a Sony DualShock 4 payload (or DualSense Bluetooth Simple `0x01` payload) starting at `lx`:
/// - DS4 USB `0x01` & DS4/DualSense BT Simple `0x01`: payload starts at `&report[1..]`
/// - DS4 BT Enhanced `0x11`: payload starts at `&report[3..]`
pub fn parse_sony_classic_payload(p: &[u8]) -> Option<GamepadSnapshot> {
    if p.len() < 7 {
        return None;
    }
    let (buttons, l2_dig, r2_dig) = decode_sony_buttons(p[4], p[5]);
    let mut lt = if p.len() >= 9 {
        normalize_trigger(p[7])
    } else {
        0.0
    };
    let mut rt = if p.len() >= 9 {
        normalize_trigger(p[8])
    } else {
        0.0
    };
    if lt < 0.01 && l2_dig {
        lt = 1.0;
    }
    if rt < 0.01 && r2_dig {
        rt = 1.0;
    }
    Some(GamepadSnapshot {
        active: false,
        lx: normalize_u8_stick(p[0], 0.18, false),
        ly: normalize_u8_stick(p[1], 0.18, true),
        rx: normalize_u8_stick(p[2], 0.18, false),
        ry: normalize_u8_stick(p[3], 0.18, true),
        lt,
        rt,
        buttons,
    })
}

/// Parses a Sony DualShock 4 Bluetooth Enhanced report (`report[0] == 0x11`, 78 bytes).
pub fn parse_ds4_bt_0x11(report: &[u8]) -> Option<GamepadSnapshot> {
    if report.len() < 12 || report[0] != 0x11 {
        return None;
    }
    parse_sony_classic_payload(&report[3..])
}

/// Fallback raw-byte parser for DualSense Report ID `0x01` when HID preparsed data is absent.
pub fn parse_dualsense_0x01_fallback(report: &[u8]) -> Option<GamepadSnapshot> {
    if report.first().copied() != Some(0x01) {
        return None;
    }
    if report.len() == 64 {
        parse_dualsense_full_payload(&report[1..])
    } else {
        parse_sony_classic_payload(&report[1..])
    }
}

/// Parses a Nintendo Switch Pro Controller full-mode input report (`report[0] == 0x30`, >= 12 bytes).
pub fn parse_switch_pro_0x30(report: &[u8]) -> Option<GamepadSnapshot> {
    if report.len() < 12 || report[0] != 0x30 {
        return None;
    }
    let b_right = report[3];
    let b_shared = report[4];
    let b_left = report[5];

    let mut buttons: u16 = 0;
    // Physical diamond positions: Y=left->X, X=top->Y, B=bottom->A, A=right->B
    if (b_right & 0x01) != 0 {
        buttons |= BTN_X;
    }
    if (b_right & 0x02) != 0 {
        buttons |= BTN_Y;
    }
    if (b_right & 0x04) != 0 {
        buttons |= BTN_A;
    }
    if (b_right & 0x08) != 0 {
        buttons |= BTN_B;
    }
    if (b_right & 0x40) != 0 {
        buttons |= BTN_RB;
    }
    let rt = if (b_right & 0x80) != 0 { 1.0 } else { 0.0 };

    if (b_shared & 0x01) != 0 {
        buttons |= BTN_BACK;
    }
    if (b_shared & 0x02) != 0 {
        buttons |= BTN_START;
    }

    if (b_left & 0x01) != 0 {
        buttons |= BTN_DOWN;
    }
    if (b_left & 0x02) != 0 {
        buttons |= BTN_UP;
    }
    if (b_left & 0x04) != 0 {
        buttons |= BTN_RIGHT;
    }
    if (b_left & 0x08) != 0 {
        buttons |= BTN_LEFT;
    }
    if (b_left & 0x40) != 0 {
        buttons |= BTN_LB;
    }
    let lt = if (b_left & 0x80) != 0 { 1.0 } else { 0.0 };

    let norm_12bit = |raw: u16| -> f32 {
        let centered = ((raw as f32) - 2048.0) / 1450.0;
        let mag = centered.abs();
        if mag <= 0.20 {
            return 0.0;
        }
        let scaled = ((mag - 0.20) / 0.80).clamp(0.0, 1.0);
        scaled.copysign(centered)
    };
    let lx_raw = (report[6] as u16) | (((report[7] & 0x0F) as u16) << 8);
    let ly_raw = ((report[7] >> 4) as u16) | ((report[8] as u16) << 4);
    let rx_raw = (report[9] as u16) | (((report[10] & 0x0F) as u16) << 8);
    let ry_raw = ((report[10] >> 4) as u16) | ((report[11] as u16) << 4);

    Some(GamepadSnapshot {
        active: false,
        lx: norm_12bit(lx_raw),
        ly: norm_12bit(ly_raw),
        rx: norm_12bit(rx_raw),
        ry: norm_12bit(ry_raw),
        lt,
        rt,
        buttons,
    })
}

/// Converts raw Windows `XINPUT_GAMEPAD` fields into a clean `GamepadSnapshot`.
pub fn parse_xinput_gamepad(
    w_buttons: u16,
    b_left_trigger: u8,
    b_right_trigger: u8,
    s_thumb_lx: i16,
    s_thumb_ly: i16,
    s_thumb_rx: i16,
    s_thumb_ry: i16,
) -> GamepadSnapshot {
    let mut buttons: u16 = 0;
    if (w_buttons & 0x1000) != 0 {
        buttons |= BTN_A;
    }
    if (w_buttons & 0x2000) != 0 {
        buttons |= BTN_B;
    }
    if (w_buttons & 0x4000) != 0 {
        buttons |= BTN_X;
    }
    if (w_buttons & 0x8000) != 0 {
        buttons |= BTN_Y;
    }
    if (w_buttons & 0x0100) != 0 {
        buttons |= BTN_LB;
    }
    if (w_buttons & 0x0200) != 0 {
        buttons |= BTN_RB;
    }
    if (w_buttons & 0x0001) != 0 {
        buttons |= BTN_UP;
    }
    if (w_buttons & 0x0002) != 0 {
        buttons |= BTN_DOWN;
    }
    if (w_buttons & 0x0004) != 0 {
        buttons |= BTN_LEFT;
    }
    if (w_buttons & 0x0008) != 0 {
        buttons |= BTN_RIGHT;
    }
    if (w_buttons & 0x0010) != 0 {
        buttons |= BTN_START;
    }
    if (w_buttons & 0x0020) != 0 {
        buttons |= BTN_BACK;
    }

    GamepadSnapshot {
        active: false,
        lx: normalize_stick_axis(s_thumb_lx, 0.18),
        ly: normalize_stick_axis(s_thumb_ly, 0.18),
        rx: normalize_stick_axis(s_thumb_rx, 0.18),
        ry: normalize_stick_axis(s_thumb_ry, 0.18),
        lt: normalize_trigger(b_left_trigger),
        rt: normalize_trigger(b_right_trigger),
        buttons,
    }
}

/// Shared controller hardware classification by USB/Bluetooth VID/PID (used by Windows Raw Input
/// HID and macOS IOKit `IOHIDManager`).
#[cfg_attr(target_os = "linux", allow(dead_code))]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum HidControllerKind {
    SkipXInput,
    SonyDualSense,
    SonyDualShock4,
    SonyOther,
    NintendoSwitchPro,
    XboxModernBt,
    Generic,
}

#[cfg_attr(target_os = "linux", allow(dead_code))]
pub(crate) fn classify_hid_vid_pid(vid: u32, pid: u32) -> HidControllerKind {
    match (vid, pid) {
        (0x054C, 0x0CE6) | (0x054C, 0x0DF2) => HidControllerKind::SonyDualSense,
        (0x054C, 0x05C4) | (0x054C, 0x09CC) | (0x054C, 0x0BA0) => {
            HidControllerKind::SonyDualShock4
        }
        (0x054C, _) => HidControllerKind::SonyOther,
        (0x057E, 0x2009) => HidControllerKind::NintendoSwitchPro,
        // Modern Xbox Wireless/Bluetooth HID descriptors on macOS expose non-contiguous button
        // usages (1=A,2=B,4=X,5=Y,7=LB,8=RB,11=Back,12=Start), Consumer AC Back (0x224), and
        // Simulation Controls Brake/Accelerator triggers (0x02 / 0xC5 & 0xC4).
        (0x045E, 0x02FD | 0x02E0 | 0x0B05 | 0x0B0A | 0x0B13 | 0x0B20 | 0x0B22) => {
            HidControllerKind::XboxModernBt
        }
        _ => HidControllerKind::Generic,
    }
}

/// Pure, cross-platform HID element state aggregator used by macOS `IOHIDManager` (and unit-tested
/// on every OS). Tracks each element's normalized value across incremental element callbacks.
#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Debug)]
pub(crate) struct HidElementDeviceState {
    pub kind: HidControllerKind,
    lx: f32,
    ly: f32,
    z: Option<f32>,
    rx_raw: Option<(f32, f32)>, // (stick_norm, trigger_norm)
    ry_raw: Option<(f32, f32)>, // (stick_norm, trigger_norm)
    rz: Option<f32>,
    sim_lt: Option<f32>,
    sim_rt: Option<f32>,
    hat_bits: u16,
    btn_bits: u16,
    l2_digital: bool,
    r2_digital: bool,
}

#[cfg(any(target_os = "macos", test))]
impl HidElementDeviceState {
    pub fn new(kind: HidControllerKind) -> Self {
        Self {
            kind,
            lx: 0.0,
            ly: 0.0,
            z: None,
            rx_raw: None,
            ry_raw: None,
            rz: None,
            sim_lt: None,
            sim_rt: None,
            hat_bits: 0,
            btn_bits: 0,
            l2_digital: false,
            r2_digital: false,
        }
    }

    fn norm_signed_axis(val: isize, lmin: isize, lmax: isize, invert: bool) -> f32 {
        let span = (lmax - lmin) as f32;
        if span <= 1.0 {
            return 0.0;
        }
        let norm = (((val - lmin) as f32) / span) * 2.0 - 1.0;
        let signed = if invert { -norm } else { norm };
        let mag = signed.abs();
        if mag <= 0.18 {
            return 0.0;
        }
        let scaled = ((mag - 0.18) / 0.82).clamp(0.0, 1.0);
        scaled.copysign(signed)
    }

    fn norm_trigger_axis(val: isize, lmin: isize, lmax: isize) -> f32 {
        let span = (lmax - lmin) as f32;
        if span <= 1.0 {
            return 0.0;
        }
        let norm = (((val - lmin) as f32) / span).clamp(0.0, 1.0);
        if norm <= 0.10 {
            0.0
        } else {
            ((norm - 0.10) / 0.90).clamp(0.0, 1.0)
        }
    }

    /// Applies one HID element update and returns `true` if the element was recognized.
    pub fn apply_element(
        &mut self,
        page: u32,
        usage: u32,
        value: isize,
        logical_min: isize,
        logical_max: isize,
    ) -> bool {
        match page {
            0x01 => match usage {
                0x30 => {
                    self.lx = Self::norm_signed_axis(value, logical_min, logical_max, false);
                    true
                }
                0x31 => {
                    self.ly = Self::norm_signed_axis(value, logical_min, logical_max, true);
                    true
                }
                0x32 => {
                    self.z = Some(Self::norm_signed_axis(value, logical_min, logical_max, false));
                    true
                }
                0x33 => {
                    self.rx_raw = Some((
                        Self::norm_signed_axis(value, logical_min, logical_max, false),
                        Self::norm_trigger_axis(value, logical_min, logical_max),
                    ));
                    true
                }
                0x34 => {
                    self.ry_raw = Some((
                        Self::norm_signed_axis(value, logical_min, logical_max, true),
                        Self::norm_trigger_axis(value, logical_min, logical_max),
                    ));
                    true
                }
                0x35 => {
                    self.rz = Some(Self::norm_signed_axis(value, logical_min, logical_max, true));
                    true
                }
                0x39 => {
                    // Hat switch: supports both 0..=7 and 1..=8 logical ranges
                    if value >= logical_min && value <= logical_max {
                        self.hat_bits = dpad_from_hat((value - logical_min) as u8);
                    } else {
                        self.hat_bits = 0;
                    }
                    true
                }
                _ => false,
            },
            // Simulation Controls page: Brake (0xC5 -> LT) & Accelerator (0xC4 -> RT)
            0x02 => match usage {
                0xC5 => {
                    self.sim_lt = Some(Self::norm_trigger_axis(value, logical_min, logical_max));
                    true
                }
                0xC4 => {
                    self.sim_rt = Some(Self::norm_trigger_axis(value, logical_min, logical_max));
                    true
                }
                _ => false,
            },
            // Button page (1-based HID button usages)
            0x09 => {
                let pressed = value != 0;
                let set_bit = |bits: &mut u16, mask: u16| {
                    if pressed {
                        *bits |= mask;
                    } else {
                        *bits &= !mask;
                    }
                };
                match self.kind {
                    HidControllerKind::SonyDualSense
                    | HidControllerKind::SonyDualShock4
                    | HidControllerKind::SonyOther => match usage {
                        1 => set_bit(&mut self.btn_bits, BTN_X),     // Square
                        2 => set_bit(&mut self.btn_bits, BTN_A),     // Cross
                        3 => set_bit(&mut self.btn_bits, BTN_B),     // Circle
                        4 => set_bit(&mut self.btn_bits, BTN_Y),     // Triangle
                        5 => set_bit(&mut self.btn_bits, BTN_LB),    // L1
                        6 => set_bit(&mut self.btn_bits, BTN_RB),    // R1
                        7 => self.l2_digital = pressed,
                        8 => self.r2_digital = pressed,
                        9 => set_bit(&mut self.btn_bits, BTN_BACK),  // Share / Create
                        10 => set_bit(&mut self.btn_bits, BTN_START), // Options
                        _ => return false,
                    },
                    HidControllerKind::NintendoSwitchPro => match usage {
                        1 => set_bit(&mut self.btn_bits, BTN_A),     // B (bottom)
                        2 => set_bit(&mut self.btn_bits, BTN_B),     // A (right)
                        3 => set_bit(&mut self.btn_bits, BTN_X),     // Y (left)
                        4 => set_bit(&mut self.btn_bits, BTN_Y),     // X (top)
                        5 => set_bit(&mut self.btn_bits, BTN_LB),    // L
                        6 => set_bit(&mut self.btn_bits, BTN_RB),    // R
                        7 => self.l2_digital = pressed,              // ZL
                        8 => self.r2_digital = pressed,              // ZR
                        9 => set_bit(&mut self.btn_bits, BTN_BACK),  // Minus
                        10 => set_bit(&mut self.btn_bits, BTN_START), // Plus
                        _ => return false,
                    },
                    HidControllerKind::XboxModernBt => match usage {
                        1 => set_bit(&mut self.btn_bits, BTN_A),
                        2 => set_bit(&mut self.btn_bits, BTN_B),
                        4 => set_bit(&mut self.btn_bits, BTN_X),
                        5 => set_bit(&mut self.btn_bits, BTN_Y),
                        7 => set_bit(&mut self.btn_bits, BTN_LB),
                        8 => set_bit(&mut self.btn_bits, BTN_RB),
                        11 => set_bit(&mut self.btn_bits, BTN_BACK),
                        12 => set_bit(&mut self.btn_bits, BTN_START),
                        _ => return false,
                    },
                    _ => match usage {
                        1 => set_bit(&mut self.btn_bits, BTN_A),
                        2 => set_bit(&mut self.btn_bits, BTN_B),
                        3 => set_bit(&mut self.btn_bits, BTN_X),
                        4 => set_bit(&mut self.btn_bits, BTN_Y),
                        5 => set_bit(&mut self.btn_bits, BTN_LB),
                        6 => set_bit(&mut self.btn_bits, BTN_RB),
                        7 => self.l2_digital = pressed,
                        8 => self.r2_digital = pressed,
                        9 => set_bit(&mut self.btn_bits, BTN_BACK),
                        10 => set_bit(&mut self.btn_bits, BTN_START),
                        _ => return false,
                    },
                }
                true
            }
            // Consumer page: Xbox Wireless BT View/Back (AC Back = 0x224) & Menu (0x40)
            0x0C => {
                let pressed = value != 0;
                match usage {
                    0x224 => {
                        if pressed {
                            self.btn_bits |= BTN_BACK;
                        } else {
                            self.btn_bits &= !BTN_BACK;
                        }
                        true
                    }
                    0x40 => {
                        if pressed {
                            self.btn_bits |= BTN_START;
                        } else {
                            self.btn_bits &= !BTN_START;
                        }
                        true
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    pub fn snapshot(&self) -> GamepadSnapshot {
        let is_sony = matches!(
            self.kind,
            HidControllerKind::SonyDualSense
                | HidControllerKind::SonyDualShock4
                | HidControllerKind::SonyOther
        );
        let (rx, ry, mut lt, mut rt) = if self.sim_lt.is_some() || self.sim_rt.is_some() {
            // Xbox BT / HID controllers with dedicated Simulation Brake/Accelerator triggers:
            // right stick lives on Z/Rz (preferred) or Rx/Ry depending on controller firmware.
            let (rs_x, rs_y) = if self.z.is_some() || self.rz.is_some() {
                (self.z.unwrap_or(0.0), self.rz.unwrap_or(0.0))
            } else {
                (
                    self.rx_raw.map(|v| v.0).unwrap_or(0.0),
                    self.ry_raw.map(|v| v.0).unwrap_or(0.0),
                )
            };
            (rs_x, rs_y, self.sim_lt.unwrap_or(0.0), self.sim_rt.unwrap_or(0.0))
        } else if is_sony || (self.z.is_some() && self.rz.is_some()) {
            // Sony & standard HID gamepads: Z = RS X, Rz = RS Y, Rx = L2, Ry = R2
            (
                self.z.unwrap_or(0.0),
                self.rz.unwrap_or(0.0),
                self.rx_raw.map(|v| v.1).unwrap_or(0.0),
                self.ry_raw.map(|v| v.1).unwrap_or(0.0),
            )
        } else {
            (
                self.rx_raw.map(|v| v.0).unwrap_or(0.0),
                self.ry_raw.map(|v| v.0).unwrap_or(0.0),
                0.0,
                0.0,
            )
        };

        if lt < 0.01 && self.l2_digital {
            lt = 1.0;
        }
        if rt < 0.01 && self.r2_digital {
            rt = 1.0;
        }

        GamepadSnapshot {
            active: false,
            lx: self.lx,
            ly: self.ly,
            rx,
            ry,
            lt,
            rt,
            buttons: self.btn_bits | self.hat_bits,
        }
    }
}

pub fn start_gamepad_watcher(app: AppHandle, paused_guard: Arc<AtomicBool>) {
    #[cfg(windows)]
    {
        std::thread::spawn(move || {
            win_impl::run_loop(app, paused_guard);
        });
    }
    #[cfg(target_os = "linux")]
    {
        std::thread::spawn(move || {
            linux_impl::run_loop(app, paused_guard);
        });
    }
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(move || {
            mac_impl::run_loop(app, paused_guard);
        });
    }
    #[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
    {
        let _ = (app, paused_guard);
    }
}

#[cfg(windows)]
mod win_impl {
    use super::{
        classify_hid_vid_pid, dpad_from_hat, is_xinput_device_path, normalize_hid_stick,
        normalize_hid_trigger, parse_ds4_bt_0x11, parse_dualsense_0x01_fallback,
        parse_dualsense_bt_0x31, parse_sony_classic_payload, parse_switch_pro_0x30,
        parse_xinput_gamepad, GamepadSnapshot, HidControllerKind, BTN_A, BTN_B, BTN_BACK, BTN_LB,
        BTN_RB, BTN_START, BTN_X, BTN_Y, GAMEPAD_ACTIVE,
    };
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::{
        GetModuleHandleW, GetProcAddress, LoadLibraryW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW,
        TranslateMessage, HWND_MESSAGE, MSG, WNDCLASSEXW,
    };

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    struct XInputGamepad {
        w_buttons: u16,
        b_left_trigger: u8,
        b_right_trigger: u8,
        s_thumb_lx: i16,
        s_thumb_ly: i16,
        s_thumb_rx: i16,
        s_thumb_ry: i16,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    struct XInputState {
        dw_packet_number: u32,
        gamepad: XInputGamepad,
    }

    type XInputGetStateFn = unsafe extern "system" fn(u32, *mut XInputState) -> u32;

    // --- Win32 Raw Input & hid.dll ABI definitions (dynamically loaded, zero new deps) ---

    const WM_INPUT_DEVICE_CHANGE: u32 = 0x00FE;
    const WM_INPUT: u32 = 0x00FF;
    const GIDC_REMOVAL: usize = 2;
    const RID_INPUT: u32 = 0x10000003;
    const RIM_TYPEHID: u32 = 2;
    const RIDEV_INPUTSINK: u32 = 0x00000100;
    const RIDEV_DEVNOTIFY: u32 = 0x00002000;
    const RIDI_PREPARSEDDATA: u32 = 0x20000005;
    const RIDI_DEVICENAME: u32 = 0x20000007;
    const RIDI_DEVICEINFO: u32 = 0x2000000B;

    const HIDP_INPUT: i32 = 0;
    const HIDP_STATUS_SUCCESS: i32 = 0x0011_0000;
    const USAGE_PAGE_GENERIC: u16 = 0x01;
    const USAGE_PAGE_BUTTON: u16 = 0x09;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RawInputDevice {
        us_usage_page: u16,
        us_usage: u16,
        dw_flags: u32,
        hwnd_target: HWND,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RawInputHeader {
        dw_type: u32,
        dw_size: u32,
        h_device: HANDLE,
        w_param: WPARAM,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct RawHidPrefix {
        dw_size_hid: u32,
        dw_count: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    struct RidDeviceInfoHid {
        dw_vendor_id: u32,
        dw_product_id: u32,
        dw_version_number: u32,
        us_usage_page: u16,
        us_usage: u16,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub(super) struct RidDeviceInfo {
        cb_size: u32,
        dw_type: u32,
        hid: RidDeviceInfoHid,
        _union_pad: [u32; 2],
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub(super) struct HidpCaps {
        usage: u16,
        usage_page: u16,
        input_report_byte_length: u16,
        output_report_byte_length: u16,
        feature_report_byte_length: u16,
        reserved: [u16; 17],
        number_link_collection_nodes: u16,
        number_input_button_caps: u16,
        number_input_value_caps: u16,
        number_input_data_indices: u16,
        number_output_button_caps: u16,
        number_output_value_caps: u16,
        number_output_data_indices: u16,
        number_feature_button_caps: u16,
        number_feature_value_caps: u16,
        number_feature_data_indices: u16,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub(super) struct HidpValueCaps {
        usage_page: u16,
        report_id: u8,
        is_alias: u8,
        bit_field: u16,
        link_collection: u16,
        link_usage: u16,
        link_usage_page: u16,
        is_range: u8,
        is_string_range: u8,
        is_designator_range: u8,
        is_absolute: u8,
        has_null: u8,
        reserved: u8,
        bit_size: u16,
        report_count: u16,
        reserved2: [u16; 5],
        units_exp: u32,
        units: u32,
        logical_min: i32,
        logical_max: i32,
        physical_min: i32,
        physical_max: i32,
        // Union Range / NotRange:
        usage_min: u16,
        usage_max: u16,
        _rest: [u16; 6],
    }

    type RegisterRawInputDevicesFn =
        unsafe extern "system" fn(*const RawInputDevice, u32, u32) -> i32;
    type GetRawInputDataFn =
        unsafe extern "system" fn(isize, u32, *mut c_void, *mut u32, u32) -> u32;
    type GetRawInputDeviceInfoWFn =
        unsafe extern "system" fn(HANDLE, u32, *mut c_void, *mut u32) -> u32;

    type HidPGetCapsFn = unsafe extern "system" fn(*const c_void, *mut HidpCaps) -> i32;
    type HidPGetValueCapsFn =
        unsafe extern "system" fn(i32, *mut HidpValueCaps, *mut u16, *const c_void) -> i32;
    type HidPGetUsagesFn = unsafe extern "system" fn(
        i32,
        u16,
        u16,
        *mut u16,
        *mut u32,
        *const c_void,
        *mut u8,
        u32,
    ) -> i32;
    type HidPGetUsageValueFn = unsafe extern "system" fn(
        i32,
        u16,
        u16,
        u16,
        *mut u32,
        *const c_void,
        *const u8,
        u32,
    ) -> i32;

    struct User32RawApi {
        register: RegisterRawInputDevicesFn,
        get_data: GetRawInputDataFn,
        get_info: GetRawInputDeviceInfoWFn,
    }

    struct HidApi {
        get_caps: HidPGetCapsFn,
        get_value_caps: HidPGetValueCapsFn,
        get_usages: HidPGetUsagesFn,
        get_usage_value: HidPGetUsageValueFn,
    }

    fn load_user32_raw_api() -> Option<User32RawApi> {
        let dll: [u16; 11] = [
            b'u' as u16, b's' as u16, b'e' as u16, b'r' as u16, b'3' as u16, b'2' as u16,
            b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0,
        ];
        unsafe {
            let hmod = LoadLibraryW(dll.as_ptr());
            if hmod.is_null() {
                return None;
            }
            let r = GetProcAddress(hmod, b"RegisterRawInputDevices\0".as_ptr())?;
            let d = GetProcAddress(hmod, b"GetRawInputData\0".as_ptr())?;
            let i = GetProcAddress(hmod, b"GetRawInputDeviceInfoW\0".as_ptr())?;
            Some(User32RawApi {
                register: std::mem::transmute(r as *const c_void),
                get_data: std::mem::transmute(d as *const c_void),
                get_info: std::mem::transmute(i as *const c_void),
            })
        }
    }

    fn load_hid_api() -> Option<HidApi> {
        let dll: [u16; 8] = [
            b'h' as u16, b'i' as u16, b'd' as u16, b'.' as u16, b'd' as u16, b'l' as u16,
            b'l' as u16, 0,
        ];
        unsafe {
            let hmod = LoadLibraryW(dll.as_ptr());
            if hmod.is_null() {
                return None;
            }
            let c = GetProcAddress(hmod, b"HidP_GetCaps\0".as_ptr())?;
            let vc = GetProcAddress(hmod, b"HidP_GetValueCaps\0".as_ptr())?;
            let u = GetProcAddress(hmod, b"HidP_GetUsages\0".as_ptr())?;
            let uv = GetProcAddress(hmod, b"HidP_GetUsageValue\0".as_ptr())?;
            Some(HidApi {
                get_caps: std::mem::transmute(c as *const c_void),
                get_value_caps: std::mem::transmute(vc as *const c_void),
                get_usages: std::mem::transmute(u as *const c_void),
                get_usage_value: std::mem::transmute(uv as *const c_void),
            })
        }
    }

    #[derive(Copy, Clone, Debug)]
    struct AxisCapInfo {
        usage: u16,
        report_id: u8,
        logical_min: i32,
        logical_max: i32,
        bit_size: u16,
    }

    struct CachedHidDevice {
        handle: usize,
        kind: HidControllerKind,
        preparsed: Vec<u8>,
        axes: Vec<AxisCapInfo>,
        last_snap: GamepadSnapshot,
        last_had_input: bool,
        last_seen_push: Instant,
    }

    #[derive(Default)]
    struct HidSharedState {
        snap: GamepadSnapshot,
        last_input_at: Option<Instant>,
        last_packet_at: Option<Instant>,
        active_device: usize,
    }

    struct RawThreadState {
        user32: User32RawApi,
        hid: Option<HidApi>,
        shared: Arc<(Mutex<HidSharedState>, Condvar)>,
        paused: Arc<AtomicBool>,
        devices: Vec<CachedHidDevice>,
        raw_buf: Vec<u8>,
        report_scratch: Vec<u8>,
    }

    thread_local! {
        static RAW_STATE: RefCell<Option<RawThreadState>> = const { RefCell::new(None) };
    }

    fn classify_hid_device(path: &str, vid: u32, pid: u32) -> HidControllerKind {
        if is_xinput_device_path(path) {
            return HidControllerKind::SkipXInput;
        }
        classify_hid_vid_pid(vid, pid)
    }

    fn inspect_hid_device(
        user32: &User32RawApi,
        hid: Option<&HidApi>,
        h_device: HANDLE,
    ) -> CachedHidDevice {
        let mut name_chars: u32 = 0;
        let path_str = unsafe {
            (user32.get_info)(
                h_device,
                RIDI_DEVICENAME,
                std::ptr::null_mut(),
                &mut name_chars,
            );
            if name_chars > 0 && name_chars < 2048 {
                let mut wide = vec![0u16; name_chars as usize];
                let got = (user32.get_info)(
                    h_device,
                    RIDI_DEVICENAME,
                    wide.as_mut_ptr() as *mut c_void,
                    &mut name_chars,
                );
                if got != u32::MAX {
                    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
                    String::from_utf16_lossy(&wide[..end])
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        };

        let mut info = RidDeviceInfo {
            cb_size: std::mem::size_of::<RidDeviceInfo>() as u32,
            ..Default::default()
        };
        let mut info_size = std::mem::size_of::<RidDeviceInfo>() as u32;
        let (vid, pid) = unsafe {
            let got = (user32.get_info)(
                h_device,
                RIDI_DEVICEINFO,
                (&mut info as *mut RidDeviceInfo) as *mut c_void,
                &mut info_size,
            );
            if got != u32::MAX && info.dw_type == RIM_TYPEHID {
                (info.hid.dw_vendor_id, info.hid.dw_product_id)
            } else {
                (0, 0)
            }
        };

        let kind = classify_hid_device(&path_str, vid, pid);
        let mut preparsed = Vec::new();
        let mut axes = Vec::new();

        if kind != HidControllerKind::SkipXInput {
            if let Some(hid_api) = hid {
                let mut pp_size: u32 = 0;
                unsafe {
                    (user32.get_info)(
                        h_device,
                        RIDI_PREPARSEDDATA,
                        std::ptr::null_mut(),
                        &mut pp_size,
                    );
                    if pp_size > 0 && pp_size <= 65536 {
                        preparsed.resize(pp_size as usize, 0);
                        let got = (user32.get_info)(
                            h_device,
                            RIDI_PREPARSEDDATA,
                            preparsed.as_mut_ptr() as *mut c_void,
                            &mut pp_size,
                        );
                        if got == u32::MAX {
                            preparsed.clear();
                        }
                    }
                    if !preparsed.is_empty() {
                        let mut caps = HidpCaps::default();
                        let st = (hid_api.get_caps)(
                            preparsed.as_ptr() as *const c_void,
                            &mut caps,
                        );
                        if st == HIDP_STATUS_SUCCESS && caps.number_input_value_caps > 0 {
                            let mut count = caps.number_input_value_caps.min(128);
                            let mut vcaps = vec![HidpValueCaps::default(); count as usize];
                            let vst = (hid_api.get_value_caps)(
                                HIDP_INPUT,
                                vcaps.as_mut_ptr(),
                                &mut count,
                                preparsed.as_ptr() as *const c_void,
                            );
                            if vst == HIDP_STATUS_SUCCESS {
                                for cap in vcaps.iter().take(count as usize) {
                                    if cap.usage_page != USAGE_PAGE_GENERIC {
                                        continue;
                                    }
                                    let (u_lo, u_hi) = if cap.is_range != 0 {
                                        (cap.usage_min, cap.usage_max)
                                    } else {
                                        (cap.usage_min, cap.usage_min)
                                    };
                                    for usage in u_lo..=u_hi {
                                        if matches!(
                                            usage,
                                            0x30 | 0x31 | 0x32 | 0x33 | 0x34 | 0x35 | 0x39
                                        ) {
                                            axes.push(AxisCapInfo {
                                                usage,
                                                report_id: cap.report_id,
                                                logical_min: cap.logical_min,
                                                logical_max: cap.logical_max,
                                                bit_size: cap.bit_size,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        CachedHidDevice {
            handle: h_device as usize,
            kind,
            preparsed,
            axes,
            last_snap: GamepadSnapshot::default(),
            last_had_input: false,
            last_seen_push: Instant::now() - Duration::from_secs(10),
        }
    }

    fn parse_hid_via_hidp(
        hid: &HidApi,
        dev: &CachedHidDevice,
        report: &[u8],
        scratch: &mut Vec<u8>,
    ) -> Option<GamepadSnapshot> {
        if dev.preparsed.is_empty() || report.is_empty() {
            return None;
        }
        let report_id = report[0];
        let find_cap = |usage: u16| -> Option<AxisCapInfo> {
            dev.axes
                .iter()
                .copied()
                .find(|a| a.usage == usage && (a.report_id == report_id || a.report_id == 0))
        };

        let read_val = |usage: u16| -> Option<(u32, AxisCapInfo)> {
            let cap = find_cap(usage)?;
            let mut val: u32 = 0;
            let st = unsafe {
                (hid.get_usage_value)(
                    HIDP_INPUT,
                    USAGE_PAGE_GENERIC,
                    0,
                    usage,
                    &mut val,
                    dev.preparsed.as_ptr() as *const c_void,
                    report.as_ptr(),
                    report.len() as u32,
                )
            };
            if st == HIDP_STATUS_SUCCESS {
                Some((val, cap))
            } else {
                None
            }
        };

        // Read active buttons on HID Button Usage Page (0x09)
        scratch.clear();
        scratch.extend_from_slice(report);
        let mut usage_list = [0u16; 32];
        let mut usage_len: u32 = usage_list.len() as u32;
        let btn_st = unsafe {
            (hid.get_usages)(
                HIDP_INPUT,
                USAGE_PAGE_BUTTON,
                0,
                usage_list.as_mut_ptr(),
                &mut usage_len,
                dev.preparsed.as_ptr() as *const c_void,
                scratch.as_mut_ptr(),
                scratch.len() as u32,
            )
        };

        let x_val = read_val(0x30);
        let y_val = read_val(0x31);
        if x_val.is_none() && y_val.is_none() && btn_st != HIDP_STATUS_SUCCESS {
            return None;
        }

        let mut buttons: u16 = 0;
        let mut l2_digital = false;
        let mut r2_digital = false;

        if btn_st == HIDP_STATUS_SUCCESS {
            let count = (usage_len as usize).min(usage_list.len());
            for &b in &usage_list[..count] {
                match dev.kind {
                    HidControllerKind::SonyDualSense
                    | HidControllerKind::SonyDualShock4
                    | HidControllerKind::SonyOther => match b {
                        1 => buttons |= BTN_X,     // Square
                        2 => buttons |= BTN_A,     // Cross
                        3 => buttons |= BTN_B,     // Circle
                        4 => buttons |= BTN_Y,     // Triangle
                        5 => buttons |= BTN_LB,    // L1
                        6 => buttons |= BTN_RB,    // R1
                        7 => l2_digital = true,    // L2 digital
                        8 => r2_digital = true,    // R2 digital
                        9 => buttons |= BTN_BACK,  // Share / Create
                        10 => buttons |= BTN_START, // Options
                        _ => {}
                    },
                    HidControllerKind::NintendoSwitchPro => match b {
                        1 => buttons |= BTN_A,     // B (bottom)
                        2 => buttons |= BTN_B,     // A (right)
                        3 => buttons |= BTN_X,     // Y (left)
                        4 => buttons |= BTN_Y,     // X (top)
                        5 => buttons |= BTN_LB,    // L
                        6 => buttons |= BTN_RB,    // R
                        7 => l2_digital = true,    // ZL
                        8 => r2_digital = true,    // ZR
                        9 => buttons |= BTN_BACK,  // Minus
                        10 => buttons |= BTN_START, // Plus
                        _ => {}
                    },
                    _ => match b {
                        1 => buttons |= BTN_A,
                        2 => buttons |= BTN_B,
                        3 => buttons |= BTN_X,
                        4 => buttons |= BTN_Y,
                        5 => buttons |= BTN_LB,
                        6 => buttons |= BTN_RB,
                        7 => l2_digital = true,
                        8 => r2_digital = true,
                        9 => buttons |= BTN_BACK,
                        10 => buttons |= BTN_START,
                        _ => {}
                    },
                }
            }
        }

        // Hat switch (D-Pad): supports both 0..=7 and 1..=8 logical ranges
        if let Some((hat_raw, cap)) = read_val(0x39) {
            let hat_i = hat_raw as i32;
            if hat_i >= cap.logical_min && hat_i <= cap.logical_max {
                let norm = (hat_i - cap.logical_min) as u8;
                buttons |= dpad_from_hat(norm);
            }
        }

        let lx = x_val
            .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, false))
            .unwrap_or(0.0);
        let ly = y_val
            .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, true))
            .unwrap_or(0.0);

        let z_val = read_val(0x32);
        let rx_val = read_val(0x33);
        let ry_val = read_val(0x34);
        let rz_val = read_val(0x35);

        let is_sony = matches!(
            dev.kind,
            HidControllerKind::SonyDualSense
                | HidControllerKind::SonyDualShock4
                | HidControllerKind::SonyOther
        );

        let (rx, ry, mut lt, mut rt) = if is_sony || (z_val.is_some() && rz_val.is_some()) {
            // Sony & standard HID gamepads: Z (0x32) = RS X, Rz (0x35) = RS Y, Rx (0x33) = L2, Ry (0x34) = R2
            let rs_x = z_val
                .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, false))
                .unwrap_or(0.0);
            let rs_y = rz_val
                .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, true))
                .unwrap_or(0.0);
            let trig_l = rx_val
                .map(|(v, c)| normalize_hid_trigger(v, c.logical_min, c.logical_max, c.bit_size))
                .unwrap_or(0.0);
            let trig_r = ry_val
                .map(|(v, c)| normalize_hid_trigger(v, c.logical_min, c.logical_max, c.bit_size))
                .unwrap_or(0.0);
            (rs_x, rs_y, trig_l, trig_r)
        } else {
            // Alternative DirectInput pads that expose Right Stick on Rx (0x33) / Ry (0x34)
            let rs_x = rx_val
                .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, false))
                .unwrap_or(0.0);
            let rs_y = ry_val
                .map(|(v, c)| normalize_hid_stick(v, c.logical_min, c.logical_max, c.bit_size, 0.18, true))
                .unwrap_or(0.0);
            (rs_x, rs_y, 0.0, 0.0)
        };

        if lt < 0.01 && l2_digital {
            lt = 1.0;
        }
        if rt < 0.01 && r2_digital {
            rt = 1.0;
        }

        Some(GamepadSnapshot {
            active: false,
            lx,
            ly,
            rx,
            ry,
            lt,
            rt,
            buttons,
        })
    }

    fn parse_hid_report(
        hid: Option<&HidApi>,
        dev: &CachedHidDevice,
        report: &[u8],
        scratch: &mut Vec<u8>,
    ) -> Option<GamepadSnapshot> {
        if report.is_empty() {
            return None;
        }
        match dev.kind {
            HidControllerKind::SkipXInput => None,
            HidControllerKind::SonyDualSense => {
                if report[0] == 0x31 {
                    parse_dualsense_bt_0x31(report)
                } else {
                    hid.and_then(|h| parse_hid_via_hidp(h, dev, report, scratch))
                        .or_else(|| parse_dualsense_0x01_fallback(report))
                }
            }
            HidControllerKind::SonyDualShock4 => {
                if report[0] == 0x11 {
                    parse_ds4_bt_0x11(report)
                } else {
                    hid.and_then(|h| parse_hid_via_hidp(h, dev, report, scratch))
                        .or_else(|| {
                            if report[0] == 0x01 {
                                parse_sony_classic_payload(&report[1..])
                            } else {
                                None
                            }
                        })
                }
            }
            HidControllerKind::NintendoSwitchPro => {
                if report[0] == 0x30 {
                    parse_switch_pro_0x30(report)
                } else {
                    hid.and_then(|h| parse_hid_via_hidp(h, dev, report, scratch))
                }
            }
            HidControllerKind::SonyOther
            | HidControllerKind::XboxModernBt
            | HidControllerKind::Generic => {
                hid.and_then(|h| parse_hid_via_hidp(h, dev, report, scratch))
            }
        }
    }

    unsafe extern "system" fn raw_wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_INPUT_DEVICE_CHANGE {
            let h_dev = lparam as usize;
            RAW_STATE.with(|cell| {
                if let Some(st) = cell.borrow_mut().as_mut() {
                    if wparam == GIDC_REMOVAL {
                        st.devices.retain(|d| d.handle != h_dev);
                        let (lock, cvar) = &*st.shared;
                        if let Ok(mut shared) = lock.lock() {
                            if shared.active_device == h_dev {
                                shared.snap = GamepadSnapshot::default();
                                shared.active_device = 0;
                                cvar.notify_one();
                            }
                        }
                    } else {
                        st.devices.retain(|d| d.handle != h_dev);
                    }
                }
            });
            return 0;
        }

        if msg == WM_INPUT {
            RAW_STATE.with(|cell| {
                let mut borrow = cell.borrow_mut();
                let Some(st) = borrow.as_mut() else {
                    return;
                };
                if st.paused.load(Ordering::Relaxed) {
                    return;
                }
                let hdr_size = std::mem::size_of::<RawInputHeader>() as u32;
                let mut needed: u32 = 0;
                let res = (st.user32.get_data)(
                    lparam,
                    RID_INPUT,
                    std::ptr::null_mut(),
                    &mut needed,
                    hdr_size,
                );
                if res == u32::MAX || needed < hdr_size || needed > 32768 {
                    return;
                }
                if st.raw_buf.len() < needed as usize {
                    st.raw_buf.resize(needed as usize, 0);
                }
                let mut actual = needed;
                let copied = (st.user32.get_data)(
                    lparam,
                    RID_INPUT,
                    st.raw_buf.as_mut_ptr() as *mut c_void,
                    &mut actual,
                    hdr_size,
                );
                if copied == u32::MAX || (copied as usize) < std::mem::size_of::<RawInputHeader>() + std::mem::size_of::<RawHidPrefix>() {
                    return;
                }

                let header = *(st.raw_buf.as_ptr() as *const RawInputHeader);
                if header.dw_type != RIM_TYPEHID || header.h_device.is_null() {
                    return;
                }
                let hid_prefix = *(st.raw_buf.as_ptr().add(std::mem::size_of::<RawInputHeader>())
                    as *const RawHidPrefix);
                let pkt_size = hid_prefix.dw_size_hid as usize;
                let pkt_count = (hid_prefix.dw_count as usize).min(16);
                let data_offset =
                    std::mem::size_of::<RawInputHeader>() + std::mem::size_of::<RawHidPrefix>();
                if pkt_size == 0 || pkt_count == 0 || data_offset + pkt_size > copied as usize {
                    return;
                }

                let h_key = header.h_device as usize;
                let dev_idx = match st.devices.iter().position(|d| d.handle == h_key) {
                    Some(i) => i,
                    None => {
                        if st.devices.len() >= 16 {
                            st.devices.remove(0);
                        }
                        let dev = inspect_hid_device(&st.user32, st.hid.as_ref(), header.h_device);
                        st.devices.push(dev);
                        st.devices.len() - 1
                    }
                };
                if st.devices[dev_idx].kind == HidControllerKind::SkipXInput {
                    return;
                }

                // Parse the latest packet in this Raw Input batch
                let last_idx = ((copied as usize - data_offset) / pkt_size)
                    .min(pkt_count)
                    .saturating_sub(1);
                let start = data_offset + last_idx * pkt_size;
                let report = &st.raw_buf[start..start + pkt_size];
                let parsed = parse_hid_report(
                    st.hid.as_ref(),
                    &st.devices[dev_idx],
                    report,
                    &mut st.report_scratch,
                );
                let Some(snap) = parsed else {
                    return;
                };

                let now = Instant::now();
                let has_in = snap.has_input();
                let dev = &mut st.devices[dev_idx];
                let changed = (has_in && (!dev.last_had_input || snap.differs_visibly(&dev.last_snap)))
                    || (!has_in && dev.last_had_input);
                let heartbeat_due = dev.last_seen_push.elapsed() >= Duration::from_secs(2);

                if changed || heartbeat_due {
                    dev.last_seen_push = now;
                    let (lock, cvar) = &*st.shared;
                    if let Ok(mut shared) = lock.lock() {
                        shared.last_packet_at = Some(now);
                        if changed {
                            dev.last_snap = snap;
                            dev.last_had_input = has_in;
                            if has_in || shared.active_device == h_key || shared.active_device == 0 {
                                shared.snap = snap;
                                shared.active_device = h_key;
                                if has_in {
                                    shared.last_input_at = Some(now);
                                }
                                cvar.notify_one();
                            }
                        }
                    }
                }
            });
            return 0;
        }

        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    fn spawn_raw_hid_thread(
        shared: Arc<(Mutex<HidSharedState>, Condvar)>,
        paused: Arc<AtomicBool>,
    ) {
        std::thread::spawn(move || {
            let Some(user32) = load_user32_raw_api() else {
                return;
            };
            let hid = load_hid_api();
            let class_name: Vec<u16> = "KuroCatRawGamepadMsgWin\0".encode_utf16().collect();
            unsafe {
                let hinstance = GetModuleHandleW(std::ptr::null());
                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    style: 0,
                    lpfnWndProc: Some(raw_wnd_proc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: hinstance,
                    hIcon: std::ptr::null_mut(),
                    hCursor: std::ptr::null_mut(),
                    hbrBackground: std::ptr::null_mut(),
                    lpszMenuName: std::ptr::null(),
                    lpszClassName: class_name.as_ptr(),
                    hIconSm: std::ptr::null_mut(),
                };
                RegisterClassExW(&wc);

                let hwnd = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    std::ptr::null(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    HWND_MESSAGE,
                    std::ptr::null_mut(),
                    hinstance,
                    std::ptr::null(),
                );
                if hwnd.is_null() {
                    return;
                }

                let make_devs = |flags: u32| -> [RawInputDevice; 2] {
                    [
                        RawInputDevice {
                            us_usage_page: USAGE_PAGE_GENERIC,
                            us_usage: 0x05, // Gamepad (PS5 DualSense, PS4 DS4, Switch Pro, etc.)
                            dw_flags: flags,
                            hwnd_target: hwnd,
                        },
                        RawInputDevice {
                            us_usage_page: USAGE_PAGE_GENERIC,
                            us_usage: 0x04, // Joystick / DirectInput controllers
                            dw_flags: flags,
                            hwnd_target: hwnd,
                        },
                    ]
                };

                let devs = make_devs(RIDEV_INPUTSINK | RIDEV_DEVNOTIFY);
                let ok = (user32.register)(
                    devs.as_ptr(),
                    devs.len() as u32,
                    std::mem::size_of::<RawInputDevice>() as u32,
                );
                if ok == 0 {
                    let fallback_devs = make_devs(RIDEV_INPUTSINK);
                    if (user32.register)(
                        fallback_devs.as_ptr(),
                        fallback_devs.len() as u32,
                        std::mem::size_of::<RawInputDevice>() as u32,
                    ) == 0
                    {
                        return;
                    }
                }

                RAW_STATE.with(|cell| {
                    *cell.borrow_mut() = Some(RawThreadState {
                        user32,
                        hid,
                        shared,
                        paused,
                        devices: Vec::with_capacity(4),
                        raw_buf: Vec::with_capacity(256),
                        report_scratch: Vec::with_capacity(128),
                    });
                });

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
    }

    fn load_xinput_get_state() -> Option<XInputGetStateFn> {
        let candidates: [&[u16]; 3] = [
            // "xinput1_4.dll\0"
            &[
                b'x' as u16, b'i' as u16, b'n' as u16, b'p' as u16, b'u' as u16, b't' as u16,
                b'1' as u16, b'_' as u16, b'4' as u16, b'.' as u16, b'd' as u16, b'l' as u16,
                b'l' as u16, 0,
            ],
            // "xinput9_1_0.dll\0"
            &[
                b'x' as u16, b'i' as u16, b'n' as u16, b'p' as u16, b'u' as u16, b't' as u16,
                b'9' as u16, b'_' as u16, b'1' as u16, b'_' as u16, b'0' as u16, b'.' as u16,
                b'd' as u16, b'l' as u16, b'l' as u16, 0,
            ],
            // "xinput1_3.dll\0"
            &[
                b'x' as u16, b'i' as u16, b'n' as u16, b'p' as u16, b'u' as u16, b't' as u16,
                b'1' as u16, b'_' as u16, b'3' as u16, b'.' as u16, b'd' as u16, b'l' as u16,
                b'l' as u16, 0,
            ],
        ];
        unsafe {
            for dll in candidates {
                let hmod = LoadLibraryW(dll.as_ptr());
                if hmod.is_null() {
                    continue;
                }
                let sym = GetProcAddress(hmod, b"XInputGetState\0".as_ptr());
                if let Some(f) = sym {
                    let fn_ptr: XInputGetStateFn = std::mem::transmute(f as *const c_void);
                    return Some(fn_ptr);
                }
            }
        }
        None
    }

    pub fn run_loop(app: AppHandle, paused_guard: Arc<AtomicBool>) {
        let xinput_get_state = load_xinput_get_state();
        let hid_shared = Arc::new((Mutex::new(HidSharedState::default()), Condvar::new()));
        spawn_raw_hid_thread(Arc::clone(&hid_shared), Arc::clone(&paused_guard));

        let mut last_emitted = GamepadSnapshot::default();
        let mut last_input_at: Option<Instant> = None;
        let mut last_xinput_input_at: Option<Instant> = None;
        let mut active_slot: Option<u32> = None;
        let mut last_scan = Instant::now() - Duration::from_secs(10);

        loop {
            if paused_guard.load(Ordering::Relaxed) {
                if last_emitted.active {
                    last_emitted = GamepadSnapshot::default();
                    GAMEPAD_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit("kuro-gamepad", last_emitted);
                }
                std::thread::sleep(Duration::from_millis(600));
                continue;
            }

            let mut xinput_connected = false;
            let mut xinput_snap = GamepadSnapshot::default();

            if let Some(xinput_fn) = xinput_get_state {
                // When no XInput controller was found recently, only probe all 4 slots every 2s (~0% CPU).
                let should_scan_all =
                    active_slot.is_none() || last_scan.elapsed() >= Duration::from_millis(2000);
                if should_scan_all {
                    last_scan = Instant::now();
                    for slot in 0..4u32 {
                        let mut st = XInputState::default();
                        let err = unsafe { xinput_fn(slot, &mut st) };
                        if err == 0 {
                            xinput_connected = true;
                            let snap = parse_xinput_gamepad(
                                st.gamepad.w_buttons,
                                st.gamepad.b_left_trigger,
                                st.gamepad.b_right_trigger,
                                st.gamepad.s_thumb_lx,
                                st.gamepad.s_thumb_ly,
                                st.gamepad.s_thumb_rx,
                                st.gamepad.s_thumb_ry,
                            );
                            if snap.has_input() || active_slot.is_none() {
                                active_slot = Some(slot);
                                xinput_snap = snap;
                                if snap.has_input() {
                                    break;
                                }
                            }
                        }
                    }
                } else if let Some(slot) = active_slot {
                    let mut st = XInputState::default();
                    let err = unsafe { xinput_fn(slot, &mut st) };
                    if err == 0 {
                        xinput_connected = true;
                        xinput_snap = parse_xinput_gamepad(
                            st.gamepad.w_buttons,
                            st.gamepad.b_left_trigger,
                            st.gamepad.b_right_trigger,
                            st.gamepad.s_thumb_lx,
                            st.gamepad.s_thumb_ly,
                            st.gamepad.s_thumb_rx,
                            st.gamepad.s_thumb_ry,
                        );
                    } else {
                        active_slot = None;
                    }
                }
            }

            let now = Instant::now();
            if xinput_snap.has_input() {
                last_xinput_input_at = Some(now);
            }

            // Read latest Raw Input HID state (PS5 DualSense, PS4 DualShock 4, Switch Pro, DirectInput)
            let (hid_snap, hid_last_input_at, hid_connected) = {
                let (lock, _) = &*hid_shared;
                if let Ok(guard) = lock.lock() {
                    let recent_pkt = guard
                        .last_packet_at
                        .map(|t| now.saturating_duration_since(t) < Duration::from_secs(12))
                        .unwrap_or(false);
                    (guard.snap, guard.last_input_at, recent_pkt)
                } else {
                    (GamepadSnapshot::default(), None, false)
                }
            };

            if !xinput_connected && !hid_connected {
                active_slot = None;
                if last_emitted.active {
                    last_emitted = GamepadSnapshot::default();
                    GAMEPAD_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit("kuro-gamepad", last_emitted);
                }
                // Wait up to 1.5s, waking IMMEDIATELY if a PS5/PS4/HID controller sends input!
                let (lock, cvar) = &*hid_shared;
                if let Ok(guard) = lock.lock() {
                    let _ = cvar.wait_timeout(guard, Duration::from_millis(1500));
                }
                continue;
            }

            // Arbitration: if both XInput and HID are active (e.g. Steam Input virtual Xbox + physical DualSense),
            // prefer whichever had the most recent input without flickering.
            let xinput_very_recent = last_xinput_input_at
                .map(|t| now.saturating_duration_since(t) < Duration::from_millis(350))
                .unwrap_or(false);
            let mut best_snap = if xinput_snap.has_input() {
                xinput_snap
            } else if hid_snap.has_input() && !xinput_very_recent {
                hid_snap
            } else if xinput_connected && xinput_very_recent {
                xinput_snap
            } else if hid_connected {
                hid_snap
            } else {
                xinput_snap
            };

            if best_snap.has_input() {
                last_input_at = Some(now);
            } else if let Some(hid_t) = hid_last_input_at {
                if last_input_at.map(|t| hid_t > t).unwrap_or(true) {
                    last_input_at = Some(hid_t);
                }
            }

            let kb_mouse_recent = crate::input_hook::has_recent_key_or_click(2200);
            let is_active = if let Some(last) = last_input_at {
                let idle_ms = now.saturating_duration_since(last).as_millis() as u64;
                if best_snap.has_input() {
                    true
                } else if kb_mouse_recent && idle_ms >= 2200 {
                    false
                } else {
                    idle_ms < 14_000
                }
            } else {
                false
            };

            best_snap.active = is_active;
            if best_snap.differs_visibly(&last_emitted) {
                last_emitted = best_snap;
                GAMEPAD_ACTIVE.store(is_active, Ordering::Relaxed);
                let _ = app.emit("kuro-gamepad", best_snap);
            }

            let sleep_ms = if is_active { 16 } else { 120 };
            let (lock, cvar) = &*hid_shared;
            if let Ok(guard) = lock.lock() {
                let _ = cvar.wait_timeout(guard, Duration::from_millis(sleep_ms));
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::{
        normalize_stick_axis, GamepadSnapshot, BTN_A, BTN_B, BTN_BACK, BTN_DOWN, BTN_LB, BTN_LEFT,
        BTN_RB, BTN_RIGHT, BTN_START, BTN_UP, BTN_X, BTN_Y, GAMEPAD_ACTIVE,
    };
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    pub fn run_loop(app: AppHandle, paused_guard: Arc<AtomicBool>) {
        const O_NONBLOCK: i32 = 0x800;
        let mut dev: Option<std::fs::File> = None;
        let mut last_scan = Instant::now() - Duration::from_secs(10);
        let mut live = GamepadSnapshot::default();
        let mut last_emitted = GamepadSnapshot::default();
        let mut last_input_at: Option<Instant> = None;
        let mut buf = [0u8; 8 * 16];

        loop {
            if paused_guard.load(Ordering::Relaxed) {
                if last_emitted.active {
                    last_emitted = GamepadSnapshot::default();
                    GAMEPAD_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit("kuro-gamepad", last_emitted);
                }
                std::thread::sleep(Duration::from_millis(600));
                continue;
            }

            if dev.is_none() && last_scan.elapsed() >= Duration::from_secs(2) {
                last_scan = Instant::now();
                for idx in 0..4 {
                    let path = format!("/dev/input/js{}", idx);
                    if let Ok(f) = OpenOptions::new().read(true).custom_flags(O_NONBLOCK).open(&path)
                    {
                        dev = Some(f);
                        live = GamepadSnapshot::default();
                        break;
                    }
                }
            }

            let Some(file) = dev.as_mut() else {
                std::thread::sleep(Duration::from_millis(1200));
                continue;
            };

            let mut got_real_event = false;
            match file.read(&mut buf) {
                Ok(n) if n >= 8 => {
                    for chunk in buf[..n].chunks_exact(8) {
                        let val = i16::from_ne_bytes([chunk[4], chunk[5]]);
                        let ev_type = chunk[6];
                        let number = chunk[7];
                        let is_init = (ev_type & 0x80) != 0;
                        let kind = ev_type & !0x80;
                        if kind == 1 {
                            let mask = match number {
                                0 => BTN_A,
                                1 => BTN_B,
                                2 => BTN_X,
                                3 => BTN_Y,
                                4 => BTN_LB,
                                5 => BTN_RB,
                                6 => BTN_BACK,
                                7 => BTN_START,
                                _ => 0,
                            };
                            if mask != 0 {
                                if val != 0 {
                                    live.buttons |= mask;
                                } else {
                                    live.buttons &= !mask;
                                }
                                if !is_init {
                                    got_real_event = true;
                                }
                            }
                        } else if kind == 2 {
                            match number {
                                0 => live.lx = normalize_stick_axis(val, 0.18),
                                1 => live.ly = -normalize_stick_axis(val, 0.18),
                                2 => live.lt = (((val as f32) + 32768.0) / 65535.0).clamp(0.0, 1.0),
                                3 => live.rx = normalize_stick_axis(val, 0.18),
                                4 => live.ry = -normalize_stick_axis(val, 0.18),
                                5 => live.rt = (((val as f32) + 32768.0) / 65535.0).clamp(0.0, 1.0),
                                6 => {
                                    live.buttons &= !(BTN_LEFT | BTN_RIGHT);
                                    if val < -10000 {
                                        live.buttons |= BTN_LEFT;
                                    } else if val > 10000 {
                                        live.buttons |= BTN_RIGHT;
                                    }
                                }
                                7 => {
                                    live.buttons &= !(BTN_UP | BTN_DOWN);
                                    if val < -10000 {
                                        live.buttons |= BTN_UP;
                                    } else if val > 10000 {
                                        live.buttons |= BTN_DOWN;
                                    }
                                }
                                _ => {}
                            }
                            if !is_init && live.has_input() {
                                got_real_event = true;
                            }
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) | Ok(0) => {
                    dev = None;
                    live = GamepadSnapshot::default();
                }
                _ => {}
            }

            let now = Instant::now();
            if got_real_event || live.has_input() {
                last_input_at = Some(now);
            }
            let kb_mouse_recent = crate::input_hook::has_recent_key_or_click(2200);
            let is_active = if let Some(last) = last_input_at {
                let idle_ms = now.duration_since(last).as_millis() as u64;
                if live.has_input() {
                    true
                } else if kb_mouse_recent && idle_ms >= 2200 {
                    false
                } else {
                    idle_ms < 14_000
                }
            } else {
                false
            };

            live.active = is_active;
            if live.differs_visibly(&last_emitted) {
                last_emitted = live;
                GAMEPAD_ACTIVE.store(is_active, Ordering::Relaxed);
                let _ = app.emit("kuro-gamepad", live);
            }
            std::thread::sleep(Duration::from_millis(if is_active { 16 } else { 80 }));
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::{
        classify_hid_vid_pid, GamepadSnapshot, HidElementDeviceState, GAMEPAD_ACTIVE,
    };
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    type CFAllocatorRef = *const c_void;
    type CFArrayRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFNumberRef = *const c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFTypeRef = *const c_void;
    type IOHIDManagerRef = *mut c_void;
    type IOHIDDeviceRef = *mut c_void;
    type IOHIDValueRef = *mut c_void;
    type IOHIDElementRef = *mut c_void;
    type IOOptionBits = u32;
    type IOReturn = i32;

    type IOHIDValueCallback =
        extern "C" fn(*mut c_void, IOReturn, *mut c_void, IOHIDValueRef);
    type IOHIDDeviceCallback =
        extern "C" fn(*mut c_void, IOReturn, *mut c_void, IOHIDDeviceRef);

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_CF_NUMBER_SINT32_TYPE: isize = 3;
    const K_IO_HID_OPTIONS_TYPE_NONE: IOOptionBits = 0;
    const K_IO_RETURN_SUCCESS: IOReturn = 0;
    const K_HID_PAGE_GENERIC_DESKTOP: i32 = 0x01;
    const K_HID_USAGE_GD_JOYSTICK: i32 = 0x04;
    const K_HID_USAGE_GD_GAMEPAD: i32 = 0x05;
    const K_HID_USAGE_GD_MULTI_AXIS: i32 = 0x08;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: CFStringRef;
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
        static kCFTypeArrayCallBacks: u8;

        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopRun();
        fn CFStringCreateWithBytes(
            alloc: CFAllocatorRef,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_rep: u8,
        ) -> CFStringRef;
        fn CFNumberCreate(
            allocator: CFAllocatorRef,
            the_type: isize,
            value_ptr: *const c_void,
        ) -> CFNumberRef;
        fn CFNumberGetValue(
            number: CFNumberRef,
            the_type: isize,
            value_ptr: *mut c_void,
        ) -> u8;
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFArrayCreate(
            allocator: CFAllocatorRef,
            values: *const *const c_void,
            num_values: isize,
            callbacks: *const c_void,
        ) -> CFArrayRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOHIDManagerCreate(allocator: CFAllocatorRef, options: IOOptionBits) -> IOHIDManagerRef;
        fn IOHIDManagerSetDeviceMatchingMultiple(manager: IOHIDManagerRef, multiple: CFArrayRef);
        fn IOHIDManagerRegisterDeviceMatchingCallback(
            manager: IOHIDManagerRef,
            callback: Option<IOHIDDeviceCallback>,
            context: *mut c_void,
        );
        fn IOHIDManagerRegisterDeviceRemovalCallback(
            manager: IOHIDManagerRef,
            callback: Option<IOHIDDeviceCallback>,
            context: *mut c_void,
        );
        fn IOHIDManagerRegisterInputValueCallback(
            manager: IOHIDManagerRef,
            callback: Option<IOHIDValueCallback>,
            context: *mut c_void,
        );
        fn IOHIDManagerScheduleWithRunLoop(
            manager: IOHIDManagerRef,
            run_loop: CFRunLoopRef,
            run_loop_mode: CFStringRef,
        );
        fn IOHIDManagerOpen(manager: IOHIDManagerRef, options: IOOptionBits) -> IOReturn;
        fn IOHIDDeviceGetProperty(device: IOHIDDeviceRef, key: CFStringRef) -> CFTypeRef;
        fn IOHIDValueGetElement(value: IOHIDValueRef) -> IOHIDElementRef;
        fn IOHIDValueGetLength(value: IOHIDValueRef) -> isize;
        fn IOHIDValueGetIntegerValue(value: IOHIDValueRef) -> isize;
        fn IOHIDElementGetDevice(element: IOHIDElementRef) -> IOHIDDeviceRef;
        fn IOHIDElementGetUsagePage(element: IOHIDElementRef) -> u32;
        fn IOHIDElementGetUsage(element: IOHIDElementRef) -> u32;
        fn IOHIDElementGetLogicalMin(element: IOHIDElementRef) -> isize;
        fn IOHIDElementGetLogicalMax(element: IOHIDElementRef) -> isize;
    }

    #[derive(Default)]
    struct MacHidShared {
        devices: HashMap<usize, HidElementDeviceState>,
        active_device: usize,
        snap: GamepadSnapshot,
        last_input_at: Option<Instant>,
        connected_count: usize,
    }

    struct HidCallbackContext {
        shared: Arc<(Mutex<MacHidShared>, Condvar)>,
        paused: Arc<AtomicBool>,
    }

    unsafe fn cf_string(s: &str) -> CFStringRef {
        CFStringCreateWithBytes(
            std::ptr::null(),
            s.as_ptr(),
            s.len() as isize,
            K_CF_STRING_ENCODING_UTF8,
            0,
        )
    }

    unsafe fn device_u32_prop(device: IOHIDDeviceRef, key_name: &str) -> u32 {
        let key = cf_string(key_name);
        if key.is_null() {
            return 0;
        }
        let val = IOHIDDeviceGetProperty(device, key);
        CFRelease(key);
        if val.is_null() || CFGetTypeID(val) != CFNumberGetTypeID() {
            return 0;
        }
        let mut out: i32 = 0;
        if CFNumberGetValue(
            val,
            K_CF_NUMBER_SINT32_TYPE,
            (&mut out as *mut i32).cast::<c_void>(),
        ) != 0
        {
            out as u32
        } else {
            0
        }
    }

    unsafe fn make_matching_dict(
        page_key: &str,
        usage_key: &str,
        page: i32,
        usage: i32,
    ) -> CFDictionaryRef {
        let k_page = cf_string(page_key);
        let k_usage = cf_string(usage_key);
        let v_page = CFNumberCreate(
            std::ptr::null(),
            K_CF_NUMBER_SINT32_TYPE,
            (&page as *const i32).cast::<c_void>(),
        );
        let v_usage = CFNumberCreate(
            std::ptr::null(),
            K_CF_NUMBER_SINT32_TYPE,
            (&usage as *const i32).cast::<c_void>(),
        );
        let keys = [k_page, k_usage];
        let vals = [v_page, v_usage];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            vals.as_ptr(),
            2,
            &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
        );
        for obj in [k_page, k_usage, v_page, v_usage] {
            if !obj.is_null() {
                CFRelease(obj);
            }
        }
        dict
    }

    extern "C" fn on_device_matched(
        context: *mut c_void,
        _result: IOReturn,
        _sender: *mut c_void,
        device: IOHIDDeviceRef,
    ) {
        if context.is_null() || device.is_null() {
            return;
        }
        unsafe {
            let ctx = &*(context as *const HidCallbackContext);
            let vid = device_u32_prop(device, "VendorID");
            let pid = device_u32_prop(device, "ProductID");
            let kind = classify_hid_vid_pid(vid, pid);
            let (lock, cvar) = &*ctx.shared;
            if let Ok(mut guard) = lock.lock() {
                guard
                    .devices
                    .insert(device as usize, HidElementDeviceState::new(kind));
                guard.connected_count = guard.devices.len();
                cvar.notify_one();
            }
        }
    }

    extern "C" fn on_device_removed(
        context: *mut c_void,
        _result: IOReturn,
        _sender: *mut c_void,
        device: IOHIDDeviceRef,
    ) {
        if context.is_null() || device.is_null() {
            return;
        }
        unsafe {
            let ctx = &*(context as *const HidCallbackContext);
            let key = device as usize;
            let (lock, cvar) = &*ctx.shared;
            if let Ok(mut guard) = lock.lock() {
                guard.devices.remove(&key);
                guard.connected_count = guard.devices.len();
                if guard.active_device == key {
                    guard.active_device = 0;
                    guard.snap = GamepadSnapshot::default();
                }
                cvar.notify_one();
            }
        }
    }

    extern "C" fn on_input_value(
        context: *mut c_void,
        _result: IOReturn,
        _sender: *mut c_void,
        value: IOHIDValueRef,
    ) {
        if context.is_null() || value.is_null() {
            return;
        }
        unsafe {
            let ctx = &*(context as *const HidCallbackContext);
            if ctx.paused.load(Ordering::Relaxed) {
                return;
            }
            // Guard against multi-byte vendor/touchpad HID reports (> sizeof(CFIndex))
            let len = IOHIDValueGetLength(value);
            if len <= 0 || len > 8 {
                return;
            }
            let elem = IOHIDValueGetElement(value);
            if elem.is_null() {
                return;
            }
            let device = IOHIDElementGetDevice(elem);
            if device.is_null() {
                return;
            }
            let page = IOHIDElementGetUsagePage(elem);
            let usage = IOHIDElementGetUsage(elem);
            if !matches!(page, 0x01 | 0x02 | 0x09 | 0x0C) {
                return;
            }
            let raw_val = IOHIDValueGetIntegerValue(value);
            let lmin = IOHIDElementGetLogicalMin(elem);
            let lmax = IOHIDElementGetLogicalMax(elem);

            let key = device as usize;
            let (lock, cvar) = &*ctx.shared;
            if let Ok(mut guard) = lock.lock() {
                let state = guard.devices.entry(key).or_insert_with(|| {
                    let vid = device_u32_prop(device, "VendorID");
                    let pid = device_u32_prop(device, "ProductID");
                    HidElementDeviceState::new(classify_hid_vid_pid(vid, pid))
                });
                if !state.apply_element(page, usage, raw_val, lmin, lmax) {
                    return;
                }
                let snap = state.snapshot();
                let had_input = snap.has_input();
                if had_input || guard.active_device == 0 || guard.active_device == key {
                    let changed = snap.differs_visibly(&guard.snap) || guard.active_device != key;
                    guard.active_device = key;
                    guard.snap = snap;
                    if had_input {
                        guard.last_input_at = Some(Instant::now());
                    }
                    if changed {
                        cvar.notify_one();
                    }
                }
            }
        }
    }

    fn spawn_hid_runloop_thread(
        shared: Arc<(Mutex<MacHidShared>, Condvar)>,
        paused: Arc<AtomicBool>,
    ) {
        std::thread::spawn(move || unsafe {
            let mgr = IOHIDManagerCreate(std::ptr::null(), K_IO_HID_OPTIONS_TYPE_NONE);
            if mgr.is_null() {
                return;
            }
            let dicts = [
                make_matching_dict(
                    "DeviceUsagePage",
                    "DeviceUsage",
                    K_HID_PAGE_GENERIC_DESKTOP,
                    K_HID_USAGE_GD_GAMEPAD,
                ),
                make_matching_dict(
                    "DeviceUsagePage",
                    "DeviceUsage",
                    K_HID_PAGE_GENERIC_DESKTOP,
                    K_HID_USAGE_GD_JOYSTICK,
                ),
                make_matching_dict(
                    "DeviceUsagePage",
                    "DeviceUsage",
                    K_HID_PAGE_GENERIC_DESKTOP,
                    K_HID_USAGE_GD_MULTI_AXIS,
                ),
                make_matching_dict(
                    "PrimaryUsagePage",
                    "PrimaryUsage",
                    K_HID_PAGE_GENERIC_DESKTOP,
                    K_HID_USAGE_GD_GAMEPAD,
                ),
                make_matching_dict(
                    "PrimaryUsagePage",
                    "PrimaryUsage",
                    K_HID_PAGE_GENERIC_DESKTOP,
                    K_HID_USAGE_GD_JOYSTICK,
                ),
            ];
            let valid: Vec<*const c_void> = dicts.iter().copied().filter(|d| !d.is_null()).collect();
            if !valid.is_empty() {
                let arr = CFArrayCreate(
                    std::ptr::null(),
                    valid.as_ptr(),
                    valid.len() as isize,
                    &kCFTypeArrayCallBacks as *const u8 as *const c_void,
                );
                if !arr.is_null() {
                    IOHIDManagerSetDeviceMatchingMultiple(mgr, arr);
                    CFRelease(arr);
                }
            }
            for d in dicts {
                if !d.is_null() {
                    CFRelease(d);
                }
            }

            let ctx = Box::into_raw(Box::new(HidCallbackContext { shared, paused })) as *mut c_void;
            IOHIDManagerRegisterDeviceMatchingCallback(mgr, Some(on_device_matched), ctx);
            IOHIDManagerRegisterDeviceRemovalCallback(mgr, Some(on_device_removed), ctx);
            IOHIDManagerRegisterInputValueCallback(mgr, Some(on_input_value), ctx);
            let rl = CFRunLoopGetCurrent();
            IOHIDManagerScheduleWithRunLoop(mgr, rl, kCFRunLoopCommonModes);
            if IOHIDManagerOpen(mgr, K_IO_HID_OPTIONS_TYPE_NONE) != K_IO_RETURN_SUCCESS {
                CFRelease(mgr as CFTypeRef);
                let _ = Box::from_raw(ctx as *mut HidCallbackContext);
                return;
            }
            CFRunLoopRun();
        });
    }

    pub fn run_loop(app: AppHandle, paused_guard: Arc<AtomicBool>) {
        let shared = Arc::new((Mutex::new(MacHidShared::default()), Condvar::new()));
        spawn_hid_runloop_thread(Arc::clone(&shared), Arc::clone(&paused_guard));

        let mut last_emitted = GamepadSnapshot::default();
        loop {
            if paused_guard.load(Ordering::Relaxed) {
                if last_emitted.active {
                    last_emitted = GamepadSnapshot::default();
                    GAMEPAD_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit("kuro-gamepad", last_emitted);
                }
                std::thread::sleep(Duration::from_millis(600));
                continue;
            }

            let (mut snap, last_input_at, connected) = {
                let (lock, _) = &*shared;
                if let Ok(guard) = lock.lock() {
                    (guard.snap, guard.last_input_at, guard.connected_count > 0)
                } else {
                    (GamepadSnapshot::default(), None, false)
                }
            };

            if !connected {
                if last_emitted.active {
                    last_emitted = GamepadSnapshot::default();
                    GAMEPAD_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit("kuro-gamepad", last_emitted);
                }
                let (lock, cvar) = &*shared;
                if let Ok(guard) = lock.lock() {
                    let _ = cvar.wait_timeout(guard, Duration::from_millis(1500));
                }
                continue;
            }

            let now = Instant::now();
            let kb_mouse_recent = crate::input_hook::has_recent_key_or_click(2200);
            let is_active = if let Some(last) = last_input_at {
                let idle_ms = now.saturating_duration_since(last).as_millis() as u64;
                if snap.has_input() {
                    true
                } else if kb_mouse_recent && idle_ms >= 2200 {
                    false
                } else {
                    idle_ms < 14_000
                }
            } else {
                false
            };

            snap.active = is_active;
            if snap.differs_visibly(&last_emitted) {
                last_emitted = snap;
                GAMEPAD_ACTIVE.store(is_active, Ordering::Relaxed);
                let _ = app.emit("kuro-gamepad", snap);
            }

            let wait_ms = if is_active { 16 } else { 200 };
            let (lock, cvar) = &*shared;
            if let Ok(guard) = lock.lock() {
                let _ = cvar.wait_timeout(guard, Duration::from_millis(wait_ms));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dpad_from_hat, is_xinput_device_path, normalize_hid_stick, normalize_hid_trigger,
        normalize_stick_axis, normalize_trigger, parse_ds4_bt_0x11, parse_dualsense_0x01_fallback,
        parse_dualsense_bt_0x31, parse_dualsense_full_payload, parse_sony_classic_payload,
        parse_switch_pro_0x30, parse_xinput_gamepad, BTN_A, BTN_B, BTN_BACK, BTN_DOWN, BTN_LB,
        BTN_LEFT, BTN_RB, BTN_RIGHT, BTN_START, BTN_UP, BTN_X, BTN_Y,
    };

    #[test]
    fn normalizes_sticks_triggers_and_xinput_buttons() {
        // Deadzone filters micro-drift cleanly
        assert_eq!(normalize_stick_axis(3000, 0.18), 0.0);
        assert_eq!(normalize_stick_axis(-3000, 0.18), 0.0);
        assert!(normalize_stick_axis(32767, 0.18) > 0.99);
        assert!(normalize_stick_axis(-32768, 0.18) < -0.99);
        assert_eq!(normalize_trigger(10), 0.0);
        assert!(normalize_trigger(255) > 0.99);

        let snap = parse_xinput_gamepad(
            0x1000 | 0x8000 | 0x0100 | 0x0001, // A + Y + LB + DPad-Up
            0,
            240,
            24000,
            -28000,
            0,
            0,
        );
        assert_eq!(snap.buttons, BTN_A | BTN_Y | BTN_LB | BTN_UP);
        assert!(snap.lx > 0.6);
        assert!(snap.ly < -0.7);
        assert_eq!(snap.lt, 0.0);
        assert!(snap.rt > 0.9);
        assert!(snap.has_input());
    }

    #[test]
    fn parses_ps5_dualsense_usb_and_bluetooth_reports() {
        // DualSense USB 0x01 (64 bytes): [0]=0x01, [1]=LX, [2]=LY, [3]=RX, [4]=RY, [5]=L2, [6]=R2, [7]=seq, [8]=b0, [9]=b1
        let mut usb = [0u8; 64];
        usb[0] = 0x01;
        usb[1] = 255; // LX full right -> +1.0
        usb[2] = 0;   // LY full up (HID 0) -> +1.0
        usb[3] = 128; // RX center
        usb[4] = 255; // RY full down (HID 255) -> -1.0
        usb[5] = 200; // L2 analog
        usb[6] = 0;   // R2 released
        usb[8] = 0x20 | 0x80 | 0x02; // Cross (A) + Triangle (Y) + Hat East (Right)
        usb[9] = 0x01 | 0x20; // L1 (LB) + Options (Start)
        let s_usb = parse_dualsense_0x01_fallback(&usb).expect("usb 0x01 parse");
        assert!(s_usb.lx > 0.98);
        assert!(s_usb.ly > 0.98);
        assert_eq!(s_usb.rx, 0.0);
        assert!(s_usb.ry < -0.98);
        assert!(s_usb.lt > 0.70);
        assert_eq!(s_usb.rt, 0.0);
        assert_eq!(s_usb.buttons, BTN_A | BTN_Y | BTN_RIGHT | BTN_LB | BTN_START);

        // DualSense BT Enhanced 0x31 (78 bytes): [0]=0x31, [1]=0x02, [2..]=payload
        let mut bt31 = [0u8; 78];
        bt31[0] = 0x31;
        bt31[1] = 0x02;
        bt31[2] = 0;   // LX full left -> -1.0
        bt31[3] = 128; // LY center
        bt31[4] = 128; // RX center
        bt31[5] = 128; // RY center
        bt31[6] = 0;   // L2 released
        bt31[7] = 255; // R2 full pull
        bt31[9] = 0x10 | 0x40 | 0x04; // Square (X) + Circle (B) + Hat South (Down)
        bt31[10] = 0x02 | 0x10; // R1 (RB) + Create (Back)
        let s_bt31 = parse_dualsense_bt_0x31(&bt31).expect("bt 0x31 parse");
        assert!(s_bt31.lx < -0.98);
        assert_eq!(s_bt31.ly, 0.0);
        assert_eq!(s_bt31.lt, 0.0);
        assert!(s_bt31.rt > 0.99);
        assert_eq!(s_bt31.buttons, BTN_X | BTN_B | BTN_DOWN | BTN_RB | BTN_BACK);

        // DualSense BT Simple 0x01 (10 bytes): digital L2/R2 fallback when analog bytes are 0
        let bt01 = [0x01u8, 128, 128, 128, 128, 0x08 | 0x20, 0x04 | 0x02, 0, 0, 0];
        let s_bt01 = parse_dualsense_0x01_fallback(&bt01).expect("bt 0x01 simple parse");
        assert_eq!(s_bt01.buttons, BTN_A | BTN_RB);
        assert_eq!(s_bt01.lt, 1.0);
        assert_eq!(s_bt01.rt, 0.0);

        // Direct payload helper sanity check
        assert!(parse_dualsense_full_payload(&[128, 128]).is_none());
    }

    #[test]
    fn parses_ds4_and_switch_pro_reports() {
        // DS4 USB 0x01 payload: [lx, ly, rx, ry, b0, b1, b2, l2, r2]
        let ds4_usb = [128u8, 128, 255, 128, 0x06 | 0x10, 0x01 | 0x20, 0, 180, 255];
        let s4 = parse_sony_classic_payload(&ds4_usb).expect("ds4 payload");
        assert!(s4.rx > 0.98);
        assert!(s4.lt > 0.65);
        assert!(s4.rt > 0.99);
        assert_eq!(s4.buttons, BTN_LEFT | BTN_X | BTN_LB | BTN_START);

        // DS4 BT 0x11 (78 bytes)
        let mut ds4_bt = [0u8; 78];
        ds4_bt[0] = 0x11;
        ds4_bt[1] = 0xC0;
        ds4_bt[3] = 128;
        ds4_bt[4] = 0; // LY up -> +1.0
        ds4_bt[5] = 128;
        ds4_bt[6] = 128;
        ds4_bt[7] = 0x08 | 0x40; // neutral hat + Circle (B)
        ds4_bt[8] = 0x02; // R1 (RB)
        ds4_bt[10] = 0;
        ds4_bt[11] = 220; // R2 analog
        let s4_bt = parse_ds4_bt_0x11(&ds4_bt).expect("ds4 bt 0x11");
        assert!(s4_bt.ly > 0.98);
        assert_eq!(s4_bt.buttons, BTN_B | BTN_RB);
        assert!(s4_bt.rt > 0.8);

        // Switch Pro 0x30 report
        let mut pro = [0u8; 16];
        pro[0] = 0x30;
        pro[3] = 0x04 | 0x40 | 0x80; // B (bottom -> A) + R (RB) + ZR (RT)
        pro[4] = 0x02; // Plus (Start)
        pro[5] = 0x02 | 0x40; // Up + L (LB)
        // Left stick center (2048, 2048) -> [0x00, 0x08, 0x80]
        pro[6] = 0x00;
        pro[7] = 0x08;
        pro[8] = 0x80;
        // Right stick center (2048, 2048)
        pro[9] = 0x00;
        pro[10] = 0x08;
        pro[11] = 0x80;
        let spro = parse_switch_pro_0x30(&pro).expect("switch pro 0x30");
        assert_eq!(spro.buttons, BTN_A | BTN_RB | BTN_START | BTN_UP | BTN_LB);
        assert_eq!(spro.rt, 1.0);
        assert_eq!(spro.lt, 0.0);
        assert_eq!(spro.lx, 0.0);
    }

    #[test]
    fn normalizes_generic_hid_axes_hats_and_xinput_path_filter() {
        assert!(is_xinput_device_path(r"\\?\HID#VID_045E&PID_0B12&IG_00#7&1234"));
        assert!(is_xinput_device_path(r"\\?\HID#VID_045E&PID_02FF&ig_01#foo"));
        assert!(!is_xinput_device_path(r"\\?\HID#VID_054C&PID_0CE6#7&5678"));
        assert!(!is_xinput_device_path(r"\\?\HID#{00001124-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&0CE6"));

        assert_eq!(dpad_from_hat(0), BTN_UP);
        assert_eq!(dpad_from_hat(3), BTN_DOWN | BTN_RIGHT);
        assert_eq!(dpad_from_hat(8), 0);

        // Unsigned 16-bit axis with firmware quirk logical_max = -1
        assert_eq!(normalize_hid_stick(32768, 0, -1, 16, 0.18, false), 0.0);
        assert!(normalize_hid_stick(65535, 0, -1, 16, 0.18, false) > 0.99);
        assert!(normalize_hid_stick(0, 0, 255, 8, 0.18, true) > 0.99);
        assert!(normalize_hid_trigger(255, 0, 255, 8) > 0.99);
        assert_eq!(normalize_hid_trigger(10, 0, 255, 8), 0.0);
    }

    #[test]
    fn decodes_macos_iokit_hid_elements_for_xbox_sony_switch_and_generic() {
        use super::{classify_hid_vid_pid, HidControllerKind, HidElementDeviceState};

        // Xbox Series X|S Bluetooth (0x045E / 0x0B13): non-contiguous buttons + Sim triggers + Consumer AC Back
        assert_eq!(
            classify_hid_vid_pid(0x045E, 0x0B13),
            HidControllerKind::XboxModernBt
        );
        let mut xbox = HidElementDeviceState::new(HidControllerKind::XboxModernBt);
        assert!(xbox.apply_element(0x01, 0x30, 65535, 0, 65535)); // LX right
        assert!(xbox.apply_element(0x01, 0x31, 0, 0, 65535)); // LY up -> +1
        assert!(xbox.apply_element(0x01, 0x32, 32768, 0, 65535)); // RX center
        assert!(xbox.apply_element(0x01, 0x35, 65535, 0, 65535)); // RY down -> -1
        assert!(xbox.apply_element(0x02, 0xC5, 900, 0, 1023)); // Brake -> LT
        assert!(xbox.apply_element(0x02, 0xC4, 0, 0, 1023)); // Accelerator -> RT
        assert!(xbox.apply_element(0x01, 0x39, 1, 1, 8)); // 1-based hat Up
        assert!(xbox.apply_element(0x09, 1, 1, 0, 1)); // A
        assert!(xbox.apply_element(0x09, 4, 1, 0, 1)); // X
        assert!(xbox.apply_element(0x09, 7, 1, 0, 1)); // LB
        assert!(xbox.apply_element(0x09, 12, 1, 0, 1)); // Start/Menu
        assert!(xbox.apply_element(0x0C, 0x224, 1, 0, 1)); // Consumer AC Back -> Back
        let sx = xbox.snapshot();
        assert!(sx.lx > 0.99);
        assert!(sx.ly > 0.99);
        assert_eq!(sx.rx, 0.0);
        assert!(sx.ry < -0.99);
        assert!(sx.lt > 0.85);
        assert_eq!(sx.rt, 0.0);
        assert_eq!(
            sx.buttons,
            BTN_A | BTN_X | BTN_LB | BTN_START | BTN_BACK | BTN_UP
        );

        // Sony DualSense (0x054C / 0x0CE6): Z/Rz right stick, Rx/Ry analog triggers, Square/Cross buttons
        assert_eq!(
            classify_hid_vid_pid(0x054C, 0x0CE6),
            HidControllerKind::SonyDualSense
        );
        let mut ps5 = HidElementDeviceState::new(HidControllerKind::SonyDualSense);
        assert!(ps5.apply_element(0x01, 0x32, 0, 0, 255)); // RX left -> -1
        assert!(ps5.apply_element(0x01, 0x35, 128, 0, 255)); // RY center
        assert!(ps5.apply_element(0x01, 0x33, 200, 0, 255)); // L2 analog
        assert!(ps5.apply_element(0x01, 0x34, 255, 0, 255)); // R2 analog
        assert!(ps5.apply_element(0x09, 2, 1, 0, 1)); // Cross -> A
        assert!(ps5.apply_element(0x09, 6, 1, 0, 1)); // R1 -> RB
        let sp = ps5.snapshot();
        assert!(sp.rx < -0.98);
        assert_eq!(sp.ry, 0.0);
        assert!(sp.lt > 0.70);
        assert!(sp.rt > 0.99);
        assert_eq!(sp.buttons, BTN_A | BTN_RB);

        // Switch Pro (0x057E / 0x2009): digital ZL/ZR + diamond mapping
        let mut pro = HidElementDeviceState::new(classify_hid_vid_pid(0x057E, 0x2009));
        assert!(pro.apply_element(0x09, 3, 1, 0, 1)); // Y (left) -> X
        assert!(pro.apply_element(0x09, 8, 1, 0, 1)); // ZR -> RT
        let sn = pro.snapshot();
        assert_eq!(sn.buttons, BTN_X);
        assert_eq!(sn.rt, 1.0);
    }

    #[cfg(windows)]
    #[test]
    fn verifies_win32_raw_input_and_hidp_abi_sizes() {
        assert_eq!(std::mem::size_of::<super::win_impl::RidDeviceInfo>(), 32);
        assert_eq!(std::mem::size_of::<super::win_impl::HidpCaps>(), 64);
        assert_eq!(std::mem::size_of::<super::win_impl::HidpValueCaps>(), 72);
    }
}
