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

### Setup

```bash
git clone https://github.com/9Roflander/str8_2task.git
cd str8_2task/frontend
pnpm install
pnpm run tauri:dev
```

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
