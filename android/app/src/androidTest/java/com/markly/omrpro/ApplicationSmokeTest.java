package com.markly.omrpro;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run with connectedDebugAndroidTest on a real device/emulator, not a JVM. */
@RunWith(AndroidJUnit4.class)
public class ApplicationSmokeTest {
    @Test
    public void debugApplicationHasALauncher() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.markly.omrpro.debug", context.getPackageName());
        assertNotNull(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
    }
}
