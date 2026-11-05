# 本地记账

纯本地 Android 记账应用（Capacitor + React + TypeScript）。

## 能力

- **通知**：支付宝 / 微信等支付通知（授权后增量捕获）
- **短信**：按号码/备注配置来源，检索收件箱历史；可实时接收
- **去重**：同源指纹去重 + 跨通道（通知↔银行卡短信）高置信合并 + 疑似重复待确认
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
    └── android/         # 原生 SmsReader + NotifyListener
```

## 快速开始

见 [SETUP.md](./SETUP.md)。
