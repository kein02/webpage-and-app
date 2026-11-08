"""造梦工坊一键启动：ComfyUI(GPU) + 后端(8100) + 前端(5173)。"""
import os, sys, subprocess, time, pathlib, shutil, socket

ROOT = pathlib.Path(__file__).resolve().parent
backend, frontend = ROOT / "app" / "backend", ROOT / "app" / "frontend"
env = dict(os.environ)
env.update(DREAMCRAFT_MODE='local', BYOK_ONLY='0')
env.setdefault('PORT', '8100')

# 加载 backend/.env
env_file = backend / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env.setdefault(k.strip(), v.strip())

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# --- ComfyUI 桌面版（GPU）路径 ---
COMFY_HOME = pathlib.Path(os.environ.get(
    "COMFYUI_HOME", r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI"))
COMFY_PY = COMFY_HOME / ".venv" / "Scripts" / "python.exe"
COMFY_MAIN = COMFY_HOME / "main.py"
COMFY_BASE = pathlib.Path(os.environ.get(
    "COMFYUI_BASE", r"E:\Comfy-Desktop\ComfyUI-Shared"))
COMFY_PORT = int(os.environ.get("COMFYUI_PORT", "8188"))

procs = []


def port_open(port: int, host="127.0.0.1") -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


app_port = int(env['PORT'])
if port_open(app_port) or port_open(5173):
    raise SystemExit(f'[error] {app_port} 或 5173 已被占用，请停止已有网页服务后再启动')
env['VITE_API_PROXY'] = f'http://127.0.0.1:{app_port}'


# 1. ComfyUI（已在跑就跳过）
# 注意：不传 --base-directory —— 让 models 用实例自己的目录，
# 否则 background_removal 等子目录会指向 Shared 导致模型识别不到。
if env.get("COMFYUI_DISABLE") == "1":
    print("[skip] ComfyUI disabled (COMFYUI_DISABLE=1)")
elif port_open(COMFY_PORT):
    print(f"[skip] ComfyUI already running on :{COMFY_PORT}")
elif COMFY_PY.exists() and COMFY_MAIN.exists():
    procs.append(subprocess.Popen(
        [str(COMFY_PY), str(COMFY_MAIN), "--listen", "127.0.0.1",
         "--port", str(COMFY_PORT), "--enable-cors-header", "*"],
        cwd=str(COMFY_HOME), env=env,
        stdout=open(ROOT / "comfy.out.log", "w", encoding="utf-8"),
        stderr=open(ROOT / "comfy.err.log", "w", encoding="utf-8"),
        creationflags=CREATE_NO_WINDOW))
    print(f"[start] ComfyUI(GPU) -> http://127.0.0.1:{COMFY_PORT}")
    # 等它起来（最多 60s），后端启动时要探测
    for _ in range(60):
        time.sleep(1)
        if port_open(COMFY_PORT):
            break
else:
    print(f"[skip] ComfyUI 未找到（{COMFY_PY}）——生图走 Agnes 云端")

# 2. 后端
procs.append(subprocess.Popen(
    [sys.executable, "main.py"], cwd=backend, env=env,
    stdout=open(backend / "uvicorn.out.log", "w", encoding="utf-8"),
    stderr=open(backend / "uvicorn.err.log", "w", encoding="utf-8"),
    creationflags=CREATE_NO_WINDOW))
print(f"[start] backend -> http://127.0.0.1:{app_port}  (provider 见 app/backend/uvicorn.out.log)")

time.sleep(2)

# 3. 前端
npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
procs.append(subprocess.Popen(
    [npx, "vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], cwd=frontend, env=env,
    stdout=open(frontend / "vite.log", "w", encoding="utf-8"),
    stderr=open(frontend / "vite.err.log", "w", encoding="utf-8"),
    creationflags=CREATE_NO_WINDOW))
print("[start] frontend -> http://127.0.0.1:5173")
print("[tip] 停止：python stop.py")
