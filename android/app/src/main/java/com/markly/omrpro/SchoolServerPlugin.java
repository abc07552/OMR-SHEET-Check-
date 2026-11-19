package com.markly.omrpro;

import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.SSLException;
import org.json.JSONException;
import org.json.JSONObject;

/** User-approved whole-app navigation, not a cross-origin authentication proxy. */
@CapacitorPlugin(name = "SchoolServer")
public class SchoolServerPlugin extends Plugin {
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean destroyed;
    private AlertDialog trustDialog;

    private MainActivity activity() {
        return (MainActivity) getActivity();
    }

    @PluginMethod
    public void status(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!activity().trustedDocument()) {
                call.reject("Return to the school connection screen.", "UNTRUSTED_ORIGIN");
                return;
            }
            JSObject data = new JSObject();
            data.put("origin", activity().schoolOrigin());
            data.put("lastOrigin", activity().lastSchoolOrigin());
            call.resolve(data);
        });
    }

    private void checked(PluginCall call, boolean connect) {
        // Entry is bundled-only. A hosted school cannot repoint or probe other servers.
        getActivity().runOnUiThread(() -> {
            if (destroyed || activity().isFinishing() || !activity().bundledDocument()) {
                call.reject("Disconnect before changing the school's server address.", "UNTRUSTED_ORIGIN");
                return;
            }
            final String origin;
            try {
                origin = SchoolServerPolicy.normalize(call.getString("origin"));
            } catch (IllegalArgumentException error) {
                call.reject(error.getMessage(), "INVALID_SERVER");
                return;
            }
            if (!busy.compareAndSet(false, true)) {
                call.reject("Finish the current connection check first.", "CONNECTION_BUSY");
                return;
            }
            network.execute(() -> {
                try {
                    JSONObject data = SchoolServerClient.check(origin);
                    if (destroyed) return;
                    if (!connect) {
                        busy.set(false);
                        call.resolve(JSObject.fromJSONObject(data));
                        return;
                    }
                    getActivity().runOnUiThread(() -> {
                        if (destroyed || activity().isFinishing() || activity().isDestroyed() || !activity().bundledDocument()) {
                            busy.set(false);
                            call.reject("The connection screen changed. Check the server again.");
                            return;
                        }
                        trustDialog = new AlertDialog.Builder(getActivity())
                            .setTitle("Trust this school server?")
                            .setMessage(origin + "\n\nThis server will supply the app and receive the accounts, scans and school records you submit. HTTPS and compatibility checks do not prove who operates it. Only continue with the address supplied by your administrator.\n\nDevice-demo records are not uploaded. Existing web sessions on this device will be cleared; encrypted offline work is retained at its original address.")
                            .setNegativeButton("Cancel", (dialog, which) -> {
                                busy.set(false);
                                call.reject("Connection cancelled. Nothing was changed.", "CONNECTION_CANCELLED");
                            })
                            .setOnCancelListener(dialog -> {
                                busy.set(false);
                                call.reject("Connection cancelled. Nothing was changed.", "CONNECTION_CANCELLED");
                            })
                            .setPositiveButton("Trust and connect", (dialog, which) -> {
                                busy.set(false);
                                activity().selectSchoolServer(origin, call);
                            })
                            .show();
                    });
                } catch (SSLException error) {
                    fail(call, "The server's HTTPS certificate could not be verified. Use a valid certificate; insecure TLS is never accepted.");
                } catch (SocketTimeoutException error) {
                    fail(call, "The connection timed out. Check the address, network and server, then retry.");
                } catch (UnknownHostException error) {
                    fail(call, "The school server name could not be found. Check its DNS address and your network.");
                } catch (IOException | IllegalArgumentException | JSONException error) {
                    fail(call, error.getMessage() == null ? "The server could not be checked. Check its HTTPS address and network." : error.getMessage());
                }
            });
        });
    }

    private void fail(PluginCall call, String message) {
        busy.set(false);
        if (!destroyed) call.reject(message, "CONNECTION_FAILED");
    }

    @PluginMethod
    public void check(PluginCall call) {
        checked(call, false);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        // Recheck on connect, even if the UI's previous successful check is stale.
        checked(call, true);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!activity().trustedDocument()) {
                call.reject("Return to the school connection screen.", "UNTRUSTED_ORIGIN");
                return;
            }
            activity().confirmDisconnect(call);
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        network.shutdownNow();
        getActivity().runOnUiThread(() -> {
            if (trustDialog != null) trustDialog.dismiss();
        });
    }
}
