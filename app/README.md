# app

Capacitor + React + TypeScript 主工程。

```powershell
npm.cmd install
npm.cmd run dev          # 浏览器
npm.cmd run cap:sync     # 构建并同步 Android
```

核心目录：

- `src/components` — 统计 / 明细 / 来源 / 待确认
- `src/services` — 解析、分类、指纹去重、跨通道合并、统计
- `src/plugins` — SmsReader / NotifyListener 封装
- `android/.../plugins` — 原生实现
