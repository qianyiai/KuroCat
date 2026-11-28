package com.kurocat.pet

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity(), KuroPetListener {

    private var previewWebView: WebView? = null
    private var previewReady = false
    private var previewTreatActive = false

    private lateinit var previewBadge: TextView
    private lateinit var overlayStatusBadge: TextView
    private lateinit var overlayPermBtn: TextView
    private lateinit var a11yStatusBadge: TextView
    private lateinit var a11yPermBtn: TextView
    private lateinit var mainToggleBtn: TextView
    private lateinit var scaleValueText: TextView
    private lateinit var scaleSeekBar: SeekBar
    private lateinit var opacityValueText: TextView
    private lateinit var opacitySeekBar: SeekBar
    private lateinit var swHandover: SwitchCompat
    private lateinit var swTouchThrough: SwitchCompat
    private lateinit var swPrivacy: SwitchCompat
    private lateinit var swBubbles: SwitchCompat
    private lateinit var swShowMouse: SwitchCompat
    private lateinit var swSound: SwitchCompat
    private lateinit var swTypingSound: SwitchCompat
    private lateinit var swHeadphones: SwitchCompat
    private lateinit var swTablet: SwitchCompat
    private lateinit var swFpsEco: SwitchCompat

    private val skinButtons = mutableMapOf<String, TextView>()
    private val langButtons = mutableMapOf<String, TextView>()
    private val collarButtons = mutableMapOf<String, TextView>()
    private val treatFlavorButtons = mutableMapOf<String, TextView>()
    private lateinit var btnTreatToggle: TextView
    private lateinit var btnRender3d: TextView
    private lateinit var btnRender3dFlat: TextView
    private lateinit var btnRender2d: TextView
    private lateinit var btnLayout65: TextView
    private lateinit var btnLayout98: TextView
    private lateinit var btnLayout108: TextView
    private lateinit var btnLayoutMac: TextView
    private lateinit var btnOrientCat: TextView
    private lateinit var btnOrientViewer: TextView
    private lateinit var btnTailSmart: TextView
    private lateinit var btnTailEdge: TextView
    private lateinit var btnTailOff: TextView
    private lateinit var btnGpAuto: TextView
    private lateinit var btnGpOn: TextView
    private lateinit var btnGpOff: TextView

    private var inAppPrivacyActive = false
    private var updatingUi = false
    private var localGpButtons = 0
    private var localGpLx = 0f
    private var localGpLy = 0f
    private var localGpRx = 0f
    private var localGpRy = 0f
    private var localGpLt = 0f
    private var localGpRt = 0f

    private fun t(key: String): String = KuroI18n.t(this, key)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        KuroEventBus.register(this)
        requestNotificationPermissionIfNeeded()
        refreshAllUi()
    }

    override fun onResume() {
        super.onResume()
        previewWebView?.onResume()
        KuroEventBus.postMainActivityResumedChanged(true)
        refreshAllUi()
    }

    override fun onPause() {
        KuroEventBus.postMainActivityResumedChanged(false)
        if (previewTreatActive) {
            stopPreviewTreat()
        }
        previewWebView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        KuroEventBus.unregister(this)
        previewWebView?.destroy()
        previewWebView = null
        super.onDestroy()
    }

    override fun dispatchGenericMotionEvent(ev: MotionEvent?): Boolean {
        if (ev != null &&
            (ev.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK &&
            ev.action == MotionEvent.ACTION_MOVE
        ) {
            fun dz(v: Float): Float = if (abs(v) < 0.16f) 0f else v.coerceIn(-1f, 1f)
            localGpLx = dz(ev.getAxisValue(MotionEvent.AXIS_X))
            localGpLy = dz(-ev.getAxisValue(MotionEvent.AXIS_Y))
            localGpRx = dz(ev.getAxisValue(MotionEvent.AXIS_Z))
            localGpRy = dz(-ev.getAxisValue(MotionEvent.AXIS_RZ))
            val ltRaw = maxOf(
                ev.getAxisValue(MotionEvent.AXIS_LTRIGGER),
                ev.getAxisValue(MotionEvent.AXIS_BRAKE)
            ).coerceIn(0f, 1f)
            val rtRaw = maxOf(
                ev.getAxisValue(MotionEvent.AXIS_RTRIGGER),
                ev.getAxisValue(MotionEvent.AXIS_GAS)
            ).coerceIn(0f, 1f)
            localGpLt = if (ltRaw < 0.08f) 0f else ltRaw
            localGpRt = if (rtRaw < 0.08f) 0f else rtRaw
            val hatX = ev.getAxisValue(MotionEvent.AXIS_HAT_X)
            val hatY = ev.getAxisValue(MotionEvent.AXIS_HAT_Y)
            localGpButtons = localGpButtons and (0x0F shl 6).inv()
            if (hatY < -0.5f) localGpButtons = localGpButtons or (1 shl 6)
            if (hatY > 0.5f) localGpButtons = localGpButtons or (1 shl 7)
            if (hatX < -0.5f) localGpButtons = localGpButtons or (1 shl 8)
            if (hatX > 0.5f) localGpButtons = localGpButtons or (1 shl 9)
            postLocalGamepadSnapshot()
        }
        return super.dispatchGenericMotionEvent(ev)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if ((event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
            (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
        ) {
            val isDown = event.action == KeyEvent.ACTION_DOWN
            val isUp = event.action == KeyEvent.ACTION_UP
            if (isDown || isUp) {
                val mask = when (event.keyCode) {
                    KeyEvent.KEYCODE_BUTTON_A -> 1 shl 0
                    KeyEvent.KEYCODE_BUTTON_B -> 1 shl 1
                    KeyEvent.KEYCODE_BUTTON_X -> 1 shl 2
                    KeyEvent.KEYCODE_BUTTON_Y -> 1 shl 3
                    KeyEvent.KEYCODE_BUTTON_L1 -> 1 shl 4
                    KeyEvent.KEYCODE_BUTTON_R1 -> 1 shl 5
                    KeyEvent.KEYCODE_DPAD_UP -> 1 shl 6
                    KeyEvent.KEYCODE_DPAD_DOWN -> 1 shl 7
                    KeyEvent.KEYCODE_DPAD_LEFT -> 1 shl 8
                    KeyEvent.KEYCODE_DPAD_RIGHT -> 1 shl 9
                    KeyEvent.KEYCODE_BUTTON_START -> 1 shl 10
                    KeyEvent.KEYCODE_BUTTON_SELECT -> 1 shl 11
                    else -> 0
                }
                if (mask != 0) {
                    localGpButtons = if (isDown) localGpButtons or mask else localGpButtons and mask.inv()
                    postLocalGamepadSnapshot()
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun postLocalGamepadSnapshot() {
        val hasInput = localGpButtons != 0 ||
            abs(localGpLx) > 0.01f || abs(localGpLy) > 0.01f ||
            abs(localGpRx) > 0.01f || abs(localGpRy) > 0.01f ||
            localGpLt > 0.01f || localGpRt > 0.01f
        val json = JSONObject().apply {
            put("active", hasInput)
            put("lx", localGpLx.toDouble())
            put("ly", localGpLy.toDouble())
            put("rx", localGpRx.toDouble())
            put("ry", localGpRy.toDouble())
            put("lt", localGpLt.toDouble())
            put("rt", localGpRt.toDouble())
            put("buttons", localGpButtons)
        }.toString()
        KuroEventBus.postGamepadState(json)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics)
            .roundToInt()

    private fun roundedBg(fill: Int, radiusDp: Int, strokeColor: Int = 0, strokeDp: Int = 0): GradientDrawable {
        return GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeDp > 0) setStroke(dp(strokeDp), strokeColor)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            }
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        if (KuroEventBus.accessibilityConnected.get()) return true
        val expected = ComponentName(this, KuroAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun startPreviewTreat() {
        if (KuroPrefs.getBreed(this) == "dafeiyu") {
            Toast.makeText(this, t("toast_treat_dafeiyu"), Toast.LENGTH_SHORT).show()
            return
        }
        previewTreatActive = true
        val flavor = JSONObject.quote(KuroPrefs.getTreatFlavor(this))
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.startTreat($flavor);")
        refreshTreatUi()
    }

    private fun stopPreviewTreat() {
        previewTreatActive = false
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.stopTreat();")
        refreshTreatUi()
    }

    private fun refreshTreatUi() {
        if (!::previewBadge.isInitialized || !::btnTreatToggle.isInitialized) return
        previewBadge.text = if (previewTreatActive) t("preview_treat_hint") else t("preview_hint")
        if (previewTreatActive) {
            btnTreatToggle.text = t("btn_feed_stop")
            btnTreatToggle.setTextColor(0xFFFF9696.toInt())
            btnTreatToggle.background = roundedBg(0x2BFF5C5C, 10, 0x66FF5C5C, 1)
        } else {
            btnTreatToggle.text = t("btn_feed_start")
            btnTreatToggle.setTextColor(0xFF0B0E15.toInt())
            btnTreatToggle.background = roundedBg(0xFFFFAE42.toInt(), 10)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun buildUi(): View {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF0B0E15.toInt())
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(28))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            KuroEventBus.postInAppImeVisibilityChanged(imeVisible)
            v.setPadding(
                dp(18) + bars.left,
                dp(16) + bars.top,
                dp(18) + bars.right,
                dp(28) + bars.bottom
            )
            insets
        }
        scroll.addView(
            root,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleCol.addView(TextView(this).apply {
            text = "🐈‍⬛ KuroCat Android"
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 23f
            typeface = Typeface.DEFAULT_BOLD
        })
        titleCol.addView(TextView(this).apply {
            text = t("subtitle")
            setTextColor(0xFF8F9DB5.toInt())
            textSize = 12.5f
            setPadding(0, dp(2), 0, 0)
        })
        header.addView(titleCol)
        header.addView(TextView(this).apply {
            text = t("skins_badge")
            setTextColor(0xFF0B0E15.toInt())
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(0xFFC8F538.toInt(), 99)
            setPadding(dp(11), dp(5), dp(11), dp(5))
        })
        root.addView(header)

        // Live Interactive Preview Card
        val previewCard = FrameLayout(this).apply {
            background = roundedBg(0xFF131824.toInt(), 20, 0x33FFFFFF, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(238)).apply {
                topMargin = dp(14)
            }
        }
        val loadingLabel = TextView(this).apply {
            text = t("waking")
            setTextColor(0xFF8F9DB5.toInt())
            textSize = 13.5f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        }
        previewCard.addView(loadingLabel)
        previewBadge = TextView(this).apply {
            text = t("preview_hint")
            setTextColor(0xFFA9B7CE.toInt())
            textSize = 11.5f
            background = roundedBg(0x9910141F.toInt(), 99, 0x26FFFFFF, 1)
            setPadding(dp(10), dp(4), dp(10), dp(4))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.START
            ).apply {
                setMargins(dp(12), dp(10), 0, 0)
            }
        }
        previewCard.addView(previewBadge)
        previewCard.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()
            val rubSlop = dp(8).toFloat()
            val rubSlopSq = rubSlop * rubSlop
            var downX = 0f
            var downY = 0f
            var downAt = 0L
            var rubbing = false
            var lastMoveJsAt = 0L
            val wv = WebView(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
                overScrollMode = View.OVER_SCROLL_NEVER
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun onTreatEnded() {
                        runOnUiThread {
                            previewTreatActive = false
                            refreshTreatUi()
                        }
                    }
                }, "KuroAndroidHost")
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest
                    ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                    override fun onPageFinished(view: WebView?, url: String?) {
                        previewReady = true
                        loadingLabel.visibility = View.GONE
                        syncPreviewJs()
                    }
                }
                loadUrl("https://appassets.androidplatform.net/assets/web/android-web.html")
                setOnTouchListener { v, ev ->
                    val w = v.width.coerceAtLeast(1).toFloat()
                    val h = v.height.coerceAtLeast(1).toFloat()
                    val nx = (ev.x / w).coerceIn(0f, 1f)
                    val ny = (ev.y / h).coerceIn(0f, 1f)
                    if (previewTreatActive) {
                        when (ev.actionMasked) {
                            MotionEvent.ACTION_DOWN -> {
                                KuroEventBus.markPetTouchDown()
                                v.parent?.requestDisallowInterceptTouchEvent(true)
                                evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setTreatPointer($nx, $ny, true);")
                                true
                            }
                            MotionEvent.ACTION_MOVE -> {
                                val now = System.currentTimeMillis()
                                if (now - lastMoveJsAt >= 24L) {
                                    lastMoveJsAt = now
                                    evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setTreatPointer($nx, $ny, true);")
                                }
                                true
                            }
                            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                                v.parent?.requestDisallowInterceptTouchEvent(false)
                                evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setTreatPointer($nx, $ny, false);")
                                true
                            }
                            else -> false
                        }
                    } else {
                        when (ev.actionMasked) {
                            MotionEvent.ACTION_DOWN -> {
                                KuroEventBus.markPetTouchDown()
                                v.parent?.requestDisallowInterceptTouchEvent(true)
                                downX = ev.x
                                downY = ev.y
                                downAt = System.currentTimeMillis()
                                rubbing = false
                                lastMoveJsAt = 0L
                                true
                            }
                            MotionEvent.ACTION_MOVE -> {
                                val dx = ev.x - downX
                                val dy = ev.y - downY
                                if (!rubbing && (dx * dx + dy * dy) >= rubSlopSq) {
                                    rubbing = true
                                }
                                if (rubbing) {
                                    val now = System.currentTimeMillis()
                                    if (now - lastMoveJsAt >= 30L) {
                                        lastMoveJsAt = now
                                        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.petMove($nx, $ny, true);")
                                    }
                                }
                                true
                            }
                            MotionEvent.ACTION_UP -> {
                                v.parent?.requestDisallowInterceptTouchEvent(false)
                                if (rubbing) {
                                    rubbing = false
                                    evalPreviewJs("window.KuroAndroid && window.KuroAndroid.petMove(-1, -1, false);")
                                } else {
                                    val dt = System.currentTimeMillis() - downAt
                                    if (dt < 450L) {
                                        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.tapAt($nx, $ny);")
                                    }
                                }
                                true
                            }
                            MotionEvent.ACTION_CANCEL -> {
                                v.parent?.requestDisallowInterceptTouchEvent(false)
                                if (rubbing) {
                                    rubbing = false
                                    evalPreviewJs("window.KuroAndroid && window.KuroAndroid.petMove(-1, -1, false);")
                                }
                                true
                            }
                            else -> false
                        }
                    }
                }
            }
            previewWebView = wv
            previewCard.addView(
                wv,
                0,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }, 120L)
        root.addView(previewCard)

        // Primary Start / Stop Floating Pet Button
        mainToggleBtn = TextView(this).apply {
            text = t("btn_start")
            gravity = Gravity.CENTER
            textSize = 16.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF0B0E15.toInt())
            background = roundedBg(0xFFC8F538.toInt(), 16)
            setPadding(dp(16), dp(15), dp(16), dp(15))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(14)
            }
            setOnClickListener { onClickMainToggle() }
        }
        root.addView(mainToggleBtn)

        // 2-Step Permission Setup Card
        val permCard = makeCard(root, t("card_perms"))
        val (ovBadge, ovBtn) = addPermissionRow(
            permCard,
            t("perm_overlay_title"),
            t("perm_overlay_desc"),
            t("btn_enable")
        ) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
        overlayStatusBadge = ovBadge
        overlayPermBtn = ovBtn

        addDivider(permCard)

        val (a11yBadge, a11yBtn) = addPermissionRow(
            permCard,
            t("perm_a11y_title"),
            t("perm_a11y_desc"),
            t("btn_enable")
        ) {
            Toast.makeText(this, t("toast_a11y_guide"), Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        a11yStatusBadge = a11yBadge
        a11yPermBtn = a11yBtn

        // Skin, Render Mode, Collar & Treat Feeding Card
        val skinCard = makeCard(root, t("card_skin"))
        val skinScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
        }
        val skinRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        KuroPrefs.SKINS.forEachIndexed { idx, skin ->
            val btn = TextView(this).apply {
                text = "${skin.emoji} ${KuroI18n.skinName(this@MainActivity, skin.id)}"
                textSize = 13.5f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(14), dp(9), dp(14), dp(9))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    if (idx > 0) leftMargin = dp(8)
                }
                setOnClickListener {
                    KuroPrefs.setBreed(this@MainActivity, skin.id)
                    if (skin.id == "dafeiyu" && previewTreatActive) {
                        stopPreviewTreat()
                    }
                    KuroEventBus.postSettingsChanged()
                    refreshAllUi()
                }
            }
            skinButtons[skin.id] = btn
            skinRow.addView(btn)
        }
        skinScroll.addView(skinRow)
        skinCard.addView(skinScroll)

        addSubLabel(skinCard, t("label_render"))
        val renderRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        btnRender3d = makeSegButton(t("render_3d")) {
            KuroPrefs.setRenderMode(this, "3d")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnRender3dFlat = makeSegButton(t("render_3d_flat")) {
            KuroPrefs.setRenderMode(this, "3d-flat")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnRender2d = makeSegButton(t("render_2d")) {
            KuroPrefs.setRenderMode(this, "2d")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        renderRow.addView(btnRender3d)
        renderRow.addView(btnRender3dFlat)
        renderRow.addView(btnRender2d)
        skinCard.addView(renderRow)

        addSubLabel(skinCard, t("label_collar"))
        val collarRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        listOf(
            "none" to t("collar_none"),
            "red" to t("collar_red"),
            "blue" to t("collar_blue"),
            "pink" to t("collar_pink"),
            "green" to t("collar_green")
        ).forEach { (id, label) ->
            val b = makeSegButton(label) {
                KuroPrefs.setCollarColor(this, id)
                KuroEventBus.postSettingsChanged()
                refreshAllUi()
            }
            collarButtons[id] = b
            collarRow.addView(b)
        }
        skinCard.addView(collarRow)

        addSubLabel(skinCard, t("label_treat"))
        val treatRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        listOf(
            "tuna" to t("treat_tuna"),
            "salmon" to t("treat_salmon"),
            "chicken" to t("treat_chicken")
        ).forEach { (flavor, label) ->
            val b = makeSegButton(label) {
                KuroPrefs.setTreatFlavor(this, flavor)
                if (previewTreatActive) {
                    startPreviewTreat()
                }
                refreshAllUi()
            }
            treatFlavorButtons[flavor] = b
            treatRow.addView(b)
        }
        btnTreatToggle = TextView(this).apply {
            text = t("btn_feed_start")
            gravity = Gravity.CENTER
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(11), dp(9), dp(11), dp(9))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(6) }
            setOnClickListener {
                if (previewTreatActive) stopPreviewTreat() else startPreviewTreat()
            }
        }
        treatRow.addView(btnTreatToggle)
        skinCard.addView(treatRow)

        // Keyboard Layout & Scale Card
        val styleCard = makeCard(root, t("card_style"))

        val kbRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        btnLayout65 = makeSegButton(t("kb_65")) {
            KuroPrefs.setLayout(this, "65")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnLayout98 = makeSegButton(t("kb_98")) {
            KuroPrefs.setLayout(this, "98")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnLayout108 = makeSegButton(t("kb_108")) {
            KuroPrefs.setLayout(this, "108")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnLayoutMac = makeSegButton(t("kb_mac")) {
            KuroPrefs.setLayout(this, "macbook")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        kbRow.addView(btnLayout65)
        kbRow.addView(btnLayout98)
        kbRow.addView(btnLayout108)
        kbRow.addView(btnLayoutMac)
        styleCard.addView(kbRow)

        val orientRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        btnOrientCat = makeSegButton(t("orient_cat")) {
            KuroPrefs.setOrientation(this, "cat")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnOrientViewer = makeSegButton(t("orient_viewer")) {
            KuroPrefs.setOrientation(this, "viewer")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        orientRow.addView(btnOrientCat)
        orientRow.addView(btnOrientViewer)
        styleCard.addView(orientRow)

        addSubLabel(styleCard, t("label_tail"))
        val tailSegRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        btnTailSmart = makeSegButton(t("tail_smart")) {
            KuroPrefs.setTailKeyMode(this, "smart")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnTailEdge = makeSegButton(t("tail_edge")) {
            KuroPrefs.setTailKeyMode(this, "edge")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnTailOff = makeSegButton(t("tail_off")) {
            KuroPrefs.setTailKeyMode(this, "off")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        tailSegRow.addView(btnTailSmart)
        tailSegRow.addView(btnTailEdge)
        tailSegRow.addView(btnTailOff)
        styleCard.addView(tailSegRow)

        val scaleHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(16) }
        }
        scaleHeader.addView(TextView(this).apply {
            text = t("label_scale")
            setTextColor(0xFFE6ECF7.toInt())
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        scaleValueText = TextView(this).apply {
            text = "78%"
            setTextColor(0xFFC8F538.toInt())
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(0x16C8F538, 8)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            setOnClickListener {
                KuroPrefs.setScale(this@MainActivity, 0.78f)
                KuroEventBus.postSettingsChanged()
                refreshAllUi()
                Toast.makeText(this@MainActivity, t("toast_scale_reset"), Toast.LENGTH_SHORT).show()
            }
        }
        scaleHeader.addView(scaleValueText)
        styleCard.addView(scaleHeader)

        scaleSeekBar = SeekBar(this).apply {
            max = 105
            progress = (KuroPrefs.getScale(this@MainActivity) * 100).roundToInt() - 35
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(6) }
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    val pct = (progress + 35).coerceIn(35, 140)
                    scaleValueText.text = "$pct%"
                    if (fromUser) {
                        KuroPrefs.setScale(this@MainActivity, pct / 100f)
                        KuroEventBus.postSettingsChanged()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        styleCard.addView(scaleSeekBar)

        val opacityHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(12) }
        }
        opacityHeader.addView(TextView(this).apply {
            text = t("label_opacity")
            setTextColor(0xFFE6ECF7.toInt())
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        opacityValueText = TextView(this).apply {
            text = "100%"
            setTextColor(0xFFC8F538.toInt())
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(0x16C8F538, 8)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            setOnClickListener {
                KuroPrefs.setOpacity(this@MainActivity, 1.0f)
                KuroEventBus.postSettingsChanged()
                refreshAllUi()
                Toast.makeText(this@MainActivity, t("toast_opacity_reset"), Toast.LENGTH_SHORT).show()
            }
        }
        opacityHeader.addView(opacityValueText)
        styleCard.addView(opacityHeader)

        opacitySeekBar = SeekBar(this).apply {
            max = 80
            progress = (KuroPrefs.getOpacity(this@MainActivity) * 100).roundToInt() - 20
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(6) }
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    val pct = (progress + 20).coerceIn(20, 100)
                    opacityValueText.text = "$pct%"
                    if (fromUser) {
                        KuroPrefs.setOpacity(this@MainActivity, pct / 100f)
                        KuroEventBus.postSettingsChanged()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        styleCard.addView(opacitySeekBar)

        val resetPosRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(12) }
        }
        resetPosRow.addView(TextView(this).apply {
            text = t("label_reset_pos")
            setTextColor(0xFF8C9AB3.toInt())
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(8)
            }
        })
        resetPosRow.addView(TextView(this).apply {
            text = t("btn_reset_pos")
            setTextColor(0xFFDCE4F2.toInt())
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(0x18FFFFFF, 10, 0x26FFFFFF, 1)
            setPadding(dp(12), dp(7), dp(12), dp(7))
            setOnClickListener {
                KuroPrefs.clearOverlayPos(this@MainActivity)
                if (KuroEventBus.overlayRunning.get()) {
                    val intent = Intent(this@MainActivity, KuroOverlayService::class.java)
                        .setAction(KuroOverlayService.ACTION_RESET_POS)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent)
                    } else {
                        startService(intent)
                    }
                }
                Toast.makeText(this@MainActivity, t("toast_pos_reset"), Toast.LENGTH_SHORT).show()
            }
        })
        styleCard.addView(resetPosRow)

        // Switches & Peripherals Card
        val switchCard = makeCard(root, t("card_switches"))
        swHandover = addSwitchRow(
            switchCard,
            t("sw_handover_title"),
            t("sw_handover_desc")
        ) { checked ->
            KuroPrefs.setLaoWuHandoverEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swTouchThrough = addSwitchRow(
            switchCard,
            t("sw_lock_title"),
            t("sw_lock_desc")
        ) { checked ->
            KuroPrefs.setTouchThroughLocked(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swPrivacy = addSwitchRow(
            switchCard,
            t("sw_privacy_title"),
            t("sw_privacy_desc")
        ) { checked ->
            KuroPrefs.setPrivacyGuardEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swBubbles = addSwitchRow(
            switchCard,
            t("sw_bubbles_title"),
            t("sw_bubbles_desc")
        ) { checked ->
            KuroPrefs.setShowKeyBubbles(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swShowMouse = addSwitchRow(
            switchCard,
            t("sw_mouse_title"),
            t("sw_mouse_desc")
        ) { checked ->
            KuroPrefs.setShowMouse(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swSound = addSwitchRow(
            switchCard,
            t("sw_sound_title"),
            t("sw_sound_desc")
        ) { checked ->
            KuroPrefs.setSoundEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swTypingSound = addSwitchRow(
            switchCard,
            t("sw_typing_title"),
            t("sw_typing_desc")
        ) { checked ->
            KuroPrefs.setTypingSoundEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swHeadphones = addSwitchRow(
            switchCard,
            t("sw_headphones_title"),
            t("sw_headphones_desc")
        ) { checked ->
            KuroPrefs.setHeadphonesEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        addSubLabel(switchCard, t("label_gamepad"), topMarginDp = 2)
        val gpRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        btnGpAuto = makeSegButton(t("gp_auto")) {
            KuroPrefs.setGamepadMode(this, "auto")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnGpOn = makeSegButton(t("gp_on")) {
            KuroPrefs.setGamepadMode(this, "on")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnGpOff = makeSegButton(t("gp_off")) {
            KuroPrefs.setGamepadMode(this, "off")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        gpRow.addView(btnGpAuto)
        gpRow.addView(btnGpOn)
        gpRow.addView(btnGpOff)
        switchCard.addView(gpRow)
        addDivider(switchCard)
        swTablet = addSwitchRow(
            switchCard,
            t("sw_tablet_title"),
            t("sw_tablet_desc")
        ) { checked ->
            KuroPrefs.setTabletEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swFpsEco = addSwitchRow(
            switchCard,
            t("sw_fps_title"),
            t("sw_fps_desc")
        ) { checked ->
            KuroPrefs.setFpsCap(this, if (checked) 30 else 0)
            KuroEventBus.postSettingsChanged()
        }

        // 9-Language Selector Card
        val langCard = makeCard(root, t("card_lang"))
        val langScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
        }
        val langRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        KuroI18n.LANG_OPTIONS.forEachIndexed { idx, opt ->
            val btn = TextView(this).apply {
                text = opt.label
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(12), dp(8), dp(12), dp(8))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    if (idx > 0) leftMargin = dp(6)
                }
                setOnClickListener {
                    if (KuroPrefs.getLanguage(this@MainActivity) != opt.code) {
                        KuroPrefs.setLanguage(this@MainActivity, opt.code)
                        KuroEventBus.postSettingsChanged()
                        recreate()
                    }
                }
            }
            langButtons[opt.code] = btn
            langRow.addView(btn)
        }
        langScroll.addView(langRow)
        langCard.addView(langScroll)

        // Built-in Live Test Card
        val testCard = makeCard(root, t("card_test"))
        val normalInput = EditText(this).apply {
            hint = t("hint_normal")
            setHintTextColor(0xFF6B7791.toInt())
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 13.5f
            background = roundedBg(0xFF0D111A.toInt(), 12, 0x2EFFFFFF, 1)
            setPadding(dp(12), dp(11), dp(12), dp(11))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    inAppPrivacyActive = false
                    KuroEventBus.postPrivacyChanged(false)
                    if (count == 0 && before > 0) {
                        KuroEventBus.postTypingBurst(1, "delete")
                    } else if (count > 0) {
                        val sinceSensor = System.currentTimeMillis() - KuroEventBus.lastImeSensorEmitMs
                        if (count > 3 || sinceSensor >= 135L) {
                            KuroEventBus.postTypingBurst(count.coerceAtMost(3), "char")
                        }
                    }
                }
                override fun afterTextChanged(s: Editable?) {}
            })
            setOnFocusChangeListener { _, hasFocus ->
                if (hasFocus) {
                    inAppPrivacyActive = false
                    KuroEventBus.postPrivacyChanged(false)
                }
            }
        }
        testCard.addView(normalInput)

        val pwdInput = EditText(this).apply {
            hint = t("hint_pwd")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setHintTextColor(0xFF6B7791.toInt())
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 13.5f
            background = roundedBg(0xFF0D111A.toInt(), 12, 0x33FFD859, 1)
            setPadding(dp(12), dp(11), dp(12), dp(11))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
            setOnFocusChangeListener { _, hasFocus ->
                inAppPrivacyActive = hasFocus
                KuroEventBus.postPrivacyChanged(hasFocus && KuroPrefs.isPrivacyGuardEnabled(this@MainActivity))
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (KuroPrefs.isPrivacyGuardEnabled(this@MainActivity)) {
                        inAppPrivacyActive = true
                        KuroEventBus.postPrivacyChanged(true)
                        KuroEventBus.postPrivacyTyping()
                    }
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        testCard.addView(pwdInput)

        // Footer Tip
        root.addView(TextView(this).apply {
            text = t("footer")
            gravity = Gravity.CENTER
            setTextColor(0xFF6F7B94.toInt())
            textSize = 11.5f
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(0, dp(16), 0, dp(6))
        })

        return scroll
    }

    private fun addSubLabel(parent: LinearLayout, label: String, topMarginDp: Int = 14) {
        parent.addView(TextView(this).apply {
            text = label
            setTextColor(0xFFE6ECF7.toInt())
            textSize = 13.5f
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(topMarginDp) }
        })
    }

    private fun makeCard(parent: LinearLayout, title: String): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg(0xFF141926.toInt(), 18, 0x22FFFFFF, 1)
            setPadding(dp(15), dp(14), dp(15), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(14) }
        }
        card.addView(TextView(this).apply {
            text = title
            setTextColor(0xFF9FB0CB.toInt())
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(10))
        })
        parent.addView(card)
        return card
    }

    private fun addDivider(parent: LinearLayout) {
        parent.addView(View(this).apply {
            setBackgroundColor(0x18FFFFFF)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(10)
                bottomMargin = dp(10)
            }
        })
    }

    private fun addPermissionRow(
        parent: LinearLayout,
        title: String,
        desc: String,
        btnText: String,
        onClick: () -> Unit
    ): Pair<TextView, TextView> {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(10)
            }
        }
        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(TextView(this).apply {
            text = title
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 14.5f
            typeface = Typeface.DEFAULT_BOLD
        })
        val badge = TextView(this).apply {
            text = t("badge_disabled")
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(7), dp(2), dp(7), dp(2))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(8) }
        }
        titleRow.addView(badge)
        col.addView(titleRow)
        col.addView(TextView(this).apply {
            text = desc
            setTextColor(0xFF8C9AB3.toInt())
            textSize = 12f
            setPadding(0, dp(3), 0, 0)
        })
        row.addView(col)

        val btn = TextView(this).apply {
            text = btnText
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(12), dp(7), dp(12), dp(7))
            setOnClickListener { onClick() }
        }
        row.addView(btn)
        parent.addView(row)
        return badge to btn
    }

    private fun makeSegButton(label: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(6), dp(9), dp(6), dp(9))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(dp(2), 0, dp(2), 0)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun addSwitchRow(
        parent: LinearLayout,
        title: String,
        desc: String,
        onToggle: (Boolean) -> Unit
    ): SwitchCompat {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(10)
            }
        }
        col.addView(TextView(this).apply {
            text = title
            setTextColor(0xFFF0F4FA.toInt())
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
        })
        col.addView(TextView(this).apply {
            text = desc
            setTextColor(0xFF8795AE.toInt())
            textSize = 11.5f
            setPadding(0, dp(2), 0, 0)
        })
        row.addView(col)

        val sw = SwitchCompat(this).apply {
            setOnCheckedChangeListener { _, isChecked ->
                if (!updatingUi) onToggle(isChecked)
            }
        }
        row.addView(sw)
        parent.addView(row)
        return sw
    }

    private fun onClickMainToggle() {
        val running = KuroEventBus.overlayRunning.get()
        val canDraw = Settings.canDrawOverlays(this)
        if (running) {
            KuroOverlayService.stop(this)
            refreshAllUi()
            return
        }
        if (!canDraw) {
            Toast.makeText(this, t("toast_need_overlay"), Toast.LENGTH_SHORT).show()
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
            return
        }
        KuroOverlayService.start(this)
        refreshAllUi()
    }

    private fun refreshAllUi() {
        updatingUi = true
        try {
            val hasOverlay = Settings.canDrawOverlays(this)
            val hasA11y = isAccessibilityEnabled()
            val running = KuroEventBus.overlayRunning.get()

            if (hasOverlay) {
                overlayStatusBadge.text = t("badge_enabled")
                overlayStatusBadge.setTextColor(0xFF0B0E15.toInt())
                overlayStatusBadge.background = roundedBg(0xFFC8F538.toInt(), 99)
                overlayPermBtn.text = t("btn_ready")
                overlayPermBtn.setTextColor(0xFF9AA8C0.toInt())
                overlayPermBtn.background = roundedBg(0x18FFFFFF, 10)
            } else {
                overlayStatusBadge.text = t("badge_required")
                overlayStatusBadge.setTextColor(0xFFFFD859.toInt())
                overlayStatusBadge.background = roundedBg(0x26FFD859, 99)
                overlayPermBtn.text = t("btn_enable")
                overlayPermBtn.setTextColor(0xFF0B0E15.toInt())
                overlayPermBtn.background = roundedBg(0xFFC8F538.toInt(), 10)
            }

            if (hasA11y) {
                a11yStatusBadge.text = t("badge_enabled")
                a11yStatusBadge.setTextColor(0xFF0B0E15.toInt())
                a11yStatusBadge.background = roundedBg(0xFF5CC8FF.toInt(), 99)
                a11yPermBtn.text = t("btn_ready")
                a11yPermBtn.setTextColor(0xFF9AA8C0.toInt())
                a11yPermBtn.background = roundedBg(0x18FFFFFF, 10)
            } else {
                a11yStatusBadge.text = t("badge_disabled")
                a11yStatusBadge.setTextColor(0xFF9AA8C0.toInt())
                a11yStatusBadge.background = roundedBg(0x1AFFFFFF, 99)
                a11yPermBtn.text = t("btn_enable")
                a11yPermBtn.setTextColor(0xFF0B0E15.toInt())
                a11yPermBtn.background = roundedBg(0xFF5CC8FF.toInt(), 10)
            }

            if (running) {
                mainToggleBtn.text = t("btn_stop")
                mainToggleBtn.setTextColor(0xFFFF9696.toInt())
                mainToggleBtn.background = roundedBg(0x2BFF5C5C, 16, 0x66FF5C5C, 1)
            } else {
                mainToggleBtn.text = t("btn_start")
                mainToggleBtn.setTextColor(0xFF0B0E15.toInt())
                mainToggleBtn.background = roundedBg(0xFFC8F538.toInt(), 16)
            }

            val curBreed = KuroPrefs.getBreed(this)
            KuroPrefs.SKINS.forEach { skin ->
                val tv = skinButtons[skin.id] ?: return@forEach
                if (skin.id == curBreed) {
                    tv.setTextColor(0xFF0B0E15.toInt())
                    tv.background = roundedBg(skin.accentHex, 12)
                } else {
                    tv.setTextColor(0xFFDCE4F2.toInt())
                    tv.background = roundedBg(0x14FFFFFF, 12, 0x22FFFFFF, 1)
                }
            }

            val curRender = KuroPrefs.getRenderMode(this)
            styleSeg(btnRender3d, curRender == "3d")
            styleSeg(btnRender3dFlat, curRender == "3d-flat")
            styleSeg(btnRender2d, curRender == "2d")

            val curCollar = KuroPrefs.getCollarColor(this)
            collarButtons.forEach { (id, tv) -> styleSeg(tv, id == curCollar) }

            val curTreat = KuroPrefs.getTreatFlavor(this)
            treatFlavorButtons.forEach { (flavor, tv) -> styleSeg(tv, flavor == curTreat) }
            refreshTreatUi()

            val curLayout = KuroPrefs.getLayout(this)
            styleSeg(btnLayout65, curLayout == "65")
            styleSeg(btnLayout98, curLayout == "98")
            styleSeg(btnLayout108, curLayout == "108")
            styleSeg(btnLayoutMac, curLayout == "macbook")

            val isViewer = KuroPrefs.getOrientation(this) == "viewer"
            styleSeg(btnOrientCat, !isViewer)
            styleSeg(btnOrientViewer, isViewer)

            val tailMode = KuroPrefs.getTailKeyMode(this)
            styleSeg(btnTailSmart, tailMode == "smart")
            styleSeg(btnTailEdge, tailMode == "edge")
            styleSeg(btnTailOff, tailMode == "off")

            val gpMode = KuroPrefs.getGamepadMode(this)
            styleSeg(btnGpAuto, gpMode == "auto")
            styleSeg(btnGpOn, gpMode == "on")
            styleSeg(btnGpOff, gpMode == "off")

            val curLang = KuroPrefs.getLanguage(this)
            langButtons.forEach { (code, tv) ->
                if (code == curLang) {
                    tv.setTextColor(0xFF0B0E15.toInt())
                    tv.background = roundedBg(0xFFC8F538.toInt(), 10)
                } else {
                    tv.setTextColor(0xFFD1DAEB.toInt())
                    tv.background = roundedBg(0x14FFFFFF, 10)
                }
            }

            val pct = (KuroPrefs.getScale(this) * 100).roundToInt()
            scaleValueText.text = "$pct%"
            if (scaleSeekBar.progress != pct - 35) {
                scaleSeekBar.progress = (pct - 35).coerceIn(0, 105)
            }

            val opacityPct = (KuroPrefs.getOpacity(this) * 100).roundToInt().coerceIn(20, 100)
            opacityValueText.text = "$opacityPct%"
            if (opacitySeekBar.progress != opacityPct - 20) {
                opacitySeekBar.progress = (opacityPct - 20).coerceIn(0, 80)
            }

            if (swHandover.isChecked != KuroPrefs.isLaoWuHandoverEnabled(this)) {
                swHandover.isChecked = KuroPrefs.isLaoWuHandoverEnabled(this)
            }
            if (swTouchThrough.isChecked != KuroPrefs.isTouchThroughLocked(this)) {
                swTouchThrough.isChecked = KuroPrefs.isTouchThroughLocked(this)
            }
            if (swPrivacy.isChecked != KuroPrefs.isPrivacyGuardEnabled(this)) {
                swPrivacy.isChecked = KuroPrefs.isPrivacyGuardEnabled(this)
            }
            if (swBubbles.isChecked != KuroPrefs.isShowKeyBubbles(this)) {
                swBubbles.isChecked = KuroPrefs.isShowKeyBubbles(this)
            }
            if (swShowMouse.isChecked != KuroPrefs.isShowMouse(this)) {
                swShowMouse.isChecked = KuroPrefs.isShowMouse(this)
            }
            if (swSound.isChecked != KuroPrefs.isSoundEnabled(this)) {
                swSound.isChecked = KuroPrefs.isSoundEnabled(this)
            }
            if (swTypingSound.isChecked != KuroPrefs.isTypingSoundEnabled(this)) {
                swTypingSound.isChecked = KuroPrefs.isTypingSoundEnabled(this)
            }
            if (swHeadphones.isChecked != KuroPrefs.isHeadphonesEnabled(this)) {
                swHeadphones.isChecked = KuroPrefs.isHeadphonesEnabled(this)
            }
            if (swTablet.isChecked != KuroPrefs.isTabletEnabled(this)) {
                swTablet.isChecked = KuroPrefs.isTabletEnabled(this)
            }
            val fpsEco = KuroPrefs.getFpsCap(this) == 30
            if (swFpsEco.isChecked != fpsEco) {
                swFpsEco.isChecked = fpsEco
            }
        } finally {
            updatingUi = false
        }

        syncPreviewJs()
    }

    private fun styleSeg(tv: TextView, active: Boolean) {
        if (active) {
            tv.setTextColor(0xFF0B0E15.toInt())
            tv.background = roundedBg(0xFFC8F538.toInt(), 10)
        } else {
            tv.setTextColor(0xFFD1DAEB.toInt())
            tv.background = roundedBg(0x14FFFFFF, 10)
        }
    }

    private fun evalPreviewJs(script: String) {
        if (!previewReady) return
        previewWebView?.evaluateJavascript(script, null)
    }

    private fun syncPreviewJs() {
        val json = KuroPrefs.toJsJson(
            this,
            privacyActive = inAppPrivacyActive || KuroEventBus.privacyActive.get(),
            audioMuted = KuroEventBus.overlayRunning.get()
        )
        val escaped = JSONObject.quote(json)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setSettings($escaped);")
    }

    override fun onTypingBurst(count: Int, kind: String) {
        val safeKind = JSONObject.quote(kind)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onTypingBurst($count, $safeKind);")
    }

    override fun onHardwareKey(vk: Int, isDown: Boolean, repeat: Boolean) {
        if (isDown) {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onKeyDown($vk, $repeat);")
        } else {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onKeyUp($vk);")
        }
    }

    override fun onGamepadState(json: String) {
        val escaped = JSONObject.quote(json)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onGamepadState($escaped);")
    }

    override fun onPrivacyChanged(active: Boolean) {
        val effective = active && KuroPrefs.isPrivacyGuardEnabled(this)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setPrivacyMode($effective);")
    }

    override fun onPrivacyTyping() {
        if (KuroPrefs.isPrivacyGuardEnabled(this)) {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onPrivacyTyping();")
        }
    }

    override fun onSettingsChanged() {
        refreshAllUi()
    }

    override fun onOverlayStateChanged(running: Boolean) {
        refreshAllUi()
    }
}
