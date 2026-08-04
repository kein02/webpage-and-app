# 健身计划 App

居家健身 Web App 集合。纯前端、离线可用、零安装。

## 项目

| 项目 | 说明 | 访问 |
|------|------|------|
| [增肌助手](Build_Muscle/) | 居家增肌训练 App，70+ 动作库，智能计划，语音播报 | [在线体验](https://kein02.github.io/webpage-and-app/Build_Muscle/) |
| [APK 安装包](apk/) | Android 原生安装包（Capacitor 打包） | 见 `apk/README.md` |

## 部署

- **Web 版**：GitHub Pages
  - 仓库：`kein02/webpage-and-app`
  - 分支：`gh-pages`
  - 地址：`https://kein02.github.io/webpage-and-app/Build_Muscle/`
- **APK 版**：Android 原生安装
  - 构建：`cd apk/android && ./gradlew assembleDebug`
  - 输出：`apk/android/app/build/outputs/apk/debug/Build-Muscle.apk`
  - 使用 Android 原生 TTS 引擎（讯飞/百度等系统语音包）
