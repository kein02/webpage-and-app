package com.example.timereminder.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.example.timereminder.R
import com.example.timereminder.data.Task
import com.example.timereminder.ui.ring.RingActivity

/**
 * 全屏闹钟响铃前台服务：
 * - 前台服务（mediaPlayback 类型）保证锁屏/后台也能持续响铃
 * - MediaPlayer 循环播放系统默认闹钟音，直到用户手动停止
 * - 前台通知带 fullScreenIntent → 锁屏时直接弹出全屏闹钟页
 */
class RingService : Service() {

    private var player: MediaPlayer? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopRinging()
            else -> {
                val taskJson = intent?.getStringExtra(EXTRA_TASK_JSON) ?: return START_NOT_STICKY
                if (player?.isPlaying == true) return START_NOT_STICKY // 已有闹钟在响，忽略重复
                val task = Task.fromJson(taskJson)
                ensureAlarmChannel(this)
                startForeground(NOTIFICATION_ID, buildNotification(task))
                startAlarmSound()
            }
        }
        return START_NOT_STICKY
    }

    private fun buildNotification(task: Task): Notification {
        val openRing = PendingIntent.getActivity(
            this,
            REQUEST_FULLSCREEN,
            Intent(this, RingActivity::class.java).apply {
                putExtra(EXTRA_TASK_JSON, task.toJson())
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = Notification.Builder(this, CHANNEL_ALARM)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(task.name)
            .setContentText("全屏闹钟响铃中 · 点击停止")
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setContentIntent(openRing)
            .setOngoing(true)
        // Android 14+ 需 USE_FULL_SCREEN_INTENT 权限（系统设置「闹钟和提醒」）；
        // 无权限时降级为普通通知（铃声仍响）
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
        ) {
            builder.setFullScreenIntent(openRing, true)
        }
        return builder.build()
    }

    private fun startAlarmSound() {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@RingService, uri)
                isLooping = true
                prepare()
                start()
            }
            isRinging = true
        } catch (e: Exception) {
            // 铃声加载失败时静默（全屏页仍正常显示）
            player = null
            isRinging = false
        }
    }

    private fun stopRinging() {
        player?.run {
            if (isPlaying) stop()
            release()
        }
        player = null
        isRinging = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        isRinging = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.example.timereminder.RING_START"
        const val ACTION_STOP = "com.example.timereminder.RING_STOP"
        const val EXTRA_TASK_JSON = "task_json"
        const val EXTRA_TASK_NAME = "task_name"
        private const val NOTIFICATION_ID = 100
        private const val CHANNEL_ALARM = "alarm"
        private const val REQUEST_FULLSCREEN = 200

        /** 是否正在响铃（RingActivity 兜底播放时判断，避免双重铃声） */
        @Volatile
        var isRinging: Boolean = false

        /** 启动全屏闹钟（前台服务） */
        fun start(context: Context, task: Task) {
            val intent = Intent(context, RingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TASK_JSON, task.toJson())
            }
            ContextCompat.startForegroundService(context, intent)
        }

        /** 停止响铃 */
        fun stop(context: Context) {
            val intent = Intent(context, RingService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }

        private fun ensureAlarmChannel(context: Context) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALARM, "全屏闹钟", NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "全屏闹钟的前台服务通知"
                    setSound(null, null) // 铃声由 MediaPlayer 播放，通知本身静音避免叠加
                    enableVibration(false)
                }
            )
        }
    }
}
