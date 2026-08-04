# 定时提醒 App

中文界面的循环 / 一次性提醒应用：到点通知、全屏闹钟响铃、多任务并行、循环可设截止时间。

| | |
| --- | --- |
| 正式版本 | 1.0.0（versionCode 1） |
| 包名 | `com.example.timereminder` |
| 支持系统 | Android 8.0+（API 26） |
| 技术栈 | Kotlin + Jetpack Compose + AlarmManager（setAlarmClock）+ 前台服务 |

## 目录结构

```
Reasonix/
├── android/                 # Android 原生工程（最终交付）
│   ├── app/src/main/java/…  # 源码（数据层 / 调度层 / UI）
│   ├── app/src/test/        # 单元测试（25 项）
│   ├── keystore/            # 正式签名密钥（勿外传、勿提交）
│   └── README.md            # Android 工程文档（权限 / 验收 / 打包）
├── web-prototype/           # 浏览器原型（开发期验证用，非交付物）
│   ├── index.html           # 双击即可测试
│   └── README.md
├── release/                 # 发布 APK（正式版）
│   └── TimerReminder-1.0.0-release.apk
├── docs/superpowers/specs/  # 设计文档
├── CHANGELOG.md             # 版本历史
└── README.md                # 本文件
```

## 快速开始

**安装正式版**：`release/TimerReminder-1.0.0-release.apk` 传到手机安装，首次打开按 App 内「需要授权」卡片开启权限（通知 / 电池优化白名单，国产手机另需自启动）。

**用 Android Studio 开发**：打开 `android/` 目录 → 同步 → 运行。详见 `android/README.md`。

**命令行构建**（需 Android Studio 自带 JBR）：

```bat
set JAVA_HOME=D:\Android Studio\jbr
cd android
gradlew.bat assembleRelease        :: 正式签名包（app\build\outputs\apk\release\）
gradlew.bat assembleDebug          :: 调试包
gradlew.bat testDebugUnitTest      :: 单元测试
```

## 版本管理

- 已初始化 git 仓库，正式版 1.0.0 为首次提交（tag `v1.0.0`）
- 后续改动流程：改代码 → `gradlew.bat testDebugUnitTest` 通过 → 构建 release → 更新 `CHANGELOG.md` → 提交
- **升级必须用同一把签名密钥**（`android/keystore/timereminder.jks` + `keystore.properties` 密码），否则已安装用户无法覆盖更新

## 权限说明（为什么需要）

| 权限 | 用途 |
| --- | --- |
| 通知 | 到点弹出提醒通知（Android 13+ 必开） |
| 电池优化白名单 | 息屏/后台不被系统延迟或杀掉提醒 |
| 自启动（国产 ROM） | 划掉任务后仍能收到提醒 |
| 全屏闹钟权限（Android 14+） | 锁屏时自动弹出全屏闹钟页 |

详见 `android/README.md` 的「后台/锁屏提醒排查」。
