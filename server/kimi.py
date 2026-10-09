"""Small server-side adapter for source-grounded Kimi requirement candidates."""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class KimiError(Exception):
    pass


def model_name() -> str:
    return os.environ.get("MOONSHOT_MODEL", "kimi-k2.6").strip() or "kimi-k2.6"


def request_chat(messages: list[dict[str, str]], max_tokens: int) -> str:
    key = os.environ.get("MOONSHOT_API_KEY", "").strip()
    if not key:
        raise KimiError("服务端尚未配置 MOONSHOT_API_KEY")
    base = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1").rstrip("/")
    if not base.startswith("https://"):
        raise KimiError("模型接口必须使用 HTTPS")
    body = {
        "model": model_name(),
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": False,
    }
    request = Request(
        base + "/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            result = json.load(response)
    except HTTPError as error:
        raise KimiError(f"Kimi 接口返回 HTTP {error.code}；请检查 Key、模型和额度") from error
    except (URLError, TimeoutError) as error:
        raise KimiError("Kimi 连接失败或超时，请检查网络和接口地址") from error
    try:
        return result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise KimiError("模型未返回可读取的内容") from error


def test_connection() -> None:
    content = request_chat([{"role": "user", "content": "Reply with ok."}], 16)
    if not isinstance(content, str) or not content.strip():
        raise KimiError("模型连接成功但没有返回文本")


def extract_requirements(page_text: str, page: int) -> list[dict[str, str]]:
    if not page_text.strip():
        return []
    content = request_chat(
        [
            {"role": "system", "content": (
                "你是售前规格书要求提取助手。只从给定原文中提取明确的软件/BMS/DCOM监控要求；"
                "不判断满足性，不生成客户承诺。只返回 JSON 对象，格式为 "
                "{\"requirements\":[{\"quote\":\"原文连续片段\",\"requirement\":\"忠实整理的要求\"}]}。"
                "quote 必须逐字复制原文中连续出现的片段，不得改写；最多 12 条。无要求返回空数组。"
            )},
            {"role": "user", "content": f"第 {page} 页原文（本次最多读取前 12000 字符）：\n{page_text[:12000]}"},
        ], 3072,
    )
    try:
        if content.strip().startswith("```"):
            content = content.strip().split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(content)
        rows = parsed["requirements"]
        if not isinstance(rows, list):
            raise ValueError("not a list")
        return [row for row in rows[:12] if isinstance(row, dict)]
    except (KeyError, IndexError, TypeError, ValueError, AttributeError) as error:
        raise KimiError("模型未返回可解析的要求列表；本次没有写入候选") from error
