package com.kurocat.pet

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.text.InputType
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/**
 * Privacy-first AccessibilityService for KuroCat Android:
 * - Drives cat / BigFish typing rhythm purely from event character-count deltas (NEVER stores,
 *   reads, or transmits typed text content!).
 * - Detects password fields via `isPassword` / `InputType`, semantic field metadata (viewId, hint,
 *   contentDescription, labeledBy — never `src.text`), custom financial password classes, and
 *   payment PIN keyboard/dialog titles to automatically close eyes / cover eyes.
 * - Captures physical Bluetooth/USB keyboard KeyEvents (returning `false` so keys are never consumed).
 */
class KuroAccessibilityService : AccessibilityService() {

    companion object {
        // Explicit denylist mirrored from `src-tauri/src/privacy.rs` to prevent false positives on
        // search bars, omniboxes, account/OTP fields, or chat/editor inputs.
        private val DENY_SUBSTRINGS = arrayOf(
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
        )

        private val PASSWORD_TOKENS = setOf(
            "password",
            "passcode",
            "passwd",
            "passphrase",
            "pwd",
            "pin",
        )

        private val CUSTOM_PWD_CLASS_KEYWORDS = arrayOf(
            "pwd",
            "pass",
            "safeedit",
            "securityedit",
            "pininput",
        )

        private val CUSTOM_PWD_CLASS_EXCLUDES = arrayOf(
            "list",
            "button",
            "viewgroup",
            "recycler",
            "compass",
            "passenger",
        )

        private val PASSWORD_WINDOW_KEYWORDS = arrayOf(
            "支付密码",
            "安全键盘",
            "密码键盘",
            "交易密码",
            "资金密码",
        )

        private val PASSWORD_WINDOW_ASCII_KEYWORDS = arrayOf(
            "paypwddialog",
            "safekeyboard",
            "pwdkeyboard",
            "passwordkeyboard",
        )

        private val TRANSIENT_PKG_SUBSTRINGS = arrayOf(
            "inputmethod",
            "keyboard",
            "gboard",
            "sogou",
            "baidu.input",
            "iflytek",
            "xunfei",
            "systemui",
            "autofill",
            "honeyboard",
            "swiftkey",
            "wetype",
            "qqpinyin",
            "com.kurocat.pet",
        )

        private val NON_IME_SUFFIXES = arrayOf(
            "time",
            "anime",
            "prime",
            "crime",
            "mime",
            "chime",
            "slime",
        )
    }

