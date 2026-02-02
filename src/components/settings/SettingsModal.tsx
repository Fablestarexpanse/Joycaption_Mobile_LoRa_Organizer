import { useRef } from "react";
import { X, Settings } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAiStore } from "@/stores/aiStore";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    triggerWord,
    setTriggerWord,
    thumbnailSize,
    setThumbnailSize,
    autoSelectFirst,
    setAutoSelectFirst,
    confirmBeforeClearTags,
    setConfirmBeforeClearTags,
    previewBeforeSaveCaption,
    setPreviewBeforeSaveCaption,
  } = useSettingsStore();

  const {
    lmStudio,
    setLmStudioUrl,
    setLmStudioModel,
    ollama,
    setOllamaBaseUrl,
    setOllamaModel,
  } = useAiStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        ref={contentRef}
        className="w-full max-w-lg rounded-lg border border-border bg-surface-elevated shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <Settings className="h-5 w-5" />
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] space-y-6 overflow-auto p-4">
          {/* General */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              General
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Default Trigger Word
                </label>
                <input
                  type="text"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value)}
                  placeholder="e.g., my_character"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used as default in export. Leave empty for none.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Thumbnail Size: {thumbnailSize}px
                </label>
                <input
                  type="range"
                  min={128}
                  max={384}
                  step={32}
                  value={thumbnailSize}
                  onChange={(e) => setThumbnailSize(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoSelectFirst}
                  onChange={(e) => setAutoSelectFirst(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">
                  Auto-select first image when opening folder
                </span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmBeforeClearTags}
                  onChange={(e) => setConfirmBeforeClearTags(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">
                  Confirm before clearing tags on an image
                </span>
              </label>
              {!confirmBeforeClearTags && (
                <p className="text-xs text-amber-500">
                  When disabled, clearing tags will happen immediately and you
                  won&apos;t get a chance to cancel.
                </p>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={previewBeforeSaveCaption}
                  onChange={(e) => setPreviewBeforeSaveCaption(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">
                  Preview AI caption before saving
                </span>
              </label>
              <p className="text-xs text-gray-500">
                When enabled, generating from the grid shows a preview so you can
                Accept or Reject before overwriting.
              </p>
            </div>
          </section>

          {/* AI Settings */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              AI Captioning
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  LM Studio URL
                </label>
                <input
                  type="text"
                  value={lmStudio.base_url}
                  onChange={(e) => setLmStudioUrl(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200"
                  placeholder="http://localhost:1234"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  LM Studio Model (optional)
                </label>
                <input
                  type="text"
                  value={lmStudio.model ?? ""}
                  onChange={(e) => setLmStudioModel(e.target.value || null)}
                  placeholder="Leave empty to pick after Test"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Ollama Base URL
                </label>
                <input
                  type="text"
                  value={ollama.base_url}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200"
                  placeholder="http://localhost:11434/v1"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Ollama Model (optional)
                </label>
                <input
                  type="text"
                  value={ollama.model ?? ""}
                  onChange={(e) => setOllamaModel(e.target.value || null)}
                  placeholder="e.g. llava"
                  className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
              About
            </h3>
            <p className="text-sm text-gray-400">
              LoRA Dataset Studio v0.1.0
            </p>
            <p className="text-xs text-gray-500">
              A tool for preparing image datasets for AI model training.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
