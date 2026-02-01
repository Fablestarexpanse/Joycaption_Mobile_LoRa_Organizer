import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Download, FolderOpen, Archive, Loader2, Check } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectImages } from "@/hooks/useProject";
import { exportDataset, exportByRating, selectSaveFolder, selectSaveFile } from "@/lib/tauri";
import type { ExportResult } from "@/types";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const rootPath = useProjectStore((s) => s.rootPath);
  const { data: images = [] } = useProjectImages();

  const [destPath, setDestPath] = useState("");
  const [asZip, setAsZip] = useState(true);
  const [onlyCaptioned, setOnlyCaptioned] = useState(false);
  const [onlyGood, setOnlyGood] = useState(false);
  const [exportByRatingSubfolders, setExportByRatingSubfolders] = useState(false);
  const [triggerWord, setTriggerWord] = useState("");
  const [sequentialNaming, setSequentialNaming] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const captionedCount = images.filter((img) => img.has_caption).length;
  const goodCount = images.filter((img) => img.rating === "good").length;
  const badCount = images.filter((img) => img.rating === "bad").length;
  const needsEditCount = images.filter((img) => img.rating === "needs_edit").length;

  let willExport: number;
  if (exportByRatingSubfolders) {
    willExport = goodCount + badCount + needsEditCount;
  } else if (onlyGood) {
    willExport = onlyCaptioned
      ? images.filter((img) => img.rating === "good" && img.has_caption).length
      : goodCount;
  } else {
    willExport = onlyCaptioned ? captionedCount : images.length;
  }

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!rootPath || !destPath) throw new Error("Missing paths");
      if (exportByRatingSubfolders) {
        return exportByRating({
          source_path: rootPath,
          dest_path: destPath,
          trigger_word: triggerWord.trim() || null,
          sequential_naming: sequentialNaming,
        });
      }
      const relativePaths = onlyGood
        ? images.filter((img) => img.rating === "good").map((img) => img.relative_path)
        : null;
      return exportDataset({
        source_path: rootPath,
        dest_path: destPath,
        as_zip: asZip,
        only_captioned: onlyCaptioned,
        relative_paths: relativePaths && relativePaths.length > 0 ? relativePaths : null,
        trigger_word: triggerWord.trim() || null,
        sequential_naming: sequentialNaming,
      });
    },
    onSuccess: (res) => {
      setResult(res);
    },
    onError: (err: Error) => {
      setResult({
        success: false,
        exported_count: 0,
        skipped_count: 0,
        error: err.message ?? String(err),
        output_path: "",
      });
    },
  });

  async function handleSelectDest() {
    if (exportByRatingSubfolders) {
      const path = await selectSaveFolder();
      if (path) setDestPath(path);
      return;
    }
    if (asZip) {
      const path = await selectSaveFile("dataset.zip");
      if (path) setDestPath(path);
    } else {
      const path = await selectSaveFolder();
      if (path) setDestPath(path);
    }
  }

  function handleExport() {
    setResult(null);
    exportMutation.mutate();
  }

  function handleClose() {
    setResult(null);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-elevated shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <Download className="h-5 w-5" />
            Export Dataset
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Stats */}
          <div className="rounded bg-surface p-3 text-sm">
            <p className="text-gray-400">
              {images.length} total • {captionedCount} captioned
              {goodCount + badCount + needsEditCount > 0 && (
                <> • Good: {goodCount} • Bad: {badCount} • Edit: {needsEditCount}</>
              )}
            </p>
            <p className="mt-1 font-medium text-gray-200">
              {exportByRatingSubfolders
                ? `Will export ${willExport} into good/, bad/, needs_edit/`
                : `Will export: ${willExport} images`}
            </p>
            {exportByRatingSubfolders && willExport === 0 && (
              <p className="mt-1 text-xs text-amber-400">
                Rate images (Good / Bad / Edit) on thumbnails first.
              </p>
            )}
          </div>

          {/* Export by rating subfolders */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={exportByRatingSubfolders}
              onChange={(e) => {
                setExportByRatingSubfolders(e.target.checked);
                if (e.target.checked) setDestPath("");
              }}
              className="rounded border-gray-600"
            />
            <span className="text-sm text-gray-300">
              Export to subfolders by rating (good / bad / needs_edit)
            </span>
          </label>

          {!exportByRatingSubfolders && (
            <>
              {/* Format toggle */}
              <div>
                <label className="mb-2 block text-sm text-gray-400">Format</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAsZip(true); setDestPath(""); }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm ${
                      asZip
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <Archive className="h-4 w-4" />
                    ZIP Archive
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAsZip(false); setDestPath(""); }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm ${
                      !asZip
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Folder
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Destination */}
          <div>
            <label className="mb-1 block text-sm text-gray-400">
              {exportByRatingSubfolders
                ? "Parent folder (creates good/, bad/, needs_edit/ inside)"
                : asZip
                  ? "Save ZIP as"
                  : "Export to folder"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destPath}
                readOnly
                placeholder="Select destination..."
                className="flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
              <button
                type="button"
                onClick={handleSelectDest}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {!exportByRatingSubfolders && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyGood}
                  onChange={(e) => setOnlyGood(e.target.checked)}
                  className="rounded border-gray-600"
                />
                <span className="text-sm text-gray-300">Only export images rated Good (training set)</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyCaptioned}
                onChange={(e) => setOnlyCaptioned(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Only export captioned images</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sequentialNaming}
                onChange={(e) => setSequentialNaming(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Sequential naming (0001.png, 0002.png...)</span>
            </label>
          </div>

          {/* Trigger word */}
          <div>
            <label className="mb-1 block text-sm text-gray-400">
              Trigger word (prepended to captions)
            </label>
            <input
              type="text"
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              placeholder="e.g., my_character"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>

          {/* Result */}
          {result && (
            <div
              className={`rounded p-3 text-sm ${
                result.success ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"
              }`}
            >
              {result.success ? (
                <>
                  <p className="flex items-center gap-1 font-medium">
                    <Check className="h-4 w-4" />
                    Exported {result.exported_count} images
                  </p>
                  {result.skipped_count > 0 && (
                    <p className="mt-1 text-xs">Skipped: {result.skipped_count}</p>
                  )}
                </>
              ) : (
                <p>Error: {result.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            {result?.success ? "Done" : "Cancel"}
          </button>
          {!result?.success && (
            <button
              type="button"
              onClick={handleExport}
              disabled={!destPath || exportMutation.isPending || (exportByRatingSubfolders && willExport === 0)}
              className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {exportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
