# 增肌助手 · Android APK

## 概述

通过 Capacitor 将增肌助手 Web App 打包为 Android 原生安装包。

## 构建

```bash
cd apk
npx cap sync
cd android
./gradlew assembleDebug
```

输出：`android/app/build/outputs/apk/debug/Build-Muscle.apk`

## 与 Web 版差异

| 特性 | Web 版 (Build_Muscle/) | APK 版 (apk/) |
|------|------------------------|---------------|
| 数据存储 | IndexedDB | localStorage |
| 语音播报 | speechSynthesis | Android 原生 TTS（讯飞/百度等） |
| 启动页 | 计划页面 | 进度页面 |
| 保护模式标签 | 无颜色区分 | 实时显示护膝/护腕/双保护（带颜色） |
| 设置联动 | 切回计划页才更新 | 设置页切换实时刷新计划页 |

## 语音说明

APK 版使用 `@capacitor-community/text-to-speech` 插件调用 Android 系统原生 TTS 引擎。
- 需要手机上安装中文语音引擎（讯飞/百度等）
- 设置 → 辅助功能 → 文本朗读 → 下载中文语音包
- 或安装讯飞输入法/讯飞语记来安装讯飞 TTS 引擎