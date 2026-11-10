"""素材 + 商业化：SQLite 持久化（素材库、积分余额、扣费记录、订阅状态）。
表：
  assets(id, url, kind, prompt, task_id, owner, created_at)
  wallet(owner, balance, version)          -- 积分
  ledger(id, owner, delta, reason, task_id, created_at)
  subscription(owner, plan, expires_at)
"""
import sqlite3, os, time, uuid, threading, json

DB_PATH = os.environ.get("DREAMCRAFT_DB",
                         os.path.join(os.path.dirname(__file__), "dreamcraft.db"))
_local = threading.local()

# 生成定价（积分）：与 Agnes usage 对应
COST = {"image": 1, "video": 10, "agent": 5}
FREE_CREDIT = 100          # 新用户赠送
SUBSCRIPTIONS = {
    "free":  {"price": 0, "daily": 0},
    "pro":   {"price": 49, "daily": 100},
    "team":  {"price": 999, "daily": 2000},
}


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY, url TEXT, kind TEXT, prompt TEXT,
            task_id TEXT, owner TEXT DEFAULT 'anon', created_at INTEGER);
        CREATE TABLE IF NOT EXISTS wallet (
            owner TEXT PRIMARY KEY, balance INTEGER NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS ledger (
            id TEXT PRIMARY KEY, owner TEXT, delta INTEGER, reason TEXT,
            task_id TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS subscription (
            owner TEXT PRIMARY KEY, plan TEXT, expires_at INTEGER);
        """)
        columns = {r[1] for r in c.execute("PRAGMA table_info(assets)")}
        for name, definition in (("name", "TEXT DEFAULT ''"), ("tags", "TEXT DEFAULT '[]'"),
                                 ("deleted_at", "INTEGER")):
            if name not in columns:
                c.execute(f"ALTER TABLE assets ADD COLUMN {name} {definition}")
        c.commit()
        _local.conn = c
    return _local.conn


# ---------------- 素材 ----------------
def add_asset(url, kind="image", prompt="", task_id="", owner="anon"):
    c = _conn()
    aid = uuid.uuid4().hex
    c.execute("INSERT INTO assets(id,url,kind,prompt,task_id,owner,created_at) VALUES (?,?,?,?,?,?,?)",
              (aid, url, kind, prompt, task_id, owner, int(time.time())))
    c.commit()
    return aid


def _asset_filter(owner, kind, query, tag, trash):
    return ("(? IS NULL OR owner=?) AND (? IS NULL OR kind=?) "
            "AND deleted_at IS " + ("NOT NULL" if trash else "NULL") +
            " AND (?='' OR instr(lower(name || ' ' || prompt || ' ' || tags),lower(?))>0) "
            "AND (?='' OR EXISTS (SELECT 1 FROM json_each(assets.tags) WHERE value=?))",
            (owner, owner, kind, kind, query, query, tag, tag))


def list_assets(limit=60, owner=None, kind=None, offset=0, query="", tag="", trash=False):
    c = _conn()
    where, params = _asset_filter(owner, kind, query, tag, trash)
    rows = c.execute(f"SELECT * FROM assets WHERE {where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
                     (*params, limit, offset)).fetchall()
    return [{**dict(r), "tags": json.loads(r["tags"] or "[]")} for r in rows]


def count_assets(owner, kind=None, query="", tag="", trash=False):
    where, params = _asset_filter(owner, kind, query, tag, trash)
    return _conn().execute(f"SELECT COUNT(*) FROM assets WHERE {where}", params).fetchone()[0]


def get_asset(asset_id, owner):
    row = _conn().execute("SELECT * FROM assets WHERE id=? AND owner=?", (asset_id, owner)).fetchone()
    return dict(row) if row else None


def edit_asset(asset_id, owner, name, tags):
    c = _conn()
    with c:
        return c.execute("UPDATE assets SET name=?,tags=? WHERE id=? AND owner=? AND deleted_at IS NULL",
                         (name, json.dumps(tags, ensure_ascii=False), asset_id, owner)).rowcount > 0


def trash_assets(ids, owner, restore=False):
    c = _conn()
    with c:
        placeholders = ",".join("?" for _ in ids)
        count = c.execute(f"SELECT COUNT(*) FROM assets WHERE id IN ({placeholders}) AND owner=?",
                          (*ids, owner)).fetchone()[0]
        if count != len(ids):
            raise LookupError("部分素材不存在或无权访问")
        c.execute(f"UPDATE assets SET deleted_at=? WHERE id IN ({placeholders}) AND owner=?",
                   (None if restore else int(time.time()), *ids, owner))


def owns_asset(url, owner):
    return bool(_conn().execute('SELECT 1 FROM assets WHERE url=? AND owner=? LIMIT 1',
                                (url, owner)).fetchone())


def finish_video(task_id, owner, prompt, result):
    c = _conn()
    with c:
        row = c.execute("SELECT status FROM tasks WHERE id=? AND owner=?", (task_id, owner)).fetchone()
        if not row or row["status"] == "succeed":
            return
        for item in result["results"]:
            c.execute("INSERT INTO assets(id,url,kind,prompt,task_id,owner,created_at) VALUES (?,?,?,?,?,?,?)",
                      (uuid.uuid4().hex, item["url"], "video", prompt, task_id, owner, int(time.time())))
        c.execute("UPDATE tasks SET status='succeed',result=?,error=NULL,finished_at=? WHERE id=? AND owner=?",
                  (json.dumps(result, ensure_ascii=False), int(time.time()), task_id, owner))


# ---------------- 钱包 ----------------
def get_balance(owner="anon") -> int:
    c = _conn()
    r = c.execute("SELECT balance FROM wallet WHERE owner=?", (owner,)).fetchone()
    return r["balance"] if r else FREE_CREDIT


def charge(owner, amount, reason, task_id="") -> bool:
    """扣费；余额不足返回 False（不扣）。
    注意：写事务必须 commit 或 rollback 收尾，否则 SQLite 写锁不会释放。"""
    c = _conn()
    try:
        c.execute("INSERT INTO wallet(owner,balance,version) VALUES (?,?,?) ON CONFLICT(owner) DO NOTHING",
                  (owner, FREE_CREDIT, 0))
        if amount <= 0:
            raise ValueError("amount must be positive")
        cur = c.execute("UPDATE wallet SET balance=balance-?, version=version+1 WHERE owner=? AND balance>=?", (amount, owner, amount))
        if not cur.rowcount:
            c.rollback()
            return False
        c.execute("INSERT INTO ledger VALUES (?,?,?,?,?,?)",
                  (uuid.uuid4().hex, owner, -amount, reason, task_id, int(time.time())))
        c.commit()
        return True
    except Exception:
        c.rollback()
        raise


def grant_signup(owner) -> int:
    """新用户建钱包并发 FREE_CREDIT 积分（只发一次）。
    直接建余额 = FREE_CREDIT，避免 refund() 的"先垫 100 再加 100"重复赠送。"""
    c = _conn()
    try:
        cur = c.execute(
            "INSERT INTO wallet(owner,balance,version) VALUES (?,?,0) ON CONFLICT(owner) DO NOTHING",
            (owner, FREE_CREDIT))
        if cur.rowcount:  # 本次真的新建了钱包
            c.execute("INSERT INTO ledger VALUES (?,?,?,?,?,?)",
                      (uuid.uuid4().hex, owner, FREE_CREDIT, "新用户赠送", "", int(time.time())))
        c.commit()
        return get_balance(owner)
    except Exception:
        c.rollback()
        raise


def refund(owner, amount, reason, task_id=""):
    c = _conn()
    if amount <= 0:
        raise ValueError('amount must be positive')
    try:
        c.execute('BEGIN IMMEDIATE')
        if task_id and c.execute('SELECT 1 FROM ledger WHERE owner=? AND task_id=? AND delta>0', (owner, task_id)).fetchone():
            c.rollback()
            return
        c.execute("INSERT INTO wallet(owner,balance,version) VALUES (?,?,?) ON CONFLICT(owner) DO NOTHING",
                  (owner, FREE_CREDIT, 0))
        c.execute("UPDATE wallet SET balance=balance+?, version=version+1 WHERE owner=?",
                  (amount, owner))
        c.execute("INSERT INTO ledger VALUES (?,?,?,?,?,?)",
                  (uuid.uuid4().hex, owner, amount, reason, task_id, int(time.time())))
        c.commit()
    except Exception:
        c.rollback()
        raise


def ledger(owner="anon", limit=50):
    c = _conn()
    rows = c.execute("SELECT * FROM ledger WHERE owner=? ORDER BY created_at DESC LIMIT ?",
                    (owner, limit)).fetchall()
    return [dict(r) for r in rows]


def refund_task(owner, task_id):
    amount = _conn().execute('SELECT -COALESCE(SUM(delta),0) FROM ledger WHERE owner=? AND task_id=?', (owner, task_id)).fetchone()[0]
    if amount > 0:
        refund(owner, amount, reason='refund:interrupted', task_id=task_id)


# ---------------- 订阅 ----------------
def get_subscription(owner="anon"):
    c = _conn()
    r = c.execute("SELECT * FROM subscription WHERE owner=?", (owner,)).fetchone()
    return dict(r) if r and r["expires_at"] > time.time() else {"owner": owner, "plan": "free", "expires_at": 0}


def subscribe(owner, plan, days=30):
    c = _conn()
    c.execute("INSERT OR REPLACE INTO subscription(owner,plan,expires_at) VALUES (?,?,?)",
              (owner, plan, int(time.time()) + days * 86400))
    c.commit()


# ---------------- 扣费门禁（生成前调用） ----------------
def can_afford(kind, owner="anon") -> bool:
    cost = COST.get(kind, 1)
    return get_balance(owner) >= cost


def charge_for(kind, owner="anon", task_id="", reason=""):
    return charge(owner, COST.get(kind, 1), reason or f"generate:{kind}", task_id)
