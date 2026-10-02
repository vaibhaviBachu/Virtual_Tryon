"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  createIntakeSession,
  getIntakeSession,
  regenerateIntakeImage,
  submitIntake,
  suggestIntakeMetadata,
  updateIntakeMetadata,
  uploadIntakeImage,
} from "@/lib/jewellery-ai-api";
import type { IntakeMetadata, IntakeResponse } from "@/lib/jewellery-ai-types";

const SESSION_STORAGE_KEY = "jewellery-ai-session-id";

// Only ever an opaque UUID, never the image itself or any metadata — satisfies the
// spec's "do not store sensitive image data in localStorage" rule. The actual session
// state (images, metadata) lives server-side; this is just enough to resume it.
function readSavedSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSessionId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing, blocked) — session just won't
    // survive a reload, which is a degraded-but-working experience, not a crash.
  }
}

export type AssistantStep = "welcome" | "comparing" | "detailing" | "success";

function stepForIntake(intake: IntakeResponse | null): AssistantStep {
  if (!intake) return "welcome";
  if (intake.status === "submitted") return "success";
  if (intake.status === "metadata_ready") return "detailing";
  // "image_ready" means a photo exists but the customer hasn't clicked past the
  // original/prepared comparison yet (or, on resume, has an uploaded photo but never
  // got further) — either way that's the comparison step, not detailing.
  if (intake.status === "image_ready") return "comparing";
  return "welcome";
}

export function useJewelleryAssistant() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Lazy initializers (not an effect) because reading localStorage here never runs
  // during server rendering (this hook is only ever used from "use client"
  // components), and because the very first thing rendered either way is just the
  // floating button — no part of the initial paint depends on these values, so there
  // is no hydration-mismatch risk in reading the real value immediately on the client.
  const [sessionId, setSessionId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readSavedSessionId()
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const [step, setStep] = useState<AssistantStep>("welcome");

  const sessionQuery = useQuery({
    queryKey: ["jewellery-ai-session", sessionId],
    queryFn: () => getIntakeSession(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

  // Sets the initial step from a RESUMED session exactly once per session id — never
  // on the cache updates our own mutations cause afterward (those already call
  // setStep themselves, e.g. uploadMutation.onSuccess below). Without the ref guard,
  // this would re-derive the step from `status` on every refetch and could stomp a
  // step the UI explicitly advanced to ahead of the backend's own status (e.g.
  // "comparing" while status is still "image_ready").
  const resumedSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const data = sessionQuery.data;
    if (data && resumedSessionIdRef.current !== data.id) {
      resumedSessionIdRef.current = data.id;
      setStep(stepForIntake(data));
    }
  }, [sessionQuery.data]);

  useEffect(() => {
    // The saved session id pointed at something that no longer exists server-side
    // (e.g. a dev DB reset) — start fresh rather than getting stuck on a 404 forever.
    if (sessionQuery.isError && sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404) {
      saveSessionId(null);
      setSessionId(null);
      setStep("welcome");
    }
  }, [sessionQuery.isError, sessionQuery.error]);

  const intake = sessionQuery.data ?? null;

  const startSession = useCallback(async () => {
    const created = await createIntakeSession();
    setSessionId(created.id);
    saveSessionId(created.id);
    queryClient.setQueryData(["jewellery-ai-session", created.id], created);
    return created;
  }, [queryClient]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setImageError(null);
      const session = intake ?? (await startSession());
      return uploadIntakeImage(session.id, file);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["jewellery-ai-session", updated.id], updated);
      setStep("comparing");
    },
    onError: (err) => {
      setImageError(err instanceof Error ? err.message : "Upload failed.");
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateIntakeImage(sessionId!),
    onSuccess: (updated) => queryClient.setQueryData(["jewellery-ai-session", updated.id], updated),
  });

  const metadataSuggestionMutation = useMutation({
    mutationFn: () => suggestIntakeMetadata(sessionId!),
    onSuccess: (updated) => {
      queryClient.setQueryData(["jewellery-ai-session", updated.id], updated);
      setStep("detailing");
    },
    onError: (updatedErr) => {
      // A 503 "not configured" still means "move on to manual entry" — not a dead end.
      if (updatedErr instanceof ApiError && updatedErr.status === 503) setStep("detailing");
    },
  });

  const updateMetadataMutation = useMutation({
    mutationFn: (patch: Partial<IntakeMetadata>) => updateIntakeMetadata(sessionId!, patch),
    onSuccess: (updated) => queryClient.setQueryData(["jewellery-ai-session", updated.id], updated),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitIntake(sessionId!),
    onSuccess: (result) => {
      queryClient.setQueryData(["jewellery-ai-session", result.intake.id], result.intake);
      setStep("success");
    },
  });

  const reset = useCallback(() => {
    saveSessionId(null);
    setSessionId(null);
    setStep("welcome");
    setImageError(null);
  }, []);

  return {
    open,
    setOpen,
    step,
    intake,
    isLoadingSession: !!sessionId && sessionQuery.isLoading,
    imageError,
    uploadImage: uploadMutation.mutate,
    isUploading: uploadMutation.isPending,
    regenerateImage: regenerateMutation.mutate,
    isRegenerating: regenerateMutation.isPending,
    regenerateError: regenerateMutation.error instanceof Error ? regenerateMutation.error.message : null,
    continueToDetails: () => setStep("detailing"),
    requestMetadataSuggestion: metadataSuggestionMutation.mutate,
    isSuggestingMetadata: metadataSuggestionMutation.isPending,
    metadataSuggestionError:
      metadataSuggestionMutation.error instanceof Error ? metadataSuggestionMutation.error.message : null,
    updateMetadata: updateMetadataMutation.mutate,
    // Exposed separately (not just `.mutate`) so the submit button can flush the
    // full current form and genuinely WAIT for the server to have it before
    // submitting -- see MetadataStep's submit handler for why: individual fields are
    // PATCHed on blur/change as the customer edits them, and submitting immediately
    // after the LAST edit could otherwise race ahead of that field's own PATCH
    // request, with the server reading its pre-edit state (found via an actual
    // end-to-end browser test, not a hypothetical).
    updateMetadataAsync: updateMetadataMutation.mutateAsync,
    isUpdatingMetadata: updateMetadataMutation.isPending,
    submit: submitMutation.mutate,
    isSubmitting: submitMutation.isPending,
    submitError: submitMutation.error instanceof Error ? submitMutation.error.message : null,
    reset,
  };
}
