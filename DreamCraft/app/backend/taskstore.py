"""任务持久化：SQLite 存储，重启不丢。替代 main.py 里的内存 TASKS dict。"""
import sqlite3, json, os, threading, time

DB_PATH = os.environ.get("DREAMCRAFT_DB",
                         os.path.join(os.path.dirname(__file__), "dreamcraft.db"))
_local = threading.local()


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            kind TEXT,
            payload TEXT,
            status TEXT,
            result TEXT,
            error TEXT,
            created_at INTEGER,
            finished_at INTEGER
        )""")
        if "owner" not in {r[1] for r in c.execute("PRAGMA table_info(tasks)")}:
            c.execute("ALTER TABLE tasks ADD COLUMN owner TEXT DEFAULT 'anon'")
        columns = {r[1] for r in c.execute("PRAGMA table_info(tasks)")}
        for name in ("upstream", "retry_id"):
            if name not in columns:
                c.execute(f"ALTER TABLE tasks ADD COLUMN {name} TEXT")
        c.commit()
        _local.conn = c
    return _local.conn


class TaskStore:
    """与 main.TASKS 的 dict 用法对齐：create/update/get/list。"""

    def create(self, task_id, kind, payload, status="queued", owner="anon"):
        c = _conn()
        c.execute("INSERT OR REPLACE INTO tasks(id,kind,payload,status,result,error,created_at,finished_at,owner) VALUES (?,?,?,?,?,?,?,?,?)",
                  (task_id, kind, json.dumps(payload, ensure_ascii=False), status,
                   None, None, int(time.time()), None, owner))
        c.commit()

    def update(self, task_id, **fields):
        c = _conn()
        sets = []
        allowed = ("status", "result", "error", "finished_at", "upstream", "retry_id")
        for k in allowed:
            if k in fields:
                if k in ("result", "upstream"):
                    sets.append(f"{k}=?")
                    _v = json.dumps(fields[k], ensure_ascii=False) if not isinstance(fields[k], str) else fields[k]
                    fields[k] = _v
                else:
                    sets.append(f"{k}=?")
        if sets:
            c.execute(f"UPDATE tasks SET {','.join(sets)} WHERE id=?",
                      [fields[k] for k in allowed if k in fields] + [task_id])
            c.commit()

    def get(self, task_id, owner=None):
        c = _conn()
        r = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return _row(r) if r and (owner is None or r["owner"] == owner) else None

    def list(self, limit=50, owner=None):
        c = _conn()
        rows = c.execute("SELECT * FROM tasks WHERE (? IS NULL OR owner=?) ORDER BY created_at DESC, rowid DESC LIMIT ?", (owner, owner, limit)).fetchall()
        return [_row(r) for r in rows]

    def active(self):
        return [_row(r) for r in _conn().execute("SELECT * FROM tasks WHERE status IN ('queued','running')").fetchall()]


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in ("payload", "result", "upstream"):
        if d.get(k):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                pass
    return d


store = TaskStore()
