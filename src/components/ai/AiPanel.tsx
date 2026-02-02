import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Wifi,
  WifiOff,
  Play,
  Loader2,
  Check,
  X,
  Square,
} from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useUiStore } from "@/stores/uiStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import {
  testLmStudioConnection,
  testOllamaConnection,
  generateCaptionLmStudio,
  generateCaptionsBatch,
  writeCaption,
} from "@/lib/tauri";
import { buildEffectivePrompt } from "@/lib/promptBuilder";
import { DEFAULT_EXTRA_OPTIONS } from "@/types";

export function AiPanel() {
  const [previewCaption, setPreviewCaption] = useState<string | null>(null);
  const cancelBatchRef = useRef(false);

  const queryClient = useQueryClient();
  const rootPath = useProjectStore((s) => s.rootPath);
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const { data: images = [] } = useProjectImages();

  const {
    provider,
    setProvider,
    customPrompt,
    setCustomPrompt,
    wordCount,
    length,
    characterName,
    extraOptionIds,
    setWordCount,
    setLength,
    setCharacterName,
    toggleExtraOption,
    lmStudio,
    setLmStudioUrl,
    setLmStudioModel,
    ollama,
    setOllamaBaseUrl,
    setOllamaModel,
    promptTemplates,
    selectedTemplateId,
    setSelectedTemplateId,
    isConnected,
    availableModels,
    setConnectionStatus,
    isGenerating,
    setIsGenerating,
    generationProgress,
    setGenerationProgress,
    batchCaptionRatingFilter,
    batchCaptionRatingAll,
    setBatchCaptionRatingAll,
    toggleBatchCaptionRating,
  } = useAiStore();

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showToast = useUiStore((s) => s.showToast);

  const selectedTemplate = promptTemplates.find((t) => t.id === selectedTemplateId);

  const basePrompt =
    customPrompt.trim() || selectedTemplate?.prompt || "Describe this image.";
  const effectivePrompt = buildEffectivePrompt(basePrompt, {
    wordCount,
    length,
    characterName,
    extraOptionIds,
  });

  const testConnectionMutation = useMutation({
    mutationFn: () =>
      provider === "ollama"
        ? testOllamaConnection(ollama.base_url)
        : testLmStudioConnection(lmStudio.base_url),
    onSuccess: (status) => {
      setConnectionStatus(status.connected, status.models);
      if (status.models.length > 0) {
        if (provider === "ollama" && !ollama.model) {
          setOllamaModel(status.models[0]);
        } else if (provider === "lm_studio" && !lmStudio.model) {
          setLmStudioModel(status.models[0]);
        }
      }
    },
  });

  const generateSingleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage) return null;

      const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
      const model = provider === "ollama" ? ollama.model : lmStudio.model;
      return generateCaptionLmStudio(
        selectedImage.path,
        baseUrl,
        model,
        effectivePrompt
      );
    },
    onSuccess: (result) => {
      if (result?.success) {
        setPreviewCaption(result.caption);
      } else if (result?.error) {
        showToast(result.error);
      }
    },
    onError: (err: Error) => {
      showToast(err.message);
    },
  });

  async function handleAcceptCaption() {
    if (!selectedImage || !previewCaption) return;
    const tags = previewCaption
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t);
    await writeCaption(selectedImage.path, tags);
    setPreviewCaption(null);
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }

  async function handleBatchGenerate() {
    let baseImages: typeof images;
    if (batchCaptionRatingAll) {
      baseImages = images;
    } else if (batchCaptionRatingFilter.size > 0) {
      baseImages = images.filter((img) =>
        batchCaptionRatingFilter.has(img.rating)
      );
    } else {
      baseImages =
        selectedIds.size > 0
          ? images.filter((img) => selectedIds.has(img.id))
          : images.filter((img) => !img.has_caption);
    }
    const targetImages = baseImages;

    if (targetImages.length === 0) {
      showToast("No images to caption. Select images, check All, or pick Good/Bad/Needs Edit.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0, targetImages.length);
    cancelBatchRef.current = false;

    try {
      const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
      const model = provider === "ollama" ? ollama.model : lmStudio.model;
      const chunkSize = 5;

      for (let i = 0; i < targetImages.length; i += chunkSize) {
        if (cancelBatchRef.current) break;

        const chunk = targetImages.slice(i, i + chunkSize);
        const paths = chunk.map((img) => img.path);

        const results = await generateCaptionsBatch(
          paths,
          baseUrl,
          model,
          effectivePrompt
        );

        let failed = 0;
        let firstError: string | null = null;
        for (const result of results) {
          if (result.success && result.caption) {
            const tags = result.caption
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t);
            await writeCaption(result.path, tags);
          } else {
            failed++;
            if (!firstError && result.error) firstError = result.error;
          }
        }

        if (failed > 0 && firstError) {
          showToast(
            `${failed} of ${results.length} failed: ${firstError.slice(0, 200)}${firstError.length > 200 ? "…" : ""}`
          );
        }

        setGenerationProgress(Math.min(i + chunkSize, targetImages.length), targetImages.length);
      }
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    } finally {
      cancelBatchRef.current = false;
      setIsGenerating(false);
      if (rootPath) {
        queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
      }
    }
  }

  function handleStopCaptioning() {
    cancelBatchRef.current = true;
  }

  const uncaptionedCount = images.filter((img) => !img.has_caption).length;
  let batchTargetImages: typeof images;
  if (batchCaptionRatingAll) {
    batchTargetImages = images;
  } else if (batchCaptionRatingFilter.size > 0) {
    batchTargetImages = images.filter((img) =>
      batchCaptionRatingFilter.has(img.rating)
    );
  } else {
    batchTargetImages =
      selectedIds.size > 0
        ? images.filter((img) => selectedIds.has(img.id))
        : images.filter((img) => !img.has_caption);
  }
  const batchTargetCount = batchTargetImages.length;
  const batchLabel =
    batchCaptionRatingAll
      ? `${batchTargetCount} (all)`
      : batchCaptionRatingFilter.size > 0
        ? `${batchTargetCount} (rating filter)`
        : selectedIds.size > 0
          ? `${selectedIds.size} selected`
          : `${uncaptionedCount} uncaptioned`;

  return (
    <div className="flex flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium text-gray-200">AI Captioning</span>
      </div>

      {/* Provider selector */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">AI Provider</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setProvider("lm_studio")}
            className={`min-w-[6rem] flex-1 shrink-0 whitespace-nowrap rounded px-2 py-2 text-xs font-medium ${
              provider === "lm_studio"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            LM Studio
          </button>
          <button
            type="button"
            onClick={() => setProvider("ollama")}
            className={`min-w-[6rem] flex-1 shrink-0 whitespace-nowrap rounded px-2 py-2 text-xs font-medium ${
              provider === "ollama"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Ollama
          </button>
        </div>
      </div>

      {/* Provider-specific settings */}
      <div className="space-y-3 border-b border-border bg-surface/50 p-3">
        {provider === "lm_studio" ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-500">LM Studio URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={lmStudio.base_url}
                  onChange={(e) => setLmStudioUrl(e.target.value)}
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                  placeholder="http://localhost:1234"
                />
                <button
                  type="button"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={testConnectionMutation.isPending}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {testConnectionMutation.isPending ? "..." : "Test"}
                </button>
                {isConnected ? (
                  <Wifi className="h-4 w-4 shrink-0 text-green-400" aria-label="Connected" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 text-gray-500" aria-label="Not connected" />
                )}
              </div>
            </div>
            {availableModels.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Model</label>
                <select
                  value={lmStudio.model || ""}
                  onChange={(e) => setLmStudioModel(e.target.value || null)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Ollama URL (OpenAI-compatible)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={ollama.base_url}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                  placeholder="http://localhost:11434/v1"
                />
                <button
                  type="button"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={testConnectionMutation.isPending}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {testConnectionMutation.isPending ? "..." : "Test"}
                </button>
                {isConnected ? (
                  <Wifi className="h-4 w-4 shrink-0 text-green-400" aria-label="Connected" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 text-gray-500" aria-label="Not connected" />
                )}
              </div>
            </div>
            {availableModels.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Model (e.g. llava, llava:13b)</label>
                <select
                  value={ollama.model || ""}
                  onChange={(e) => setOllamaModel(e.target.value || null)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Prompt template selector */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">Prompt Template</label>
        <select
          value={selectedTemplateId}
          onChange={(e) => {
            setSelectedTemplateId(e.target.value);
            const template = promptTemplates.find((t) => t.id === e.target.value);
            if (template) setCustomPrompt(template.prompt);
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
        >
          {promptTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Custom prompt input */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">Custom Prompt</label>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter your custom prompt..."
          rows={6}
          className="w-full min-h-[8rem] resize-y rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Word limit and character name */}
      <div className="border-b border-border p-3">
        <div className="grid gap-4 items-end sm:grid-cols-[auto_1fr]">
          <div className="w-20 shrink-0">
            <label className="mb-1 block text-xs text-gray-500">Word limit</label>
            <input
              type="number"
              min={1}
              max={500}
              value={wordCount ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setWordCount(v === "" ? null : Math.max(1, Math.min(500, Number(v) || 0)));
              }}
              placeholder="—"
              title="Optional word limit"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-gray-500">
              Character name <span className="whitespace-nowrap">(for {`{name}`})</span>
            </label>
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="—"
              title="Optional; used in prompt"
              className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>
        </div>
      </div>

      {/* Extra options */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">Extra options</label>
        <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded border border-border bg-surface/50 p-2 pr-3">
          <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2">
            {DEFAULT_EXTRA_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-start gap-2 text-xs text-gray-300 hover:text-gray-200"
              >
                <input
                  type="checkbox"
                  checked={extraOptionIds.includes(opt.id)}
                  onChange={() => toggleExtraOption(opt.id)}
                  className="mt-0.5 shrink-0 rounded border-gray-600"
                />
                <span className="break-words" title={opt.label}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Prompt used (read-only) */}
      <details className="border-b border-border group">
        <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500 hover:text-gray-400">
          Prompt used
        </summary>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface/50 px-3 py-2 text-[10px] text-gray-400">
          {effectivePrompt}
        </pre>
      </details>

      {/* Batch captioning: rating filter */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">
          Only caption images rated:
        </label>
        <div className="flex flex-wrap gap-2">
          <label
            className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs hover:bg-white/5 ${
              batchCaptionRatingAll
                ? "border-green-500 bg-green-500/20 text-green-300"
                : "border-border bg-surface text-gray-300"
            }`}
          >
            <input
              type="checkbox"
              checked={batchCaptionRatingAll}
              onChange={(e) => setBatchCaptionRatingAll(e.target.checked)}
              className="rounded border-gray-600"
            />
            <span>All</span>
          </label>
          {(["good", "bad", "needs_edit"] as const).map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-2 py-1.5 text-xs text-gray-300 hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={!batchCaptionRatingAll && batchCaptionRatingFilter.has(r)}
                onChange={() => toggleBatchCaptionRating(r)}
                disabled={batchCaptionRatingAll}
                className="rounded border-gray-600 disabled:opacity-50"
              />
              <span className="capitalize">{r.replace("_", " ")}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
          All = every image in project (re-caption). Otherwise: selected/uncaptioned + rating.
        </p>
      </div>

      {/* Actions */}
      <div className="space-y-2 p-3">
        {isGenerating ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStopCaptioning}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
              <span className="flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-300">
                {generationProgress.current}/{generationProgress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-700">
              <div
                className="h-full bg-purple-600 transition-all duration-300"
                style={{
                  width: generationProgress.total
                    ? `${(100 * generationProgress.current) / generationProgress.total}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleBatchGenerate}
            disabled={
              batchTargetCount === 0 ||
              !isConnected
            }
            className="flex w-full items-center justify-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Batch ({batchLabel})
          </button>
        )}
      </div>

      {/* Preview */}
      {previewCaption && (
        <div className="border-t border-border p-3">
          <p className="mb-2 text-xs font-medium text-gray-400">Preview</p>
          <p className="mb-2 text-sm text-gray-200">{previewCaption}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAcceptCaption}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-green-600 px-2 py-1 text-sm text-white hover:bg-green-500"
            >
              <Check className="h-4 w-4" />
              Accept
            </button>
            <button
              type="button"
              onClick={() => setPreviewCaption(null)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-gray-700 px-2 py-1 text-sm text-gray-200 hover:bg-gray-600"
            >
              <X className="h-4 w-4" />
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Connection hint */}
      {provider === "lm_studio" && !isConnected && (
        <div className="p-3 text-center">
          <p className="text-xs text-gray-500">
            Start LM Studio, load a vision model, then click Test above
          </p>
        </div>
      )}

      {provider === "ollama" && !isConnected && (
        <div className="p-3 text-center">
          <p className="text-xs text-gray-500">
            Start Ollama, pull a vision model (e.g. llava), then click Test above
          </p>
        </div>
      )}
    </div>
  );
}
