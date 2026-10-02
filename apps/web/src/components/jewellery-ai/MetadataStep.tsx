"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { BotMessage } from "@/components/jewellery-ai/ChatMessage";
import { listCategories } from "@/lib/catalogue-api";
import type { IntakeMetadata, IntakeResponse } from "@/lib/jewellery-ai-types";

const SIZES = ["Small", "Medium", "Large"] as const;

/** Combines the spec's "AI metadata suggestion", "size", "physical dimensions", and
 * "review screen" sections into one scrollable step — still conversational in tone
 * (bot copy introduces each group) but a single form rather than a strict one-field-
 * per-turn wizard, which would make 10+ round trips to confirm one item. Every
 * AI-suggested field stays fully editable, and editing any field here is a plain PATCH
 * (see useJewelleryAssistant's updateMetadata) that never re-triggers the LLM. */
export function MetadataStep({
  intake,
  onRequestSuggestion,
  isSuggestingMetadata,
  metadataSuggestionError,
  onUpdateMetadata,
  onUpdateMetadataAsync,
  onSubmit,
  isSubmitting,
  submitError,
}: {
  intake: IntakeResponse;
  onRequestSuggestion: () => void;
  isSuggestingMetadata: boolean;
  metadataSuggestionError: string | null;
  onUpdateMetadata: (patch: Partial<IntakeMetadata>) => void;
  onUpdateMetadataAsync: (patch: Partial<IntakeMetadata>) => Promise<unknown>;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}) {
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => listCategories(true) });
  const requestedRef = useRef(false);

  useEffect(() => {
    const hasSuggestion = Object.keys(intake.suggested_metadata || {}).length > 0;
    if (!hasSuggestion && !requestedRef.current) {
      requestedRef.current = true;
      onRequestSuggestion();
    }
    // Only ever auto-request once per mount of this step, regardless of later intake
    // updates -- re-running this on every `intake` change would re-trigger the AI call
    // the moment the customer edits a field, which is exactly what the cost-control
    // rule (never re-call the LLM on a plain edit) forbids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial value only (React ignores this argument on re-renders) -- captures a
  // RESUMED session's prior edits at the moment this step first mounts. Deliberately
  // not kept in sync with `intake.user_metadata` via an effect: that field changes
  // every time ANY single field is PATCHed (e.g. selecting a category fires a PATCH
  // that updates user_metadata to just `{category_slug}`), and a real bug here —
  // found via an end-to-end browser test, not simulated — was exactly that: resyncing
  // from it wiped out whatever the customer had typed into a DIFFERENT field in the
  // meantime, because the "only hydrate once" ref guard could trip on that unrelated
  // update instead of the real initial load.
  const [form, setForm] = useState<IntakeMetadata>(intake.user_metadata || {});

  // The one case that DOES need to flow in after mount: the AI suggestion landing
  // asynchronously. Applied once, and merged UNDER the current form (spread first) so
  // it can never overwrite a field the customer has already touched.
  const appliedSuggestionRef = useRef(false);
  useEffect(() => {
    const suggested = intake.suggested_metadata;
    if (!appliedSuggestionRef.current && suggested && Object.keys(suggested).length > 0) {
      appliedSuggestionRef.current = true;
      setForm((prev) => ({ ...suggested, ...prev }));
    }
  }, [intake.suggested_metadata]);

  function field<K extends keyof IntakeMetadata>(key: K, value: IntakeMetadata[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function commit<K extends keyof IntakeMetadata>(key: K) {
    onUpdateMetadata({ [key]: form[key] } as Partial<IntakeMetadata>);
  }

  const canSubmit = !!form.name?.trim() && !!form.category_slug;
  const [isFlushingBeforeSubmit, setIsFlushingBeforeSubmit] = useState(false);

  // Flushes the full current form to the server and only then submits -- individual
  // fields are PATCHed on their own blur/change as the customer edits them, so
  // clicking submit right after the LAST edit could otherwise race ahead of that
  // field's own in-flight PATCH and have the server read its pre-edit value.
  async function handleSubmitClick() {
    setIsFlushingBeforeSubmit(true);
    try {
      await onUpdateMetadataAsync(form);
    } finally {
      setIsFlushingBeforeSubmit(false);
    }
    onSubmit();
  }

  return (
    <div className="flex flex-col gap-4">
      <BotMessage>
        {isSuggestingMetadata
          ? "Let me take a look and suggest some product details…"
          : "I've prepared some product details. Everything below is editable — change anything that doesn't look right."}
      </BotMessage>
      {metadataSuggestionError && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {metadataSuggestionError} You can still fill in the details yourself below.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Name</span>
        <input
          value={form.name ?? ""}
          onChange={(e) => field("name", e.target.value)}
          onBlur={() => commit("name")}
          placeholder="e.g. Lakshmi Temple Haaram"
          className="rounded-lg border border-black/10 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Category</span>
        <select
          value={form.category_slug ?? ""}
          onChange={(e) => {
            field("category_slug", e.target.value);
            onUpdateMetadata({ category_slug: e.target.value });
          }}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Select a category
          </option>
          {categoriesQuery.data?.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Size</span>
        <div className="flex gap-2">
          {SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => {
                field("size", size);
                onUpdateMetadata({ size });
              }}
              className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                form.size === size
                  ? "border-[#C90016] bg-[#C90016] text-white"
                  : "border-black/10 bg-white text-neutral-700 hover:bg-[#F8EEE5]"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Material</span>
          <input
            value={form.material ?? ""}
            onChange={(e) => field("material", e.target.value)}
            onBlur={() => commit("material")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Stone</span>
          <input
            value={form.stone ?? ""}
            onChange={(e) => field("stone", e.target.value)}
            onBlur={() => commit("stone")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Description</span>
        <textarea
          value={form.description ?? ""}
          onChange={(e) => field("description", e.target.value)}
          onBlur={() => commit("description")}
          rows={3}
          className="rounded-lg border border-black/10 px-3 py-2 text-sm"
        />
      </label>

      <BotMessage>
        Do you know the physical dimensions of this jewellery? These are only used for an accurate try-on fit —
        leave any you don&apos;t know blank.
      </BotMessage>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Width (mm)</span>
          <input
            type="number"
            min={0}
            value={form.physical_width_mm ?? ""}
            onChange={(e) => field("physical_width_mm", e.target.value ? Number(e.target.value) : null)}
            onBlur={() => commit("physical_width_mm")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Breadth / Depth (mm)</span>
          <input
            type="number"
            min={0}
            value={form.physical_depth_mm ?? ""}
            onChange={(e) => field("physical_depth_mm", e.target.value ? Number(e.target.value) : null)}
            onBlur={() => commit("physical_depth_mm")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Height (mm)</span>
          <input
            type="number"
            min={0}
            value={form.physical_height_mm ?? ""}
            onChange={(e) => field("physical_height_mm", e.target.value ? Number(e.target.value) : null)}
            onBlur={() => commit("physical_height_mm")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Weight (g)</span>
          <input
            type="number"
            min={0}
            value={form.weight_g ?? ""}
            onChange={(e) => field("weight_g", e.target.value ? Number(e.target.value) : null)}
            onBlur={() => commit("weight_g")}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {intake.duplicate_of_jewellery_id && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          An image like this may already exist in your catalogue. You can still add this as a new item if that&apos;s
          intended.
        </p>
      )}

      {submitError && (
        <p role="alert" className="text-sm text-red-600">
          {submitError}
        </p>
      )}

      <BotMessage>Everything is ready. Would you like me to add this jewellery to your catalogue?</BotMessage>
      <button
        type="button"
        onClick={handleSubmitClick}
        disabled={!canSubmit || isSubmitting || isFlushingBeforeSubmit}
        className="rounded-full bg-[#C90016] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A8000F] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting || isFlushingBeforeSubmit ? "Adding…" : "Add to Jewellery Catalogue"}
      </button>
    </div>
  );
}
