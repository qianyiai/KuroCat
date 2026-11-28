package com.kurocat.pet

import android.content.Context
import org.json.JSONObject

data class KuroSkinOption(
    val id: String,
    val emoji: String,
    val name: String,
    val accentHex: Int
)

object KuroPrefs {
    private const val PREF_NAME = "kurocat_prefs"

    val SKINS = listOf(
        KuroSkinOption("black", "🐈‍⬛", "小黑猫", 0xFFC8F538.toInt()),
        KuroSkinOption("ragdoll", "🐱", "布偶猫", 0xFF7AC7FF.toInt()),
        KuroSkinOption("orange-tabby", "🍊", "大橘猫", 0xFFFFAE42.toInt()),
        KuroSkinOption("calico", "🌸", "三花猫", 0xFFFF88B5.toInt()),
        KuroSkinOption("tuxedo", "🐄", "奶牛猫", 0xFFD8E2F0.toInt()),
        KuroSkinOption("siamese", "🤎", "暹罗猫", 0xFFD4A373.toInt()),
        KuroSkinOption("dafeiyu", "🐳", "大肥鱼", 0xFF5CC8FF.toInt()),
    )

    private fun sp(ctx: Context) = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    fun getLanguage(ctx: Context): String = sp(ctx).getString("language", "auto") ?: "auto"
    fun setLanguage(ctx: Context, v: String) = sp(ctx).edit().putString("language", v).apply()

    fun getBreed(ctx: Context): String = sp(ctx).getString("breed", "black") ?: "black"
    fun setBreed(ctx: Context, v: String) = sp(ctx).edit().putString("breed", v).apply()

    fun getRenderMode(ctx: Context): String =
        when (val v = sp(ctx).getString("render_mode", "2d")) {
            "3d", "3d-flat", "2d" -> v
            else -> "2d"
        }

    fun setRenderMode(ctx: Context, v: String) {
        val norm = if (v == "3d" || v == "3d-flat") v else "2d"
        sp(ctx).edit().putString("render_mode", norm).apply()
    }

    fun getCollarColor(ctx: Context): String =
        when (val v = sp(ctx).getString("collar_color", "none")) {
            "red", "blue", "pink", "green" -> v
            else -> "none"
        }

    fun setCollarColor(ctx: Context, v: String) {
        val norm = if (v in setOf("red", "blue", "pink", "green")) v else "none"
        sp(ctx).edit().putString("collar_color", norm).apply()
    }

    fun isLaoWuHandoverEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("lao_wu_handover", true)
    fun setLaoWuHandoverEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("lao_wu_handover", v).apply()

    fun getTreatFlavor(ctx: Context): String =
        when (val v = sp(ctx).getString("treat_flavor", "tuna")) {
            "salmon", "chicken" -> v
            else -> "tuna"
        }

    fun setTreatFlavor(ctx: Context, v: String) {
        val norm = if (v == "salmon" || v == "chicken") v else "tuna"
        sp(ctx).edit().putString("treat_flavor", norm).apply()
    }

    fun getLayout(ctx: Context): String =
        when (val v = sp(ctx).getString("layout", "65")) {
            "65", "98", "108", "macbook" -> v
            else -> "65"
        }

    fun setLayout(ctx: Context, v: String) {
        val norm = if (v in setOf("65", "98", "108", "macbook")) v else "65"
        sp(ctx).edit().putString("layout", norm).apply()
    }

    fun getOrientation(ctx: Context): String = sp(ctx).getString("orientation", "cat") ?: "cat"
    fun setOrientation(ctx: Context, v: String) = sp(ctx).edit().putString("orientation", v).apply()

    fun getScale(ctx: Context): Float = sp(ctx).getFloat("scale", 0.78f).coerceIn(0.35f, 1.40f)
    fun setScale(ctx: Context, v: Float) =
        sp(ctx).edit().putFloat("scale", v.coerceIn(0.35f, 1.40f)).apply()

    fun getOpacity(ctx: Context): Float = sp(ctx).getFloat("opacity", 1.0f).coerceIn(0.20f, 1.0f)
    fun setOpacity(ctx: Context, v: Float) =
        sp(ctx).edit().putFloat("opacity", v.coerceIn(0.20f, 1.0f)).apply()

