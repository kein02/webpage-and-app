"""造梦工坊 生产模式启动：单端口 8100 提供 API + 前端静态资源。

与 run.py（开发模式，双端口 5173+8100）的区别：
  - 前端用 dist/ 构建产物，不需要 vite dev server
  - 只需开 8100 一个端口
  - 适合部署到服务器长期运行

前置：
  cd app/frontend && npm run build

用法：
  python serve.py                       # 公开版：用户自带引擎
  python serve.py --mode local          # 本机调试：自动使用本机引擎和密钥
  python serve.py --mode local --with-comfy
"""
import os, sys, subprocess, time, pathlib, socket, argparse

parser = argparse.ArgumentParser(description='DreamCraft local/public server')
parser.add_argument('--mode', choices=('local', 'public'), default='public')
parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8100')))
parser.add_argument('--data-dir')
parser.add_argument('--with-comfy', action='store_true')
args = parser.parse_args()
if args.with_comfy and args.mode != 'local':
    parser.error('--with-comfy 仅用于 --mode local')

# Windows 控制台默认 GBK，强制 stdout 用 UTF-8，避免中文/符号报错
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent
BACKEND = ROOT / "app" / "backend"
DIST = ROOT / "app" / "frontend" / "dist"
PORT = args.port

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def port_open(port, host="127.0.0.1"):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


# 1. 检查前端构建产物
if port_open(PORT):
    raise SystemExit(f'[error] 端口 {PORT} 已被占用，请更换 --port 或停止已有网页服务')
if not (DIST / "index.html").exists():
    print("[error] 前端未构建，先执行：cd app/frontend && npm run build")
    sys.exit(1)

print(f"[check] 前端产物存在: {DIST}")

# 2. 可选：拉起 ComfyUI
if args.with_comfy and not port_open(8188):
    comfy_py = pathlib.Path(r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe")
    comfy_main = pathlib.Path(r"E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\main.py")
    if comfy_py.exists() and comfy_main.exists():
        print("[start] ComfyUI ...")
        subprocess.Popen(
            [str(comfy_py), str(comfy_main), "--listen", "127.0.0.1",
             "--port", "8188", "--enable-cors-header", "*"],
            cwd=str(comfy_main.parent),
            stdout=open(ROOT / "comfy.out.log", "w", encoding="utf-8"),
            stderr=open(ROOT / "comfy.err.log", "w", encoding="utf-8"),
            creationflags=CREATE_NO_WINDOW)
        for _ in range(90):
            time.sleep(1)
            if port_open(8188):
                print("[ok] ComfyUI 就绪")
                break

# 3. 启动后端（它同时托管前端）
env = dict(os.environ)
env["PORT"] = str(PORT)
env['DREAMCRAFT_MODE'] = args.mode
env['BYOK_ONLY'] = '1' if args.mode == 'public' else '0'
if args.data_dir:
    env['DATA_DIR'] = str(pathlib.Path(args.data_dir).resolve())
    env['DREAMCRAFT_DB'] = str(pathlib.Path(env['DATA_DIR']) / 'dreamcraft.db')
elif args.mode == 'public':
    env['DATA_DIR'] = str(BACKEND / 'public-data')
    env['DREAMCRAFT_DB'] = str(BACKEND / 'public-data' / 'dreamcraft.db')
if args.mode == 'public':
    env.update(NO_LOCAL_ENV='1', COMFYUI_DISABLE='1', DREAMCRAFT_DEMO_COMMERCE='0')
    for key in ('AGNES_API_KEY', 'AGNES_API_TOKEN', 'APIHUB_AGNES_API_KEY', 'AGNES_API_ROOT'):
        env.pop(key, None)
env.setdefault("FRONTEND_DIST", str(DIST))

# 加载 .env
env_file = BACKEND / ".env"
if args.mode == 'local' and env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env.setdefault(k.strip(), v.strip())

print(f"[start] mode={args.mode} -> http://{'127.0.0.1' if args.mode == 'local' else '0.0.0.0'}:{PORT}")
print(f"[url]   本机访问 http://127.0.0.1:{PORT}")
print(f"[tip]   停止：Ctrl+C 或 python stop.py")
subprocess.run([sys.executable, "main.py"], cwd=str(BACKEND), env=env)
