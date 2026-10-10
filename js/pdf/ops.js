import { geometryOfPage, toPdfPoint, toPdfRect, placement, centeredPlacement } from './geometry.js';
import { renderPageToCanvas, canvasToBytes, releaseCanvas } from './handler.js';
import { fontBytes, loadFontkit } from './fonts.js';

const { PDFDocument, PDFName, PDFString, StandardFonts, BlendMode, degrees, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = PDFLib;

// Must match the editor's CSS (line-height 1.2) so text lands where it was previewed.
export const TEXT_LINE_HEIGHT = 1.2;
const TEXT_BASELINE = 0.95;

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

export const FONTS = {
    helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
    times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
    courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

export const ANCHORS = {
    'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0],
    'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1],
};

export function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Standard fonts by name; device and file fonts (see fonts.js) are embedded as subsets.
export function fontLoader(doc) {
    const cache = new Map();
    const embedCustom = async (family, bold) => {
        doc.registerFontkit(await loadFontkit());
        try {
            return await doc.embedFont(await fontBytes(family, bold), { subset: true });
        } catch (err) {
            console.error(err);
            throw new Error(`The font ${family.replace(/^\w+:/, '')} can't be embedded in a PDF; pick another one`);
        }
    };
    return (family = 'helvetica', bold = false) => {
        const key = `${family}-${bold}`;
        if (!cache.has(key)) cache.set(key, FONTS[family] ? doc.embedFont(FONTS[family][bold ? 1 : 0]) : embedCustom(family, bold));
        return cache.get(key);
    };
}

function embedImage(doc, { bytes, type }) {
    return type === 'png' ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

function paint(el) {
    return {
        color: el.fill ? hexToRgb(el.fill) : undefined,
        borderColor: el.stroke ? hexToRgb(el.stroke) : undefined,
        borderWidth: el.stroke ? el.strokeWidth : 0,
    };
}

const KEPT_PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'Rotate'].map(key => PDFName.of(key)));

// copyPages follows links and annotation /P refs into other pages, so pages left out must hold nothing worth copying.
function blankPages(doc, keep) {
    doc.getPages().forEach((page, i) => {
        if (keep.has(i)) return;
        for (const key of page.node.keys()) if (!KEPT_PAGE_KEYS.has(key)) page.node.delete(key);
        page.node.set(PDFName.of('Resources'), doc.context.obj({}));
    });
}

// Source to copy `used` page indices from; a private parse with the other pages blanked when only some are used.
async function copySource(handler, name, used) {
    const doc = handler.doc(name);
    if (used.size === doc.getPageCount()) return doc;
    const fresh = await handler.freshDoc(name);
    blankPages(fresh, used);
    return fresh;
}

export async function composePages(handler, pages) {
    const out = await PDFDocument.create();
    const byName = new Map();
    for (const p of pages) {
        if (!byName.has(p.name)) byName.set(p.name, new Set());
        byName.get(p.name).add(p.index);
    }
    const sources = new Map();
    const copied = new Map();
    for (const [name, used] of byName) {
        const src = await copySource(handler, name, used);
        sources.set(name, src);
        const indices = [...used];
        const pdfPages = await out.copyPages(src, indices);
        indices.forEach((index, i) => copied.set(`${name}#${index}`, pdfPages[i]));
    }
    // copyPages returns one object per index, so re-copy duplicates instead of adding the same page twice.
    const added = new Set();
    for (const p of pages) {
        const key = `${p.name}#${p.index}`;
        let page = copied.get(key);
        if (added.has(key)) [page] = await out.copyPages(sources.get(p.name), [p.index]);
        added.add(key);
        if (p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
        out.addPage(page);
    }
    return out.save();
}

// Keeps the base document's own structure (outline, form) and adds every page of the others after it.
export async function appendDocuments(handler, base, names) {
    const out = await handler.freshDoc(base);
    for (const name of names) {
        const src = handler.doc(name);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(page => out.addPage(page));
    }
    return out.save();
}

// Stamp sizes are given for the document's full-size pages; smaller (e.g. cropped) pages get them
// scaled down so the stamp looks the same everywhere instead of growing as the page shrinks.
export function stampScale(geom, referenceWidth) {
    return referenceWidth ? geom.width / referenceWidth : 1;
}

export function referenceWidth(geometries) {
    return Math.max(...geometries.map(g => g.width));
}

export function formatPageNumber(format, n, total) {
    return format.replace('{n}', n).replace('{total}', total);
}

export async function addPageNumbers(doc, { pages, position, format, start, size, margin, color, font: family = 'helvetica', bold = false }) {
    const font = await fontLoader(doc)(family, bold);
    const [au, av] = ANCHORS[position];
    const total = start + pages.length - 1;
    const all = doc.getPages();
    const geometries = all.map(geometryOfPage);
    const ref = referenceWidth(geometries);
    pages.forEach((pageNumber, i) => {
        const page = all[pageNumber - 1];
        const geom = geometries[pageNumber - 1];
        const k = stampScale(geom, ref);
        const s = size * k;
        const m = margin * k;
        const text = formatPageNumber(format, start + i, total);
        const tw = font.widthOfTextAtSize(text, s);
        const dx = au === 0 ? m : au === 1 ? geom.width - m - tw : (geom.width - tw) / 2;
        const dy = av === 0 ? m + s * 0.75 : geom.height - m;
        const at = toPdfPoint(geom, dx / geom.width, dy / geom.height);
        page.drawText(text, { x: at.x, y: at.y, size: s, font, color: hexToRgb(color), rotate: degrees(geom.rotation) });
    });
    return doc.save();
}

export function tileCenters(geom, w, h, angle) {
    const rad = Math.abs((angle * Math.PI) / 180);
    const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    const stepX = bw * 1.4 + 24;
    const stepY = bh * 1.8 + 24;
    const centers = [];
    let row = 0;
    for (let y = stepY / 2; y < geom.height + stepY / 2; y += stepY, row++) {
        const offset = row % 2 ? stepX / 2 : 0;
        for (let x = stepX / 2 - offset; x < geom.width + stepX / 2; x += stepX) {
            centers.push([x / geom.width, y / geom.height]);
        }
    }
    return centers;
}

export async function addWatermark(doc, opts) {
    const { pages, opacity, angle, tile } = opts;
    let size;
    let drawAt;
    if (opts.kind === 'image') {
        const image = await embedImage(doc, opts.image);
        size = (geom) => {
            const w = geom.width * opts.scale;
            return [w, (w * image.height) / image.width];
        };
        drawAt = (page, p, w, h) => page.drawImage(image, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(p.rotate), opacity });
    } else {
        const font = await fontLoader(doc)(opts.font, opts.bold);
        const color = hexToRgb(opts.color);
        size = (geom, k) => {
            const s = opts.size * k;
            return [font.widthOfTextAtSize(opts.text, s), s * 0.7, s];
        };
        drawAt = (page, p, w, h, s) => page.drawText(opts.text, { x: p.x, y: p.y, size: s, font, color, opacity, rotate: degrees(p.rotate) });
    }
    const all = doc.getPages();
    const geometries = all.map(geometryOfPage);
    const ref = referenceWidth(geometries);
    for (const pageNumber of pages) {
        const page = all[pageNumber - 1];
        const geom = geometries[pageNumber - 1];
        const [w, h, s] = size(geom, stampScale(geom, ref));
        for (const [u, v] of tile ? tileCenters(geom, w, h, angle) : [[0.5, 0.5]]) {
            drawAt(page, centeredPlacement(geom, u, v, w, h, angle), w, h, s);
        }
    }
    return doc.save();
}

export async function cropPages(doc, rect, pages) {
    const all = doc.getPages();
    for (const pageNumber of pages) {
        const page = all[pageNumber - 1];
        const r = toPdfRect(geometryOfPage(page), rect);
        page.setCropBox(r.x, r.y, r.width, r.height);
    }
    return doc.save();
}

export async function drawAnnotations(doc, elements, assets) {
    const font = fontLoader(doc);
    const images = new Map();
    const imageFor = (id) => {
        if (!images.has(id)) images.set(id, embedImage(doc, assets[id]));
        return images.get(id);
    };
    const all = doc.getPages();
    const geometries = new Map();

    for (const el of elements) {
        const page = all[el.page - 1];
        if (!geometries.has(el.page)) geometries.set(el.page, geometryOfPage(page));
        const geom = geometries.get(el.page);
        const rotate = degrees(geom.rotation);

        if (el.type === 'text') {
            const f = await font(el.font, el.bold);
            const color = hexToRgb(el.color);
            el.text.split('\n').forEach((line, i) => {
                if (!line) return;
                const dy = el.y * geom.height + el.size * (TEXT_BASELINE + i * TEXT_LINE_HEIGHT);
                const at = toPdfPoint(geom, el.x, dy / geom.height);
                page.drawText(line, { x: at.x, y: at.y, size: el.size, font: f, color, rotate });
            });
        } else if (el.type === 'line') {
            page.drawLine({
                start: toPdfPoint(geom, el.x1, el.y1),
                end: toPdfPoint(geom, el.x2, el.y2),
                thickness: el.strokeWidth,
                color: hexToRgb(el.stroke),
            });
        } else if (el.type === 'ellipse') {
            const c = toPdfPoint(geom, el.x + el.w / 2, el.y + el.h / 2);
            const sideways = geom.rotation % 180 !== 0;
            const rx = (el.w * geom.width) / 2;
            const ry = (el.h * geom.height) / 2;
            page.drawEllipse({
                x: c.x, y: c.y,
                xScale: sideways ? ry : rx,
                yScale: sideways ? rx : ry,
                ...paint(el),
            });
        } else if (el.type === 'image') {
            const p = placement(geom, el);
            page.drawImage(await imageFor(el.asset), { x: p.x, y: p.y, width: p.width, height: p.height, rotate });
        } else {
            const p = placement(geom, el);
            const highlight = el.type === 'highlight';
            page.drawRectangle({
                x: p.x, y: p.y, width: p.width, height: p.height, rotate,
                ...paint(el),
                opacity: highlight ? 0.4 : 1,
                blendMode: highlight ? BlendMode.Multiply : undefined,
            });
        }
    }
    return doc.save();
}

export function readFormFields(doc) {
    return doc.getForm().getFields().map(field => {
        const base = { name: field.getName(), readOnly: field.isReadOnly() };
        if (field instanceof PDFTextField) return { ...base, type: 'text', value: field.getText() || '', multiline: field.isMultiline() };
        if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() };
        if (field instanceof PDFDropdown) return { ...base, type: 'select', options: field.getOptions(), value: field.getSelected()[0] ?? null };
        if (field instanceof PDFOptionList) return { ...base, type: 'multiselect', options: field.getOptions(), value: field.getSelected() };
        if (field instanceof PDFRadioGroup) return { ...base, type: 'radio', options: field.getOptions(), value: field.getSelected() ?? null };
        return { ...base, type: 'unsupported' };
    });
}

