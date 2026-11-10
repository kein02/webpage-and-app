// 造梦工坊 接口客户端 + 登录态管理
// 同源部署留空；前后端分离时用 VITE_API_BASE 指定后端地址
const BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '')

/** 把后端返回的相对资源路径（/exports/x.png）转成可访问 URL。
    同源部署原样返回；分离部署拼上后端域名。 */
export function assetUrl(u) {
  if (!u) return ''
  if (/^(https?:|data:|blob:)/.test(u)) return u
  const mediaToken = sessionStorage.getItem('dc_media_token')
  if (BASE && /^\/(uploads|exports)\//.test(u) && mediaToken) {
    return BASE + u + (u.includes('?') ? '&' : '?') + 'access=' + encodeURIComponent(mediaToken)
  }
  return BASE + u
}

let runtimePromise
let logoutPending = Promise.resolve()
export function getRuntime() {
  if (!runtimePromise) runtimePromise = get('/api/runtime').catch(error => { runtimePromise = null; throw error })
  return runtimePromise
}

export function localComfyRequest(path, options, base) {
  return fetch(BASE + '/api/comfy' + path, { ...options,
    headers: { ...options.headers, ...authHeaders(), 'X-Comfy-Base': base } })
}

// ---- 登录态：token 存 localStorage，所有请求带 Authorization ----
export function getToken() {
  return localStorage.getItem('dc_token') || ''
}
export function engineStorageKey() {
  try {
    const payload = getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return 'dc_engine_local:' + (JSON.parse(atob(payload)).uid || 'anon')
  } catch { return 'dc_engine_local:anon' }
}
window.addEventListener('storage', event => {
  if (event.key === 'dc_token') {
    sessionStorage.removeItem('dc_media_token')
    window.dispatchEvent(new Event('dc-auth-changed'))
  }
})
export function setToken(t) {
  const previous = getToken()
  if (previous !== (t || '')) {
    localStorage.removeItem('dc_engine_local')
    sessionStorage.removeItem('dc_media_token')
    if (!t) logoutPending = fetch(BASE + '/api/auth/logout', { method: 'POST' }).catch(() => {})
  }
  if (t) localStorage.setItem('dc_token', t)
  else localStorage.removeItem('dc_token')
  window.dispatchEvent(new Event('dc-auth-changed'))
}

function authHeaders() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function readResponse(r, url, requestToken) {
  if (requestToken !== getToken()) throw new Error('账号已切换，请重新操作')
  if (!r.ok) {
    let msg = `${url} -> ${r.status}`
    try { const d = await r.json(); if (d.detail) msg = typeof d.detail === 'string' ? d.detail : d.detail.map(e => e.msg).join('；') } catch {}
    if (r.status === 401 && requestToken === getToken() && requestToken) setToken('')
    throw new Error(msg)
  }
  const data = await r.json()
  if (requestToken !== getToken()) throw new Error('账号已切换，请重新操作')
  if (data.media_token && url === '/api/auth/me') sessionStorage.setItem('dc_media_token', data.media_token)
  return data
}

async function post(url, body) {
  if (url === '/api/auth/login' || url === '/api/auth/register') await logoutPending
  const requestToken = getToken()
  return readResponse(await fetch(BASE + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }), url, requestToken)
}

async function get(url) {
  const requestToken = getToken()
  const r = await fetch(BASE + url, { headers: authHeaders() })
  return readResponse(r, url, requestToken)
}

