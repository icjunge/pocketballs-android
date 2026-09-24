package com.idleballs.pocket;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.net.ssl.HttpsURLConnection;

/** Framework-only, opt-in download/install updater. All listener callbacks use the main thread. */
public final class AppUpdater {
    public interface Listener { void onStatus(JSONObject status); }

    private final Activity activity;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SharedPreferences preferences;
    private final long installedCode;
    private final String installedName;
    private final byte[][] installedSigners;
    private volatile boolean destroyed;
    private volatile HttpsURLConnection activeConnection;
    private Future<?> currentTask;
    private boolean busy, resumed, uiReady, startupChecked, awaitingPermission, deferredInstall;
    private JSONObject lastStatus;
    private UpdatePolicy.Release selected;
    private File verifiedApk;

    public AppUpdater(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        preferences = activity.getSharedPreferences("pocket-updates", Activity.MODE_PRIVATE);
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), signingFlags());
            installedCode = versionCode(info);
            installedName = info.versionName == null ? String.valueOf(installedCode) : info.versionName;
            installedSigners = signatures(info);
        } catch (PackageManager.NameNotFoundException impossible) {
            throw new IllegalStateException("Own package unavailable", impossible);
        }
        emit("idle", "检查更新", null, -1);
        restoreCachedRelease();
    }

    public void onUiReady() { dispatch(() -> {
        uiReady = true;
        replay();
        maybeAutomaticCheck();
    }); }

    public void onResume() { dispatch(() -> {
        resumed = true;
        if (busy) return; // Restoration / verification finishes on the worker first.
        if (awaitingPermission) {
            awaitingPermission = false;
            if (canInstall()) installInternal();
            else {
                clearInstallIntent();
                emit("permission", "尚未允许安装，开启权限后可继续", selected, -1);
            }
        } else if (deferredInstall) {
            deferredInstall = false;
            installInternal();
        }
        maybeAutomaticCheck();
    }); }

    public void onPause() { dispatch(() -> resumed = false); }
    public void checkForUpdates() { dispatch(this::checkInternal); }
    public void downloadUpdate() { dispatch(this::downloadInternal); }
    public void installUpdate() { dispatch(this::installInternal); }

    private void dispatch(Runnable action) {
        if (destroyed) return;
        if (Looper.myLooper() == Looper.getMainLooper()) action.run();
        else main.post(() -> { if (!destroyed) action.run(); });
    }

    private void replay() {
        if (!destroyed && lastStatus != null) listener.onStatus(lastStatus);
    }

    private void maybeAutomaticCheck() {
        if (!uiReady || startupChecked || busy || awaitingPermission || deferredInstall) return;
        startupChecked = true;
        if (UpdatePolicy.shouldCheck(System.currentTimeMillis(),
                preferences.getLong("lastSuccessfulCheck", 0))) checkInternal();
    }

    /** Persist only a validated manifest; the APK path is always derived, never restored verbatim. */
    private void restoreCachedRelease() {
        String cached = preferences.getString("cachedRelease", null);
        if (cached == null) { clearInstallIntent(); return; }
        final UpdatePolicy.Release release;
        try {
            if (cached.length() > UpdatePolicy.MAX_MANIFEST_BYTES) throw new IllegalArgumentException();
            release = parseRelease(cached);
            UpdatePolicy.requireUpgrade(release, installedCode, Build.VERSION.SDK_INT);
            selected = release;
        } catch (Exception invalid) {
            preferences.edit().remove("cachedRelease").remove("pendingInstall").apply();
            return;
        }
        deferredInstall = preferences.getBoolean("pendingInstall", false);
        final File file = completedFile(release);
        if (!file.isFile()) {
            clearInstallIntent();
            emit("available", "有可用更新 " + release.versionName, release, -1);
            return;
        }
        busy = true;
        emit("checking", "正在读取更新状态…", release, -1);
        currentTask = worker.submit(() -> {
            boolean valid;
            try { verifyApk(file, release); valid = true; }
            catch (Exception invalid) { valid = false; }
            final boolean verified = valid;
            dispatch(() -> {
                busy = false;
                if (verified) {
                    verifiedApk = file;
                    emit("ready", "更新已下载，可以安装", release, 100);
                    if (deferredInstall && resumed) {
                        deferredInstall = false;
                        installInternal();
                    }
                } else {
                    clearInstallIntent();
                    emit("available", "请重新下载更新", release, -1);
                }
                maybeAutomaticCheck();
            });
        });
    }

    private File completedFile(UpdatePolicy.Release release) {
        return new File(ApkContentProvider.updateDirectory(activity),
            "verified-" + release.versionCode + "-" + release.sha256 + ".apk");
    }

    private void clearInstallIntent() {
        deferredInstall = false;
        preferences.edit().remove("pendingInstall").apply();
    }

    private static String releaseJson(UpdatePolicy.Release release) {
        try {
            return new JSONObject().put("versionCode", release.versionCode)
                .put("versionName", release.versionName).put("packageName", release.packageName)
                .put("minSdk", release.minSdk).put("url", release.url).put("sha256", release.sha256)
                .put("sizeBytes", release.sizeBytes).put("notes", release.notes).toString();
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    private void emit(String state, String message, UpdatePolicy.Release release, int progress) {
        if (destroyed) return;
        try {
            JSONObject status = new JSONObject().put("state", state).put("message", message)
                .put("installedVersionName", installedName).put("busy", busy);
            if (release != null) status.put("versionName", release.versionName)
                .put("notes", release.notes).put("sizeBytes", release.sizeBytes);
            if (progress >= 0) status.put("progress", Math.min(100, Math.max(0, progress)));
            lastStatus = status;
            listener.onStatus(status);
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    private void checkInternal() {
        if (busy || awaitingPermission || deferredInstall) { replay(); return; }
        busy = true;
        emit("checking", "正在检查更新…", null, -1);
        currentTask = worker.submit(() -> {
            try {
                UpdatePolicy.Release release = parseRelease(readManifest());
                if (release.versionCode > installedCode)
                    UpdatePolicy.requireUpgrade(release, installedCode, Build.VERSION.SDK_INT);
                dispatch(() -> {
                    busy = false;
                    preferences.edit().putLong("lastSuccessfulCheck", System.currentTimeMillis()).apply();
                    if (release.versionCode <= installedCode) {
                        selected = null; verifiedApk = null;
                        preferences.edit().remove("cachedRelease").remove("pendingInstall").apply();
                        emit("latest", "当前版本无需更新", null, -1);
                    } else {
                        if (selected == null || !release.sha256.equals(selected.sha256)
                                || release.versionCode != selected.versionCode) verifiedApk = null;
                        selected = release;
                        preferences.edit().putString("cachedRelease", releaseJson(release)).apply();
                        emit(verifiedApk == null ? "available" : "ready",
                            verifiedApk == null ? "发现新版本 " + release.versionName : "下载完成，可以安装",
                            release, -1);
                    }
                });
            } catch (Exception failed) { reportFailure(failed, "暂时无法检查更新，请稍后重试", true); }
        });
    }

    private void downloadInternal() {
        if (busy) { replay(); return; }
        if (selected == null) { checkInternal(); return; }
        final UpdatePolicy.Release release = selected;
        try { UpdatePolicy.requireUpgrade(release, installedCode, Build.VERSION.SDK_INT); }
        catch (IllegalArgumentException invalid) { emit("error", invalid.getMessage(), release, -1); return; }
        busy = true;
        emit("downloading", "正在下载更新…", release, 0);
        currentTask = worker.submit(() -> {
            File temporary = null;
            try {
                File directory = ApkContentProvider.updateDirectory(activity);
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Directory unavailable");
                File complete = completedFile(release);
                if (complete.exists()) {
                    try { verifyApk(complete, release); }
                    catch (Exception invalid) {
                        if (!complete.delete()) throw new IOException("Cannot remove invalid cached update");
                    }
                }
                if (!complete.exists()) {
                    temporary = File.createTempFile("download-", ".part", directory);
                    downloadTo(release, temporary);
                    verifyApk(temporary, release);
                    ensureActive();
                    if (!temporary.renameTo(complete)) throw new IOException("Cannot finish download");
                    temporary = null;
                    complete.setWritable(false, true);
                }
                ensureActive();
                dispatch(() -> {
                    busy = false;
                    verifiedApk = complete;
                    emit("ready", "下载完成，可以安装", release, 100);
                });
            } catch (Exception failed) { reportFailure(failed, "下载未完成，请检查网络后重试"); }
            finally { if (temporary != null) temporary.delete(); }
        });
    }

    private void installInternal() {
        if (busy) { replay(); return; }
        if (verifiedApk == null || selected == null) {
            emit(selected == null ? "idle" : "available", "请先下载更新", selected, -1);
            return;
        }
        preferences.edit().putBoolean("pendingInstall", true).apply();
        if (!resumed) { deferredInstall = true; return; }
        if (!canInstall()) {
            emit("permission", "请允许球屿安装更新，返回后继续", selected, -1);
            try {
                awaitingPermission = true;
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                awaitingPermission = false;
                clearInstallIntent();
                emit("permission", "请在系统设置中允许球屿安装未知应用", selected, -1);
            }
            return;
        }
        final File apk = verifiedApk;
        final UpdatePolicy.Release release = selected;
        busy = true;
        emit("ready", "正在校验安装包…", release, 100);
        currentTask = worker.submit(() -> {
            try {
                verifyApk(apk, release);
                ensureActive();
                dispatch(() -> {
                    busy = false;
                    if (!resumed) { deferredInstall = true; return; }
                    if (!canInstall()) { installInternal(); return; }
                    try {
                        Uri uri = ApkContentProvider.uriFor(activity, apk);
                        Intent intent = new Intent(Intent.ACTION_VIEW)
                            .setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.setClipData(ClipData.newRawUri("PocketBalls update", uri));
                        clearInstallIntent();
                        activity.startActivity(intent);
                        emit("ready", "请在系统安装窗口确认更新", release, 100);
                    } catch (ActivityNotFoundException | SecurityException unavailable) {
                        clearInstallIntent();
                        emit("ready", "系统未能打开安装窗口，请重试", release, 100);
                    }
                });
            } catch (Exception failed) {
                dispatch(() -> { verifiedApk = null; clearInstallIntent(); });
                reportFailure(failed, "安装包已失效，请重新下载");
            }
        });
    }

    private boolean canInstall() { return activity.getPackageManager().canRequestPackageInstalls(); }

    private String readManifest() throws Exception {
        HttpsURLConnection connection = open(UpdatePolicy.FEED_URL, null);
        try {
            long reported = connection.getContentLengthLong();
            if (reported > UpdatePolicy.MAX_MANIFEST_BYTES) throw new IllegalArgumentException("更新信息过大");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] block = new byte[4096];
                int length;
                while ((length = input.read(block)) != -1) {
                    ensureActive();
                    if (output.size() + length > UpdatePolicy.MAX_MANIFEST_BYTES)
                        throw new IllegalArgumentException("更新信息过大");
                    output.write(block, 0, length);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally { close(connection); }
    }

    private static UpdatePolicy.Release parseRelease(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        return new UpdatePolicy.Release(integer(object, "versionCode"), object.getString("versionName"),
            object.getString("packageName"), (int) boundedInteger(object, "minSdk", 1000),
            object.getString("url"), object.getString("sha256"), integer(object, "sizeBytes"),
            object.optString("notes", ""));
    }

    private static long integer(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Number) || !value.toString().matches("[0-9]{1,18}"))
            throw new JSONException("Invalid " + key);
        return ((Number) value).longValue();
    }

    private static long boundedInteger(JSONObject object, String key, long maximum) throws JSONException {
        long value = integer(object, key);
        if (value > maximum) throw new JSONException("Invalid " + key);
        return value;
    }

    private HttpsURLConnection open(String initial, UpdatePolicy.Release release) throws Exception {
        String url = initial;
        for (int redirects = 0; redirects <= 3; redirects++) {
            ensureActive();
            if (release == null) UpdatePolicy.requireFeedUrl(url);
            else UpdatePolicy.requireApkUrl(url, release.versionName);
            HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
            activeConnection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(15000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "PocketBalls/" + installedName);
            int code;
            try { code = connection.getResponseCode(); }
            catch (Exception failed) { close(connection); throw failed; }
            if (code == HttpURLConnection.HTTP_OK) return connection;
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location");
                close(connection);
                if (location == null) throw new IOException("Missing redirect location");
                url = new URL(new URL(url), location).toString();
                continue;
            }
            close(connection);
            throw new IOException("Update server unavailable");
        }
        throw new IOException("Too many redirects");
    }

    private void downloadTo(UpdatePolicy.Release release, File destination) throws Exception {
        HttpsURLConnection connection = open(release.url, release);
        try {
            long reported = connection.getContentLengthLong();
            if (reported > 0 && reported != release.sizeBytes)
                throw new IllegalArgumentException("安装包大小不匹配，请稍后重试");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                long total = 0, lastProgress = 0;
                byte[] block = new byte[32 * 1024];
                int length;
                while ((length = input.read(block)) != -1) {
                    ensureActive();
                    total += length;
                    if (total > release.sizeBytes || total > UpdatePolicy.MAX_APK_BYTES)
                        throw new IllegalArgumentException("安装包大小不匹配，请稍后重试");
                    output.write(block, 0, length);
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - lastProgress >= 150) {
                        lastProgress = now;
                        final int progress = (int) (total * 100 / release.sizeBytes);
                        dispatch(() -> emit("downloading", "正在下载更新…", release, progress));
                    }
                }
                if (total != release.sizeBytes) throw new IOException("Truncated APK");
                output.getFD().sync();
            }
        } finally { close(connection); }
    }

    private void verifyApk(File apk, UpdatePolicy.Release release) throws Exception {
        ensureActive();
        UpdatePolicy.requireUpgrade(release, installedCode, Build.VERSION.SDK_INT);
        if (!apk.isFile() || apk.length() != release.sizeBytes)
            throw new IllegalArgumentException("安装包不完整，请重新下载");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(apk)) {
            byte[] block = new byte[32 * 1024];
            int length;
            while ((length = input.read(block)) != -1) { ensureActive(); digest.update(block, 0, length); }
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        UpdatePolicy.requireDigest(release.sha256, hex.toString());
        PackageInfo archive = activity.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), signingFlags());
        if (archive == null || !release.packageName.equals(archive.packageName)
                || versionCode(archive) != release.versionCode
                || !release.versionName.equals(archive.versionName)
                || archive.applicationInfo == null
                || archive.applicationInfo.minSdkVersion != release.minSdk
                || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IllegalArgumentException("安装包版本不匹配，请重新下载");
        if (!UpdatePolicy.sameSigners(installedSigners, signatures(archive)))
            throw new IllegalArgumentException("安装包来源校验失败，已停止更新");
    }

    @SuppressWarnings("deprecation")
    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static byte[][] signatures(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null) return null;
        byte[][] bytes = new byte[signatures.length][];
        for (int i = 0; i < signatures.length; i++) bytes[i] = signatures[i].toByteArray();
        return bytes;
    }

    private void ensureActive() throws IOException {
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
    }

    private void close(HttpsURLConnection connection) {
        connection.disconnect();
        if (activeConnection == connection) activeConnection = null;
    }

    private void reportFailure(Exception failed, String fallback) {
        reportFailure(failed, fallback, false);
    }

    private void reportFailure(Exception failed, String fallback, boolean preserveDownloadedUpdate) {
        final String message = failed instanceof IllegalArgumentException && failed.getMessage() != null
            ? failed.getMessage() : failed instanceof SocketTimeoutException ? "连接超时，请稍后重试" : fallback;
        dispatch(() -> {
            busy = false;
            if (preserveDownloadedUpdate && verifiedApk != null && selected != null)
                emit("ready", "暂时无法检查新版本；已下载的更新仍可安装", selected, 100);
            else emit("error", message, selected, -1);
        });
    }

    public void destroy() {
        destroyed = true;
        if (currentTask != null) currentTask.cancel(true);
        HttpsURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
        worker.shutdownNow();
        main.removeCallbacksAndMessages(null);
    }
}
