# Web Python IDE (Pyodide + Monaco)

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL in your browser.

## Build for production

```bash
npm run build
npm run preview
```

## Features
- Monaco-based Python editor
- Run code via Pyodide (in WebWorker)
- Line trace view (sys.settrace) to observe execution
- Inline unittest runner with a tests pane

## Notes
- Requires network access to fetch Pyodide from CDN.
- Workers are built as ES modules (see `vite.config.ts`).
