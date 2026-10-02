"""
OpenAI-compatible MetadataLLMProvider, using a vision-capable chat completion (image +
text in, structured JSON text out). Same "OpenAI-compatible" reasoning as
image_provider.py -- the /v1/chat/completions shape with an image_url content part is
shared across several vendors.
"""
import base64
import logging

import httpx

from ai.jewellery_assistant.prompts import METADATA_SUGGESTION_PROMPT_TEMPLATE
from ai.jewellery_assistant.providers.base import (
    AIServiceError,
    AIServiceNotConfiguredError,
    MetadataLLMProvider,
    MetadataSuggestion,
)

logger = logging.getLogger("ai.jewellery_assistant.metadata_provider")

DEFAULT_BASE_URL = "https://api.openai.com/v1"
REQUEST_TIMEOUT_SECONDS = 30.0


class OpenAICompatibleMetadataProvider(MetadataLLMProvider):
    def __init__(self, api_key: str, model: str, base_url: str = DEFAULT_BASE_URL):
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")

    def suggest_metadata(
        self, image_bytes: bytes, mime_type: str, *, category_slugs: list[str]
    ) -> MetadataSuggestion:
        if not self._api_key:
            raise AIServiceNotConfiguredError(
                "AI service is not configured. Add AI_API_KEY (and AI_TEXT_MODEL) to "
                "enable AI-suggested product details -- you can still fill these in "
                "yourself."
            )
        if not self._model:
            raise AIServiceNotConfiguredError("AI service is not configured. AI_TEXT_MODEL is empty.")

        data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        prompt = METADATA_SUGGESTION_PROMPT_TEMPLATE.format(category_slugs=", ".join(category_slugs))

        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": data_url}},
                            ],
                        }
                    ],
                    "temperature": 0.2,
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise AIServiceError("The AI metadata service timed out. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise AIServiceError("The AI metadata service is temporarily unavailable.") from exc

        if response.status_code == 429:
            raise AIServiceError("The AI metadata service is rate-limited right now. Please try again shortly.")
        if response.status_code >= 400:
            logger.warning(
                "Metadata provider returned an error",
                extra={"extra_fields": {"status_code": response.status_code}},
            )
            raise AIServiceError("The AI metadata service could not analyze this photo.")

        try:
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as exc:
            raise AIServiceError("The AI metadata service returned an unexpected response.") from exc

        parsed = self._coerce_json_response(content)
        tags = parsed.get("tags")
        return MetadataSuggestion(
            name=_as_str_or_none(parsed.get("name")),
            category_slug=_as_str_or_none(parsed.get("category_slug")),
            size=_as_str_or_none(parsed.get("size")),
            style=_as_str_or_none(parsed.get("style")),
            material=_as_str_or_none(parsed.get("material")),
            stone=_as_str_or_none(parsed.get("stone")),
            description=_as_str_or_none(parsed.get("description")),
            tags=[str(t) for t in tags] if isinstance(tags, list) else [],
        )


def _as_str_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
