package com.example.timereminder.alarm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.example.timereminder.MainActivity
import com.example.timereminder.R
import com.example.timereminder.data.Task
import com.example.timereminder.ui.ring.RingActivity

/**
 * 通知助手：
 * - 双渠道：响铃渠道（默认通知音 + 震动）/ 静音渠道（无声无震动）
 * - 任务级配置：sound=false 走静音渠道；vibrate=false 单独关闭震动
 * - Android 13+ 需 POST_NOTIFICATIONS 权限（UI 层负责引导授权）
 */
object NotificationHelper {

    private const val CHANNEL_SOUND = "reminder_sound"
    private const val CHANNEL_SILENT = "reminder_silent"
    private const val CHANNEL_ALARM_SOUND = "alarm_sound"
    private const val REQUEST_OPEN_APP = 1001
    private const val REQUEST_FULLSCREEN = 200

    /** 创建通知渠道（幂等，重复调用安全） */
    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val soundChannel = NotificationChannel(
            CHANNEL_SOUND, "提醒（响铃）", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "循环提醒，带提示音与震动"
            setSound(
                soundUri,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            enableVibration(true)
        }

        val silentChannel = NotificationChannel(
            CHANNEL_SILENT, "提醒（静音）", NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "循环提醒，静音不震动"
            setSound(null, null)
            enableVibration(false)
        }

        // 全屏闹钟降级渠道：使用系统闹钟音（响亮），后台启动前台服务受限时提醒仍清晰可闻
        val alarmNotifyChannel = NotificationChannel(
            CHANNEL_ALARM_SOUND, "全屏闹钟（降级提醒）", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "后台/锁屏时全屏闹钟降级提醒，使用系统闹钟音"
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            enableVibration(true)
        }

        nm.createNotificationChannel(soundChannel)
        nm.createNotificationChannel(silentChannel)
        nm.createNotificationChannel(alarmNotifyChannel)
    }

    /** Android 13+ 是否已授予通知权限 */
    fun hasNotificationPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    /** 发送一条循环提醒通知（同一任务的通知会互相替换，不堆积） */
    fun notify(context: Context, task: Task) {
        if (!hasNotificationPermission(context)) return
        ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val openApp = PendingIntent.getActivity(
            context,
            REQUEST_OPEN_APP,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = Notification.Builder(
            context, if (task.sound) CHANNEL_SOUND else CHANNEL_SILENT
        )
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(task.name)
            .setContentText("每 ${task.intervalMin} 分钟循环提醒 · 点击查看")
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
        if (!task.vibrate) builder.setVibrate(null)

        nm.notify(task.id.hashCode(), builder.build())
    }

    /** Android 14+ 是否已授予全屏 Intent 权限（系统设置「闹钟和提醒」） */
    fun canUseFullScreenIntent(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .canUseFullScreenIntent()

    /**
     * 发送全屏闹钟通知（前台服务启动受限时的降级方案）：
     * 锁屏时经 fullScreenIntent 弹出全屏闹钟页，由 RingActivity 兜底播放铃声。
     */
    fun notifyFullScreen(context: Context, task: Task) {
        if (!hasNotificationPermission(context)) return
        ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val openRing = PendingIntent.getActivity(
            context,
            REQUEST_FULLSCREEN,
            Intent(context, RingActivity::class.java).apply {
                putExtra(RingService.EXTRA_TASK_JSON, task.toJson())
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = Notification.Builder(context, CHANNEL_ALARM_SOUND)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(task.name)
            .setContentText("全屏闹钟 · 点击停止")
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setContentIntent(openRing)
            .setOngoing(true)
        if (canUseFullScreenIntent(context)) {
            builder.setFullScreenIntent(openRing, true)
        }
        nm.notify(task.id.hashCode(), builder.build())
    }

    /** 取消某任务的通知（全屏闹钟停止时清理） */
    fun cancel(context: Context, task: Task) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(task.id.hashCode())
    }
}
