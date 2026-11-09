"""造梦工坊 — FastAPI backend（多用户可配置引擎版）
- 全局 provider：启动时 ComfyUI(8188) 可达 → 本地；有 AGNES_KEY → 云端；否则 Mock
- 用户级 provider：登录后可在 /api/biz/v1/engine/config 自填 Agnes key / ComfyUI 地址，
  生成时按用户配置路由；未配置回退全局。
"""
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional
import uuid, json, os, time, asyncio
from collections import OrderedDict, deque
from urllib.parse import urlsplit, unquote
from contextlib import asynccontextmanager
from version import VERSION

# 数据目录：云上通过 DATA_DIR 指向持久卷（SQLite + 上传文件都放这里）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUN_MODE = os.environ.get('DREAMCRAFT_MODE', 'public').lower()
if RUN_MODE not in ('local', 'public'):
    raise RuntimeError('DREAMCRAFT_MODE must be local or public')
os.environ['DREAMCRAFT_MODE'] = RUN_MODE
if RUN_MODE == 'public':
    os.environ.update(BYOK_ONLY='1', NO_LOCAL_ENV='1', COMFYUI_DISABLE='1', DREAMCRAFT_DEMO_COMMERCE='0')
    for key in ('AGNES_API_KEY', 'AGNES_API_TOKEN', 'APIHUB_AGNES_API_KEY', 'AGNES_API_ROOT'):
        os.environ.pop(key, None)
DATA_DIR = os.environ.get("DATA_DIR") or (os.path.join(BASE_DIR, 'public-data') if RUN_MODE == 'public' else BASE_DIR)
os.makedirs(DATA_DIR, exist_ok=True)
if RUN_MODE == 'public':
    os.environ['DREAMCRAFT_DB'] = os.path.join(DATA_DIR, 'dreamcraft.db')
else:
    os.environ.setdefault("DREAMCRAFT_DB", os.path.join(DATA_DIR, "dreamcraft.db"))

# 加载 .env（不覆盖已有 env）
# 云端部署时用 NO_LOCAL_ENV=1 彻底跳过 .env，避免服务器预置的 key 被带上去
_env = os.path.join(BASE_DIR, ".env")
if os.environ.get("NO_LOCAL_ENV") != "1" and os.path.exists(_env):
    for _line in open(_env, encoding="utf-8"):
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            # 显式设为空就不写入（防 .env 覆盖云端清空意图）
            if _k.strip() in os.environ:
                continue
            os.environ.setdefault(_k.strip(), _v.strip())

from providers import (AgnesProvider, ComfyUIProvider, MockProvider,
                       AGNES_KEY, AGNES_ROOT, AGNES_IMAGE_MODEL,
                       AGNES_VIDEO_MODEL, COMFYUI_URL, validate_remote_url, open_remote)
import agnes_text
from taskstore import store
import wallet
import matters
import team
import auth
import userconfig
import video_platforms

@asynccontextmanager
async def lifespan(app):
    # Background work cannot survive a process restart; release its credits once.
    for task in store.active():
        wallet.refund_task(task['owner'], task['id'])
        store.update(task['id'], status='failed', error='服务已重启，请重新提交任务', finished_at=int(time.time()))
    yield


app = FastAPI(title="dreamcraft", version=VERSION, lifespan=lifespan)
_rate_windows = OrderedDict()
_inflight = {}


def _rate_check(key, limit, seconds):
    now = time.monotonic()
    window = _rate_windows.setdefault(key, deque())
    _rate_windows.move_to_end(key)
    while window and window[0] <= now - seconds:
        window.popleft()
    if len(window) >= limit:
        raise HTTPException(429, '操作过于频繁，请稍后重试', headers={'Retry-After': str(seconds)})
    window.append(now)
    while len(_rate_windows) > 10000:
        _rate_windows.popitem(last=False)


def _check_media_inputs(value, uid, request):
    if isinstance(value, dict):
        for item in value.values():
            _check_media_inputs(item, uid, request)
    elif isinstance(value, list):
        for item in value:
            _check_media_inputs(item, uid, request)
    elif isinstance(value, str):
        parts = urlsplit(value) if value.startswith(('http://', 'https://', '/uploads/', '/exports/')) else None
        if parts and (not parts.netloc or parts.netloc == request.url.netloc):
            path = unquote(parts.path)
            if path.startswith(('/uploads/', '/exports/')) and not wallet.owns_asset(path, uid):
                raise HTTPException(404, '素材不存在或无权访问')


def _engine_error(error, uid):
    message = str(error)
    cfg = userconfig.get(uid)
    for field in ('agnes_key', 'video_key'):
        if cfg.get(field):
            message = message.replace(cfg[field], '[redacted]')
    if AGNES_KEY:
        message = message.replace(AGNES_KEY, '[redacted]')
    return message


def _store_image_data(url):
    if not url.startswith('data:' + 'image/'):
        return url
    import base64, io
    from PIL import Image
    try:
        image = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1], validate=True)))
        if image.width * image.height > 16_000_000:
            raise ValueError('image too large')
        image.load()
        name = uuid.uuid4().hex + '.png'
        image.save(os.path.join(EXPORT_DIR, name), 'PNG')
        return '/exports/' + name
    except Exception:
        raise HTTPException(400, '生成结果不是有效的图片，或图片超过 1600 万像素')


@app.middleware('http')
async def public_access(request: Request, call_next):
    uid, admitted = None, False
    if RUN_MODE == 'public':
        from fastapi.responses import JSONResponse
        path = request.url.path
        protected = (path.startswith('/api/biz/') and path != '/api/biz/v1/video/platforms') or path.startswith('/api/upload/') or path.startswith('/lv/v1/task/') or path.startswith('/lv/v1/commerce/') or path.startswith('/lv/v1/purchase/') or (request.method == 'POST' and path.startswith('/lv/'))
        try:
            if request.method != 'OPTIONS':
                ip = request.client.host if request.client else 'unknown'
                _rate_check(('all', ip), 1200, 60)
                if protected:
                    uid = auth.require_user(request)
                if path.startswith(('/uploads/', '/exports/')):
                    uid = auth.current_user(request)
                    if uid == 'anon':
                        uid = auth.verify_media(request.cookies.get('dc_media', '')) or auth.verify_media(request.query_params.get('access', ''))
                    if not uid or uid == 'anon' or not auth.get_user(uid):
                        raise HTTPException(401, '请先登录')
                    if not wallet.owns_asset(path, uid):
                        raise HTTPException(404, '素材不存在或无权访问')
                if request.method in ('POST', 'PUT', 'PATCH'):
                    limit = 21 * 1024 * 1024 if path.startswith('/api/upload/') else 30 * 1024 * 1024
                    if path.startswith('/api/auth/') or path == '/api/biz/v1/engine/config':
                        limit = 64 * 1024
                    chunks, length = [], 0
                    async for chunk in request.stream():
                        length += len(chunk)
                        if length > limit:
                            raise HTTPException(413, '请求内容过大')
                        chunks.append(chunk)
                    request._body = b''.join(chunks)
                    if path in ('/api/auth/register', '/api/auth/login'):
                        _rate_check(('auth', ip), 10, 60)
                        try:
                            username = str(json.loads(request._body).get('username', '')).strip().casefold()[:64]
                        except (ValueError, AttributeError):
                            username = ''
                        _rate_check(('account', username), 20, 900)
                    if uid and 'application/json' in request.headers.get('content-type', ''):
                        try:
                            _check_media_inputs(json.loads(request._body), uid, request)
                        except ValueError:
                            raise HTTPException(400, '请求格式无效')
                    if path.startswith('/api/upload/') or path == '/api/biz/v1/asset/create_v2':
                        _rate_check(('upload', uid), 20, 60)
                    expensive = path.startswith('/lv/') or path == '/api/biz/v1/agent/submit_run'
                    if expensive and path not in ('/lv/v2/task/multi_get_tasks', '/lv/v1/editor/image/ai_model/batch_get_results'):
                        _rate_check(('generate', uid), 12, 60)
                        active = store.active()
                        if _inflight.get(uid, 0) >= 3 or sum(_inflight.values()) >= 16 or sum(t['owner'] == uid for t in active) >= 6 or len(active) >= 32:
                            raise HTTPException(429, '正在处理的任务较多，请等待完成后重试', headers={'Retry-After': '10'})
                        _inflight[uid] = _inflight.get(uid, 0) + 1
                        admitted = True
        except HTTPException as e:
            return JSONResponse({'detail': e.detail}, status_code=e.status_code, headers=e.headers)
    try:
        response = await call_next(request)
        if RUN_MODE == 'public':
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Referrer-Policy'] = 'no-referrer'
            response.headers['X-Frame-Options'] = 'DENY'
            if request.url.path.startswith(('/api/', '/lv/', '/uploads/', '/exports/')):
                response.headers['Cache-Control'] = 'private, no-store'
        return response
    finally:
        if admitted:
            _inflight[uid] -= 1
            if not _inflight[uid]:
                del _inflight[uid]


