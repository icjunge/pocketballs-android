package com.idleballs.pocket;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Locale;

/** Pure Java update rules, shared by production code and desktop validation. */
public final class UpdatePolicy {
    public static final String PACKAGE_NAME = "com.idleballs.pocket";
    public static final String HOST = "raw.githubusercontent.com";
    public static final String REPOSITORY = "/icjunge/pocketballs-android/main/";
    public static final String FEED_URL = "https://" + HOST + REPOSITORY + "updates/latest.json";
    public static final long MAX_APK_BYTES = 16L * 1024 * 1024;
    public static final int MAX_MANIFEST_BYTES = 64 * 1024;
    public static final long CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000;

    private UpdatePolicy() { }

    public static final class Release {
        public final long versionCode, sizeBytes;
        public final String versionName, packageName, url, sha256, notes;
        public final int minSdk;

        public Release(long versionCode, String versionName, String packageName,
                int minSdk, String url, String sha256, long sizeBytes, String notes) {
            if (versionCode < 1 || versionCode > Integer.MAX_VALUE)
                throw new IllegalArgumentException("版本信息无效");
            if (versionName == null || versionName.length() > 48
                    || !versionName.matches("[0-9]+(?:\\.[0-9]+){1,3}(?:-[A-Za-z0-9.-]+)?"))
                throw new IllegalArgumentException("版本名称无效");
            if (!PACKAGE_NAME.equals(packageName)) throw new IllegalArgumentException("更新不属于球屿");
            if (minSdk < 26 || minSdk > 1000) throw new IllegalArgumentException("系统版本信息无效");
            if (sha256 == null || !sha256.matches("[A-Fa-f0-9]{64}"))
                throw new IllegalArgumentException("更新校验信息无效");
            if (sizeBytes <= 0 || sizeBytes > MAX_APK_BYTES)
                throw new IllegalArgumentException("安装包大小无效");
            if (notes == null || notes.length() > 4000) throw new IllegalArgumentException("更新说明过长");
            requireApkUrl(url, versionName);
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.packageName = packageName;
            this.minSdk = minSdk;
            this.url = url;
            this.sha256 = sha256.toLowerCase(Locale.ROOT);
            this.sizeBytes = sizeBytes;
            this.notes = notes;
        }
    }

    public static void requireFeedUrl(String value) {
        requireTrustedUri(value);
        if (!FEED_URL.equals(value)) throw new IllegalArgumentException("更新地址无效");
    }

    public static void requireApkUrl(String value, String versionName) {
        URI uri = requireTrustedUri(value);
        String prefix = REPOSITORY + "releases/v" + versionName + "/";
        String path = uri.getRawPath();
        if (!path.startsWith(prefix)
                || !path.substring(prefix.length()).matches("[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.apk"))
            throw new IllegalArgumentException("安装包地址不可信");
    }

    private static URI requireTrustedUri(String value) {
        try {
            if (value == null || value.length() > 1024) throw new URISyntaxException("", "length");
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())
                    || uri.getPort() != -1 || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getRawPath() == null || uri.getRawPath().contains("%")
                    || uri.getRawPath().contains("\\") || uri.getRawPath().contains(".."))
                throw new URISyntaxException(value, "untrusted");
            return uri;
        } catch (URISyntaxException invalid) {
            throw new IllegalArgumentException("更新地址不可信");
        }
    }

    public static void requireUpgrade(Release release, long installedCode, int deviceSdk) {
        if (release.versionCode <= installedCode) throw new IllegalArgumentException("此版本已安装，无需更新");
        if (release.minSdk > deviceSdk) throw new IllegalArgumentException("此更新需要更高版本的 Android");
    }

    public static boolean shouldCheck(long now, long lastSuccess) {
        return lastSuccess <= 0 || now < lastSuccess || now - lastSuccess >= CHECK_INTERVAL_MS;
    }

    public static void requireDigest(String expected, String actual) {
        if (expected == null || actual == null || !expected.equalsIgnoreCase(actual))
            throw new IllegalArgumentException("安装包校验失败，请重新下载");
    }

    public static boolean sameSigners(byte[][] installed, byte[][] candidate) {
        if (installed == null || candidate == null || installed.length == 0
                || installed.length != candidate.length) return false;
        boolean[] used = new boolean[candidate.length];
        for (byte[] signer : installed) {
            if (signer == null || signer.length == 0) return false;
            boolean found = false;
            for (int i = 0; i < candidate.length; i++) {
                if (!used[i] && Arrays.equals(signer, candidate[i])) {
                    used[i] = true; found = true; break;
                }
            }
            if (!found) return false;
        }
        return true;
    }
}
