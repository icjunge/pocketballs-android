import Foundation

/// Personal Team builds can check versions, but Xcode must sign and install them.
/// This class intentionally has no APK, IPA installation or script-update path.
final class PocketUpdateChecker: NSObject, URLSessionDataDelegate {
    struct Release {
        let version: String
        let build: Int
        let source: URL
        let notes: String
    }

    static let manifestURL = URL(string: "https://raw.githubusercontent.com/icjunge/pocketballs-android/main/updates/latest.json")!
    static let sourceURL = URL(string: "https://github.com/icjunge/pocketballs-android/archive/refs/heads/main.zip")!
    private static let maximumBytes = 64 * 1024
    private static let checkDateKey = "pocket-ios-update-check-date"
    private static let cachedManifestKey = "pocket-ios-update-manifest"
    private let installedVersion: String
    private let installedBuild: Int
    private let defaults: UserDefaults
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var lastStatus: [String: Any]?
    private(set) var release: Release?
    var onStatus: (([String: Any]) -> Void)?

    init(bundle: Bundle = .main, defaults: UserDefaults = .standard) {
        self.installedVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.2.0"
        self.installedBuild = Int(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "3") ?? 3
        self.defaults = defaults
        super.init()
        if let data = defaults.data(forKey: Self.cachedManifestKey),
           let cached = Self.parse(data), cached.build > installedBuild {
            release = cached
        }
    }

    func sceneReady() {
        if let status = lastStatus {
            onStatus?(status)
        } else if let release = release {
            emit("available", "发现新版本 \(release.version)，需通过 Mac 更新", action: "查看更新方法")
        } else {
            emit("idle", "测试版更新需通过 Mac 安装")
        }
        let last = defaults.double(forKey: Self.checkDateKey)
        let elapsed = Date().timeIntervalSince1970 - last
        if elapsed < 0 || elapsed >= 6 * 60 * 60 { check() }
    }

    func check() {
        guard task == nil else { return }
        emit("checking", "正在检查新版本…", busy: true)
        received.removeAll(keepingCapacity: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.session = session
        var request = URLRequest(url: Self.manifestURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func cancel() {
        task = nil
        session?.invalidateAndCancel()
        session = nil
        received.removeAll()
    }

    // All callbacks use the main operation queue, as do the scene's bridge calls.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url == Self.manifestURL ? request : nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard dataTask === task, response.url == Self.manifestURL,
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.expectedContentLength <= Int64(Self.maximumBytes) else {
            completionHandler(.cancel); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task else { return }
        guard received.count + data.count <= Self.maximumBytes else { dataTask.cancel(); return }
        received.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        self.task = nil
        self.session = nil
        session.finishTasksAndInvalidate()
        let data = received
        received.removeAll(keepingCapacity: true)
        guard error == nil, let latest = Self.parse(data) else {
            if let release = release {
                emit("available", "暂时无法检查，已有 \(release.version) 的更新信息", action: "查看更新方法")
            } else {
                emit("error", "暂时无法检查更新，请稍后重试")
            }
            return
        }
        defaults.set(Date().timeIntervalSince1970, forKey: Self.checkDateKey)
        defaults.set(data, forKey: Self.cachedManifestKey)
        if latest.build > installedBuild {
            release = latest
            emit("available", "发现新版本 \(latest.version)，需通过 Mac 更新", action: "查看更新方法")
        } else {
            release = nil
            emit("latest", "已是最新版本 · 测试版更新需通过 Mac 安装")
        }
    }

    private func emit(_ state: String, _ message: String, action: String? = nil, busy: Bool = false) {
        var status: [String: Any] = ["state": state, "message": message, "busy": busy,
                                     "installedVersionName": installedVersion, "platform": "ios"]
        if let action = action { status["actionLabel"] = action }
        if let release = release {
            status["versionName"] = release.version
            status["notes"] = release.notes
        }
        lastStatus = status
        onStatus?(status)
    }

    // Internal for the standalone manifest-boundary checks in ios/Tests.
    static func parse(_ data: Data) -> Release? {
        guard data.count <= maximumBytes,
              let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let ios = manifest["ios"] as? [String: Any],
              let build = ios["buildNumber"] as? Int, (1...Int(Int32.max)).contains(build),
              let version = ios["versionName"] as? String, !version.isEmpty, version.count <= 32,
              version.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "0123456789.-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ").contains($0) }),
              let sourceString = ios["sourceUrl"] as? String, sourceString == sourceURL.absoluteString,
              let source = URL(string: sourceString) else { return nil }
        let notes = String((ios["notes"] as? String ?? "").prefix(1200))
        return Release(version: version, build: build, source: source, notes: notes)
    }
}
