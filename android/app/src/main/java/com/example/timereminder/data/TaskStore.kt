package com.example.timereminder.data

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonParser

/**
 * 任务持久化：SharedPreferences + JSON。
 * 与浏览器原型 localStorage 语义一致（保存整个任务数组）。
 */
class TaskStore(context: Context) {

    internal val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): List<Task> {
        val raw = prefs.getString(KEY_TASKS, null) ?: return emptyList()
        return try {
            val arr = JsonParser.parseString(raw).asJsonArray
            (0 until arr.size()).map { Task.fromJson(arr[it].toString()) }
        } catch (e: Exception) {
            // 数据损坏时返回空（不崩溃）
            emptyList()
        }
    }

    fun save(tasks: List<Task>) {
        val arr = JsonArray()
        tasks.forEach { arr.add(JsonParser.parseString(it.toJson())) }
        prefs.edit().putString(KEY_TASKS, arr.toString()).apply()
    }

    companion object {
        private const val PREFS_NAME = "timer_reminder"
        private const val KEY_TASKS = "tasks"
    }
}
