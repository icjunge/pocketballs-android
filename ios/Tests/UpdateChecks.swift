import Foundation

@main
enum UpdateChecks {
    static func main() throws {
        var checks = 0
        let valid: [String: Any] = ["versionName": "0.2.0", "buildNumber": 3,
            "sourceUrl": PocketUpdateChecker.sourceURL.absoluteString, "notes": "指尖拨球"]
        func encoded(_ ios: [String: Any]) throws -> Data {
            try JSONSerialization.data(withJSONObject: ["ios": ios])
        }
        func reject(_ field: String, _ value: Any) throws {
            var changed = valid
            changed[field] = value
            let data = try encoded(changed)
            precondition(PocketUpdateChecker.parse(data) == nil,
                         "Accepted invalid iOS manifest field: \(field)")
            checks += 1
        }
        let parsed = PocketUpdateChecker.parse(try encoded(valid))
        precondition(parsed?.build == 3 && parsed?.version == "0.2.0" && parsed?.notes == "指尖拨球")
        checks += 1
        try reject("sourceUrl", "http://github.com/icjunge/pocketballs-android/archive/refs/heads/main.zip")
        try reject("sourceUrl", "https://github.com.evil.example/icjunge/pocketballs-android/archive/refs/heads/main.zip")
        try reject("sourceUrl", "https://github.com/icjunge/pocketballs-android/releases/download/v0.2.0/PocketBalls.apk")
        try reject("sourceUrl", PocketUpdateChecker.sourceURL.absoluteString + "?redirect=anything")
        try reject("sourceUrl", "javascript:alert(1)")
        try reject("buildNumber", -1)
        try reject("buildNumber", "3")
        try reject("buildNumber", Int64(Int32.max) + 1)
        try reject("versionName", "")
        try reject("versionName", "0.2.0\n提示注入")
        precondition(PocketUpdateChecker.parse(Data(repeating: 65, count: 65_537)) == nil)
        precondition(PocketUpdateChecker.parse(Data("{\"versionCode\":3,\"url\":\"https://example.com/app.apk\"}".utf8)) == nil)
        precondition(PocketUpdateChecker.parse(Data("{}".utf8)) == nil)
        checks += 3
        print("PASS: \(checks) iOS update-manifest checks (source allowlist, schema, limits, Android separation)")
    }
}
