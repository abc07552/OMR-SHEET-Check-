package com.markly.omrpro;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Pure policy shared by native onboarding, persistence and transport checks. */
final class SchoolServerPolicy {
    static final int MAX_RESPONSE_BYTES = 8192;
    static final int CONNECT_TIMEOUT_MS = 8000;
    static final int READ_TIMEOUT_MS = 8000;
    static final String ADDRESS_ERROR = "Use your school's HTTPS server origin only, without credentials, /api, a path, query or fragment. Localhost is this phone, not a server.";

    private SchoolServerPolicy() {}

    static String normalize(String input) {
        if (input == null || input.length() > 2048) throw new IllegalArgumentException(ADDRESS_ERROR);
        String value = input.trim();
        if (value.isEmpty() || value.chars().anyMatch(c -> c <= 0x20 || c >= 0x7f) || value.contains("\\") || value.contains("@")) {
            throw new IllegalArgumentException(ADDRESS_ERROR);
        }
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            String path = uri.getRawPath();
            int port = uri.getPort();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null
                    || (path != null && !path.isEmpty() && !"/".equals(path))
                    || uri.getRawQuery() != null || uri.getRawFragment() != null || port == 0 || port > 65535) {
                throw new IllegalArgumentException(ADDRESS_ERROR);
            }
            host = host.toLowerCase(Locale.ROOT).replaceFirst("\\.$", "");
            if (host.isEmpty() || host.equals("localhost") || host.endsWith(".localhost") || host.contains(":")
                    || host.startsWith("127.") || host.equals("0.0.0.0") || host.contains("*")
                    || host.matches("(?i)0x[0-9a-f]+") || host.matches("[0-9]+")) {
                throw new IllegalArgumentException(ADDRESS_ERROR);
            }
            // Disallow ambiguous short/octal IPv4 literals interpreted differently by WebView.
            if (host.matches("[0-9.]+")) {
                String[] octets = host.split("\\.", -1);
                if (octets.length != 4 || octets[0].equals("0")) throw new IllegalArgumentException(ADDRESS_ERROR);
                for (String octet : octets) {
                    if (!octet.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(octet) > 255) {
                        throw new IllegalArgumentException(ADDRESS_ERROR);
                    }
                }
            }
            return "https://" + host + (port == -1 || port == 443 ? "" : ":" + port);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException(ADDRESS_ERROR);
        }
    }

    static String readBounded(InputStream stream) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int count;
        long deadline = System.nanoTime() + READ_TIMEOUT_MS * 1_000_000L;
        while ((count = stream.read(buffer)) != -1) {
            if (bytes.size() + count > MAX_RESPONSE_BYTES || System.nanoTime() > deadline) {
                throw new IOException("The server returned an oversized or slow connection response.");
            }
            bytes.write(buffer, 0, count);
        }
        return bytes.toString(StandardCharsets.UTF_8.name());
    }
}