app.add_middleware(
    CORSMiddleware, allow_origins=[s.strip() for s in os.environ.get('CORS_ORIGINS', '*').split(',') if s.strip()],
    allow_methods=['*'], allow_headers=['*'],
)


@app.get('/api/runtime')
async def runtime_config():
    return {'mode': RUN_MODE, 'default_engines': not _BYOK_ONLY,
            'local_comfy_proxy': RUN_MODE == 'local' and not _BYOK_ONLY}


# ---------------------------------------------------------------------------
# Provider 选择
# ---------------------------------------------------------------------------
def _comfy_reachable(url: str = None) -> bool:
    target = url or COMFYUI_URL
    if not url and os.environ.get("COMFYUI_DISABLE", "0") == "1":
        return False
    try:
        with open_remote(target.rstrip("/") + "/system_stats", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


# 全局兜底：本地有 ComfyUI 就用，否则有 key 用 Agnes，否则 Mock
# 云端部署设 BYOK_ONLY=1 —— 服务器不提供任何默认引擎，用户必须自己配
_BYOK_ONLY = os.environ.get("BYOK_ONLY", "0") == "1"
if _BYOK_ONLY:
    _GLOBAL = MockProvider()
    print("[provider] BYOK_ONLY=1 —— 服务器不提供默认引擎，用户需在「引擎设置」接入自己的")
else:
    _GLOBAL = (ComfyUIProvider() if _comfy_reachable()
               else AgnesProvider() if AGNES_KEY else MockProvider())
    print("[provider] global:", type(_GLOBAL).__name__,
          "@", getattr(_GLOBAL, "base", AGNES_ROOT))


def _provider_for(uid: str):
    """按用户配置路由引擎：自配 ComfyUI > 自填 Agnes key > 全局。"""
    cfg = userconfig.get(uid or 'anon') if RUN_MODE == 'local' or (uid and uid != 'anon') else {}
    if cfg.get("comfyui_url") and _comfy_reachable(cfg["comfyui_url"]):
        p = ComfyUIProvider(base=cfg["comfyui_url"].rstrip("/"))
        if cfg.get("default_engine"):
            p._force_engine = cfg["default_engine"]
        return p
    if cfg.get("agnes_key"):
        p = AgnesProvider()
        p.api_key = cfg["agnes_key"]
        p.api_root = (cfg.get("agnes_root") or AGNES_ROOT).rstrip("/")
        return p
    # 没配 ComfyUI 地址、也没自填 Agnes key → 全局引擎，但可继承用户的默认档位
    p = _GLOBAL
    if isinstance(p, MockProvider) and not _BYOK_ONLY and _comfy_reachable():
        p = ComfyUIProvider()
    if cfg.get("default_engine") and isinstance(p, ComfyUIProvider):
        p2 = ComfyUIProvider(base=COMFYUI_URL)
        p2._force_engine = cfg["default_engine"]
        return p2
    return p


_AGNES_GLOBAL = AgnesProvider() if AGNES_KEY else None


def _video_platform_for(uid: str):
    """返回 (platform, key, base_url, model, source)。
    source: 'user' = 用户自己配的；'server' = 回退到服务器默认（BYOK_ONLY 时禁用）。"""
    cfg = userconfig.get(uid or 'anon') if RUN_MODE == 'local' or (uid and uid != 'anon') else {}
    if cfg.get("video_platform") and cfg.get("video_key"):
        return (cfg["video_platform"], cfg["video_key"],
                cfg.get("video_base"), cfg.get("video_model"), "user")
    if cfg.get("agnes_key"):
        return ("agnes", cfg["agnes_key"], cfg.get("agnes_root"), None, "user")
    # BYOK_ONLY：不借用服务器 key
    if AGNES_KEY and not _BYOK_ONLY:
        return ("agnes", AGNES_KEY, AGNES_ROOT, None, "server")
    return (None, None, None, None, "none")


def _provider_for_video(uid: str):
    """视频走云端：用户自填 key 优先；BYOK_ONLY 时不借用服务器 key。"""
    cfg = userconfig.get(uid or 'anon') if RUN_MODE == 'local' or (uid and uid != 'anon') else {}
    if cfg.get("agnes_key"):
        p = AgnesProvider()
        p.api_key = cfg["agnes_key"]
        p.api_root = (cfg.get("agnes_root") or AGNES_ROOT).rstrip("/")
        return p
    if _AGNES_GLOBAL and not _BYOK_ONLY:
        return _AGNES_GLOBAL
    return _GLOBAL


# ---------------------------------------------------------------------------
# 登录 / 鉴权
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=256)


def _media_cookie(response, request, token):
    response.set_cookie('dc_media', auth.media_token(auth.verify(token)), max_age=3600, httponly=True,
                        secure=request.url.scheme == 'https', samesite='strict', path='/')


