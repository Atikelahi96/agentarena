"""Judges: the model behind the alignment monitor and the content scanner.

`openai_judge` works with any OpenAI-compatible endpoint: Meta Model API (Muse Spark), or a partner
host / your own server running open-weight Muse Spark Open, so guarded data can stay on your infra.
"""

from __future__ import annotations

from typing import Any, Callable

from openai import AsyncOpenAI

from agentshield.types import Judge, JudgeRequest


def openai_judge(client: AsyncOpenAI, model: str, *, reasoning_effort: str | None = None,
                 on_usage: Callable[[dict[str, int]], None] | None = None, max_tokens: int = 2048) -> Judge:
    async def judge(request: JudgeRequest) -> str:
        if request.image_url:
            # Vision transcription: read the image. Minimal reasoning so the token budget goes to the
            # transcription, not chain-of-thought (Muse Spark otherwise spends it all thinking).
            user_content: Any = [
                {"type": "image_url", "image_url": {"url": request.image_url}},
                {"type": "text", "text": request.user},
            ]
            effort = "minimal"
        else:
            user_content = request.user
            effort = reasoning_effort
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": user_content}],
            "max_tokens": max_tokens,
        }
        if effort:
            kwargs["extra_body"] = {"reasoning_effort": effort}
        resp = await client.chat.completions.create(**kwargs)
        if on_usage and resp.usage is not None:
            on_usage({"prompt_tokens": resp.usage.prompt_tokens or 0, "completion_tokens": resp.usage.completion_tokens or 0,
                      "total_tokens": resp.usage.total_tokens or 0})
        if not resp.choices:
            return ""
        return resp.choices[0].message.content or ""

    return judge


def muse_judge(api_key: str, model: str = "muse-spark-1.3", base_url: str = "https://api.meta.ai/v1", **kw: Any) -> Judge:
    return openai_judge(AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=60, max_retries=2), model, **kw)
