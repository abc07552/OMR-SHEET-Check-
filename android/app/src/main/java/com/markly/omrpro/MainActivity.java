package com.markly.omrpro;

import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginCall;
import java.net.URI;

public class MainActivity extends BridgeActivity {
    private static final String PREFERENCES = "school-server";
    private static final String SELECTED_ORIGIN = "selected-origin";
    private String origin = "";
    private AlertDialog recoveryDialog;
    private AlertDialog disconnectDialog;
    private boolean selecting;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentExportPlugin.class);
        registerPlugin(SchoolServerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    private SharedPreferences preferences() {
        return getSharedPreferences(PREFERENCES, MODE_PRIVATE);
    }

    @Override
    protected void load() {
        CapConfig bundledConfig = CapConfig.loadDefault(this);
        String selected = preferences().getString(SELECTED_ORIGIN, bundledConfig.getServerUrl());
        try {
            if (selected != null && !selected.isEmpty()) origin = SchoolServerPolicy.normalize(selected);
        } catch (IllegalArgumentException ignored) {
            // An invalid preference/config must never weaken transport or break local recovery.
            origin = "";
        }
        config = new CapConfig.Builder(this)
            .setHostname("localhost")
            .setAndroidScheme("https")
            .setServerUrl(origin.isEmpty() ? null : origin)
            .setAllowNavigation(new String[0])
            .setAllowMixedContent(false)
            .setWebContentsDebuggingEnabled(false)
            .setLoggingEnabled(false)
            .setBackgroundColor("#0b1220")
            .create();
        super.load();
        CookieManager.getInstance().setAcceptThirdPartyCookies(bridge.getWebView(), false);
        if (!origin.isEmpty()) {
            installConnectionBar();
            bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (request.isForMainFrame()) showRecovery("The school app could not be loaded. Check the network and server, or return to the connection screen.");
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    super.onReceivedHttpError(view, request, response);
                    if (request.isForMainFrame()) showRecovery("The school server returned HTTP " + response.getStatusCode() + ". Retry or return to the connection screen; no private data has been moved to the demo.");
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    handler.cancel();
                    showRecovery("The server's HTTPS certificate could not be verified. Insecure connections are never allowed.");
                }
            });
        }
    }

    String schoolOrigin() {
        return origin;
    }

    String lastSchoolOrigin() {
        return preferences().getString("last-origin", "");
    }

    boolean trustedDocument() {
        String current = bridge == null ? null : bridge.getWebView().getUrl();
        if (current == null) return false;
        try {
            URI uri = new URI(current);
            String documentOrigin = uri.getScheme() + "://" + uri.getRawAuthority();
            return (origin.isEmpty() ? "https://localhost" : origin).equals(documentOrigin);
        } catch (Exception ignored) {
            return false;
        }
    }

    boolean bundledDocument() {
        return origin.isEmpty() && trustedDocument();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Native, always reachable even if HTML, JavaScript, DNS or the API is broken. */
    private void installConnectionBar() {
        WebView webView = bridge.getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();
        parent.removeView(webView);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(14), 0, dp(6), 0);
        bar.setBackgroundColor(Color.rgb(11, 18, 32));
        TextView address = new TextView(this);
        address.setText(origin);
        address.setTextSize(12);
        address.setTextColor(Color.rgb(194, 211, 241));
        address.setSingleLine(true);
        address.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        bar.addView(address, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button manage = new Button(this);
        manage.setText("Connection");
        manage.setTextSize(12);
        manage.setTextColor(Color.WHITE);
        manage.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(30, 52, 87)));
        manage.setContentDescription("School server connection options");
        manage.setOnClickListener(view -> showRecovery("This app is connected to the school server below. Sign out inside the app before disconnecting when possible. Encrypted pending work stays at this address; reconnect here to recover it."));
        bar.addView(manage, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        layout.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        layout.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        parent.addView(layout, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showRecovery(String message) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed() || origin.isEmpty() || (recoveryDialog != null && recoveryDialog.isShowing())) return;
            recoveryDialog = new AlertDialog.Builder(this)
                .setTitle("School server connection")
                .setMessage(origin + "\n\n" + message)
                .setPositiveButton("Retry", (dialog, which) -> bridge.getWebView().reload())
                .setNegativeButton("Connection screen", (dialog, which) -> confirmDisconnect(null))
                .setNeutralButton("Keep open", (dialog, which) -> {})
                .show();
        });
    }

    void confirmDisconnect(PluginCall call) {
        if (isFinishing() || isDestroyed() || (disconnectDialog != null && disconnectDialog.isShowing())) {
            if (call != null) call.reject("Finish the current connection dialog first.");
            return;
        }
        disconnectDialog = new AlertDialog.Builder(this)
            .setTitle("Disconnect this device?")
            .setMessage("This returns to server setup and clears this app's web sessions on this device. It does not delete school data or the separate demo. Encrypted offline work stays stored at its original server address.\n\nIf you cannot sign out online, the server session is not revoked remotely; its cookie is removed from this device. Reconnect and sign in again to access that school.")
            .setPositiveButton("Disconnect", (dialog, which) -> selectSchoolServer("", call))
            .setNegativeButton("Cancel", (dialog, which) -> {
                if (call != null) call.reject("Disconnection cancelled.", "CONNECTION_CANCELLED");
            })
            .setOnCancelListener(dialog -> {
                if (call != null) call.reject("Disconnection cancelled.", "CONNECTION_CANCELLED");
            })
            .show();
    }

    void selectSchoolServer(String nextOrigin, PluginCall call) {
        if (selecting) {
            if (call != null) call.reject("A server change is already in progress.");
            return;
        }
        selecting = true;
        // Give the current app a chance to lock in-memory keys and fence late saves.
        bridge.getWebView().evaluateJavascript("window.dispatchEvent(new Event('omr-server-leaving'))", null);
        CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            SharedPreferences.Editor edit = preferences().edit().putString(SELECTED_ORIGIN, nextOrigin);
            if (!nextOrigin.isEmpty()) edit.putString("last-origin", nextOrigin);
            if (!edit.commit()) {
                selecting = false;
                if (call != null) call.reject("The server address could not be saved. Check device storage and retry.");
                return;
            }
            if (call != null) call.resolve();
            bridge.getWebView().postDelayed(() -> {
                if (!isFinishing() && !isDestroyed()) recreate();
            }, 200);
        });
    }

    @Override
    public void onDestroy() {
        if (recoveryDialog != null) recoveryDialog.dismiss();
        if (disconnectDialog != null) disconnectDialog.dismiss();
        super.onDestroy();
    }
}
