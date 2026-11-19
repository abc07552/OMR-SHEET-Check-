package com.markly.omrpro;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;

/** No WebView cookies, credentials, redirects, TLS bypasses or unbounded reads. */
final class SchoolServerClient {
    private SchoolServerClient() {}

    static JSONObject check(String origin) throws IOException {
        origin = SchoolServerPolicy.normalize(origin);
        HttpsURLConnection connection = (HttpsURLConnection) new URL(origin + "/api/connection-info").openConnection();
        try {
            connection.setConnectTimeout(SchoolServerPolicy.CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(SchoolServerPolicy.READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cookie", "");
            connection.setRequestProperty("Authorization", "");
            if (connection.getResponseCode() != 200) {
                throw new IOException("The address did not return the OMR FastAPI connection endpoint (HTTP " + connection.getResponseCode() + "). Deploy the updated server and complete web app at this exact HTTPS address; redirects are not followed.");
            }
            String contentType = connection.getContentType();
            if (contentType == null || !"application/json".equalsIgnoreCase(contentType.split(";", 2)[0].trim())
                    || connection.getContentLengthLong() > SchoolServerPolicy.MAX_RESPONSE_BYTES) {
                throw new IOException("This address is not a compatible OMR FastAPI server, or its response is too large.");
            }
            JSONObject data;
            try (InputStream stream = connection.getInputStream()) {
                data = new JSONObject(SchoolServerPolicy.readBounded(stream));
            }
            if (!"markly-api".equals(data.optString("service")) || !"fastapi".equals(data.optString("backend"))
                    || data.optInt("connectionVersion") != 1 || data.optInt("apiVersion") != 3
                    || !"http-only-cookie".equals(data.optString("authentication"))) {
                throw new IOException("This is not a compatible OMR FastAPI server. Deploy the current backend and web client, not GitHub Pages or the older Node service.");
            }
            if (!data.optBoolean("clientReady")) {
                throw new IOException("FastAPI is reachable, but the web app is missing. Build the client and serve it from the same HTTPS origin before connecting.");
            }
            String mode = data.optString("deploymentMode");
            String database = data.optString("database");
            if (!("production".equals(mode) || "development".equals(mode))
                    || !("postgresql".equals(database) || "sqlite".equals(database))
                    || ("production".equals(mode) && !"postgresql".equals(database))) {
                throw new IOException("The server returned an unsupported deployment or database configuration.");
            }
            data.put("origin", origin);
            return data;
        } catch (JSONException error) {
            throw new IOException("The server did not return valid OMR connection metadata.");
        } finally {
            connection.disconnect();
        }
    }
}