@app.post("/api/auth/register")
async def register(body: RegisterIn, request: Request, response: Response):
    try:
        r = auth.register(body.username, body.password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _media_cookie(response, request, r['token'])
    return {**r, "media_token": auth.media_token(r['user_id']), "balance": wallet.get_balance(r["user_id"])}


@app.post("/api/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    try:
        r = auth.login(body.username, body.password)
    except ValueError as e:
        raise HTTPException(401, str(e))
    _media_cookie(response, request, r['token'])
    return {**r, "media_token": auth.media_token(r['user_id']), "balance": wallet.get_balance(r["user_id"])}


@app.post('/api/auth/logout')
async def logout(response: Response):
    response.delete_cookie('dc_media', path='/')
    return {'logged_out': True}


@app.get("/api/auth/me")
async def me(request: Request, response: Response):
    uid = auth.current_user(request)
    if uid == "anon":
        return {"user_id": None, "username": None, "anon": True}
    u = auth.get_user(uid)
    _media_cookie(response, request, request.headers['Authorization'][7:])
    return {"user_id": uid, "username": u["username"], "anon": False, "media_token": auth.media_token(uid),
            "balance": wallet.get_balance(uid)}


def _uid(request: Request) -> str:
    return auth.current_user(request)


@app.api_route('/api/comfy/{path:path}', methods=['GET', 'POST'])
async def local_comfy_proxy(path: str, request: Request):
    """Forward only generation endpoints to the configured instance, never arbitrary URLs."""
    import re
    import urllib.request
    import urllib.error
    from fastapi.responses import Response
    if RUN_MODE != 'local' or _BYOK_ONLY:
        raise HTTPException(403, '公开模式不提供站长的本机 ComfyUI 转发')
    _uid(request)
    if request.headers.get('X-Comfy-Base', '').rstrip('/') != COMFYUI_URL.rstrip('/'):
        raise HTTPException(400, '该地址不是后端已连接的 ComfyUI 实例')
    allowed = (request.method == 'GET' and (path in ('system_stats', 'object_info', 'view') or re.fullmatch(r'history/[a-f0-9-]+', path))) or (request.method == 'POST' and path in ('prompt', 'upload/image'))
    if not allowed:
        raise HTTPException(404, 'Unsupported ComfyUI endpoint')
    data = await request.body()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, '请求过大')
    target = COMFYUI_URL.rstrip('/') + '/' + path
    if request.url.query:
        target += '?' + request.url.query
    def forward():
        req = urllib.request.Request(target, data=data if request.method == 'POST' else None,
            method=request.method, headers={'Content-Type': request.headers.get('Content-Type', 'application/json')})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return Response(r.read(), status_code=r.status, media_type=r.headers.get_content_type())
        except urllib.error.HTTPError as e:
            return Response(e.read(), status_code=e.code, media_type='application/json')
        except Exception as e:
            raise HTTPException(502, f'ComfyUI 连接失败：{str(e)[:120]}')
    return await asyncio.to_thread(forward)


# ---------------------------------------------------------------------------
# 用户级引擎配置（"接入自己的 API / 选 ComfyUI"）
# ---------------------------------------------------------------------------
class EngineCfgIn(BaseModel):
    agnes_key: Optional[str] = None
    agnes_root: Optional[str] = None
    comfyui_url: Optional[str] = None
    default_engine: Optional[str] = None
    # 视频平台（用户自选平台 + 自填 key）
    video_platform: Optional[str] = None
    video_key: Optional[str] = None
    video_base: Optional[str] = None
    video_model: Optional[str] = None


@app.get("/api/biz/v1/engine/config")
async def engine_get(request: Request):
    uid = _uid(request)
    cfg = userconfig.get(uid)
    platform, _, _, _, _ = _video_platform_for(uid)
    return {
        "owner": cfg["owner"],
        "mode": RUN_MODE,
        "has_agnes": bool(cfg.get("agnes_key")),
        "agnes_root": cfg.get("agnes_root"),
        "comfyui_url": cfg.get("comfyui_url"),
        "default_engine": cfg.get("default_engine"),
        "effective": type(_provider_for(uid)).__name__,
        # 视频
        "video_platform": cfg.get("video_platform"),
        "has_video_key": bool(cfg.get("video_key")),
        "video_base": cfg.get("video_base"),
        "video_model": cfg.get("video_model"),
        "video_effective": platform,
    }


@app.post("/api/biz/v1/engine/config")
async def engine_set(body: EngineCfgIn, request: Request):
    uid = _uid(request)
    if uid == "anon":
        raise HTTPException(401, "请先登录再配置引擎")
    for value in (body.agnes_root, body.comfyui_url, body.video_base):
        if value:
            try:
                validate_remote_url(value)
            except ValueError as e:
                raise HTTPException(400, str(e))
    if body.video_platform and body.video_platform not in video_platforms.PLATFORMS:
        raise HTTPException(400, "不支持的视频平台")
    old = userconfig.get(uid)
    if body.video_platform is not None and body.video_platform != old.get('video_platform') and body.video_key is None:
        body.video_key = ''
    # 空串 = 清除该字段；None（没传）= 保留旧值；有值 = 覆盖
    r = userconfig.save(
        uid, agnes_key=body.agnes_key, agnes_root=body.agnes_root,
        comfyui_url=body.comfyui_url, default_engine=body.default_engine,
        video_platform=body.video_platform, video_key=body.video_key,
        video_base=body.video_base, video_model=body.video_model)
    platform, _, _, _, _ = _video_platform_for(uid)
    return {"saved": True, "effective": type(_provider_for(uid)).__name__,
            "default_engine": r.get("default_engine") or None,
            "has_agnes": bool(r.get("agnes_key")),
            "video_platform": r.get("video_platform"),
            "has_video_key": bool(r.get("video_key")),
            "video_effective": platform}


@app.get("/api/biz/v1/video/platforms")
async def list_video_platforms():
    """可选的视频平台清单（前端下拉用）。"""
    return {"platforms": video_platforms.list_platforms()}


@app.get("/api/biz/v1/engine/available")
async def engine_available(request: Request):
    """列出当前对该用户可用的出图档位（全局 ComfyUI 的档位 + 用户自配 ComfyUI 的档位）。"""
    uid = _uid(request)
    p = _provider_for(uid)
    if hasattr(p, "available_engines"):
        loop = asyncio.get_event_loop()
        try:
            return {"engine": "comfyui", "engines":
                    await loop.run_in_executor(None, p.available_engines)}
        except Exception as e:
            return {"engine": "comfyui-unreachable", "engines": [], "note": str(e)[:120]}
    if isinstance(p, MockProvider):
        return {'engine': 'none', 'engines': []}
    return {"engine": "agnes", "engines": [
        {"id": AGNES_IMAGE_MODEL, "name": "Agnes 图像 2.5", "desc": "云端", "rough_seconds": 15},
    ]}


@app.get("/api/biz/v1/engine/diagnostics")
async def engine_diagnostics(request: Request):
    import compose
    uid = _uid(request)
    platform, key, _, _, source = _video_platform_for(uid)
    return {
        "video": {"configured": bool(platform and key), "platform": platform, "source": source},
        "ffmpeg": await asyncio.to_thread(compose.ffmpeg_status),
    }


# ---------------------------------------------------------------------------
# 任务存储
# ---------------------------------------------------------------------------
def _task(task_id: str, **kw):
    store.create(task_id, kw.get("kind", "unknown"), kw.get("payload", {}),
                 kw.get("status", "queued"), owner=kw.get("owner", "anon"))
    return {"id": task_id, **kw}


def _task_update(task_id: str, **fields):
    store.update(task_id, **fields)


def _task_get(task_id: str):
    return store.get(task_id)


def _task_list(limit: int = 50):
    return store.list(limit)


# ---------------------------------------------------------------------------
# 生成核心
# ---------------------------------------------------------------------------
class ImageTaskIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=10000)
    model: str = "default"
    ref_image: Optional[str] = None
    aspect_ratio: str = Field(default="1:1", pattern=r"^(1:1|16:9|9:16|4:3|3:4|21:9|3:2)$")
    resolution: int = Field(default=1024, ge=256, le=2048)
    seed: Optional[int] = None
    n: int = Field(default=1, ge=1, le=4)


