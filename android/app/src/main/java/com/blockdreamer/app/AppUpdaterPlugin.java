package com.blockdreamer.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String DEFAULT_APK_URL =
            "https://github.com/WebEssentz/block-dreamer/releases/download/latest-apk/app-debug.apk";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("version", info.versionName != null ? info.versionName : "1.0.0");
            ret.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read installed version", e);
        }
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", DEFAULT_APK_URL);
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            rawUrl = DEFAULT_APK_URL;
        }
        final String apkUrl = rawUrl;

        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent permIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName())
            );
            permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(permIntent);

            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }

        if (!downloading.compareAndSet(false, true)) {
            call.reject("Download already in progress");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                File updateDir = new File(ctx.getCacheDir(), "updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IOException("Unable to create cache update directory");
                }
                File partFile = new File(updateDir, "block-dreamer-update.apk.part");
                File apkFile = new File(updateDir, "block-dreamer-update.apk");
                if (partFile.exists()) partFile.delete();

                String currentUrl = apkUrl;
                for (int hops = 0; hops < 8; hops++) {
                    URL url = new URL(currentUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "BlockDreamer-Android");
                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM
                            || code == HttpURLConnection.HTTP_MOVED_TEMP
                            || code == HttpURLConnection.HTTP_SEE_OTHER
                            || code == 307
                            || code == 308) {
                        String next = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (next == null || next.isEmpty()) {
                            throw new IOException("Redirect missing Location header");
                        }
                        currentUrl = new URL(url, next).toString();
                        continue;
                    }
                    break;
                }

                if (conn == null) {
                    throw new IOException("Connection failed");
                }
                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IOException("HTTP " + status);
                }

                long total = conn.getContentLengthLong();
                long downloaded = 0;
                int lastPct = -1;
                long lastEmit = 0;

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(partFile)) {
                    byte[] buf = new byte[8192];
                    int read;
                    while ((read = in.read(buf)) != -1) {
                        out.write(buf, 0, read);
                        downloaded += read;
                        long now = System.currentTimeMillis();
                        int pct = total > 0 ? (int) Math.min(100, (downloaded * 100L) / total) : -1;
                        if (pct != lastPct && (pct == 100 || pct - lastPct >= 2 || now - lastEmit >= 120)) {
                            lastPct = pct;
                            lastEmit = now;
                            JSObject ev = new JSObject();
                            ev.put("progress", pct);
                            ev.put("downloaded", downloaded);
                            ev.put("total", total);
                            notifyListeners("downloadProgress", ev);
                        }
                    }
                    out.getFD().sync();
                }

                if (downloaded < 1024 * 1024) {
                    throw new IOException("Downloaded APK is unexpectedly small (" + downloaded + " bytes)");
                }
                if (apkFile.exists()) apkFile.delete();
                if (!partFile.renameTo(apkFile)) {
                    throw new IOException("Failed to finalize APK file");
                }

                Uri apkUri = FileProvider.getUriForFile(
                        ctx,
                        ctx.getPackageName() + ".fileprovider",
                        apkFile
                );
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> getActivity().startActivity(installIntent));
                } else {
                    ctx.startActivity(installIntent);
                }

                JSObject ret = new JSObject();
                ret.put("started", true);
                ret.put("bytes", downloaded);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Update download failed: " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
                downloading.set(false);
            }
        });
    }
}
