import UIKit
import WebKit
import CoreMotion
import QuartzCore

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

private final class WeakDisplayLinkTarget: NSObject {
    weak var owner: PocketViewController?
    init(_ owner: PocketViewController) { self.owner = owner }
    @objc func tick(_ link: CADisplayLink) { owner?.deliverGravity() }
}

final class PocketViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private static let stateKey = "pocket-balls-state-v1"
    private static let maximumStateBytes = 512 * 1024
    private let defaults = UserDefaults.standard
    private let motionManager = CMMotionManager()
    private let feedback = PocketFeedback()
    private let updater = PocketUpdateChecker()

    private var webView: WKWebView?
    private var displayLink: CADisplayLink?
    private var sceneActive = false
    private var webReady = false
    private var motionRunning = false
    private var sensorUsable = false
    private var gravityInFlight = false
    private var bridgeGeneration: UInt64 = 0
    private var lastDeliveredTimestamp: TimeInterval?
    private var lastDeliveredOrientation: PocketScreenOrientation?
    private var lastBridgeRoundTripMs: Double = 0
    private var rendererRecoveries = 0
    private var saveTask: UIBackgroundTaskIdentifier = .invalid

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 241/255, green: 238/255, blue: 231/255, alpha: 1)
        sensorUsable = motionManager.isDeviceMotionAvailable
        updater.onStatus = { [weak self] status in self?.callScene("onUpdateStatus", [status]) }
        createWebView()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if view.window?.windowScene?.activationState == .foregroundActive {
            setSceneActive(true)
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        sendInsets()
    }

    override func viewWillTransition(to size: CGSize,
                                     with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.lastDeliveredOrientation = nil
            self?.sendInsets()
            self?.deliverGravity()
        }
    }

    func setSceneActive(_ active: Bool) {
        loadViewIfNeeded()
        guard sceneActive != active else { return }
        sceneActive = active
        feedback.setActive(active)
        bridgeGeneration &+= 1
        gravityInFlight = false
        if active {
            finishSaveTask()
            startMotion()
            callScene("onVisibility", [true])
            sendInsets()
            sendSensorStatus()
            startDisplayLinkIfReady()
        } else {
            stopMotion()
            guard webReady else { return }
            // Ask the page to persist before WebKit is suspended. The page also
            // saves after edits and every 1.2 seconds, so renderer recovery is safe.
            finishSaveTask()
            saveTask = UIApplication.shared.beginBackgroundTask(withName: "PocketState") { [weak self] in
                self?.finishSaveTask()
            }
            callScene("onVisibility", [false]) { [weak self] in
                DispatchQueue.main.async { self?.finishSaveTask() }
            }
        }
    }

    private func createWebView() {
        webReady = false
        bridgeGeneration &+= 1
        gravityInFlight = false
        lastDeliveredTimestamp = nil
        lastDeliveredOrientation = nil
        displayLink?.invalidate()
        displayLink = nil
        let controller = WKUserContentController()
        controller.add(WeakScriptHandler(self), name: "pocket")
        controller.addUserScript(WKUserScript(source: bridgeScript(), injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.setURLSchemeHandler(LocalAssetsHandler(), forURLScheme: LocalAssetsHandler.scheme)
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsBackForwardNavigationGestures = false
        webView = web
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        web.load(URLRequest(url: LocalAssetsHandler.entryURL))
    }

    private func bridgeScript() -> String {
        let stored = defaults.string(forKey: Self.stateKey) ?? ""
        let seed: [String: Any] = [
            "state": validState(stored) ? stored : "",
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.2.0",
            "sensorAvailable": motionManager.isDeviceMotionAvailable
        ]
        let seedJSON = Self.json(seed) ?? "{}"
        var script = """
        (() => {
          'use strict';
          const seed = \(seedJSON);
          let state = seed.state || '';
          const post = (action, value) => window.webkit.messageHandlers.pocket.postMessage({action, value});
          Object.defineProperty(window, 'AndroidPocket', {value: Object.freeze({
            loadState: () => state,
            saveState: value => {
              if (typeof value !== 'string' || value.length > 524288) return;
              state = value;
              post('saveState', value);
            },
            ready: () => post('ready', null),
            versionName: () => seed.version,
            platform: () => 'ios',
            isSensorAvailable: () => !!seed.sensorAvailable,
            sensorType: () => seed.sensorAvailable ? 'core_motion' : 'unavailable',
            playFeedback: (type, strength, sound, haptics) => {
              if (typeof type !== 'string' || !Number.isFinite(strength)) return;
              post('playFeedback', {type, strength, sound: sound === true, haptics: haptics === true, sentAt: Date.now()});
            },
            setFeedbackState: (active, sound, haptics) => post('setFeedbackState', {
              active: active === true, sound: sound === true, haptics: haptics === true
            }),
            checkForUpdates: () => post('checkForUpdates', null),
            downloadUpdate: () => post('updateInstructions', null),
            installUpdate: () => post('updateInstructions', null),
            copyDiagnostics: value => {
              if (typeof value === 'string' && value.length <= 8192) post('copyDiagnostics', value);
            }
          }), writable: false, configurable: false});
          document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = '#pocket-android{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}';
            document.head.appendChild(style);
          }, {once: true});
        })();
        """
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--pocket-smoke") {
            script += """
            window.addEventListener('error', event => {
              window.webkit.messageHandlers.pocket.postMessage({action:'debugError',value:String(event.message || 'script error')});
            });
            """
        }
        #endif
        return script
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.webView === webView, message.frameInfo.isMainFrame,
              LocalAssetsHandler.isEntryURL(message.frameInfo.request.url),
              let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else { return }
        switch action {
        case "ready":
            webReady = true
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--pocket-smoke") {
                NSLog("PocketBalls scene ready")
            }
            #endif
            sendInsets()
            sendSensorStatus()
            callScene("onVisibility", [sceneActive])
            startDisplayLinkIfReady()
            deliverGravity()
            updater.sceneReady()
        case "saveState":
            if let state = payload["value"] as? String, validState(state) {
                defaults.set(state, forKey: Self.stateKey)
                // WKUserScripts are reused on location.reload(). Refresh the next
                // document's seed as well as defaults, so WebGL context recovery
                // cannot jump back to the state from the first launch.
                userContentController.removeAllUserScripts()
                userContentController.addUserScript(WKUserScript(source: bridgeScript(),
                    injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
        case "playFeedback":
            if sceneActive, let value = payload["value"] as? [String: Any],
               let type = value["type"] as? String, let strength = value["strength"] as? Double,
               let sentAt = value["sentAt"] as? Double, sentAt.isFinite,
               (-20.0...150.0).contains(Date().timeIntervalSince1970 * 1000 - sentAt) {
                feedback.play(type: type, strength: strength,
                              sound: value["sound"] as? Bool == true,
                              haptics: value["haptics"] as? Bool == true)
            }
        case "setFeedbackState":
            if let value = payload["value"] as? [String: Any] {
                feedback.setPreferences(active: value["active"] as? Bool == true,
                                        sound: value["sound"] as? Bool == true,
                                        haptics: value["haptics"] as? Bool == true)
            }
        case "checkForUpdates":
            updater.check()
        case "updateInstructions":
            showUpdateInstructions()
        case "copyDiagnostics":
            if sceneActive, let value = payload["value"] as? String, value.utf16.count <= 8192 {
                UIPasteboard.general.string = value
            }
        #if DEBUG
        case "debugError":
            if let error = payload["value"] as? String {
                NSLog("PocketBalls scene error: %@", String(error.prefix(500)))
            }
        #endif
        default: break
        }
    }

    private func validState(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= Self.maximumStateBytes,
              let data = value.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let schema = object["schema"] as? Int, schema == 1,
              let balls = object["balls"] as? [[String: Any]], (1...32).contains(balls.count) else { return false }
        return true // Detailed finite numbers and bounds are validated by the scene.
    }

    private func startMotion() {
        guard !motionRunning else { return }
        sensorUsable = motionManager.isDeviceMotionAvailable
        guard sensorUsable else { return } // Simulator retains the scene's demo mode.
        lastDeliveredTimestamp = nil
        lastDeliveredOrientation = nil
        lastBridgeRoundTripMs = 0
        motionRunning = true
        motionManager.deviceMotionUpdateInterval = 1.0 / 120.0
        // Poll Core Motion's newest fused sample at presentation time. No per-sample
        // OperationQueue blocks, app-side smoothing, or old-event replay can build up.
        motionManager.startDeviceMotionUpdates(using: .xArbitraryZVertical)
    }

    private func stopMotion() {
        motionManager.stopDeviceMotionUpdates()
        motionRunning = false
        lastDeliveredTimestamp = nil
        displayLink?.invalidate()
        displayLink = nil
    }

    private func startDisplayLinkIfReady() {
        guard sceneActive, webReady, motionRunning, displayLink == nil else { return }
        let link = CADisplayLink(target: WeakDisplayLinkTarget(self), selector: #selector(WeakDisplayLinkTarget.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    fileprivate func deliverGravity() {
        guard sceneActive, webReady, !gravityInFlight, let web = webView else { return }
        guard let sample = motionManager.deviceMotion else { return }
        let orientation: PocketScreenOrientation
        // Read the current scene, never UIDevice.orientation: orientation lock,
        // face-up placement, and UIKit landscape naming must all stay correct.
        switch view.window?.windowScene?.interfaceOrientation {
        case .portraitUpsideDown: orientation = .portraitUpsideDown
        case .landscapeLeft: orientation = .landscapeLeft
        case .landscapeRight: orientation = .landscapeRight
        default: orientation = .portrait
        }
        guard sample.timestamp != lastDeliveredTimestamp || orientation != lastDeliveredOrientation,
              let gravity = MotionGravity.screen(x: sample.gravity.x, y: sample.gravity.y,
                                                 z: sample.gravity.z, orientation: orientation) else { return }
        let ageMs = max(0, (ProcessInfo.processInfo.systemUptime - sample.timestamp) * 1000)
        guard ageMs.isFinite,
              let arguments = Self.json([gravity.x, gravity.y, gravity.z, ageMs, lastBridgeRoundTripMs]) else { return }
        lastDeliveredTimestamp = sample.timestamp
        lastDeliveredOrientation = orientation
        gravityInFlight = true
        let generation = bridgeGeneration
        let dispatched = CACurrentMediaTime()
        web.evaluateJavaScript("if(window.PocketNative){PocketNative.onGravity.apply(PocketNative,\(arguments));}") { [weak self, weak web] _, _ in
            guard let self = self, self.webView === web, self.bridgeGeneration == generation else { return }
            self.gravityInFlight = false
            self.lastBridgeRoundTripMs = max(0, (CACurrentMediaTime() - dispatched) * 1000)
            // After a busy WebKit frame, immediately replace the old sample. Only
            // one evaluation may be in flight; never enqueue a history of tilts.
            if self.lastBridgeRoundTripMs > 33 { self.deliverGravity() }
        }
    }

    private func sendInsets() {
        guard isViewLoaded else { return }
        let inset = view.safeAreaInsets
        // UIKit points match CSS pixels with the page's width=device-width.
        // Dividing by screen scale again would put buttons underneath the notch.
        callScene("onInsets", [inset.top, inset.right, inset.bottom, inset.left])
    }

    private func sendSensorStatus() {
        callScene("onSensorStatus", [["available": sensorUsable, "active": motionRunning,
                                     "type": sensorUsable ? "core_motion" : "unavailable", "requestedHz": 120,
                                     "delivery": "latest_sample", "bridgeRoundTripMs": lastBridgeRoundTripMs]])
    }

    private func showUpdateInstructions() {
        guard sceneActive, presentedViewController == nil else { return }
        let release = updater.release
        let title = release.map { "更新到 \($0.version)" } ?? "测试版更新"
        let notes = release?.notes ?? ""
        let instructions = "当前使用免费签名，需在 Mac 上更新：\n\n"
            + "1. 下载并解压完整工程，打开 ios/PocketBalls.xcodeproj。\n"
            + "2. 保持原来的 Team 和 Bundle Identifier。\n"
            + "3. 连接 iPhone，在 Xcode 按 ⌘R 覆盖安装。\n\n"
            + "无需卸载球屿。免费签名到期后也需要通过 Xcode 重新安装。"
        let alert = UIAlertController(title: title,
            message: (notes.isEmpty ? "" : notes + "\n\n") + instructions, preferredStyle: .alert)
        let source = release?.source ?? PocketUpdateChecker.sourceURL
        alert.addAction(UIAlertAction(title: "复制下载链接", style: .default) { _ in
            UIPasteboard.general.url = source
        })
        alert.addAction(UIAlertAction(title: "打开源码下载", style: .default) { _ in
            // The URL comes exclusively from the updater's exact HTTPS allowlist.
            UIApplication.shared.open(source)
        })
        alert.addAction(UIAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }

    private func callScene(_ method: String, _ arguments: [Any], completion: (() -> Void)? = nil) {
        guard webReady, let web = webView, let data = Self.json(arguments) else { completion?(); return }
        // Only private, fixed method names enter this expression. Every data value
        // is encoded as JSON, including state loaded during bootstrap.
        web.evaluateJavaScript("if(window.PocketNative&&PocketNative.\(method)){PocketNative.\(method).apply(PocketNative,\(data));}") { _, _ in completion?() }
    }

    private static func json(_ object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    private func finishSaveTask() {
        guard saveTask != .invalid else { return }
        let task = saveTask
        saveTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.targetFrame?.isMainFrame == true
                        && LocalAssetsHandler.isEntryURL(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        sendInsets()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        webReady = false
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "pocket")
        webView.removeFromSuperview()
        self.webView = nil
        if rendererRecoveries == 0 {
            rendererRecoveries += 1
            createWebView() // Fresh bootstrap loads the latest native saved state.
        } else {
            displayLink?.invalidate()
            displayLink = nil
            showLoadFailure()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, (error as NSError).code != NSURLErrorCancelled else { return }
        showLoadFailure()
    }

    private func showLoadFailure() {
        let message = UILabel()
        message.text = "画面暂时无法加载\n请关闭球屿后重新打开"
        message.numberOfLines = 0
        message.textAlignment = .center
        message.textColor = UIColor(red: 62/255, green: 70/255, blue: 65/255, alpha: 1)
        message.font = .systemFont(ofSize: 18)
        message.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(message)
        NSLayoutConstraint.activate([
            message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            message.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            message.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
        ])
    }

    deinit {
        updater.cancel()
        feedback.setActive(false)
        motionManager.stopDeviceMotionUpdates()
        displayLink?.invalidate()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "pocket")
        if saveTask != .invalid { UIApplication.shared.endBackgroundTask(saveTask) }
    }
}
