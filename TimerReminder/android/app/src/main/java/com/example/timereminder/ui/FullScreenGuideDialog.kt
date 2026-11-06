package com.example.timereminder.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

/**
 * 全屏闹钟权限引导对话框：
 * Android 14+ 需要在系统设置中授予「闹钟和提醒」类别，全屏闹钟页才会弹出。
 * 仅首次启动时显示一次。
 */
@Composable
fun FullScreenGuideDialog(
    onDismiss: () -> Unit,
    onOpenSettings: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("需要开启全屏闹钟权限") },
        text = {
            Text(
                "为了保证到点后全屏闹钟页能正常弹出（锁屏时也能亮屏提醒），" +
                    "Android 14 及以上需要在系统设置中授予「闹钟和提醒」权限。\n\n" +
                    "现在去开启？"
            )
        },
        confirmButton = {
            TextButton(onClick = onOpenSettings) { Text("去开启") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("暂不") }
        }
    )
}
