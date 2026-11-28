package com.kurocat.pet

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean

interface KuroPetListener {
    fun onTypingBurst(count: Int, kind: String) {}
    fun onHardwareKey(vk: Int, isDown: Boolean, repeat: Boolean) {}
    fun onGamepadState(json: String) {}
    fun onScreenTap(nx: Float, ny: Float) {}
    fun onPrivacyChanged(active: Boolean) {}
    fun onPrivacyTyping() {}
    fun onImeVisibilityChanged(visible: Boolean) {}
    fun onSettingsChanged() {}
    fun onOverlayStateChanged(running: Boolean) {}
}

object KuroEventBus {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<KuroPetListener>()

    val overlayRunning = AtomicBoolean(false)
    val accessibilityConnected = AtomicBoolean(false)
    val privacyActive = AtomicBoolean(false)
    val imeVisible = AtomicBoolean(false)
    @Volatile
    var lastTypingSignalMs: Long = 0L

    fun register(listener: KuroPetListener) {
        listeners.add(listener)
    }

    fun unregister(listener: KuroPetListener) {
        listeners.remove(listener)
    }

    fun postTypingBurst(count: Int, kind: String = "char") {
        lastTypingSignalMs = System.currentTimeMillis()
        mainHandler.post {
            listeners.forEach { it.onTypingBurst(count, kind) }
        }
    }

    fun postHardwareKey(vk: Int, isDown: Boolean, repeat: Boolean = false) {
        mainHandler.post {
            listeners.forEach { it.onHardwareKey(vk, isDown, repeat) }
        }
    }

    fun postGamepadState(json: String) {
        mainHandler.post {
            listeners.forEach { it.onGamepadState(json) }
        }
    }

    fun postScreenTap(nx: Float, ny: Float) {
        mainHandler.post {
            listeners.forEach { it.onScreenTap(nx, ny) }
        }
    }

    fun postPrivacyChanged(active: Boolean) {
        val prev = privacyActive.getAndSet(active)
        if (prev != active) {
            mainHandler.post {
                listeners.forEach { it.onPrivacyChanged(active) }
            }
        }
    }

    fun postPrivacyTyping() {
        mainHandler.post {
            listeners.forEach { it.onPrivacyTyping() }
        }
    }

    fun postImeVisibilityChanged(visible: Boolean) {
        val prev = imeVisible.getAndSet(visible)
        if (prev != visible) {
            mainHandler.post {
                listeners.forEach { it.onImeVisibilityChanged(visible) }
            }
        }
    }

    fun postSettingsChanged() {
        mainHandler.post {
            listeners.forEach { it.onSettingsChanged() }
        }
    }

    fun postOverlayStateChanged(running: Boolean) {
        overlayRunning.set(running)
        mainHandler.post {
            listeners.forEach { it.onOverlayStateChanged(running) }
        }
    }
}
