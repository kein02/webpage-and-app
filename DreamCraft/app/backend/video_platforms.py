"""
视频平台适配器：支持多平台 OpenAI 兼容接口，用户自填 key + 自选平台。

平台清单（每个都是 OpenAI 兼容的 /v1/models 鉴权）：
  agnes      - Agnes AI（默认，agnes-video-2.5-flash）
  siliconflow- 硅基流动（Wan2.2 / HunyuanVideo 等）
  dashscope  - 阿里百炼（通义万相 wanx / wan2.x）
  bigmodel   - 智谱（CogVideoX）
  moonshot   - 月之暗面（目前无视频，保留位）
  ark        - 火山方舟（豆包 Seedance）
  openai     - 通用 OpenAI 兼容（自定义 base_url）

统一接口：submit(platform, key, base_url, prompt, ref_image) -> {task_id, platform}
           poll(platform, key, base_url, task_id) -> {status, url, error}
"""
import json, time, urllib.request, urllib.error, os, base64
from urllib.parse import urlencode
from providers import open_remote, read_image_bytes

# 平台注册表：base_url / 提交路径 / 查询路径 / 默认模型
PLATFORMS = {
    "agnes": {
        "name": "Agnes AI",
        "base": "https://api.agnes-ai.cn",
        "submit": "/v1/videos",
        "poll": "/agnesapi",
        "model": "agnes-video-2.5-flash",
        "mode_field": "mode",        # Agnes 要求 mode: text/image
        "id_field": "video_id",
        "poll_style": "agnes",       # ?video_id=x&model_name=y
    },
    "siliconflow": {
        "name": "硅基流动",
        "base": "https://api.siliconflow.cn",
        "submit": "/v1/video/submit",
        "poll": "/v1/video/status",
        "model": "Wan-AI/Wan2.2-T2V-A14B",
        "id_field": "requestId",
        "poll_style": "query_reqid",  # ?requestId=x
    },
    "dashscope": {
        "name": "阿里百炼",
        "base": "https://dashscope.aliyuncs.com",
        "submit": "/api/v1/services/aigc/video-generation/video-synthesis",
        "poll": "/api/v1/tasks",
        "model": "wan2.6-t2v",
        "id_field": "task_id",
        "poll_style": "dashscope",    # /api/v1/tasks/{id}
    },
    "bigmodel": {
        "name": "智谱 BigModel",
        "base": "https://open.bigmodel.cn",
        "submit": "/api/paas/v4/videos/generations",
        "poll": "/api/paas/v4/async-result",
        "model": "cogvideox-3",
        "id_field": "id",
        "poll_style": "zhipu",        # /async-result/{id}
    },
    "ark": {
        "name": "火山方舟",
        "base": "https://ark.cn-beijing.volces.com",
        "submit": "/api/v3/contents/generations/tasks",
        "poll": "/api/v3/contents/generations/tasks",
        "model": "doubao-seedance-1-0-pro",
        "id_field": "id",
        "poll_style": "path_id",      # /tasks/{id}
    },
}


class VideoPlatformError(RuntimeError):
    pass


