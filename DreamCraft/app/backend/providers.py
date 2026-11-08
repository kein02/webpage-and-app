"""
Providers: Agnes (public API) + ComfyUI (本地 Z-Image / SDXL) + Mock fallback.

ComfyUI 侧支持两类模型，启动时自动探测：
  1. Z-Image Turbo（UNETLoader + qwen_3_4b CLIP + ae VAE）—— 首选，GPU 上 ~1 分钟/张
  2. SDXL Checkpoint（CheckpointLoaderSimple）—— 备选

模型列表不硬编码：每次请求查 /object_info 拿当前可用文件（30s 缓存）。
"""
import os, uuid, time, json, base64, urllib.request, urllib.error, asyncio, functools, threading
import ipaddress, socket
from urllib.parse import urlsplit


def validate_remote_url(url):
    if os.environ.get('DREAMCRAFT_MODE', 'public') != 'public':
        return
    parts = urlsplit(url)
    if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password:
        raise ValueError('请使用不含用户名和密码的 HTTP/HTTPS 公网地址')
    try:
        addresses = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    except OSError:
        raise ValueError('无法解析引擎地址')
    if not addresses or any(not ipaddress.ip_address(a[4][0].split('%')[0]).is_global for a in addresses):
        raise ValueError('公开模式禁止访问服务器本机或内网地址；本机 ComfyUI 请使用浏览器直连')


class _PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_remote_url(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urlsplit(req.full_url).netloc != urlsplit(newurl).netloc:
            redirected.remove_header('Authorization')
        return redirected


def open_remote(request, timeout=60):
    url = request.full_url if isinstance(request, urllib.request.Request) else request
    validate_remote_url(url)
    if os.environ.get('DREAMCRAFT_MODE', 'public') == 'public':
        return urllib.request.build_opener(urllib.request.ProxyHandler({}), _PublicRedirect()).open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)


def download_remote(url, destination):
    with open_remote(url) as response, open(destination, 'wb') as output:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > 200 * 1024 * 1024:
                raise ValueError('媒体文件不能超过 200MB')
            output.write(chunk)

AGNES_ROOT = os.environ.get("AGNES_API_ROOT", "https://api.agnes-ai.cn")
AGNES_KEY = os.environ.get("AGNES_API_KEY") or os.environ.get("AGNES_API_TOKEN") or os.environ.get("APIHUB_AGNES_API_KEY")
AGNES_IMAGE_MODEL = os.environ.get("AGNES_IMAGE_MODEL", "agnes-image-2.5-flash")
AGNES_VIDEO_MODEL = os.environ.get("AGNES_VIDEO_MODEL", "agnes-video-2.5-flash")
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")

# Z-Image 模型名 —— 默认用 int8+fp8 量化组合（体积 12.2GB，快 37%，质量无差）
# 环境变量可切回全量 bf16
ZIMAGE_UNET = os.environ.get("ZIMAGE_UNET", "z_image_turbo_int8_convrot.safetensors")
ZIMAGE_CLIP = os.environ.get("ZIMAGE_CLIP", "qwen_3_4b_fp8_mixed.safetensors")
ZIMAGE_VAE = os.environ.get("ZIMAGE_VAE", "ae.safetensors")
# int8 权重已是量化格式，加载时用 default；bf16 权重才需要 fp8_e4m3fn 运行时量化
ZIMAGE_DTYPE = os.environ.get("ZIMAGE_DTYPE", "default")

# SDXL 快速草稿档：base checkpoint + Lightning 4-step LoRA
SDXL_CKPT = os.environ.get("SDXL_CKPT", "sd_xl_base_1.0.safetensors")
SDXL_LORA = os.environ.get("SDXL_LORA", "sdxl_lightning_4step_lora.safetensors")
SDXL_DRAFT_STEPS = int(os.environ.get("SDXL_DRAFT_STEPS", "4"))
SDXL_DRAFT_CFG = float(os.environ.get("SDXL_DRAFT_CFG", "1.0"))
SDXL_STEPS = int(os.environ.get("SDXL_STEPS", "28"))
SDXL_CFG = float(os.environ.get("SDXL_CFG", "6.5"))

