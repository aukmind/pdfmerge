# PDF Editor

A PDF toolbox that runs entirely in the browser. Files are never uploaded: every operation happens locally in JavaScript/WebAssembly.

## Tools

| Group | Tool | What it does |
|---|---|---|
| Organize | Organize | Reorder (drag), rotate, delete and extract pages; page numbers (six positions, formats, custom start, live preview); change how image pages were converted |
| Edit | Edit | Text, boxes, ellipses, lines, highlights, white-out and images on top of pages, with undo |
| | Crop | Page by page: crop, and the next page is ready with the same box; or crop all pages at once |
| | Fill form | Fill text, checkbox, dropdown, list and radio fields; optionally flatten |
| Convert | From PDF | Save as JPG/PNG (screen, standard or print resolution), Markdown or plain text |
| | To PDF | Images (JPG/PNG/WebP/GIF/BMP) or camera scans to one PDF, with page size, orientation and margins |
| Security | Protect | Add a password (AES-256 + permissions), unlock protected PDFs so they can be added, repair damaged files |
| | Sign | Draw, type or upload a signature, then click on the page to place it; copy to every page |
| | Redact | Draw boxes or find text; redacted pages are flattened to images so the text is really gone |
| | Watermark | Text or image, opacity, angle, optional tiling, live preview |
| | Compare | Word-level text and pixel diff against the version before your changes or another PDF |

You build **one document**. Add PDFs with the **+** button (bottom left) or by dropping them anywhere: the first becomes the document and later ones are appended at the end. Dropped images are converted to pages and appended too (their page size and margins can be changed later in Organize). Password-protected or damaged files wait in a notice until they're unlocked or repaired. Pages keep the order the files were added in. Tools edit the document **in place** — Download it when you're done (the arrow next to Download also offers Sign and Protect), and **Undo change** steps back through every edit (adding files included). Tools that make a separate file (extract pages, To PDF, protected copy) download it directly. Crop works page by page: crop, and the next page is ready with the same box. Signatures are kept on the device only when "Remember on this device" is ticked. Text (Edit, Sign, Watermark, page numbers, typed signatures) can use the PDF standard fonts, any font installed on the device (Chrome/Edge, after allowing font access) or a .ttf/.otf file. Crop, Edit, Sign and Redact zoom with a pinch, ctrl/⌘ + wheel or the zoom buttons, re-rendered sharp.

## Running locally

ES modules, the shared theme at `/naive-ui-theme.js` and the modules in `/shared/` (icons, options, fonts, zoom — shared with `/image/`) need an HTTP server rooted at the site, not `file://`:

```
cd aukmind.github.io && python3 -m http.server
# open http://localhost:8000/pdfmerge/
```

Unit tests for the pure modules (page ranges, rotation geometry, Markdown extraction) use Node's built-in runner: `npm test`.

## Layout

- `js/main.js` — app shell, document bar, tool navigation, page viewer
- `js/store.js` — shared state, file loading and appending, thumbnail queue
- `js/tools.js` — tool registry (labels, hints, icons)
- `js/pdf/` — PDF logic: `handler.js` (loading, rendering, text), `ops.js` (pdf-lib operations), `geometry.js` (rotated-page coordinates), `ranges.js`, `markdown.js`, `images.js`, `qpdf.js`
- `js/components/` — one file per tool plus `shared.js` (page grid, selection bar, page stage)
- `#import` opens files handed over by another app on the site through `/shared/handoff.js` (the image toolbox's "Open in PDF Editor")

## Libraries

All loaded from CDNs with pinned versions: [pdf.js](https://mozilla.github.io/pdf.js/) (rendering, text), [pdf-lib](https://pdf-lib.js.org/) (editing), [qpdf-wasm](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm) (encryption, loaded on first use), [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) (custom fonts, loaded on first use), Vue 3 and Naive UI, SortableJS, jsdiff, JSZip, FileSaver.

## Limits

- Edit, Sign and Watermark use the 14 standard PDF fonts, which only cover Western European characters.
- Redact and the last-resort Repair path flatten pages to images, so their text is no longer selectable.
- Signatures are visual; there is no certificate-based digital signing.

## License

MIT