export const api = {
  // 鉴权
  register: (body) => post('/api/auth/register', body),
  login: (body) => post('/api/auth/login', body),
  me: () => get('/api/auth/me'),

  // 模型配置
  modelConfig: () => get('/lv/v1/generate/model_config'),

  // 图片生成
  submitImage: (body) => post('/lv/v1/editor/image/ai_model/submit_task', body),

  // 视频生成（任务制：提交立即返回 task_id，轮询 taskStatus）
  submitVideoTask: (body) => post('/lv/v1/editor/video/submit_task', body),
  taskStatus: (task_id) => get(`/lv/v1/task/status/${task_id}`),
  multiGetTasks: (taskIds) => post('/lv/v2/task/multi_get_tasks', { task_ids: taskIds }),

  // Agent
  agentRun: (body) => post('/api/biz/v1/agent/submit_run', body),

  // 上传 / 素材
  uploadFile: async (file, kind = 'image') => {
    const requestToken = getToken()
    const s = await api.uploadSign()
    if (requestToken !== getToken()) throw new Error('账号已切换，请重新操作')
    const form = new FormData()
    form.append('file', file)
    const up = await fetch(BASE + `/api/upload/${kind === 'audio' ? 'audio/' : ''}${s.upload_key}`, {
      method: 'POST', body: form, headers: authHeaders(),
    })
    return readResponse(up, '上传图片', requestToken)
  },
  uploadSign: () => post('/api/biz/v1/common/get_upload_sign', {}),
  assetCreate: (body) => post('/api/biz/v1/asset/create_v2', body),
  assetList: (limit = 60, kind = '', options = {}) =>
    get('/api/biz/v1/asset/list?' + new URLSearchParams({ limit, ...(kind ? { kind } : {}), ...options })),
  assetEdit: (id, body) => post(`/api/biz/v1/asset/${id}/edit`, body),
  assetTrash: (ids, restore = false) => post('/api/biz/v1/asset/trash', { ids, restore }),
  assetDownload: async (ids) => {
    const token = getToken()
    const response = await fetch(BASE + '/api/biz/v1/asset/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ids }),
    })
    if (!response.ok) return readResponse(response, '下载素材', token)
    const blob = await response.blob()
    if (token !== getToken()) throw new Error('账号已切换，请重新操作')
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'DreamCraft-assets.zip'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  projectList: kind => get('/api/biz/v1/project/list?kind=' + kind),
  projectGet: id => get('/api/biz/v1/project/' + id),
  projectSave: body => post('/api/biz/v1/project/save', body),
  projectDelete: id => post(`/api/biz/v1/project/${id}/delete`, {}),
  taskRetry: id => post(`/lv/v1/task/${id}/retry`, {}),
  taskResume: id => post(`/lv/v1/task/${id}/resume`, {}),

  // 模板
  templateCategories: () => get('/lv/v1/cc_web/plane/get_categories'),
  collectionTemplates: (catId = '1') =>
    get(`/lv/v1/cc_web/plane/get_collection_templates?category_id=${catId}`),

  // 图像编辑工具
  imageEdit: (toolId, body) => {
    let local = {}
    try { local = JSON.parse(localStorage.getItem(engineStorageKey()) || '{}') || {} } catch {}
    return post(`/lv/v1/editor/image/${toolId}`, { ...body, engine: {
      comfyui_url: local.comfyui_url, agnes_key: local.agnes_key,
      agnes_root: local.agnes_root, default_engine: local.default_engine,
    } })
  },

  // 短剧
  dramaScript: (body) => post('/lv/v1/short_drama/create_script', body),
  dramaShotVideo: (body) => post('/lv/v1/short_drama/shot_to_video', body),
  dramaRenderAll: (body) => post('/lv/v1/short_drama/render_all', body),
  dramaCompose: (body) => post('/lv/v1/short_drama/compose', body),

  // 用户级引擎配置（接入自己的 Agnes key / ComfyUI 地址 / 视频平台）
  engineConfig: () => get('/api/biz/v1/engine/config'),
  engineSet: (body) => post('/api/biz/v1/engine/config', body),
  engineAvailable: () => get('/api/biz/v1/engine/available'),
  engineDiagnostics: () => get('/api/biz/v1/engine/diagnostics'),
  videoPlatforms: () => get('/api/biz/v1/video/platforms'),

  // 团队
  teamCreate: (body) => post('/api/biz/v1/team/create', body),
  teamList: () => get('/api/biz/v1/team/list'),
  teamGet: (tid) => get(`/api/biz/v1/team/${tid}`),
  teamAddMember: (tid, body) => post(`/api/biz/v1/team/${tid}/members`, body),
  teamSetRole: (tid, mid, role) => post(`/api/biz/v1/team/${tid}/members/${mid}/role`, { role }),
  teamSetPlan: (tid, plan) => post(`/api/biz/v1/team/${tid}/plan`, { plan }),
  teamRemoveMember: async (tid, mid) => {
    const requestToken = getToken()
    const response = await fetch(BASE + `/api/biz/v1/team/${tid}/members/${mid}`, {
      method: 'DELETE', headers: authHeaders(),
    })
    return readResponse(response, '移除成员', requestToken)
  },

  // 商业化
  commerceEntrances: () => get('/lv/v1/commerce/get_entrances'),
  balance: () => get('/lv/v1/commerce/balance'),
  recharge: (amount) => post('/lv/v1/commerce/recharge', { amount }),
  subscribe: (plan) => post('/lv/v1/commerce/subscribe', { plan }),
  purchaseRecords: () => get('/lv/v1/purchase/purchase_record'),
}

// 页面用：登录成功后存 token
export function afterLogin(r) {
  setToken(r.token)
  if (r.media_token) sessionStorage.setItem('dc_media_token', r.media_token)
  api.me().catch(() => {})
}
