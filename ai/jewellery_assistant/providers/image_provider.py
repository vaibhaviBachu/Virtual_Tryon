"""
OpenAI-compatible ImageGenerationProvider. "OpenAI-compatible" because several vendors
(OpenAI itself, OpenRouter, Azure OpenAI, and others) implement the same
`/v1/images/edits` multipart shape -- AI_IMAGE_PROVIDER/AI_IMAGE_MODEL/AI_API_KEY (and,
for a non-OpenAI base URL, AI_IMAGE_BASE_URL) select which one without needing a new
class per vendor. A genuinely different API shape would still warrant its own
ImageGenerationProvider subclass rather than contorting this one.
"""
import logging

import httpx

from ai.jewellery_assistant.prompts import build_image_preparation_prompt
from ai.jewellery_assistant.providers.base import (
    AIServiceError,
    AIServiceNotConfiguredError,
    ImageGenerationProvider,
    ImageGenerationResult,
)

logger = logging.getLogger("ai.jewellery_assistant.image_provider")

DEFAULT_BASE_URL = "https://api.openai.com/v1"
REQUEST_TIMEOUT_SECONDS = 60.0


class OpenAICompatibleImageProvider(ImageGenerationProvider):
    def __init__(self, api_key: str, model: str, base_url: str = DEFAULT_BASE_URL):
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")

    def prepare_catalogue_image(
        self, image_bytes: bytes, mime_type: str, *, category: str | None = None
    ) -> ImageGenerationResult:
        if not self._api_key:
            raise AIServiceNotConfiguredError(
                "AI service is not configured. Add AI_API_KEY (and AI_IMAGE_MODEL) to "
                "enable AI-assisted photo cleanup -- the deterministic preview still "
                "works without it."
            )
        if not self._model:
            raise AIServiceNotConfiguredError(
                "AI service is not configured. AI_IMAGE_MODEL is empty."
            )

        extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(mime_type, "png")
        try:
            response = httpx.post(
                f"{self._base_url}/images/edits",
                headers={"Authorization": f"Bearer {self._api_key}"},
                data={"model": self._model, "prompt": build_image_preparation_prompt(category)},
                files={"image": (f"upload.{extension}", image_bytes, mime_type)},
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
                "Image provider returned an error",
                extra={"extra_fields": {"status_code": response.status_code}},
            )
            raise AIServiceError("The AI image service could not process this photo.")

        try:
            payload = response.json()
            b64_image = payload["data"][0]["b64_json"]
        except (KeyError, IndexError, ValueError) as exc:
            raise AIServiceError("The AI image service returned an unexpected response.") from exc

        import base64

        try:
            decoded = base64.b64decode(b64_image)
        except Exception as exc:
            raise AIServiceError("The AI image service returned an unexpected response.") from exc

        return ImageGenerationResult(image_bytes=decoded, mime_type="image/png")
