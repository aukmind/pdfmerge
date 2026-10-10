import { geometryOfPage } from './geometry.js';
import { imageTagOf } from './ops.js';
import { mapLimit } from '../util.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export const PDF_MIME = 'application/pdf';

export function baseName(name) {
    return name.replace(/\.pdf$/i, '');
}

export class PDFHandler {
    constructor() {
        this.items = new Map();
        this.order = [];
        this.pending = new Set();
    }

    uniqueName(name) {
        const taken = (n) => this.items.has(n) || this.pending.has(n);
        if (!taken(name)) return name;
        const base = baseName(name);
        for (let i = 2; ; i++) {
            const candidate = `${base} (${i}).pdf`;
            if (!taken(candidate)) return candidate;
        }
    }

    async add(file) {
        const name = this.uniqueName(file.name);
        if (name !== file.name) file = new File([file], name, { type: PDF_MIME });

        let doc = null;
        let status = 'ok';
        this.pending.add(name);
        try {
            doc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
            // pdf-lib happily "loads" junk with no page tree; that only blows up on first use.
            if (doc.getPageCount() < 1) throw new Error('No pages');
        } catch (err) {
            doc = null;
            status = /encrypt/i.test(err.message) ? 'locked' : 'broken';
        } finally {
            this.pending.delete(name);
        }

        this.items.set(name, { file, doc, status, versions: [], generation: 0, pdfPromise: null, thumbnails: new Map(), texts: new Map(), geometries: null });
        this.order.push(name);
        return name;
    }

    names() {
        return [...this.order];
    }

    info(name) {
        const item = this.items.get(name);
        if (!item) return null;
        return {
            name,
            file: item.file,
            size: item.file.size,
            status: item.status,
            pageCount: item.doc ? item.doc.getPageCount() : 0,
            edits: item.versions.length,
        };
    }

    file(name) {
        return this._require(name).file;
    }

