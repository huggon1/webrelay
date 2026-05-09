# WebRelay

Chrome extension + local Node backend for structured web content extraction.

Capture a page, let Codex generate a reusable extraction recipe, then run it anytime from the popup or keyboard shortcut — no Codex call needed on repeat runs.

## Requirements

- Node.js 18+
- [Codex CLI](https://github.com/openai/codex) installed and logged in

```bash
npm install -g @openai/codex@latest
codex --login
```

## Setup

```bash
npm install
```

Build the extension:

```bash
npm run build:extension
```

Load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

Start the backend:

```bash
npm run dev:backend
```

The backend runs at `http://localhost:8787` and is only needed for Codex Studio (creating and repairing configurations). Quick Run and the keyboard shortcut work without it.

### Backend config

Create `backend/.env` (all fields optional):

```
PORT=8787
CODEX_MODEL=
CODEX_REASONING_EFFORT=
CODEX_WORKING_DIRECTORY=
```

## Usage

### Codex Studio

Opens when you click the extension icon on any HTTP/HTTPS page.

1. Enter an extraction intent, or leave blank to let Codex suggest fields.
2. Review the extracted preview.
3. Refine with feedback if needed.
4. Save the configuration.

Configurations are scoped to hostname — a config saved on `example.com/products/1` works across all `example.com` paths.

### Quick Run

The default tab. Lists saved configurations for the current hostname.

Each configuration can be run, renamed, deleted, or switched between **Copy**, **Download**, and **Copy + Download**. The selected action persists and is reused by the shortcut.

### Keyboard shortcut

`Alt+Shift+E` — runs the last successfully used configuration for the current hostname silently, no popup needed. Rebind at `chrome://extensions/shortcuts`.

## Development

```bash
npm test                           # all tests
npm test -w @extractor/shared      # shared only
npm test -w @extractor/backend     # backend only
npx tsc -p extension/tsconfig.json --noEmit  # extension type check
```