export async function fillForm(doc, values, flatten) {
    const form = doc.getForm();
    for (const [name, value] of Object.entries(values)) {
        const field = form.getField(name);
        if (field.isReadOnly()) continue;
        if (field instanceof PDFTextField) field.setText(value || undefined);
        else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
        else if (field instanceof PDFDropdown) value ? field.select(value) : field.clear();
        else if (field instanceof PDFOptionList) value?.length ? field.select(value) : field.clear();
        else if (field instanceof PDFRadioGroup) value ? field.select(value) : field.clear();
    }
    if (flatten) form.flatten();
    return doc.save();
}

// Marks pages made from an image, so they can be rebuilt with other options; survives copyPages.
const IMAGE_TAG = PDFName.of('PdfEditorImage');

export function imageTagOf(page) {
    return page.node.get(IMAGE_TAG)?.decodeText?.() ?? null;
}

export const DEFAULT_IMAGE_OPTIONS = { pageSize: 'fit', orientation: 'auto', margin: 0, enhance: false };

// images: [{ bytes, type: 'jpg' | 'png', width, height, tag? }] in pixels.
export async function imagesToPdf(images, { pageSize, orientation, margin }) {
    const doc = await PDFDocument.create();
    for (const img of images) {
        const embedded = await embedImage(doc, img);
        const iw = (img.width * 72) / 96;
        const ih = (img.height * 72) / 96;
        let pw;
        let ph;
        if (pageSize === 'fit') {
            pw = iw + margin * 2;
            ph = ih + margin * 2;
        } else {
            [pw, ph] = PAGE_SIZES[pageSize];
            const landscape = orientation === 'landscape' || (orientation === 'auto' && iw > ih);
            if (landscape) [pw, ph] = [ph, pw];
        }
        const scale = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
        const w = iw * scale;
        const h = ih * scale;
        const page = doc.addPage([pw, ph]);
        page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        if (img.tag) page.node.set(IMAGE_TAG, PDFString.of(img.tag));
    }
    return doc.save();
}