def _post(url, body, key, timeout=120, headers=None):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {key}", **(headers or {})})
    try:
        with open_remote(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode()[:300]
        except Exception:
            pass
        if "queue_full" in detail:
            raise VideoPlatformError("平台队列已满，请稍后重试")
        if e.code == 503:
            raise VideoPlatformError("平台服务暂时不可用（HTTP 503），请稍后重试")
        if e.code in (401, 403) or "quota" in detail or "invalid_api_key" in detail:
            raise VideoPlatformError(f"API key 无效或额度不足：{detail[:150]}")
        raise VideoPlatformError(f"提交失败 HTTP {e.code}: {detail[:200]}")


def _get(url, key, timeout=60):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    try:
        with open_remote(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise VideoPlatformError(f"查询失败 HTTP {e.code}: {e.read().decode()[:150]}")


def list_platforms():
    """给前端下拉用。"""
    return [{"id": k, "name": v["name"], "default_model": v["model"]}
            for k, v in PLATFORMS.items()]


def submit(platform, key, prompt, ref_image=None, model=None, base_url=None, duration=5):
    if platform not in PLATFORMS:
        raise VideoPlatformError(f"未知平台 {platform}，支持：{list(PLATFORMS)}")
    cfg = PLATFORMS[platform]
    base = (base_url or cfg["base"]).rstrip("/")
    m = model or cfg["model"]
    if ref_image and ref_image.startswith(('/uploads/', '/exports/')):
        import io
        from PIL import Image
        image = Image.open(io.BytesIO(read_image_bytes(ref_image)))
        output = io.BytesIO()
        image.convert('RGB').save(output, 'PNG')
        ref_image = 'data:' + 'image/png;base64,' + base64.b64encode(output.getvalue()).decode()

    if platform == "agnes":
        body = {"model": m, "prompt": prompt,
                "mode": "image" if ref_image else "text"}
        if ref_image:
            body["image"] = ref_image
    elif platform == "dashscope":
        body = {"model": m, "input": {"prompt": prompt}, "parameters": {"duration": duration}}
        if ref_image:
            body["input"]["img_url"] = ref_image
    elif platform == "bigmodel":
        body = {"model": m, "prompt": prompt}
        if ref_image:
            body["image_url"] = ref_image
    elif platform == "ark":
        content = [{"type": "text", "text": prompt}]
        if ref_image:
            content.insert(0, {"type": "image_url", "image_url": {"url": ref_image}})
        body = {"model": m, "content": content, "duration": duration}
    else:  # siliconflow / 通用
        body = {"model": m, "prompt": prompt}
        if ref_image:
            body["image"] = ref_image

    data = _post(base + cfg["submit"], body, key,
                 headers={"X-DashScope-Async": "enable"} if platform == 'dashscope' else None)
    tid = _extract_id(data, cfg)
    if not tid:
        raise VideoPlatformError(f"平台没返回任务 id：{str(data)[:200]}")
    return {"task_id": tid, "platform": platform, "model": m}


def _extract_id(data, cfg):
    """从各种响应结构里挖 task id。"""
    field = cfg.get("id_field")
    for path in ([field] if field else []) + ["id", "task_id", "video_id", "requestId", "data", "output"]:
        if not path:
            continue
        v = data.get(path)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict):
            for k in ("id", "task_id", "video_id", "requestId"):
                if isinstance(v.get(k), str):
                    return v[k]
    return None


def poll(platform, key, task_id, model=None, base_url=None):
    cfg = PLATFORMS[platform]
    base = (base_url or cfg["base"]).rstrip("/")
    m = model or cfg["model"]
    style = cfg["poll_style"]

    if style == "agnes":
        url = f"{base}{cfg['poll']}?" + urlencode({'video_id': task_id, 'model_name': m})
        d = _get(url, key)
        st = (d.get("status") or "").lower()
        url_out = d.get("video_url") or d.get("url") or d.get('remixed_from_video_id') or (d.get("data") or {}).get("url")
        if st in ("completed", "succeeded", "success"):
            return _completed(url_out)
        if st in ("failed", "error"):
            return {"status": "failed", "error": str(d)[:200]}
        return {"status": "running"}
    if style == "path_id":
        d = _get(f"{base}{cfg['poll']}/{task_id}", key)
        st = (d.get("status") or "").lower()
        content = d.get("content") or {}
        url_out = content.get("video_url") or d.get("video_url")
        if st in ("succeeded", "success", "completed"):
            return _completed(url_out)
        if st in ("failed", "cancelled"):
            return {"status": "failed", "error": str(d)[:200]}
        return {"status": "running"}
    if style == "query_reqid":
        d = _post(base + cfg['poll'], {'requestId': task_id}, key)
        st = (d.get("status") or "").lower()
        results = d.get("results") or {}
        url_out = results.get("videos", [{}])[0].get("url") if results.get("videos") else None
        if st in ("succeed", "success", "completed"):
            return _completed(url_out)
        if st in ("failed", "error"):
            return {"status": "failed", "error": str(d)[:200]}
        return {"status": "running"}
    if style == "dashscope":
        d = _get(f"{base}{cfg['poll']}/{task_id}", key)
        out = d.get("output") or {}
        st = (out.get("task_status") or "").lower()
        url_out = out.get("video_url")
        if st in ("succeeded", "success"):
            return _completed(url_out)
        if st in ("failed", "canceled"):
            return {"status": "failed", "error": str(d)[:200]}
        return {"status": "running"}
    if style == "zhipu":
        d = _get(f"{base}{cfg['poll']}/{task_id}", key)
        st = (d.get("task_status") or d.get("status") or "").lower()
        url_out = (d.get("video_result") or [{}])[0].get("url") if d.get("video_result") else None
        if st in ("success", "succeed", "completed"):
            return _completed(url_out)
        if st in ("failed", "error"):
            return {"status": "failed", "error": str(d)[:200]}
        return {"status": "running"}
    raise VideoPlatformError(f"平台 {platform} 的查询协议未实现")


def _completed(url):
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')):
        return {'status': 'failed', 'error': '平台已完成任务，但没有返回有效的视频地址'}
    return {'status': 'succeed', 'url': url}


def generate_blocking(platform, key, prompt, ref_image=None, model=None,
                      base_url=None, max_wait=1200, interval=10, duration=5):
    """提交 + 轮询到出片（同步阻塞，供后台协程调用）。"""
    r = submit(platform, key, prompt, ref_image, model, base_url, duration)
    tid = r["task_id"]
    deadline = time.time() + max_wait
    while time.time() < deadline:
        time.sleep(interval)
        p = poll(platform, key, tid, r["model"], base_url)
        if p["status"] == "succeed":
            return {"status": "success", "platform": platform, "model": r["model"],
                    "results": [{"url": p["url"], "model": r["model"],
                                 "platform": platform, "task_id": tid}]}
        if p["status"] == "failed":
            raise VideoPlatformError(p.get("error") or "生成失败")
    raise VideoPlatformError(f"超时（{max_wait}s 未出片）")
