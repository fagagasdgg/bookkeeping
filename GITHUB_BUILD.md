# GitHub Actions 云端打包

推送到 `main`/`master` 且改动了 `app/**`，或手动 `workflow_dispatch`，会构建 debug APK。

## 使用

1. 将本仓库推送到 GitHub
2. 打开 Actions → **Build Android APK**
3. 下载 Artifact `bookkeeping-debug-apk`

## 本地触发条件

见 [.github/workflows/build-apk.yml](./.github/workflows/build-apk.yml)
