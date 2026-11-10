import { useCallback, useEffect, useRef, useState } from 'react'
import { api, engineStorageKey, getToken } from './api'

const pendingFlushes = new Map()

export default function useProject(kind, initial) {
  const [view, setView] = useState({ data: initial, name: '未命名项目', id: null, revision: 0 })
  const [projects, setProjects] = useState([])
  const [ready, setReady] = useState(false)
  const [state, setState] = useState('正在加载')
  const [error, setError] = useState('')
  const [loadVersion, setLoadVersion] = useState(0)
  const [working, setWorking] = useState(false)
  const current = useRef(view), dirty = useRef(false), saving = useRef(null)
  const mounted = useRef(false), blocked = useRef(false)
  const token = useRef(getToken())
  const draftKey = 'dc_project_draft:' + engineStorageKey() + ':' + kind
  const notify = (fn) => { if (mounted.current && token.current === getToken()) fn() }
  const remember = value => {
    try { localStorage.setItem(draftKey, JSON.stringify(value)) } catch {
      notify(() => setError('浏览器恢复副本写入失败，请保持页面打开并保存项目'))
    }
  }
  const update = useCallback(value => {
    const prev = current.current
    const next = { ...prev, data: typeof value === 'function' ? value(prev.data) : value }
    current.current = next; dirty.current = true
    remember(next)
    setView(next); setState('待保存')
  }, [draftKey])
  const rename = name => {
    current.current = { ...current.current, name }
    dirty.current = true; remember(current.current)
    setView(current.current); setState('待保存')
  }
  const refresh = async () => {
    const result = await api.projectList(kind)
    notify(() => setProjects(result.projects || []))
  }
  const save = async () => {
    if (token.current !== getToken()) throw new Error('账号已切换，恢复副本保留在原账号下')
    if (saving.current) {
      await saving.current
      if (dirty.current) return save()
      return
    }
    if (!dirty.current) return
    if (blocked.current) throw new Error('请先重新打开项目以解决版本冲突；本地恢复副本已保留')
    const snapshot = current.current
    if (!snapshot.name.trim()) {
      setError('项目名称不能为空')
      throw new Error('项目名称不能为空')
    }
    notify(() => { setState('正在保存'); setError('') })
    saving.current = (async () => {
      try {
        const result = await api.projectSave({ ...snapshot, kind })
        const unchanged = current.current === snapshot
        current.current = { ...current.current, id: result.id, revision: result.revision }
        dirty.current = !unchanged
        if (dirty.current) remember(current.current)
        else localStorage.removeItem(draftKey)
        notify(() => { setView(current.current); setState(unchanged ? '已保存' : '待保存') })
        await refresh()
      } catch (e) {
        if (e.message.includes('其他窗口')) blocked.current = true
        notify(() => { setState('保存失败'); setError(e.message) })
        throw e
      } finally { saving.current = null }
    })()
    await saving.current
  }
  const replace = next => {
    current.current = next; dirty.current = false; blocked.current = false
    localStorage.removeItem(draftKey)
    setView(next); setError(''); setState(next.id ? '已保存' : '新项目')
  }
  const open = async id => {
    setWorking(true)
    try {
      if (blocked.current) {
        if (!window.confirm('重新打开将放弃本窗口的未保存修改，是否继续？')) return false
      } else await save()
      const next = await api.projectGet(id)
      replace(next)
      return true
    } catch (e) { setError(e.message); return false }
    finally { setWorking(false) }
  }
  const create = async () => {
    setWorking(true)
    try {
      if (blocked.current) throw new Error('请先重新打开项目以解决版本冲突')
      await save()
      replace({ data: initial, name: '未命名项目', id: null, revision: 0 })
      return true
    } catch (e) { setError(e.message); return false }
    finally { setWorking(false) }
  }
  const remove = async () => {
    if (!current.current.id || !window.confirm('删除此项目？素材库中的文件会保留。')) return false
    setWorking(true)
    try {
      if (!blocked.current) await save()
      else if (saving.current) await saving.current
      await api.projectDelete(current.current.id)
      replace({ data: initial, name: '未命名项目', id: null, revision: 0 })
      await refresh()
      return true
    } catch (e) { setError(e.message); return false }
    finally { setWorking(false) }
  }
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const load = async () => {
      try {
        // A route can remount before its previous save finishes.
        await pendingFlushes.get(draftKey)?.catch(() => {})
        if (cancelled) return
        const result = await api.projectList(kind)
        if (cancelled) return
        let draft
        try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null') } catch {}
        let next
        if (draft?.data && typeof draft.name === 'string') {
          next = draft; dirty.current = true
        } else if (result.projects?.length) next = await api.projectGet(result.projects[0].id)
        if (cancelled) return
        if (next) { current.current = next; setView(next) }
        setProjects(result.projects || [])
        setState(dirty.current ? '恢复副本待保存' : next ? '已保存' : '新项目')
        setReady(true)
      } catch (e) {
        if (!cancelled) { setError(e.message); setState('加载失败') }
      }
    }
    load()
    return () => {
      cancelled = true; mounted.current = false
      if (dirty.current && !blocked.current) {
        const flush = save().catch(() => {})
        pendingFlushes.set(draftKey, flush)
        flush.finally(() => { if (pendingFlushes.get(draftKey) === flush) pendingFlushes.delete(draftKey) })
      }
    }
  }, [kind, draftKey, loadVersion])
  useEffect(() => {
    if (!ready || !dirty.current || blocked.current) return
    const timer = setTimeout(() => save().catch(() => {}), 700)
    return () => clearTimeout(timer)
  }, [view, ready])
  useEffect(() => {
    const beforeUnload = e => {
      if (!dirty.current) return
      e.preventDefault(); e.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  const saveNow = () => {
    dirty.current = true
    remember(current.current)
    return save()
  }
  return { ...view, setData: update, rename, projects, ready, working, state, error, save: saveNow,
    reload: () => setLoadVersion(n => n + 1), open, create, remove }
}
