"""Local-only simulated browser fixture. Never used by the application."""
import hashlib
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "backend"))
import main
from PIL import Image
import uvicorn


if __name__ == "__main__":
    try:
        user = main.auth.register("workspace-browser", "test-password")
    except ValueError:
        user = main.auth.login("workspace-browser", "test-password")
    uid = user["user_id"]
    if not main.wallet.list_assets(1, owner=uid):
        for index in range(27):
            name = f"browser-{index:02}.png"
            Image.new("RGB", (160, 100), (30 + index * 6, 100, 150)).save(Path(main.UPLOAD_DIR, name))
            main.wallet.add_asset("/uploads/" + name, "image", f"Browser asset {index:02}", owner=uid)
    main.userconfig.save(uid, video_platform="agnes", video_key="offline-key")
    if not main.store.get("browser-failed"):
        main.store.create("browser-failed", "video", {"prompt": "Reusable video prompt"}, "failed", owner=uid)
        main.store.update("browser-failed", error="Offline simulated failure")
        main.store.create("browser-paused", "drama-shot", {"prompt": "Recover query", "shot_id": 1}, "paused", owner=uid)
        main.store.update("browser-paused", error="Query timeout", upstream={
            "task_id": "offline-existing", "platform": "agnes", "model": "test", "base": "",
            "key_hash": hashlib.sha256(b"offline-key").hexdigest(), "submitted_at": 1,
        })
    main.video_platforms.submit = lambda *args, **kwargs: {"task_id": "offline-new", "model": "test"}
    main.video_platforms.poll = lambda *args, **kwargs: {"status": "succeed", "url": "https://example.invalid/offline.mp4"}
    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ["WORKSPACE_TEST_PORT"]), log_level="warning")