@app.post("/lv/v1/editor/image/ai_model/submit_task")
async def submit_image_task(body: ImageTaskIn, request: Request):
    uid = _uid(request)
    provider = _provider_for(uid)
    # 未配置引擎时直接给明确提示，不要让用户干等
    if isinstance(provider, MockProvider):
        raise HTTPException(
            400, "未配置出图引擎：请到「引擎设置」接入自己的 ComfyUI 地址或 API key")
    task_id = uuid.uuid4().hex
    _task(task_id, kind="image", payload=body.model_dump(), status="running", owner=uid)
    # 扣费门禁（仅当用户或服务器真的有付费额度时才收）
    needs_charge = isinstance(provider, AgnesProvider) and not userconfig.get(uid).get("agnes_key")
    if needs_charge and not wallet.charge_for("image", uid, task_id=task_id,
                                              reason=f"img:{body.model}"):
        _task_update(task_id, status="failed", error="insufficient_credits")
        raise HTTPException(402, "积分不足：免费额度已用尽，请充值或开通会员")
    try:
        result = await provider.generate_image(
            prompt=body.prompt, ref_image=body.ref_image, model=body.model,
            aspect_ratio=body.aspect_ratio, resolution=body.resolution,
            seed=body.seed, n=body.n)
        if not result.get("results") or not all(i.get("url") for i in result["results"]):
            raise RuntimeError("生成引擎没有返回图片")
        for item in result['results']:
            item['url'] = await asyncio.to_thread(_store_image_data, item['url'])
    except Exception as e:
        _task_update(task_id, status="failed", error=_engine_error(e, uid)[:300], finished_at=int(time.time()))
        if needs_charge:
            wallet.refund(uid, wallet.COST["image"], reason="refund:image", task_id=task_id)
        raise HTTPException(502, f"图片生成失败：{_engine_error(e, uid)[:200]}")
    _task_update(task_id, status="succeed", result=result, finished_at=int(time.time()))
    for item in result.get("results", []):
        wallet.add_asset(item["url"], kind="image", prompt=body.prompt,
                         task_id=task_id, owner=uid)
    return {"task_id": task_id, "result": _task_get(task_id)["result"]}


class VideoTaskIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=10000)
    model: str = "default"
    ref_image: Optional[str] = None
    duration: float = Field(default=5.0, ge=1, le=15)


@app.post("/lv/v1/editor/video/submit_task")
async def submit_video_task(body: VideoTaskIn, request: Request):
    """任务制：立即返回 task_id，后台按用户选的平台生成 + 轮询。"""
    uid = _uid(request)
    platform, vkey, vbase, vmodel, source = _video_platform_for(uid)
    if not platform or not vkey:
        raise HTTPException(400, "未配置视频平台：请在「引擎设置」里选择平台并填写 API key")

    task_id = uuid.uuid4().hex
    _task(task_id, kind="video",
          payload={**body.model_dump(), "platform": platform, "source": source},
          status="queued", owner=uid)
    needs_charge = source == "server"
    if needs_charge and not wallet.charge_for("video", uid, task_id=task_id,
                                              reason=f"vid:{platform}:{body.model}"):
        _task_update(task_id, status="failed", error="insufficient_credits",
                     finished_at=int(time.time()))
        raise HTTPException(402, "积分不足：请充值或开通会员")

    async def _run():
        loop = asyncio.get_event_loop()
        try:
            _task_update(task_id, status="running")
            result = await loop.run_in_executor(
                None, lambda: video_platforms.generate_blocking(
                    platform, vkey, body.prompt, body.ref_image,
                    vmodel or (body.model if body.model not in ("default", "jimeng-video") else None), vbase,
                    max_wait=1200, interval=10, duration=body.duration))
            _task_update(task_id, status="succeed", result=result,
                         finished_at=int(time.time()))
            for item in result.get("results", []):
                if item.get("url"):
                    wallet.add_asset(item["url"], kind="video", prompt=body.prompt,
                                     task_id=task_id, owner=uid)
        except Exception as e:
            _task_update(task_id, status="failed", error=_engine_error(e, uid)[:300],
                         finished_at=int(time.time()))
            if needs_charge:
                wallet.refund(uid, wallet.COST["video"],
                              reason=f"refund:video:{task_id}", task_id=task_id)

    asyncio.create_task(_run())
    return {"task_id": task_id, "status": "queued",
            "platform": platform, "source": source}


@app.get("/lv/v1/task/status/{task_id}")
async def get_task_status(task_id: str, request: Request):
    t = store.get(task_id, owner=_uid(request))
    if not t:
        return {"task_id": task_id, "status": "not_found"}
    return {"task_id": task_id, "kind": t.get("kind"),
            "status": t.get("status"), "result": t.get("result"),
            "error": t.get("error"), "created_at": t.get("created_at")}


@app.post("/lv/v1/editor/image/ai_model/batch_get_results")
@app.post("/lv/v2/task/multi_get_tasks")
async def multi_get_tasks(body: dict, request: Request):
    uid = _uid(request)
    ids = body.get("task_ids") or body.get("ids") or []
    if not ids:
        return {"tasks": store.list(50, owner=uid)}
    return {"tasks": [t for i in ids if (t := store.get(i, owner=uid))]}


@app.get("/lv/v1/editor/image/ai_model/materials")
async def image_materials(model: str = "jimeng-3"):
    return {"model": {"id": model}}


