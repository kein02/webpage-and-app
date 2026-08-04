package com.example.timereminder.data

import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/** 提醒方式（key 与浏览器原型一致：notification / alarm / both） */
enum class TaskMode(val key: String) {
    NOTIFICATION("notification"),
    ALARM("alarm"),
    BOTH("both");

    companion object {
        fun fromKey(key: String?): TaskMode = entries.firstOrNull { it.key == key } ?: BOTH
    }
}

/** 提醒类型：循环 / 一次性 */
enum class TaskType(val key: String) {
    REPEATING("repeating"),
    ONCE("once");

    companion object {
        fun fromKey(key: String?): TaskType = entries.firstOrNull { it.key == key } ?: REPEATING
    }
}

/**
 * 定时提醒任务模型。
 * - REPEATING：按 intervalMin 循环，可选 endAt 截止（到期自动停止）
 * - ONCE：在 triggerAt 提醒一次，触发后 finished=true
 */
data class Task(
    val id: Long,
    val name: String,
    val type: TaskType,
    val intervalMin: Int,
    /** 一次性提醒时间戳（ONCE 用） */
    val triggerAt: Long?,
    /** 循环截止时间戳（REPEATING 用，null = 不限） */
    val endAt: Long?,
    val mode: TaskMode,
    val sound: Boolean,
    val vibrate: Boolean,
    val enabled: Boolean,
    /** 已结束（循环到期 / 一次性完成） */
    val finished: Boolean,
    /** 下次触发时间戳（毫秒）；null 表示未排程 */
    val nextAt: Long?,
    /** 最近一次触发时间戳（毫秒）；null 表示从未触发 */
    val lastAt: Long?
) {
    /** 序列化为 JSON 字符串（mode/type 使用小写 key） */
    fun toJson(): String = JsonObject().apply {
        addProperty("id", id)
        addProperty("name", name)
        addProperty("type", type.key)
        addProperty("intervalMin", intervalMin)
        add("triggerAt", if (triggerAt != null) JsonParser.parseString(triggerAt.toString()) else JsonNull.INSTANCE)
        add("endAt", if (endAt != null) JsonParser.parseString(endAt.toString()) else JsonNull.INSTANCE)
        addProperty("mode", mode.key)
        addProperty("sound", sound)
        addProperty("vibrate", vibrate)
        addProperty("enabled", enabled)
        addProperty("finished", finished)
        add("nextAt", if (nextAt != null) JsonParser.parseString(nextAt.toString()) else JsonNull.INSTANCE)
        add("lastAt", if (lastAt != null) JsonParser.parseString(lastAt.toString()) else JsonNull.INSTANCE)
    }.toString()

    companion object {
        const val MIN_INTERVAL = 1
        const val MAX_INTERVAL = 9999

        /** 进程内严格递增的 id 序列（避免同毫秒创建任务时 id 冲突导致闹钟互相覆盖） */
        private val idSeq = java.util.concurrent.atomic.AtomicLong(System.currentTimeMillis())

        /** 生成任务 id：从当前毫秒时间戳起严格递增，重启后新 id 必然大于历史 id */
        fun newId(): Long = idSeq.incrementAndGet()

        /** 从 JSON 字符串反序列化；缺失/非法字段回退默认值（容错旧数据） */
        fun fromJson(json: String): Task {
            val o = JsonParser.parseString(json).asJsonObject
            return Task(
                id = o.get("id")?.takeUnless { it.isJsonNull }?.asLong?.takeIf { it != 0L } ?: newId(),
                name = o.get("name")?.takeUnless { it.isJsonNull }?.asString
                    ?.trim()?.ifEmpty { "未命名提醒" } ?: "未命名提醒",
                type = TaskType.fromKey(o.get("type")?.takeUnless { it.isJsonNull }?.asString),
                intervalMin = (o.get("intervalMin")?.takeUnless { it.isJsonNull }?.asInt ?: 30)
                    .coerceIn(MIN_INTERVAL, MAX_INTERVAL),
                triggerAt = o.get("triggerAt")?.takeUnless { it.isJsonNull }?.asLong,
                endAt = o.get("endAt")?.takeUnless { it.isJsonNull }?.asLong,
                mode = TaskMode.fromKey(o.get("mode")?.takeUnless { it.isJsonNull }?.asString),
                sound = o.get("sound")?.takeUnless { it.isJsonNull }?.asBoolean ?: true,
                vibrate = o.get("vibrate")?.takeUnless { it.isJsonNull }?.asBoolean ?: true,
                enabled = o.get("enabled")?.takeUnless { it.isJsonNull }?.asBoolean ?: false,
                finished = o.get("finished")?.takeUnless { it.isJsonNull }?.asBoolean ?: false,
                nextAt = o.get("nextAt")?.takeUnless { it.isJsonNull }?.asLong,
                lastAt = o.get("lastAt")?.takeUnless { it.isJsonNull }?.asLong
            )
        }
    }
}

/** 校验与调度规则（纯函数，便于单元测试） */
object TaskRules {

    data class Validation(val ok: Boolean, val error: String?)

    fun validate(name: String, intervalMin: Int): Validation {
        if (name.isBlank()) return Validation(false, "请填写提醒名称")
        if (name.trim().length > 30) return Validation(false, "提醒名称不能超过 30 个字")
        if (intervalMin !in Task.MIN_INTERVAL..Task.MAX_INTERVAL) {
            return Validation(false, "提醒间隔必须在 ${Task.MIN_INTERVAL} ~ ${Task.MAX_INTERVAL} 分钟之间")
        }
        return Validation(true, null)
    }

    /** 循环间隔毫秒数 */
    fun intervalMillis(task: Task): Long = task.intervalMin.toLong() * 60_000L

    /**
     * 下次触发时间；返回 null 表示不再安排（一次性已过 / 循环已到期）。
     * - ONCE：triggerAt 在未来则返回，否则 null
     * - REPEATING：沿用合法 nextAt，否则 now + 间隔；若超过 endAt 截止则 null
     */
    fun nextTriggerAt(task: Task, now: Long): Long? {
        return when (task.type) {
            TaskType.ONCE -> {
                val t = task.triggerAt
                if (t != null && t > now) t else null
            }
            TaskType.REPEATING -> {
                var next = task.nextAt
                if (next == null || next <= now) next = now + intervalMillis(task)
                val end = task.endAt
                if (end != null && next > end) null else next
            }
        }
    }

    /** 任务是否已结束（循环已到期 / 一次性已完成或时间已过） */
    fun isFinished(task: Task, now: Long): Boolean =
        task.finished || nextTriggerAt(task, now) == null
}
