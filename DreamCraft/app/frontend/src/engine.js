/**
 * 造梦工坊 引擎直连层
 * 每个人可以二选一（或都不选用服务器默认）：
 *   1. 自己电脑的 ComfyUI（浏览器直连 127.0.0.1:8188 或局域网 IP）
 *   2. 自己的 Agnes API key（浏览器直连 api.agnes-ai.cn）
 * 都不配 → 走服务器后端（全局引擎）
 *
 * 配置存 localStorage，出图路由在 generate() 里按优先级选：
 *   用户 ComfyUI 可达 > 用户 Agnes key > 服务器后端
 */
import { api, getRuntime, getToken, localComfyRequest, engineStorageKey } from './api'

const comfyConnections = new Map()

async function comfyFetch(base, path, options = {}) {
  const root = base.replace(/\/$/, '')
  const localPage = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const proxy = () => localComfyRequest(path, options, root)
  if (localPage && comfyConnections.get(root) === 'proxy') return proxy()
  try { return await fetch(root + path, options) }
  catch (error) {
    if (!localPage) throw error
    const runtime = await getRuntime()
    if (!runtime.local_comfy_proxy) throw new Error('浏览器无法连接你的 ComfyUI，请检查地址和跨域设置。公开版不会转发到站长的本机引擎。')
    const response = await proxy()
    if (response.ok) comfyConnections.set(root, 'proxy')
    return response
  }
}

export function getLocalEngine() {
  try { const cfg = JSON.parse(localStorage.getItem(engineStorageKey()) || '{}'); return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {} } catch { return {} }
}
export function setLocalEngine(cfg) {
  localStorage.setItem(engineStorageKey(), JSON.stringify(cfg))
}

// ---------- ComfyUI 直连 ----------
// 浏览器直接打用户本机的 ComfyUI（8188）。127.0.0.1 在浏览器里=用户自己的机器。
export async function comfyReachable(base) {
  if (!base) return false
  try {
    const r = await comfyFetch(base, '/system_stats', {
      method: 'GET', mode: 'cors', signal: AbortSignal.timeout(5000),
    })
    return r.status === 200
  } catch { return false }
}

