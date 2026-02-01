import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Smile, Frown, Wrench, Loader2, Maximize2, Crop, Trash2, X, Eraser, Check } from "lucide-react";
import {
  getThumbnailDataUrl,
  writeCaption,
  setImageRating,
  deleteImage,
} from "@/lib/tauri";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSearchReplaceStore } from "@/stores/searchReplaceStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { ImageEntry, ImageRating } from "@/types";

function parseTagsFromText(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Splits text by search (case-insensitive) and returns React nodes with matches highlighted */
function highlightMatches(text: string, search: string): React.ReactNode {
  if (!search.trim()) return text;
  try {
    const searchLower = search.trim().toLowerCase();
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(re);
    return parts.map((part, i) =>
      part.toLowerCase() === searchLower ? (
        <mark key={i} className="bg-yellow-500/70 text-yellow-900 dark:text-yellow-100 rounded px-0.5">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return text;
  }
}

/** Highlight the preview tag (add-tag-to-all) in the displayed text */
function highlightPreviewTag(text: string, tag: string): React.ReactNode {
  if (!tag.trim()) return text;
  try {
    const escaped = tag.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(re);
    return parts.map((part, i) =>
      part.toLowerCase() === tag.trim().toLowerCase() ? (
        <mark key={i} className="bg-blue-500/50 text-blue-100 rounded px-0.5">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return text;
  }
}

/** Highlight the trigger word (always at front, always visible) in the displayed text */
function highlightTriggerWord(text: string, trigger: string): React.ReactNode {
  if (!trigger.trim()) return text;
  try {
    const escaped = trigger.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(re);
    return parts.map((part, i) =>
      part.toLowerCase() === trigger.trim().toLowerCase() ? (
        <mark key={i} className="bg-purple-500/60 text-purple-100 rounded px-0.5">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return text;
  }
}

interface ThumbnailCellProps {
  entry: ImageEntry;
  size: number;
  index: number;
  /** True if this image would be included in batch captioning */
  isInCaptionBatch?: boolean;
}

export function ThumbnailCell({ entry, size, index, isInCaptionBatch = false }: ThumbnailCellProps) {
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const toggleSelection = useSelectionStore((s) => s.toggleSelection);
  const openPreview = useUiStore((s) => s.openPreview);
  const openCrop = useUiStore((s) => s.openCrop);
  const rootPath = useProjectStore((s) => s.rootPath);
  const queryClient = useQueryClient();

  const [captionText, setCaptionText] = useState(() => tagsToText(entry.tags));
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearTagsConfirm, setShowClearTagsConfirm] = useState(false);
  const captionInputRef = useRef<HTMLTextAreaElement>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const clearModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(deleteModalRef, showDeleteConfirm);
  useFocusTrap(clearModalRef, showClearTagsConfirm);
  const searchHighlightText = useSearchReplaceStore((s) => s.searchHighlightText);
  const addTagPreviewText = useSearchReplaceStore((s) => s.addTagPreviewText);
  const addTagPreviewAtFront = useSearchReplaceStore((s) => s.addTagPreviewAtFront);
  const addTagRatingFilter = useSearchReplaceStore((s) => s.addTagRatingFilter);
  const triggerWord = useSettingsStore((s) => s.triggerWord);
  const confirmBeforeClearTags = useSettingsStore((s) => s.confirmBeforeClearTags);

  const isSelected = selectedImage?.id === entry.id;
  const isMultiSelected = selectedIds.has(entry.id);

  const invalidateProject = useCallback(() => {
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }, [queryClient, rootPath]);

  const writeMutation = useMutation({
    mutationFn: async (tags: string[]) => writeCaption(entry.path, tags),
    onSuccess: invalidateProject,
  });

  const ratingMutation = useMutation({
    mutationFn: async (rating: ImageRating) => {
      if (!rootPath) throw new Error("No project open");
      return setImageRating(rootPath, entry.relative_path, rating);
    },
    onSuccess: invalidateProject,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteImage(entry.path),
    onSuccess: () => {
      if (selectedImage?.id === entry.id) {
        setSelectedImage(null);
      }
      invalidateProject();
    },
  });

  const displayText = tagsToText(entry.tags);
  const showAddTagPreview =
    addTagPreviewText.trim() !== "" &&
    (addTagRatingFilter === "all" || entry.rating === addTagRatingFilter);
  const previewTags =
    !showAddTagPreview
      ? entry.tags
      : addTagPreviewAtFront
        ? [addTagPreviewText.trim(), ...entry.tags]
        : [...entry.tags, addTagPreviewText.trim()];
  const previewDisplayText = tagsToText(previewTags);

  function handleCaptionFocus() {
    setIsEditing(true);
    setCaptionText(displayText);
  }

  useEffect(() => {
    if (isEditing && captionInputRef.current) {
      captionInputRef.current.focus();
    }
  }, [isEditing]);

  function handleCaptionBlur() {
    setIsEditing(false);
    let tags = parseTagsFromText(captionText);
    const tw = triggerWord?.trim();
    if (tw) {
      const withoutTrigger = tags.filter(
        (t) => t.trim().toLowerCase() !== tw.toLowerCase()
      );
      tags = [tw, ...withoutTrigger];
    }
    const prevTags = entry.tags;
    const tagsChanged =
      tags.length !== prevTags.length || tags.some((t, i) => t !== prevTags[i]);
    if (tagsChanged) {
      writeMutation.mutate(tags);
    } else {
      setCaptionText(displayText);
    }
  }

  function handleCaptionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setCaptionText(e.target.value);
  }

  function handleCaptionKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    }
  }

  function handleRatingClick(rating: ImageRating, e: React.MouseEvent) {
    e.stopPropagation();
    // Toggle: if already this rating, set to none
    const newRating = entry.rating === rating ? "none" : rating;
    ratingMutation.mutate(newRating);
  }

  const { data: src, isLoading, isError } = useQuery({
    queryKey: ["thumbnail", entry.path, size],
    queryFn: () => getThumbnailDataUrl(entry.path, size),
    staleTime: 5 * 60 * 1000,
  });

  function handleImageClick(e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click for multi-select
      toggleSelection(entry.id);
    } else {
      setSelectedImage(entry);
    }
  }

  function handleDoubleClick() {
    setSelectedImage(entry);
    openPreview();
  }

  function handleViewLarger(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedImage(entry);
    openPreview();
  }

  function handleCrop(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedImage(entry);
    openCrop();
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  }

  function handleDeleteConfirm() {
    setShowDeleteConfirm(false);
    deleteMutation.mutate();
  }

  function handleDeleteCancel() {
    setShowDeleteConfirm(false);
  }

  function doClearTags() {
    writeMutation.mutate([]);
    setCaptionText("");
  }

  function handleClearTagsClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmBeforeClearTags) {
      setShowClearTagsConfirm(true);
    } else {
      doClearTags();
    }
  }

  function handleClearTagsConfirm() {
    setShowClearTagsConfirm(false);
    doClearTags();
  }

  function handleClearTagsCancel() {
    setShowClearTagsConfirm(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (
      (e.target as HTMLElement).closest("textarea") ||
      (e.target as HTMLElement).closest("input")
    ) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setSelectedImage(entry);
      openPreview();
    } else if (e.key === " ") {
      e.preventDefault();
      setSelectedImage(entry);
    }
  }

  return (
    <div
      role="option"
      aria-selected={isSelected || isMultiSelected}
      aria-current={isSelected ? "true" : undefined}
      tabIndex={0}
      data-index={index}
      onClick={handleImageClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`group relative flex cursor-pointer flex-col rounded border-2 transition-colors ${
        isInCaptionBatch
          ? "border-green-500 bg-green-500/15"
          : isSelected
            ? "border-blue-500 bg-blue-500/10"
            : isMultiSelected
              ? "border-purple-500 bg-purple-500/10"
              : "border-border bg-surface-elevated hover:border-gray-500"
      }`}
    >
      {/* Multi-select indicator */}
      {isMultiSelected && (
        <div className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-purple-600 text-white">
          <Check className="h-3 w-3" />
        </div>
      )}

      {/* Caption indicator */}
      <div className="absolute right-1 top-1 z-10 flex gap-1">
        {entry.has_caption ? (
          <span
            className="h-2 w-2 rounded-full bg-green-500"
            title={`${entry.tags.length} tags`}
          />
        ) : (
          <span
            className="h-2 w-2 rounded-full bg-gray-500"
            title="No caption"
          />
        )}
      </div>

      {/* Thumbnail */}
      <div
        className="flex aspect-square w-full shrink-0 items-center justify-center bg-gray-800/50"
      >
        {isLoading && <span className="text-xs text-gray-500">…</span>}
        {isError && <span className="text-xs text-red-400">Err</span>}
        {src && (
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        )}
      </div>

      {/* Rating icons (Good / Bad / Edit), View larger, Crop, Delete, Generate — wrap to fit */}
      <div className="flex flex-wrap items-center justify-center gap-0.5 px-0.5 py-1">
        <button
          type="button"
          onClick={(e) => handleRatingClick("good", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "good"
              ? "bg-green-600 text-white"
              : "text-gray-500 hover:bg-green-600/20 hover:text-green-400"
          }`}
          title="Good (happy)"
        >
          <Smile className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRatingClick("bad", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "bad"
              ? "bg-red-600 text-white"
              : "text-gray-500 hover:bg-red-600/20 hover:text-red-400"
          }`}
          title="Bad (sad)"
        >
          <Frown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRatingClick("needs_edit", e)}
          className={`rounded p-0.5 transition-colors ${
            entry.rating === "needs_edit"
              ? "bg-yellow-600 text-white"
              : "text-gray-500 hover:bg-yellow-600/20 hover:text-yellow-400"
          }`}
          title="Needs Edit (wrench)"
        >
          <Wrench className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-3 w-px bg-gray-600" aria-hidden />
        <button
          type="button"
          onClick={handleViewLarger}
          className="rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-gray-200"
          title="View larger"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCrop}
          className="rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-gray-200"
          title="Crop image"
        >
          <Crop className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={deleteMutation.isPending}
          className="rounded p-0.5 text-gray-500 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-30"
          title="Delete image from folder"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClearTagsClick}
          disabled={writeMutation.isPending}
          className="rounded p-0.5 text-gray-500 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-30"
          title="Clear all tags for this image"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Delete confirmation modal — matches app style */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          role="dialog"
          aria-labelledby="delete-confirm-title"
          aria-modal="true"
        >
          <div
            ref={deleteModalRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface-elevated shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2
                id="delete-confirm-title"
                className="flex items-center gap-2 text-lg font-medium text-gray-100"
              >
                <Trash2 className="h-5 w-5 text-red-400" />
                Delete image?
              </h2>
              <button
                type="button"
                onClick={handleDeleteCancel}
                aria-label="Close"
                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-sm text-gray-400">
                Are you sure you want to delete this image from the folder? The
                file and its caption will be removed. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDeleteCancel}
                  className="flex flex-1 items-center justify-center rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={deleteMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear tags confirmation modal */}
      {showClearTagsConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          role="dialog"
          aria-labelledby="clear-tags-confirm-title"
          aria-modal="true"
        >
          <div
            ref={clearModalRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface-elevated shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2
                id="clear-tags-confirm-title"
                className="flex items-center gap-2 text-lg font-medium text-gray-100"
              >
                <Eraser className="h-5 w-5 text-amber-400" />
                Clear all tags?
              </h2>
              <button
                type="button"
                onClick={handleClearTagsCancel}
                aria-label="Close"
                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-sm text-gray-400">
                Remove all tags from this image. The caption file will be
                cleared. You can add new tags afterward.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClearTagsCancel}
                  className="flex flex-1 items-center justify-center rounded border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleClearTagsConfirm}
                  disabled={writeMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  {writeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eraser className="h-4 w-4" />
                  )}
                  Clear tags
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filename, dimensions, file size */}
      <div className="px-1 py-0.5">
        <p
          className="truncate text-xs text-gray-400"
          title={entry.filename}
        >
          {entry.filename}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-500">
          {(entry.width != null && entry.height != null && entry.width > 0 && entry.height > 0) && (
            <span title="Pixel dimensions">
              {entry.width}×{entry.height}
            </span>
          )}
          {entry.file_size != null && entry.file_size > 0 && (
            <span title="File size">
              {formatFileSize(entry.file_size)}
            </span>
          )}
        </div>
      </div>

      {/* Editable caption — keep tall when editing so you can see and add to it */}
      <div
        className={`px-1 pb-2 ${isEditing ? "min-h-[7rem] shrink-0" : ""}`}
      >
        {isEditing ? (
          <textarea
            ref={captionInputRef}
            value={captionText}
            onChange={handleCaptionChange}
            onBlur={handleCaptionBlur}
            onKeyDown={handleCaptionKeyDown}
            rows={Math.max(5, captionText.split("\n").length + 2)}
            placeholder="Add tags…"
            className="w-full min-h-[6rem] resize-y rounded border border-border bg-gray-800/80 px-2 py-1.5 text-xs leading-relaxed text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            style={{ minHeight: "6rem" }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            role="textbox"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleCaptionFocus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCaptionFocus();
              }
            }}
            className="min-h-[2.5rem] w-full cursor-text whitespace-pre-wrap break-words rounded border border-border bg-gray-800/80 px-2 py-1.5 text-xs leading-relaxed text-gray-200 hover:border-gray-600 focus:border-blue-500 focus:outline-none"
          >
            {showAddTagPreview ? (
              previewDisplayText ? (
                highlightPreviewTag(previewDisplayText, addTagPreviewText.trim())
              ) : (
                <span className="text-blue-400">{addTagPreviewText.trim()}</span>
              )
            ) : displayText ? (
              triggerWord.trim() ? (
                highlightTriggerWord(displayText, triggerWord.trim())
              ) : searchHighlightText.trim() ? (
                highlightMatches(displayText, searchHighlightText)
              ) : (
                displayText
              )
            ) : (
              <span className="text-gray-500">Add tags…</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
