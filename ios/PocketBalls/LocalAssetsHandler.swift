import Foundation
import WebKit

/// A read-only virtual origin. No file:// access, remote fetch, or path traversal.
final class LocalAssetsHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pocketballs"
    static let entryURL = URL(string: "pocketballs://scene/index.html")!
    private let root: URL?
    private static let contentPolicy = "default-src 'none'; script-src pocketballs: 'unsafe-inline'; "
        + "style-src 'unsafe-inline'; img-src pocketballs: data: blob:; font-src pocketballs: data:; "
        + "connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; "
        + "base-uri 'none'; form-action 'none'; worker-src 'none'; media-src 'none'"

    init(bundle: Bundle = .main) {
        root = bundle.resourceURL?.appendingPathComponent("assets", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        super.init()
    }

    static func isEntryURL(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return safeRelativePath(url) == "index.html"
    }

    private static func safeRelativePath(_ url: URL) -> String? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == scheme, parts.host == "scene", parts.port == nil,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.hasPrefix("/") else { return nil }
        let path = String(parts.percentEncodedPath.dropFirst())
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-")
        guard !path.isEmpty, path.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        return path
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard urlSchemeTask.request.httpMethod == nil || urlSchemeTask.request.httpMethod == "GET",
              let url = urlSchemeTask.request.url, let root = root,
              let relative = Self.safeRelativePath(url) else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        let file = root.appendingPathComponent(relative).resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        do {
            var data = try Data(contentsOf: file)
            let mime: String
            switch file.pathExtension.lowercased() {
            case "html": mime = "text/html"
            case "js": mime = "application/javascript"
            case "css": mime = "text/css"
            case "json": mime = "application/json"
            case "png": mime = "image/png"
            case "jpg", "jpeg": mime = "image/jpeg"
            case "webp": mime = "image/webp"
            case "svg": mime = "image/svg+xml"
            default: throw URLError(.noPermissionsToReadFile)
            }
            if mime == "text/html" {
                guard var html = String(data: data, encoding: .utf8),
                      let head = html.range(of: "<head>", options: .caseInsensitive) else {
                    throw URLError(.cannotDecodeContentData)
                }
                // A meta policy also applies on WebKit versions that do not treat
                // custom-scheme response headers as an HTTP security policy.
                let meta = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(Self.contentPolicy)\">"
                html.insert(contentsOf: meta, at: head.upperBound)
                data = Data(html.utf8)
            }
            guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": mime + (mime.hasPrefix("text/") || mime == "application/javascript" ? "; charset=utf-8" : ""),
                               "Content-Security-Policy": Self.contentPolicy,
                               "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"]) else {
                throw URLError(.badServerResponse)
            }
            // All callbacks finish synchronously on WebKit's calling thread: there
            // is no outstanding asynchronous task to access after stop is called.
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
