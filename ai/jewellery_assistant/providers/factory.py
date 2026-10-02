"""
Provider selection, driven entirely by plain values passed in by the caller (never by
importing apps.api settings directly -- ai/ never imports from apps/api, matching the
existing one-directional import rule the rest of this package follows, e.g.
ai/preprocessing/image_validation.py). apps/api/v1/services/jewellery_ai_service.py is
the only call site, and it passes get_settings()'s AI_*/GEMINI_API_KEY values straight
through.

AI_IMAGE_PROVIDER/AI_TEXT_PROVIDER: "openai" (an OpenAI-compatible HTTP API) or
"gemini" (Google's Gemini API). Adding a genuinely different provider later means
adding a branch here and a new provider class, never changing the
ImageGenerationProvider/MetadataLLMProvider interface itself.
"""
from ai.jewellery_assistant.providers.base import ImageGenerationProvider, MetadataLLMProvider
from ai.jewellery_assistant.providers.gemini_image_provider import GeminiImageProvider
from ai.jewellery_assistant.providers.gemini_metadata_provider import GeminiMetadataProvider
from ai.jewellery_assistant.providers.image_provider import OpenAICompatibleImageProvider
from ai.jewellery_assistant.providers.metadata_provider import OpenAICompatibleMetadataProvider


def get_image_provider(*, provider_name: str, api_key: str, model: str) -> ImageGenerationProvider:
    if provider_name == "openai":
        return OpenAICompatibleImageProvider(api_key=api_key, model=model)
    if provider_name == "gemini":
        return GeminiImageProvider(api_key=api_key, model=model)
    raise ValueError(f"Unknown AI_IMAGE_PROVIDER: {provider_name!r}")


def get_metadata_provider(*, provider_name: str, api_key: str, model: str) -> MetadataLLMProvider:
    if provider_name == "openai":
        return OpenAICompatibleMetadataProvider(api_key=api_key, model=model)
    if provider_name == "gemini":
        return GeminiMetadataProvider(api_key=api_key, model=model)
    raise ValueError(f"Unknown AI_TEXT_PROVIDER: {provider_name!r}")