export async function comfyObjectInfo(base) {
  const r = await comfyFetch(base, '/object_info', { mode: 'cors', signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw new Error('object_info ' + r.status)
  return r.json()
}

/** 查某个 ComfyUI 实例可用的出图档位（和后端 available_engines 同逻辑）。 */
export async function comfyEngines(base) {
  const oi = await comfyObjectInfo(base)
  const opts = (node, field) => {
    const spec = oi[node]?.input?.required?.[field]
    return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || []
  }
  const unets = opts('UNETLoader', 'unet_name')
  const clips = opts('CLIPLoader', 'clip_name')
  const vaes = opts('VAELoader', 'vae_name')
  const ckpts = opts('CheckpointLoaderSimple', 'ckpt_name')
  const loras = opts('LoraLoaderModelOnly', 'lora_name')
  const hasZ = unets.includes('z_image_turbo_int8_convrot.safetensors')
    && clips.includes('qwen_3_4b_fp8_mixed.safetensors')
    && vaes.includes('ae.safetensors')
  const hasSDXL = ckpts.some(c => /sdxl|sd_xl/i.test(c))
  const hasLightning = loras.some(l => /lightning/i.test(l))
  const out = []
  if (hasSDXL && hasLightning) out.push({
    id: 'sdxl-draft', name: 'SDXL 草稿（极速）',
    desc: 'Lightning 4 步，约 6s，适合试构图', rough_seconds: 6,
    ckpt: ckpts.find(c => /sdxl|sd_xl/i.test(c)), lora: loras.find(l => /lightning/i.test(l)),
  })
  if (hasZ) out.push({
    id: 'z-image-turbo', name: 'Z-Image Turbo（精修）',
    desc: '画质最好，8 步，约 25s', rough_seconds: 25,
    unet: 'z_image_turbo_int8_convrot.safetensors', clip: 'qwen_3_4b_fp8_mixed.safetensors',
    vae: 'ae.safetensors',
  })
  if (hasSDXL) out.push({
    id: 'sdxl', name: 'SDXL 标准',
    desc: '28 步，生态最全（LoRA/ControlNet）', rough_seconds: 30,
    ckpt: ckpts.find(c => /sdxl|sd_xl/i.test(c)),
  })
  return { base, engines: out }
}

/** 在指定 ComfyUI 实例上出一张图（构建工作流 + 提交 + 轮询 + 取图 base64 返回）。 */
export async function comfyGenerate(base, engine, {
  prompt, refImage, aspectRatio = '1:1', resolution = 1024, seed, n = 1,
}) {
  const { engines } = await comfyEngines(base)
  const meta = engines.find(e => e.id === engine)
  if (!meta) throw new Error('该 ComfyUI 实例没有 ' + engine + ' 档位')
  const root = base.replace(/\/$/, '')
  const seedN = seed ?? (Date.now() % 2 ** 32)
  const [w, h] = aspectSize(aspectRatio, resolution)

  const wf = meta.id === 'z-image-turbo'
    ? zimageWorkflow(meta, prompt, w, h, seedN)
    : sdxlWorkflow(meta, prompt, w, h, seedN, meta.id === 'sdxl-draft')

  const sampler = wf[meta.id === 'z-image-turbo' ? '8' : '5']
  const latentId = meta.id === 'z-image-turbo' ? '7' : '4'
  const vae = meta.id === 'z-image-turbo' ? ['3', 0] : ['3', 2]
  if (refImage) {
    const image = await fetch(refImage)
    if (!image.ok) throw new Error('参考图片读取失败：' + image.status)
    const upload = new FormData()
    upload.append('image', await image.blob(), 'reference.png')
    const response = await comfyFetch(root, '/upload/image', { method: 'POST', body: upload })
    if (!response.ok) throw new Error('参考图上传失败：' + response.status)
    const file = await response.json()
    wf['0'] = { class_type: 'LoadImage', inputs: { image: [file.subfolder, file.name].filter(Boolean).join('/') } }
    wf[latentId] = { class_type: 'VAEEncode', inputs: { pixels: ['0', 0], vae } }
    sampler.inputs.denoise = 0.55
    if (n > 1) {
      wf['11'] = { class_type: 'RepeatLatentBatch', inputs: { samples: [latentId, 0], amount: n } }
      sampler.inputs.latent_image = ['11', 0]
    }
  } else wf[latentId].inputs.batch_size = n

  const submit = await comfyFetch(root, '/prompt', {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'dreamcraft-web' }),
  })
  if (!submit.ok) throw new Error('ComfyUI 提交失败 ' + submit.status + ': '
    + (await submit.text()).slice(0, 200))
  const { prompt_id: pid } = await submit.json()
  if (!pid) throw new Error('ComfyUI 没返回 prompt_id')

  const t0 = Date.now()
  while (Date.now() - t0 < 600000) {
    await sleep(2000)
    const hres = await comfyFetch(root, `/history/${pid}`, { mode: 'cors' })
    if (!hres.ok) throw new Error('查询生成进度失败：' + hres.status)
    const h = await hres.json()
    if (!(pid in h)) continue
    const st = h[pid].status || {}
    if (st.status_str === 'error') {
      throw new Error('ComfyUI 执行错误: ' + JSON.stringify(st.messages).slice(0, 200))
    }
    const imgs = []
    for (const o of Object.values(h[pid].outputs || {})) {
      for (const im of o.images || []) imgs.push(im)
    }
    if (imgs.length) {
      // 浏览器直连时 /view 返回的是图片本体，转 base64 展示（绕开跨域 CORS 图片限制）
      const results = []
      for (const im of imgs.slice(0, n)) {
        const view = await comfyFetch(root, '/view?filename=' + encodeURIComponent(im.filename)
          + '&subfolder=' + encodeURIComponent(im.subfolder || '') + '&type=output', { mode: 'cors' })
        if (!view.ok) throw new Error('读取生成图片失败：' + view.status)
        const blob = await view.blob()
        const b64 = await blobToB64(blob)
        results.push({ url: b64, seed: seedN, engine: meta.id, local: true })
      }
      return { status: 'success', engine: meta.id, results }
    }
  }
  throw new Error('ComfyUI 超时（10 分钟没出图）')
}

// ---------- 工作流 ----------
function zimageWorkflow(meta, prompt, w, h, seed) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: meta.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: meta.clip, type: 'qwen_image' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: meta.vae } },
    '4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.0 } },
    '5': { class_type: 'TextEncodeZImageOmni',
           inputs: { clip: ['2', 0], prompt, auto_resize_images: true } },
    '6': { class_type: 'TextEncodeZImageOmni',
           inputs: { clip: ['2', 0], prompt: '', auto_resize_images: true } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '8': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0],
         latent_image: ['7', 0], seed, steps: 12, cfg: 2.0,
         sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'dreamcraft', images: ['9', 0] } },
  }
}

