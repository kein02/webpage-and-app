"""Windows browser-based desktop launcher."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-window', action='store_true')
    args = parser.parse_args()
    data = (args.data_dir or Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'DreamCraft').resolve()
    data.mkdir(parents=True, exist_ok=True)
    log = open(data / 'desktop.log', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = log
    lock = open(data / 'desktop.lock', 'a+b')
    lock.seek(0)
    import msvcrt
    state_path = data / 'desktop.json'
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        for _ in range(100):
            try:
                state = json.loads(state_path.read_text(encoding='utf-8'))
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(state['url'] + '/api/desktop/status', timeout=1) as response:
                    if json.load(response).get('instance') == state['instance']:
                        if not args.no_browser:
                            webbrowser.open(state['url'])
                        return
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(.1)
        if not args.no_window:
            import tkinter.messagebox
            tkinter.messagebox.showerror('DreamCraft', '程序正在启动，请稍后重试。')
        return

    root = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
    if not getattr(sys, 'frozen', False):
        sys.path.insert(0, str(root.parent / 'app' / 'backend'))
    frontend = root / 'frontend'
    if not getattr(sys, 'frozen', False):
        frontend = root.parent / 'app' / 'frontend' / 'dist'
    if not (frontend / 'index.html').exists():
        raise RuntimeError('Missing frontend build')
    # Only runtime environment variables are used; no build-machine files are loaded.
    os.environ.update(DREAMCRAFT_MODE='local', BYOK_ONLY='0', NO_LOCAL_ENV='1',
        COMFYUI_DISABLE='0', DATA_DIR=str(data), DREAMCRAFT_DB=str(data / 'dreamcraft.db'),
        FRONTEND_DIST=str(frontend), DREAMCRAFT_DEMO_COMMERCE='0')
    import shutil
    ffmpeg = shutil.which('ffmpeg')
    adjacent_ffmpeg = Path(sys.executable).parent / 'ffmpeg.exe'
    if adjacent_ffmpeg.is_file():
        ffmpeg = str(adjacent_ffmpeg)
    if ffmpeg:
        os.environ['DREAMCRAFT_FFMPEG'] = ffmpeg
    preferred = 17861
    try:
        preferred = int(json.loads(state_path.read_text(encoding='utf-8'))['port'])
        if not 1024 <= preferred <= 65535:
            preferred = 17861
    except (OSError, ValueError, KeyError):
        pass
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        sock.bind(('127.0.0.1', preferred))
    except OSError:
        sock.bind(('127.0.0.1', 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    os.environ['CORS_ORIGINS'] = url
    instance = secrets.token_hex(24)
    ready = threading.Event()
    failure = []
    server_holder = []
    closing = threading.Event()

    def serve():
        try:
            import main as backend
            import uvicorn
            from fastapi import Request, HTTPException
            async def status():
                return {'instance': instance, 'data_dir': str(data)}
            async def stop(request):
                if request.headers.get('X-Desktop-Token') != instance:
                    raise HTTPException(403, 'Invalid desktop token')
                server_holder[0].should_exit = True
                return {'stopping': True}
            stop.__annotations__['request'] = Request
            backend.app.get('/api/desktop/status')(status)
            backend.app.router.routes.insert(0, backend.app.router.routes.pop())
            backend.app.post('/api/desktop/stop')(stop)
            backend.app.router.routes.insert(0, backend.app.router.routes.pop())
            config = uvicorn.Config(backend.app, log_level='info', access_log=False,
                                    timeout_graceful_shutdown=5, proxy_headers=False)
            server = uvicorn.Server(config)
            server_holder.append(server)
            if closing.is_set():
                ready.set()
                return
            worker = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
            worker.start()
            while not server.started and worker.is_alive():
                time.sleep(.05)
            if not server.started:
                raise RuntimeError('Backend failed to start')
            state_path.write_text(json.dumps({'url': url, 'port': port, 'instance': instance,
                                             'pid': os.getpid()}), encoding='utf-8')
            ready.set()
            if closing.is_set():
                server.should_exit = True
            worker.join()
        except BaseException:
            failure.append(traceback.format_exc())
            print(failure[-1])
            ready.set()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    if args.no_window:
        ready.wait(60)
        if failure or not ready.is_set():
            raise RuntimeError('Desktop backend startup failed; see desktop.log')
        if not args.no_browser:
            webbrowser.open(url)
        thread.join()
        return
    import tkinter as tk
    from tkinter import ttk, messagebox
    window = tk.Tk()
    window.title('DreamCraft 1.0.0')
    if (root / 'app.ico').exists():
        window.iconbitmap(str(root / 'app.ico'))
    window.geometry('440x230')
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=24)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='DreamCraft', font=('Segoe UI', 20, 'bold')).pack(anchor='w')
    label = ttk.Label(frame, text='正在启动本机工作区……')
    label.pack(anchor='w', pady=(10, 16))
    open_button = ttk.Button(frame, text='打开工作区', command=lambda: webbrowser.open(url), state='disabled')
    open_button.pack(fill='x')
    ttk.Button(frame, text='打开数据目录', command=lambda: os.startfile(data)).pack(fill='x', pady=6)
    def close():
        closing.set()
        if server_holder:
            server_holder[0].should_exit = True
        window.withdraw()
        def wait_exit():
            if thread.is_alive():
                window.after(100, wait_exit)
            else:
                window.destroy()
        wait_exit()
    window.protocol('WM_DELETE_WINDOW', close)
    def poll():
        if failure:
            messagebox.showerror('DreamCraft', '启动失败，请查看数据目录中的 desktop.log。')
            window.destroy()
        elif ready.is_set():
            label.configure(text=url + '\n关闭此窗口即可停止本机服务。')
            open_button.configure(state='normal')
            if not args.no_browser:
                webbrowser.open(url)
        else:
            window.after(100, poll)
    window.after(100, poll)
    window.mainloop()
    sock.close()
    lock.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        if '--no-window' not in sys.argv:
            import tkinter.messagebox
            tkinter.messagebox.showerror('DreamCraft', '程序启动失败，请查看 %LOCALAPPDATA%\\DreamCraft\\desktop.log')
        raise