@app.get("/lv/v1/generate/model_config")
async def model_config(request: Request):
    """按当前用户生效的 provider 返回模型档位。"""
    uid = _uid(request)
    provider = _provider_for(uid)
    if isinstance(provider, ComfyUIProvider):
        loop = asyncio.get_event_loop()
        engines = await loop.run_in_executor(None, provider.available_engines)
        return {
            "engine": (engines[0]["id"] if engines else "none"),
            "image_models": [
                {"id": e["id"], "name": e["name"], "desc": e.get("desc", ""),
                 "max_resolution": 2048,
                 "aspect_ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]}
                for e in engines
            ] or [{"id": "none", "name": "无可用模型", "max_resolution": 1024,
                   "aspect_ratios": ["1:1"]}],
            "video_models": [
                {"id": AGNES_VIDEO_MODEL, "name": "Agnes 视频 2.5（云端）",
                 "durations": [5, 10]},
            ],
        }
    if isinstance(provider, AgnesProvider):
        root = getattr(provider, "api_root", AGNES_ROOT)
        return {"engine": "agnes", "image_models": [
            {"id": AGNES_IMAGE_MODEL, "name": "Agnes 图像 2.5", "max_resolution": 2048,
             "aspect_ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]},
        ], "video_models": [
            {"id": AGNES_VIDEO_MODEL, "name": "Agnes 视频 2.5", "durations": [5, 10]},
        ]}
    return {"engine": "none",
            "hint": "未配置出图引擎：请到「引擎设置」接入自己的 ComfyUI 或 API key",
            "image_models": [
                {"id": "none", "name": "未配置引擎 — 去「引擎设置」接入",
                 "desc": "支持自己的 ComfyUI 地址 / Agnes key / 其他平台 API",
                 "max_resolution": 1024,
                 "aspect_ratios": ["1:1", "16:9", "9:16"]}],
            "video_models": []}


# ---------------------------------------------------------------------------
# 图像编辑工具
# ---------------------------------------------------------------------------
class EditIn(BaseModel):
    image_url: str = Field(min_length=1)
    mask_url: Optional[str] = None
    prompt: Optional[str] = None
    params: dict = Field(default_factory=dict)
    engine: Optional[EngineCfgIn] = None


def _edit_provider(body, request):
    cfg = body.engine
    if cfg and cfg.comfyui_url:
        try:
            validate_remote_url(cfg.comfyui_url)
        except ValueError as e:
            raise HTTPException(400, str(e))
        p = ComfyUIProvider(base=cfg.comfyui_url.rstrip('/'))
        p._force_engine = cfg.default_engine or None
        return p
    if cfg and cfg.agnes_key:
        try:
            validate_remote_url(cfg.agnes_root or AGNES_ROOT)
        except ValueError as e:
            raise HTTPException(400, str(e))
        p = AgnesProvider()
        p.api_key = cfg.agnes_key
        p.api_root = (cfg.agnes_root or AGNES_ROOT).rstrip('/')
        return p
    return _provider_for(_uid(request))


async def _matting(request: Request, image_url: str, tag: str, provider=None) -> dict:
    provider = provider or _provider_for(_uid(request))
    if hasattr(provider, "matting"):
        try:
            r = await provider.matting(image_url)
            if r.get("engine", "none") != "none":
                from PIL import Image
                import io
                from providers import read_image_bytes
                source = Image.open(io.BytesIO(read_image_bytes(image_url))).convert("RGBA")
                mask = Image.open(io.BytesIO(read_image_bytes(r["mask_url"]))).convert("L").resize(source.size)
                source.putalpha(mask)
                filename = "matte_" + uuid.uuid4().hex + ".png"
                source.save(os.path.join(EXPORT_DIR, filename))
                result_url = "/exports/" + filename
                wallet.add_asset(result_url, owner=_uid(request), kind="image")
                return {"status": "success", "mask_url": r["mask_url"],
                        "result_url": result_url, "engine": r["engine"]}
        except Exception as e:
            raise HTTPException(502, f"抠图失败：{_engine_error(e, _uid(request))[:180]}")
    raise HTTPException(400, "当前引擎不支持抠图，请连接安装了背景移除模型的 ComfyUI")


@app.post("/lv/v1/editor/image/saliency_seg")
async def saliency_seg(body: EditIn, request: Request):
    return await _matting(request, body.image_url, "saliency", _edit_provider(body, request))


@app.post("/lv/v1/editor/image/interactive_matting")
async def interactive_matting(body: EditIn, request: Request):
    return await _matting(request, body.image_url, "matting", _edit_provider(body, request))


@app.post("/lv/v1/editor/image/gen_background")
async def gen_background(body: EditIn, request: Request):
    matte = await _matting(request, body.image_url, "background", _edit_provider(body, request))
    bg = await _edit_generate(body, request, prompt=body.prompt or "clean studio background", reference=False)
    from PIL import Image
    import io
    from providers import read_image_bytes
    subject = Image.open(io.BytesIO(read_image_bytes(matte["result_url"]))).convert("RGBA")
    background = Image.open(io.BytesIO(read_image_bytes(bg["result_url"]))).convert("RGBA").resize(subject.size)
    background.alpha_composite(subject)
    filename = "background_" + uuid.uuid4().hex + ".png"
    background.save(os.path.join(EXPORT_DIR, filename))
    url = "/exports/" + filename
    wallet.add_asset(url, owner=_uid(request), kind="image")
    return {"status": "success", "result_url": url}


async def _edit_generate(body, request, prompt=None, reference=True, **kwargs):
    uid = _uid(request)
    provider = _edit_provider(body, request)
    if isinstance(provider, MockProvider):
        raise HTTPException(400, "未配置图像编辑引擎")
    needs_charge = isinstance(provider, AgnesProvider) and not (body.engine and body.engine.agnes_key) and not userconfig.get(uid).get('agnes_key')
    task_id = uuid.uuid4().hex
    if needs_charge and not wallet.charge_for('image', uid, task_id=task_id, reason='image-edit'):
        raise HTTPException(402, '积分不足')
    try:
        if isinstance(provider, ComfyUIProvider) and body.mask_url:
            kwargs['mask_image'] = body.mask_url
        result = await provider.generate_image(prompt=prompt or body.prompt or "refine details",
            ref_image=body.image_url if reference else None, model=body.params.get("model", "default"), **kwargs)
        url = await asyncio.to_thread(_store_image_data, result["results"][0]["url"])
        wallet.add_asset(url, owner=uid, kind="image", prompt=body.prompt or "")
        return {"status": "success", "result_url": url}
    except Exception as e:
        if needs_charge:
            wallet.refund_task(uid, task_id)
        detail = str(e)
        if body.engine and body.engine.agnes_key:
            detail = detail.replace(body.engine.agnes_key, '[redacted]')
        raise HTTPException(502, f"图像处理失败：{_engine_error(detail, uid)[:180]}")


@app.post("/lv/v1/editor/image/inpaint")
async def inpaint(body: EditIn, request: Request):
    if not body.mask_url:
        raise HTTPException(400, "局部重绘需要蒙版：白色区域重绘，黑色区域保留")
    result = await _edit_generate(body, request, prompt=body.prompt or "keep everything else unchanged")
    if body.mask_url:
        from PIL import Image
        import io
        from providers import read_image_bytes
        source = Image.open(io.BytesIO(read_image_bytes(body.image_url))).convert("RGBA")
        edited = Image.open(io.BytesIO(read_image_bytes(result["result_url"]))).convert("RGBA").resize(source.size)
        mask = Image.open(io.BytesIO(read_image_bytes(body.mask_url))).convert("L").resize(source.size)
        merged = Image.composite(edited, source, mask)
        filename = "inpaint_" + uuid.uuid4().hex + ".png"
        merged.save(os.path.join(EXPORT_DIR, filename))
        result["result_url"] = "/exports/" + filename
        wallet.add_asset(result['result_url'], owner=_uid(request), kind='image', prompt=body.prompt or '')
    return result


@app.post("/lv/v1/editor/image/outpaint")
async def outpaint(body: EditIn, request: Request):
    from PIL import Image
    from providers import read_image_bytes
    import io, base64
    if not isinstance(_edit_provider(body, request), ComfyUIProvider):
        raise HTTPException(400, "保留原图的扩图需要连接 ComfyUI")
    try:
        source = Image.open(io.BytesIO(read_image_bytes(body.image_url))).convert('RGB')
        scale = min(1, 1024 / max(source.size))
        source = source.resize((max(8, round(source.width * scale)), max(8, round(source.height * scale))))
        w, h = ((int(s * 1.5) + 7) // 8 * 8 for s in source.size)
        x, y = (w - source.width) // 2, (h - source.height) // 2
        extended = Image.new('RGB', (w, h), '#808080')
        extended.paste(source, (x, y))
        mask = Image.new('L', (w, h), 255)
        mask.paste(0, (x, y, x + source.width, y + source.height))
        def data(image):
            buf = io.BytesIO(); image.save(buf, format='PNG')
            return 'data:' + 'image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        padded = body.model_copy(update={'image_url': data(extended), 'mask_url': data(mask)})
        result = await _edit_generate(padded, request, prompt=body.prompt or 'extend the scene naturally beyond the frame')
        output = Image.open(io.BytesIO(read_image_bytes(result['result_url']))).convert('RGB').resize((w, h))
        output.paste(source, (x, y))
        name = 'outpaint_' + uuid.uuid4().hex + '.png'
        output.save(os.path.join(EXPORT_DIR, name))
        url = '/exports/' + name
        wallet.add_asset(url, owner=_uid(request), kind='image', prompt=body.prompt or '')
        return {'status': 'success', 'result_url': url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f'扩图失败：{str(e)[:180]}')


@app.post("/lv/v1/editor/image/super_resolution")
async def super_resolution(body: EditIn, request: Request):
    from PIL import Image
    from providers import read_image_bytes
    import io
    try:
        image = Image.open(io.BytesIO(read_image_bytes(body.image_url)))
        resolution = min(4096, max(256, int(body.params.get("resolution", 2048))))
        scale = resolution / max(image.size)
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        filename = "upscale_" + uuid.uuid4().hex + ".png"
        image.save(os.path.join(EXPORT_DIR, filename))
        url = "/exports/" + filename
        wallet.add_asset(url, owner=_uid(request), kind="image")
        return {"status": "success", "result_url": url, "engine": "lanczos"}
    except Exception as e:
        raise HTTPException(400, f"无法处理图片：{str(e)[:180]}")


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------
class AgentRunIn(BaseModel):
    messages: list
    model: str = "agentic"
    resources: list = []


@app.post("/api/biz/v1/agent/submit_run")
async def agent_submit_run(body: AgentRunIn, request: Request):
    uid = _uid(request)
    provider = _provider_for(uid)
    task_id = uuid.uuid4().hex
    if not body.messages or any(not isinstance(m, dict) or m.get('role') not in ('user', 'assistant', 'system') or not isinstance(m.get('content'), str) for m in body.messages) or not body.messages[-1]['content'].strip():
        raise HTTPException(400, "请输入创作内容")
    if isinstance(provider, MockProvider):
        raise HTTPException(400, "未配置创作引擎，请先在引擎设置中配置")
    _task(task_id, kind="agent", payload=body.model_dump(), status="running", owner=uid)
    last = body.messages[-1]["content"] if body.messages else ""
    needs_charge = isinstance(provider, AgnesProvider) and not userconfig.get(uid).get('agnes_key')
    if needs_charge and not wallet.charge_for('agent', uid, task_id=task_id, reason='agent'):
        _task_update(task_id, status='failed', error='insufficient_credits', finished_at=int(time.time()))
        raise HTTPException(402, '积分不足')
    try:
        if _BYOK_ONLY or not AGNES_KEY or not needs_charge:
            raise RuntimeError('local image assistant')
        reply = await agnes_text.chat(
            [{"role": "system",
              "content": "你是造梦工坊AI创作助手。理解用户的创作需求，用一句中文回复，"
                          "并说明你将为 TA 生成什么画面。"},
             *body.messages])
    except Exception:
        reply = f"已根据「{last}」生成画面。"
    try:
        img = await provider.generate_image(prompt=last, model="default")
        if not img.get("results") or not all(item.get('url') for item in img['results']):
            raise RuntimeError("引擎没有返回图片")
        for item in img['results']:
            item['url'] = await asyncio.to_thread(_store_image_data, item['url'])
    except Exception as e:
        _task_update(task_id, status="failed", error=_engine_error(e, uid)[:300], finished_at=int(time.time()))
        if needs_charge:
            wallet.refund(uid, wallet.COST["agent"], reason="refund:agent", task_id=task_id)
        raise HTTPException(502, f"创作失败：{_engine_error(e, uid)[:180]}")
    _task_update(task_id, status="succeed",
                 result={"reply": reply, "image": img},
                 finished_at=int(time.time()))
    for item in img.get("results", []):
        wallet.add_asset(item["url"], kind="image", prompt=last,
                         task_id=task_id, owner=uid)
    return {"run_id": task_id, "result": _task_get(task_id)["result"]}


# ---------------------------------------------------------------------------
# 上传 / 资产
# ---------------------------------------------------------------------------
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.post("/api/biz/v1/common/get_upload_sign")
@app.get("/api/biz/v1/common/get_upload_sign")
async def get_upload_sign():
    key = uuid.uuid4().hex
    return {"upload_key": key, "url": f"/api/upload/{key}"}


@app.post("/api/biz/v1/asset/create_v2")
async def asset_create_v2(body: dict, request: Request):
    uid = _uid(request)
    if not body.get("url"):
        raise HTTPException(400, "素材 URL 不能为空")
    url = body['url']
    is_image_data = isinstance(url, str) and url.startswith('data:' + 'image/')
    if not isinstance(url, str) or not (is_image_data or url.startswith(('https://', 'http://', '/uploads/', '/exports/'))):
        raise HTTPException(400, '不支持的素材地址')
    if url.startswith(('https://', 'http://')):
        try:
            validate_remote_url(url)
        except ValueError as e:
            raise HTTPException(400, str(e))
    url = await asyncio.to_thread(_store_image_data, url)
    body['url'] = url
    aid = wallet.add_asset(body.get("url", ""), kind=body.get("kind", "image"),
                           prompt=body.get("prompt", ""),
                           task_id=body.get("task_id", ""), owner=uid)
    if body.get('record_task') and body.get('kind', 'image') == 'image':
        task_id = uuid.uuid4().hex
        _task(task_id, kind='image', payload={'prompt': body.get('prompt', ''), 'source': 'browser'}, owner=uid)
        _task_update(task_id, status='succeed', result={'results': [{'url': url}], 'source': 'browser'}, finished_at=int(time.time()))
    return {"asset_id": aid, **body}


@app.get("/api/biz/v1/asset/list")
async def asset_list(limit: int = Query(default=60, ge=1, le=500), kind: str = None, request: Request = None):
    uid = _uid(request) if request else "anon"
    items = wallet.list_assets(limit, owner=uid, kind=kind)
    return {"assets": items}


@app.post("/api/upload/{key}")
async def do_upload(key: str, file: UploadFile = File(...), request: Request = None):
    uid = _uid(request) if request else "anon"
    import re
    if not re.fullmatch(r"[a-f0-9]{32}", key):
        raise HTTPException(400, "上传标识无效")
    data = await file.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "图片不能超过 20MB")
    from PIL import Image
    import io
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > 16_000_000:
            raise ValueError('image too large')
        image.verify()
        extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}[image.format]
    except Exception:
        raise HTTPException(400, "请上传有效的 PNG、JPEG、WebP 或 GIF 图片")
    filename = uuid.uuid4().hex + extension
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "xb") as f:
        f.write(data)
    url = f"/uploads/{filename}"
    wallet.add_asset(url, kind="upload", owner=uid)
    return {"url": url}


