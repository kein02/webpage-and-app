package com.example.timereminder.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskRulesTest {

    private val now = 1_000_000_000_000L

    private fun task(
        type: TaskType = TaskType.REPEATING,
        intervalMin: Int = 30,
        triggerAt: Long? = null,
        endAt: Long? = null,
        nextAt: Long? = null,
        finished: Boolean = false
    ) = Task(
        id = 1L,
        name = "喝水",
        type = type,
        intervalMin = intervalMin,
        triggerAt = triggerAt,
        endAt = endAt,
        mode = TaskMode.NOTIFICATION,
        sound = true,
        vibrate = true,
        enabled = true,
        finished = finished,
        nextAt = nextAt,
        lastAt = null
    )

    @Test
    fun `间隔毫秒 = 分钟 x 60000`() {
        assertEquals(30L * 60_000L, TaskRules.intervalMillis(task(intervalMin = 30)))
        assertEquals(1L * 60_000L, TaskRules.intervalMillis(task(intervalMin = 1)))
        assertEquals(9999L * 60_000L, TaskRules.intervalMillis(task(intervalMin = 9999)))
    }

    /* ---------- REPEATING ---------- */

    @Test
    fun `循环-nextAt 在未来时沿用`() {
        val t = task(nextAt = now + 5000)
        assertEquals(now + 5000, TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `循环-nextAt 为空时 = now + 间隔`() {
        val t = task(intervalMin = 5, nextAt = null)
        assertEquals(now + 5L * 60_000L, TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `循环-nextAt 已过期时重新计算`() {
        val t = task(intervalMin = 5, nextAt = now - 1000)
        assertEquals(now + 5L * 60_000L, TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `循环-超过截止时间返回 null（到期不再排）`() {
        // 下一次触发（now+30min）超过截止（now+10min）→ null
        val t = task(intervalMin = 30, endAt = now + 10L * 60_000L)
        assertNull(TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `循环-截止时间在未来时正常返回`() {
        val t = task(intervalMin = 30, endAt = now + 40L * 60_000L)
        assertEquals(now + 30L * 60_000L, TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `循环-截止时间与下一次相等时仍触发一次后截止`() {
        val t = task(intervalMin = 30, endAt = now + 30L * 60_000L)
        assertEquals(now + 30L * 60_000L, TaskRules.nextTriggerAt(t, now))
    }

    /* ---------- ONCE ---------- */

    @Test
    fun `一次性-时间在未来返回该时间`() {
        val t = task(type = TaskType.ONCE, triggerAt = now + 60_000L)
        assertEquals(now + 60_000L, TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `一次性-时间已过返回 null`() {
        val t = task(type = TaskType.ONCE, triggerAt = now - 1000L)
        assertNull(TaskRules.nextTriggerAt(t, now))
    }

    @Test
    fun `一次性-未设置时间返回 null`() {
        val t = task(type = TaskType.ONCE, triggerAt = null)
        assertNull(TaskRules.nextTriggerAt(t, now))
    }

    /* ---------- isFinished ---------- */

    @Test
    fun `已完成标记优先判定`() {
        assertTrue(TaskRules.isFinished(task(finished = true), now))
    }

    @Test
    fun `一次性完成后判定结束`() {
        assertTrue(TaskRules.isFinished(task(type = TaskType.ONCE, triggerAt = now - 1L), now))
        assertFalse(TaskRules.isFinished(task(type = TaskType.ONCE, triggerAt = now + 60_000L), now))
    }

    @Test
    fun `循环到期判定结束`() {
        assertTrue(TaskRules.isFinished(task(intervalMin = 30, endAt = now + 10L * 60_000L), now))
        assertFalse(TaskRules.isFinished(task(intervalMin = 30, endAt = now + 40L * 60_000L), now))
    }

    /* ---------- validate ---------- */

    @Test
    fun `校验-空名称`() {
        val r = TaskRules.validate("   ", 30)
        assertFalse(r.ok)
        assertTrue(r.error!!.contains("名称"))
    }

    @Test
    fun `校验-名称超长`() {
        val r = TaskRules.validate("一".repeat(31), 30)
        assertFalse(r.ok)
    }

    @Test
    fun `校验-间隔越界`() {
        assertFalse(TaskRules.validate("喝水", 0).ok)
        assertFalse(TaskRules.validate("喝水", 10000).ok)
        assertTrue(TaskRules.validate("喝水", 1).ok)
        assertTrue(TaskRules.validate("喝水", 9999).ok)
    }

    @Test
    fun `校验-合法输入通过`() {
        val r = TaskRules.validate("喝水", 30)
        assertTrue(r.ok)
        assertTrue(r.error == null)
    }
}