    private var lastTextEventMs = 0L
    private var lastClickEventMs = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        KuroEventBus.accessibilityConnected.set(true)
        KuroEventBus.postSettingsChanged()
    }

    override fun onInterrupt() {
        // Nothing to interrupt
    }

    override fun onDestroy() {
        KuroEventBus.accessibilityConnected.set(false)
        KuroEventBus.postPrivacyChanged(false)
        KuroEventBus.postSettingsChanged()
        super.onDestroy()
    }

    private fun safeEventSource(event: AccessibilityEvent): AccessibilityNodeInfo? = try {
        event.source
    } catch (_: Throwable) {
        null
    }

    private fun safeRecycle(node: AccessibilityNodeInfo?) {
        if (node == null) return
        try {
            @Suppress("DEPRECATION")
            node.recycle()
        } catch (_: Throwable) {
            // Safe no-op on API 34+ or if already recycled
        }
    }

    private fun isPasswordInputType(inputType: Int): Boolean {
        val cls = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (cls) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    internal fun looksLikePasswordFieldLabel(raw: String?): Boolean {
        if (raw.isNullOrBlank()) return false
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed.codePointCount(0, trimmed.length) > 64) {
            return false
        }
        val lower = trimmed.lowercase(Locale.ROOT)
        if (DENY_SUBSTRINGS.any { lower.contains(it) }) {
            return false
        }
        if (trimmed.contains("密码") || trimmed.contains("口令")) {
            return true
        }

        // Split ASCII identifiers on non-alphanumeric boundaries AND camelCase transitions
        // (mirrors `looks_like_password_field_label` in `src-tauri/src/privacy.rs`).
        val cur = StringBuilder()
        var prevLower = false
        for (ch in trimmed) {
            if (ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9') {
                if (ch in 'A'..'Z' && prevLower && cur.isNotEmpty()) {
                    if (cur.toString() in PASSWORD_TOKENS) return true
                    cur.setLength(0)
                }
                prevLower = ch in 'a'..'z'
                cur.append(if (ch in 'A'..'Z') (ch.code + 32).toChar() else ch)
            } else {
                if (cur.isNotEmpty()) {
                    if (cur.toString() in PASSWORD_TOKENS) return true
                    cur.setLength(0)
                }
                prevLower = false
            }
        }
        return cur.isNotEmpty() && cur.toString() in PASSWORD_TOKENS
    }

    private fun isCustomPasswordClass(className: String?): Boolean {
        if (className.isNullOrBlank()) return false
        val simple = className.substringAfterLast('.').lowercase(Locale.ROOT)
        if (simple.isEmpty()) return false
        if (CUSTOM_PWD_CLASS_EXCLUDES.any { simple.contains(it) }) {
            return false
        }
        return CUSTOM_PWD_CLASS_KEYWORDS.any { simple.contains(it) }
    }

    private fun isEligibleForSemanticPasswordCheck(
        src: AccessibilityNodeInfo,
        className: String?,
        eventType: Int
    ): Boolean {
        val simple = className?.substringAfterLast('.')?.lowercase(Locale.ROOT).orEmpty()
        if (simple.contains("button") ||
            simple.contains("checkbox") ||
            simple.contains("switch") ||
            simple.contains("list") ||
            simple.contains("recycler") ||
            simple.contains("spinner") ||
            simple.contains("seekbar") ||
            simple.contains("progressbar")
        ) {
            return false
        }
        if (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            return true
        }
        if (src.isEditable || src.inputType != InputType.TYPE_NULL) {
            return true
        }
        val hasHint = try {
            !src.hintText.isNullOrEmpty()
        } catch (_: Throwable) {
            false
        }
        if (hasHint) return true
        if (simple.contains("edit") || simple.contains("input")) {
            return true
        }
        if (eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED && simple != "textview") {
            return true
        }
        return false
    }

    // NEVER inspect `src.text` here — typed user input must never be read.
    private fun isPasswordNode(src: AccessibilityNodeInfo, eventType: Int): Boolean {
        if (src.isPassword || isPasswordInputType(src.inputType)) {
            return true
        }
        if (src.isMultiLine) {
            return false
        }

        val className = src.className?.toString()
        if (isCustomPasswordClass(className)) {
            return true
        }

        if (!isEligibleForSemanticPasswordCheck(src, className, eventType)) {
            return false
        }

        val viewIdEntry = src.viewIdResourceName?.let { it.substringAfterLast('/', it) }
        if (looksLikePasswordFieldLabel(viewIdEntry)) {
            return true
        }

        val hint = try {
            src.hintText?.toString()
        } catch (_: Throwable) {
            null
        }
        if (looksLikePasswordFieldLabel(hint)) {
            return true
        }

        if (looksLikePasswordFieldLabel(src.contentDescription?.toString())) {
            return true
        }

        val labelNode: AccessibilityNodeInfo? = try {
            src.labeledBy
        } catch (_: Throwable) {
            null
        }
        if (labelNode != null) {
            try {
                if (labelNode != src && looksLikePasswordFieldLabel(labelNode.text?.toString())) {
                    return true
                }
            } finally {
                safeRecycle(labelNode)
            }
        }

        return false
    }

    private fun isPasswordEvent(event: AccessibilityEvent): Boolean {
        if (event.isPassword) return true
        val src = safeEventSource(event) ?: return false
        return try {
            isPasswordNode(src, event.eventType)
        } finally {
            safeRecycle(src)
        }
    }

    private fun matchesPasswordWindowToken(raw: String?, checkDeny: Boolean): Boolean {
        if (raw.isNullOrBlank()) return false
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed.codePointCount(0, trimmed.length) > 128) return false
        val lower = trimmed.lowercase(Locale.ROOT)
        if (checkDeny && (lower.contains("搜索") || lower.contains("search"))) {
            return false
        }
        if (PASSWORD_WINDOW_KEYWORDS.any { trimmed.contains(it) }) {
            return true
        }
        return PASSWORD_WINDOW_ASCII_KEYWORDS.any { lower.contains(it) }
    }

    private fun isPasswordWindowEvent(event: AccessibilityEvent): Boolean {
        if (event.isPassword) return true
        if (matchesPasswordWindowToken(event.className?.toString(), checkDeny = false)) {
            return true
        }
        if (matchesPasswordWindowToken(event.contentDescription?.toString(), checkDeny = true)) {
            return true
        }
        val texts = event.text
        if (!texts.isNullOrEmpty()) {
            for (cs in texts) {
                if (matchesPasswordWindowToken(cs?.toString(), checkDeny = true)) {
                    return true
                }
            }
        }
        return false
    }

    private fun isTransientImeOrSystemEvent(event: AccessibilityEvent): Boolean {
        val pkg = event.packageName?.toString()?.lowercase(Locale.ROOT)
        if (!pkg.isNullOrEmpty()) {
            if (pkg == packageName.lowercase(Locale.ROOT)) return true
            if (TRANSIENT_PKG_SUBSTRINGS.any { pkg.contains(it) }) return true
            val segments = pkg.split('.', '_', '-')
            if (segments.any { seg ->
                    seg == "ime" || (seg.endsWith("ime") && NON_IME_SUFFIXES.none { seg.endsWith(it) })
                }
            ) {
                return true
            }
        }
        val cls = event.className?.toString()?.lowercase(Locale.ROOT)
        if (!cls.isNullOrEmpty()) {
            if (cls.contains("inputmethod") || cls.contains("softinput") || cls.contains("autofill")) {
                return true
            }
        }
        return false
    }

    private fun isFocusedInputStillPassword(): Boolean {
        val root: AccessibilityNodeInfo = try {
            rootInActiveWindow
        } catch (_: Throwable) {
            null
        } ?: return false
        var focused: AccessibilityNodeInfo? = null
        return try {
            if (root.packageName?.toString() == packageName) return false
            focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            focused != null && isPasswordNode(focused, AccessibilityEvent.TYPE_VIEW_FOCUSED)
        } catch (_: Throwable) {
            false
        } finally {
            if (focused != null && focused !== root) {
                safeRecycle(focused)
            }
            safeRecycle(root)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        // CRITICAL: Never call `event.source` on events from our own package! Both MainActivity
        // and KuroAccessibilityService share the main thread, so querying `event.source` for our
        // own window deadlocks the AccessibilityInteractionController binder call (5s ANR!).
        // MainActivity handles its own in-app test typing & password boxes directly.
        if (event.packageName?.toString() == packageName) return
        val privacyGuardOn = KuroPrefs.isPrivacyGuardEnabled(this)

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                if (isPasswordEvent(event)) {
                    if (privacyGuardOn) {
                        KuroEventBus.postPrivacyChanged(true)
                        KuroEventBus.postPrivacyTyping()
                    }
                    return
                }

                val added = event.addedCount
                val removed = event.removedCount
                if (added <= 0 && removed <= 0) return

                if (KuroEventBus.privacyActive.get()) {
                    KuroEventBus.postPrivacyChanged(false)
                }

                val now = System.currentTimeMillis()
                if (now - lastTextEventMs < 35L) return
                lastTextEventMs = now

                when {
                    removed > 0 && added == 0 -> KuroEventBus.postTypingBurst(1, "delete")
                    added >= 4 -> KuroEventBus.postTypingBurst(3, "char")
                    added >= 2 -> KuroEventBus.postTypingBurst(2, "char")
                    else -> KuroEventBus.postTypingBurst(1, "char")
                }
            }

            AccessibilityEvent.TYPE_VIEW_FOCUSED -> {
                val isPwd = isPasswordEvent(event)
                if (isPwd) {
                    KuroEventBus.postPrivacyChanged(privacyGuardOn)
                } else if (KuroEventBus.privacyActive.get() && !isTransientImeOrSystemEvent(event)) {
                    KuroEventBus.postPrivacyChanged(false)
                }
            }

            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Detect payment PIN keyboards / safe keyboard dialogs immediately
                if (isPasswordWindowEvent(event)) {
                    if (privacyGuardOn) {
                        KuroEventBus.postPrivacyChanged(true)
                    }
                    return
                }
                if (!KuroEventBus.privacyActive.get()) return
                // Ignore transient IME / autofill / SystemUI overlays that appear over password fields
                if (isTransientImeOrSystemEvent(event)) return
                // Keep privacy mode active if the underlying focused input is still a password field
                if (isFocusedInputStillPassword()) return
                KuroEventBus.postPrivacyChanged(false)
            }

            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                if (privacyGuardOn && KuroEventBus.privacyActive.get()) {
                    KuroEventBus.postPrivacyTyping()
                    return
                }

                val src = safeEventSource(event)
                try {
                    if (privacyGuardOn &&
                        (event.isPassword || (src != null && isPasswordNode(src, event.eventType)))
                    ) {
                        KuroEventBus.postPrivacyChanged(true)
                        KuroEventBus.postPrivacyTyping()
                        return
                    }

                    val now = System.currentTimeMillis()
                    if (now - lastClickEventMs < 90L) return
                    lastClickEventMs = now

                    var nx = 0.5f
                    var ny = 0.5f
                    if (src != null) {
                        val r = Rect()
                        src.getBoundsInScreen(r)
                        val dm = resources.displayMetrics
                        if (dm.widthPixels > 0 && dm.heightPixels > 0 && !r.isEmpty) {
                            nx = (r.centerX().toFloat() / dm.widthPixels).coerceIn(0f, 1f)
                            ny = (r.centerY().toFloat() / dm.heightPixels).coerceIn(0f, 1f)
                        }
                    }
                    KuroEventBus.postScreenTap(nx, ny)
                } finally {
                    safeRecycle(src)
                }
            }
        }
    }

    override fun onKeyEvent(event: KeyEvent?): Boolean {
        if (event == null) return false
        val vk = androidKeyCodeToVk(event.keyCode) ?: return false
        val suppressForPrivacy = KuroEventBus.privacyActive.get() && KuroPrefs.isPrivacyGuardEnabled(this)
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (suppressForPrivacy) {
                    if (event.repeatCount == 0) {
                        KuroEventBus.postPrivacyTyping()
                    }
                } else {
                    KuroEventBus.postHardwareKey(vk, true, event.repeatCount > 0)
                }
            }
            KeyEvent.ACTION_UP -> {
                if (!suppressForPrivacy) {
                    KuroEventBus.postHardwareKey(vk, false, false)
                }
            }
        }
        // Always return false so KuroCat never intercepts or blocks normal user input!
        return false
    }

    private fun androidKeyCodeToVk(code: Int): Int? = when (code) {
        in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> 0x41 + (code - KeyEvent.KEYCODE_A)
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> 0x30 + (code - KeyEvent.KEYCODE_0)
        KeyEvent.KEYCODE_ENTER -> 0x0D
        KeyEvent.KEYCODE_NUMPAD_ENTER -> 0x10D
        KeyEvent.KEYCODE_SPACE -> 0x20
        KeyEvent.KEYCODE_DEL -> 0x08
        KeyEvent.KEYCODE_FORWARD_DEL -> 0x2E
        KeyEvent.KEYCODE_TAB -> 0x09
        KeyEvent.KEYCODE_ESCAPE -> 0x1B
        KeyEvent.KEYCODE_CAPS_LOCK -> 0x14
        KeyEvent.KEYCODE_SHIFT_LEFT -> 0xA0
        KeyEvent.KEYCODE_SHIFT_RIGHT -> 0xA1
        KeyEvent.KEYCODE_CTRL_LEFT -> 0xA2
        KeyEvent.KEYCODE_CTRL_RIGHT -> 0xA3
        KeyEvent.KEYCODE_ALT_LEFT -> 0xA4
        KeyEvent.KEYCODE_ALT_RIGHT -> 0xA5
        KeyEvent.KEYCODE_META_LEFT -> 0x5B
        KeyEvent.KEYCODE_META_RIGHT -> 0x5C
        KeyEvent.KEYCODE_DPAD_LEFT -> 0x25
        KeyEvent.KEYCODE_DPAD_UP -> 0x26
        KeyEvent.KEYCODE_DPAD_RIGHT -> 0x27
        KeyEvent.KEYCODE_DPAD_DOWN -> 0x28
        KeyEvent.KEYCODE_MINUS -> 0xBD
        KeyEvent.KEYCODE_EQUALS -> 0xBB
        KeyEvent.KEYCODE_LEFT_BRACKET -> 0xDB
        KeyEvent.KEYCODE_RIGHT_BRACKET -> 0xDD
        KeyEvent.KEYCODE_BACKSLASH -> 0xDC
        KeyEvent.KEYCODE_SEMICOLON -> 0xBA
        KeyEvent.KEYCODE_APOSTROPHE -> 0xDE
        KeyEvent.KEYCODE_GRAVE -> 0xC0
        KeyEvent.KEYCODE_COMMA -> 0xBC
        KeyEvent.KEYCODE_PERIOD -> 0xBE
        KeyEvent.KEYCODE_SLASH -> 0xBF
        in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> 0x70 + (code - KeyEvent.KEYCODE_F1)
        in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> 0x60 + (code - KeyEvent.KEYCODE_NUMPAD_0)
        else -> null
    }
}
