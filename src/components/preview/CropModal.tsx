import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Crop,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  Check,
} from "lucide-react";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { cropImage, getImageDataUrl } from "@/lib/tauri";

const HANDLE_SIZE = 14;

type DragMode = "draw" | "move" | "resize";
type ResizeHandle =
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
  mode: DragMode;
  handle?: ResizeHandle;
  startImgX: number;
  startImgY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}

const ASPECT_RATIOS: { label: string; value: number }[] = [
  { label: "1:1", value: 1 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:5", value: 4 / 5 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "2:1", value: 2 },
  { label: "1:2", value: 0.5 },
];

export function CropModal() {
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const closeCrop = useUiStore((s) => s.closeCrop);
  const rootPath = useProjectStore((s) => s.rootPath);
  const queryClient = useQueryClient();

  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [fixed, setFixed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [rotateDeg, setRotateDeg] = useState(0);
  const [expandFromCenter, setExpandFromCenter] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const isOpen = useUiStore((s) => s.isCropOpen);

  // Load image via backend (data URL) so it works without asset protocol
  const { data: imageSrc } = useQuery({
    queryKey: ["imageDataUrl", "crop", selectedImage?.path],
    queryFn: () => getImageDataUrl(selectedImage!.path, 2048),
    enabled: isOpen && !!selectedImage?.path,
    staleTime: 2 * 60 * 1000,
  });

  // Reset state and set dimensions from entry when opening (use original image dimensions for crop)
  useEffect(() => {
    if (isOpen && selectedImage) {
      setFlipX(false);
      setFlipY(false);
      setRotateDeg(0);
      setAspectRatio(null);
      const ow = selectedImage.width ?? 0;
      const oh = selectedImage.height ?? 0;
      setImgWidth(ow);
      setImgHeight(oh);
      setX(0);
      setY(0);
      setW(ow);
      setH(oh);
    }
  }, [isOpen, selectedImage]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // If we didn't have dimensions from entry, use loaded image size
    setImgWidth((prev) => (prev > 0 ? prev : img.naturalWidth));
    setImgHeight((prev) => (prev > 0 ? prev : img.naturalHeight));
    setW((prev) => (prev > 0 ? prev : img.naturalWidth));
    setH((prev) => (prev > 0 ? prev : img.naturalHeight));
  }, []);

  // Convert screen (clientX, clientY) to image coordinates
  const screenToImage = useCallback(
    (clientX: number, clientY: number): { imgX: number; imgY: number } | null => {
      const el = imageContainerRef.current;
      if (!el || imgWidth <= 0 || imgHeight <= 0) return null;
      const rect = el.getBoundingClientRect();
      const scaleX = rect.width / imgWidth;
      const scaleY = rect.height / imgHeight;
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const imgX = Math.max(0, Math.min(imgWidth, relX / scaleX));
      const imgY = Math.max(0, Math.min(imgHeight, relY / scaleY));
      return { imgX, imgY };
    },
    [imgWidth, imgHeight]
  );

  // Get crop rect in screen coordinates for hit-testing
  const getCropScreenRect = useCallback(() => {
    const el = imageContainerRef.current;
    if (!el || imgWidth <= 0 || imgHeight <= 0) return null;
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width / imgWidth;
    const scaleY = rect.height / imgHeight;
    return {
      left: rect.left + x * scaleX,
      top: rect.top + y * scaleY,
      right: rect.left + (x + w) * scaleX,
      bottom: rect.top + (y + h) * scaleY,
      width: w * scaleX,
      height: h * scaleY,
    };
  }, [imgWidth, imgHeight, x, y, w, h]);

  const hitTestHandle = useCallback(
    (clientX: number, clientY: number): ResizeHandle | null => {
      const sr = getCropScreenRect();
      if (!sr) return null;
      const near = (px: number, py: number, hx: number, hy: number) =>
        Math.hypot(px - hx, py - hy) <= HANDLE_SIZE;
      const { left, top, right, bottom, width, height } = sr;
      const cx = left + width / 2;
      const cy = top + height / 2;
      if (near(clientX, clientY, left, top)) return "nw";
      if (near(clientX, clientY, right, top)) return "ne";
      if (near(clientX, clientY, right, bottom)) return "se";
      if (near(clientX, clientY, left, bottom)) return "sw";
      if (near(clientX, clientY, cx, top)) return "n";
      if (near(clientX, clientY, right, cy)) return "e";
      if (near(clientX, clientY, cx, bottom)) return "s";
      if (near(clientX, clientY, left, cy)) return "w";
      return null;
    },
    [getCropScreenRect]
  );

  const isInsideCrop = useCallback(
    (clientX: number, clientY: number): boolean => {
      const sr = getCropScreenRect();
      if (!sr) return false;
      return (
        clientX >= sr.left &&
        clientX <= sr.right &&
        clientY >= sr.top &&
        clientY <= sr.bottom
      );
    },
    [getCropScreenRect]
  );

  const applyCropFromInteraction = useCallback(
    (newX: number, newY: number, newW: number, newH: number) => {
      const nx = Math.max(0, Math.min(imgWidth - 1, Math.round(newX)));
      const ny = Math.max(0, Math.min(imgHeight - 1, Math.round(newY)));
      const nw = Math.max(1, Math.min(imgWidth - nx, Math.round(newW)));
      const nh = Math.max(1, Math.min(imgHeight - ny, Math.round(newH)));
      setX(nx);
      setY(ny);
      setW(nw);
      setH(nh);
    },
    [imgWidth, imgHeight]
  );

  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (imgWidth <= 0 || imgHeight <= 0) return;
      const coords = screenToImage(e.clientX, e.clientY);
      if (!coords) return;
      const target = e.currentTarget as HTMLElement;
      if ("setPointerCapture" in target && "pointerId" in e.nativeEvent)
        target.setPointerCapture((e.nativeEvent as PointerEvent).pointerId);
      const { imgX, imgY } = coords;
      const handle = hitTestHandle(e.clientX, e.clientY);
      if (handle) {
        setDragState({
          mode: "resize",
          handle,
          startImgX: imgX,
          startImgY: imgY,
          startX: x,
          startY: y,
          startW: w,
          startH: h,
        });
      } else if (isInsideCrop(e.clientX, e.clientY)) {
        setDragState({
          mode: "move",
          startImgX: imgX,
          startImgY: imgY,
          startX: x,
          startY: y,
          startW: w,
          startH: h,
        });
      } else {
        setDragState({
          mode: "draw",
          startImgX: imgX,
          startImgY: imgY,
          startX: imgX,
          startY: imgY,
          startW: 0,
          startH: 0,
        });
      }
    },
    [
      imgWidth,
      imgHeight,
      screenToImage,
      hitTestHandle,
      isInsideCrop,
      x,
      y,
      w,
      h,
    ]
  );

  const handleImageMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState) return;
      const coords = screenToImage(e.clientX, e.clientY);
      if (!coords) return;
      const { imgX, imgY } = coords;
      const { mode, handle, startImgX, startImgY, startX, startY, startW, startH } =
        dragState;
      const centerX = startX + startW / 2;
      const centerY = startY + startH / 2;

      if (mode === "draw") {
        const nx = Math.min(startImgX, imgX);
        const ny = Math.min(startImgY, imgY);
        const nw = Math.max(1, Math.abs(imgX - startImgX));
        const nh = Math.max(1, Math.abs(imgY - startImgY));
        applyCropFromInteraction(nx, ny, nw, nh);
      } else if (mode === "move") {
        const dx = imgX - startImgX;
        const dy = imgY - startImgY;
        let nx = startX + dx;
        let ny = startY + dy;
        nx = Math.max(0, Math.min(imgWidth - startW, nx));
        ny = Math.max(0, Math.min(imgHeight - startH, ny));
        setX(Math.round(nx));
        setY(Math.round(ny));
      } else if (mode === "resize" && handle) {
        let nx: number, ny: number, nw: number, nh: number;
        if (expandFromCenter) {
          // Symmetric expand: center stays fixed, cursor defines that edge/corner; opposite side mirrors
          const cx = centerX;
          const cy = centerY;
          switch (handle) {
            case "se":
              nw = 2 * (imgX - cx);
              nh = 2 * (imgY - cy);
              nx = cx - nw / 2;
              ny = cy - nh / 2;
              break;
            case "sw":
              nw = 2 * (cx - imgX);
              nh = 2 * (imgY - cy);
              nx = imgX;
              ny = cy - nh / 2;
              break;
            case "ne":
              nw = 2 * (imgX - cx);
              nh = 2 * (cy - imgY);
              nx = cx - nw / 2;
              ny = imgY;
              break;
            case "nw":
              nw = 2 * (cx - imgX);
              nh = 2 * (cy - imgY);
              nx = imgX;
              ny = imgY;
              break;
            case "e":
              nw = 2 * (imgX - cx);
              nx = cx - nw / 2;
              ny = startY;
              nh = startH;
              break;
            case "w":
              nw = 2 * (cx - imgX);
              nx = imgX;
              ny = startY;
              nh = startH;
              break;
            case "s":
              nh = 2 * (imgY - cy);
              ny = cy - nh / 2;
              nx = startX;
              nw = startW;
              break;
            case "n":
              nh = 2 * (cy - imgY);
              ny = imgY;
              nx = startX;
              nw = startW;
              break;
            default:
              return;
          }
        } else {
          switch (handle) {
            case "nw":
              nx = imgX;
              ny = imgY;
              nw = startX + startW - imgX;
              nh = startY + startH - imgY;
              break;
            case "n":
              nx = startX;
              ny = imgY;
              nw = startW;
              nh = startY + startH - imgY;
              break;
            case "ne":
              nx = startX;
              ny = imgY;
              nw = imgX - startX;
              nh = startY + startH - imgY;
              break;
            case "e":
              nx = startX;
              ny = startY;
              nw = imgX - startX;
              nh = startH;
              break;
            case "se":
              nx = startX;
              ny = startY;
              nw = imgX - startX;
              nh = imgY - startY;
              break;
            case "s":
              nx = startX;
              ny = startY;
              nw = startW;
              nh = imgY - startY;
              break;
            case "sw":
              nx = imgX;
              ny = startY;
              nw = startX + startW - imgX;
              nh = imgY - startY;
              break;
            case "w":
              nx = imgX;
              ny = startY;
              nw = startX + startW - imgX;
              nh = startH;
              break;
            default:
              return;
          }
        }
        // Clamp to image and enforce min size
        nw = Math.max(1, nw);
        nh = Math.max(1, nh);
        if (nx < 0) {
          nw += nx;
          nx = 0;
        }
        if (ny < 0) {
          nh += ny;
          ny = 0;
        }
        if (nx + nw > imgWidth) nw = imgWidth - nx;
        if (ny + nh > imgHeight) nh = imgHeight - ny;
        nw = Math.max(1, nw);
        nh = Math.max(1, nh);
        applyCropFromInteraction(nx, ny, nw, nh);
      }
    },
    [
      dragState,
      screenToImage,
      applyCropFromInteraction,
      imgWidth,
      imgHeight,
      expandFromCenter,
    ]
  );

  const handleImageMouseUp = useCallback((e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if ("releasePointerCapture" in el && "pointerId" in e.nativeEvent)
      el.releasePointerCapture((e.nativeEvent as PointerEvent).pointerId);
    setDragState(null);
  }, []);

  const handleImageMouseLeave = useCallback(() => {
    setDragState(null);
  }, []);

  // End drag when mouse is released anywhere (e.g. outside the image)
  useEffect(() => {
    if (!dragState) return;
    const onWindowMouseUp = () => setDragState(null);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [dragState]);

  const applyAspectRatio = useCallback(
    (ratio: number, anchor: "w" | "h") => {
      if (anchor === "w") {
        const newH = Math.round(w / ratio);
        setH(Math.max(1, Math.min(newH, imgHeight)));
        if (y + Math.min(newH, imgHeight) > imgHeight) {
          setY(Math.max(0, imgHeight - Math.min(newH, imgHeight)));
        }
      } else {
        const newW = Math.round(h * ratio);
        setW(Math.max(1, Math.min(newW, imgWidth)));
        if (x + Math.min(newW, imgWidth) > imgWidth) {
          setX(Math.max(0, imgWidth - Math.min(newW, imgWidth)));
        }
      }
    },
    [w, h, x, y, imgWidth, imgHeight]
  );

  const handleWChange = (newW: number) => {
    const nw = Math.max(1, Math.min(newW, imgWidth - x));
    setW(nw);
    if (fixed && aspectRatio != null) {
      const newH = Math.round(nw / aspectRatio);
      setH(Math.max(1, Math.min(newH, imgHeight - y)));
    }
  };

  const handleHChange = (newH: number) => {
    const nh = Math.max(1, Math.min(newH, imgHeight - y));
    setH(nh);
    if (fixed && aspectRatio != null) {
      const newW = Math.round(nh * aspectRatio);
      setW(Math.max(1, Math.min(newW, imgWidth - x)));
    }
  };

  const invalidateProject = useCallback(() => {
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }, [queryClient, rootPath]);

  const cropMutation = useMutation({
    mutationFn: () =>
      cropImage({
        image_path: selectedImage!.path,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, Math.round(h)),
        flip_x: flipX,
        flip_y: flipY,
        rotate_degrees: rotateDeg,
        save_as_new: saveAsNew,
      }),
    onSuccess: () => {
      invalidateProject();
      closeCrop();
    },
  });

  if (!isOpen || !selectedImage) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      <div className="flex items-center justify-between border-b border-border bg-surface-elevated/95 px-4 py-2">
        <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
          <Crop className="h-5 w-5" />
          Crop image
        </h2>
        <button
          type="button"
          onClick={closeCrop}
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Image preview with crop overlay */}
        <div className="relative flex flex-1 items-center justify-center overflow-auto bg-gray-900 p-4">
          {imageSrc && (
            <div
              ref={imageContainerRef}
              role="img"
              aria-label="Crop area"
              className={`relative inline-block max-h-full max-w-full select-none ${
                dragState?.mode === "move" ? "cursor-grabbing" : "cursor-crosshair"
              }`}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onMouseLeave={handleImageMouseLeave}
            >
              <img
                src={imageSrc}
                alt=""
                className="max-h-[70vh] w-auto"
                onLoad={onImageLoad}
                draggable={false}
                style={{
                  transform: [
                    flipX ? "scaleX(-1)" : "",
                    flipY ? "scaleY(-1)" : "",
                    `rotate(${rotateDeg}deg)`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                }}
              />
              {highlight && imgWidth > 0 && imgHeight > 0 && (
                <>
                  <div
                    className="pointer-events-none absolute border-2 border-white/80 bg-black/30"
                    style={{
                      left: `${(x / imgWidth) * 100}%`,
                      top: `${(y / imgHeight) * 100}%`,
                      width: `${(w / imgWidth) * 100}%`,
                      height: `${(h / imgHeight) * 100}%`,
                    }}
                  />
                  {/* Resize handles (visual only; hit-testing is by position on container) */}
                  {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(
                    (handle) => {
                      const leftPct = (x / imgWidth) * 100;
                      const topPct = (y / imgHeight) * 100;
                      const rightPct = ((x + w) / imgWidth) * 100;
                      const bottomPct = ((y + h) / imgHeight) * 100;
                      const cx = (leftPct + rightPct) / 2;
                      const cy = (topPct + bottomPct) / 2;
                      let style: React.CSSProperties = {};
                      const size = 10;
                      if (handle === "nw")
                        style = { left: `${leftPct}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "n")
                        style = { left: `${cx}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "ne")
                        style = { left: `${rightPct}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "e")
                        style = { left: `${rightPct}%`, top: `${cy}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "se")
                        style = { left: `${rightPct}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "s")
                        style = { left: `${cx}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "sw")
                        style = { left: `${leftPct}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "w")
                        style = { left: `${leftPct}%`, top: `${cy}%`, transform: "translate(-50%, -50%)" };
                      return (
                        <div
                          key={handle}
                          className="pointer-events-none absolute rounded-full border-2 border-white bg-white/20"
                          style={{
                            ...style,
                            width: size,
                            height: size,
                          }}
                        />
                      );
                    }
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Controls panel */}
        <div className="w-80 shrink-0 space-y-4 overflow-auto border-l border-border bg-surface-elevated p-4">
          <div className="text-sm font-medium text-gray-400">Size and position</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">W (px)</label>
              <input
                type="number"
                min={1}
                max={imgWidth}
                value={w || ""}
                onChange={(e) => handleWChange(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">H (px)</label>
              <input
                type="number"
                min={1}
                max={imgHeight}
                value={h || ""}
                onChange={(e) => handleHChange(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">X (px)</label>
              <input
                type="number"
                min={0}
                max={imgWidth - 1}
                value={x}
                onChange={(e) => setX(Math.max(0, Math.min(imgWidth - w, parseInt(e.target.value, 10) || 0)))}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Y (px)</label>
              <input
                type="number"
                min={0}
                max={imgHeight - 1}
                value={y}
                onChange={(e) => setY(Math.max(0, Math.min(imgHeight - h, parseInt(e.target.value, 10) || 0)))}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
          </div>

          <div className="text-sm font-medium text-gray-400">Fixed selection</div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fixed}
                onChange={(e) => setFixed(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Fixed</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={highlight}
                onChange={(e) => setHighlight(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Highlight</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={expandFromCenter}
                onChange={(e) => setExpandFromCenter(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Expand from center</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveAsNew}
                onChange={(e) => setSaveAsNew(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Save as new image (keep original)</span>
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Aspect ratio</label>
            <div className="flex flex-wrap gap-1">
              {ASPECT_RATIOS.map(({ label, value }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setAspectRatio(value);
                    setFixed(true);
                    applyAspectRatio(value, w >= h ? "w" : "h");
                  }}
                  className={`rounded px-2 py-1 text-xs ${
                    aspectRatio === value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-sm font-medium text-gray-400">Transform</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRotateDeg((r) => (r + 90) % 360)}
              className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            >
              <RotateCw className="h-4 w-4" />
              Rotate
            </button>
            <button
              type="button"
              onClick={() => setFlipX((f) => !f)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                flipX ? "border-blue-500 bg-blue-600/20 text-blue-300" : "border-border bg-surface text-gray-200 hover:bg-gray-700"
              }`}
            >
              <FlipHorizontal className="h-4 w-4" />
              Flip X
            </button>
            <button
              type="button"
              onClick={() => setFlipY((f) => !f)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                flipY ? "border-blue-500 bg-blue-600/20 text-blue-300" : "border-border bg-surface text-gray-200 hover:bg-gray-700"
              }`}
            >
              <FlipVertical className="h-4 w-4" />
              Flip Y
            </button>
          </div>
          <p className="text-xs text-gray-500">Rotate: {rotateDeg}°</p>

          <div className="border-t border-border pt-4 space-y-2">
            <button
              type="button"
              onClick={() => cropMutation.mutate()}
              disabled={!w || !h || cropMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {cropMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : cropMutation.isSuccess ? (
                <Check className="h-4 w-4" />
              ) : (
                <Crop className="h-4 w-4" />
              )}
              {saveAsNew ? "Crop to new image" : "Crop selection (overwrite)"}
            </button>
            {cropMutation.isError && (
              <p className="text-xs text-red-400" role="alert">
                {cropMutation.error instanceof Error
                  ? cropMutation.error.message
                  : String(cropMutation.error)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
