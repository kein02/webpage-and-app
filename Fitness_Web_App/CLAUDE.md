# 健身计划 App — 项目约定

## 项目结构

```
健身计划App_test/
├── Build_Muscle/       # 增肌助手 Web App（主项目）
│   ├── index.html      # 入口页面
│   ├── style.css       # 样式
│   ├── app.js          # 业务逻辑（路由、状态管理、UI 渲染）
│   ├── data.js         # 动作库数据（70+ 动作）和训练计划
│   ├── db.js           # IndexedDB 封装
│   ├── sw.js           # Service Worker（PWA 离线缓存）
│   ├── manifest.json   # PWA 元数据
│   └── icon.svg        # PWA 图标
├── apk/                # Android APK 打包版本（Capacitor）
│   ├── www/            # Web 源码（与 Build_Muscle/ 同源）
│   ├── android/        # Android 原生项目
│   ├── package.json    # npm 配置
│   └── capacitor.config.json
├── CLAUDE.md           # 本文件（项目约定）
└── README.md           # 仓库级概览
```

## 硬边界规则

- **Web 版代码在 `Build_Muscle/` 内**，不要在此目录外新建功能文件
- **APK 版代码在 `apk/www/` 内**，不与 Build_Muscle/ 保持同步
- **纯前端，无构建工具，无框架** — 不引入 webpack/vite/bundler
- **Web 版数据存储用 IndexedDB**（`db.js` 封装）
- **APK 版数据存储用 localStorage**（`apk/www/db.js`），IndexedDB 在 Capacitor WebView 中不可靠
- **GitHub Pages 部署**：仓库 `kein02/webpage-and-app`，`gh-pages` 分支
- **部署地址**：`https://kein02.github.io/webpage-and-app/Build_Muscle/`
- **APK 构建**：`cd apk/android && ./gradlew assembleDebug`，输出 `apk/android/app/build/outputs/apk/debug/Build-Muscle.apk`
- **PWA 缓存**：`sw.js` 的 `CACHE_NAME` 版本号变更时才会触发新用户 SW 更新，老用户需清除缓存或等 `updatefound` 弹窗提示

## 代码约定

- 文件名用小写驼峰或连字符（`app.js`, `db.js`, `style.css`）
- 数据文件统一放 `data.js`，不要分散在多个 JS 文件
- 中文注释，中文变量名/类名均可
- 不写单元测试（纯前端 demo 阶段），逻辑验证靠手动测试

## 文档约定

- **Build_Muscle/README.md** — 新手使用指南（用户视角）
- **Build_Muscle/介绍.md** — 项目概览（功能 + 技术栈）
- 不需要额外 docs/ 目录（当前规模不需要）
- 大功能变更时更新 README.md 和介绍.md 即可
