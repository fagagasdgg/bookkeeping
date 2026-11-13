# 本地记账

纯本地 Android 记账应用（Capacitor + React + TypeScript）。

## 能力

- **通知**：微信 / 支付宝 / 银行 App / 动账短信通知（授权后增量捕获）
- **短信**：填写发件号码即可扫描会话内动账（服务号隔离时可能读不到）
- **去重**：同源指纹去重 + 疑似重复待确认
- **统计**：日/周/月收支结余、分类与渠道占比、明细搜索与改分类

不做云端备份，数据仅存本机 IndexedDB。

## 目录

```
bookkeeping/
├── SETUP.md
├── APK_BUILD.md
├── GITHUB_BUILD.md
├── .github/workflows/build-apk.yml
└── app/                 # Capacitor + React + TS
    ├── src/components/  # 统计 / 明细 / 来源 / 待确认
    ├── src/services/    # 解析、分类、去重、入库、统计
    ├── src/plugins/     # Capacitor 插件 TS 封装
    └── android/         # 原生 NotifyListener + 后台保活
```

## 快速开始

见 [SETUP.md](./SETUP.md)。
