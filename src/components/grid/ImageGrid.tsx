import { useRef, useEffect, useMemo, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import { useFilterStore } from "@/stores/filterStore";
import { useAiStore } from "@/stores/aiStore";
import { ThumbnailCell } from "./ThumbnailCell";

const MIN_THUMB_SIZE = 200;
const GAP = 12;
const ROW_GAP = 12; // Vertical spacing between rows (same as horizontal)
// Row height: image (200px) + buttons (~28px) + filename/info (~28px) + caption box (~80px avg) + padding (~10px) + row gap (12px)
const ROW_HEIGHT = 358;

export const ImageGrid = memo(function ImageGrid() {
  const gridRef = useRef<HTMLDivElement>(null);
  const { data: allImages = [], isLoading, isError } = useProjectImages();

  // Track columns for keyboard nav
  const [columnCount, setColumnCount] = useState(5);

  // Filter state
  const showCaptioned = useFilterStore((s) => s.showCaptioned);
  const tagFilter = useFilterStore((s) => s.tagFilter);
  const query = useFilterStore((s) => s.query);
  const ratingFilter = useFilterStore((s) => s.ratingFilter);

  // Selection state
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const batchCaptionRatingFilter = useAiStore((s) => s.batchCaptionRatingFilter);
  const batchCaptionRatingAll = useAiStore((s) => s.batchCaptionRatingAll);

  // IDs of images that would be included in batch captioning (for green outline)
  const captionBatchIds = useMemo(() => {
    // "All" = every image. Good/Bad/Needs Edit = all images with those ratings.
    let base: typeof allImages;
    if (batchCaptionRatingAll) {
      base = allImages;
    } else if (batchCaptionRatingFilter.size > 0) {
      base = allImages.filter((img) => batchCaptionRatingFilter.has(img.rating));
    } else {
      base =
        selectedIds.size > 0
          ? allImages.filter((img) => selectedIds.has(img.id))
          : allImages.filter((img) => !img.has_caption);
    }
    return new Set(base.map((img) => img.id));
  }, [allImages, selectedIds, batchCaptionRatingFilter, batchCaptionRatingAll]);
  // Update column count based on container width
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const updateColumns = () => {
      const width = container.clientWidth - GAP * 2; // subtract padding
      const cols = Math.max(1, Math.floor((width + GAP) / (MIN_THUMB_SIZE + GAP)));
      setColumnCount(cols);
    };

    updateColumns();

    const observer = new ResizeObserver(updateColumns);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Apply filters
  const filtered = useMemo(() => {
    let list = allImages;

    // Caption filter
    if (showCaptioned === true) {
      list = list.filter((img) => img.has_caption);
    } else if (showCaptioned === false) {
      list = list.filter((img) => !img.has_caption);
    }

    // Tag filter
    if (tagFilter) {
      const lowerTag = tagFilter.toLowerCase();
      list = list.filter((img) =>
        img.tags.some((t) => t.toLowerCase().includes(lowerTag))
      );
    }

    // Text query filter
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      list = list.filter(
        (img) =>
          img.filename.toLowerCase().includes(lowerQuery) ||
          img.tags.some((t) => t.toLowerCase().includes(lowerQuery))
      );
    }

    // Rating filter
    if (ratingFilter) {
      list = list.filter((img) => img.rating === ratingFilter);
    }

    return list;
  }, [allImages, showCaptioned, tagFilter, query, ratingFilter]);

  // Sort
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const images = useMemo(() => {
    const list = [...filtered];
    const mult = sortOrder === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = (a.filename ?? "").localeCompare(b.filename ?? "", undefined, { numeric: true });
      } else if (sortBy === "file_size") {
        const sa = a.file_size ?? 0;
        const sb = b.file_size ?? 0;
        cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
      } else if (sortBy === "dimension") {
        const areaA = (a.width ?? 0) * (a.height ?? 0);
        const areaB = (b.width ?? 0) * (b.height ?? 0);
        cmp = areaA < areaB ? -1 : areaA > areaB ? 1 : 0;
      } else {
        const extA = (a.filename ?? "").split(".").pop() ?? "";
        const extB = (b.filename ?? "").split(".").pop() ?? "";
        cmp = extA.localeCompare(extB);
      }
      return mult * cmp;
    });
    return list;
  }, [filtered, sortBy, sortOrder]);

  // Get current selected index
  const selectedIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return images.findIndex((img) => img.id === selectedImage.id);
  }, [selectedImage, images]);

  // Calculate rows based on column count
  const rowCount = Math.ceil(images.length / columnCount);

  // Virtual scrolling with dynamic sizing
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
    measureElement: (element) => element.getBoundingClientRect().height + ROW_GAP,
  });

  // Keyboard navigation (1/2/3 rating is handled globally in App via useRatingShortcuts)
  useEffect(() => {
    const handleKeyNav = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const navigate = (delta: number) => {
        e.preventDefault();
        const newIndex = Math.max(0, Math.min(images.length - 1, selectedIndex + delta));
        if (newIndex !== selectedIndex && images[newIndex]) {
          setSelectedImage(images[newIndex]);
          // Scroll to the row containing the selected image
          const rowIndex = Math.floor(newIndex / columnCount);
          rowVirtualizer.scrollToIndex(rowIndex, { align: "auto", behavior: "smooth" });
        }
      };

      switch (e.key) {
        case "ArrowRight":
          navigate(1);
          break;
        case "ArrowLeft":
          navigate(-1);
          break;
        case "ArrowDown":
          navigate(columnCount);
          break;
        case "ArrowUp":
          navigate(-columnCount);
          break;
        case "Home":
          if (images.length > 0) {
            e.preventDefault();
            setSelectedImage(images[0]);
            rowVirtualizer.scrollToIndex(0, { align: "start", behavior: "smooth" });
          }
          break;
        case "End":
          if (images.length > 0) {
            e.preventDefault();
            setSelectedImage(images[images.length - 1]);
            const lastRowIndex = Math.floor((images.length - 1) / columnCount);
            rowVirtualizer.scrollToIndex(lastRowIndex, { align: "end", behavior: "smooth" });
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [images, selectedIndex, setSelectedImage, columnCount, rowVirtualizer]);

  // Select first image when images load and nothing selected
  useEffect(() => {
    if (images.length > 0 && !selectedImage) {
      setSelectedImage(images[0]);
    }
  }, [images, selectedImage, setSelectedImage]);

  if (!allImages.length && !isLoading && !isError) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-gray-500">Open a folder to see the image grid.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-red-400">Failed to load images.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (images.length === 0 && allImages.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface-elevated/50 p-8 text-center">
        <p className="text-gray-500">No images match the current filter.</p>
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={gridRef}
      className="h-full w-full overflow-auto rounded-lg focus:outline-none"
      role="listbox"
      aria-label="Image grid"
      tabIndex={-1}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize() + GAP * 2}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount;
          const endIndex = Math.min(startIndex + columnCount, images.length);
          const rowImages = images.slice(startIndex, endIndex);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: GAP,
                right: GAP,
                transform: `translateY(${virtualRow.start + GAP}px)`,
                marginBottom: `${ROW_GAP}px`,
              }}
            >
              <div
                className="grid items-start"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                  gap: `${GAP}px`,
                }}
              >
                {rowImages.map((entry, colIndex) => {
                  const index = startIndex + colIndex;
                  return (
                    <ThumbnailCell
                      key={entry.id}
                      entry={entry}
                      size={MIN_THUMB_SIZE}
                      index={index}
                      isInCaptionBatch={captionBatchIds.has(entry.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
