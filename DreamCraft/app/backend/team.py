# 团队管理：SQLite team/member 表，角色/席位/套餐升级。
import os, uuid, time, threading, sqlite3

DB_PATH = os.environ.get("DREAMCRAFT_DB",
                         os.path.join(os.path.dirname(__file__), "dreamcraft.db"))
_local = threading.local()

ROLES = ["owner", "admin", "editor", "viewer"]
SEAT_LIMITS = {"free": 1, "pro": 5, "team": 50}
PLANS = ["free", "pro", "team"]


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS team (
            id TEXT PRIMARY KEY, name TEXT, owner TEXT, plan TEXT DEFAULT 'free',
            created_at INTEGER);
        CREATE TABLE IF NOT EXISTS member (
            id TEXT PRIMARY KEY, team_id TEXT, name TEXT, email TEXT,
            role TEXT DEFAULT 'viewer', joined_at INTEGER);
        """)
        c.commit()
        _local.conn = c
    return _local.conn


def create_team(name, owner, plan="free"):
    if plan not in PLANS or not name.strip():
        raise ValueError("请输入团队名称并选择有效套餐")
    c = _conn()
    tid = uuid.uuid4().hex
    c.execute("INSERT INTO team VALUES (?,?,?,?,?)", (tid, name, owner, plan, int(time.time())))
    c.execute("INSERT INTO member VALUES (?,?,?,?,?,?)",
              (uuid.uuid4().hex, tid, owner, owner + "@dreamcraft", "owner", int(time.time())))
    c.commit()
    return tid


def list_teams(owner="anon"):
    c = _conn()
    rows = c.execute("SELECT * FROM team WHERE owner=? ORDER BY created_at DESC", (owner,)).fetchall()
    return [dict(r) for r in rows]


def get_team(tid):
    c = _conn()
    r = c.execute("SELECT * FROM team WHERE id=?", (tid,)).fetchone()
    t = dict(r) if r else None
    if t:
        t["members"] = [dict(m) for m in c.execute(
            "SELECT * FROM member WHERE team_id=? ORDER BY joined_at", (tid,))]
    return t


def set_plan(tid, plan):
    """升级/降级套餐，席位上限随之变化。"""
    if plan not in PLANS:
        raise ValueError(f"plan must be one of {PLANS}")
    c = _conn()
    t = get_team(tid)
    if not t:
        raise ValueError("team not found")
    if len(t["members"]) > SEAT_LIMITS[plan]:
        raise ValueError("成员数量超过新套餐席位，请先移除成员")
    c.execute("UPDATE team SET plan=? WHERE id=?", (plan, tid))
    c.commit()


def add_member(tid, name, email, role="viewer"):
    if role not in ROLES or role == "owner" or not name.strip():
        raise ValueError("成员名称或角色无效")
    c = _conn()
    try:
        c.execute('BEGIN IMMEDIATE')
        t = c.execute("SELECT plan FROM team WHERE id=?", (tid,)).fetchone()
        if not t:
            raise ValueError("team not found")
        limit = SEAT_LIMITS.get(t["plan"], 1)
        cur = c.execute("SELECT COUNT(*) n FROM member WHERE team_id=?", (tid,)).fetchone()["n"]
        if cur >= limit:
            raise ValueError(f"席位已满（{t['plan']} 限 {limit} 人），请升级套餐")
        mid = uuid.uuid4().hex
        c.execute("INSERT INTO member VALUES (?,?,?,?,?,?)",
                  (mid, tid, name.strip(), email, role, int(time.time())))
        c.commit()
        return mid
    except Exception:
        c.rollback()
        raise


def set_role(tid, member_id, role):
    if role not in ROLES or role == "owner":
        raise ValueError(f"role must be one of {ROLES}")
    c = _conn()
    member = c.execute("SELECT role FROM member WHERE id=? AND team_id=?", (member_id, tid)).fetchone()
    if not member or member["role"] == "owner":
        raise ValueError("无法修改所有者或不存在的成员")
    c.execute("UPDATE member SET role=? WHERE id=? AND team_id=?", (role, member_id, tid))
    c.commit()


def remove_member(tid, member_id):
    c = _conn()
    member = c.execute("SELECT role FROM member WHERE id=? AND team_id=?", (member_id, tid)).fetchone()
    if not member or member["role"] == "owner":
        raise ValueError("无法移除所有者或不存在的成员")
    c.execute("DELETE FROM member WHERE id=? AND team_id=?", (member_id, tid))
    c.commit()