// replacements: Map of 0-based index -> bytes of a one-page PDF. Each new page keeps the old one's rotation.
export async function replacePages(doc, replacements) {
    for (const [index, bytes] of replacements) {
        const src = await PDFDocument.load(bytes);
        const [page] = await doc.copyPages(src, [0]);
        page.setRotation(doc.getPage(index).getRotation());
        doc.removePage(index);
        doc.insertPage(index, page);
    }
    return doc.save();
}

async function pageToImagePage(out, canvas, geom) {
    const image = await out.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.92));
    releaseCanvas(canvas);
    out.addPage([geom.width, geom.height]).drawImage(image, { x: 0, y: 0, width: geom.width, height: geom.height });
}

// Pages with boxes become flat images so the covered text is gone, not just hidden.
// flattenAll: every page becomes an image, so no text anywhere in the file can be copied.
export async function redact(handler, name, boxesByPage, { flattenAll = false } = {}) {
    const count = handler.doc(name).getPageCount();
    const keep = [];
    for (let i = 0; i < count; i++) if (!flattenAll && !boxesByPage.has(i + 1)) keep.push(i);
    const src = await copySource(handler, name, new Set(keep));
    const out = await PDFDocument.create();
    const copied = new Map((await out.copyPages(src, keep)).map((page, i) => [keep[i], page]));

    for (let i = 0; i < count; i++) {
        if (copied.has(i)) {
            out.addPage(copied.get(i));
            continue;
        }
        const canvas = await handler.renderCanvas(name, i + 1, 2);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        for (const r of boxesByPage.get(i + 1) || []) {
            ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
        }
        await pageToImagePage(out, canvas, handler.geometry(name, i + 1));
    }
    return out.save();
}

// pdf-lib reads objects without trusting the xref table, so a re-save fixes most damage;
// if even that fails, pdf.js's recovery parser can still render pages to rebuild from.
export async function repairPdf(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
        const doc = await PDFDocument.load(bytes.slice(), { throwOnInvalidObject: false });
        if (doc.getPageCount() > 0) return { bytes: await doc.save(), method: 'rebuilt' };
    } catch (err) {
        if (/encrypt/i.test(err.message)) throw new Error('This PDF is password-protected — unlock it instead');
    }

    let pdf;
    try {
        pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    } catch {
        throw new Error('This file is too damaged to recover');
    }
    try {
        const out = await PDFDocument.create();
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1 });
            const canvas = await renderPageToCanvas(page, 2);
            await pageToImagePage(out, canvas, { width: viewport.width, height: viewport.height });
        }
        return { bytes: await out.save(), method: 'rasterized' };
    } finally {
        pdf.destroy();
    }
}
