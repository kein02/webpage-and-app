"""登录 + 多用户鉴权：注册/登录 → JWT，用户级数据隔离。
- 用户表存 SQLite（username 唯一，密码 SHA256+salt 哈希）
- 生成类接口读 Authorization: Bearer <jwt>，没登录也能用（anon 兜底）
- 积分/团队/素材按 user_id 隔离
"""
import os, time, uuid, hashlib, secrets, sqlite3, threading, functools
import jwt

DB_PATH = os.environ.get("DREAMCRAFT_DB",
                        os.path.join(os.path.dirname(__file__), "dreamcraft.db"))
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    secret_path = os.path.join(os.path.dirname(DB_PATH), ".jwt-secret")
    os.makedirs(os.path.dirname(secret_path), exist_ok=True)
    try:
        with open(secret_path, "x", encoding="ascii") as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    with open(secret_path, encoding="ascii") as f:
        JWT_SECRET = f.read().strip()
JWT_ALG = "HS256"
TOKEN_TTL = 7 * 86400  # 7 天

_local = threading.local()


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE, pass_hash TEXT,
            salt TEXT, created_at INTEGER);
        """)
        c.commit()
        _local.conn = c
    return _local.conn


def _hash(pw: str, salt: str) -> str:
    return "pbkdf2$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 600000).hex()


def register(username: str, password: str) -> dict:
    username = username.strip()
    if len(username) < 2:
        raise ValueError("用户名至少 2 个字符")
    if len(password) < 6:
        raise ValueError("密码至少 6 位")
    if len(username) > 64 or len(password) > 256:
        raise ValueError('用户名或密码过长')
    c = _conn()
    uid = uuid.uuid4().hex
    salt = secrets.token_hex(8)
    try:
        c.execute("INSERT INTO users VALUES (?,?,?,?,?)",
                  (uid, username, _hash(password, salt), salt, int(time.time())))
        c.commit()
    except sqlite3.IntegrityError:
        c.rollback()   # 释放失败的写事务，否则写锁不释放
        raise ValueError("用户名已存在")
    # 新用户送 FREE_CREDIT 积分（幂等：钱包已存在则不重复发）
    import wallet
    wallet.grant_signup(uid)
    return {**login(username, password), "balance": wallet.get_balance(uid)}


def login(username: str, password: str) -> dict:
    if len(username) > 64 or len(password) > 256:
        raise ValueError('用户名或密码过长')
    c = _conn()
    r = c.execute("SELECT * FROM users WHERE username=?", (username.strip(),)).fetchone()
    expected = (_hash(password, r["salt"]) if r and r["pass_hash"].startswith("pbkdf2$")
                else hashlib.sha256(f"{r['salt']}:{password}".encode()).hexdigest() if r else "")
    if not r or not secrets.compare_digest(expected, r["pass_hash"]):
        raise ValueError("用户名或密码错误")
    if not r["pass_hash"].startswith("pbkdf2$"):
        c.execute("UPDATE users SET pass_hash=? WHERE id=?", (_hash(password, r["salt"]), r["id"]))
        c.commit()
    token = jwt.encode(
        {"uid": r["id"], "username": r["username"], "exp": int(time.time()) + TOKEN_TTL},
        JWT_SECRET, algorithm=JWT_ALG)
    return {"token": token, "user_id": r["id"], "username": r["username"]}


def get_user(uid: str) -> dict:
    c = _conn()
    r = c.execute("SELECT id, username, created_at FROM users WHERE id=?", (uid,)).fetchone()
    return dict(r) if r else None


def verify(token: str) -> str:
    """JWT → user_id；无效/过期返回 None。"""
    try:
        d = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return d.get("uid") if d.get('purpose') is None else None
    except jwt.PyJWTError:
        return None


def media_token(uid):
    return jwt.encode({'uid': uid, 'purpose': 'media', 'exp': int(time.time()) + 3600},
                      JWT_SECRET, algorithm=JWT_ALG)


def verify_media(token):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get('uid') if payload.get('purpose') == 'media' else None
    except jwt.PyJWTError:
        return None


def current_user(request) -> str:
    """FastAPI 依赖：从 Authorization 头取 user_id，没登录返回 'anon'。"""
    h = request.headers.get("Authorization", "")
    if h.startswith("Bearer "):
        uid = verify(h[7:])
        if uid and get_user(uid):
            return uid
        from fastapi import HTTPException
        raise HTTPException(401, "登录已失效，请重新登录")
    return "anon"


def require_user(request) -> str:
    """要求登录的接口用这个；没登录抛 401。"""
    uid = current_user(request)
    if uid == "anon":
        from fastapi import HTTPException
        raise HTTPException(401, "请先登录")
    return uid


class _401(Exception):
    def __init__(self):
        self.detail = "请先登录"
