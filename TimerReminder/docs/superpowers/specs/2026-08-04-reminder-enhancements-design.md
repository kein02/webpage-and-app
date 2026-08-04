# 定时提醒 App 功能增强设计

日期：2026-08-04 · 状态：已确认

## 背景

在既有定时提醒 App（Kotlin + Compose，循环提醒 + 通知/全屏闹钟）上新增两个功能并整体美化界面。

## 需求

1. **循环提醒截止时间**：编辑循环提醒时可设截止日期+时间，到点自动停止不再提醒
2. **一次性提醒**：新增"一次"任务类型（选日期+时间），到点提醒一次后完成，保留在列表并标记"已完成"
3. **界面美化**：清新浅色风（浅灰白背景 + 蓝绿色调），去除 emoji 图标，整体自然舒适

## 数据模型

Task 新增字段（JSON 兼容旧数据，缺省值兜底）：

| 字段 | 类型 | 说明 | 缺省 |
| --- | --- | --- | --- |
| `type` | TaskType（REPEATING/ONCE） | 循环 / 一次性 | REPEATING |
| `endAt` | Long? | 循环截止时间戳 | null（不限） |
| `triggerAt` | Long? | 一次性提醒时间戳 | null |
| `finished` | Boolean | 已结束（循环到期 / 一次性完成） | false |

## 调度规则（TaskRules）

- `nextTriggerAt(task, now): Long?`（改为可空）
  - ONCE：`triggerAt` 在未来则返回，否则 null（不再排）
  - REPEATING：沿用 nextAt 或 `now+interval`；若 `endAt` 存在且 next > endAt → null（到期）
- 返回 null 表示结束：不注册闹钟，任务置 `finished=true, enabled=false`
- 触发处理（AlarmReceiver）：
  - ONCE 触发后：`finished=true, enabled=false`，不重排，仍发提醒
  - REPEATING 触发后：重排下一次；若下一次超截止 → 标记结束，不再排

## 界面

- 主题：清新浅色 —— 背景 `#F7F9F8`，主色蓝绿 `#3A9D8C`，文字 `#24323D`，辅色（警示/到期）暖橙 `#E9A23B`；圆角适中；系统字体
- 编辑对话框：提醒类型（循环/一次）单选；循环显示间隔+截止（可选，日期时间选择器）；一次显示提醒时间（日期时间选择器）；用原生 DatePickerDialog/TimePickerDialog
- 任务卡片：类型标签（循环/一次）、状态徽章（运行中/已暂停/已到期/已完成）、截止或提醒时间展示
- 移除 emoji（全屏闹钟页的 🔔 等），用干净的排版与矢量图形
- 全屏闹钟页改为蓝绿渐变浅色风

## 非目标

- 不改动提醒调度机制（AlarmManager）与权限体系
- 不做数据迁移脚本（fromJson 兜底即可）
