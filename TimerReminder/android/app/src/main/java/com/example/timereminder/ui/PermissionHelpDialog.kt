package com.example.timereminder.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 权限与设置说明对话框：
 * 逐项告知用户需要开启哪些权限、作用是什么、如何开启。
 * 前四项可一键跳转到对应授权界面；后三项为手机系统设置指引。
 */
@Composable
fun PermissionHelpDialog(
    onDismiss: () -> Unit,
    onGrantNotifications: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onOpenFullScreenSettings: () -> Unit,
    onOpenBatterySettings: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("权限与设置说明") },
        text = {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(end = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                PermissionItem(
                    number = "1",
                    title = "通知权限",
                    desc = "到点弹出提醒通知（Android 13 及以上必须开启）",
                    actionLabel = "去开启",
                    onAction = onGrantNotifications
                )
                PermissionItem(
                    number = "2",
                    title = "精确闹钟权限",
                    desc = "到点准点提醒，不被系统延迟（Android 12 及以上建议开启）",
                    actionLabel = "去开启",
                    onAction = onOpenExactAlarmSettings
                )
                PermissionItem(
                    number = "3",
                    title = "全屏闹钟权限",
                    desc = "锁屏时弹出全屏闹钟页并响铃（Android 14 及以上需要）",
                    actionLabel = "去开启",
                    onAction = onOpenFullScreenSettings
                )
                PermissionItem(
                    number = "4",
                    title = "电池优化白名单",
                    desc = "后台 / 锁屏时提醒不被系统延迟或杀掉，强烈建议开启",
                    actionLabel = "去开启",
                    onAction = onOpenBatterySettings
                )
                PermissionItem(
                    number = "5",
                    title = "自启动 / 后台运行（国产手机）",
                    desc = "退出 App 后仍能提醒。路径：系统设置 → 应用管理 → 定时提醒 → 允许自启动 / 后台运行 / 锁屏清理",
                    actionLabel = null,
                    onAction = null
                )
                PermissionItem(
                    number = "6",
                    title = "锁屏通知",
                    desc = "锁屏时能看到提醒。路径：系统设置 → 通知 → 定时提醒 → 允许锁屏显示",
                    actionLabel = null,
                    onAction = null
                )
                PermissionItem(
                    number = "7",
                    title = "勿扰 / 静音模式",
                    desc = "勿扰或静音模式下提醒会被拦截或静音，请确认没有误开",
                    actionLabel = null,
                    onAction = null
                )
                Text(
                    "提示：打开 App 时，顶部「需要授权」卡片会动态列出当前缺失的权限，也可在那里一键开启。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("知道了") }
        }
    )
}

@Composable
private fun PermissionItem(
    number: String,
    title: String,
    desc: String,
    actionLabel: String?,
    onAction: (() -> Unit)?
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "$number. $title",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            if (actionLabel != null && onAction != null) {
                TextButton(onClick = onAction) {
                    Text(actionLabel, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        Text(
            desc,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
