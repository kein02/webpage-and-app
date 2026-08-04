package com.example.timereminder.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.timereminder.data.Task
import com.example.timereminder.data.TaskMode
import com.example.timereminder.data.TaskType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 权限状态汇总（用于顶部提示卡片） */
data class PermissionsState(
    val hasNotification: Boolean = true,
    val canExactAlarm: Boolean = true,
    val canFullScreen: Boolean = true,
    val canIgnoreBattery: Boolean = true
) {
    val allGranted: Boolean get() = hasNotification && canExactAlarm && canFullScreen && canIgnoreBattery
}

/** 主界面：权限提示 + 任务列表 + 悬浮添加按钮 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    tasks: List<Task>,
    now: Long,
    permissions: PermissionsState,
    onAdd: () -> Unit,
    onEdit: (Task) -> Unit,
    onDelete: (Task) -> Unit,
    onToggle: (Task) -> Unit,
    onPreview: (Task) -> Unit,
    onGrantNotifications: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onOpenFullScreenSettings: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onShowPermissionHelp: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("定时提醒") },
                actions = {
                    TextButton(onClick = onShowPermissionHelp) {
                        Text("使用说明", color = MaterialTheme.colorScheme.primary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAdd) {
                Text("＋", fontSize = 24.sp)
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            PermissionCard(permissions, onGrantNotifications, onOpenExactAlarmSettings, onOpenFullScreenSettings, onOpenBatterySettings)
            if (tasks.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("还没有提醒", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "点右下角 ＋ 添加一个提醒",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(tasks, key = { it.id }) { task ->
                        TaskCard(task, now, onEdit, onDelete, onToggle, onPreview)
                    }
                }
            }
        }
    }
}

/** 权限缺失提示卡片（暖橙浅底） */
@Composable
private fun PermissionCard(
    permissions: PermissionsState,
    onGrantNotifications: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onOpenFullScreenSettings: () -> Unit,
    onOpenBatterySettings: () -> Unit
) {
    val items = mutableListOf<Pair<String, () -> Unit>>()
    if (!permissions.hasNotification) items.add("通知权限未授予：提醒将无法弹出通知" to onGrantNotifications)
    if (!permissions.canExactAlarm) items.add("精确闹钟权限未授予：提醒可能延迟" to onOpenExactAlarmSettings)
    if (!permissions.canFullScreen) items.add("全屏闹钟权限未授予：锁屏时不弹全屏页" to onOpenFullScreenSettings)
    if (!permissions.canIgnoreBattery) items.add("电池优化未豁免：后台/锁屏时提醒可能被延迟或杀掉" to onOpenBatterySettings)
    if (items.isEmpty()) return

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("需要授权", fontWeight = FontWeight.Bold)
            items.forEach { (msg, action) ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 6.dp)
                ) {
                    Text(msg, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = action, modifier = Modifier.padding(start = 8.dp)) {
                        Text("去授权", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

/** 任务卡片 */
@Composable
private fun TaskCard(
    task: Task,
    now: Long,
    onEdit: (Task) -> Unit,
    onDelete: (Task) -> Unit,
    onToggle: (Task) -> Unit,
    onPreview: (Task) -> Unit
) {
    val finished = task.finished
    val muted = !task.enabled
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    task.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    statusText(task),
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor(task)
                )
                Spacer(Modifier.width(10.dp))
                Switch(
                    checked = task.enabled,
                    onCheckedChange = { onToggle(task) },
                    enabled = !finished
                )
            }
            Text(
                metaText(task, now),
                style = MaterialTheme.typography.bodySmall,
                color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 4.dp)
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 10.dp)
            ) {
                Button(onClick = { onPreview(task) }, modifier = Modifier.weight(1f)) {
                    Text("立即测试")
                }
                OutlinedButton(onClick = { onEdit(task) }, modifier = Modifier.weight(1f)) {
                    Text("编辑")
                }
                OutlinedButton(
                    onClick = { onDelete(task) },
                    modifier = Modifier.weight(1f),
                    colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("删除")
                }
            }
        }
    }
}

private fun statusText(task: Task): String = when {
    task.finished -> if (task.type == TaskType.ONCE) "已完成" else "已到期"
    task.enabled -> "运行中"
    else -> "已暂停"
}

@Composable
private fun statusColor(task: Task): Color = when {
    task.finished -> MaterialTheme.colorScheme.tertiary
    task.enabled -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun metaText(task: Task, now: Long): String {
    val parts = mutableListOf<String>()
    parts += if (task.type == TaskType.ONCE) "一次性" else "循环"
    when (task.type) {
        TaskType.REPEATING -> {
            parts += "每 ${task.intervalMin} 分钟"
            task.endAt?.let { parts += "截止 ${formatTime(it)}" }
        }
        TaskType.ONCE -> task.triggerAt?.let { parts += formatTime(it) }
    }
    parts += when (task.mode) {
        TaskMode.NOTIFICATION -> "通知"
        TaskMode.ALARM -> "全屏闹钟"
        TaskMode.BOTH -> "通知+闹钟"
    }
    parts += if (task.sound) "响铃" else "静音"
    parts += if (task.vibrate) "震动" else "无震动"

    val schedule = when {
        task.finished -> "已结束"
        !task.enabled -> "未在计时"
        task.nextAt == null -> "等待安排"
        else -> "下次 ${formatTime(task.nextAt!!)}（${countdown(task.nextAt!!, now)}）"
    }
    return (parts.joinToString(" · ") + " · " + schedule)
}

private fun formatTime(ts: Long): String =
    SimpleDateFormat("M月d日 HH:mm", Locale.getDefault()).format(Date(ts))

private fun countdown(next: Long, now: Long): String {
    val seconds = (next - now) / 1000
    return when {
        seconds < 60 -> "$seconds 秒后"
        seconds < 3600 -> "${seconds / 60} 分 ${seconds % 60} 秒后"
        else -> "${seconds / 3600} 小时 ${(seconds % 3600) / 60} 分后"
    }
}
