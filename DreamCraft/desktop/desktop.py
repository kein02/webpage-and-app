"""Windows browser-based desktop launcher."""
import argparse
import json
import os
import queue
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-window', action='store_true')
    maintenance = parser.add_mutually_exclusive_group()
    maintenance.add_argument('--backup-to', type=Path)
    maintenance.add_argument('--restore-from', type=Path)
    parser.add_argument('--wait-pid', type=int)
    args = parser.parse_args()
    if args.wait_pid:
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x100000, False, args.wait_pid)
        if handle:
            try:
                if kernel.WaitForSingleObject(handle, 60000) != 0:
                    raise RuntimeError('Previous desktop process did not exit')
            finally:
                kernel.CloseHandle(handle)
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
        if args.backup_to or args.restore_from:
            raise RuntimeError('请先关闭正在使用此数据目录的 DreamCraft，再备份或恢复。')
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
    from version import VERSION
    if args.backup_to or args.restore_from:
        import backup
        try:
            if args.backup_to:
                result = backup.create(data, args.backup_to, VERSION)
                message = '备份已保存：\n' + str(result) + '\n备份包含账号和 API 密钥，请妥善保管。'
            else:
                result = backup.restore(data, args.restore_from, VERSION)
                message = '恢复完成。恢复前的数据备份：\n' + str(result)
            if not args.no_window:
                import tkinter.messagebox
                tkinter.messagebox.showinfo('DreamCraft 数据备份', message)
            print(message)
        except Exception:
            print(traceback.format_exc())
            if args.no_window:
                raise
            import tkinter.messagebox
            tkinter.messagebox.showerror('DreamCraft 数据备份', '操作未完成，原数据已保留。请查看 desktop.log。')
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
    window.title('DreamCraft ' + VERSION)
    if (root / 'app.ico').exists():
        window.iconbitmap(str(root / 'app.ico'))
    window.geometry('480x420')
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=24)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='DreamCraft', font=('Segoe UI', 20, 'bold')).pack(anchor='w')
    label = ttk.Label(frame, text='正在启动本机工作区……')
    label.pack(anchor='w', pady=(10, 16))
    open_button = ttk.Button(frame, text='打开工作区', command=lambda: webbrowser.open(url), state='disabled')
    open_button.pack(fill='x')
    ttk.Button(frame, text='打开数据目录', command=lambda: os.startfile(data)).pack(fill='x', pady=6)
    update_text = ttk.Label(frame, text='版本 ' + VERSION, wraplength=420)
    update_text.pack(anchor='w', pady=(8, 6))
    update_events = queue.Queue()
    update_state = {'release': None, 'busy': False}
    import updater
    app_dir = Path(sys.executable).resolve().parent
    frozen = bool(getattr(sys, 'frozen', False))

    def maintenance_action(restore=False):
        if update_state['busy'] or closing.is_set() or not ready.is_set():
            return
        from tkinter import filedialog
        if restore:
            selected = filedialog.askopenfilename(parent=window, title='选择 DreamCraft 备份',
                                                 filetypes=[('DreamCraft 备份', '*.zip')])
        else:
            selected = filedialog.asksaveasfilename(parent=window, title='保存 DreamCraft 备份',
                initialfile='DreamCraft-backup-' + time.strftime('%Y%m%d-%H%M%S') + '.zip',
                defaultextension='.zip', filetypes=[('DreamCraft 备份', '*.zip')])
        if not selected:
            return
        text = ('将恢复备份中的全部账号、项目、素材和引擎设置，替换当前数据。恢复前会自动另存当前数据。'
                if restore else '备份包含全部账号、项目、素材及 API 密钥，请妥善保管备份文件。')
        if not messagebox.askokcancel('DreamCraft 数据备份', text + '\n请先保存网页编辑内容。本机服务将重启。', parent=window):
            return
        command = [sys.executable]
        if not frozen:
            command.append(str(Path(__file__).resolve()))
        command += ['--data-dir', str(data), '--wait-pid', str(os.getpid()),
                    '--restore-from' if restore else '--backup-to', selected]
        if args.no_browser:
            command.append('--no-browser')
        subprocess.Popen(command, creationflags=subprocess.CREATE_NO_WINDOW)
        close()

    backup_row = ttk.Frame(frame)
    backup_row.pack(fill='x', pady=(10, 0))
    backup_button = ttk.Button(backup_row, text='备份数据', command=maintenance_action, state='disabled')
    backup_button.pack(side='left', fill='x', expand=True, padx=(0, 6))
    restore_button = ttk.Button(backup_row, text='恢复备份', command=lambda: maintenance_action(True), state='disabled')
    restore_button.pack(side='left', fill='x', expand=True)

    def background(operation):
        update_state['busy'] = True
        update_button.configure(state='disabled')
        backup_button.configure(state='disabled')
        restore_button.configure(state='disabled')
        def work():
            try:
                update_events.put(('done', operation()))
            except Exception as error:
                print('Update failed:', type(error).__name__, str(error))
                update_events.put(('error', '更新未完成，请稍后重试。当前版本仍可使用。'))
        threading.Thread(target=work, daemon=True).start()

    def check_update():
        if update_state['busy'] or closing.is_set():
            return
        update_text.configure(text='正在检查新版本……')
        def operation():
            kind = 'installed' if updater.installed(app_dir) else 'portable'
            return ('checked', updater.check(VERSION, kind))
        background(operation)

    def update_action():
        release = update_state['release']
        if not release:
            check_update()
            return
        new_version = release['tag_name'].removeprefix('dreamcraft-v')
        if not messagebox.askyesno('DreamCraft 更新',
                f'下载并升级到 {new_version}？\n下载完成后会关闭本机服务，请先保存正在编辑的内容。\n账号、引擎设置和作品会保留。'):
            return
        update_text.configure(text='正在下载更新……')
        def operation():
            def progress(received, total):
                update_events.put(('progress', f'正在下载更新 {received * 100 // total}%'))
            plan = updater.prepare(release, VERSION, app_dir, data,
                                   root / 'apply-update.ps1', progress, no_browser=args.no_browser)
            helper_process = updater.launch(plan)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if (plan.parent / 'ready').exists():
                    return ('installing', None)
                if helper_process.poll() is not None:
                    raise RuntimeError('Update helper rejected package: ' + str(plan.parent))
                time.sleep(.1)
            helper_process.terminate()
            raise TimeoutError('Update helper startup timeout')
        background(operation)

    update_button = ttk.Button(frame, text='检查更新', command=update_action)
    update_button.pack(fill='x')
    if not frozen:
        update_button.configure(state='disabled')
        update_text.configure(text='版本 ' + VERSION + ' · 源码版请通过 Git 更新')

    def poll_updates():
        if closing.is_set():
            return
        while True:
            try:
                event, value = update_events.get_nowait()
            except queue.Empty:
                break
            if event == 'progress':
                update_text.configure(text=value)
            elif event == 'error':
                update_state['busy'] = False
                update_button.configure(state='normal')
                update_text.configure(text=value)
                if ready.is_set():
                    backup_button.configure(state='normal')
                    restore_button.configure(state='normal')
            elif event == 'done':
                update_state['busy'] = False
                action, result = value
                if action == 'installing':
                    close()
                    return
                update_state['release'] = result
                update_button.configure(state='normal', text='下载并更新' if result else '检查更新')
                text = '当前已是最新版本'
                if result:
                    text = '发现新版本 ' + result['tag_name'].removeprefix('dreamcraft-v')
                update_text.configure(text=text)
                if ready.is_set():
                    backup_button.configure(state='normal')
                    restore_button.configure(state='normal')
        window.after(150, poll_updates)

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
            if not update_state['busy']:
                backup_button.configure(state='normal')
                restore_button.configure(state='normal')
            if not args.no_browser:
                webbrowser.open(url)
        else:
            window.after(100, poll)
    window.after(100, poll)
    window.after(150, poll_updates)
    if frozen and os.environ.get('DREAMCRAFT_UPDATE_CHECK', '1') != '0':
        window.after(2000, check_update)
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
