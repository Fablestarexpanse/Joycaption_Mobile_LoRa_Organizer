import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProjectImages } from "@/hooks/useProject";
import { useSelectionStore } from "@/stores/selectionStore";
import { useFilterStore } from "@/stores/filterStore";
import { useProjectStore } from "@/stores/projectStore";
import { setImageRating } from "@/lib/tauri";
import { ThumbnailCell } from "./ThumbnailCell";
import type { ImageRating } from "@/types";

const MIN_THUMB_SIZE = 200;
const GAP = 12;

export function ImageGrid() {
  const gridRef = useRef<HTMLDivElement>(null);
  const innerGridRef = useRef<HTMLDivElement>(null);
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
  const rootPath = useProjectStore((s) => s.rootPath);
  const queryClient = useQueryClient();

  const invalidateProject = useCallback(() => {
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }, [queryClient, rootPath]);

  const ratingMutation = useMutation({
    mutationFn: async ({
      relative_path,
      rating,
    }: { relative_path: string; rating: ImageRating }) => {
      if (!rootPath) throw new Error("No project open");
      return setImageRating(rootPath, relative_path, rating);
    },
    onSuccess: invalidateProject,
  });

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

  // Keyboard navigation and rating shortcuts
  const handleKeyNav = useCallback(
    (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Rating shortcuts: 1 = good, 2 = bad, 3 = needs_edit (ergonomic, left hand)
      const ratingKey = e.key;
      if (
        (ratingKey === "1" || ratingKey === "2" || ratingKey === "3") &&
        selectedImage &&
        rootPath
      ) {
        const rating: ImageRating =
          ratingKey === "1" ? "good" : ratingKey === "2" ? "bad" : "needs_edit";
        e.preventDefault();
        const currentRating = selectedImage.rating;
        const newRating = currentRating === rating ? "none" : rating;
        ratingMutation.mutate({
          relative_path: selectedImage.relative_path,
          rating: newRating as ImageRating,
        });
        return;
      }

      const navigate = (delta: number) => {
        e.preventDefault();
        const newIndex = Math.max(0, Math.min(images.length - 1, selectedIndex + delta));
        if (newIndex !== selectedIndex && images[newIndex]) {
          setSelectedImage(images[newIndex]);
          // Scroll the selected cell into view
          const cell = gridRef.current?.querySelector(`[data-index="${newIndex}"]`);
          cell?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
            gridRef.current?.querySelector(`[data-index="0"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          break;
        case "End":
          if (images.length > 0) {
            e.preventDefault();
            setSelectedImage(images[images.length - 1]);
            gridRef.current?.querySelector(`[data-index="${images.length - 1}"]`)?.scrollIntoView({ behavior: "smooth", block: "end" });
          }
          break;
      }
    },
    [
      images,
      selectedIndex,
      setSelectedImage,
      columnCount,
      selectedImage,
      rootPath,
      ratingMutation,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [handleKeyNav]);

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

  return (
    <div
      ref={gridRef}
      className="h-full w-full overflow-auto rounded-lg focus:outline-none"
      role="listbox"
      aria-label="Image grid"
      tabIndex={-1}
    >
      <div
        ref={innerGridRef}
        className="grid items-start"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_THUMB_SIZE}px, 1fr))`,
          gap: `${GAP}px`,
          padding: `${GAP}px`,
        }}
      >
        {images.map((entry, index) => (
          <ThumbnailCell
            key={entry.id}
            entry={entry}
            size={MIN_THUMB_SIZE}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}
