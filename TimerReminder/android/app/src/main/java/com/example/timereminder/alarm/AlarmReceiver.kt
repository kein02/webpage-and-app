package com.example.timereminder.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.example.timereminder.data.Task
import com.example.timereminder.data.TaskMode
import com.example.timereminder.data.TaskStore
import com.example.timereminder.ui.ring.RingActivity

/**
 * 闹钟触发接收器：
 * 1. 更新 lastAt，重排下一次触发（先排再提醒，与浏览器原型一致）
 * 2. 按任务提醒方式发送通知 / 启动全屏闹钟
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getLongExtra(AlarmScheduler.EXTRA_TASK_ID, -1L)
        if (taskId < 0) return

        val store = TaskStore(context)
        val tasks = store.load()
        val index = tasks.indexOfFirst { it.id == taskId }
        if (index < 0) return

        val task = tasks[index]
        if (!task.enabled) return // 防御：任务已被暂停，不再重排

        val now = System.currentTimeMillis()
        val updated = task.copy(lastAt = now, nextAt = null)
        val mutable = tasks.toMutableList().apply { this[index] = updated }

        // 先重排下一次闹钟，再保存、再提醒
        val rescheduled = AlarmScheduler.scheduleAll(context, mutable)
        store.save(rescheduled)
        // 通知前台界面刷新任务状态（触发/完成后任务会变为已结束）
        context.sendBroadcast(Intent(AlarmScheduler.ACTION_REFRESH))
        val scheduledTask = rescheduled[index]

        when (task.mode) {
            TaskMode.NOTIFICATION -> NotificationHelper.notify(context, scheduledTask)
            TaskMode.ALARM -> startRingSafely(context, scheduledTask)
            TaskMode.BOTH -> {
                NotificationHelper.notify(context, scheduledTask)
                startRingSafely(context, scheduledTask)
            }
        }
    }

    /**
     * 启动全屏闹钟（保证至少一条提醒路径执行）：
     * 1. 前台服务响铃（前台/部分后台场景成功，铃声持续 + fullScreenIntent 通知弹页）
     * 2. 失败（Android 12+ 后台启动前台服务受限）→ 必发全屏通知（闹钟音，fullScreenIntent）
     *    并尽力直接启动全屏页（Activity 自行播放铃声；后台被静默拦截时通知兜底）
     */
    private fun startRingSafely(context: Context, task: Task) {
        try {
            RingService.start(context, task)
        } catch (e: Exception) {
            NotificationHelper.notifyFullScreen(context, task)
            try {
                val intent = Intent(context, RingActivity::class.java).apply {
                    putExtra(RingService.EXTRA_TASK_JSON, task.toJson())
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                context.startActivity(intent)
            } catch (e2: Exception) {
                // 后台启动 Activity 被系统限制：全屏通知兜底（用户可点通知进入全屏页）
            }
        }
    }
}
