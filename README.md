# 球屿 · Pocket Balls 0.1.0

面向三星 Galaxy Z Fold7 的离线小球测试应用，Android 8.0+，target SDK 35。

- 原生重力驱动物理：哪边低往哪边滚，支持横竖屏坐标转换。
- 外屏、展开内屏、旋转和分屏按窗口尺寸布局；普通折叠切换保留球体数量、大小和运动状态。
- 彩色足球/网球/篮球/排球，网球较小，1–32 个球；盒内深度、阴影、景深及随倾斜变化的视差。
- 默认全屏，右上角折叠毛玻璃菜单；无需登录、网络或 Shizuku。
- 原生 Android 生命周期与传感器 + 内置 WebGL 场景。此版用于确认效果，尚未在实体 Fold7 验收。

## 构建

Java 17 + Python 3：

```sh
python3 tools/restore-android-sdk.py /absolute/path/pocket-sdk
POCKETBALLS_ANDROID_SDK=/absolute/path/pocket-sdk bash tools/build-android.sh "$PWD"
```

脚本校验官方 SDK 下载的大小和 SHA-256，编译 Java/DEX、打包并校验 ZIP 对齐。

GitHub Actions 生成 `PocketBalls-build-input`，其中 APK **尚未签名，不能直接安装**。最终安装包在受控环境使用保留的开发密钥签名；签名密钥不提交到此仓库。后续版本使用同一密钥才能覆盖安装。

测试目标：四边倾斜、保持倾斜、外屏→内屏→外屏、横屏、分屏、后台返回、不同球与数量切换。手机真实帧率、One UI 折叠生命周期和安装结果需实机验证。

Three.js r160.1 按 MIT 许可证随包内置，其余美术纹理由程序生成。详见 THIRD_PARTY_NOTICES.md。
