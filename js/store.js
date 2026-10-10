import { PDFHandler, PDF_MIME, baseName } from './pdf/handler.js';
import { TOOLS, toolById } from './tools.js';
import { appendDocuments, imagesToPdf, DEFAULT_IMAGE_OPTIONS } from './pdf/ops.js';
import { prepareImage } from './pdf/images.js';
import { mapLimit } from './util.js';

const { reactive, markRaw } = Vue;

const THUMB_CONCURRENCY = 4;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp)$/;

function readStored(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {}
}

export function isPdf(file) {
    return file.type === PDF_MIME || /\.pdf$/i.test(file.name);
}

export function isImage(file) {
    return IMAGE_TYPES.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
}

export function createStore(message) {
    const handler = new PDFHandler();
    // Old per-format tool links now open Convert on that format.
    const LEGACY = {
        'to-images': ['from-pdf', 'jpg'], 'to-markdown': ['from-pdf', 'md'], convert: ['from-pdf', null],
        images: ['to-pdf', 'images'], scan: ['to-pdf', 'scan'], numbers: ['organize', null, 'numbers'], protect: ['security'],
    };
    const hashId = location.hash.slice(1);
    const legacy = LEGACY[hashId];
    const hashTool = legacy ? legacy[0] : hashId;
    if (legacy) history.replaceState(null, '', `#${hashTool}`);
    const knownTool = TOOLS.some(t => t.id === hashTool);
    // The hash also remembers the last tool across reloads; only a link someone opened counts as asking for that tool.
    const linked = knownTool && performance.getEntriesByType('navigation')[0]?.type === 'navigate';

    const state = reactive({
        files: [], // every loaded file: the document plus locked/broken ones waiting to be added
        doc: null, // name of the one document being built
        appended: null, // { revision, from } after pages were added at the end
        tool: knownTool ? hashTool : 'organize',
        toolChosen: linked, // false: opening a document lands in Organize
        toolParams: legacy?.[1] ? { format: legacy[1] } : legacy?.[2] ? { panel: legacy[2] } : null,
        thumbSize: Number(readStored('pdfmerge.thumbSize', window.innerWidth < 600 ? 130 : 180)),
        thumbs: {}, // name -> { page: url }
        pendingImages: [],
        busy: null,
        revisions: {}, // name -> bumped on every in-place change so views re-render
        notice: null, // { text, actionLabel, action }
        viewer: { show: false, items: [], index: 0, isSelected: null, toggle: null },
    });

    const queue = [];
    let active = 0;
    const requested = new Map(); // name -> Set of pages
    let lastRun = Promise.resolve();
    let noticeTimer = null;
    let nextImage = 0;
    // Image pages' originals, by the tag stored in the page, so they can be rebuilt with other options.
    const imageSources = new Map();

    const renameKeys = (from, to) => {
        for (const map of [state.thumbs, state.revisions]) {
            if (from in map) {
                map[to] = map[from];
                delete map[from];
            }
        }
        requested.delete(from);
        if (state.doc === from) state.doc = to;
    };

    const refresh = () => {
        state.files = handler.names().map(name => handler.info(name));
        for (const f of state.files) state.thumbs[f.name] ??= {};
        if (state.doc && !handler.info(state.doc)) state.doc = null;
    };

    // Contents changed under the same name: drop cached renders (past keepPages) so every view redraws.
    const invalidate = (name, keepPages = 0) => {
        const kept = {};
        for (const [page, url] of Object.entries(state.thumbs[name] || {})) if (page <= keepPages) kept[page] = url;
        state.thumbs[name] = kept;
        const pages = requested.get(name);
        if (pages) for (const page of pages) if (page > keepPages) pages.delete(page);
        state.revisions[name] = (state.revisions[name] || 0) + 1;
        refresh();
    };

    const discard = (name) => {
        handler.remove(name);
        delete state.thumbs[name];
        delete state.revisions[name];
        requested.delete(name);
    };

    const pump = () => {
        while (active < THUMB_CONCURRENCY && queue.length) {
            // Newest request first: the cards the user is looking at right now.
            const { name, page } = queue.pop();
            if (!handler.info(name)) continue;
            active++;
            handler.thumbnail(name, page)
                .then(url => {
                    if (url && state.thumbs[name]) state.thumbs[name][page] = url;
                })
                .catch(err => console.error('Thumbnail failed', err))
                .finally(() => {
                    active--;
                    pump();
                });
        }
    };

    // Images become pages sized like the image; their options can be changed later in Organize. Returns the loaded name.
    const convertImages = async (files) => {
        const bytes = await store.run('Converting images', async (progress) => {
            let done = 0;
            const prepared = await mapLimit(files, 3, async (file) => {
                const tag = `img${nextImage++}`;
                imageSources.set(tag, { file, options: { ...DEFAULT_IMAGE_OPTIONS } });
                const image = await prepareImage(file);
                progress(++done / files.length);
                return { ...image, tag };
            });
            return imagesToPdf(prepared, DEFAULT_IMAGE_OPTIONS);
        });
        return bytes ? handler.add(new File([bytes], `${files[0].name.replace(/\.[^.]+$/, '')}.pdf`, { type: PDF_MIME })) : null;
    };

    const store = {
        state,
        message,
        handler: markRaw(handler),

        get docInfo() {
            return state.files.find(f => f.name === state.doc) || null;
        },

        // Loaded but not yet part of the document: locked or damaged files.
        get pending() {
            return state.files.filter(f => f.name !== state.doc && f.status !== 'ok');
        },

        setTool(id, params = null) {
            state.tool = id;
            state.toolChosen = true;
            state.toolParams = params;
            history.replaceState(null, '', `#${id}`);
        },

        setThumbSize(size) {
            state.thumbSize = size;
            writeStored('pdfmerge.thumbSize', String(size));
        },

        // Pages join the document in the order the files came in; runs of images become one converted PDF each.
        async loadFiles(list) {
            const takesImages = toolById(state.tool).accepts === 'images';
            const ready = [];
            let images = [];
            let skipped = 0;
            const flushImages = async () => {
                if (!images.length) return;
                const run = images;
                images = [];
                const name = await convertImages(run);
                if (name) ready.push(name);
            };
            for (const file of list) {
                if (!isPdf(file)) {
                    if (!isImage(file)) skipped++;
                    else if (takesImages) state.pendingImages.push(file);
                    else images.push(file);
                    continue;
                }
                await flushImages();
                try {
                    const name = await handler.add(file);
                    const { status } = handler.info(name);
                    if (status === 'ok') ready.push(name);
                    else if (status === 'locked') message.warning(`${name} is password-protected — enter its password to add it`);
                    else message.error(`${name} looks damaged — repair it to add it`);
                } catch (err) {
                    console.error(err);
                    message.error(`Couldn't read ${file.name}`);
                }
            }
            await flushImages();
            refresh();
            await store.append(ready);
            if (skipped) message.warning(`Skipped ${skipped} file${skipped > 1 ? 's' : ''} that aren't PDFs or images`);
        },

        notify(text, actionLabel = null, action = null) {
            clearTimeout(noticeTimer);
            state.notice = { text, actionLabel, action: action && markRaw(action) };
            noticeTimer = setTimeout(() => { state.notice = null; }, 7000);
        },

        // Adds readable files' pages to the end of the document; the first one becomes the document.
        async append(names) {
            names = [...names];
            if (!state.doc && names.length) {
                if (!state.toolChosen) store.setTool('organize');
                state.doc = names.shift();
                if (!names.length) message.success(`Opened ${state.doc}`);
            }
            if (!names.length) return;
            const doc = state.doc;
            const before = handler.info(doc).pageCount;
            const ok = await store.run('Adding pages', async () => {
                await handler.replace(doc, await appendDocuments(handler, doc, names), { keepPages: before });
                return true;
            });
            names.forEach(discard);
            if (!ok) return refresh();
            invalidate(doc, before);
            state.appended = { revision: state.revisions[doc], from: before };
            const added = handler.info(doc).pageCount - before;
            const what = names.length === 1 ? names[0] : `${names.length} files`;
            store.notify(`Added ${what} · ${added} page${added > 1 ? 's' : ''}`, 'Undo', () => {
                state.notice = null;
                store.undoEdit(doc);
            });
        },

        imageSource(tag) {
            return (tag && imageSources.get(tag)) || null;
        },

        // Unlocks or repairs a waiting file, then adds it. fn returns the readable bytes.
        async resolvePending(name, label, fn) {
            const ok = await store.run(label, async () => {
                await handler.replace(name, await fn(), { history: false });
                return true;
            });
            if (!ok) return false;
            refresh();
            await store.append([name]);
            return true;
        },

        dismiss(name) {
            discard(name);
            refresh();
        },

        closeDocument() {
            const name = state.doc;
            const file = handler.file(name);
            discard(name);
            state.doc = null;
            state.toolChosen = false;
            refresh();
            store.notify(`Closed ${name}`, 'Undo', async () => {
                state.notice = null;
                if (state.doc) return;
                const restored = await handler.add(file);
                refresh();
                state.doc = restored;
            });
        },

        rename(name, wanted) {
            const next = handler.rename(name, wanted);
            if (!next) return name;
            renameKeys(name, next);
            refresh();
            return next;
        },



        thumb(name, page) {
            if (!requested.has(name)) requested.set(name, new Set());
            const pages = requested.get(name);
            if (!pages.has(page)) {
                pages.add(page);
                queue.push({ name, page });
                pump();
            }
            return state.thumbs[name]?.[page] || null;
        },

        pageAspect(name, page) {
            try {
                const g = handler.geometry(name, page);
                return g.width / g.height;
            } catch {
                return 1 / 1.414;
            }
        },

        download(name) {
            saveAs(handler.file(name));
        },

        saveBytes(bytes, name, type = PDF_MIME) {
            saveAs(new Blob([bytes], { type }), name);
        },

        // Queues behind a running operation so automatic callers aren't dropped. Returns undefined on failure.
        async run(label, fn) {
            const previous = lastRun;
            let finished;
            lastRun = new Promise(resolve => { finished = resolve; });
            await previous;
            state.busy = { label, progress: null };
            try {
                return await fn(progress => {
                    if (state.busy) state.busy.progress = progress;
                });
            } catch (err) {
                console.error(err);
                // The 14 standard PDF fonts only cover WinAnsi; pdf-lib's own message is cryptic.
                message.error(/cannot encode/i.test(err.message)
                    ? 'Some text uses characters the built-in PDF fonts can\'t show — pick a font from this device'
                    : err.message || String(err));
                return undefined;
            } finally {
                state.busy = null;
                finished();
            }
        },


        // Rewrites the document in place. fn returns the new bytes. Returns true on success.
        async edit(label, fn, summary = null) {
            const name = state.doc;
            const ok = await store.run(label, async (progress) => {
                const bytes = await fn(progress);
                await handler.replace(name, bytes);
                return true;
            });
            if (!ok) return false;
            invalidate(name);
            store.notify(summary || 'Changes applied', 'Undo', () => {
                state.notice = null;
                store.undoEdit(name);
            });
            return true;
        },

        async undoEdit(name) {
            const ok = await store.run('Undoing', () => handler.undo(name));
            if (!ok) return;
            invalidate(name);
            message.success(`Undid the last change to ${name}`);
        },

        // A brand-new file (extract, images → PDF, protected copy) goes straight to Downloads.
        async output(label, outName, fn) {
            const bytes = await store.run(label, fn);
            if (!bytes) return undefined;
            store.saveBytes(bytes, outName);
            message.success(`Downloaded ${outName}`);
            return outName;
        },

        async saveZip(files, name) {
            const zip = new JSZip();
            for (const f of files) zip.file(f.name, f.blob);
            saveAs(await zip.generateAsync({ type: 'blob' }), name);
        },

        openViewer(items, index, { isSelected = null, toggle = null } = {}) {
            Object.assign(state.viewer, {
                show: true,
                items: markRaw(items),
                index,
                isSelected: isSelected && markRaw(isSelected),
                toggle: toggle && markRaw(toggle),
            });
        },

        outputName(suffix, name = state.doc) {
            return `${baseName(name)}-${suffix}.pdf`;
        },
    };

    return store;
}
