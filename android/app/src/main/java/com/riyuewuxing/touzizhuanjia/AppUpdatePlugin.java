package com.riyuewuxing.touzizhuanjia;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * In-app APK updater: queries installed version/signing cert, downloads verified APK via
 * LAN/Tailscale or authenticated URL, and launches Android PackageInstaller via FileProvider.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String UPDATE_DIR = "apk-updates";
    private static final String UPDATE_APK_NAME = "touzizhuanjia-update.apk";
    private static final long MIN_APK_BYTES = 100 * 1024;
    private static final ExecutorService DOWNLOAD_EXECUTOR = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getInstalledInfo(PluginCall call) {
        try {
            Context context = getContext();
            PackageInfo pkgInfo = resolvePackageInfo(context);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pkgInfo.getLongVersionCode()
                : pkgInfo.versionCode;
            String versionName = pkgInfo.versionName != null ? pkgInfo.versionName : "unknown";
            String signingSha256 = extractSigningSha256(pkgInfo);
            boolean canInstall = context.getPackageManager().canRequestPackageInstalls();

            JSObject ret = new JSObject();
            ret.put("packageName", context.getPackageName());
            ret.put("versionCode", versionCode);
            ret.put("versionName", versionName);
            ret.put("canRequestPackageInstalls", canInstall);
            ret.put("signingSha256", signingSha256);
            call.resolve(ret);
        } catch (Exception exc) {
            call.reject("读取当前 APK 版本信息失败: " + exc.getMessage(), exc);
        }
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().runOnUiThread(() -> {
            try {
                context.startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                call.resolve(ret);
            } catch (Exception exc) {
                call.reject("无法打开应用安装授权设置: " + exc.getMessage(), exc);
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String expectedSha = call.getString("expectedSha256", "");
        String authToken = call.getString("authToken", "");

        if (rawUrl == null || (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))) {
            call.reject("无效的 APK 下载地址");
            return;
        }
        String normalizedExpected = expectedSha != null ? expectedSha.trim().toLowerCase(Locale.US) : "";
        if (!normalizedExpected.matches("^[0-9a-f]{64}$")) {
            call.reject("缺少有效的 expectedSha256 校验值");
            return;
        }

        final Context context = getContext();
        DOWNLOAD_EXECUTOR.execute(() -> {
            try {
                File updatesDir = new File(context.getCacheDir(), UPDATE_DIR);
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    throw new IOException("无法创建缓存更新目录: " + updatesDir.getAbsolutePath());
                }

                File targetApk = new File(updatesDir, UPDATE_APK_NAME);
                long fileBytes = 0L;
                boolean alreadyVerified = false;
                if (targetApk.isFile() && targetApk.length() >= MIN_APK_BYTES) {
                    String cachedSha = sha256File(targetApk);
                    if (normalizedExpected.equals(cachedSha)) {
                        alreadyVerified = true;
                        fileBytes = targetApk.length();
                    }
                }

                if (!alreadyVerified) {
                    cleanUpdateDir(updatesDir);
                    File tempApk = new File(updatesDir, UPDATE_APK_NAME + ".part");
                    fileBytes = downloadWithSha256(
                        rawUrl,
                        authToken,
                        tempApk,
                        normalizedExpected
                    );
                    if (targetApk.exists() && !targetApk.delete()) {
                        throw new IOException("无法清理旧缓存安装包");
                    }
                    if (!tempApk.renameTo(targetApk)) {
                        throw new IOException("安装包重命名失败");
                    }
                }

                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    JSObject ret = new JSObject();
                    ret.put("status", "NEEDS_PERMISSION");
                    ret.put("sha256", normalizedExpected);
                    ret.put("bytes", fileBytes);
                    ret.put("apkReady", true);
                    call.resolve(ret);
                    return;
                }

                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    targetApk
                );
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION
                );

                getActivity().runOnUiThread(() -> {
                    try {
                        context.startActivity(installIntent);
                        JSObject ret = new JSObject();
                        ret.put("status", "INSTALLER_LAUNCHED");
                        ret.put("sha256", normalizedExpected);
                        ret.put("bytes", targetApk.length());
                        call.resolve(ret);
                    } catch (Exception launchExc) {
                        call.reject("调起系统安装器失败: " + launchExc.getMessage(), launchExc);
                    }
                });
            } catch (Exception exc) {
                call.reject("下载或校验 APK 失败: " + exc.getMessage(), exc);
            }
        });
    }

    private long downloadWithSha256(
        String rawUrl,
        String authToken,
        File destPartFile,
        String expectedSha256
    ) throws IOException, NoSuchAlgorithmException {
        HttpURLConnection conn = (HttpURLConnection) new URL(rawUrl).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setInstanceFollowRedirects(true);
        if (authToken != null && !authToken.trim().isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + authToken.trim());
        }

        int statusCode = conn.getResponseCode();
        if (statusCode != HttpURLConnection.HTTP_OK) {
            conn.disconnect();
            throw new IOException("服务端返回 HTTP " + statusCode);
        }

        long contentLength = conn.getContentLengthLong();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long totalRead = 0L;
        byte[] headerPrefix = new byte[4];
        int headerRead = 0;
        long lastNotifyMs = 0L;

        try (
            InputStream in = new BufferedInputStream(conn.getInputStream());
            FileOutputStream out = new FileOutputStream(destPartFile, false)
        ) {
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                digest.update(buffer, 0, n);
                if (headerRead < 4) {
                    int take = Math.min(4 - headerRead, n);
                    System.arraycopy(buffer, 0, headerPrefix, headerRead, take);
                    headerRead += take;
                }
                totalRead += n;

                long now = System.currentTimeMillis();
                if (now - lastNotifyMs >= 150 || (contentLength > 0 && totalRead >= contentLength)) {
                    lastNotifyMs = now;
                    JSObject progress = new JSObject();
                    progress.put("downloadedBytes", totalRead);
                    progress.put("totalBytes", contentLength);
                    int percent = contentLength > 0
                        ? (int) Math.min(100, Math.round((totalRead * 100.0) / contentLength))
                        : -1;
                    progress.put("percent", percent);
                    notifyListeners("downloadProgress", progress);
                }
            }
            out.flush();
        } finally {
            conn.disconnect();
        }

        if (totalRead < MIN_APK_BYTES) {
            destPartFile.delete();
            throw new IOException("下载文件过小，非有效 APK (" + totalRead + " bytes)");
        }
        if (headerRead < 4 || headerPrefix[0] != 'P' || headerPrefix[1] != 'K') {
            destPartFile.delete();
            throw new IOException("下载文件不是有效 APK/ZIP 格式");
        }

        String actualSha = bytesToHex(digest.digest());
        if (!expectedSha256.equals(actualSha)) {
            destPartFile.delete();
            throw new IOException("APK SHA-256 校验失败: expected=" + expectedSha256 + ", actual=" + actualSha);
        }
        return totalRead;
    }

    private static void cleanUpdateDir(File dir) {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File f : children) {
            f.delete();
        }
    }

    private static PackageInfo resolvePackageInfo(Context context) throws PackageManager.NameNotFoundException {
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        return pm.getPackageInfo(context.getPackageName(), flags);
    }

    private static String extractSigningSha256(PackageInfo pkgInfo) throws NoSuchAlgorithmException {
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo info = pkgInfo.signingInfo;
            if (info != null) {
                signatures = info.hasMultipleSigners()
                    ? info.getApkContentsSigners()
                    : info.getSigningCertificateHistory();
            }
        } else {
            signatures = pkgInfo.signatures;
        }
        if (signatures == null || signatures.length == 0) {
            return "";
        }
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        return bytesToHex(md.digest(signatures[0].toByteArray()));
    }

    private static String sha256File(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
        }
        return bytesToHex(md.digest());
    }

    private static String bytesToHex(byte[] raw) {
        StringBuilder sb = new StringBuilder(raw.length * 2);
        for (byte b : raw) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }
}
