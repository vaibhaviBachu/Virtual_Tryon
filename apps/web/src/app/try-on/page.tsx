"use client";

import { useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { CaptureSourceSelector } from "@/components/camera/CaptureSourceSelector";
import { PhotoGuidance } from "@/components/camera/PhotoGuidance";
import type { CapturedPhoto } from "@/components/camera/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTryOnStore, type JewelleryCategoryOption } from "@/store/tryon-store";
import { STUDIO_STEPS, stepIndex } from "@/app/try-on/studio-steps";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/catalogue-api";
import { createTryOnRequest, createTryOnSession, pollTryOnRequest, uploadTryOnImage } from "@/lib/tryon-api";
import type { TryOnRequestStatus } from "@/lib/tryon-types";

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

// Milestone 1 placeholder catalogue data — real data comes from GET /api/v1/catalog in
// Milestone 2. Kept here, not hard-coded into the render logic, so swapping in a real
// fetch later is a data-source change, not a UI rewrite.
const PLACEHOLDER_CATEGORIES: JewelleryCategoryOption[] = [
  { slug: "earring", displayName: "Earrings" },
  { slug: "necklace", displayName: "Necklaces" },
  { slug: "bangle", displayName: "Bangles" },
  { slug: "ring", displayName: "Rings" },
];

const PLACEHOLDER_ITEMS = [
  { id: "demo-1", name: "Item A" },
  { id: "demo-2", name: "Item B" },
  { id: "demo-3", name: "Item C" },
];

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
    startCapturing,
    setCapturedImage,
    selectCategory,
    selectItem,
    startProcessing,
    finishProcessing,
    startComparing,
    tryAnotherItem,
    reset,
    startAnalyzing,
    setAnalysisIds,
    setAnalysisStatus,
    finishAnalyzingWithReadiness,
    failAnalysis,
  } = useTryOnStore();

  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);

  function handleCapture(photo: CapturedPhoto) {
    setCapturedPhoto(photo);
    setCapturedImage(photo.objectUrl);
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

  function handleTryOn() {
    startProcessing();
    // Milestone 1: there is no try-on engine yet (see ai/engines — Milestone 4 ships
    // GeometryTryOnEngine). We simulate only the *wait*, never the *result* — the result
    // screen explicitly says no engine is implemented, per docs/production-readiness.md's
    // "do not fake AI results" rule.
    window.setTimeout(() => finishProcessing(), 900);
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
                    {readiness.neck_ready ? "✅" : "⚠️"} Necklace —{" "}
                    {readiness.neck_ready
                      ? "neck and shoulders visible"
                      : readiness.reasons.neck ?? "neck/shoulders not clearly visible"}
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
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PLACEHOLDER_CATEGORIES.map((category) => (
                    <button
                      key={category.slug}
                      onClick={() => selectCategory(category)}
                      className="rounded-xl border border-neutral-200 px-4 py-3 text-sm hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-amber-400"
                    >
                      {category.displayName}
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
                <div className="grid grid-cols-3 gap-3">
                  {PLACEHOLDER_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item.id)}
                      className={cn(
                        "flex h-20 w-20 items-center justify-center rounded-xl border text-xs",
                        selectedItemId === item.id
                          ? "border-neutral-900 dark:border-amber-400"
                          : "border-neutral-200 dark:border-neutral-800"
                      )}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <Button disabled={!selectedItemId} onClick={handleTryOn}>
                  Try this jewellery on
                </Button>
              </>
            )}

            {state === "processing" && (
              <>
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-amber-400" />
                <p className="text-sm text-neutral-500">Processing your try-on&hellip;</p>
              </>
            )}

            {state === "result" && (
              <>
                <p className="max-w-sm text-sm text-amber-700 dark:text-amber-400">
                  The try-on engine is under development (arrives in Milestone 4). No
                  result image is generated yet — this screen exists to validate the
                  workflow end to end.
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={startComparing}>
                    Compare (preview)
                  </Button>
                  <Button onClick={tryAnotherItem}>Try another item</Button>
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
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-neutral-300 p-6 text-xs text-neutral-400 dark:border-neutral-700">
                    Result unavailable — engine not implemented yet
                  </div>
                </div>
                <Button variant="ghost" onClick={reset}>
                  Start over
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
