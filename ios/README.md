# 球屿 iOS · 免费账号真机测试

这是可在自己的 Mac 上编译、签名并运行的 Xcode 工程。免费 Apple Account 的 Personal Team 即可；不需要先付费加入开发者计划。

## 第一次安装

1. 下载并解压完整仓库，保留 `ios/` 和 `app/` 的相对位置。只复制 `.xcodeproj` 会丢失共享场景资源。
2. 双击 `ios/PocketBalls.xcodeproj` 打开工程。
3. 用数据线连接并解锁 iPhone，在手机上确认“信任此电脑”。Xcode 若首次要求安装 iOS 平台组件，按提示完成。
4. 在左侧点蓝色 **PocketBalls** 工程图标，选择 **TARGETS → PocketBalls → Signing & Capabilities**。保持 **Automatically manage signing** 勾选，**Team** 选择你自己的 **Personal Team**。
5. 默认 Bundle Identifier 为 `com.icjunge.pocketballs`。如果提示标识已被占用，改为自己的唯一后缀，例如 `com.icjunge.pocketballs.haojun`；之后尽量保持不变，以便覆盖安装并保留本机存档。
6. 在 Xcode 顶部选择 **PocketBalls** scheme，运行设备选择你的 **iPhone**，不要选模拟器或 “Any iOS Device”。按 **⌘R** 或左上角三角形运行。
7. 若提示 Developer Mode Disabled：先让 Xcode 与手机完成配对，再在 iPhone **设置 → 隐私与安全性 → 开发者模式** 中开启，按提示重启并确认，然后回到 Xcode 再运行。
8. 若手机提示“不受信任的开发者”，在 **设置 → 通用 → VPN 与设备管理** 中选择自己的开发者账号并信任，再打开球屿。

第一次成功运行后可以拔掉数据线，从手机桌面打开球屿。免费签名的描述文件从签发起有效 7 天，到期后在同一个工程中选择相同 Team、保持相同 Bundle Identifier，再按 ⌘R 构建安装。

## Xcode 与手机系统

面向 iOS 27 测试时，建议使用 Xcode 27 正式版获得相应 SDK 和工具支持。苹果当前要求 Xcode 27 运行在 macOS Tahoe 26.6 或更新版本上；Xcode 菜单 → About Xcode 可查看版本。

本工程最低运行系统设为 iOS 16，使用 Swift 5 语言模式。最低运行版本不表示必须把手机降级。旧版 Xcode 能否调试更高版本 iOS，还取决于苹果列出的 Device Support 和实际设备配对结果；不能只看 SDK 版本推断。

若 Xcode 的设备栏显示 unavailable 或 preparing，一般先完成平台组件安装、设备配对和开发者模式开启。不要为排查签名问题卸载球屿，否则本机保存的球体设置也会被删除。

## 这一版的体验

- 沿用 Android 版的足球、网球、篮球、排球和混合模式，网球尺寸较小。
- 默认全屏，仅右上角保留折叠菜单；可调整 1–32 个球、暂停和重新摆放。
- Core Motion 提供融合后的重力，按实际屏幕方向映射：屏幕哪边低，小球往哪边滚。
- 全屏画面延伸至屏幕边缘，操作按钮避开刘海、灵动岛和系统安全区域。
- 横竖屏切换调整盒子尺寸；保存球体类型、数量、位置和暂停状态。
- 进入后台停止动作采样和绘制，返回时恢复。模拟器没有真实动作传感器，可以拖动画面或在菜单开启自动演示；真实倾斜效果必须用 iPhone 验收。
- 场景、美术及脚本全部随应用打包，可以离线运行。

## 后续更新

免费直连测试版通过 Xcode 再次运行来更新。它不会下载或安装 Android APK，也没有 TestFlight 自动分发配置。需要方便地持续分发时，再加入 Apple Developer Program 并接入 TestFlight。

## 源码与验证

`PocketBalls.xcodeproj` 直接把 `../app/src/main/assets` 作为目录资源打进应用，原生代码从 bundle 内的 `assets/index.html` 加载。共享 JavaScript 中的 `AndroidPocket` 是既有桥接接口名称，iOS 提供兼容实现；Android 专用的 APK 更新入口在 iOS 中隐藏。

GitHub Actions 的 iOS 工作流验证真机架构的无签名编译、重力方向映射与资源打包。云端生成的无签名产物不等于可以在你的 iPhone 上直接安装；最终真机签名在你的 Mac 上由 Personal Team 完成。云端和模拟器检查不能代替真实 iPhone 的传感器延迟、帧率与系统安装验收。

Apple 官方参考：

- [Xcode 系统与设备支持](https://developer.apple.com/xcode/system-requirements/)
- [免费 Personal Team 与 7 天限制](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [开启开发者模式](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
- [自动管理开发描述文件](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile/)
