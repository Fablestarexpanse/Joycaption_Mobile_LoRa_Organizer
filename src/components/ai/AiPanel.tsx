import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  Sparkles,
  Wifi,
  WifiOff,
  Play,
  Loader2,
  Check,
  X,
  Settings,
  Download,
  CheckCircle,
  Square,
} from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import {
  testLmStudioConnection,
  testOllamaConnection,
  generateCaptionLmStudio,
  generateCaptionsBatch,
  generateCaptionJoyCaption,
  generateCaptionsJoyCaptionBatch,
  writeCaption,
  joycaptionInstallStatus,
  joycaptionInstall,
  type JoyCaptionInstallProgress,
} from "@/lib/tauri";

export function AiPanel() {
  const [showSettings, setShowSettings] = useState(false);
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
    lmStudio,
    setLmStudioUrl,
    setLmStudioModel,
    ollama,
    setOllamaBaseUrl,
    setOllamaModel,
    joyCaption,
    setJoyCaptionPythonPath,
    setJoyCaptionScriptPath,
    setJoyCaptionMode,
    setJoyCaptionLowVram,
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
  } = useAiStore();

  const selectedIds = useSelectionStore((s) => s.selectedIds);

  const [installProgress, setInstallProgress] = useState<JoyCaptionInstallProgress | null>(null);

  const selectedTemplate = promptTemplates.find((t) => t.id === selectedTemplateId);

  // JoyCaption install status (when provider is JoyCaption)
  const { data: joyCaptionInstallStatusData, refetch: refetchJoyCaptionStatus } = useQuery({
    queryKey: ["joycaption-install-status"],
    queryFn: joycaptionInstallStatus,
    enabled: provider === "joycaption",
  });

  const joyCaptionReady =
    provider !== "joycaption" ||
    joyCaptionInstallStatusData?.installed === true ||
    (joyCaption.script_path != null && joyCaption.script_path !== "");

  // Listen for install progress events
  useEffect(() => {
    const unlisten = listen<JoyCaptionInstallProgress>(
      "joycaption-install-progress",
      (event) => setInstallProgress(event.payload)
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Install JoyCaption mutation
  const installJoyCaptionMutation = useMutation({
    mutationFn: joycaptionInstall,
    onSuccess: (result) => {
      setInstallProgress(null);
      if (result.success && result.python_path) setJoyCaptionPythonPath(result.python_path);
      if (result.success && result.script_path) setJoyCaptionScriptPath(result.script_path);
      refetchJoyCaptionStatus();
    },
    onError: () => setInstallProgress(null),
  });

  // Test connection mutation (LM Studio or Ollama)
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

  // Get the effective prompt to use
  const effectivePrompt = customPrompt.trim() || selectedTemplate?.prompt || "Describe this image.";

  // Generate single caption mutation
  const generateSingleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage) return null;

      if (provider === "lm_studio" || provider === "ollama") {
        const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
        const model = provider === "ollama" ? ollama.model : lmStudio.model;
        return generateCaptionLmStudio(
          selectedImage.path,
          baseUrl,
          model,
          effectivePrompt
        );
      } else {
        return generateCaptionJoyCaption(
          selectedImage.path,
          joyCaption.python_path,
          joyCaption.script_path,
          joyCaption.mode,
          joyCaption.low_vram
        );
      }
    },
    onSuccess: (result) => {
      if (result?.success) {
        setPreviewCaption(result.caption);
      }
    },
  });

  // Accept caption and save
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

  // Batch generation - uses selected images if any, otherwise uncaptioned
  async function handleBatchGenerate() {
    // Determine which images to process
    const targetImages =
      selectedIds.size > 0
        ? images.filter((img) => selectedIds.has(img.id))
        : images.filter((img) => !img.has_caption);

    if (targetImages.length === 0) return;

    setIsGenerating(true);
    setGenerationProgress(0, targetImages.length);
    cancelBatchRef.current = false;

    try {
      // JoyCaption batch loads model once per chunk; use larger chunks. LM Studio is sequential.
      const chunkSize = provider === "joycaption" ? 20 : 5;
      for (let i = 0; i < targetImages.length; i += chunkSize) {
        if (cancelBatchRef.current) break;

        const chunk = targetImages.slice(i, i + chunkSize);
        const paths = chunk.map((img) => img.path);

        let results;
        if (provider === "lm_studio" || provider === "ollama") {
          const baseUrl = provider === "ollama" ? ollama.base_url : lmStudio.base_url;
          const model = provider === "ollama" ? ollama.model : lmStudio.model;
          results = await generateCaptionsBatch(
            paths,
            baseUrl,
            model,
            effectivePrompt
          );
        } else {
          results = await generateCaptionsJoyCaptionBatch(
            paths,
            joyCaption.python_path,
            joyCaption.script_path,
            joyCaption.mode,
            joyCaption.low_vram
          );
        }

        // Save successful captions
        for (const result of results) {
          if (result.success && result.caption) {
            const tags = result.caption
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t);
            await writeCaption(result.path, tags);
          }
        }

        setGenerationProgress(Math.min(i + chunkSize, targetImages.length), targetImages.length);
      }
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
  const batchTargetCount = selectedIds.size > 0 ? selectedIds.size : uncaptionedCount;
  const batchLabel = selectedIds.size > 0 ? `${selectedIds.size} selected` : `${uncaptionedCount} uncaptioned`;

  return (
    <div className="flex flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-200">AI Captioning</span>
        </div>
        <div className="flex items-center gap-2">
          {(provider === "lm_studio" || provider === "ollama") &&
            (isConnected ? (
              <Wifi className="h-4 w-4 text-green-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-gray-500" />
            ))}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Provider selector */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">AI Provider</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setProvider("lm_studio")}
            className={`flex-1 rounded py-2 text-sm font-medium ${
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
            className={`flex-1 rounded py-2 text-sm font-medium ${
              provider === "ollama"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Ollama
          </button>
          <button
            type="button"
            onClick={() => setProvider("joycaption")}
            className={`flex-1 rounded py-2 text-sm font-medium ${
              provider === "joycaption"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            JoyCaption
          </button>
        </div>
      </div>

      {/* Settings (collapsible) */}
      {showSettings && (
        <div className="space-y-3 border-b border-border bg-surface/50 p-3">
          {provider === "lm_studio" ? (
            <>
              {/* LM Studio URL */}
              <div>
                <label className="mb-1 block text-xs text-gray-500">LM Studio URL</label>
                <div className="flex gap-2">
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
                </div>
              </div>

              {/* Model selector */}
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
          ) : provider === "ollama" ? (
            <>
              {/* Ollama URL */}
              <div>
                <label className="mb-1 block text-xs text-gray-500">Ollama URL (OpenAI-compatible)</label>
                <div className="flex gap-2">
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
                </div>
              </div>

              {/* Model selector */}
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
          ) : (
            <>
              {/* JoyCaption Python Path */}
              <div>
                <label className="mb-1 block text-xs text-gray-500">Python Path</label>
                <input
                  type="text"
                  value={joyCaption.python_path}
                  onChange={(e) => setJoyCaptionPythonPath(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                  placeholder="python"
                />
              </div>

              {/* JoyCaption Mode */}
              <div>
                <label className="mb-1 block text-xs text-gray-500">Caption Mode</label>
                <select
                  value={joyCaption.mode}
                  onChange={(e) => setJoyCaptionMode(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-gray-200"
                >
                  <option value="descriptive">Descriptive</option>
                  <option value="straightforward">Straightforward</option>
                  <option value="booru">Booru Tags</option>
                  <option value="training">Training Caption</option>
                </select>
              </div>

              {/* Low VRAM toggle */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={joyCaption.low_vram}
                  onChange={(e) => setJoyCaptionLowVram(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">Low VRAM mode</span>
              </label>
            </>
          )}
        </div>
      )}

      {/* Prompt template selector (LM Studio and Ollama) */}
      {(provider === "lm_studio" || provider === "ollama") && (
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
      )}

      {/* Custom prompt input */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-gray-500">
          {provider === "joycaption"
            ? "Custom Prompt (LM Studio / Ollama only, JoyCaption uses mode)"
            : "Custom Prompt"}
        </label>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter your custom prompt..."
          rows={3}
          disabled={provider === "joycaption"}
          className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        {provider === "joycaption" && (
          <p className="mt-1 text-xs text-gray-500">JoyCaption uses the Mode setting above instead of a custom prompt.</p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2 p-3">
        {/* Single image caption */}
        <button
          type="button"
          onClick={() => generateSingleMutation.mutate()}
          disabled={
            !selectedImage ||
            ((provider === "lm_studio" || provider === "ollama") && !isConnected) ||
            (provider === "joycaption" && !joyCaptionReady) ||
            generateSingleMutation.isPending
          }
          className="flex w-full items-center justify-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {generateSingleMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate Caption
        </button>

        {/* Batch caption / Stop */}
        {isGenerating ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleStopCaptioning}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
            <span className="flex items-center justify-center px-3 py-2 text-sm text-gray-400">
              {generationProgress.current}/{generationProgress.total}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleBatchGenerate}
            disabled={
              batchTargetCount === 0 ||
              ((provider === "lm_studio" || provider === "ollama") && !isConnected) ||
              (provider === "joycaption" && !joyCaptionReady)
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
            Start LM Studio and load a vision model, then click Settings → Test
          </p>
        </div>
      )}

      {provider === "ollama" && !isConnected && (
        <div className="p-3 text-center">
          <p className="text-xs text-gray-500">
            Start Ollama and pull a vision model (e.g. llava), then click Settings → Test
          </p>
        </div>
      )}

      {provider === "joycaption" && (
        <div className="space-y-2 border-t border-border p-3">
          {joyCaptionInstallStatusData?.installed === true ? (
            <div className="flex items-center justify-center gap-2 rounded bg-green-900/40 py-2 text-sm text-green-300">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>JoyCaption is installed and ready.</span>
            </div>
          ) : installProgress ? (
            <div className="space-y-2 rounded bg-surface/80 p-3">
              <p className="text-sm text-gray-300">{installProgress.message}</p>
              <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full bg-purple-600 transition-all duration-300"
                  style={{ width: `${installProgress.percent}%` }}
                />
              </div>
            </div>
          ) : installJoyCaptionMutation.isPending ? (
            <div className="flex items-center justify-center gap-2 rounded bg-surface/80 py-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Installing...</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => installJoyCaptionMutation.mutate()}
                disabled={installJoyCaptionMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Install JoyCaption
              </button>
              {joyCaptionInstallStatusData?.error && !joyCaptionInstallStatusData.installed && (
                <p className="text-xs text-gray-500">
                  {joyCaptionInstallStatusData.error}
                </p>
              )}
              {installJoyCaptionMutation.isError && (
                <p className="text-xs text-red-400">
                  {String(installJoyCaptionMutation.error)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
