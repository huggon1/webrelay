# WebRelay

Chrome MV3 extension plus a local Node TypeScript backend for user-initiated web content extraction.

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

## Test

```bash
npm test
```
