"use client";

import { AssistantButton } from "@/components/jewellery-ai/AssistantButton";
import { AssistantPanel } from "@/components/jewellery-ai/AssistantPanel";
import { ImageComparisonStep } from "@/components/jewellery-ai/ImageComparisonStep";
import { ImageUploadStep } from "@/components/jewellery-ai/ImageUploadStep";
import { MetadataStep } from "@/components/jewellery-ai/MetadataStep";
import { SuccessStep } from "@/components/jewellery-ai/SuccessStep";
import { useJewelleryAssistant } from "@/hooks/useJewelleryAssistant";

/** The AI Jewellery Assistant's single mount point — owns no layout positioning itself
 * beyond what AssistantButton/AssistantPanel already do (both `fixed`), so this can be
 * dropped once into the root layout and just works everywhere it's rendered. */
export function JewelleryAIAssistant() {
  const assistant = useJewelleryAssistant();

  const hasUnfinishedWork = !!assistant.intake && assistant.intake.status !== "submitted";

  return (
    <>
      {!assistant.open && (
        <AssistantButton onClick={() => assistant.setOpen(true)} hasUnfinishedWork={hasUnfinishedWork} />
      )}
      {assistant.open && (
        <AssistantPanel onClose={() => assistant.setOpen(false)} onMinimize={() => assistant.setOpen(false)}>
          {assistant.step === "welcome" && (
            <ImageUploadStep
              onSelectFile={assistant.uploadImage}
              isUploading={assistant.isUploading}
              error={assistant.imageError}
            />
          )}
          {assistant.step === "comparing" && assistant.intake && (
            <ImageComparisonStep
              intake={assistant.intake}
              onRegenerate={assistant.regenerateImage}
              isRegenerating={assistant.isRegenerating}
              regenerateError={assistant.regenerateError}
              onContinue={assistant.continueToDetails}
            />
          )}
          {assistant.step === "detailing" && assistant.intake && (
            <MetadataStep
              intake={assistant.intake}
              onRequestSuggestion={assistant.requestMetadataSuggestion}
              isSuggestingMetadata={assistant.isSuggestingMetadata}
              metadataSuggestionError={assistant.metadataSuggestionError}
              onUpdateMetadata={assistant.updateMetadata}
              onUpdateMetadataAsync={assistant.updateMetadataAsync}
              onSubmit={assistant.submit}
              isSubmitting={assistant.isSubmitting}
              submitError={assistant.submitError}
            />
          )}
          {assistant.step === "success" && assistant.intake && (
            <SuccessStep intake={assistant.intake} onAddAnother={assistant.reset} />
          )}
        </AssistantPanel>
      )}
    </>
  );
}
