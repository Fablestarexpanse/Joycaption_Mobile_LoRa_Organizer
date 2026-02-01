import { create } from "zustand";

interface UiState {
  isPreviewOpen: boolean;
  openPreview: () => void;
  closePreview: () => void;
  isCropOpen: boolean;
  openCrop: () => void;
  closeCrop: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPreviewOpen: false,
  openPreview: () => set({ isPreviewOpen: true }),
  closePreview: () => set({ isPreviewOpen: false }),
  isCropOpen: false,
  openCrop: () => set({ isCropOpen: true }),
  closeCrop: () => set({ isCropOpen: false }),
}));