    fun isShowKeyBubbles(ctx: Context): Boolean = sp(ctx).getBoolean("show_bubbles", true)
    fun setShowKeyBubbles(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("show_bubbles", v).apply()

    fun isShowMouse(ctx: Context): Boolean = sp(ctx).getBoolean("show_mouse", true)
    fun setShowMouse(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("show_mouse", v).apply()

    fun isSoundEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("sound_enabled", true)
    fun setSoundEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("sound_enabled", v).apply()

    fun isTypingSoundEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("typing_sound_enabled", false)
    fun setTypingSoundEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("typing_sound_enabled", v).apply()

    fun isPrivacyGuardEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("privacy_guard", true)
    fun setPrivacyGuardEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("privacy_guard", v).apply()

    fun isTouchThroughLocked(ctx: Context): Boolean = sp(ctx).getBoolean("touch_through", false)
    fun setTouchThroughLocked(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("touch_through", v).apply()

    fun isHeadphonesEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("headphones", false)
    fun setHeadphonesEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("headphones", v).apply()

    fun getGamepadMode(ctx: Context): String =
        when (val v = sp(ctx).getString("gamepad_mode", "auto")) {
            "on", "off" -> v
            else -> "auto"
        }

    fun setGamepadMode(ctx: Context, v: String) {
        val norm = if (v == "on" || v == "off") v else "auto"
        sp(ctx).edit().putString("gamepad_mode", norm).apply()
    }

    fun isTabletEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("tablet_mode", false)
    fun setTabletEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("tablet_mode", v).apply()

    fun getTailKeyMode(ctx: Context): String =
        when (val v = sp(ctx).getString("tail_key_mode", "smart")) {
            "smart", "edge", "off" -> v
            else -> "smart"
        }

    fun setTailKeyMode(ctx: Context, v: String) {
        val normalized = if (v == "edge" || v == "off") v else "smart"
        sp(ctx).edit().putString("tail_key_mode", normalized).apply()
    }

    fun getFpsCap(ctx: Context): Int =
        if (sp(ctx).getInt("fps_cap", 0) == 30) 30 else 0

    fun setFpsCap(ctx: Context, v: Int) =
        sp(ctx).edit().putInt("fps_cap", if (v == 30) 30 else 0).apply()

    fun getOverlayX(ctx: Context, defaultX: Int): Int = sp(ctx).getInt("overlay_x", defaultX)
    fun getOverlayY(ctx: Context, defaultY: Int): Int = sp(ctx).getInt("overlay_y", defaultY)
    fun setOverlayPos(ctx: Context, x: Int, y: Int) =
        sp(ctx).edit().putInt("overlay_x", x).putInt("overlay_y", y).apply()

    fun clearOverlayPos(ctx: Context) =
        sp(ctx).edit().remove("overlay_x").remove("overlay_y").apply()

    fun nextBreed(ctx: Context): String {
        val cur = getBreed(ctx)
        val idx = SKINS.indexOfFirst { it.id == cur }
        val next = SKINS[(idx + 1) % SKINS.size].id
        setBreed(ctx, next)
        return next
    }

    fun toJsJson(
        ctx: Context,
        privacyActive: Boolean = false,
        audioMuted: Boolean = false
    ): String {
        return JSONObject().apply {
            put("catBreed", getBreed(ctx))
            put("renderMode", getRenderMode(ctx))
            put("collarColor", getCollarColor(ctx))
            put("laoWuHandover", isLaoWuHandoverEnabled(ctx))
            put("treatFlavor", getTreatFlavor(ctx))
            put("keyboardLayout", getLayout(ctx))
            put("keyboardOrientation", getOrientation(ctx))
            put("opacity", getOpacity(ctx).toDouble())
            put("showKeyBubbles", isShowKeyBubbles(ctx))
            put("soundEnabled", !audioMuted && isSoundEnabled(ctx))
            put("typingSoundEnabled", !audioMuted && isTypingSoundEnabled(ctx))
            put("privacyMode", privacyActive && isPrivacyGuardEnabled(ctx))
            put("headphones", isHeadphonesEnabled(ctx))
            put("gamepadMode", getGamepadMode(ctx))
            put("tabletMode", if (isTabletEnabled(ctx)) "on" else "off")
            put("tailKeyMode", getTailKeyMode(ctx))
            put("fpsCap", getFpsCap(ctx))
            put("showMouse", isShowMouse(ctx))
        }.toString()
    }
}
