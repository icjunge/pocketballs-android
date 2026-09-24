package com.idleballs.pocket;

/** Run using javac/java without Android; exercises security boundaries, not UI implementation. */
public final class UpdatePolicyTest {
    private static int checks;
    private static final String HASH = repeat("a", 64);
    private static final String APK = "https://raw.githubusercontent.com/icjunge/pocketballs-android/main/releases/v0.1.1/PocketBalls-0.1.1-Fold7.apk";

    private static String repeat(String value, int count) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < count; i++) result.append(value);
        return result.toString();
    }

    private static void check(boolean value, String name) {
        checks++;
        if (!value) throw new AssertionError(name);
    }

    private static void rejects(Runnable value, String name) {
        try { value.run(); }
        catch (IllegalArgumentException expected) { checks++; return; }
        throw new AssertionError("Accepted " + name);
    }

    private static UpdatePolicy.Release release(long version, int sdk, String url, String hash, long size) {
        return new UpdatePolicy.Release(version, "0.1.1", UpdatePolicy.PACKAGE_NAME, sdk, url, hash, size, "更新说明");
    }

    public static void main(String[] args) {
        UpdatePolicy.Release release = release(2, 26, APK, HASH, 1024);
        UpdatePolicy.requireFeedUrl(UpdatePolicy.FEED_URL);
        UpdatePolicy.requireUpgrade(release, 1, 36);
        check(release.versionCode == 2, "valid upgrade");
        check(release.sha256.equals(HASH), "digest retained");
        String[] bad = {
            APK.replace("https:", "http:"),
            APK.replace("raw.githubusercontent.com", "raw.githubusercontent.com.evil.example"),
            APK.replace("raw.githubusercontent.com", "raw.githubusercontent.com@evil.example"),
            APK.replace("raw.githubusercontent.com", "user@raw.githubusercontent.com"),
            APK.replace("raw.githubusercontent.com", "raw.githubusercontent.com:443"),
            APK.replace("/icjunge/", "/other-owner/"),
            APK.replace("/main/", "/other-branch/"),
            APK.replace("/releases/", "/updates/"),
            APK.replace("v0.1.1/", "v0.1.0/"),
            APK.replace("v0.1.1/", "v0.1.1/../"),
            APK.replace("v0.1.1/", "v0.1.1/%2e%2e/"),
            APK.replace("v0.1.1/", "v0.1.1/subfolder/"),
            APK.replace(".apk", ".apk.exe"),
            APK + "?download=1", APK + "#fragment",
            "javascript:alert(1)", "file:///tmp/fake.apk", null
        };
        for (String url : bad) rejects(() -> UpdatePolicy.requireApkUrl(url, "0.1.1"), "untrusted URL " + url);
        rejects(() -> UpdatePolicy.requireFeedUrl(UpdatePolicy.FEED_URL + "?timestamp=1"), "feed query");
        rejects(() -> UpdatePolicy.requireFeedUrl(APK), "APK as manifest");
        rejects(() -> release(0, 26, APK, HASH, 1024), "zero version");
        rejects(() -> release(-1, 26, APK, HASH, 1024), "negative version");
        rejects(() -> release((long) Integer.MAX_VALUE + 1, 26, APK, HASH, 1024), "version overflow");
        rejects(() -> release(2, 25, APK, HASH, 1024), "unsupported manifest minSdk");
        rejects(() -> release(2, 26, APK, "abc", 1024), "short digest");
        rejects(() -> release(2, 26, APK, repeat("z", 64), 1024), "non-hex digest");
        rejects(() -> release(2, 26, APK, HASH, 0), "empty APK");
        rejects(() -> release(2, 26, APK, HASH, UpdatePolicy.MAX_APK_BYTES + 1), "oversized APK");
        rejects(() -> UpdatePolicy.requireUpgrade(release, 2, 36), "same version reinstall");
        rejects(() -> UpdatePolicy.requireUpgrade(release, 3, 36), "downgrade");
        rejects(() -> UpdatePolicy.requireUpgrade(release, 1, 25), "unsupported device SDK");
        rejects(() -> new UpdatePolicy.Release(2, "0.1.1", "other.package", 26, APK, HASH, 1024, ""), "wrong package");
        rejects(() -> new UpdatePolicy.Release(2, "0.1.1", UpdatePolicy.PACKAGE_NAME, 26, APK, HASH, 1024, repeat("x", 4001)), "oversized notes");
        rejects(() -> UpdatePolicy.requireDigest(HASH, repeat("b", 64)), "tampered digest");
        rejects(() -> UpdatePolicy.requireDigest(HASH, null), "missing digest");
        UpdatePolicy.requireDigest(HASH, HASH.toUpperCase());
        check(UpdatePolicy.sameSigners(new byte[][] {{1, 2}}, new byte[][] {{1, 2}}), "exact same signer");
        check(!UpdatePolicy.sameSigners(new byte[][] {{1, 2}}, new byte[][] {{1, 3}}), "wrong signer");
        check(!UpdatePolicy.sameSigners(null, new byte[][] {{1, 2}}), "missing installed signer");
        check(!UpdatePolicy.sameSigners(new byte[][] {{}}, new byte[][] {{}}), "empty signer");
        check(!UpdatePolicy.sameSigners(new byte[][] {{1}, {2}}, new byte[][] {{1}, {1}}), "duplicate signer cannot replace another");
        check(UpdatePolicy.sameSigners(new byte[][] {{1}, {2}}, new byte[][] {{2}, {1}}), "unordered signer set");
        check(UpdatePolicy.shouldCheck(100, 0), "first startup");
        check(!UpdatePolicy.shouldCheck(1000, 900), "fresh successful check throttled");
        check(UpdatePolicy.shouldCheck(100, 200), "clock rollback triggers recheck");
        check(UpdatePolicy.shouldCheck(1000 + UpdatePolicy.CHECK_INTERVAL_MS, 1000), "six-hour check");
        System.out.println("UpdatePolicyTest: " + checks + " checks passed");
    }
}