# 抠图模型目录（实例自有目录优先 —— ComfyUI 实际扫描的就是这里）
BG_REMOVAL_DIRS = [
    os.environ.get("COMFYUI_BG_DIR", ""),
    r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\models\background_removal",
    r"E:\Comfy-Desktop\ComfyUI-Shared\models\background_removal",
    os.path.join(os.path.dirname(__file__), "..", "..", "comfyui", "ComfyUI", "models", "background_removal"),
]
COMFYUI_INPUT_DIR = os.environ.get(
    "COMFYUI_INPUT_DIR",
    r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\input")


# ==================== Agnes（云端 API） ====================
class AgnesProvider:
    """
    agnes-image-2.5-flash / agnes-video-2.5-flash 云端生成。
    支持实例级 key/root 覆盖（用户自填 key 时）：
      p = AgnesProvider(); p.api_key = "sk-xxx"; p.api_root = "https://..."
    """

    def __init__(self):
        self.api_key = AGNES_KEY
        self.api_root = AGNES_ROOT

    async def generate_image(self, *, prompt, ref_image=None, model="default",
                             aspect_ratio="1:1", resolution=1024, seed=None, n=1,
                             image_model=None) -> dict:
        image_model = image_model or AGNES_IMAGE_MODEL
        w, h = _aspect_size(aspect_ratio, resolution)
        body = {"model": image_model, "prompt": prompt, "size": f"{w}x{h}",
                "extra_body": {"response_format": "url"}}
        if ref_image:
            if ref_image.startswith(("/uploads/", "/exports/")):
                ref_image = "data:image/png;base64," + base64.b64encode(read_image_bytes(ref_image)).decode()
            body["extra_body"]["image"] = [ref_image]
        if seed is not None:
            body["seed"] = seed
        data = await _post_json(f"{self.api_root}/v1/images/generations",
                                body, self.api_key)
        results = []
        for item in data.get("data", []):
            url = item.get("url") or ("data:image/png;base64," + item["b64_json"] if item.get("b64_json") else None)
            if url:
                results.append({"url": url, "seed": item.get("seed", seed), "model": image_model})
        for _ in range(n - len(results)):
            d2 = await _post_json(f"{self.api_root}/v1/images/generations",
                                  body, self.api_key)
            for item in d2.get("data", []):
                url = item.get("url") or ("data:image/png;base64," + item["b64_json"] if item.get("b64_json") else None)
                if url:
                    results.append({"url": url, "seed": item.get("seed"), "model": image_model})
        if not results:
            raise RuntimeError(f"agnes image: no url in {data}")
        return {"status": "success", "engine": "agnes", "results": results[:n]}

    async def generate_video(self, *, prompt, ref_image=None, duration=5.0,
                             model="default", video_model=None) -> dict:
        video_model = video_model or AGNES_VIDEO_MODEL
        body = {"model": video_model, "prompt": prompt,
                "mode": "image" if ref_image else "text"}
        if ref_image:
            body["image"] = ref_image
        # 视频队列容易满，重试 8 次、每次 15~60s（总计约 5 分钟）
        try:
            data = await _post_json(f"{self.api_root}/v1/videos", body, self.api_key, retries=8)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode()[:200]
            except Exception:
                pass
            if e.code == 503 or "video_queue_full" in detail:
                raise RuntimeError("Agnes 视频队列已满（服务端容量限制），请过几分钟再试")
            if e.code == 403 or "insufficient_user_quota" in detail:
                raise RuntimeError(
                    f"Agnes 账户额度不足，无法使用 {video_model}；"
                    "请充值或改用 agnes-video-2.5-flash")
            raise
        vid = data.get("video_id") or data.get("task_id")
        if not vid:
            url = data.get("video_url") or data.get("url")
            if url:
                return {"status": "success", "results": [{"url": url, "model": video_model}]}
            raise RuntimeError(f"agnes video: no id in {data}")
        for _ in range(120):
            await asyncio.sleep(10)
            d2 = await _get_json(
                f"{self.api_root}/agnesapi?video_id={vid}&model_name={video_model}",
                self.api_key)
            st = d2.get("status")
            if st in ("completed", "succeeded", "success"):
                url = d2.get("video_url") or d2.get("url") or (d2.get("data") or {}).get("url")
                return {"status": "success", "results": [{"url": url, "model": video_model, "video_id": vid}]}
            if st in ("failed", "error"):
                raise RuntimeError(f"agnes video failed: {d2}")
        raise TimeoutError("agnes video: timeout after 20 min polling")


# ==================== ComfyUI（本地 GPU） ====================
class ComfyUIProvider:
    """
    连接本机 ComfyUI（桌面版 GPU 或自装版）。
    自动选择 Z-Image（优先）或 SDXL checkpoint 工作流。
    """

    def __init__(self, base=None):
        self.base = base or COMFYUI_URL
        self._lock = threading.RLock()   # 可重入：_cached 内会嵌套调 _object_info
        self._cache = {}
        self._TTL = 30
        self._force_engine = None        # 用户指定默认档位时设置（main.py _provider_for）

    # ---------- 模型发现 ----------
    def _cached(self, key, fetcher):
        with self._lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < self._TTL:
                return hit[1]
            v = fetcher()
            self._cache[key] = (time.time(), v)
            return v

    def _object_info(self, node):
        def fetch():
            with open_remote(f"{self.base}/object_info/{node}", timeout=15) as r:
                return json.loads(r.read())
        return self._cached("oi:" + node, fetch)

    def _opts(self, node, field):
        """取某个 loader 节点的下拉选项列表。失败重试一次，避免首次探测超时返回空。"""
        def fetch():
            for attempt in range(2):
                try:
                    info = self._object_info(node)
                    v = info[node]["input"]["required"][field][0]
                    if isinstance(v, list):
                        return v
                    if v == "COMBO":
                        return info[node]["input"]["required"][field][1].get("options", [])
                    return []
                except Exception:
                    if attempt == 0:
                        # 清掉可能的坏缓存，加大超时重试
                        self._cache.pop("oi:" + node, None)
                        time.sleep(0.3)
                        continue
                    return []
            return []
        return self._cached(f"opts:{node}.{field}", fetch)

    def _has_zimage(self) -> bool:
        unets = self._opts("UNETLoader", "unet_name")
        clips = self._opts("CLIPLoader", "clip_name")
        vaes = self._opts("VAELoader", "vae_name")
        return (ZIMAGE_UNET in unets and ZIMAGE_CLIP in clips and ZIMAGE_VAE in vaes)

    def _pick_checkpoint(self):
        """Z-Image 不可用时退回 SDXL checkpoint。"""
        opts = self._opts("CheckpointLoaderSimple", "ckpt_name")
        if not opts:
            return None
        for kw in ("sdxl", "sd_xl", "flux", "sd"):
            hit = next((o for o in opts if kw in o.lower()), None)
            if hit:
                return hit
        return opts[0]

    def _bg_model(self):
        def fetch():
            files = self._opts("LoadBackgroundRemovalModel", "bg_removal_name")
            return files[0] if files else None
        return self._cached("bg", fetch)

    def _has_sdxl(self) -> bool:
        """SDXL checkpoint 是否可用。"""
        return bool(self._sdxl_checkpoint())

    def _sdxl_checkpoint(self):
        options = self._opts('CheckpointLoaderSimple', 'ckpt_name')
        return SDXL_CKPT if SDXL_CKPT in options else next((name for name in options if 'sdxl' in name.lower() or 'sd_xl' in name.lower()), None)

    def _lightning_lora(self):
        options = self._opts('LoraLoaderModelOnly', 'lora_name')
        return SDXL_LORA if SDXL_LORA in options else next((name for name in options if 'lightning' in name.lower()), None)

    def _has_lightning(self) -> bool:
        """Lightning 4-step LoRA 是否可用（快速草稿的关键）。"""
        return bool(self._lightning_lora())

    def available_engines(self) -> list:
        """返回当前可用的出图档位，前端下拉用。"""
        out = []
        if self._has_zimage():
            out.append({"id": "z-image-turbo", "name": "Z-Image Turbo（精修）",
                        "desc": "画质好，12 步，约 30s，提示词写具体更贴合", "rough_seconds": 30})
        if self._has_sdxl() and self._has_lightning():
            out.append({"id": "sdxl-draft", "name": "SDXL 草稿（极速）",
                        "desc": "Lightning 4 步，约 6s，适合试构图", "rough_seconds": 6})
        if self._has_sdxl():
            out.append({"id": "sdxl", "name": "SDXL 标准",
                        "desc": "28 步，生态最全（LoRA/ControlNet）", "rough_seconds": 30})
        return out

    def engine(self) -> str:
        """默认档位。"""
        engs = self.available_engines()
        return engs[0]["id"] if engs else "none"

    # ---------- 工作流构建 ----------
    def _workflow_sdxl(self, prompt, w, h, seed, steps, cfg, negative="blurry, low quality",
                       lora=None, scheduler="normal"):
        """SDXL 工作流；lora 传入则挂 LoraLoaderModelOnly（Lightning 4 步）。"""
        wf = {
            "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": self._sdxl_checkpoint()}},
            "4": {"class_type": "EmptyLatentImage",
                  "inputs": {"width": w, "height": h, "batch_size": 1}},
            "5": {"class_type": "KSampler",
                  "inputs": {"model": ["3", 0], "positive": ["6", 0], "negative": ["7", 0],
                             "latent_image": ["4", 0], "seed": seed, "steps": steps,
                             "cfg": cfg, "sampler_name": "euler",
                             "scheduler": scheduler, "denoise": 1.0}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["3", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["3", 1]}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["3", 2]}},
            "9": {"class_type": "SaveImage",
                  "inputs": {"filename_prefix": "dreamcraft", "images": ["8", 0]}},
        }
        if lora:
            wf["10"] = {"class_type": "LoraLoaderModelOnly",
                        "inputs": {"model": ["3", 0], "lora_name": lora,
                                   "strength_model": 1.0}}
            wf["5"]["inputs"]["model"] = ["10", 0]
        return wf

    def _workflow_zimage(self, prompt, w, h, seed, steps, cfg, negative=""):
        return {
            "1": {"class_type": "UNETLoader",
                  "inputs": {"unet_name": ZIMAGE_UNET, "weight_dtype": ZIMAGE_DTYPE}},
            "2": {"class_type": "CLIPLoader",
                  "inputs": {"clip_name": ZIMAGE_CLIP, "type": "qwen_image"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": ZIMAGE_VAE}},
            "4": {"class_type": "ModelSamplingAuraFlow",
                  "inputs": {"model": ["1", 0], "shift": 3.0}},
            "5": {"class_type": "TextEncodeZImageOmni",
                  "inputs": {"clip": ["2", 0], "prompt": prompt, "auto_resize_images": True}},
            "6": {"class_type": "TextEncodeZImageOmni",
                  "inputs": {"clip": ["2", 0], "prompt": negative, "auto_resize_images": True}},
            "7": {"class_type": "EmptySD3LatentImage",
                  "inputs": {"width": w, "height": h, "batch_size": 1}},
            "8": {"class_type": "KSampler",
                  "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
                             "latent_image": ["7", 0], "seed": seed, "steps": steps,
                             "cfg": cfg, "sampler_name": "euler",
                             "scheduler": "simple", "denoise": 1.0}},
            "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
            "10": {"class_type": "SaveImage",
                   "inputs": {"filename_prefix": "dreamcraft", "images": ["9", 0]}},
        }

    def _workflow_zimage_i2i(self, prompt, ref_name, w, h, seed, steps, cfg, denoise, negative=""):
        wf = self._workflow_zimage(prompt, w, h, seed, steps, cfg, negative)
        wf["0"] = {"class_type": "LoadImage", "inputs": {"image": ref_name}}
        wf["7"] = {"class_type": "VAEEncode",
                   "inputs": {"pixels": ["0", 0], "vae": ["3", 0]}}
        wf["8"]["inputs"]["denoise"] = denoise
        return wf

    def _workflow_checkpoint(self, prompt, ckpt, w, h, seed, steps, cfg, negative="blurry, low quality"):
        return {
            "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
            "4": {"class_type": "EmptyLatentImage",
                  "inputs": {"width": w, "height": h, "batch_size": 1}},
            "5": {"class_type": "KSampler",
                  "inputs": {"model": ["3", 0], "positive": ["6", 0], "negative": ["7", 0],
                             "latent_image": ["4", 0], "seed": seed, "steps": steps,
                             "cfg": cfg, "sampler_name": "euler",
                             "scheduler": "normal", "denoise": 1.0}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["3", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["3", 1]}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["3", 2]}},
            "9": {"class_type": "SaveImage",
                  "inputs": {"filename_prefix": "dreamcraft", "images": ["8", 0]}},
        }

    def _workflow_checkpoint_i2i(self, prompt, ckpt, ref_name, seed, steps, cfg, denoise):
        wf = self._workflow_checkpoint(prompt, ckpt, 1024, 1024, seed, steps, cfg)
        wf["2"] = {"class_type": "LoadImage", "inputs": {"image": ref_name}}
        wf["4"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["3", 2]}}
        wf["5"]["inputs"]["denoise"] = denoise
        return wf

    # ---------- 提交 + 轮询 ----------
    async def _run(self, workflow, timeout_s=600):
        data = await _post_json(f"{self.base}/prompt",
                                {"prompt": workflow, "client_id": uuid.uuid4().hex}, None)
        pid = data.get("prompt_id")
        if not pid:
            raise RuntimeError(f"comfyui submit failed: {data}")
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            await asyncio.sleep(2)
            hist = await _get_json(f"{self.base}/history/{pid}", None)
            if pid not in hist:
                continue
            st = hist[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(f"comfyui exec error: {str(st.get('messages'))[:400]}")
            urls = []
            for o in hist[pid].get("outputs", {}).values():
                for img in o.get("images", []):
                    from urllib.parse import urlencode
                    urls.append(f"{self.base}/view?" + urlencode({"filename": img['filename'],
                        "subfolder": img.get('subfolder', ''), "type": img.get('type', 'output')}))
            if urls:
                return urls
        raise TimeoutError("comfyui: timed out waiting for result")

    # ---------- 对外接口 ----------
    async def generate_image(self, *, prompt, ref_image=None, model="default",
                             aspect_ratio="1:1", resolution=1024, seed=None, n=1, mask_image=None) -> dict:
        loop = asyncio.get_event_loop()
        seed = seed if seed is not None else int(time.time()) % 2**32
        w, h = _aspect_size(aspect_ratio, resolution)
        m = (model or "default").lower()

        # 档位选择：显式指定档位 > 用户 _force_engine > 自动（快速草稿优先）
        want = m
        if want in ("default", "auto"):
            engines = await loop.run_in_executor(None, self.available_engines)
            want = self._force_engine or next((e["id"] for e in engines if e["id"] == "sdxl-draft"), engines[0]["id"] if engines else "none")

        if want == "sdxl-draft":
            if not await loop.run_in_executor(None, self._has_sdxl):
                raise RuntimeError(f"缺少 SDXL checkpoint（{SDXL_CKPT}）")
            if not await loop.run_in_executor(None, self._has_lightning):
                raise RuntimeError(f"缺少 Lightning LoRA（{SDXL_LORA}），无法用草稿档")
            wf = self._workflow_sdxl(prompt, w, h, seed, SDXL_DRAFT_STEPS,
                                     SDXL_DRAFT_CFG, lora=self._lightning_lora(), scheduler="sgm_uniform")
            engine = "sdxl-draft"
        elif want == "sdxl":
            if not await loop.run_in_executor(None, self._has_sdxl):
                raise RuntimeError(f"缺少 SDXL checkpoint（{SDXL_CKPT}）")
            wf = self._workflow_sdxl(prompt, w, h, seed, SDXL_STEPS, SDXL_CFG)
            engine = "sdxl"
        elif want in ("z-image-turbo", "z-image", "zimage"):
            if not await loop.run_in_executor(None, self._has_zimage):
                raise RuntimeError("缺少 Z-Image 三件套（unet + clip + vae）")
            # 默认 12 步 / cfg 2.0：比 8 步更贴提示词，比 16 步更快（折中档）
            steps = int(os.environ.get("ZIMAGE_STEPS", "12"))
            cfg = float(os.environ.get("ZIMAGE_CFG", "2.0"))
            if ref_image:
                fn = await loop.run_in_executor(None, self._upload_image, ref_image)
                wf = self._workflow_zimage_i2i(prompt, fn, w, h, seed, steps, cfg, 0.55)
            else:
                wf = self._workflow_zimage(prompt, w, h, seed, steps, cfg)
            engine = "z-image-turbo"
        else:
            raise RuntimeError(f"未知档位 {model}；可用：{self.available_engines()}")

        if ref_image and engine in ("sdxl", "sdxl-draft"):
            fn = await loop.run_in_executor(None, self._upload_image, ref_image)
            wf["2"] = {"class_type": "LoadImage", "inputs": {"image": fn}}
            wf["4"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["3", 2]}}
            wf["5"]["inputs"]["denoise"] = 0.55
        for node in wf.values():
            if node["class_type"] in ("EmptyLatentImage", "EmptySD3LatentImage"):
                node["inputs"]["batch_size"] = n
        if ref_image and n > 1:
            sampler = wf["8"] if engine == "z-image-turbo" else wf["5"]
            wf["11"] = {"class_type": "RepeatLatentBatch", "inputs": {"samples": sampler["inputs"]["latent_image"], "amount": n}}
            sampler["inputs"]["latent_image"] = ["11", 0]
        if mask_image and ref_image:
            fn = await loop.run_in_executor(None, self._upload_image, mask_image)
            sampler = wf["8"] if engine == "z-image-turbo" else wf["5"]
            wf["12"] = {"class_type": "LoadImage", "inputs": {"image": fn}}
            wf["13"] = {"class_type": "ImageToMask", "inputs": {"image": ["12", 0], "channel": "red"}}
            wf["14"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": sampler["inputs"]["latent_image"], "mask": ["13", 0]}}
            sampler["inputs"]["latent_image"] = ["14", 0]
            sampler["inputs"]["denoise"] = 1.0
        urls = await self._run(wf)
        # 落盘到本地 exports/，不依赖 ComfyUI 常驻
        local = await loop.run_in_executor(
            None, lambda: [_mirror_to_exports(u) for u in urls])
        return {"status": "success", "engine": engine,
                "results": [{"url": u, "seed": seed, "model": engine} for u in local[:max(1, n)]]}

    async def matting(self, image_url: str) -> dict:
        """抠图：有 BiRefNet 模型走真实工作流，否则返回 engine=none 让调用方降级。"""
        loop = asyncio.get_event_loop()
        bg = await loop.run_in_executor(None, self._bg_model)
        if not bg:
            return {"engine": "none", "note": "未找到 background_removal 模型"}
        fn = await loop.run_in_executor(None, self._upload_image, image_url)
        # RemoveBackground 输出的是 MASK，必须经 MaskToImage 转成 IMAGE 才能存
        wf = {
            "1": {"class_type": "LoadImage", "inputs": {"image": fn}},
            "2": {"class_type": "LoadBackgroundRemovalModel",
                  "inputs": {"bg_removal_name": bg}},
            "3": {"class_type": "RemoveBackground",
                  "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]}},
            "5": {"class_type": "MaskToImage", "inputs": {"mask": ["3", 0]}},
            "4": {"class_type": "SaveImage",
                  "inputs": {"filename_prefix": "matte", "images": ["5", 0]}},
        }
        urls = await self._run(wf, timeout_s=300)
        # mask 结果也落盘，不依赖 ComfyUI 常驻
        local = await loop.run_in_executor(None, lambda: [_mirror_to_exports(u) for u in urls])
        return {"engine": "comfyui:" + bg, "mask_url": local[0]}

    async def generate_video(self, *, prompt, ref_image=None, duration=5.0, model="default") -> dict:
        raise NotImplementedError("ComfyUI 本地视频需 AnimateDiff/Wan 插件；视频请走 Agnes")

    def _upload_image(self, image_url):
        data = read_image_bytes(image_url)
        boundary = "dc" + uuid.uuid4().hex
        filename = "ref_" + uuid.uuid4().hex + ".png"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n".encode()
                + data + f"\r\n--{boundary}--\r\n".encode())
        request = urllib.request.Request(self.base + "/upload/image", data=body,
            headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
        with open_remote(request, timeout=60) as response:
            result = json.loads(response.read())
        return "/".join(filter(None, (result.get("subfolder"), result["name"])))


# ==================== Mock ====================
class MockProvider:
    async def generate_image(self, **kw):
        kw = kw or {}
        n = kw.get("n", 1)
        return {"status": "success", "results": [
            {"url": f"https://picsum.photos/seed/{uuid.uuid4().hex[:8]}/1024/1024",
             "seed": uuid.uuid4().int >> 48, "model": kw.get("model", "default")}
            for _ in range(n)]}

    async def generate_video(self, **kw):
        return {"status": "success", "results": [
            {"url": "https://www.w3schools.com/html/mov_bbb.mp4"}]}


# ==================== helpers ====================
def _aspect_size(aspect_ratio: str, resolution: int):
    try:
        a, b = aspect_ratio.split(":")
        a, b = float(a), float(b)
    except Exception:
        a = b = 1.0
    if a <= 0 or b <= 0 or resolution < 8:
        raise ValueError("invalid image dimensions")
    if a >= b:
        w, h = resolution, int(resolution * b / a)
    else:
        w, h = int(resolution * a / b), resolution
    return (w // 8 * 8, h // 8 * 8)


def _post_json(url, body, key, retries=3):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, functools.partial(_sync_post, url, body, key, retries))


def _get_json(url, key):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, functools.partial(_sync_get, url, key))


def _sync_post(url, body, key, retries=3):
    """503 退避重试。视频队列满（video_queue_full）可能需要等几分钟，调用方传更大的 retries。"""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json",
                         **({"Authorization": f"Bearer {key}"} if key else {})})
            with open_remote(req, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 503 and attempt < retries - 1:
                wait = min(60, 15 * (attempt + 1))
                try:
                    err_body = e.read().decode()[:200]
                    if "video_queue_full" in err_body:
                        print(f"[agnes] 视频队列满，{wait}s 后重试 ({attempt+1}/{retries})")
                        time.sleep(wait)
                        continue
                except Exception:
                    pass
                time.sleep(wait)
                continue
            raise


def _sync_get(url, key):
    req = urllib.request.Request(
        url, headers={**({"Authorization": f"Bearer {key}"} if key else {})})
    with open_remote(req, timeout=300) as r:
        return json.loads(r.read())


def _stage_image(url):
    """ComfyUI LoadImage 只读 input/ 下的文件；外链或本地路径都下载/复制进去。"""
    import shutil
    os.makedirs(COMFYUI_INPUT_DIR, exist_ok=True)
    fn = f"ref_{uuid.uuid4().hex[:10]}.png"
    dest = os.path.join(COMFYUI_INPUT_DIR, fn)
    if url.startswith(("http://", "https://")):
        urllib.request.urlretrieve(url, dest)
    elif url.startswith(("/uploads/", "/exports/")):
        # 保留完整相对路径：/exports/x.png -> app/backend/exports/x.png
        base = os.path.join(os.path.dirname(__file__), url.lstrip("/"))
        shutil.copy(base, dest)
    else:
        shutil.copy(url, dest)
    return fn


def read_image_bytes(url):
    """Read uploaded/generated images from the configured data directory."""
    if url.startswith("data:image/"):
        return base64.b64decode(url.split(",", 1)[1], validate=True)
    if url.startswith(("http://", "https://")):
        with open_remote(url, timeout=30) as response:
            return response.read(20 * 1024 * 1024)
    if url.startswith(("/uploads/", "/exports/")):
        from pathlib import Path
        root = Path(os.environ.get("DATA_DIR") or os.path.dirname(__file__)).resolve()
        path = (root / url.lstrip("/")).resolve()
        media_root = root / ('uploads' if url.startswith('/uploads/') else 'exports')
        if not path.is_relative_to(media_root.resolve()):
            raise ValueError("invalid image path")
        return path.read_bytes()
    raise ValueError("图片必须是上传文件、生成结果或 HTTP 图片地址")


EXPORTS_DIR = os.path.join(
    os.environ.get("DATA_DIR") or os.path.dirname(__file__), "exports")


def _mirror_to_exports(url: str) -> str:
    """把 ComfyUI 的 /view?... 结果下载到本地 exports/，返回稳定的 /exports/ 路径。
    失败时原样返回（不阻断生成）。"""
    try:
        os.makedirs(EXPORTS_DIR, exist_ok=True)
        fn = f"gen_{uuid.uuid4().hex[:12]}.png"
        dest = os.path.join(EXPORTS_DIR, fn)
        download_remote(url, dest)
        if os.path.getsize(dest) > 0:
            return "/exports/" + fn
    except Exception:
        pass
    return url
