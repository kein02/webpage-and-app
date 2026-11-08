"""抠图/蒙版：ComfyUI SAM 到位前前端 canvas 蒙版合成兜底；
部署 ComfyUI 后自动切到真实 SAM 分割。
"""
import os, json, time, urllib.request

COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")


def _comfyui_alive() -> bool:
    try:
        urllib.request.urlopen(COMFYUI_URL + "/system_stats", timeout=1)
        return True
    except Exception:
        return False


def segment(url: str, mode: str = "saliency") -> dict:
    """
    有 ComfyUI（装了 SAM 插件）：走真实 SAM 节点出蒙版
    没有：返回整图蒙版占位（链路通，前端 canvas 合成 = 原图透明底）
    """
    if _comfyui_alive():
        nodes = {
            "1": {"class_": "LoadImage", "inputs": {"image": "user_ref.png"}},
            "2": {"class_": "SAM", "inputs": {
                "image": ["1", 0],
                "point_coords": {"value": [512, 512]},
                "point_labels": {"value": [1]}
            }},
            "3": {"class_": "SaveImage", "inputs": {"filename_prefix": "mask", "images": ["2", 0]}},
        }
        req = urllib.request.Request(
            COMFYUI_URL + "/prompt", data=json.dumps({"prompt": nodes, "client_id": "dc"}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            pid = json.loads(r.read())["prompt_id"]
        for _ in range(60):
            time.sleep(3)
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{pid}", timeout=10) as h:
                hist = json.loads(h.read())
            if pid in hist:
                for o in hist[pid].get("outputs", {}).values():
                    for img in o.get("images", []):
                        return {"mask_url": f"{COMFYUI_URL}/view?filename={img['filename']}&type=output",
                                "engine": "comfyui-sam"}
        raise TimeoutError("comfyui sam: timeout")
    # 兜底：整图蒙版
    return {"mask_url": url + "?mask=full", "engine": "fallback-full"}
