package com.idleballs.pocket;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.DisplayCutout;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Offline WebGL scene driven by native, display-aware gravity. */
public final class MainActivity extends Activity implements SensorEventListener,
        DisplayManager.DisplayListener {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/assets/index.html";
    private static final long DELIVERY_INTERVAL_NS = 16_000_000L;
    private static final int MAX_STATE_LENGTH = 512 * 1024;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final float[] filteredSensor = new float[3];
    private final float[] screenGravity = new float[3];
    private FrameLayout container;
    private WebView webView;
    private SharedPreferences preferences;
    private SensorManager sensorManager;
    private DisplayManager displayManager;
    private Sensor gravitySensor;
    private boolean accelerometerFallback, resumed, webReady, sensorRegistered;
    private boolean initializedSensor, gravityEvaluationInFlight;
    private long previousSensorTime, lastDeliveryTime;
    private int rendererRecoveryCount;
    private int insetTop, insetRight, insetBottom, insetLeft;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("pocket-state", MODE_PRIVATE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (sensorManager != null) {
            gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (gravitySensor == null) {
                gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
                accelerometerFallback = gravitySensor != null;
            }
        }
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(233, 231, 226));
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            updateInsets(insets);
            return insets; // Full-bleed scene; JS applies safe areas only to controls.
        });
        setContentView(container);
        configureWindow();
        createWebView();
        if (displayManager != null) displayManager.registerDisplayListener(this, mainHandler);
    }

    private void configureWindow() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        hideSystemBars();
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        container.requestApplyInsets();
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void createWebView() {
        webReady = false;
        gravityEvaluationInFlight = false;
        WebView created = new WebView(this);
        webView = created;
        created.setBackgroundColor(Color.rgb(233, 231, 226));
        created.setOverScrollMode(View.OVER_SCROLL_NEVER);
        created.setVerticalScrollBarEnabled(false);
        created.setHorizontalScrollBarEnabled(false);
        WebSettings settings = created.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(true);
        created.addJavascriptInterface(new NativeBridge(), "AndroidPocket");
        created.setWebChromeClient(new WebChromeClient());
        created.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,
                    WebResourceRequest request) {
                return !isLocalAsset(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isLocalAsset(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,
                    WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view == webView && START_URL.equals(url)) {
                    sendInsets();
                    sendVisibility();
                }
            }
            @Override public boolean onRenderProcessGone(WebView view,
                    RenderProcessGoneDetail detail) {
                if (view != webView) return true;
                webReady = false;
                container.removeView(view);
                view.destroy();
                webView = null;
                if (!isFinishing() && rendererRecoveryCount++ == 0) {
                    mainHandler.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            createWebView();
                            if (!resumed) webView.onPause();
                        }
                    });
                } else showLoadFailure();
                return true;
            }
        });
        container.addView(created, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        created.loadUrl(START_URL);
    }

    private static boolean isLocalAsset(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && ASSET_HOST.equals(uri.getHost())
            && uri.getPort() == -1 && path != null && path.startsWith("/assets/")
            && !path.contains("..") && !path.contains("\\")
            && path.matches("/assets/[A-Za-z0-9_./-]+");
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (!isLocalAsset(uri)) return errorResponse(403, "Forbidden");
        String file = uri.getPath().substring("/assets/".length());
        try {
            InputStream stream = getAssets().open(file);
            String mime = file.endsWith(".js") ? "application/javascript"
                : file.endsWith(".css") ? "text/css"
                : file.endsWith(".png") ? "image/png"
                : file.endsWith(".jpg") ? "image/jpeg"
                : file.endsWith(".svg") ? "image/svg+xml"
                : file.endsWith(".json") ? "application/json"
                : file.endsWith(".html") ? "text/html" : "application/octet-stream";
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self' data: blob:; "
                + "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                + "img-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; "
                + "object-src 'none'; base-uri 'none'");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
        } catch (IOException missing) { return errorResponse(404, "Not Found"); }
    }

    private static WebResourceResponse errorResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            new HashMap<>(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private void showLoadFailure() {
        if (isFinishing() || isDestroyed()) return;
        TextView message = new TextView(this);
        message.setText("画面暂时无法加载\n请关闭球屿后重新打开");
        message.setTextColor(Color.rgb(62, 70, 65));
        message.setTextSize(18);
        message.setGravity(android.view.Gravity.CENTER);
        container.addView(message, new FrameLayout.LayoutParams(-1, -1));
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) webView.onResume();
        initializedSensor = false;
        previousSensorTime = 0;
        lastDeliveryTime = 0;
        if (sensorManager != null && gravitySensor != null)
            sensorRegistered = sensorManager.registerListener(this, gravitySensor,
                16_667, 0, mainHandler);
        hideSystemBars();
        sendSensorStatus();
        sendVisibility();
    }

    @Override protected void onPause() {
        resumed = false;
        if (sensorManager != null) sensorManager.unregisterListener(this);
        sensorRegistered = false;
        sendVisibility();
        requestStateSave();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        requestStateSave();
        super.onSaveInstanceState(state);
    }

    private void requestStateSave() {
        evaluate("if(window.PocketNative&&PocketNative.onSaveRequested)PocketNative.onSaveRequested();");
    }

    @Override protected void onDestroy() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (displayManager != null) displayManager.unregisterDisplayListener(this);
        mainHandler.removeCallbacksAndMessages(null);
        if (webView != null) {
            container.removeView(webView);
            webView.removeJavascriptInterface("AndroidPocket");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Retain WebView/context, ball state and menu through fold/rotation/density changes.
        configureWindow();
        container.post(this::notifyDisplayChanged);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }
    @Override public void onDisplayAdded(int displayId) { notifyDisplayChanged(); }
    @Override public void onDisplayRemoved(int displayId) { notifyDisplayChanged(); }
    @Override public void onDisplayChanged(int displayId) { notifyDisplayChanged(); }

    private void notifyDisplayChanged() {
        if (webView == null) return;
        container.requestApplyInsets();
        sendInsets();
        evaluate("window.dispatchEvent(new Event('resize'));");
        if (initializedSensor) {
            GravityMapper.toScreen(filteredSensor[0], filteredSensor[1], filteredSensor[2],
                currentRotation(), screenGravity);
            sendGravity();
        }
    }

    private int currentRotation() {
        Display display = webView != null ? webView.getDisplay() : container.getDisplay();
        return display == null ? Surface.ROTATION_0 : display.getRotation();
    }

    @Override public void onSensorChanged(SensorEvent event) {
        if (!resumed || event.values.length < 3) return;
        for (int i = 0; i < 3; i++) if (!Float.isFinite(event.values[i])) return;
        if (!initializedSensor) {
            System.arraycopy(event.values, 0, filteredSensor, 0, 3);
            initializedSensor = true;
        } else if (accelerometerFallback) {
            double dt = Math.min(0.1, Math.max(0.001,
                (event.timestamp - previousSensorTime) / 1_000_000_000.0));
            float alpha = (float) (1.0 - Math.exp(-dt / 0.18));
            for (int i = 0; i < 3; i++)
                filteredSensor[i] += alpha * (event.values[i] - filteredSensor[i]);
        } else System.arraycopy(event.values, 0, filteredSensor, 0, 3);
        previousSensorTime = event.timestamp;
        GravityMapper.toScreen(filteredSensor[0], filteredSensor[1], filteredSensor[2],
            currentRotation(), screenGravity);
        if (event.timestamp - lastDeliveryTime >= DELIVERY_INTERVAL_NS) {
            lastDeliveryTime = event.timestamp;
            sendGravity();
        }
    }

    private void sendGravity() {
        if (!webReady || !resumed || webView == null || gravityEvaluationInFlight) return;
        final WebView target = webView;
        gravityEvaluationInFlight = true;
        String js = "if(window.PocketNative&&PocketNative.onGravity)PocketNative.onGravity("
            + screenGravity[0] + "," + screenGravity[1] + "," + screenGravity[2] + ");";
        target.evaluateJavascript(js, ignored -> {
            if (webView == target) gravityEvaluationInFlight = false;
        });
    }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private void updateInsets(WindowInsets windowInsets) {
        if (Build.VERSION.SDK_INT >= 30) {
            Insets system = windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()
                | WindowInsets.Type.displayCutout());
            insetTop = system.top; insetRight = system.right;
            insetBottom = system.bottom; insetLeft = system.left;
        } else {
            insetTop = windowInsets.getStableInsetTop();
            insetRight = windowInsets.getStableInsetRight();
            insetBottom = windowInsets.getStableInsetBottom();
            insetLeft = windowInsets.getStableInsetLeft();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = windowInsets.getDisplayCutout();
                if (cutout != null) {
                    insetTop = Math.max(insetTop, cutout.getSafeInsetTop());
                    insetRight = Math.max(insetRight, cutout.getSafeInsetRight());
                    insetBottom = Math.max(insetBottom, cutout.getSafeInsetBottom());
                    insetLeft = Math.max(insetLeft, cutout.getSafeInsetLeft());
                }
            }
        }
        sendInsets();
    }

    private void sendInsets() {
        // DPR is read in the WebView so inner/cover density changes remain correct.
        evaluate("if(window.PocketNative&&PocketNative.onInsets){var d=window.devicePixelRatio||1;"
            + "PocketNative.onInsets(" + insetTop + "/d," + insetRight + "/d,"
            + insetBottom + "/d," + insetLeft + "/d);}");
    }
    private void sendVisibility() {
        evaluate("if(window.PocketNative&&PocketNative.onVisibility)PocketNative.onVisibility("
            + resumed + ");");
    }
    private void sendSensorStatus() {
        String mode = gravitySensor == null ? "unavailable"
            : accelerometerFallback ? "accelerometer" : "gravity";
        evaluate("if(window.PocketNative&&PocketNative.onSensorStatus)PocketNative.onSensorStatus({"
            + "available:" + (gravitySensor != null) + ",active:" + sensorRegistered
            + ",type:'" + mode + "'});");
    }
    private void evaluate(String javascript) {
        if (webView != null && !isDestroyed()) webView.evaluateJavascript(javascript, null);
    }

    @Override public void onBackPressed() {
        if (webView == null || !webReady) { super.onBackPressed(); return; }
        webView.evaluateJavascript("Boolean(window.PocketNative&&PocketNative.onBackPressed"
            + "&&PocketNative.onBackPressed())", handled -> {
                if (!"true".equals(handled) && !isFinishing()) finish();
            });
    }

    /** Exposed only to bundled assets; document navigation is restricted above. */
    public final class NativeBridge {
        @JavascriptInterface public void ready() {
            mainHandler.post(() -> {
                if (webView == null || isDestroyed()) return;
                webReady = true;
                sendSensorStatus(); sendInsets(); sendVisibility();
                if (initializedSensor) sendGravity();
            });
        }
        @JavascriptInterface public void saveState(String json) {
            if (json == null || json.length() > MAX_STATE_LENGTH) return;
            try {
                new JSONObject(json);
                preferences.edit().putString("scene", json).apply();
            } catch (JSONException ignored) { }
        }
        @JavascriptInterface public String loadState() {
            return preferences.getString("scene", "{}");
        }
        @JavascriptInterface public String versionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {
                return "0.1.0";
            }
        }
        @JavascriptInterface public boolean isSensorAvailable() { return gravitySensor != null; }
        @JavascriptInterface public String sensorType() {
            return gravitySensor == null ? "unavailable"
                : accelerometerFallback ? "accelerometer" : "gravity";
        }
    }
}
