package com.example.timereminder

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.example.timereminder.alarm.AlarmScheduler
import com.example.timereminder.alarm.NotificationHelper
import com.example.timereminder.alarm.RingService
import com.example.timereminder.data.Task
import com.example.timereminder.data.TaskMode
import com.example.timereminder.data.TaskStore
import com.example.timereminder.data.TaskType
import com.example.timereminder.ui.FullScreenGuideDialog
import com.example.timereminder.ui.HomeScreen
import com.example.timereminder.ui.PermissionHelpDialog
import com.example.timereminder.ui.PermissionsState
import com.example.timereminder.ui.ring.RingActivity
import com.example.timereminder.ui.TaskEditDialog
import com.example.timereminder.ui.theme.AppTheme
import kotlinx.coroutines.delay

/** 主界面：任务列表 + 添加/编辑 + 权限引导 */
class MainActivity : ComponentActivity() {

    private lateinit var store: TaskStore
    private var tasks by mutableStateOf(emptyList<Task>())
    private var editingTask by mutableStateOf<Task?>(null)
    private var showEditDialog by mutableStateOf(false)
    private var showPermissionHelp by mutableStateOf(false)
    private var showFullScreenGuide by mutableStateOf(false)

    /** 闹钟触发/任务完成后刷新界面（前台场景） */
    private val refreshReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            tasks = store.load()
        }
    }
    // 注意：不能在字段初始化器里调用 computePermissions()（构造阶段 mBase 为 null，getSystemService 会崩溃）
    private val permissionState = mutableStateOf(PermissionsState())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = TaskStore(this)
        tasks = store.load()
        permissionState.value = computePermissions() // 此时已 attach，可安全访问系统服务

        // 首次启动：Android 14+ 且未授予全屏闹钟权限时，主动引导授权（只提示一次）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            !NotificationHelper.canUseFullScreenIntent(this) &&
            !hasShownFullScreenGuide()
        ) {
            markFullScreenGuideShown()
            showFullScreenGuide = true
        }

        // 启动时恢复闹钟（覆盖应用被系统杀掉后未重排的情况）
        val rescheduled = AlarmScheduler.scheduleAll(this, tasks)
        if (rescheduled != tasks) {
            store.save(rescheduled)
            tasks = rescheduled
        }

        setContent {
            AppTheme {
                val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
                LaunchedEffect(Unit) {
                    while (true) {
                        now.longValue = System.currentTimeMillis()
                        delay(1000)
                    }
                }

                val permissions = permissionState.value
                val notifLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission()
                ) { permissionState.value = computePermissions() }

                HomeScreen(
                    tasks = tasks,
                    now = now.longValue,
                    permissions = permissions,
                    onAdd = {
                        editingTask = null
                        showEditDialog = true
                    },
                    onEdit = { task ->
                        editingTask = task
                        showEditDialog = true
                    },
                    onDelete = { task -> deleteTask(task) },
                    onToggle = { task -> toggleTask(task) },
                    onPreview = { task -> previewTask(task) },
                    onGrantNotifications = { notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
                    onOpenExactAlarmSettings = { openExactAlarmSettings() },
                    onOpenFullScreenSettings = { openFullScreenSettings() },
                    onOpenBatterySettings = { openBatterySettings() },
                    onShowPermissionHelp = { showPermissionHelp = true }
                )

                if (showEditDialog) {
                    TaskEditDialog(
                        initial = editingTask,
                        onDismiss = { showEditDialog = false },
                        onSave = { name, type, intervalMin, triggerAt, endAt, mode, sound, vibrate, enabled ->
                            saveTask(name, type, intervalMin, triggerAt, endAt, mode, sound, vibrate, enabled)
                            showEditDialog = false
                        }
                    )
                }

                if (showPermissionHelp) {
                    PermissionHelpDialog(
                        onDismiss = { showPermissionHelp = false },
                        onGrantNotifications = { notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
                        onOpenExactAlarmSettings = { openExactAlarmSettings() },
                        onOpenFullScreenSettings = { openFullScreenSettings() },
                        onOpenBatterySettings = { openBatterySettings() }
                    )
                }

                if (showFullScreenGuide) {
                    FullScreenGuideDialog(
                        onDismiss = { showFullScreenGuide = false },
                        onOpenSettings = {
                            showFullScreenGuide = false
                            openFullScreenSettings()
                        }
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                refreshReceiver,
                IntentFilter(AlarmScheduler.ACTION_REFRESH),
                Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            registerReceiver(refreshReceiver, IntentFilter(AlarmScheduler.ACTION_REFRESH))
        }
    }

    override fun onStop() {
        unregisterReceiver(refreshReceiver)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        // 从系统设置返回后刷新权限状态；同时重新加载任务（触发/完成后状态可能已变化）
        permissionState.value = computePermissions()
        tasks = store.load()
    }

    private fun computePermissions() = PermissionsState(
        hasNotification = NotificationHelper.hasNotificationPermission(this),
        canExactAlarm = canScheduleExactAlarm(),
        canFullScreen = NotificationHelper.canUseFullScreenIntent(this),
        canIgnoreBattery = canIgnoreBatteryOptimizations()
    )

    private fun canScheduleExactAlarm(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val am = getSystemService(AlarmManager::class.java)
        return am.canScheduleExactAlarms()
    }

    private fun canIgnoreBatteryOptimizations(): Boolean {
        val pm = getSystemService(PowerManager::class.java) ?: return true
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startActivity(
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))
            )
        }
    }

    private fun openFullScreenSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivity(
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))
            )
        }
    }

    /** 请求把本 App 加入电池优化白名单（系统弹窗确认） */
    private fun openBatterySettings() {
        startActivity(
            Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
        )
    }

    private fun hasShownFullScreenGuide(): Boolean =
        store.prefs.getBoolean(KEY_FULLSCREEN_GUIDE_SHOWN, false)

    private fun markFullScreenGuideShown() {
        store.prefs.edit().putBoolean(KEY_FULLSCREEN_GUIDE_SHOWN, true).apply()
    }

    private companion object {
        const val KEY_FULLSCREEN_GUIDE_SHOWN = "fullscreen_guide_shown"
    }

    /* ---------- 任务操作（每次变更：取消旧闹钟 → 重排 → 保存 → 刷新列表） ---------- */

    private fun persist(newTasks: List<Task>) {
        AlarmScheduler.cancelAll(this, tasks)
        val rescheduled = AlarmScheduler.scheduleAll(this, newTasks)
        store.save(rescheduled)
        tasks = rescheduled
    }

    private fun saveTask(
        name: String,
        type: TaskType,
        intervalMin: Int,
        triggerAt: Long?,
        endAt: Long?,
        mode: TaskMode,
        sound: Boolean,
        vibrate: Boolean,
        enabled: Boolean
    ) {
        val editing = editingTask
        if (editing != null) {
            // 发生「重新开始」性质的变化时重置计时：启用 + （类型/间隔/时间/截止变化 或 从已结束恢复）
            val restart = enabled && (
                editing.finished || editing.type != type ||
                    editing.intervalMin != intervalMin ||
                    editing.triggerAt != triggerAt ||
                    editing.endAt != endAt
                )
            val updated = editing.copy(
                name = name,
                type = type,
                intervalMin = intervalMin,
                triggerAt = triggerAt,
                endAt = endAt,
                mode = mode,
                sound = sound,
                vibrate = vibrate,
                enabled = enabled,
                finished = if (enabled) false else editing.finished
            ).let { if (restart || !enabled) it.copy(nextAt = null) else it }
            persist(tasks.map { if (it.id == updated.id) updated else it })
        } else {
            val task = Task(
                id = Task.newId(),
                name = name,
                type = type,
                intervalMin = intervalMin,
                triggerAt = triggerAt,
                endAt = endAt,
                mode = mode,
                sound = sound,
                vibrate = vibrate,
                enabled = enabled,
                finished = false,
                nextAt = null,
                lastAt = null
            )
            persist(tasks + task)
        }
    }

    private fun toggleTask(task: Task) {
        if (task.finished) return // 已结束的任务需编辑后重新启用
        val enabled = !task.enabled
        val updated = if (enabled) task.copy(enabled = true, nextAt = null) else task.copy(enabled = false)
        persist(tasks.map { if (it.id == task.id) updated else it })
    }

    private fun deleteTask(task: Task) {
        persist(tasks.filterNot { it.id == task.id })
    }

    /** 立即触发一次提醒表现（不影响正常调度） */
    private fun previewTask(task: Task) {
        when (task.mode) {
            TaskMode.NOTIFICATION -> NotificationHelper.notify(this, task)
            TaskMode.ALARM -> {
                checkFullScreenGuide()
                launchRing(task)
            }
            TaskMode.BOTH -> {
                checkFullScreenGuide()
                NotificationHelper.notify(this, task)
                launchRing(task)
            }
        }
    }

    /** 直接弹出全屏闹钟页（本页自行播放铃声，手动停止） */
    private fun launchRing(task: Task) {
        val intent = Intent(this, RingActivity::class.java).apply {
            putExtra(RingService.EXTRA_TASK_JSON, task.toJson())
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            RingService.start(this, task) // 兜底：前台服务响铃
        }
    }

    /** 全屏闹钟权限缺失时弹出引导（Android 14+） */
    private fun checkFullScreenGuide() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            !NotificationHelper.canUseFullScreenIntent(this)
        ) {
            showFullScreenGuide = true
        }
    }
}
