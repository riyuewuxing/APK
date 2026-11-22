package com.riyuewuxing.touzizhuanjia;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @SuppressLint("JavascriptInterface")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        applySystemBarColors("#050811", false);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new AndroidThemeBridge(), "AndroidThemeBridge");
        }
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarColors(String hexColor, boolean isLightBackground) {
        try {
            String safeHex = (hexColor != null && !hexColor.trim().isEmpty()) ? hexColor.trim() : "#050811";
            int color = Color.parseColor(safeHex);
            Window window = getWindow();
            if (window == null) {
                return;
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setNavigationBarContrastEnforced(false);
            }
            View decorView = window.getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
            if (controller != null) {
                controller.setAppearanceLightStatusBars(isLightBackground);
                controller.setAppearanceLightNavigationBars(isLightBackground);
            }
        } catch (IllegalArgumentException ignored) {
            // Ignore malformed hex colors from web layer.
        }
    }

    private final class AndroidThemeBridge {
        @JavascriptInterface
        public void syncSystemBars(final String hexColor, final boolean isLightBackground) {
            runOnUiThread(() -> applySystemBarColors(hexColor, isLightBackground));
        }

        @JavascriptInterface
        public void triggerHaptic(final String kind) {
            runOnUiThread(() -> {
                if (getBridge() == null || getBridge().getWebView() == null) {
                    return;
                }
                View target = getBridge().getWebView();
                int feedback = HapticFeedbackConstants.KEYBOARD_TAP;
                if ("confirm".equals(kind)) {
                    feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? HapticFeedbackConstants.CONFIRM
                        : HapticFeedbackConstants.CONTEXT_CLICK;
                } else if ("longPress".equals(kind)) {
                    feedback = HapticFeedbackConstants.LONG_PRESS;
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1 && "toggle".equals(kind)) {
                    feedback = HapticFeedbackConstants.TEXT_HANDLE_MOVE;
                }
                target.performHapticFeedback(feedback);
            });
        }
    }
}
