//! Quartz physical keycodes to KuroCat's cross-platform VK event vocabulary.
//! IOHID, evdev and Windows keep their existing adapters in input_hook.
pub(crate) const VK_MAC_FN: u32 = 0x13f;

pub(crate) fn macos_keycode_to_vk(kc: u16) -> Option<u32> {
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
        0x35 => 0x1B,  // Esc
        0x30 => 0x09,  // Tab
        0x31 => 0x20,  // Space
        0x24 => 0x0D,  // Return
        0x4C => 0x10D, // Numpad Enter
        0x33 => 0x08,  // Backspace (Delete)
        0x75 => 0x2E,  // Forward Delete
        0x39 => 0x14,  // CapsLock
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
        0x3F => VK_MAC_FN,
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

/// Auxiliary usages reported by a keyboard already matched by IOHIDManager.
/// Preserve media VKs; keep Apple system actions outside the standard VK range.
pub(crate) fn keyboard_action_vk(page: u32, usage: u32) -> Option<u32> {
    Some(match (page, usage) {
        (0x0c, 0x70) => 0x140, // display brightness down
        (0x0c, 0x6f) => 0x141, // display brightness up
        (0x0c, 0x29f) => 0x142, // show all windows
        (0x0c, 0x221) => 0x143, // search
        (0x0c, 0xcf) => 0x144, // voice command
        (0x01, 0x9b) => 0x145, // do not disturb
        (0x0c, 0xb6) => 0xb1, // previous track
        (0x0c, 0xcd) => 0xb3, // play/pause
        (0x0c, 0xb5) => 0xb0, // next track
        (0x0c, 0xe2) => 0xad, // mute
        (0x0c, 0xea) => 0xae, // volume down
        (0x0c, 0xe9) => 0xaf, // volume up
        _ => return None,
    })
}

/// IOKit IOLLEvent.h device-dependent masks distinguish releases during two-sided chords.
/// Some input sources supply only the combined mask. Use it when neither side bit is present.
pub(crate) fn modifier_down(kc: u16, flags: u64) -> Option<bool> {
    let (side, pair, combined) = match kc {
        0x37 => (0x08, 0x18, 1 << 20), // left command
        0x36 => (0x10, 0x18, 1 << 20),
        0x3a => (0x20, 0x60, 1 << 19), // left option
        0x3d => (0x40, 0x60, 1 << 19),
        0x38 => (0x02, 0x06, 1 << 17), // left shift
        0x3c => (0x04, 0x06, 1 << 17),
        0x3b => (0x01, 0x2001, 1 << 18), // left control
        0x3e => (0x2000, 0x2001, 1 << 18),
        0x39 => return Some(flags & (1 << 16) != 0),
        0x3f => return Some(flags & (1 << 23) != 0),
        _ => return None,
    };
    Some(if flags & pair != 0 {
        flags & side != 0
    } else {
        flags & combined != 0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_one_side_while_other_stays_down() {
        for (left, right, remaining, combined) in [
            (0x37, 0x36, 0x10, 1 << 20),
            (0x3a, 0x3d, 0x40, 1 << 19),
        ] {
            assert_eq!(modifier_down(left, combined | remaining), Some(false));
            assert_eq!(modifier_down(right, combined | remaining), Some(true));
            assert_eq!(modifier_down(left, combined), Some(true));
            assert_eq!(modifier_down(right, 0), Some(false));
        }
    }

    #[test]
    fn consumer_actions_are_page_specific() {
        assert_eq!(keyboard_action_vk(0x0c, 0x70), Some(0x140));
        assert_eq!(keyboard_action_vk(0x0c, 0xcd), Some(0xb3));
        assert_eq!(keyboard_action_vk(0x07, 0x70), None);
        assert_eq!(keyboard_action_vk(0x08, 0x08), None); // LED status
    }

    #[test]
    fn physical_events_keep_their_identity() {
        for (kc, vk) in [
            (0x37, 0x5b),
            (0x36, 0x5c),
            (0x3a, 0xa4),
            (0x3d, 0xa5),
            (0x3b, 0xa2),
            (0x31, 0x20),
            (0x33, 8),
            (0x24, 13),
            (0x35, 27),
            (0x3f, VK_MAC_FN),
            (0x7b, 0x25),
            (0x7e, 0x26),
            (0x7c, 0x27),
            (0x7d, 0x28),
        ] {
            assert_eq!(macos_keycode_to_vk(kc), Some(vk));
        }
        for (index, kc) in [
            0x7a, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6d, 0x67, 0x6f,
        ]
        .into_iter()
        .enumerate()
        {
            assert_eq!(macos_keycode_to_vk(kc), Some(0x70 + index as u32));
        }
        assert_eq!(modifier_down(0x3f, 1 << 23), Some(true));
        assert_eq!(modifier_down(0x3f, 0), Some(false));
        assert_eq!(macos_keycode_to_vk(0xffff), None);
    }
}
