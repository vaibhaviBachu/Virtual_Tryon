"use client";

import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { CaptureSourceSelector } from "@/components/camera/CaptureSourceSelector";
import { PhotoGuidance } from "@/components/camera/PhotoGuidance";
import type { CapturedPhoto } from "@/components/camera/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTryOnStore } from "@/store/tryon-store";
import { STUDIO_STEPS, stepIndex } from "@/app/try-on/studio-steps";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/catalogue-api";
import { listJewellery } from "@/lib/catalogue-api";
import {
  createTryOnRender,
  createTryOnRequest,
  createTryOnSession,
  listTryOnCategories,
  pollTryOnRender,
  pollTryOnRequest,
  uploadTryOnImage,
} from "@/lib/tryon-api";
import type { TryOnRenderStatus, TryOnRequestStatus } from "@/lib/tryon-types";

// Real backend status -> a short, honest label. No fabricated progress percentages,
// per the Milestone 3 spec's explicit rule — every label here corresponds to a real
// `TryOnRequest.status` value the API actually returns.
const STATUS_LABELS: Record<TryOnRequestStatus, string> = {
  created: "Preparing your photo…",
  uploaded: "Photo received…",
  queued: "Waiting to be analyzed…",
  processing: "Analyzing your photo…",
  landmarks_ready: "Checking face, ears, and hands…",
  segmentation_ready: "Checking overall visibility…",
  ready: "Analysis complete",
  failed: "Analysis failed",
};

// Real backend render status -> a short, honest label — same "no fabricated progress"
// rule as STATUS_LABELS above, now for Milestone 4's render lifecycle.
const RENDER_STATUS_LABELS: Record<TryOnRenderStatus, string> = {
  queued: "Waiting to render…",
  processing: "Placing the jewellery on your photo…",
  ready: "Try-on ready",
  failed: "Rendering failed",
  blocked: "Couldn't render this item",
};

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="mx-auto mb-10 flex max-w-2xl items-center justify-between text-xs text-neutral-400">
      {STUDIO_STEPS.map((step, index) => (
        <li key={step.state} className="flex flex-1 items-center">
          <div
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-[11px]",
              index <= current
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-neutral-950"
                : "border-neutral-300 dark:border-neutral-700"
            )}
          >
            {index + 1}
          </div>
          <span className={cn("ml-2 hidden sm:inline", index <= current && "text-neutral-700 dark:text-neutral-300")}>
            {step.label}
          </span>
          {index < STUDIO_STEPS.length - 1 && (
            <div className="mx-3 h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          )}
        </li>
      ))}
    </ol>
  );
}

