"""Projects, library and task recovery regression. All providers are simulated."""
import asyncio
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

MODE = "public" if "--public" in sys.argv else "local"
if "--public" in sys.argv:
    sys.argv.remove("--public")
folder = tempfile.TemporaryDirectory(prefix="dreamcraft-workspace-")
os.environ.update(DATA_DIR=folder.name, DREAMCRAFT_DB=str(Path(folder.name) / "test.db"),
                  NO_LOCAL_ENV="1", DREAMCRAFT_MODE=MODE, BYOK_ONLY="1", COMFYUI_DISABLE="1")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "backend"))
from fastapi.testclient import TestClient
from PIL import Image
import main


def png():
    out = io.BytesIO()
    Image.new("RGB", (20, 20), "green").save(out, "PNG")
    return out.getvalue()


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.client.__enter__()
        cls.users = [cls.client.post("/api/auth/register", json={"username": name, "password": "test-password"}).json()
                     for name in ("workspace-a", "workspace-b")]
        cls.a, cls.b = [{"Authorization": "Bearer " + u["token"]} for u in cls.users]

    def setUp(self):
        main._rate_windows.clear()
        self.client.cookies.clear()

    def uid(self):
        return self.users[0]["user_id"]

    def post(self, path, body, headers=None):
        return self.client.post(path, json=body, headers=headers or self.a)

    def project(self, kind="canvas"):
        body = {"kind": kind, "name": "测试项目", "data": {"layers": []} if kind == "canvas" else {"shots": [], "taskIds": [], "theme": "故事"}}
        result = self.post("/api/biz/v1/project/save", body)
        self.assertEqual(result.status_code, 200, result.text)
        return {**body, **result.json()}

    def asset(self, owner=None, url=None):
        filename = uuid.uuid4().hex + ".png"
        Path(main.UPLOAD_DIR, filename).write_bytes(png())
        return main.wallet.add_asset(url or "/uploads/" + filename, "upload", "素材搜索",
                                     owner=owner or self.uid())

    def wait(self, tid, expected):
        for _ in range(150):
            result = self.client.get("/lv/v1/task/status/" + tid, headers=self.a).json()
            if result["status"] == expected:
                return result
            time.sleep(.02)
        self.fail(f"{tid}: expected {expected}, got {result}")

    def configure(self, key="fake-video-key"):
        main.userconfig.save(self.uid(), video_platform="agnes", video_key=key)

    def receipt(self):
        return {"task_id": "existing-upstream", "platform": "agnes", "model": "test",
                "base": "", "key_hash": hashlib.sha256(b"fake-video-key").hexdigest(),
                "submitted_at": int(time.time())}

    def test_project_revision_and_isolation(self):
        body = self.project()
        pid = body["id"]
        fetched = self.client.get("/api/biz/v1/project/" + pid, headers=self.a).json()
        self.assertEqual(fetched["data"], body["data"])
        self.assertEqual(self.client.get("/api/biz/v1/project/" + pid, headers=self.b).status_code, 404)
        self.assertEqual(self.post("/api/biz/v1/project/save", body, self.b).status_code, 404)
        self.assertEqual(self.post(f"/api/biz/v1/project/{pid}/delete", {}, self.b).status_code, 404)
        self.assertEqual(self.post("/api/biz/v1/project/save", body).json()["revision"], 2)
        self.assertEqual(self.post("/api/biz/v1/project/save", body).status_code, 409)
        self.assertEqual(self.post(f"/api/biz/v1/project/{pid}/delete", {}).status_code, 200)
        self.assertEqual(self.client.get("/api/biz/v1/project/" + pid, headers=self.a).status_code, 404)

    def test_project_kind_limits_and_process_persistence(self):
        canvas, drama = self.project(), self.project("drama")
        listed = self.client.get("/api/biz/v1/project/list?kind=drama", headers=self.a).json()["projects"]
        self.assertIn(drama["id"], [p["id"] for p in listed])
        self.assertNotIn(canvas["id"], [p["id"] for p in listed])
        self.assertEqual(self.post("/api/biz/v1/project/save", {**canvas, "data": {"large": "x" * (2 * 1024 * 1024)}}).status_code, 413)
        probe = subprocess.run([sys.executable, "-c",
            "import projectstore,sys; p=projectstore.get_project(sys.argv[1],sys.argv[2]); assert p['data']['theme']=='故事'",
            self.uid(), drama["id"]], cwd=Path(main.BASE_DIR), capture_output=True, timeout=20)
        self.assertEqual(probe.returncode, 0, probe.stderr.decode(errors="replace"))

    def test_invalid_project_documents_are_rejected(self):
        for kind, data in (("canvas", {"layers": "bad"}), ("canvas", {"layers": [{"id": "x", "type": "text"}]}),
                           ("drama", {"shots": [{}]}), ("drama", {"taskIds": {}})):
            self.assertEqual(self.post("/api/biz/v1/project/save", {"kind": kind, "name": "bad", "data": data}).status_code, 400)

    def test_asset_pagination_search_metadata(self):
        ids = [self.asset() for _ in range(27)]
        first = self.client.get("/api/biz/v1/asset/list?limit=24&kind=upload", headers=self.a).json()
        second = self.client.get("/api/biz/v1/asset/list?limit=24&offset=24&kind=upload", headers=self.a).json()
        self.assertEqual(len(first["assets"]), 24)
        self.assertFalse({a["id"] for a in first["assets"]} & {a["id"] for a in second["assets"]})
        response = self.post(f"/api/biz/v1/asset/{ids[0]}/edit", {"name": "唯一名称", "tags": ["精选", "精选", "x"]})
        self.assertEqual(response.status_code, 200)
        found = self.client.get("/api/biz/v1/asset/list?q=唯一&tag=精选", headers=self.a).json()
        self.assertEqual(found["total"], 1)
        self.assertEqual(found["assets"][0]["tags"], ["精选", "x"])
        self.assertEqual(self.post(f"/api/biz/v1/asset/{ids[0]}/edit", {"name": "bad", "tags": []}, self.b).status_code, 404)
        self.assertEqual(self.client.get("/api/biz/v1/asset/list?q=唯一", headers=self.b).json()["total"], 0)

    def test_asset_trash_restore_atomic_ownership_and_zip(self):
        aid = self.asset()
        other = self.asset(self.users[1]["user_id"])
        self.assertEqual(self.post("/api/biz/v1/asset/trash", {"ids": [aid, other]}).status_code, 404)
        self.assertIsNone(main.wallet.get_asset(aid, self.uid())["deleted_at"])
        result = self.post("/api/biz/v1/asset/download", {"ids": [aid]})
        self.assertEqual(result.status_code, 200, result.text)
        with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
            self.assertEqual(archive.read(archive.namelist()[0]), png())
        self.assertEqual(self.post("/api/biz/v1/asset/download", {"ids": [other]}).status_code, 404)
        self.assertEqual(self.post("/api/biz/v1/asset/trash", {"ids": [aid]}).status_code, 200)
        self.assertEqual(self.post("/api/biz/v1/asset/download", {"ids": [aid]}).status_code, 404)
        trash = self.client.get("/api/biz/v1/asset/list?trash=true", headers=self.a).json()["assets"]
        self.assertIn(aid, [a["id"] for a in trash])
        self.assertTrue(main.wallet.owns_asset(main.wallet.get_asset(aid, self.uid())["url"], self.uid()))
        self.assertEqual(self.post("/api/biz/v1/asset/trash", {"ids": [aid], "restore": True}).status_code, 200)
        self.assertIsNone(main.wallet.get_asset(aid, self.uid())["deleted_at"])
        remote = self.asset(url="https://example.com/video.mp4")
        with patch.object(main, "open_remote", side_effect=AssertionError("must not fetch remote")):
            self.assertEqual(self.post("/api/biz/v1/asset/download", {"ids": [remote]}).status_code, 400)

    def test_legacy_asset_schema_migrates_without_data_loss(self):
        path = Path(folder.name) / "legacy.db"
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE assets(id TEXT PRIMARY KEY,url TEXT,kind TEXT,prompt TEXT,task_id TEXT,owner TEXT,created_at INTEGER)")
            conn.execute("INSERT INTO assets VALUES ('old','/uploads/x.png','image','old','','owner',1)")
            conn.commit()
        def migrate():
            old = getattr(main.wallet._local, "conn", None)
            main.wallet._local.conn = None
            try:
                with patch.object(main.wallet, "DB_PATH", str(path)):
                    self.assertEqual(main.wallet.list_assets(owner="owner")[0]["tags"], [])
                    main.wallet.add_asset("/uploads/new.png", owner="owner")
                    self.assertEqual(len(main.wallet.list_assets(owner="owner")), 2)
            finally:
                main.wallet._local.conn.close()
                main.wallet._local.conn = old
        self.client.portal.call(migrate)

    def test_video_receipt_persists_before_polling_and_is_redacted(self):
        self.configure()
        with patch.object(main.video_platforms, "submit", return_value={"task_id": "new-upstream", "model": "test"}) as submit, \
             patch.object(main.video_platforms, "poll", side_effect=TimeoutError("temporary network")):
            tid = self.post("/lv/v1/editor/video/submit_task", {"prompt": "test"}).json()["task_id"]
            self.wait(tid, "paused")
            submit.assert_called_once()
        receipt = main.store.get(tid)["upstream"]
        self.assertEqual(receipt["task_id"], "new-upstream")
        self.assertNotIn("fake-video-key", json.dumps(main.store.get(tid)))
        visible = self.post("/lv/v2/task/multi_get_tasks", {"task_ids": [tid]}).json()["tasks"][0]
        self.assertNotIn("key_hash", visible["upstream"])
        self.assertEqual(self.post(f"/lv/v1/task/{tid}/resume", {}, self.b).status_code, 404)
        with patch.object(main.video_platforms, "submit", side_effect=AssertionError("must not resubmit")), \
             patch.object(main.video_platforms, "poll", return_value={"status": "succeed", "url": "https://example.com/v.mp4"}):
            self.assertEqual(self.post(f"/lv/v1/task/{tid}/resume", {}).status_code, 200)
            self.wait(tid, "succeed")
        self.assertEqual(len([a for a in main.wallet.list_assets(500, owner=self.uid()) if a["task_id"] == tid]), 1)

    def test_restart_recovers_existing_job_without_submit_or_charge(self):
        self.configure()
        tid = uuid.uuid4().hex
        main.store.create(tid, "video", {"prompt": "restart"}, status="running", owner=self.uid())
        main.store.update(tid, upstream=self.receipt())
        balance = main.wallet.get_balance(self.uid())
        with patch.object(main.video_platforms, "submit", side_effect=AssertionError("must not resubmit")), \
             patch.object(main.video_platforms, "poll", return_value={"status": "succeed", "url": "https://example.com/recovered.mp4"}):
            async def restart():
                async with main.lifespan(main.app):
                    await asyncio.gather(*list(main._video_jobs.values()))
            self.client.portal.call(restart)
        self.assertEqual(main.store.get(tid)["status"], "succeed")
        self.assertEqual(main.wallet.get_balance(self.uid()), balance)
        result = main.store.get(tid)["result"]
        main.wallet.finish_video(tid, self.uid(), "restart", result)
        self.assertEqual(len([a for a in main.wallet.list_assets(500, owner=self.uid()) if a["task_id"] == tid]), 1)

    def test_changed_credentials_pause_without_remote_query(self):
        self.configure("changed-key")
        tid = uuid.uuid4().hex
        main.store.create(tid, "video", {"prompt": "changed"}, status="paused", owner=self.uid())
        main.store.update(tid, upstream=self.receipt())
        with patch.object(main.video_platforms, "poll", side_effect=AssertionError("wrong credentials")) as poll:
            self.post(f"/lv/v1/task/{tid}/resume", {})
            self.wait(tid, "paused")
            poll.assert_not_called()
        self.configure()

    def test_manual_retry_is_owned_and_duplicate_click_is_idempotent(self):
        self.configure()
        tid = uuid.uuid4().hex
        main.store.create(tid, "drama-shot", {"prompt": "retry-shot", "duration": 7, "shot_id": 3},
                          status="failed", owner=self.uid())
        self.assertEqual(self.post(f"/lv/v1/task/{tid}/retry", {}, self.b).status_code, 404)
        with patch.object(main.video_platforms, "submit", return_value={"task_id": "retry-upstream", "model": "test"}) as submit, \
             patch.object(main.video_platforms, "poll", return_value={"status": "succeed", "url": "https://example.com/retry.mp4"}):
            first = self.post(f"/lv/v1/task/{tid}/retry", {})
            second = self.post(f"/lv/v1/task/{tid}/retry", {})
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(first.json()["task_id"], second.json()["task_id"])
            self.wait(first.json()["task_id"], "succeed")
            submit.assert_called_once()
            self.assertEqual(submit.call_args.args[-1], 7)
        self.assertEqual(main.store.get(first.json()["task_id"])["payload"]["shot_id"], 3)

    def test_image_retry_link_is_durable_before_generation(self):
        from types import SimpleNamespace
        tid = uuid.uuid4().hex
        main.store.create(tid, "image", {"prompt": "image retry", "n": 1}, "failed", owner=self.uid())
        async def generate(**kwargs):
            self.assertTrue(main.store.get(tid)["retry_id"])
            return {"results": [{"url": "https://example.com/image.png"}]}
        with patch.object(main, "_provider_for", return_value=SimpleNamespace(generate_image=generate)):
            first = self.post(f"/lv/v1/task/{tid}/retry", {})
            self.assertEqual(first.status_code, 200, first.text)
            second = self.post(f"/lv/v1/task/{tid}/retry", {})
            self.assertEqual(first.json()["task_id"], second.json()["task_id"])
        self.assertEqual(self.post(f"/lv/v1/task/{first.json()['task_id']}/retry", {}).status_code, 409)

    def test_confirmed_video_failure_refunds_once(self):
        self.configure()
        tid = uuid.uuid4().hex
        before = main.wallet.get_balance(self.uid())
        main.store.create(tid, "video", {"prompt": "terminal failure"}, "running", owner=self.uid())
        main.store.update(tid, upstream=self.receipt())
        self.assertTrue(main.wallet.charge_for("video", self.uid(), task_id=tid))
        with patch.object(main.video_platforms, "submit", side_effect=AssertionError("must not resubmit")), \
             patch.object(main.video_platforms, "poll", return_value={"status": "failed", "error": "provider rejected"}):
            self.client.portal.call(main._run_video, tid)
        self.assertEqual(main.store.get(tid)["status"], "failed")
        main.wallet.refund_task(self.uid(), tid)
        self.assertEqual(main.wallet.get_balance(self.uid()), before)

    def test_project_and_library_auth(self):
        if MODE != "public":
            return
        for path in ("/api/biz/v1/project/list?kind=canvas", "/api/biz/v1/asset/list"):
            self.assertEqual(self.client.get(path).status_code, 401)
        for path, body in (("/api/biz/v1/project/save", {"kind": "canvas", "name": "bad", "data": {}}),
                           ("/api/biz/v1/asset/trash", {"ids": ["x"]})):
            self.assertEqual(self.client.post(path, json=body).status_code, 401)

    @classmethod
    def tearDownClass(cls):
        async def close():
            for module in (main.auth, main.wallet, main.team, main.userconfig, sys.modules["taskstore"]):
                connection = getattr(module._local, "conn", None)
                if connection:
                    connection.close()
                    module._local.conn = None
        cls.client.portal.call(close)
        cls.client.__exit__(None, None, None)
        asyncio.run(close())
        folder.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
