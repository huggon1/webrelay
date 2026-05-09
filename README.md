# WebRelay

Chrome MV3 extension for local, reusable web extraction profiles.

Version 1 is local-first at runtime: saved profiles run in the extension without any backend. Codex Studio uses the optional local backend only to generate or revise profiles.

## Develop

```bash
npm install
npm test
npm run build
```

Load `extension/dist` as an unpacked extension in Chrome.

For manual testing, open `test-pages/chatbot.html` in Chrome and create a profile using the sample configuration in `test-pages/chatbot-config.md`.

## Codex Studio

The backend depends on the local Codex SDK/CLI login.

```bash
npm run dev:backend
```

Then open the extension popup, switch to Codex Studio, and generate a profile. After saving a profile, Quick Run and `Alt+Shift+E` continue to work even if the backend is stopped.
