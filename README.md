# LoRA Dataset Studio

A modern, cross-platform desktop application for preparing image datasets for AI model training (LoRA, DreamBooth, Textual Inversion, etc.). Built to make tagging and captioning thousands of images fast and enjoyable.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

### Image Management
- **Responsive Grid View** — Auto-fills the window; resize to see more or fewer columns
- **Rating System** — Mark images as Good, Bad, or Needs Edit (keyboard: 1, 2, 3)
- **Multi-Select** — Ctrl+Click to select multiple images for batch operations
- **Image Preview** — Double-click or Enter to view full-size image with zoom
- **Crop** — Interactive crop with aspect presets, rotate, flip; optionally save as new image
- **Delete** — Remove image and its caption file from the folder (with confirmation)
- **Sort** — By name, size, extension, or dimensions; ascending/descending
- **Loading Progress** — Visual overlay when scanning large folders

### Tag Editing
- **Inline Editing** — Click caption area under any image to edit tags
- **Right Panel Editor** — Tag list with drag-to-reorder and quick delete
- **Search & Replace** — Find and replace across all tags with regex support
- **Live Highlighting** — Matches highlighted as you type
- **Trigger Word** — Set a trigger word; kept first in all tags, with optional lock
- **Add Tag to All** — Add a tag to every image (front or end), with live preview
- **Clear Tags** — Per-image “clear all tags” (with optional confirm) and toolbar “Clear All Tags” (type “delete” to confirm)
- **Auto-Save** — Changes saved to `.txt` caption files

### AI Captioning
- **LM Studio** — Connect to local LM Studio; any vision model; custom prompts and templates
- **Ollama** — Same OpenAI-compatible API; use `llava` or other vision models locally
- **JoyCaption** — One-click installer; LLaVA-based model; modes: Descriptive, Straightforward, Booru, Training
- **Batch** — One model load per batch for JoyCaption; parallel requests for LM Studio/Ollama
- **Stop** — Cancel batch captioning mid-run; progress is kept up to the current chunk
- **Per-Image** — Generate caption from the grid or from the AI panel with preview

### Filtering & Navigation
- **Search** — Filter by filename or tag content
- **Caption Status** — Show only captioned or uncaptioned
- **Rating Filter** — Filter by Good, Bad, or Needs Edit
- **Keyboard** — Arrow keys, Home/End, Enter to preview

### Export
- **Export Wizard** — Export to folder or ZIP
- **Export by Rating** — Copy into `good/`, `bad/`, `needs_edit/` subfolders
- **Options** — Trigger word, sequential naming, only captioned

## Tech Stack

- **Desktop:** [Tauri 2](https://v2.tauri.app/) (Rust backend, native webview)
- **Frontend:** React 18, TypeScript, [Vite](https://vitejs.dev/)
- **State:** [Zustand](https://github.com/pmndrs/zustand) (persist) + [TanStack Query](https://tanstack.com/query/latest)
- **Styling:** Tailwind CSS, dark theme
- **Icons:** [Lucide React](https://lucide.dev/)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (for Tauri)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS:
  - **Windows:** WebView2, Visual Studio Build Tools
  - **macOS:** Xcode Command Line Tools
  - **Linux:** See Tauri docs

For JoyCaption: Python 3.10+ (auto-installer). CUDA GPU recommended.

## Installation

```bash
git clone https://github.com/Fablestarexpanse/Joycaption_Mobile_LoRa_Organizer.git
cd Joycaption_Mobile_LoRa_Organizer
npm install
```

## Development

```bash
npm run tauri dev
```

First Rust build can take a few minutes; later runs are faster.

## Building

```bash
npm run tauri build
```

Installers: `src-tauri/target/release/bundle/`.

## Usage

1. **Open** — Choose a folder of images
2. **Edit** — Click caption under an image to edit tags
3. **AI** — Pick provider (LM Studio, Ollama, or JoyCaption), Test connection, then Generate (single or Batch)
4. **Filter / Sort** — Use the filter bar and sort options
5. **Export** — Export dataset or by rating

### Keyboard Shortcuts

| Action        | Shortcut    |
|---------------|------------|
| Navigate      | Arrow keys |
| Multi-select  | Ctrl+Click |
| Preview       | Enter / Double-click |
| Good / Bad / Edit | 1 / 2 / 3 |
| Close modal   | Escape     |

## Project Structure

```
├── src/                 # React frontend
│   ├── components/      # ai, editor, grid, layout, preview, export, etc.
│   ├── hooks/           # useProject
│   ├── stores/          # Zustand (ai, filter, selection, settings, …)
│   ├── lib/             # Tauri API (tauri.ts)
│   └── types/
├── src-tauri/
│   ├── src/commands/    # Rust: captions, images, lm_studio, ollama, joycaption, export, …
│   └── resources/       # joycaption_inference.py
└── docs/
```

## Caption Format

One `.txt` per image, same base name; comma-separated tags (Kohya/OneTrainer compatible):

```
image001.png
image001.txt  → "trigger_word, tag1, tag2, description"
```

## AI Integration

### LM Studio
1. Run [LM Studio](https://lmstudio.ai/), load a vision model, start server (default http://localhost:1234)
2. In the app: AI provider → LM Studio → Settings → Test → pick model → Generate

### Ollama
1. Install [Ollama](https://ollama.com/), run `ollama pull llava` (or another vision model)
2. In the app: AI provider → Ollama → Settings → Test (default http://localhost:11434/v1) → pick model → Generate

### JoyCaption
1. AI provider → JoyCaption → Install JoyCaption (one-click venv + model)
2. Choose mode (Descriptive, Booru, etc.) → Generate or Batch

## Contributing

Contributions welcome: issues and pull requests.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [Tauri](https://tauri.app/) for the desktop framework
- [JoyCaption](https://huggingface.co/John6666/llama-joycaption-beta-one-hf-llava-nf4) for the captioning model
- The LoRA and diffusion training community
