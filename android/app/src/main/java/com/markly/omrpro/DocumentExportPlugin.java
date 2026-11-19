package com.markly.omrpro;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintManager;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

/** User-selected documents only: no broad storage permission or cached exports. */
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private byte[] pendingBytes;
    private boolean exporting;

    @PluginMethod
    public void save(PluginCall call) {
        if (exporting) {
            call.reject("Finish the current Save As dialog before exporting another file.", "EXPORT_BUSY");
            return;
        }
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType");
        String encoded = call.getString("base64");
        // Do not persist private document contents in Android saved-instance state.
        call.getData().remove("base64");
        if (!ExportPolicy.validFilename(filename) || !ExportPolicy.validMimeType(mimeType)
                || encoded == null || !ExportPolicy.validEncodedLength(encoded.length())) {
            call.reject("Invalid export, or file larger than the 32 MiB Android limit.", "EXPORT_INVALID");
            return;
        }
        try {
            pendingBytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (pendingBytes.length > ExportPolicy.MAX_BYTES) {
                pendingBytes = null;
                call.reject("The export exceeds the 32 MiB Android limit.", "EXPORT_TOO_LARGE");
                return;
            }
        } catch (IllegalArgumentException error) {
            call.reject("The export data is not valid base64.", "EXPORT_INVALID");
            return;
        }
        exporting = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, filename);
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "documentSelected");
            } catch (RuntimeException error) {
                execute(() -> {
                    pendingBytes = null;
                    exporting = false;
                    call.reject("No document provider is available. Use the web app to export this file.", "EXPORT_UNAVAILABLE");
                });
            }
        });
    }

    @ActivityCallback
    private void documentSelected(PluginCall call, ActivityResult result) {
        execute(() -> {
            try {
                if (call == null) return;
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    call.reject("Export cancelled. No file was saved.", "EXPORT_CANCELLED");
                    return;
                }
                Uri destination = result.getData().getData();
                if (destination == null || !"content".equals(destination.getScheme()) || pendingBytes == null) {
                    call.reject("The export was interrupted. Return to the report and export again.", "EXPORT_INTERRUPTED");
                    return;
                }
                byte[] contents = pendingBytes;
                try (OutputStream stream = getContext().getContentResolver().openOutputStream(destination, "w")) {
                    if (stream == null) throw new IOException("No output stream");
                    stream.write(contents);
                    stream.flush();
                }
                call.resolve();
            } catch (IOException | SecurityException error) {
                if (call != null) call.reject("The document could not be saved. Check free space and destination permissions, then retry.", "EXPORT_WRITE_FAILED");
            } finally {
                pendingBytes = null;
                exporting = false;
            }
        });
    }

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("Printing is unavailable. Export a PDF instead.");
                    return;
                }
                manager.print("OMR report", getBridge().getWebView().createPrintDocumentAdapter("OMR report"), null);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("The print dialog could not be opened. Export a PDF instead.");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        pendingBytes = null;
        exporting = false;
    }
}
