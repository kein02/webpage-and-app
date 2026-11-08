"""Agnes 文本模型 chat 辅助（OpenAI 兼容）。"""
import json, os, urllib.request, asyncio, functools

# 复用 providers 里的根/密钥（避免重复解析）
try:
    from providers import AGNES_ROOT, AGNES_KEY
except ImportError:
    AGNES_ROOT = os.environ.get("AGNES_API_ROOT", "https://api.agnes-ai.cn")
    AGNES_KEY = os.environ.get("AGNES_API_KEY")

AGENT_MODEL = os.environ.get("AGNES_AGENT_MODEL", "agnes-3.0-flash")


def _chat_sync(messages, max_tokens=512):
    body = json.dumps({"model": AGENT_MODEL, "messages": messages,
                       "max_tokens": max_tokens}).encode()
    req = urllib.request.Request(
        AGNES_ROOT + "/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {AGNES_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


async def chat(messages, max_tokens=512) -> str:
    """OpenAI 兼容 chat，返回 assistant 文本。"""
    loop = asyncio.get_event_loop()
    d = await loop.run_in_executor(
        None, functools.partial(_chat_sync, messages, max_tokens))
    return d["choices"][0]["message"]["content"]