app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

EXPORT_DIR = os.path.join(DATA_DIR, "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)
app.mount("/exports", StaticFiles(directory=EXPORT_DIR), name="exports")


# ---------------------------------------------------------------------------
# 商业化
# ---------------------------------------------------------------------------
@app.get("/lv/v1/commerce/get_entrances")
async def commerce_entrances(request: Request):
    uid = _uid(request)
    bal = wallet.get_balance(uid)
    sub = wallet.get_subscription(uid)
    return {"items": [
        {"key": "subscription", "name": "会员", "href": "/pricing", "plan": sub["plan"]},
        {"key": "credits", "name": "积分", "href": "/credits", "balance": bal},
        {"key": "api", "name": "开放API", "href": "/jimeng-api"},
    ], "wallet": {"balance": bal, "cost": wallet.COST}}


@app.get("/lv/v1/purchase/purchase_record")
async def purchase_record(request: Request):
    uid = _uid(request)
    return {"records": wallet.ledger(owner=uid, limit=30)}


@app.post("/lv/v1/commerce/recharge")
async def recharge(body: dict, request: Request):
    uid = auth.require_user(request)
    if os.environ.get('DREAMCRAFT_DEMO_COMMERCE') != '1':
        raise HTTPException(503, '支付尚未接入，暂不支持在线充值')
    amount = body.get('amount')
    if type(amount) is not int or not 1 <= amount <= 10000:
        raise HTTPException(400, '积分数量必须为 1 至 10000 的整数')
    wallet.refund(uid, amount, reason=f"demo:recharge:{amount}")
    return {"balance": wallet.get_balance(uid), "delta": amount}


@app.post("/lv/v1/commerce/subscribe")
async def subscribe(body: dict, request: Request):
    uid = auth.require_user(request)
    plan = body.get("plan", "free")
    if plan not in wallet.SUBSCRIPTIONS:
        raise HTTPException(400, '套餐无效')
    if os.environ.get('DREAMCRAFT_DEMO_COMMERCE') != '1':
        raise HTTPException(503, '支付尚未接入，暂不支持购买会员')
    wallet.subscribe(uid, plan, days=30)
    return {"plan": plan, "daily": wallet.SUBSCRIPTIONS.get(plan, {}).get("daily", 0)}


@app.get("/lv/v1/commerce/balance")
async def balance(request: Request):
    uid = _uid(request)
    return {"balance": wallet.get_balance(uid), "subscription": wallet.get_subscription(uid),
            "demo_commerce": os.environ.get('DREAMCRAFT_DEMO_COMMERCE') == '1',
            "ledger": wallet.ledger(owner=uid, limit=10)}


# ---------------------------------------------------------------------------
# 短剧
# ---------------------------------------------------------------------------
class DramaIn(BaseModel):
    theme: str = Field(min_length=1, max_length=10000)
    style: str = "cinematic"
    shots: int = Field(default=6, ge=1, le=6)
    model: str = "jimeng-3"


@app.post("/lv/v1/short_drama/create_script")
async def drama_create_script(body: DramaIn):
    beats = [
        f"开场：{body.theme}，远景建立场景",
        f"主体出现：角色带着与「{body.theme}」相关的动作",
        f"冲突：{body.theme} 下的转折，镜头切近景",
        f"高潮：动作/情绪顶点，特写 + 运镜",
        f"收尾：{body.theme} 余韵，留白",
        f"彩蛋/黑场：黑屏出片名",
    ][: body.shots]
    script = "；".join(beats)
    return {
        "script_id": uuid.uuid4().hex,
        "theme": body.theme,
        "style": body.style,
        "shots": [
            {"shot_id": i, "prompt": f"{b}，{body.style} 风格",
             "camera": "wide" if i in (0, 5) else "close"}
            for i, b in enumerate(beats)
        ],
        "script": script,
    }


@app.post("/lv/v1/short_drama/shot_to_video")
async def drama_shot_to_video(body: dict, background=False, request: Request = None):
    shot = body.get("shot", {})
    if not isinstance(shot, dict):
        raise HTTPException(400, '分镜格式无效')
    uid = _uid(request) if request else "anon"
    platform, vkey, vbase, vmodel, _ = _video_platform_for(uid)
    if not platform or not vkey:
        raise HTTPException(400, "未配置视频平台：请在「引擎设置」里选择平台并填 key")
    prompt = shot.get("prompt", body.get("prompt", ""))
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 10000:
        raise HTTPException(400, '分镜提示词不能为空')
    duration = body.get('duration', 5)
    if isinstance(duration, bool) or not isinstance(duration, (float, int)) or not 1 <= duration <= 15:
        raise HTTPException(400, '视频时长必须在 1 至 15 秒之间')
    loop = asyncio.get_event_loop()

    if background:
        task_id = uuid.uuid4().hex
        _task(task_id, kind="drama-shot",
              payload={"shot_id": shot.get("shot_id"), "prompt": prompt,
                       "platform": platform}, status="queued", owner=uid)
        needs_charge = _video_platform_for(uid)[4] == 'server'
        if needs_charge and not wallet.charge_for('video', uid, task_id=task_id, reason='drama-shot'):
            _task_update(task_id, status='failed', error='积分不足', finished_at=int(time.time()))
            raise HTTPException(402, '积分不足')

        async def _run():
            try:
                _task_update(task_id, status="running")
                r = await loop.run_in_executor(
                    None, lambda: video_platforms.generate_blocking(
                        platform, vkey, prompt, None, vmodel, vbase,
                        max_wait=1200, interval=10, duration=duration))
                _task_update(task_id, status="succeed", result=r,
                             finished_at=int(time.time()))
                for item in r.get("results", []):
                    if item.get("url"):
                        wallet.add_asset(item["url"], kind="video", prompt=prompt, task_id=task_id, owner=uid)
            except Exception as e:
                _task_update(task_id, status="failed", error=_engine_error(e, uid)[:300],
                             finished_at=int(time.time()))
                if needs_charge:
                    wallet.refund_task(uid, task_id)

        asyncio.create_task(_run())
        return task_id

    r = await loop.run_in_executor(
        None, lambda: video_platforms.generate_blocking(
            platform, vkey, prompt, None, vmodel, vbase,
            max_wait=1200, interval=10, duration=duration))
    return {"shot_id": shot.get("shot_id"), "result": r}


@app.post("/lv/v1/short_drama/render_all")
async def drama_render_all(body: dict, request: Request):
    shots = body.get("shots", [])
    if not isinstance(shots, list) or not 1 <= len(shots) <= 20 or any(not isinstance(s, dict) or not isinstance(s.get('prompt'), str) or not s['prompt'].strip() or len(s['prompt']) > 10000 for s in shots):
        raise HTTPException(400, "请先生成有效的分镜脚本（1 至 20 个镜头）")
    duration = body.get('duration', 5)
    if isinstance(duration, bool) or not isinstance(duration, (float, int)) or not 1 <= duration <= 15:
        raise HTTPException(400, '视频时长必须在 1 至 15 秒之间')
    uid = _uid(request)
    source = _video_platform_for(uid)[4]
    if source == 'server' and wallet.get_balance(uid) < wallet.COST['video'] * len(shots):
        raise HTTPException(402, '积分不足以提交全部分镜')
    if RUN_MODE == 'public':
        active = store.active()
        if sum(t['owner'] == _uid(request) for t in active) + len(shots) > 6 or len(active) + len(shots) > 32:
            raise HTTPException(429, '分镜任务超过并发上限，请分批生成', headers={'Retry-After': '10'})
    task_ids = []
    for s in shots:
        tid = await drama_shot_to_video(
            {"shot": s, "model": body.get("model", "jimeng-video"),
             "duration": body.get("duration", 5)}, background=True, request=request)
        task_ids.append(tid)
    return {"task_ids": task_ids}


@app.post("/lv/v1/short_drama/compose")
async def drama_compose(body: dict, request: Request):
    import compose
    uid = _uid(request)
    urls = list(body.get("urls", []))
    tids = body.get("task_ids", [])
    if not urls and tids:
        selected_subtitles = []
        for index, tid in enumerate(tids):
            t = store.get(tid, owner=uid)
            if not t:
                raise HTTPException(404, "镜头任务不存在")
            if t and t.get("status") == "succeed" and (t.get("result") or {}).get("results"):
                urls.append(t["result"]["results"][0]["url"])
                subtitles = body.get("subtitles") or []
                selected_subtitles.append(subtitles[index] if index < len(subtitles) else {"text": ""})
        body["subtitles"] = selected_subtitles
    if not urls:
        raise HTTPException(400, "没有可用的镜头视频：传 urls 或已完成短剧任务的 task_ids")
    check = await asyncio.to_thread(compose.ffmpeg_status)
    if not check["ready"]:
        raise HTTPException(503, check["message"])
    loop = asyncio.get_event_loop()
    try:
        out = await loop.run_in_executor(
            None, lambda: compose.compose(
                urls,
                subtitles=body.get("subtitles"),
                bgm=body.get("bgm"),
                shot_duration=float(body.get("shot_duration", 5.0))))
    except Exception as e:
        raise HTTPException(500, f"合成失败: {e}")
    wallet.add_asset(out["url"], kind="video", prompt=body.get("prompt", "短剧合成"),
                     task_id="compose", owner=uid)
    return out


# ---------------------------------------------------------------------------
# 团队
# ---------------------------------------------------------------------------
@app.post("/api/biz/v1/team/create")
async def team_create(body: dict, request: Request):
    uid = auth.require_user(request)
    try:
        tid = team.create_team(body.get("name", "我的团队"), uid,
                               body.get("plan", "free"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"team_id": tid, **team.get_team(tid)}


@app.get("/api/biz/v1/team/list")
async def team_list(request: Request):
    uid = auth.require_user(request)
    return {"teams": team.list_teams(uid)}


@app.get("/api/biz/v1/team/{tid}")
async def team_get(tid: str, request: Request):
    uid = auth.require_user(request)
    t = team.get_team(tid)
    if not t or t["owner"] != uid:
        raise HTTPException(404, "team not found")
    t["seat_limit"] = team.SEAT_LIMITS.get(t["plan"], 1)
    return t


@app.post("/api/biz/v1/team/{tid}/plan")
async def team_set_plan(tid: str, body: dict, request: Request):
    await team_get(tid, request)
    plan = body.get("plan", "free")
    try:
        team.set_plan(tid, plan)
    except ValueError as e:
        raise HTTPException(400, str(e))
    t = team.get_team(tid)
    return {"team_id": tid, "plan": plan,
            "seat_limit": team.SEAT_LIMITS.get(plan, 1),
            "members": len(t["members"])}


@app.post("/api/biz/v1/team/{tid}/members")
async def team_add_member(tid: str, body: dict, request: Request):
    await team_get(tid, request)
    try:
        mid = team.add_member(tid, body.get("name", "新成员"),
                              body.get("email", ""), body.get("role", "viewer"))
        return {"member_id": mid}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/biz/v1/team/{tid}/members/{mid}/role")
async def team_set_role(tid: str, mid: str, body: dict, request: Request):
    await team_get(tid, request)
    try:
        team.set_role(tid, mid, body.get("role", "viewer"))
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/biz/v1/team/{tid}/members/{mid}")
async def team_remove_member(tid: str, mid: str, request: Request):
    await team_get(tid, request)
    try:
        team.remove_member(tid, mid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---------------------------------------------------------------------------
# 模板（前端 Explore 用，返回固定样例）
# ---------------------------------------------------------------------------
@app.get("/lv/v1/cc_web/plane/get_categories")
async def template_categories():
    return {"categories": [
        {"id": "1", "name": "人物"}, {"id": "2", "name": "风景"},
        {"id": "3", "name": "产品"}, {"id": "4", "name": "插画"},
    ]}


@app.get("/lv/v1/cc_web/plane/get_collection_templates")
async def collection_templates(category_id: str = "1"):
    return {"templates": [
        {"id": "t" + category_id + "1", "name": "示例模板 1", "kind": "image",
         "prompt": "一位站在海边夕阳下的女孩，电影感，浅景深"},
        {"id": "t" + category_id + "2", "name": "示例模板 2", "kind": "image",
         "prompt": "极简产品摄影，白色背景，柔和光影"},
    ]}


# ---------------------------------------------------------------------------
# 生产模式：托管前端静态文件（vite build 产物）
# 必须放在所有 API 路由之后 —— 否则会拦截 /api /lv
# ---------------------------------------------------------------------------
FRONTEND_DIST = os.environ.get(
    "FRONTEND_DIST",
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

if os.path.isdir(FRONTEND_DIST) and os.path.exists(os.path.join(FRONTEND_DIST, "index.html")):
    from fastapi.responses import FileResponse

    # 静态资源（/assets/*.js|css 等）
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
              name="spa-assets")

    @app.get("/favicon.ico")
    async def _favicon():
        p = os.path.join(FRONTEND_DIST, "favicon.ico")
        if os.path.exists(p):
            return FileResponse(p)
        from fastapi import Response
        return Response(status_code=204)

    # SPA 兜底：任何非 API 路径都返回 index.html（前端路由自己处理）
    @app.get("/{full_path:path}")
    async def _spa_fallback(full_path: str):
        # API / 静态目录前缀不接管
        for prefix in ("api/", "lv/", "uploads/", "exports/", "assets/", "docs", "openapi.json"):
            if full_path.startswith(prefix):
                raise HTTPException(404, "not found")
        idx = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(idx):
            return FileResponse(idx)
        raise HTTPException(404, "index.html not found")

    print(f"[spa] 前端静态托管已启用: {os.path.abspath(FRONTEND_DIST)}")
else:
    print(f"[spa] 未找到前端构建产物（{FRONTEND_DIST}），仅提供 API")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8100"))
    uvicorn.run(app, host='127.0.0.1' if RUN_MODE == 'local' else '0.0.0.0', port=port)