export default function TryOnStudioPage() {
  const {
    state,
    capturedImageUrl,
    selectedCategory,
    selectedItemId,
    analysisStatusLabel,
    readiness,
    analysisError,
    categories,
    items,
    requestId,
    renderStatusLabel,
    resultImageUrl,
    renderErrorMessage,
    startCapturing,
    setCapturedImage,
    setCategories,
    selectCategory,
    setItems,
    selectItem,
    startComparing,
    tryAnotherItem,
    reset,
    startAnalyzing,
    setAnalysisIds,
    setAnalysisStatus,
    finishAnalyzingWithReadiness,
    failAnalysis,
    startRendering,
    setRenderId,
    setRenderStatus,
    finishRenderingWithResult,
    finishRenderingBlockedOrFailed,
  } = useTryOnStore();

  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  function handleCapture(photo: CapturedPhoto) {
    setCapturedPhoto(photo);
    setCapturedImage(photo.objectUrl);
  }

  // Milestone 4: fetch real, backend-driven category data once analysis finishes and
  // the studio reaches the category-selection step — never a hard-coded frontend list
  // (spec §26), so a category the geometry engine doesn't support yet always renders
  // disabled here instead of being silently omitted or wrongly offered.
  useEffect(() => {
    if (state !== "selecting_category" || categories.length > 0) return;
    let cancelled = false;
    listTryOnCategories()
      .then((fetched) => {
        if (cancelled) return;
        setCategories(
          fetched.map((c) => ({ id: c.id, slug: c.slug, displayName: c.name, functional: c.functional }))
        );
      })
      .catch((err) => {
        if (!cancelled) setCategoriesError(err instanceof ApiError ? err.message : "Couldn't load categories.");
      });
    return () => {
      cancelled = true;
    };
  }, [state, categories.length, setCategories]);

  // Fetch the real catalogue items for the selected category once it's chosen.
  useEffect(() => {
    if (state !== "selecting_item" || !selectedCategory) return;
    let cancelled = false;
    listJewellery({ categoryId: selectedCategory.id, isActive: true, pageSize: 50 })
      .then((page) => {
        if (cancelled) return;
        setItemsError(null);
        setItems(page.items.map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {
        if (!cancelled) setItemsError("Couldn't load jewellery for this category.");
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever a different category is selected (slug changes) — but only
    // that, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedCategory?.id]);

  async function handleRenderTryOn() {
    if (!requestId || !selectedItemId) return;
    startRendering();
    try {
      const created = await createTryOnRender(requestId, selectedItemId);
      setRenderId(created.id);
      setRenderStatus(created.status, RENDER_STATUS_LABELS[created.status]);

      const final = await pollTryOnRender(created.id, (update) => {
        setRenderStatus(update.status, RENDER_STATUS_LABELS[update.status]);
      });

      if (final.status === "ready" && final.result_image_url) {
        finishRenderingWithResult(final.result_image_url);
      } else {
        finishRenderingBlockedOrFailed(
          final.error_code,
          final.error_message ?? "We couldn't generate this try-on. Please try a different item or photo."
        );
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong generating your try-on.";
      finishRenderingBlockedOrFailed(null, message);
    }
  }

  async function handleAnalyzePhoto() {
    if (!capturedPhoto) return;
    startAnalyzing();
    try {
      const session = await createTryOnSession({ source: capturedPhoto.source });
      setAnalysisIds({ sessionId: session.id });

      const image = await uploadTryOnImage(session.id, capturedPhoto.blob, capturedPhoto.source);
      setAnalysisIds({ userImageId: image.id });

      const created = await createTryOnRequest(session.id, image.id);
      setAnalysisIds({ requestId: created.id });
      setAnalysisStatus(created.status, STATUS_LABELS[created.status]);

      const final = await pollTryOnRequest(created.id, (update) => {
        setAnalysisStatus(update.status, STATUS_LABELS[update.status]);
      });

      if (final.status === "failed" || !final.readiness) {
        failAnalysis(
          final.error_message ?? "We couldn't analyze your photo. Please try again with a different photo."
        );
        return;
      }
      finishAnalyzingWithReadiness(final.readiness);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong analyzing your photo.";
      failAnalysis(message);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-2 text-center font-[family-name:var(--font-display)] text-3xl">
          Try-On Studio
        </h1>
        <p className="mb-10 text-center text-sm text-neutral-500">
          Platform foundation preview — the real capture, catalogue, and try-on pipeline
          arrive in Milestones 2&ndash;6.
        </p>

        <StepIndicator current={Math.max(stepIndex(state), 0)} />

        <Card>
          <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-6 p-8 text-center">
            {state === "idle" && (
              <>
                <p className="text-neutral-600 dark:text-neutral-400">
                  Take a photo or upload one to begin.
                </p>
                <Button size="lg" onClick={startCapturing}>
                  Begin
                </Button>
              </>
            )}

            {state === "capturing" && (
              <>
                <PhotoGuidance />
                <CaptureSourceSelector onCapture={handleCapture} />
              </>
            )}

            {state === "previewing" && capturedImageUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedImageUrl}
                  alt="Captured preview"
                  className="max-h-72 rounded-xl object-contain"
                />
                {capturedPhoto && (
                  <p className="text-xs text-neutral-400">
                    Captured via {capturedPhoto.source === "camera" ? "device camera" : "file upload"}
                  </p>
                )}
                <p className="max-w-sm text-xs text-neutral-500">
                  Review your photo before continuing — you can retake it if your face,
                  ears, shoulders, or hands aren&apos;t clearly visible.
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={startCapturing}>
                    Retake
                  </Button>
                  <Button onClick={handleAnalyzePhoto}>Use this photo</Button>
                </div>
              </>
            )}

            {state === "analyzing" && (
              <>
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-amber-400" />
                <p className="text-sm text-neutral-500">
                  {analysisStatusLabel ?? "Checking your photo…"}
                </p>
                <p className="max-w-sm text-xs text-neutral-400">
                  This checks what&apos;s visible in your photo (face, ears, shoulders,
                  hands) — no jewellery is placed yet.
                </p>
              </>
            )}

            {state === "analysis_failed" && (
              <>
                <p className="max-w-sm text-sm text-red-600 dark:text-red-400">
                  {analysisError ?? "We couldn't analyze your photo. Please try again."}
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={startCapturing}>
                    Retake photo
                  </Button>
                </div>
              </>
            )}

            {state === "readiness" && readiness && (
              <>
                <p className="text-neutral-600 dark:text-neutral-400">
                  Here&apos;s what we could confidently detect in your photo:
                </p>
                <ul className="w-full max-w-sm space-y-1 text-left text-sm">
                  <li>
                    {readiness.ears_ready ? "✅" : "⚠️"} Earrings —{" "}
                    {readiness.ears_ready
                      ? "both ears clearly visible"
                      : readiness.reasons.ears ?? "ears not clearly visible"}
                  </li>
                  <li>
                    {/* Milestone 4 stabilization: prefer the combined necklace_ready
                        signal (shoulders visible AND enough framing room for a typical
                        necklace) when the backend provides it, so a badly-framed photo
                        is flagged here — right after analysis — instead of only after
                        the user has already picked a category and item. */}
                    {(readiness.necklace_ready ?? readiness.neck_ready) ? "✅" : "⚠️"} Necklace —{" "}
                    {(readiness.necklace_ready ?? readiness.neck_ready)
                      ? "neck and shoulders visible with enough room to fit a necklace"
                      : readiness.reasons.necklace_framing ??
                        readiness.reasons.neck ??
                        "neck/shoulders not clearly visible"}
                  </li>
                  <li>
                    {readiness.hands_ready ? "✅" : "⚠️"} Rings / bangles —{" "}
                    {readiness.hands_ready
                      ? "hands visible"
                      : readiness.reasons.hands ?? "hands not clearly visible"}
                  </li>
                </ul>
                <p className="max-w-sm text-xs text-neutral-400">
                  You can continue with categories marked ready, or retake the photo to
                  improve the others.
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={startCapturing}>
                    Retake photo
                  </Button>
                  <Button onClick={() => useTryOnStore.setState({ state: "selecting_category" })}>
                    Continue
                  </Button>
                </div>
              </>
            )}

            {state === "selecting_category" && (
              <>
                <p className="text-neutral-600 dark:text-neutral-400">
                  Choose a jewellery category.
                </p>
                {categoriesError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{categoriesError}</p>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {categories.map((category) => (
                    <button
                      key={category.slug}
                      disabled={!category.functional}
                      onClick={() => category.functional && selectCategory(category)}
                      title={category.functional ? undefined : "Coming in a future milestone"}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-sm",
                        category.functional
                          ? "border-neutral-200 hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-amber-400"
                          : "cursor-not-allowed border-neutral-100 text-neutral-300 dark:border-neutral-900 dark:text-neutral-700"
                      )}
                    >
                      {category.displayName}
                      {!category.functional && (
                        <span className="ml-1 text-[10px] uppercase">(soon)</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {state === "selecting_item" && (
              <>
                <p className="text-neutral-600 dark:text-neutral-400">
                  {selectedCategory
                    ? `Choose a piece from ${selectedCategory.displayName}.`
                    : "Choose a piece."}
                </p>
                {itemsError && <p className="text-xs text-red-600 dark:text-red-400">{itemsError}</p>}
                {!itemsError && items.length === 0 && (
                  <p className="text-xs text-neutral-400">Loading jewellery…</p>
                )}
                <div className="grid grid-cols-3 gap-3">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item.id)}
                      className={cn(
                        "flex h-20 w-20 items-center justify-center rounded-xl border p-1 text-center text-xs",
                        selectedItemId === item.id
                          ? "border-neutral-900 dark:border-amber-400"
                          : "border-neutral-200 dark:border-neutral-800"
                      )}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <Button disabled={!selectedItemId} onClick={handleRenderTryOn}>
                  Try this jewellery on
                </Button>
              </>
            )}

            {state === "processing" && (
              <>
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-amber-400" />
                <p className="text-sm text-neutral-500">
                  {renderStatusLabel ?? "Preparing your try-on…"}
                </p>
                <p className="max-w-sm text-xs text-neutral-400">
                  Placement is computed geometrically from your photo — this is not a
                  generated/AI-edited image, only your photo with the jewellery
                  positioned on it.
                </p>
              </>
            )}

            {state === "result" && (
              <>
                {resultImageUrl ? (
                  <>
                    <div className="grid w-full grid-cols-2 gap-4">
                      <div>
                        <p className="mb-2 text-xs uppercase text-neutral-400">Original</p>
                        {capturedImageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={capturedImageUrl} alt="Original" className="rounded-xl" />
                        )}
                      </div>
                      <div>
                        <p className="mb-2 text-xs uppercase text-neutral-400">Try-on result</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resultImageUrl} alt="Try-on result" className="rounded-xl" />
                      </div>
                    </div>
                    <p className="max-w-sm text-xs text-neutral-400">
                      Geometry-based placement (Milestone 4) — position, scale, and
                      rotation are computed from your photo, not a photorealistic
                      AI-generated render.
                    </p>
                  </>
                ) : (
                  <p className="max-w-sm text-sm text-amber-700 dark:text-amber-400">
                    {renderErrorMessage ?? "We couldn't generate this try-on."}
                  </p>
                )}
                <div className="flex flex-wrap justify-center gap-3">
                  {resultImageUrl && (
                    <Button variant="secondary" onClick={startComparing}>
                      Compare
                    </Button>
                  )}
                  {selectedItemId && (
                    <Button variant="secondary" onClick={handleRenderTryOn}>
                      Try again
                    </Button>
                  )}
                  <Button variant="secondary" onClick={tryAnotherItem}>
                    Change jewellery
                  </Button>
                  <Button onClick={startCapturing}>Retake photo</Button>
                </div>
              </>
            )}

            {state === "comparing" && (
              <>
                <div className="grid w-full grid-cols-2 gap-4">
                  <div>
                    <p className="mb-2 text-xs uppercase text-neutral-400">Original</p>
                    {capturedImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={capturedImageUrl} alt="Original" className="rounded-xl" />
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs uppercase text-neutral-400">Try-on result</p>
                    {resultImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resultImageUrl} alt="Try-on result" className="rounded-xl" />
                    ) : (
                      <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-neutral-300 p-6 text-xs text-neutral-400 dark:border-neutral-700">
                        Result unavailable
                      </div>
                    )}
                  </div>
                </div>
                <p className="max-w-sm text-xs text-neutral-400">
                  Geometry-based placement (Milestone 4) — not a photorealistic
                  AI-generated render.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button variant="secondary" onClick={() => useTryOnStore.setState({ state: "result" })}>
                    Back
                  </Button>
                  <Button variant="ghost" onClick={reset}>
                    Start over
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
