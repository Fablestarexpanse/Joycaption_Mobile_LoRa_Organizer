import { useState } from "react";
import { FolderOpen, Download, FileEdit, Settings, HelpCircle, Eraser } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { openFolder } from "@/lib/tauri";
import { ExportModal } from "../export/ExportModal";
import { BatchRenameModal } from "../rename/BatchRenameModal";
import { SettingsModal } from "../settings/SettingsModal";
import { HelpModal } from "../help/HelpModal";
import { ClearAllTagsModal } from "./ClearAllTagsModal";

export function Toolbar() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const setRootPath = useProjectStore((s) => s.setRootPath);
  const setIsLoadingProject = useProjectStore((s) => s.setIsLoadingProject);
  const setLastOpenedFolder = useProjectStore((s) => s.setLastOpenedFolder);

  const [showExport, setShowExport] = useState(false);
  const [showBatchRename, setShowBatchRename] = useState(false);
  const [showClearAllTags, setShowClearAllTags] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  async function handleOpen() {
    try {
      const path = await openFolder();
      if (path) {
        setLastOpenedFolder(path);
        setIsLoadingProject(true);
        setRootPath(path);
      }
    } catch (err) {
      console.error("Open folder failed:", err);
      setIsLoadingProject(false);
    }
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-elevated px-3">
        {/* Open */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10"
          aria-label="Open folder"
          onClick={handleOpen}
        >
          <FolderOpen className="h-4 w-4" />
          Open
        </button>

        {/* Export */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
          aria-label="Export dataset"
          onClick={() => setShowExport(true)}
          disabled={!rootPath}
        >
          <Download className="h-4 w-4" />
          Export
        </button>

        {/* Batch Rename */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
          aria-label="Batch rename"
          onClick={() => setShowBatchRename(true)}
          disabled={!rootPath}
        >
          <FileEdit className="h-4 w-4" />
          Batch Rename
        </button>

        {/* Clear all tags */}
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-50"
          aria-label="Clear all tags on all images"
          onClick={() => setShowClearAllTags(true)}
          disabled={!rootPath}
        >
          <Eraser className="h-4 w-4" />
          Clear All Tags
        </button>

        <span className="text-xs text-gray-500">|</span>

        {/* Title */}
        <span className="flex-1 text-xs text-gray-500">LoRA Dataset Studio</span>

        {/* Right side buttons */}
        <button
          type="button"
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          aria-label="Help"
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
          aria-label="Settings"
          onClick={() => setShowSettings(true)}
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* Modals */}
      <ExportModal isOpen={showExport} onClose={() => setShowExport(false)} />
      <BatchRenameModal isOpen={showBatchRename} onClose={() => setShowBatchRename(false)} />
      <ClearAllTagsModal
        isOpen={showClearAllTags}
        onClose={() => setShowClearAllTags(false)}
      />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
