# WebRelay

Chrome MV3 extension plus a local Node TypeScript backend for user-initiated web content extraction.

WebRelay captures a page snapshot, asks a local Codex SDK backend to generate a reusable extraction recipe, and lets the Chrome extension rerun that recipe from Quick Run without calling Codex again.

## Install

```bash
npm install
```

## Backend with Codex SDK

This backend uses the Codex SDK, not the OpenAI API. It depends on your local Codex CLI login.

Install or update Codex CLI:

```bash
npm install -g @openai/codex@latest
```

Log in:

```bash
codex --login
codex --version
```

Create `backend/.env`:

```bash
PORT=8787
CODEX_MODEL=
CODEX_REASONING_EFFORT=
CODEX_WORKING_DIRECTORY=
```

`CODEX_MODEL`, `CODEX_REASONING_EFFORT`, and `CODEX_WORKING_DIRECTORY` are optional. The backend starts short-lived read-only Codex threads and asks for structured JSON recipes only.

Run:

```bash
npm run dev:backend
```

## Extension

Build:

```bash
npm run build:extension
```

Load `extension/dist` as an unpacked extension in Chrome.

The extension talks to the local backend at `http://localhost:8787`.

### Codex Studio

Use Codex Studio to create or repair a configuration:

1. Open the popup on an HTTP/HTTPS page.
2. Enter an extraction intent, or leave it blank to let Codex suggest fields.
3. Review/refine the preview.
4. Save the configuration.

Saved configurations are scoped by hostname. For example, a configuration saved on `https://example.com/products/1` is available on other `example.com` paths, but not on `docs.example.com`.

### Quick Run

Quick Run lists saved configurations for the current hostname. Each configuration can be:

- Run without invoking Codex.
- Renamed.
- Deleted.
- Switched between `Copy`, `Download`, and `Copy + Download`.

The selected action is saved on the configuration and reused by the popup and keyboard shortcut.

### Keyboard Shortcut

The default shortcut is:

```text
Alt+Shift+E
```

It runs the last successfully used configuration for the current hostname. Chrome users can change the shortcut at `chrome://extensions/shortcuts`.

### Clipboard Permission

Copy actions use an MV3 offscreen document plus the `clipboardWrite` permission so popup runs and keyboard shortcut runs can both write to the clipboard. Download actions use Chrome's `downloads` permission.

## Test

```bash
npm test
```

Useful package-specific checks:

```bash
npm test -w @extractor/shared
npm test -w @extractor/backend
npm run build -w @extractor/extension
npx tsc -p extension/tsconfig.json --noEmit
```
