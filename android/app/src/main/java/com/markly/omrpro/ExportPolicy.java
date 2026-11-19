package com.markly.omrpro;

/** Pure validation shared by the native bridge and JVM regression tests. */
final class ExportPolicy {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final int MAX_BASE64_LENGTH = ((MAX_BYTES + 2) / 3) * 4;

    private ExportPolicy() {}

    static boolean validFilename(String name) {
        return name != null
            && !name.trim().isEmpty()
            && name.length() <= 160
            && !name.equals(".")
            && !name.equals("..")
            && name.chars().noneMatch(c -> c == '/' || c == '\\' || c <= 0x1f || c == 0x7f);
    }

    static boolean validMimeType(String mimeType) {
        return mimeType != null
            && mimeType.length() <= 160
            && mimeType.matches("[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+");
    }

    static boolean validEncodedLength(int size) {
        return size >= 0 && size <= MAX_BASE64_LENGTH && size % 4 == 0;
    }
}
