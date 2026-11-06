package com.example.timereminder.ui.ring

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.timereminder.alarm.NotificationHelper
import com.example.timereminder.alarm.RingService
import com.example.timereminder.data.Task
import com.example.timereminder.ui.theme.AppTheme
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay

/**
 * 全屏闹钟页（恢复 1.0 样式）：深蓝渐变 + 铃铛图标 + 任务名 + 持续响铃，
 * 点「停止响铃」手动关闭。
 * - 正常路径：AlarmReceiver 直接启动本页，本页自行播放铃声
 * - 兜底：若 RingService 已在响铃（FGS 成功），本页不重复播放
 */
class RingActivity : ComponentActivity() {

    private var fallbackPlayer: MediaPlayer? = null
    private var task: Task? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        task = intent.getStringExtra(RingService.EXTRA_TASK_JSON)?.let { runCatching { Task.fromJson(it) }.getOrNull() }
        setContent {
            AppTheme {
                RingScreen(
                    taskName = task?.name ?: intent.getStringExtra(RingService.EXTRA_TASK_NAME) ?: "提醒",
                    onStop = ::stopRing
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // 兜底：RingService 未在响铃时，本页（前台可见）自己播放铃声
        if (!RingService.isRinging) {
            startFallbackRing()
        }
    }

    override fun onDestroy() {
        stopFallbackRing()
        super.onDestroy()
    }

    private fun startFallbackRing() {
        if (fallbackPlayer != null) return
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            fallbackPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@RingActivity, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            fallbackPlayer = null
        }
    }

    private fun stopFallbackRing() {
        fallbackPlayer?.run {
            if (isPlaying) stop()
            release()
        }
        fallbackPlayer = null
    }

    /** 停止响铃：停本页铃声 + 通知前台服务停止 + 清理通知 + 关闭页面 */
    private fun stopRing() {
        stopFallbackRing()
        RingService.stop(this)
        task?.let { NotificationHelper.cancel(this, it) }
        finish()
    }
}

@Composable
private fun RingScreen(taskName: String, onStop: () -> Unit) {
    val nowMillis = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMillis.longValue = System.currentTimeMillis()
            delay(1000)
        }
    }
    val now = Date(nowMillis.longValue)
    val timeText = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(now)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0xFF1E3A8A), Color(0xFF0F172A))
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(text = "🔔", fontSize = 72.sp)
            Text(
                text = taskName,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                modifier = Modifier.padding(top = 24.dp)
            )
            Text(
                text = timeText,
                fontSize = 18.sp,
                color = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.padding(top = 8.dp)
            )
            Text(
                text = "全屏闹钟响铃中 · 点击下方按钮停止",
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.8f),
                modifier = Modifier.padding(top = 4.dp)
            )
            Button(
                onClick = onStop,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                modifier = Modifier.padding(top = 40.dp)
            ) {
                Text(
                    text = "停止响铃",
                    fontSize = 18.sp,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                )
            }
        }
    }
}
