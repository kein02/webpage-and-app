package com.example.timereminder.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.example.timereminder.data.TaskStore

/**
 * 开机 / 应用更新后恢复所有已启用任务的闹钟。
 * 系统重启后 AlarmManager 的闹钟全部丢失，必须重新注册。
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                val store = TaskStore(context)
                val tasks = store.load()
                if (tasks.isEmpty()) return
                val rescheduled = AlarmScheduler.scheduleAll(context, tasks)
                store.save(rescheduled)
            }
        }
    }
}
