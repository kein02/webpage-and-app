"""Account-owned project documents with optimistic concurrency."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager


@contextmanager
def connection():
    conn = sqlite3.connect(os.environ["DREAMCRAFT_DB"], timeout=20)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("""CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
            name TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL,
            updated_at INTEGER NOT NULL)""")
        yield conn
    finally:
        conn.close()


def list_projects(owner, kind):
    with connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id,kind,name,revision,updated_at FROM projects WHERE owner=? AND kind=? ORDER BY updated_at DESC,rowid DESC",
            (owner, kind))]


def get_project(owner, project_id):
    with connection() as conn:
        row = conn.execute("SELECT * FROM projects WHERE owner=? AND id=?", (owner, project_id)).fetchone()
        if not row:
            return None
        result = dict(row)
        result.pop("owner")
        result["data"] = json.loads(result["data"])
        return result


def save_project(owner, project_id, kind, name, data, revision):
    encoded = json.dumps(data, ensure_ascii=False)
    with connection() as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT owner,kind,revision FROM projects WHERE id=?", (project_id,)).fetchone() if project_id else None
            if project_id and (not row or row["owner"] != owner):
                raise LookupError("项目不存在或无权访问")
            if row and (row["revision"] != revision or row["kind"] != kind):
                raise ValueError("项目已在其他窗口修改，请重新打开后再编辑")
            if not row and revision != 0:
                raise ValueError("新项目版本无效")
            if not row and conn.execute("SELECT COUNT(*) FROM projects WHERE owner=?", (owner,)).fetchone()[0] >= 500:
                raise ValueError("项目数量已达 500，请先清理旧项目")
            project_id = project_id or uuid.uuid4().hex
            revision += 1
            now = time.time_ns() // 1_000_000
            conn.execute("INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?,?)",
                         (project_id, owner, kind, name, encoded, revision, now))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {"id": project_id, "kind": kind, "name": name, "revision": revision, "updated_at": now}


def delete_project(owner, project_id):
    with connection() as conn:
        cursor = conn.execute("DELETE FROM projects WHERE owner=? AND id=?", (owner, project_id))
        conn.commit()
        return cursor.rowcount > 0
