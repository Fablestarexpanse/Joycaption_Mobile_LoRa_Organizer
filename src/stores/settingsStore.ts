import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  triggerWord: string;
  /** Previous trigger word, used when changing it so we remove the old one from all tags */
  previousTriggerWord: string;
  /** When true, trigger word input is disabled and cannot be changed */
  triggerWordLocked: boolean;
  thumbnailSize: number;
  autoSelectFirst: boolean;
  /** When true, show a confirmation dialog before clearing tags on a single image */
  confirmBeforeClearTags: boolean;
  setTriggerWord: (word: string) => void;
  setPreviousTriggerWord: (word: string) => void;
  setTriggerWordLocked: (locked: boolean) => void;
  setThumbnailSize: (size: number) => void;
  setAutoSelectFirst: (value: boolean) => void;
  setConfirmBeforeClearTags: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      triggerWord: "",
      previousTriggerWord: "",
      triggerWordLocked: false,
      thumbnailSize: 256,
      autoSelectFirst: true,
      confirmBeforeClearTags: true,
      setTriggerWord: (triggerWord) => set({ triggerWord }),
      setPreviousTriggerWord: (previousTriggerWord) => set({ previousTriggerWord }),
      setTriggerWordLocked: (triggerWordLocked) => set({ triggerWordLocked }),
      setThumbnailSize: (thumbnailSize) => set({ thumbnailSize }),
      setAutoSelectFirst: (autoSelectFirst) => set({ autoSelectFirst }),
      setConfirmBeforeClearTags: (confirmBeforeClearTags) => set({ confirmBeforeClearTags }),
    }),
    {
      name: "lora-studio-settings",
    }
  )
);
