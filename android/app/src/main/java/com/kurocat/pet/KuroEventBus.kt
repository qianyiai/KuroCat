package com.kurocat.pet

import android.os.Handler
import android.os.Looper
import android.util.Log
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
    fun onPetVisibilityChanged(visible: Boolean) {}
}

object KuroEventBus {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<KuroPetListener>()

    val overlayRunning = AtomicBoolean(false)
    val overlayHidden = AtomicBoolean(false)
    val mainActivityResumed = AtomicBoolean(false)
    val accessibilityConnected = AtomicBoolean(false)
    val privacyActive = AtomicBoolean(false)
    val systemImeVisible = AtomicBoolean(false)
    val inAppImeVisible = AtomicBoolean(false)
    val imeVisible = AtomicBoolean(false)
    @Volatile
    var lastTypingSignalMs: Long = 0L
    @Volatile
    var lastImeSensorEmitMs: Long = 0L
    @Volatile
    var lastPetTouchDownMs: Long = 0L

    fun isAnyPetVisible(): Boolean =
        (overlayRunning.get() && !overlayHidden.get()) || mainActivityResumed.get()

    private fun recomputeImeVisibility() {
        val next = systemImeVisible.get() || inAppImeVisible.get()
        val prev = imeVisible.getAndSet(next)
        if (prev != next) {
            mainHandler.post {
                listeners.forEach { it.onImeVisibilityChanged(next) }
            }
        }
    }

    private fun notifyPetVisibility() {
        val visible = isAnyPetVisible()
        mainHandler.post {
            listeners.forEach { it.onPetVisibilityChanged(visible) }
        }
    }

    fun markPetTouchDown() {
        lastPetTouchDownMs = System.currentTimeMillis()
    }

    fun register(listener: KuroPetListener) {
        listeners.add(listener)
    }

    fun unregister(listener: KuroPetListener) {
        listeners.remove(listener)
    }

    fun postTypingBurst(count: Int, kind: String = "char") {
        lastTypingSignalMs = System.currentTimeMillis()
        if (Log.isLoggable("KuroCat", Log.DEBUG)) {
            Log.d("KuroCat", "typingBurst kind=$kind count=$count")
        }
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
        systemImeVisible.set(visible)
        recomputeImeVisibility()
    }

    fun postInAppImeVisibilityChanged(visible: Boolean) {
        inAppImeVisible.set(visible)
        recomputeImeVisibility()
    }

    fun postOverlayHiddenChanged(hidden: Boolean) {
        overlayHidden.set(hidden)
        notifyPetVisibility()
    }

    fun postMainActivityResumedChanged(resumed: Boolean) {
        mainActivityResumed.set(resumed)
        if (!resumed) {
            inAppImeVisible.set(false)
            recomputeImeVisibility()
        }
        notifyPetVisibility()
    }

    fun postSettingsChanged() {
        mainHandler.post {
            listeners.forEach { it.onSettingsChanged() }
        }
    }

    fun postOverlayStateChanged(running: Boolean) {
        overlayRunning.set(running)
        if (!running) {
            overlayHidden.set(false)
        }
        mainHandler.post {
            listeners.forEach { it.onOverlayStateChanged(running) }
        }
        notifyPetVisibility()
    }
}
