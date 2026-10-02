"""
Provider abstractions for the AI Jewellery Assistant. Deliberately two separate
interfaces (spec: "Separate IMAGE GENERATION/EDITING from TEXT/STRUCTURED METADATA
GENERATION") -- a shop may reasonably want a different model (or even a different
vendor) for "clean up this photo" versus "describe this photo in words," and bundling
them into one interface would make that impossible to configure independently.

Neither concrete implementation is wired to a real provider yet on purpose (spec:
"DO NOT ASK ME FOR THE REAL API KEY... build everything with placeholders"). Every call
site must catch `AIServiceNotConfiguredError` and turn it into a clean, user-facing
"AI service is not configured" message -- never a 500, never a stack trace.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional


class AIServiceNotConfiguredError(Exception):
    """Raised by a provider when AI_API_KEY (or a provider-specific equivalent) is
    empty. Always safe to show the resulting message to the customer verbatim."""

    def __init__(self, message: str = "AI service is not configured."):
        super().__init__(message)


class AIServiceError(Exception):
    """Raised for any real provider failure (timeout, rate limit, malformed response,
    non-2xx from the provider's API). The message is a safe, generic, user-facing one;
    the real cause is always logged separately by the caller, never included here."""


@dataclass
class ImageGenerationResult:
    image_bytes: bytes
    mime_type: str = "image/png"


@dataclass
class MetadataSuggestion:
    name: Optional[str] = None
    category_slug: Optional[str] = None
    size: Optional[str] = None
    style: Optional[str] = None
    material: Optional[str] = None
    stone: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.tags is None:
            self.tags = []


class ImageGenerationProvider(ABC):
    """Takes a raw jewellery photo -- which may show the jewellery alone, OR a person
    wearing it (face, hair, skin, clothes, hands, background all present) -- and returns
    a clean, isolated, white-background product photo of JUST the jewellery, never a
    redesign and never the person. See prompts.build_image_preparation_prompt for the
    exact instruction every implementation must send to its model."""

    @abstractmethod
    def prepare_catalogue_image(
        self, image_bytes: bytes, mime_type: str, *, category: str | None = None
    ) -> ImageGenerationResult:
        """`category` (e.g. "necklace") is an optional hint injected into the prompt
        when already known (e.g. a regenerate call after the customer has picked a
        category) -- omitted on the very first call, before any category exists yet.
        Raises AIServiceNotConfiguredError if no API key is set, or AIServiceError on
        any real provider failure (timeout, rate limit, malformed/empty response)."""
        raise NotImplementedError


class MetadataLLMProvider(ABC):
    """Takes a (prepared) jewellery photo and the catalogue's current category slugs,
    and returns suggested product metadata. Every field is a SUGGESTION the customer
    must be able to edit or reject -- never written to the catalogue DB directly by
    this provider."""

    @abstractmethod
    def suggest_metadata(
        self, image_bytes: bytes, mime_type: str, *, category_slugs: list[str]
    ) -> MetadataSuggestion:
        """Raises AIServiceNotConfiguredError if no API key is set, or AIServiceError on
        any real provider failure (timeout, rate limit, malformed/empty response)."""
        raise NotImplementedError

    @staticmethod
    def _coerce_json_response(raw: str) -> dict[str, Any]:
        """Shared, defensive JSON parsing every concrete provider can reuse: models
        occasionally wrap JSON in a markdown code fence even when explicitly told not
        to -- strip that before parsing rather than failing the whole suggestion over
        formatting. Raises AIServiceError (not a raw JSONDecodeError) on genuinely
        malformed output, per the "never expose raw errors" rule."""
        import json

        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AIServiceError("The AI service returned an unexpected response.") from exc
        if not isinstance(parsed, dict):
            raise AIServiceError("The AI service returned an unexpected response.")
        return parsed
