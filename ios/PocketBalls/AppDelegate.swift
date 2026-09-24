import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration",
                                                 sessionRole: connectingSceneSession.role)
        configuration.delegateClass = PocketSceneDelegate.self
        return configuration
    }
}

final class PocketSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = PocketViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        (window?.rootViewController as? PocketViewController)?.setSceneActive(true)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        (window?.rootViewController as? PocketViewController)?.setSceneActive(false)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        (window?.rootViewController as? PocketViewController)?.setSceneActive(false)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        (window?.rootViewController as? PocketViewController)?.setSceneActive(false)
    }
}
