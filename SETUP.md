# 开发环境搭建指南

对齐 [read](https://github.com/fagagasdgg/read) 的 Capacitor + React + TypeScript 结构。

## 已就绪（本机常见环境）

| 工具 | 用途 |
|------|------|
| Node.js 24+ / npm | Web 与 Capacitor |
| JDK 17+ | Android 编译 |
| Android Studio / SDK | 真机或模拟器（可选） |

## 浏览器开发

```powershell
cd app
npm.cmd install
npm.cmd run dev
```

浏览器打开终端提示的地址（通常 `http://localhost:5173`）。

Web 预览下原生通知不可用；「来源」页提供样例数据注入，可验证解析、去重与统计。

## 同步 Android 工程

```powershell
cd app
npm.cmd run cap:sync
npm.cmd run cap:open:android
```

或使用 [GITHUB_BUILD.md](./GITHUB_BUILD.md) 云端打 debug APK。

## 真机权限

首次安装打开 App 会进入引导页，依次设置：

1. **通知使用权**（捕获微信 / 支付宝付款通知）
2. **电池优化白名单**（建议开启；国产机还可设自启动/后台）

也可稍后在「来源」页继续设置，或点「重新引导权限」。

通知监听由系统托管，一般不必把应用一直开在前台；保持通知使用权开启、避免强制停止即可。
