"""ComfyUI 启动器：用实例自己的 models 目录（不传 --base-directory），
避免 Shared 与 Instances 两套 models 目录不一致导致模型识别不到。

模型统一放：E:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\models\\
"""
import subprocess, os, sys, time, socket

COMFY_PY = r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe"
COMFY_MAIN = r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\main.py"
COMFY_HOME = r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI"
PORT = "8188"

cors = "*"
if "--cors" in sys.argv:
    cors = sys.argv[sys.argv.index("--cors") + 1]

try:
    with socket.create_connection(("127.0.0.1", int(PORT)), timeout=1):
        print(f"[skip] ComfyUI 已在 :{PORT} 跑着")
        sys.exit(0)
except OSError:
    pass

log = open(r"E:\Comfy-Desktop\comfy-run.out.log", "w", encoding="utf-8")
err = open(r"E:\Comfy-Desktop\comfy-run.err.log", "w", encoding="utf-8")
# 关键：不传 --base-directory，让 models 用实例自己的目录
subprocess.Popen(
    [COMFY_PY, COMFY_MAIN, "--listen", "0.0.0.0", "--port", PORT,
     "--enable-cors-header", cors],
    cwd=COMFY_HOME, stdout=log, stderr=err,
    creationflags=0x08000000 if os.name == "nt" else 0)
print(f"[start] ComfyUI(GPU+CORS {cors}) -> http://127.0.0.1:{PORT}")
print(f"[dir] models = {os.path.join(COMFY_HOME, 'models')}")

for _ in range(90):
    time.sleep(1)
    try:
        with socket.create_connection(("127.0.0.1", int(PORT)), timeout=1):
            print("[ok] 端口就绪")
            break
    except OSError:
        pass
else:
    print("[warn] 90s 内没起来，看 comfy-run.err.log")
