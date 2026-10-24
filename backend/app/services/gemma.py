"""Single entry point for every Gemma call.

The rest of the app only uses:
    generate_text(prompt, images)        -> str
    generate_json(prompt, Schema, images) -> Schema instance (validated)
    health()                              -> dict

Switch providers with AI_PROVIDER=google|ollama in .env.
"""

import asyncio
import base64
import json
import re
from typing import Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

T = TypeVar("T", bound=BaseModel)


class GemmaError(Exception):
    """Raised when the model can't be reached or returns unusable output."""


def _mime_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class Provider(Protocol):
    name: str
    model: str

    async def generate(self, prompt: str, images: list[bytes], json_mode: bool) -> str: ...

    async def health(self) -> dict: ...


class GoogleAIStudio:
    name = "google"
    base_url = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, api_key: str, model: str, timeout: float, thinking_level: str = ""):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.thinking_level = thinking_level

    def _headers(self) -> dict:
        return {"x-goog-api-key": self.api_key}

    async def generate(self, prompt: str, images: list[bytes], json_mode: bool) -> str:
        if not self.api_key:
            raise GemmaError("GOOGLE_API_KEY is not set in backend/.env")
        parts: list[dict] = [{"text": prompt}]
        for img in images:
            parts.append({"inline_data": {"mime_type": _mime_type(img), "data": _b64(img)}})
        # Gemma on AI Studio doesn't support JSON mode, so json_mode is handled by the prompt.
        config: dict = {"temperature": 0.1}
        if self.thinking_level:
            config["thinkingConfig"] = {"thinkingLevel": self.thinking_level}
        body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
        url = f"{self.base_url}/models/{self.model}:generateContent"

        max_attempts = 3
        backoff = 2.0
        res = None
        for attempt in range(max_attempts):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    res = await client.post(url, json=body, headers=self._headers())
            except httpx.HTTPError as e:
                if attempt == max_attempts - 1:
                    raise GemmaError(f"Could not reach Google AI Studio: {e}") from e
                await asyncio.sleep(backoff)
                backoff *= 1.5
                continue

            if res.status_code == 429:
                if attempt == max_attempts - 1:
                    raise GemmaError(f"Google AI Studio quota / rate limit (429): {res.text[:300]}")
                await asyncio.sleep(backoff)
                backoff *= 2.0
                continue

            # AI Studio returns occasional transient 5xx ("Internal error encountered"); retry those too
            if res.status_code in (500, 502, 503, 504) and attempt < max_attempts - 1:
                await asyncio.sleep(backoff)
                backoff *= 1.5
                continue

            if res.status_code != 200:
                raise GemmaError(f"Google AI Studio error {res.status_code}: {res.text[:300]}")
            break

        if not res or res.status_code != 200:
            raise GemmaError("Failed to get response from Google AI Studio")

        try:
            parts_out = res.json()["candidates"][0]["content"]["parts"]
            # Gemma 4 also returns its reasoning as parts marked "thought": true; keep only the answer
            return "".join(p.get("text", "") for p in parts_out if not p.get("thought"))
        except (KeyError, IndexError) as e:
            raise GemmaError(f"Unexpected response from Google AI Studio: {res.text[:300]}") from e

    async def health(self) -> dict:
        if not self.api_key:
            return {"ok": False, "detail": "GOOGLE_API_KEY is not set"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(f"{self.base_url}/models/{self.model}", headers=self._headers())
        except httpx.HTTPError as e:
            return {"ok": False, "detail": f"Could not reach Google AI Studio: {e}"}
        if res.status_code == 200:
            return {"ok": True, "detail": "model available"}
        return {"ok": False, "detail": f"HTTP {res.status_code}: {res.text[:200]}"}


class Ollama:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def generate(self, prompt: str, images: list[bytes], json_mode: bool) -> str:
        body: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1},
        }
        if images:
            body["images"] = [_b64(img) for img in images]
        if json_mode:
            body["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(f"{self.base_url}/api/generate", json=body)
        except httpx.HTTPError as e:
            raise GemmaError(f"Could not reach Ollama at {self.base_url}: {e}") from e
        if res.status_code != 200:
            raise GemmaError(f"Ollama error {res.status_code}: {res.text[:300]}")
        return res.json().get("response", "")

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                res = await client.get(f"{self.base_url}/api/tags")
        except httpx.HTTPError as e:
            return {"ok": False, "detail": f"Could not reach Ollama at {self.base_url}: {e}"}
        names = [m.get("name", "") for m in res.json().get("models", [])]
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        if wanted in names:
            return {"ok": True, "detail": "model available"}
        return {"ok": False, "detail": f"Model '{self.model}' not pulled. Run: ollama pull {self.model}"}


def get_provider() -> Provider:
    s = get_settings()
    if s.ai_provider == "ollama":
        return Ollama(s.ollama_base_url, s.ollama_model, s.ai_timeout_seconds)
    return GoogleAIStudio(s.google_api_key, s.google_model, s.ai_timeout_seconds, s.google_thinking_level)


def _extract_json(text: str) -> str:
    """Pull the JSON object/array out of a reply that may have ```json fences or chatter."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
    if not starts:
        return text.strip()
    start = min(starts)
    end = max(text.rfind("}"), text.rfind("]"))
    return _fix_invalid_escapes(text[start : end + 1])


def _fix_invalid_escapes(text: str) -> str:
    """Models sometimes escape characters JSON doesn't allow escaping ("ch\\+tel", "\\—").
    Keep valid escapes (\\n, \\", \\\\, \\u0930 …) as they are; make other backslashes literal."""
    def fix(m: re.Match) -> str:
        esc = m.group(1)
        valid = esc in '"\\/bfnrt' or re.fullmatch(r"u[0-9a-fA-F]{4}", esc)
        return m.group(0) if valid else "\\\\" + esc

    # \uXXXX needs exactly 4 hex digits; "\u092" (cut short) becomes literal text instead of breaking the reply
    return re.sub(r'\\(u[0-9a-fA-F]{4}|.)', fix, text, flags=re.DOTALL)


async def generate_text(prompt: str, images: list[bytes] | None = None) -> str:
    return await get_provider().generate(prompt, images or [], json_mode=False)


async def generate_json(prompt: str, schema: type[T], images: list[bytes] | None = None) -> T:
    """Ask for JSON matching `schema`. Retries once with the validation error, then raises GemmaError."""
    provider = get_provider()
    full_prompt = (
        f"{prompt}\n\n"
        "Reply with ONLY valid JSON (no markdown, no explanation) matching this JSON schema. "
        "Write Hindi/Marathi text directly as UTF-8 characters, never as \\u escapes:\n"
        f"{json.dumps(schema.model_json_schema(), ensure_ascii=False)}"
    )
    last_error = ""
    for attempt in range(2):
        attempt_prompt = full_prompt
        if attempt == 1:
            attempt_prompt += (
                f"\n\nYour previous reply was invalid: {last_error}\n"
                "Fix it and reply with ONLY the corrected JSON."
            )
        raw = await provider.generate(attempt_prompt, images or [], json_mode=True)
        try:
            return schema.model_validate_json(_extract_json(raw))
        except ValidationError as e:
            last_error = str(e)[:500]
    raise GemmaError(f"Model returned invalid JSON twice. Last error: {last_error}")


async def health(deep: bool = False) -> dict:
    """Check the provider is reachable. With deep=True, also run a tiny JSON generation."""
    provider = get_provider()
    result = {"provider": provider.name, "model": provider.model, **await provider.health()}
    if deep and result["ok"]:

        class Pong(BaseModel):
            reply: str

        try:
            pong = await generate_json('Return {"reply": "pong"}.', Pong)
            result["generation"] = pong.reply
        except GemmaError as e:
            result["ok"] = False
            result["detail"] = str(e)
    return result
