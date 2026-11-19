package com.markly.omrpro;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class SchoolServerPolicyTest {
    @Test
    public void normalizesOneExactHttpsOrigin() {
        assertEquals("https://school.example", SchoolServerPolicy.normalize(" https://SCHOOL.example/ "));
        assertEquals("https://school.example", SchoolServerPolicy.normalize("HTTPS://school.example:443/"));
        assertEquals("https://school.example:8443", SchoolServerPolicy.normalize("https://school.example.:8443"));
        assertEquals("https://192.168.1.25", SchoolServerPolicy.normalize("https://192.168.1.25"));
    }

    @Test
    public void rejectsCredentialsPathsQueriesFragmentsAndOtherSchemes() {
        for (String value : new String[] { null, "", "school.example", "http://school.example", "file:///a", "javascript:alert(1)", "https://user:secret@school.example", "https://@school.example", "https://school.example/api", "https://school.example/?", "https://school.example/#", "https://school.example?token=private", "https://school.example\\", "https://school.example:0", "https://school.example:65536", "https://school.example/\napi", "https://school.example/\u0000", "https://*.example", "https://éxample.edu", "x".repeat(2049) }) {
            assertThrows(String.valueOf(value), IllegalArgumentException.class, () -> SchoolServerPolicy.normalize(value));
        }
    }

    @Test
    public void rejectsLoopbackUnspecifiedIpv6AndAmbiguousIpLiterals() {
        for (String value : new String[] { "https://localhost", "https://LOCALHOST.", "https://a.localhost", "https://127.0.0.1", "https://127.9.1.2", "https://0.0.0.0", "https://[::1]", "https://[::]", "https://[::ffff:127.0.0.1]", "https://127.1", "https://2130706433", "https://0x7f000001", "https://0177.0.0.1", "https://1.1.1.999" }) {
            assertThrows(value, IllegalArgumentException.class, () -> SchoolServerPolicy.normalize(value));
        }
    }

    @Test
    public void allowsOnlyOneBoundedOriginAtATime() {
        assertThrows(IllegalArgumentException.class, () -> SchoolServerPolicy.normalize("https://a.example https://b.example"));
        assertThrows(IllegalArgumentException.class, () -> SchoolServerPolicy.normalize("https://a.example\r\nX-Test: injected"));
    }

    @Test
    public void readsExactUtf8BytesAtTheTransportLimit() throws IOException {
        String text = "a".repeat(SchoolServerPolicy.MAX_RESPONSE_BYTES - 6) + "বাংলা";
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        assertTrue(bytes.length > SchoolServerPolicy.MAX_RESPONSE_BYTES);
        String safe = "a".repeat(SchoolServerPolicy.MAX_RESPONSE_BYTES - 3) + "অ";
        assertEquals(safe, SchoolServerPolicy.readBounded(new ByteArrayInputStream(safe.getBytes(StandardCharsets.UTF_8))));
    }

    @Test
    public void rejectsOversizedConnectionMetadataBeforeUnboundedAllocation() {
        byte[] bytes = new byte[SchoolServerPolicy.MAX_RESPONSE_BYTES + 1];
        assertThrows(IOException.class, () -> SchoolServerPolicy.readBounded(new ByteArrayInputStream(bytes)));
    }
}
