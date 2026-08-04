package com.example.timereminder.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskTest {

    private val sample = Task(
        id = 12345L,
        name = "喝水",
        type = TaskType.REPEATING,
        intervalMin = 30,
        triggerAt = null,
        endAt = 2_000_000L,
        mode = TaskMode.BOTH,
        sound = true,
        vibrate = false,
        enabled = true,
        finished = false,
        nextAt = 1_000_000L,
        lastAt = 999_000L
    )

    @Test
    fun `序列化往返字段无损`() {
        val back = Task.fromJson(sample.toJson())
        assertEquals(sample, back)
    }

    @Test
    fun `一次性任务序列化往返`() {
        val once = sample.copy(
            type = TaskType.ONCE,
            triggerAt = 5_000_000L,
            endAt = null,
            intervalMin = 1,
            finished = true
        )
        assertEquals(once, Task.fromJson(once.toJson()))
    }

    @Test
    fun `JSON 中 null 字段可读回为 null`() {
        val json = """
            {"id":1,"name":"喝水","type":"repeating","intervalMin":30,
             "triggerAt":null,"endAt":null,"mode":"notification",
             "sound":true,"vibrate":true,"enabled":false,"finished":false,
             "nextAt":null,"lastAt":null}
        """.trimIndent()
        val back = Task.fromJson(json)
        assertNull(back.triggerAt)
        assertNull(back.endAt)
        assertNull(back.nextAt)
        assertNull(back.lastAt)
        assertFalse(back.enabled)
        assertFalse(back.finished)
        assertEquals(TaskMode.NOTIFICATION, back.mode)
    }

    @Test
    fun `旧数据缺失新字段时补默认`() {
        // 模拟旧版本存储（无 type/endAt/triggerAt/finished）
        val back = Task.fromJson(
            """{"id":9,"name":"喝水","intervalMin":30,"mode":"both",
               "sound":true,"vibrate":true,"enabled":true,
               "nextAt":123,"lastAt":null}"""
        )
        assertEquals(TaskType.REPEATING, back.type)
        assertNull(back.triggerAt)
        assertNull(back.endAt)
        assertFalse(back.finished)
        assertEquals(30, back.intervalMin)
    }

    @Test
    fun `缺失字段补默认值`() {
        val back = Task.fromJson("{}")
        assertEquals("未命名提醒", back.name)
        assertEquals(TaskType.REPEATING, back.type)
        assertEquals(30, back.intervalMin)
        assertEquals(TaskMode.BOTH, back.mode)
        assertTrue(back.sound)
        assertFalse(back.enabled)
        assertFalse(back.finished)
        assertNull(back.nextAt)
    }

    @Test
    fun `非法值回退默认`() {
        val back = Task.fromJson(
            """{"id":0,"name":"   ","intervalMin":99999,"type":"weekly","mode":"buzz"}"""
        )
        assertTrue(back.id != 0L)
        assertEquals("未命名提醒", back.name)
        assertEquals(Task.MAX_INTERVAL, back.intervalMin)
        assertEquals(TaskType.REPEATING, back.type)
        assertEquals(TaskMode.BOTH, back.mode)
    }

    @Test
    fun `type 两种 key 均能读回`() {
        assertEquals(TaskType.REPEATING, TaskType.fromKey("repeating"))
        assertEquals(TaskType.ONCE, TaskType.fromKey("once"))
        assertEquals(TaskType.REPEATING, TaskType.fromKey(null))
        assertEquals(TaskType.REPEATING, TaskType.fromKey("daily"))
    }

    @Test
    fun `type 序列化为小写 key`() {
        val json = sample.copy(type = TaskType.ONCE).toJson()
        assertTrue(json.contains("\"type\":\"once\""))
    }
}