    // Returns the name actually used (".pdf" appended, made unique), or null if unchanged.
    rename(name, wanted) {
        const item = this._require(name);
        const clean = wanted.trim().replace(/[\\/:*?"<>|]+/g, '-');
        if (!clean) return null;
        const target = /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
        if (target === name) return null;
        const next = this.uniqueName(target);
        item.file = new File([item.file], next, { type: PDF_MIME });
        this.items.delete(name);
        this.items.set(next, item);
        this.order[this.order.indexOf(name)] = next;
        return next;
    }

    // Swaps in new contents under the same name, keeping the previous file for undo() unless history is off.
    // keepPages: leading pages known to be unchanged, whose thumbnails stay valid.
    async replace(name, bytes, { history = true, keepPages = 0 } = {}) {
        const item = this._require(name);
        const file = new File([bytes], name, { type: PDF_MIME });
        const doc = await PDFLib.PDFDocument.load(bytes);
        if (history) item.versions = [...item.versions.slice(-19), item.file];
        this._swap(item, file, doc, keepPages);
    }

    original(name) {
        const item = this._require(name);
        return item.versions[0] || null;
    }

    async undo(name) {
        const item = this._require(name);
        const file = item.versions.at(-1);
        if (!file) return false;
        let doc = null;
        try {
            doc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
        } catch {}
        item.versions = item.versions.slice(0, -1);
        this._swap(item, file, doc);
        return true;
    }

    _swap(item, file, doc, keepPages = 0) {
        const thumbnails = new Map();
        for (const [page, url] of item.thumbnails) {
            if (page <= keepPages) thumbnails.set(page, url);
            else URL.revokeObjectURL(url);
        }
        item.pdfPromise?.then(pdf => pdf.destroy(), () => {});
        Object.assign(item, {
            file, doc, status: doc ? 'ok' : item.status, generation: item.generation + 1,
            pdfPromise: null, thumbnails, texts: new Map(), geometries: null, imageTags: null,
        });
    }

    remove(name) {
        const item = this.items.get(name);
        if (!item) return;
        item.removed = true;
        for (const url of item.thumbnails.values()) URL.revokeObjectURL(url);
        item.pdfPromise?.then(pdf => pdf.destroy(), () => {});
        this.items.delete(name);
        this.order = this.order.filter(n => n !== name);
    }

    // Shared, read-only parse. Never mutate it: tools that edit use freshDoc().
    doc(name) {
        const item = this._require(name);
        if (!item.doc) throw new Error(item.status === 'locked' ? `${name} is password-protected` : `${name} could not be read`);
        return item.doc;
    }

    async freshDoc(name) {
        this.doc(name);
        return PDFLib.PDFDocument.load(await this.file(name).arrayBuffer());
    }

    // pdf-lib's getPage() walks the whole page tree, so compute every page once.
    geometry(name, pageNumber) {
        const item = this._require(name);
        item.geometries ??= this.doc(name).getPages().map(geometryOfPage);
        return item.geometries[pageNumber - 1];
    }

    imageTag(name, pageNumber) {
        const item = this._require(name);
        item.imageTags ??= this.doc(name).getPages().map(imageTagOf);
        return item.imageTags[pageNumber - 1];
    }

    async thumbnail(name, pageNumber) {
        const item = this._require(name);
        if (item.thumbnails.has(pageNumber)) return item.thumbnails.get(pageNumber);
        const generation = item.generation;
        const canvas = await this.renderCanvas(name, pageNumber, 0.8);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
        releaseCanvas(canvas);
        // Removed, or edited in place while rendering: this image shows old contents.
        if (item.removed || item.generation !== generation) return null;
        const url = URL.createObjectURL(blob);
        item.thumbnails.set(pageNumber, url);
        return url;
    }

    // Caller owns the returned URL.
    async renderUrl(name, pageNumber, scale) {
        const canvas = await this.renderCanvas(name, pageNumber, scale);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        releaseCanvas(canvas);
        return URL.createObjectURL(blob);
    }

    async renderCanvas(name, pageNumber, scale) {
        return renderPageToCanvas(await (await this._pdf(name)).getPage(pageNumber), scale);
    }

    // Text runs in reading space (page unrotated, top-left origin, y on the baseline).
    // `display` keeps each run's transform as shown on screen, for drawing boxes over it.
    async textItems(name, pageNumber) {
        const item = this._require(name);
        if (item.texts.has(pageNumber)) return item.texts.get(pageNumber);
        const page = await (await this._pdf(name)).getPage(pageNumber);
        const reading = page.getViewport({ scale: 1, rotation: 0 });
        const shown = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items
            .filter(run => run.str !== undefined)
            .map(run => {
                const t = pdfjsLib.Util.transform(reading.transform, run.transform);
                return {
                    str: run.str,
                    x: t[4],
                    y: t[5],
                    size: Math.hypot(t[2], t[3]),
                    width: run.width,
                    eol: run.hasEOL,
                    font: content.styles[run.fontName]?.fontFamily,
                    display: pdfjsLib.Util.transform(shown.transform, run.transform),
                };
            });
        const result = { width: reading.width, height: reading.height, displayWidth: shown.width, displayHeight: shown.height, items };
        item.texts.set(pageNumber, result);
        return result;
    }

    async pageText(name, pageNumber) {
        const { items } = await this.textItems(name, pageNumber);
        return items.map(run => run.str + (run.eol ? '\n' : '')).join('').replace(/[ \t]+/g, ' ');
    }

    // Every page's text runs; pages are fetched concurrently so the pdf.js worker stays busy.
    async allTextItems(name, onProgress = null) {
        const count = this.doc(name).getPageCount();
        let done = 0;
        return mapLimit(Array.from({ length: count }, (_, i) => i + 1), 8, async (p) => {
            const result = await this.textItems(name, p);
            onProgress?.(++done / count);
            return result;
        });
    }

    // Normalized display rects around case-insensitive matches, one per run a match touches.
    // Whitespace is ignored so phrases split across runs still match.
    async findText(name, query) {
        const needle = query.split('').filter(ch => !/\s/.test(ch)).map(foldCase).join('');
        if (!needle) return [];
        const hits = [];
        const pages = await this.allTextItems(name);
        for (const [i, { displayWidth, displayHeight, items }] of pages.entries()) {
            const chars = [];
            for (const run of items) {
                for (let c = 0; c < run.str.length; c++) {
                    if (!/\s/.test(run.str[c])) chars.push({ run, c, ch: foldCase(run.str[c]) });
                }
            }
            const hay = chars.map(x => x.ch).join('');
            for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
                const end = at + needle.length;
                for (let start = at, k = at + 1; k <= end; k++) {
                    if (k < end && chars[k].run === chars[start].run) continue;
                    const { run, c } = chars[start];
                    hits.push({ page: i + 1, rect: runBox(run, c, chars[k - 1].c + 1, displayWidth, displayHeight) });
                    start = k;
                }
            }
        }
        return hits;
    }

    _require(name) {
        const item = this.items.get(name);
        if (!item) throw new Error(`PDF not found: ${name}`);
        return item;
    }

    _pdf(name) {
        const item = this._require(name);
        // pdf.js takes ownership of the buffer it's given, so every caller shares one load.
        item.pdfPromise ??= item.file.arrayBuffer().then(data => pdfjsLib.getDocument({ data }).promise);
        return item.pdfPromise;
    }
}

// Keeps one UTF-16 unit per unit so match offsets line up with the run's characters.
function foldCase(ch) {
    const lower = ch.toLowerCase();
    return lower.length === 1 ? lower : ch;
}

const offsetCache = new WeakMap();
let measureCtx = null;

// Where each character starts along a run: browser metrics for a similar font, scaled to the run's real width.
function glyphOffsets(run) {
    if (offsetCache.has(run)) return offsetCache.get(run);
    measureCtx ??= document.createElement('canvas').getContext('2d');
    measureCtx.font = `100px ${run.font || 'sans-serif'}`;
    const n = run.str.length;
    const total = measureCtx.measureText(run.str).width;
    const offsets = [0];
    for (let c = 1; c <= n; c++) {
        offsets.push(run.width * (total ? measureCtx.measureText(run.str.slice(0, c)).width / total : c / n));
    }
    offsetCache.set(run, offsets);
    return offsets;
}

function runBox(run, fromChar, toChar, displayWidth, displayHeight) {
    const [a, b, c, d, e, f] = run.display;
    const along = Math.hypot(a, b) || 1;
    const across = Math.hypot(c, d) || 1;
    const dir = [a / along, b / along];
    const up = [c / across, d / across];
    const offsets = glyphOffsets(run);
    // The metrics are only an estimate and a redaction box must not miss ink, so pad generously.
    const pad = across * 0.15 + 1;
    const from = offsets[fromChar] - pad;
    const to = offsets[toChar] + pad;
    const corners = [[from, -0.25], [to, -0.25], [from, 0.9], [to, 0.9]].map(([s, h]) => [
        e + dir[0] * s + up[0] * h * across,
        f + dir[1] * s + up[1] * h * across,
    ]);
    const xs = corners.map(pt => pt[0]);
    const ys = corners.map(pt => pt[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return { x: x0 / displayWidth, y: y0 / displayHeight, w: (Math.max(...xs) - x0) / displayWidth, h: (Math.max(...ys) - y0) / displayHeight };
}

export async function renderPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' }).promise;
    return canvas;
}

// Frees a canvas's backing store now instead of whenever GC gets to it.
export function releaseCanvas(canvas) {
    canvas.width = canvas.height = 0;
}

export function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) =>
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality)
    );
}

export async function canvasToBytes(canvas, type, quality) {
    return new Uint8Array(await (await canvasToBlob(canvas, type, quality)).arrayBuffer());
}
