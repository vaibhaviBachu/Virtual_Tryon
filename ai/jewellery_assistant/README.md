# AI Jewellery Assistant (backend)

Feeds the **existing** catalogue (`db/models/jewellery.py`, `jewellery_assets`) — this
is not a second catalogue or a parallel processing pipeline. See
`apps/api/v1/services/jewellery_ai_service.py`'s module docstring for the full
architecture writeup; this file covers just the `ai/jewellery_assistant/` package.

## Layout

- `image_pipeline.py` — deterministic (non-AI) resize/pad/white-background 200×200
  catalogue preview. Plain PIL; never calls a paid API. This is a presentation artifact
  for the assistant's chat UI only — it is never the asset fed into the real try-on/AR
  pipeline (see spec: "do not use the 200×200 thumbnail as the AR source").
- `dedupe.py` — sha256 of the raw upload, for cross-session duplicate detection
  (`jewellery_ai_intakes.content_hash`).
- `prompts.py` — the exact instructions sent to whichever image/text model is
  configured. Kept as plain string constants so they're easy to audit.
- `providers/base.py` — `ImageGenerationProvider` / `MetadataLLMProvider` ABCs,
  `AIServiceNotConfiguredError` / `AIServiceError`. Two separate interfaces because a
  shop may want a different model (or vendor) for "clean up this photo" vs. "describe
  this photo," and because image generation and text/metadata generation have
  genuinely different cost/latency/failure profiles.
- `providers/image_provider.py` / `providers/metadata_provider.py` — concrete
  "OpenAI-compatible" implementations (several vendors implement the same
  `/v1/images/edits` and `/v1/chat/completions`-with-vision shapes). Both raise
  `AIServiceNotConfiguredError` immediately, with no network call attempted, whenever
  `AI_API_KEY` is empty — which it is in every environment until a real key is added
  (nothing here was ever asked for during implementation, per the spec's explicit
  instruction).
- `providers/factory.py` — `get_image_provider()` / `get_metadata_provider()`, selected
  by `AI_IMAGE_PROVIDER`/`AI_TEXT_PROVIDER` (currently only `"openai"`, meaning "an
  OpenAI-compatible HTTP API," not literally OpenAI-only). Takes plain values as
  arguments rather than importing `apps.api.core.config` directly — `ai/` never imports
  from `apps/api`, same one-directional rule the rest of this package already follows
  (e.g. `ai/preprocessing/image_validation.py`).

## Adding the real API key later

1. Local dev: add to `.env` —
   ```
   AI_API_KEY=sk-...
   AI_IMAGE_MODEL=<the image-edit-capable model you're using>
   AI_TEXT_MODEL=<the vision-capable chat model you're using>
   ```
2. Render: add the same three as environment variables on the `jewellery-tryon-api`
   service (Settings → Environment), then redeploy. They are server-side only — there
   is no `NEXT_PUBLIC_` equivalent anywhere, and the frontend never sees this key.
3. Nothing else changes. The moment `AI_API_KEY` is non-empty, the image-prep step and
   the metadata-suggestion step both start actually calling out; before that, both
   gracefully report "AI service is not configured" and the assistant still works fully
   with deterministic image prep + manual metadata entry.

## Known limitation in this environment

The real `/v1/images/edits` and `/v1/chat/completions` request bodies in
`image_provider.py`/`metadata_provider.py` have not been exercised against a real
provider (no key was ever added, per the instruction not to ask for one) — only the
"not configured" short-circuit path has been verified end-to-end. Worth a smoke test
against the real provider the first time a key is added, before relying on it in front
of a real customer.
