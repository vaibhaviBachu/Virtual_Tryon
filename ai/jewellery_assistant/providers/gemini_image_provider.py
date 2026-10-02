"""
Gemini ImageGenerationProvider, using the Gemini 2.5 Flash Image model (the
"image-editing" member of the Gemini family -- takes a photo + a text instruction and
returns an edited image in the same response, which is exactly this feature's shape:
"clean up this exact jewellery photo," not "generate something new from a text-only
prompt"). REST API, no Google SDK dependency (same house pattern as the OpenAI-
compatible providers -- plain httpx calls, nothing to add to requirements.txt).

Docs: https://ai.google.dev/gemini-api/docs/image-generation
"""
import base64
import logging

import httpx

from ai.jewellery_assistant.prompts import build_image_preparation_prompt
from ai.jewellery_assistant.providers.base import (
    AIServiceError,
    AIServiceNotConfiguredError,
    ImageGenerationProvider,
    ImageGenerationResult,
)

logger = logging.getLogger("ai.jewellery_assistant.gemini_image_provider")

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
REQUEST_TIMEOUT_SECONDS = 60.0


class GeminiImageProvider(ImageGenerationProvider):
    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def prepare_catalogue_image(
        self, image_bytes: bytes, mime_type: str, *, category: str | None = None
    ) -> ImageGenerationResult:
        if not self._api_key:
            raise AIServiceNotConfiguredError(
                "AI service is not configured. Add GEMINI_API_KEY to enable AI-assisted "
                "photo cleanup -- the deterministic preview still works without it."
            )
        if not self._model:
            raise AIServiceNotConfiguredError("AI service is not configured. AI_IMAGE_MODEL is empty.")

        b64_input = base64.b64encode(image_bytes).decode("ascii")
        try:
            response = httpx.post(
                f"{BASE_URL}/models/{self._model}:generateContent",
                headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
                json={
                    "contents": [
                        {
                            "parts": [
                                {"text": build_image_preparation_prompt(category)},
                                {"inline_data": {"mime_type": mime_type, "data": b64_input}},
                            ]
                        }
                    ]
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise AIServiceError("The AI image service timed out. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise AIServiceError("The AI image service is temporarily unavailable.") from exc

        if response.status_code == 429:
            raise AIServiceError("The AI image service is rate-limited right now. Please try again shortly.")
        if response.status_code >= 400:
            logger.warning(
                "Gemini image provider returned an error",
                extra={"extra_fields": {"status_code": response.status_code, "body": response.text[:500]}},
            )
            raise AIServiceError("The AI image service could not process this photo.")

        try:
            payload = response.json()
            parts = payload["candidates"][0]["content"]["parts"]
            image_part = next(p for p in parts if "inlineData" in p or "inline_data" in p)
            inline = image_part.get("inlineData") or image_part.get("inline_data")
            b64_output = inline["data"]
            output_mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
        except (KeyError, IndexError, StopIteration, ValueError) as exc:
            raise AIServiceError("The AI image service returned an unexpected response.") from exc

        try:
            decoded = base64.b64decode(b64_output)
        except Exception as exc:
            raise AIServiceError("The AI image service returned an unexpected response.") from exc

        return ImageGenerationResult(image_bytes=decoded, mime_type=output_mime)
