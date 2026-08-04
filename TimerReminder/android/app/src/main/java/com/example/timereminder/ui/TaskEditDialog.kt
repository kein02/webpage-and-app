package com.example.timereminder.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.timereminder.data.Task
import com.example.timereminder.data.TaskMode
import com.example.timereminder.data.TaskRules
import com.example.timereminder.data.TaskType
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 添加/编辑提醒对话框。
 * - 循环提醒：间隔（分钟）+ 可选截止时间
 * - 一次性提醒：指定提醒时间（日期 + 时刻），提醒一次后完成
 */
@Composable
fun TaskEditDialog(
    initial: Task?,
    onDismiss: () -> Unit,
    onSave: (
        name: String,
        type: TaskType,
        intervalMin: Int,
        triggerAt: Long?,
        endAt: Long?,
        mode: TaskMode,
        sound: Boolean,
        vibrate: Boolean,
        enabled: Boolean
    ) -> Unit
) {
    val context = LocalContext.current
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var type by remember { mutableStateOf(initial?.type ?: TaskType.REPEATING) }
    var intervalText by remember { mutableStateOf((initial?.intervalMin ?: 30).toString()) }
    var endAtEnabled by remember { mutableStateOf(initial?.endAt != null) }
    var endAt by remember { mutableStateOf(initial?.endAt) }
    var triggerAt by remember { mutableStateOf(initial?.triggerAt) }
    var mode by remember { mutableStateOf(initial?.mode ?: TaskMode.BOTH) }
    var sound by remember { mutableStateOf(initial?.sound ?: true) }
    var vibrate by remember { mutableStateOf(initial?.vibrate ?: true) }
    var enabled by remember { mutableStateOf(initial?.enabled ?: true) }
    var error by remember { mutableStateOf<String?>(null) }

    val timeFormat = SimpleDateFormat("yyyy年M月d日 HH:mm", Locale.getDefault())

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "添加提醒" else "编辑提醒") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("提醒名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                // 提醒类型
                Text("提醒类型", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TypeOption("循环提醒", TaskType.REPEATING, type) { type = it }
                    TypeOption("一次性", TaskType.ONCE, type) { type = it }
                }

                if (type == TaskType.REPEATING) {
                    OutlinedTextField(
                        value = intervalText,
                        onValueChange = { intervalText = it },
                        label = { Text("提醒间隔（分钟）") },
                        supportingText = { Text("1 ~ 9999，任意整数") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    // 截止时间
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("设置截止时间", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Switch(checked = endAtEnabled, onCheckedChange = { endAtEnabled = it })
                    }
                    if (endAtEnabled) {
                        OutlinedButton(
                            onClick = {
                                pickDateTime(context, endAt) { picked ->
                                    endAt = picked
                                    error = null
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                endAt?.let { "截止：${timeFormat.format(Date(it))}" } ?: "选择截止日期与时间"
                            )
                        }
                    }
                } else {
                    // 一次性提醒时间
                    OutlinedButton(
                        onClick = {
                            pickDateTime(context, triggerAt) { picked ->
                                triggerAt = picked
                                error = null
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            triggerAt?.let { "提醒时间：${timeFormat.format(Date(it))}" } ?: "选择提醒日期与时间"
                        )
                    }
                }

                Text("提醒方式", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ModeOption("通知", TaskMode.NOTIFICATION, mode) { mode = it }
                    ModeOption("全屏闹钟", TaskMode.ALARM, mode) { mode = it }
                    ModeOption("两者", TaskMode.BOTH, mode) { mode = it }
                }
                SwitchRow("响铃", sound) { sound = it }
                SwitchRow("震动", vibrate) { vibrate = it }
                SwitchRow("保存后立即启用", enabled) { enabled = it }
                if (error != null) {
                    Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                when (type) {
                    TaskType.REPEATING -> {
                        val interval = intervalText.toIntOrNull()
                        val validation = if (interval == null) {
                            TaskRules.Validation(false, "提醒间隔必须是整数（分钟）")
                        } else {
                            TaskRules.validate(name, interval)
                        }
                        if (validation.ok) {
                            onSave(name.trim(), type, interval!!, null, endAt, mode, sound, vibrate, enabled)
                        } else {
                            error = validation.error
                        }
                    }
                    TaskType.ONCE -> {
                        val t = triggerAt
                        if (name.isBlank()) {
                            error = "请填写提醒名称"
                        } else if (name.trim().length > 30) {
                            error = "提醒名称不能超过 30 个字"
                        } else if (t == null) {
                            error = "请选择提醒时间"
                        } else if (t <= System.currentTimeMillis()) {
                            error = "提醒时间必须晚于当前时间"
                        } else {
                            onSave(name.trim(), type, Task.MIN_INTERVAL, t, null, mode, sound, vibrate, enabled)
                        }
                    }
                }
            }) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

/** 依次弹出日期与时间选择器（原生 Dialog，简单可靠） */
private fun pickDateTime(context: android.content.Context, initial: Long?, onPicked: (Long) -> Unit) {
    val cal = Calendar.getInstance().apply { initial?.let { timeInMillis = it } }
    DatePickerDialog(
        context,
        { _, year, month, day ->
            cal.set(Calendar.YEAR, year)
            cal.set(Calendar.MONTH, month)
            cal.set(Calendar.DAY_OF_MONTH, day)
            TimePickerDialog(
                context,
                { _, hour, minute ->
                    cal.set(Calendar.HOUR_OF_DAY, hour)
                    cal.set(Calendar.MINUTE, minute)
                    onPicked(cal.timeInMillis)
                },
                cal.get(Calendar.HOUR_OF_DAY),
                cal.get(Calendar.MINUTE),
                true
            ).show()
        },
        cal.get(Calendar.YEAR),
        cal.get(Calendar.MONTH),
        cal.get(Calendar.DAY_OF_MONTH)
    ).show()
}

@Composable
private fun TypeOption(label: String, value: TaskType, selected: TaskType, onSelect: (TaskType) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 6.dp)) {
        RadioButton(selected = selected == value, onClick = { onSelect(value) })
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ModeOption(label: String, value: TaskMode, selected: TaskMode, onSelect: (TaskMode) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 6.dp)) {
        RadioButton(selected = selected == value, onClick = { onSelect(value) })
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