function sdxlWorkflow(meta, prompt, w, h, seed, isDraft) {
  const wf = {
    '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: meta.ckpt } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { model: ['3', 0], positive: ['6', 0], negative: ['7', 0],
         latent_image: ['4', 0], seed, steps: isDraft ? 4 : 28,
         cfg: isDraft ? 1.0 : 6.5, sampler_name: 'euler',
         scheduler: isDraft ? 'sgm_uniform' : 'normal', denoise: 1.0 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['3', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['3', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['3', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'dreamcraft', images: ['8', 0] } },
  }
  if (isDraft && meta.lora) {
    wf['10'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['3', 0], lora_name: meta.lora, strength_model: 1.0 } }
    wf['5'].inputs.model = ['10', 0]
  }
  return wf
}

// ---------- Agnes key 直连 ----------
export async function agnesReachable(key, root) {
  if (!key) return false
  const r = await fetch((root || 'https://api.agnes-ai.cn').replace(/\/$/, '') + '/v1/models', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(10000),
  })
  return r.status === 200
}

export async function agnesGenerate(key, root, { prompt, refImage, aspectRatio = '1:1', resolution = 1024, seed, n = 1 }) {
  const r0 = (root || 'https://api.agnes-ai.cn').replace(/\/$/, '')
  const [w, h] = aspectSize(aspectRatio, resolution)
  const body = {
    model: 'agnes-image-2.5-flash', prompt, size: `${w}x${h}`,
    extra_body: { response_format: 'url' },
  }
  if (refImage) body.extra_body.image = [refImage]
  if (seed != null) body.seed = seed
  const results = []
  for (let i = 0; i < n; i++) {
  const res = await fetch(r0 + '/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Agnes ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const d = await res.json()
  for (const item of d.data || []) {
    const url = item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : null)
    if (url) results.push({ url, seed: item.seed ?? seed, engine: 'agnes-image-2.5-flash' })
  }
  if (results.length >= n) break
  }
  if (!results.length) throw new Error('Agnes 没返回图片')
  return { status: 'success', engine: 'agnes', results: results.slice(0, n) }
}

// ---------- 统一路由 ----------
/** 按优先级出图：本机 ComfyUI > 用户 Agnes key > 服务器后端。
    统一返回 { source, results: [...], engine } —— 调用方只认 results。 */
export async function routeGenerate({
  prompt, refImage, aspectRatio, resolution, seed, n, model,
}) {
  const local = getLocalEngine()
  const ownerToken = getToken()
  const ensureOwner = () => { if (getToken() !== ownerToken) throw new Error('账号已切换，请重新操作') }

  // 1. 本机 ComfyUI
  if (local.comfyui_url && await comfyReachable(local.comfyui_url)) {
    ensureOwner()
    const { engines } = await comfyEngines(local.comfyui_url)
    ensureOwner()
    if (engines.length) {
      const engine = engines.some(e => e.id === model) ? model
        : (engines.some(e => e.id === local.default_engine) ? local.default_engine : engines[0].id)
      const result = await comfyGenerate(local.comfyui_url, engine,
        { prompt, refImage, aspectRatio, resolution, seed, n })
      const warning = await saveLocalResults(result.results, prompt, ownerToken)
      return { source: 'comfyui:' + local.comfyui_url,
               results: result.results ?? [], engine: result.engine, warning }
    }
  }
  // 2. 用户 Agnes key
  if (local.agnes_key) {
    ensureOwner()
    const result = await agnesGenerate(local.agnes_key, local.agnes_root,
      { prompt, refImage, aspectRatio, resolution, seed, n })
    const warning = await saveLocalResults(result.results, prompt, ownerToken)
    return { source: 'agnes:' + (local.agnes_root || '默认'),
             results: result.results ?? [], engine: result.engine, warning }
  }
  // 3. 服务器后端兜底
  ensureOwner()
  const body = {
    prompt, model: model || 'default',
    ref_image: refImage, aspect_ratio: aspectRatio,
    resolution, n, seed,
  }
  const r = await api.submitImage(body)
  // 服务器返回 { task_id, result: { status, engine, results: [...] } }
  const res = r.result || {}
  return {
    source: 'server',
    results: res.results ?? [],
    engine: res.engine,
  }
}

async function saveLocalResults(results, prompt, ownerToken) {
  try {
    for (const item of results || []) {
      if (getToken() !== ownerToken) throw new Error('生成期间账号已切换，请下载当前图片')
      const saved = await api.assetCreate({ url: item.url, kind: 'image', prompt, record_task: true })
      if (saved.url) item.url = saved.url
    }
  } catch (e) { return '图片已生成，但未保存到素材库：' + e.message }
}

// ---------- utils ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}
function aspectSize(ar, res) {
  let [a, b] = ar.split(':').map(Number)
  if (!a || !b) { a = b = 1 }
  let w, h
  if (a >= b) { w = res; h = Math.round(res * b / a) }
  else { h = res; w = Math.round(res * a / b) }
  return [w >> 3 << 3, h >> 3 << 3]
}
