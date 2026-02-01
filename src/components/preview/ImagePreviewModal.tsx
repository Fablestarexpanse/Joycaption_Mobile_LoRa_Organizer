import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Crop } from "lucide-react";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectImages } from "@/hooks/useProject";
import { useUiStore } from "@/stores/uiStore";
import { getImageDataUrl } from "@/lib/tauri";

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({ isOpen, onClose }: ImagePreviewModalProps) {
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const { data: images = [] } = useProjectImages();
  const openCrop = useUiStore((s) => s.openCrop);

  const [zoom, setZoom] = useState(1);

  const currentIndex = selectedImage
    ? images.findIndex((img) => img.id === selectedImage.id)
    : -1;

  // Load image via backend (data URL) so it works without asset protocol
  const { data: imageSrc } = useQuery({
    queryKey: ["imageDataUrl", selectedImage?.path],
    queryFn: () => getImageDataUrl(selectedImage!.path, 2048),
    enabled: isOpen && !!selectedImage?.path,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (isOpen && selectedImage) setZoom(1);
  }, [isOpen, selectedImage]);

  function handlePrev() {
    if (currentIndex > 0) {
      setSelectedImage(images[currentIndex - 1]);
    }
  }

  function handleNext() {
    if (currentIndex < images.length - 1) {
      setSelectedImage(images[currentIndex + 1]);
    }
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(z + 0.25, 3));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(z - 0.25, 0.5));
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handlePrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleNext();
          break;
        case "+":
        case "=":
          handleZoomIn();
          break;
        case "-":
          handleZoomOut();
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentIndex, images.length]);

  if (!isOpen || !selectedImage) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Full-size single image view - header */}
      <div className="flex items-center justify-between border-b border-border bg-surface-elevated/95 px-4 py-2">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {currentIndex + 1} / {images.length}
          </span>
          <span className="truncate text-sm text-gray-200" title={selectedImage.path}>
            {selectedImage.filename}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCrop()}
            className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
            title="Crop image"
          >
            <Crop className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
            title="Zoom out (-)"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="w-12 text-center text-sm text-gray-400">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
            title="Zoom in (+)"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Image container */}
      <div className="relative flex flex-1 items-center justify-center overflow-auto">
        {/* Prev button */}
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentIndex <= 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface-elevated/90 p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>

        {/* Image */}
        {imageSrc && (
          <img
            src={imageSrc}
            alt={selectedImage.filename}
            className="max-h-full max-w-full object-contain transition-transform duration-100"
            style={{ transform: `scale(${zoom})` }}
            draggable={false}
          />
        )}

        {/* Next button */}
        <button
          type="button"
          onClick={handleNext}
          disabled={currentIndex >= images.length - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface-elevated/90 p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      </div>

      {/* Tags footer - matches app surface/border */}
      {selectedImage.tags.length > 0 && (
        <div className="border-t border-border bg-surface-elevated/95 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {selectedImage.tags.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
