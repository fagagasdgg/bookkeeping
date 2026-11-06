# 本机打包 APK

## 前置

- 已按 [SETUP.md](./SETUP.md) 安装 JDK 17+ 与 Android SDK
- 环境变量建议：`JAVA_HOME`、`ANDROID_HOME`

## 步骤

```powershell
cd app
npm.cmd install
npm.cmd run build
npx --yes cap sync android
cd android
.\gradlew.bat assembleDebug
```

产物：

`app/android/app/build/outputs/apk/debug/app-debug.apk`

安装到手机：

```powershell
adb install -r app\android\app\build\outputs\apk\debug\app-debug.apk
```

## 注意

- 通知使用权需在真机上手动授予
- 首次安装后打开 App 完成引导；建议关闭电池优化并允许自启动/后台
