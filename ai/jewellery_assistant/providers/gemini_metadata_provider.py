"""
Gemini MetadataLLMProvider -- same REST `generateContent` endpoint as
gemini_image_provider.py, but with a plain text-generation model (no image output
needed) and the structured-JSON metadata prompt instead of the image-prep one.
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

logger = logging.getLogger("ai.jewellery_assistant.gemini_metadata_provider")

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
REQUEST_TIMEOUT_SECONDS = 30.0


class GeminiMetadataProvider(MetadataLLMProvider):
    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def suggest_metadata(
        self, image_bytes: bytes, mime_type: str, *, category_slugs: list[str]
    ) -> MetadataSuggestion:
        if not self._api_key:
            raise AIServiceNotConfiguredError(
                "AI service is not configured. Add GEMINI_API_KEY to enable AI-suggested "
                "product details -- you can still fill these in yourself."
            )
        if not self._model:
            raise AIServiceNotConfiguredError("AI service is not configured. AI_TEXT_MODEL is empty.")

        b64_input = base64.b64encode(image_bytes).decode("ascii")
        prompt = METADATA_SUGGESTION_PROMPT_TEMPLATE.format(category_slugs=", ".join(category_slugs))

        try:
            response = httpx.post(
                f"{BASE_URL}/models/{self._model}:generateContent",
                headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
                json={
                    "contents": [
                        {
                            "parts": [
                                {"text": prompt},
                                {"inline_data": {"mime_type": mime_type, "data": b64_input}},
                            ]
                        }
                    ],
                    "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
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
                "Gemini metadata provider returned an error",
                extra={"extra_fields": {"status_code": response.status_code, "body": response.text[:500]}},
            )
            raise AIServiceError("The AI metadata service could not analyze this photo.")

        try:
            payload = response.json()
            content = payload["candidates"][0]["content"]["parts"][0]["text"]
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
