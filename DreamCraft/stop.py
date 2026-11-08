"""停止造梦工坊服务。

用法：
  python stop.py            # 只停后端和前端，保留 ComfyUI
  python stop.py --comfy    # 显式同时停止 8188 上的 ComfyUI
"""
import argparse, subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', action='store_true', help='仅停止网页服务（默认）')
parser.add_argument('--comfy', action='store_true', help='同时停止 8188 上的 ComfyUI')
parser.add_argument('--port', type=int, default=8100, help='后端端口，默认 8100')
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    parser.error('端口必须为 1 至 65535')
keep_comfy = not args.comfy or args.app
ports = f"{args.port},5173" if keep_comfy else f"{args.port},5173,8188"

cmd = (
    f"Get-NetTCPConnection -LocalPort {ports} -State Listen -ErrorAction SilentlyContinue | "
    "Select-Object -ExpandProperty OwningProcess -Unique | "
    "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
)
subprocess.run(["powershell", "-Command", cmd], shell=False)
if keep_comfy:
    print(f"[stop] ports {args.port} + 5173 released (ComfyUI 保留)")
else:
    print(f"[stop] ports 8188 (ComfyUI) + {args.port} (backend) + 5173 (frontend) released")
