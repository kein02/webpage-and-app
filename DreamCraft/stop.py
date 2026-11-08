"""停止造梦工坊服务。

用法：
  python stop.py            # 停全部（8188 + 8100 + 5173）
  python stop.py --app      # 只停后端和前端，保留 ComfyUI
"""
import subprocess, sys

keep_comfy = "--app" in sys.argv
ports = "8100,5173" if keep_comfy else "8100,5173,8188"

cmd = (
    f"Get-NetTCPConnection -LocalPort {ports} -State Listen -ErrorAction SilentlyContinue | "
    "Select-Object -ExpandProperty OwningProcess -Unique | "
    "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
)
subprocess.run(["powershell", "-Command", cmd], shell=False)
if keep_comfy:
    print("[stop] ports 8100 + 5173 released (ComfyUI 保留)")
else:
    print("[stop] ports 8188 (ComfyUI) + 8100 (backend) + 5173 (frontend) released")
