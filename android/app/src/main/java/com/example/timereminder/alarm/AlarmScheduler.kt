package com.example.timereminder.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.example.timereminder.MainActivity
import com.example.timereminder.data.Task
import com.example.timereminder.data.TaskRules
import com.example.timereminder.data.TaskType

/**
 * 闹钟调度器：系统闹钟（setAlarmClock）调度。
 * - 每个任务独立 PendingIntent（Intent data 带唯一 taskId，互不干扰）
 * - 每次触发后由 AlarmReceiver 重排下一次
 * - setAlarmClock 在息屏/Doze 下也准时触发，且无需 SCHEDULE_EXACT_ALARM 权限
 */
object AlarmScheduler {

    private const val ACTION_TRIGGER = "com.example.timereminder.ACTION_TRIGGER"
    const val EXTRA_TASK_ID = "task_id"

    /** 任务状态已变更（闹钟触发/完成）时通知界面刷新 */
    const val ACTION_REFRESH = "com.example.timereminder.REFRESH"

    /** 注册任务的下一次闹钟；返回更新了 nextAt 的任务（nextAt=null 表示不再排） */
    fun schedule(context: Context, task: Task): Task {
        if (!task.enabled) return task
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val triggerAt = TaskRules.nextTriggerAt(task, now)
            ?: return task.copy(nextAt = null) // 一次性已过 / 循环已到期，不再注册
        val pi = pendingIntent(context, task.id)
        // 系统闹钟调度：息屏/Doze 下准时，状态栏显示下次闹钟（点击打开 App）
        val showIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showIntent), pi)
        return task.copy(nextAt = triggerAt)
    }

    /**
     * 重排所有启用的任务；禁用任务原样返回。
     * 排不上（nextAt=null）时的处理：
     * - 循环任务：已超过截止时间 → 结束（finished + 停用）
     * - 一次性任务：已触发过（lastAt != null）→ 完成（finished + 停用）；
     *   从未触发（时间已过但闹钟未响）→ 保持启用状态不静默丢弃，
     *   用户可见「未在计时」，可编辑改时间重新启用
     */
    fun scheduleAll(context: Context, tasks: List<Task>): List<Task> =
        tasks.map { task ->
            if (!task.enabled) task
            else {
                val scheduled = schedule(context, task)
                if (scheduled.nextAt == null) {
                    if (task.type == TaskType.REPEATING || task.lastAt != null) {
                        scheduled.copy(finished = true, enabled = false)
                    } else {
                        scheduled.copy(enabled = true)
                    }
                } else {
                    scheduled
                }
            }
        }

    /** 取消某个任务的闹钟 */
    fun cancel(context: Context, taskId: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pendingIntent(context, taskId))
    }

    /** 取消全部任务的闹钟 */
    fun cancelAll(context: Context, tasks: List<Task>) {
        tasks.forEach { cancel(context, it.id) }
    }

    private fun pendingIntent(context: Context, taskId: Long): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_TRIGGER
            // data 参与 PendingIntent 相等性比较：不同任务互不覆盖
            data = Uri.parse("timer://task/$taskId")
            putExtra(EXTRA_TASK_ID, taskId)
        }
        return PendingIntent.getBroadcast(
            context,
            taskId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
