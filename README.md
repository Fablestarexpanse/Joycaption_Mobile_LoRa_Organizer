# LoRA Dataset Studio

A desktop app for preparing image datasets for AI training (LoRA, DreamBooth, etc.). Tag and caption images, use local AI (LM Studio or Ollama), and export to folder or ZIP.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Grid & ratings** — Open a folder, rate images (Good / Bad / Needs Edit), multi-select, sort, search
- **Tag editing** — Inline captions, right-panel editor, search/replace, trigger word, add-tag-to-all with preview
- **AI captioning** — LM Studio or Ollama; vision models; single or batch; rating filter
- **Preview** — Full-size view with zoom, prev/next, crop; ratings editable in preview
- **Export** — Folder or ZIP; export all, selected, or by rating (good/bad/needs_edit subfolders); trigger word, sequential naming
- **Tools** — Batch resize, find duplicates, clear all tags (type "clear" to confirm), clear all ratings

## Tech

- **Desktop:** [Tauri 2](https://v2.tauri.app/) (Rust + webview)
- **Frontend:** React 18, TypeScript, Vite, Zustand, TanStack Query, Tailwind

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) (stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (e.g. WebView2 on Windows, Xcode CLI on macOS)

## Install & run

```bash
git clone <your-repo-url>
cd Joycaption_Mobile_LoRa_Organizer
npm install
npm run tauri dev
```

First build can take several minutes. Then:

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/` (installers for your platform).

## AI captioning setup

### LM Studio

1. **Download:** [LM Studio](https://lmstudio.ai/) — free, run LLMs locally.
2. **Install** and open LM Studio.
3. **Get a vision model:** Search (e.g. "llava" or "llama 3.2 vision"), download a quantized vision model (e.g. LLaVA 1.5 7B, Llama 3.2 Vision). You need a model that supports images.
4. **Load the model:** In Chat / Load Model, select the model and load it.
5. **Start server:** Open the **Local Server** tab, select your model, click **Start Server**. Default URL: `http://localhost:1234`.
6. **In the app:** AI tab → **LM Studio** → set URL (e.g. `http://localhost:1234`) → **Test** → pick model → **Generate Caption** or **Batch**.

**Links:** [LM Studio](https://lmstudio.ai/) · [Docs](https://lmstudio.ai/docs/) · [Model hub](https://lmstudio.ai/models)

### Ollama

1. **Download:** [Ollama](https://ollama.com/) — install for your OS.
2. **Pull a vision model:** e.g. `ollama pull llava` (or another [vision model](https://ollama.com/library)).
3. **In the app:** AI tab → **Ollama** → URL usually `http://localhost:11434/v1` → **Test** → pick model → **Generate Caption** or **Batch**.

**Links:** [Ollama](https://ollama.com/) · [Library](https://ollama.com/library)

### Tips

- Use a **vision** model (LLaVA, Llama 3.2 Vision, etc.); text-only models won’t caption images.
- **Settings → Preview AI caption before saving** lets you accept/reject before overwriting.

## Usage

1. **Open** a folder of images.
2. **Edit tags** — click caption under an image or use the right panel.
3. **Rate** — Good / Bad / Needs Edit (or 1 / 2 / 3 when focused).
4. **AI** — Choose LM Studio or Ollama, Test, then Generate Caption (single) or Batch.
5. **Export** — Export → choose what to export (all, selected, by rating, etc.) → pick destination.

### Shortcuts

| Action            | Shortcut        |
|-------------------|-----------------|
| Navigate grid     | Arrow keys      |
| First / last      | Home / End      |
| Multi-select      | Ctrl+Click      |
| Preview           | Enter / double-click |
| Close             | Escape          |
| Zoom (preview)    | + / −           |
| Prev/next (preview) | ← / →         |
| Undo / redo       | Ctrl+Z / Ctrl+Y |
| Rating 1/2/3      | 1 / 2 / 3 (when image selected) |
| Help              | ?               |

## Caption format

One `.txt` per image, same base name; comma-separated tags (e.g. Kohya/OneTrainer compatible):

```
image001.png
image001.txt  →  "trigger_word, tag1, tag2, ..."
```

## Project layout

```
src/           — React app (components, hooks, stores, lib)
src-tauri/     — Rust backend (commands: captions, images, lm_studio, ollama, export, …)
```

## License

MIT — see [LICENSE](LICENSE).
