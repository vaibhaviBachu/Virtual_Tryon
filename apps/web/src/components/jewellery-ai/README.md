# AI Jewellery Assistant (frontend)

A floating chat widget (bottom-right on every customer-facing page except
`/try-on/live`) that walks a shop/customer through turning their own jewellery photo
into a real catalogue item, ending in the existing Live Try-On flow.

## Files

- `JewelleryAIAssistant.tsx` — top-level component. Owns no logic itself; renders
  `AssistantButton` or `AssistantPanel` + the current step, driven by
  `useJewelleryAssistant()`.
- `AssistantMount.tsx` — the actual mount point used in `src/app/layout.tsx`. Hides the
  assistant on `/try-on/live` (dense AR UI of its own) and nowhere else.
- `AssistantButton.tsx` / `AssistantPanel.tsx` — the floating trigger and the chat
  window shell (header, minimize/close, mobile bottom-sheet vs desktop floating panel).
- `ChatMessage.tsx` — shared bot/user message bubbles.
- `ImageUploadStep.tsx` — the opening screen (welcome message + upload button).
- `ImageComparisonStep.tsx` — original vs AI-prepared (or deterministic-fallback)
  preview, Regenerate/Continue.
- `MetadataStep.tsx` — combines the spec's "metadata suggestion", "size", "physical
  dimensions", and "review" sections into one scrollable step (still conversational in
  tone via bot copy between groups, but one form rather than a strict one-field-per-turn
  wizard). Auto-requests an AI metadata suggestion once on mount; every field stays
  editable and editing one never re-triggers the LLM.
- `SuccessStep.tsx` — confirmation + Try It On / View Catalogue / Add Another.

## State / data flow

`useJewelleryAssistant.ts` (in `src/hooks/`) owns:

- `sessionId`, persisted in `localStorage` as an **opaque UUID only** — never the image
  or any metadata. Lets a minimized/closed assistant resume where it left off; the
  actual state lives server-side in `jewellery_ai_intakes` (see the backend README
  below).
- A local `step` (`welcome | comparing | detailing | success`) that mostly, but not
  strictly, mirrors the backend's `status`. It has to be local rather than purely
  derived: `detailing` is reached either by the backend status becoming
  `metadata_ready`, or by the customer clicking "Continue" while status is still
  `image_ready` (e.g. because no AI key is configured and `metadata_ready` will never
  happen). Resyncing `step` from server data is deliberately done only ONCE per resumed
  session (a ref-guarded effect) — resyncing on every refetch was a real bug caught via
  an end-to-end browser test: it would overwrite an explicit `setStep("comparing")`
  from the upload mutation's `onSuccess` the moment any later refetch landed.
- React Query mutations wrapping every `jewellery-ai-api.ts` call.

`jewellery-ai-api.ts` / `jewellery-ai-types.ts` mirror the backend's schemas exactly,
same convention as `catalogue-api.ts` / `catalogue-types.ts`.

## Two real bugs this component caught that a type-level/unit-level check would not

1. **Hydration mismatch in an unrelated component.** Fixed along the way: a lazy
   `useState` initializer that read `typeof IntersectionObserver` produced a different
   value on the server (always `"undefined"`, no DOM in Node) than on the client's
   first paint (a real browser), which is exactly backwards for a value that must be
   identical on both. Only showed up as a React console error in a real browser, not in
   `tsc`/lint/vitest.
2. **Form-hydration-effect clobbering unrelated fields.** `MetadataStep` used to
   re-hydrate its local form from `intake.user_metadata` reactively; since that field
   changes after literally any single field's PATCH resolves, the "hydrate once" ref
   guard could trip on an unrelated field's save and wipe out whatever the customer had
   typed into a *different* field in the meantime. Only reproduced with real, separately
   timed interactions in a real browser — a synchronous `userEvent` test in jsdom
   doesn't naturally interleave requests the way a real person (or a race between two
   network calls) does.

Both are fixed; see the git history on `src/app/page.tsx` and `MetadataStep.tsx` for the
exact before/after.
