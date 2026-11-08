"""用户级引擎配置：每个人可自填 Agnes API key 或 ComfyUI 地址。
   表 user_engine_config(owner, agnes_key, agnes_root, comfyui_url, default_engine)。
   生成时按 owner 取配置：有自填 key 走自己的 Agnes；配了 ComfyUI 走那个 ComfyUI；
   都没配则退回全局 provider（服务器默认引擎）。
"""
import os, time, sqlite3, threading
from cryptography.fernet import Fernet


def _cipher():
    key = os.environ.get('DREAMCRAFT_CONFIG_KEY')
    if not key:
        path = os.path.join(os.path.dirname(DB_PATH), '.engine-key')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'wb') as output:
                output.write(Fernet.generate_key())
        with open(path, 'rb') as source:
            key = source.read().strip()
    return Fernet(key)


def _encrypt(value):
    return 'fernet:' + _cipher().encrypt(value.encode()).decode() if value else None


def _decrypt(value):
    return _cipher().decrypt(value[7:].encode()).decode() if value and value.startswith('fernet:') else value

DB_PATH = os.environ.get("DREAMCRAFT_DB",
                         os.path.join(os.path.dirname(__file__), "dreamcraft.db"))
_local = threading.local()


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS user_engine_config (
            owner TEXT PRIMARY KEY,
            agnes_key TEXT, agnes_root TEXT,
            comfyui_url TEXT, default_engine TEXT,
            updated_at INTEGER);
        """)
        # 视频平台配置（独立列，兼容老库）
        cols = {r[1] for r in c.execute("PRAGMA table_info(user_engine_config)")}
        for col in ("video_platform", "video_key", "video_base", "video_model"):
            if col not in cols:
                c.execute(f"ALTER TABLE user_engine_config ADD COLUMN {col} TEXT")
        for row in c.execute('SELECT owner, agnes_key, video_key FROM user_engine_config').fetchall():
            for field in ('agnes_key', 'video_key'):
                if row[field] and not row[field].startswith('fernet:'):
                    c.execute(f'UPDATE user_engine_config SET {field}=? WHERE owner=?',
                              (_encrypt(row[field]), row['owner']))
        c.commit()
        _local.conn = c
    return _local.conn


def get(owner: str) -> dict:
    c = _conn()
    r = c.execute("SELECT * FROM user_engine_config WHERE owner=?", (owner,)).fetchone()
    if not r:
        return {"owner": owner, "agnes_key": None, "agnes_root": None,
                "comfyui_url": None, "default_engine": None,
                "video_platform": None, "video_key": None,
                "video_base": None, "video_model": None}
    result = dict(r)
    for field in ('agnes_key', 'video_key'):
        result[field] = _decrypt(result[field])
    return result


def save(owner: str, agnes_key: str = None, agnes_root: str = None,
         comfyui_url: str = None, default_engine: str = None,
         video_platform: str = None, video_key: str = None,
         video_base: str = None, video_model: str = None) -> dict:
    c = _conn()
    cur = get(owner) if c.execute('SELECT 1 FROM user_engine_config WHERE owner=?', (owner,)).fetchone() else None
    # 显式传值（含空串=清除）就覆盖；None（没传）保留旧值
    if cur:
        agnes_key = cur["agnes_key"] if agnes_key is None else agnes_key
        agnes_root = cur["agnes_root"] if agnes_root is None else agnes_root
        comfyui_url = cur["comfyui_url"] if comfyui_url is None else comfyui_url
        default_engine = cur["default_engine"] if default_engine is None else default_engine
        video_platform = cur["video_platform"] if video_platform is None else video_platform
        video_key = cur["video_key"] if video_key is None else video_key
        video_base = cur["video_base"] if video_base is None else video_base
        video_model = cur["video_model"] if video_model is None else video_model
    # 空串归一为 NULL，避免残留
    agnes_key = agnes_key or None
    agnes_root = agnes_root or None
    comfyui_url = comfyui_url or None
    default_engine = default_engine or None
    video_platform = video_platform or None
    video_key = video_key or None
    video_base = video_base or None
    video_model = video_model or None
    c.execute("""
        INSERT INTO user_engine_config(owner, agnes_key, agnes_root, comfyui_url,
                                       default_engine, video_platform, video_key,
                                       video_base, video_model, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(owner) DO UPDATE SET
            agnes_key=excluded.agnes_key,
            agnes_root=excluded.agnes_root,
            comfyui_url=excluded.comfyui_url,
            default_engine=excluded.default_engine,
            video_platform=excluded.video_platform,
            video_key=excluded.video_key,
            video_base=excluded.video_base,
            video_model=excluded.video_model,
            updated_at=excluded.updated_at
    """, (owner, _encrypt(agnes_key), agnes_root, comfyui_url, default_engine,
          video_platform, _encrypt(video_key), video_base, video_model, int(time.time())))
    c.commit()
    return get(owner)
