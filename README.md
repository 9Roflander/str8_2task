# str8_2task

Privacy-first AI meeting assistant for local transcription and summarization.

## Overview

str8_2task is a desktop application that captures, transcribes, and summarizes meetings entirely on your local machine. All processing happens locally—no data leaves your device.

## Features

- Real-time transcription using Whisper or Parakeet models
- AI-powered meeting summaries
- Multi-platform support (macOS, Windows, Linux)
- GPU acceleration support
- Complete privacy—all data stays local

## Installation

### Windows

Download the latest release from [Releases](https://github.com/9Roflander/str8_2task/releases/latest).

### macOS

Download the DMG file for your architecture from [Releases](https://github.com/9Roflander/str8_2task/releases/latest).

### Linux

Build from source:

```bash
git clone https://github.com/9Roflander/str8_2task.git
cd str8_2task/frontend
pnpm install
pnpm run tauri:build
```

## Development

### Prerequisites

- Node.js (v18+)
- Rust (latest stable)
- pnpm (v8+)
- Python 3.12+ (for backend)

### Setup

```bash
git clone https://github.com/9Roflander/str8_2task.git
cd str8_2task/frontend
pnpm install
pnpm run tauri:dev
```

## Running the Application (macOS)

To run the full application on macOS, you need to start both the backend and frontend services.

### Quick Start

**Terminal 1 - Backend Server:**
```bash
cd backend
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 5167 --reload
```

**Terminal 2 - Frontend/Tauri App:**
```bash
cd frontend
pnpm tauri:dev
```

The Tauri app window will open automatically once compilation completes. The backend API will be available at `http://localhost:5167`.

### Alternative: Using Helper Scripts

**Start Backend with Whisper Server:**
```bash
cd backend
./clean_start_backend.sh [model-name]
# Example: ./clean_start_backend.sh small
```

This script will:
- Start the Whisper transcription server (optional, if using Whisper models)
- Start the Python FastAPI backend on port 5167
- Handle model downloads and port configuration

**Start Frontend:**
```bash
cd frontend
pnpm tauri:dev
```

### Service URLs

- **Backend API**: http://localhost:5167
- **API Documentation**: http://localhost:5167/docs
- **Frontend Dev Server**: http://localhost:3118 (Next.js)
- **Whisper Server** (if started): http://localhost:8178 (default)

### Troubleshooting

- **App window doesn't appear**: Check Mission Control (F3) or press Cmd+Tab to cycle through apps
- **Port already in use**: Kill existing processes with `lsof -ti:5167 | xargs kill -9`
- **Backend won't start**: Ensure virtual environment is activated and dependencies are installed
- **Tauri compilation errors**: Run `cargo clean` in `frontend/src-tauri` and try again

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
