# str8_2task

str8_2task is a privacy-first AI meeting copilot that records audio, transcribes it locally (Whisper/Parakeet engines), and generates summaries, clarifying questions, and structured minutes without sending any data to third-party services.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Repository Layout](#repository-layout)
4. [Mac Setup Guide (All Components)](#mac-setup-guide-all-components)
   - [1. Clone & bootstrap](#1-clone--bootstrap)
   - [2. Backend stack](#2-backend-stack)
   - [3. Frontend / Tauri desktop app](#3-frontend--tauri-desktop-app)
   - [4. Launch checklist](#4-launch-checklist)
5. [Development scripts](#development-scripts)
6. [Troubleshooting](#troubleshooting)
7. [License](#license)

---

## Architecture

| Piece        | Tech                                                     | Notes                                                           |
|--------------|----------------------------------------------------------|-----------------------------------------------------------------|
| Desktop UI   | Next.js 14 + Tauri 2                                     | Provides the meeting controls, transcript view, dashboards      |
| Audio stack  | Rust (CoreAudio capture, Whisper-rs / Parakeet ONNX)     | Records mic + system audio, handles VAD, chunking, transcription |
| Backend API  | Python 3.12 (FastAPI)                                    | Persists meeting data, exposes Jira/extension integrations      |
| Database     | SQLite via SQLx (Rust) / SQLAlchemy (Python)             | Stored in `~/Library/Application Support/com.str8_2task.ai/...` |
| LLM bridge   | Local models (Ollama) or remote providers (Gemini etc.)  | All requests proxied through the local backend                  |

Everything runs locally on macOS: audio capture, LLM calls (if using local models), summarization, and persistence.

---

## Prerequisites

Install the following once:

- **Homebrew** (recommended)  
- **Xcode Command Line Tools**: `xcode-select --install`
- **Rust toolchain** (stable) with `rustup`, plus `rustfmt` & `clippy`:  
  `rustup component add rustfmt clippy`
- **Node.js 18+** (via `nvm` or `fnm`)
- **pnpm 8+**: `npm install -g pnpm`
- **Python 3.12** + `virtualenv`
- **ffmpeg** (audio merge checkpoints): `brew install ffmpeg`

Optional for GPU acceleration:
- Apple Silicon: Metal is auto-enabled.
- Intel/NVIDIA: install appropriate drivers and set the Tauri feature flag (`pnpm tauri:dev:cuda`, etc.).

---

## Repository Layout

```
meeting-minutes/
├── backend/                 # FastAPI service, Whisper server helpers
│   ├── app/                 # FastAPI package
│   ├── scripts/             # helper launch scripts
│   └── venv/                # (ignored) local Python virtualenv
├── frontend/
│   ├── src/                 # Next.js app
│   ├── src-tauri/           # Tauri Rust crate
│   └── package.json
└── README.md
```

---

## Mac Setup Guide (All Components)

### 1. Clone & bootstrap

```bash
git clone https://github.com/9Roflander/str8_2task.git meeting-minutes
cd meeting-minutes
```

### 2. Backend stack

> Terminal A

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# start FastAPI + optional Whisper relay
uvicorn app.main:app --host 0.0.0.0 --port 5167 --reload
```

Backend services now listen at:
- API root: `http://localhost:5167`
- Docs: `http://localhost:5167/docs`

**Optional helper** (starts Whisper server + FastAPI in one go):
```bash
./clean_start_backend.sh small   # or large-v3, etc.
```

### 3. Frontend / Tauri desktop app

> Terminal B

```bash
cd frontend
pnpm install

# run Next.js + Tauri dev environment (Metal GPU by default on macOS)
pnpm tauri:dev
```

This runs:
- Next.js dev server on `http://localhost:3118`
- Tauri dev window (desktop app) with live reload

### 4. Launch checklist

1. **Backend healthy**: `curl http://localhost:5167/health` (should return 200).
2. **Tauri window** pops up. If it doesn’t, check Mission Control or logs in `/tmp/tauri-dev.log`.
3. **Audio permissions**: macOS will prompt the first time; approve “Microphone” + “Screen Recording” (for system audio capture).
4. **Start recording** from the UI. Logs stream to `/tmp/tauri-dev.log` (frontend) and `/tmp/tauri.log` (Rust).

---

## Development Scripts

| Command | Description |
|---------|-------------|
| `pnpm tauri:dev` | Run Next.js + Tauri dev with default features |
| `pnpm tauri:dev:cpu` | Force CPU-only build |
| `pnpm tauri:dev:metal` | Explicit Metal build (default on macOS) |
| `pnpm tauri:build` | Production desktop bundle |
| `./backend/clean_start_backend.sh <model>` | Launch backend + Whisper helper |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cargo` build fails with borrow errors | Check `/tmp/tauri-dev.log`; run `cd frontend/src-tauri && cargo fmt` + `cargo check` |
| Tauri window missing | `Cmd+Tab` through apps, or `tail -f /tmp/tauri-dev.log` for errors |
| Audio not captured | macOS privacy settings → enable Microphone & Screen Recording for `pnpm`/Tauri |
| Backend port in use | `lsof -ti:5167 | xargs kill -9` |
| LLM requests blocked | Ensure backend `.env` contains valid API keys or point to local Ollama |

---

## License

MIT — see [LICENSE.md](LICENSE.md).

---

### GitHub Push

This README rewrite is local only. I don’t have permission to push to GitHub from this environment—run your usual `git add/commit/push` when you’re ready. ***
