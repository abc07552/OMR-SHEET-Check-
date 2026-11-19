package com.markly.omrpro;

import static org.junit.Assert.*;

import org.junit.Test;

public class ExportPolicyTest {
    @Test
    public void acceptsReportNamesAndUnicode() {
        assertTrue(ExportPolicy.validFilename("school result (2026-27).pdf"));
        assertTrue(ExportPolicy.validFilename("ফলাফল.csv"));
        assertTrue(ExportPolicy.validFilename("backup.json"));
    }

    @Test
    public void rejectsTraversalControlsEmptyAndOversizedNames() {
        for (String name : new String[] { null, "", "  ", ".", "..", "../private", "folder/file", "folder\\file", "report\n.csv", "report\n\n.csv", "a\u0000b", "x\u007fy", "a".repeat(161) }) {
            assertFalse("Unsafe filename: " + name, ExportPolicy.validFilename(name));
        }
    }

    @Test
    public void acceptsOnlyConcreteMimeTypes() {
        assertTrue(ExportPolicy.validMimeType("application/pdf"));
        assertTrue(ExportPolicy.validMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        for (String mime : new String[] { null, "", "*/*", "text/csv; charset=utf-8", "text/plain\n", "https://example.org" }) {
            assertFalse(ExportPolicy.validMimeType(mime));
        }
    }

    @Test
    public void boundsBase64BeforeAllocation() {
        assertTrue(ExportPolicy.validEncodedLength(0));
        assertTrue(ExportPolicy.validEncodedLength(4));
        assertTrue(ExportPolicy.validEncodedLength(ExportPolicy.MAX_BASE64_LENGTH));
        assertFalse(ExportPolicy.validEncodedLength(-1));
        assertFalse(ExportPolicy.validEncodedLength(3));
        assertFalse(ExportPolicy.validEncodedLength(ExportPolicy.MAX_BASE64_LENGTH + 4));
    }
}
