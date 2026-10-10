import { FontSelect } from './fonts.js';
import { cssFont } from '../pdf/fonts.js';
import { PageStage, PageNav, Icon, ICONS, startDrag, clamp01, pointIn, boxStyle, resizeRect, pickFiles, useKeydown } from './shared.js';
import { SignaturePad } from './signature.js';
import { drawAnnotations, redact, TEXT_LINE_HEIGHT } from '../pdf/ops.js';
import { prepareImage } from '../pdf/images.js';

const { defineComponent, inject, ref, shallowRef, reactive, computed, nextTick, onBeforeUnmount, markRaw } = Vue;

const MODES = {
    edit: { tools: ['select', 'text', 'rect', 'ellipse', 'line', 'highlight', 'whiteout', 'image'], idle: 'select', save: 'Apply changes', done: 'Changes applied' },
    sign: { tools: ['select', 'signature', 'text', 'date'], idle: 'select', save: 'Apply signature', done: 'Signed' },
    // Redaction usually means many boxes in a row, so its drawing tool stays armed.
    redact: { tools: ['select', 'redact'], idle: 'redact', save: 'Apply redactions', done: 'Redacted' },
};

const TOOL_META = {
    select: { label: 'Select', icon: ICONS.pointer },
    text: { label: 'Text', icon: ICONS.text },
    rect: { label: 'Box', icon: ICONS.square },
    ellipse: { label: 'Ellipse', icon: ICONS.circle },
    line: { label: 'Line', icon: ICONS.line },
    highlight: { label: 'Highlight', icon: ICONS.highlight },
    whiteout: { label: 'White-out', icon: ICONS.eraser },
    image: { label: 'Image', icon: ICONS.image },
    signature: { label: 'Signature', icon: ICONS.signature },
    date: { label: 'Date', icon: ICONS.calendar },
    redact: { label: 'Redact box', icon: ICONS.square },
};

const ELEMENT_TITLES = { text: 'Text', image: 'Image', line: 'Line', highlight: 'Highlight', redact: 'Redaction' };

// Drag-to-draw tools and the size used when the user just clicks.
const BOX_TOOLS = { rect: [0.25, 0.12], ellipse: [0.2, 0.12], highlight: [0.3, 0.025], whiteout: [0.25, 0.04], redact: [0.3, 0.025] };

// Starting style per tool; white-out is just a borderless white box.
const DEFAULTS = {
    text: { size: 16, color: '#111827', font: 'helvetica', bold: false },
    rect: { stroke: '#2563eb', strokeWidth: 2, fill: null },
    ellipse: { stroke: '#2563eb', strokeWidth: 2, fill: null },
    line: { stroke: '#dc2626', strokeWidth: 2 },
    highlight: { fill: '#facc15' },
    whiteout: { stroke: null, strokeWidth: 0, fill: '#ffffff' },
    redact: { fill: '#000000' },
};

let nextId = 1;

// Signatures are only kept on this device when the user asks; stored as data URLs.
const SAVED_KEY = 'pdfmerge.signatures';
function loadSaved() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    } catch {
        return [];
    }
}
function writeSaved(list) {
    try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {}
}
function dataUrlToBytes(url) {
    return Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
}
function bytesToDataUrl(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
}

// The standard PDF fonts can't draw non-Latin digits or bidi marks, which some locales' dates use.
function today() {
    const local = new Date().toLocaleDateString();
    return /^[\x20-\x7e]*$/.test(local) ? local : new Date().toLocaleDateString('en-CA');
}

export const AnnotateTool = defineComponent({
    components: { PageStage, PageNav, Icon, SignaturePad, FontSelect },
    props: { mode: { type: String, required: true } },
    setup(props) {
        const store = inject('store');
        const name = store.state.doc;
        const count = store.docInfo.pageCount;
        const page = ref(1);
        const elements = ref([]);
        const assets = reactive({});
        const signatures = ref([]);
        const mode = MODES[props.mode];
        const tool = ref(mode.idle);
        const selectedId = ref(null);
        const editingId = ref(null);
        const overlay = ref(null);
        const padOpen = ref(false);
        const history = shallowRef([]);
        let lastChange = null;
        const findQuery = ref('');
        const defaults = reactive(JSON.parse(JSON.stringify(DEFAULTS)));

        const pageElements = computed(() => elements.value.filter(el => el.page === page.value));
        const selectedEl = computed(() => elements.value.find(el => el.id === selectedId.value) || null);
        const marks = computed(() => new Set(elements.value.map(el => el.page)));
        const geom = computed(() => store.handler.geometry(name, page.value));

        // Consecutive tweaks of the same thing (a slider drag, arrow nudges) share one undo step.
        const snapshot = (key = null) => {
            if (key && key === lastChange) return;
            lastChange = key;
            history.value = [...history.value.slice(-49), markRaw(elements.value.map(el => ({ ...el })))];
        };
        const undo = () => {
            const prev = history.value.at(-1);
            if (!prev) return;
            history.value = history.value.slice(0, -1);
            lastChange = null;
            elements.value = prev.map(el => ({ ...el }));
            selectedId.value = null;
            editingId.value = null;
        };

        const add = (el) => {
            snapshot();
            elements.value.push({ id: nextId++, page: page.value, ...el });
            // The reactive copy: drags mutate it, and mutating the plain object wouldn't redraw.
            const added = elements.value.at(-1);
            selectedId.value = added.id;
            return added;
        };
        const removeEl = (id, record = true) => {
            if (record) snapshot();
            elements.value = elements.value.filter(el => el.id !== id);
            if (selectedId.value === id) selectedId.value = null;
            if (editingId.value === id) editingId.value = null;
        };

        const startEditing = async (el) => {
            selectedId.value = el.id;
            editingId.value = el.id;
            await nextTick();
            const node = overlay.value?.querySelector(`[data-edit="${el.id}"]`);
            if (!node) return;
            node.textContent = el.text;
            node.focus();
            document.getSelection()?.selectAllChildren(node);
        };
        const commitEdit = (el, event) => {
            const text = event.target.innerText.replace(/\n$/, '');
            if (text !== el.text) snapshot();
            el.text = text;
            editingId.value = null;
            if (!el.text.trim()) removeEl(el.id, false);
        };

        const addText = (x, y, text = 'Text') => {
            const el = add({ type: 'text', x, y, text, ...defaults.text });
            startEditing(el);
        };

        // Centered on `at` (normalized), or on the page when no point is given.
        const placeImage = (asset, widthFraction, at = { x: 0.5, y: 0.5 }) => {
            const g = geom.value;
            const w = widthFraction;
            const h = (w * g.width * asset.height) / asset.width / g.height;
            const x = Math.min(Math.max(0, at.x - w / 2), 1 - w);
            const y = Math.min(Math.max(0, at.y - h / 2), Math.max(0, 1 - h));
            add({ type: 'image', asset: asset.id, x, y, w, h });
        };

        const addAsset = (data) => {
            const id = `a${nextId++}`;
            assets[id] = { id, ...data };
            return assets[id];
        };

        const pickImage = async () => {
            const [file] = await pickFiles({ accept: 'image/*' });
            if (!file) return;
            const prepared = await store.run('Reading image', () => prepareImage(file, { maxSide: 2400 }));
            if (!prepared) return;
            const url = URL.createObjectURL(new Blob([prepared.bytes], { type: prepared.type === 'png' ? 'image/png' : 'image/jpeg' }));
            placeImage(addAsset({ ...prepared, url }), 0.35);
            tool.value = mode.idle;
        };

        // About the size of a pen signature: ~1.5 cm tall, at most ~5.3 cm wide.
        const signatureWidth = (asset) => Math.min(150, (42 * asset.width) / asset.height) / geom.value.width;
        // A picked signature stays armed: each click on the page places it, clicks on elements still select them.
        const armed = ref(null);
        const arm = (asset) => {
            const off = tool.value === 'place' && armed.value === asset.id;
            armed.value = off ? null : asset.id;
            tool.value = off ? mode.idle : 'place';
            selectedId.value = null;
        };
        for (const saved of loadSaved()) {
            const bytes = dataUrlToBytes(saved.dataUrl);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
            signatures.value.push(addAsset({ bytes, type: 'png', width: saved.width, height: saved.height, url, savedId: saved.id }));
        }

        const onSignature = ({ remember, ...data }) => {
            const asset = addAsset(data);
            if (remember) {
                asset.savedId = `s${Date.now()}`;
                writeSaved([...loadSaved(), { id: asset.savedId, width: asset.width, height: asset.height, dataUrl: bytesToDataUrl(asset.bytes) }].slice(-6));
            }
            signatures.value.push(asset);
            arm(asset);
        };
        const forget = (asset) => {
            writeSaved(loadSaved().filter(s => s.id !== asset.savedId));
            signatures.value = signatures.value.filter(s => s !== asset);
        };

        // These run once on click instead of arming a drawing tool.
        const actions = {
            image: pickImage,
            signature: () => { padOpen.value = true; },
            date: () => addText(0.6, 0.85, today()),
        };
        const chooseTool = (t) => {
            editingId.value = null;
            if (actions[t]) return actions[t]();
            tool.value = t;
            if (t !== 'select') selectedId.value = null;
        };

        const onStageDown = (event) => {
            if (event.button > 0) return;
            // pointerdown precedes the blur that commits; unmounting the editor first would drop the edit in Firefox.
            if (editingId.value !== null) document.activeElement?.blur();
            editingId.value = null;
            const t = tool.value;
            if (t === 'select') {
                selectedId.value = null;
                return;
            }
            if (t === 'place') {
                const asset = assets[armed.value];
                if (asset) placeImage(asset, signatureWidth(asset), pointIn(event, overlay.value));
                event.preventDefault();
                return;
            }
            if (t === 'text') {
                const at = pointIn(event, overlay.value);
                addText(at.x, at.y);
                tool.value = mode.idle;
                event.preventDefault();
                return;
            }
            let el;
            const start = startDrag(event, overlay.value, (p, s) => {
                if (el.type === 'line') {
                    el.x2 = p.x;
                    el.y2 = p.y;
                } else {
                    Object.assign(el, { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
                }
            }, () => {
                if (el.type === 'line') {
                    if (Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 0.01) {
                        el.x2 = Math.min(1, el.x1 + 0.25);
                        el.y2 = el.y1;
                    }
                } else if (el.w < 0.01 || el.h < 0.005) {
                    const [w, h] = BOX_TOOLS[t];
                    Object.assign(el, { w, h, x: Math.min(el.x, 1 - w), y: Math.min(el.y, 1 - h) });
                }
                tool.value = mode.idle;
            });
            el = t === 'line'
                ? add({ type: 'line', x1: start.x, y1: start.y, x2: start.x, y2: start.y, ...defaults.line })
                : add({ type: t === 'whiteout' ? 'rect' : t, x: start.x, y: start.y, w: 0, h: 0, ...defaults[t] });
        };

        const onElementDown = (event, el, handle = null) => {
            if (editingId.value === el.id) return;
            selectedId.value = el.id;
            if (tool.value !== 'place') tool.value = mode.idle;
            const orig = { ...el };
            const aspect = el.type === 'image' ? orig.w / orig.h : null;
            let moved = false;
            startDrag(event, overlay.value, (p, s) => {
                const dx = p.x - s.x;
                const dy = p.y - s.y;
                if (!moved) {
                    moved = true;
                    snapshot();
                }
                if (el.type === 'line') {
                    if (handle !== 'p2') { el.x1 = clamp01(orig.x1 + dx); el.y1 = clamp01(orig.y1 + dy); }
                    if (handle !== 'p1') { el.x2 = clamp01(orig.x2 + dx); el.y2 = clamp01(orig.y2 + dy); }
                    return;
                }
                if (!handle) {
                    el.x = Math.min(1 - (el.w || 0), Math.max(0, orig.x + dx));
                    el.y = Math.min(1 - (el.h || 0), Math.max(0, orig.y + dy));
                    return;
                }
                const next = resizeRect(orig, handle, dx, dy, 0.01, 0.005);
                if (aspect) {
                    const bottom = next.y + next.h;
                    next.h = next.w / aspect;
                    if (handle.includes('n')) next.y = bottom - next.h;
                }
                Object.assign(el, next);
            });
        };

        // Remember style edits so the next element of that kind matches.
        const setProp = (key, value) => {
            const el = selectedEl.value;
            if (!el) return;
            snapshot(`${el.id}:${key}`);
            el[key] = value;
            if (defaults[el.type] && key in defaults[el.type]) defaults[el.type][key] = value;
        };

        const copyToAllPages = () => {
            const el = selectedEl.value;
            snapshot();
            for (let p = 1; p <= count; p++) {
                if (p !== el.page) elements.value.push({ ...el, id: nextId++, page: p });
            }
        };

        const findResult = ref(null);
        const runFind = async () => {
            const hits = await store.run('Searching', () => store.handler.findText(name, findQuery.value));
            if (!hits) return;
            if (hits.length) snapshot();
            for (const hit of hits) elements.value.push({ id: nextId++, type: 'redact', page: hit.page, ...hit.rect, ...defaults.redact });
            if (hits.length) page.value = hits[0].page;
            findResult.value = hits.length ? `Marked ${hits.length} match${hits.length > 1 ? 'es' : ''}` : 'No matches';
        };

        const applyRedactions = (flattenAll) => {
            const boxes = new Map();
            for (const el of elements.value) boxes.set(el.page, [...(boxes.get(el.page) || []), el]);
            return store.edit('Redacting', () => redact(store.handler, name, boxes, { flattenAll }),
                flattenAll ? 'Redacted · every page flattened' : `Redacted ${boxes.size} page${boxes.size > 1 ? 's' : ''}`);
        };
        const redactedPages = computed(() => new Set(elements.value.map(el => el.page)).size);

        // Boxes that only cover text: it stays selectable underneath unless redacted.
        const covers = computed(() => elements.value.some(el => el.type === 'rect' && el.fill && (el.fill === '#ffffff' || el.fill === '#000000')));

        const save = () => {
            if (props.mode === 'redact') return applyRedactions(false);
            return store.edit('Saving', async () =>
                drawAnnotations(await store.handler.freshDoc(name), elements.value.map(el => ({ ...el })), assets), mode.done);
        };

        useKeydown((e) => {
            const el = selectedEl.value;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undo();
                return;
            }
            if (e.key === 'Escape') {
                selectedId.value = null;
                tool.value = mode.idle;
                return;
            }
            if (!el) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeEl(el.id);
            } else if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                snapshot(`${el.id}:nudge`);
                const step = e.shiftKey ? 0.01 : 0.002;
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                if (el.type === 'line') {
                    el.x1 += dx; el.x2 += dx; el.y1 += dy; el.y2 += dy;
                } else {
                    el.x = clamp01(el.x + dx);
                    el.y = clamp01(el.y + dy);
                }
            } else if (e.key === 'Enter' && el.type === 'text') {
                e.preventDefault();
                startEditing(el);
            }
        });

        onBeforeUnmount(() => Object.values(assets).forEach(a => URL.revokeObjectURL(a.url)));

        // Styles: everything is in % of the page box; sizes in pt scale with the rendered width.
        const ptToPx = (pt, stageWidth) => (pt * stageWidth) / geom.value.width;
        const shapeStyle = (el, stageWidth) => ({
            ...boxStyle(el),
            borderWidth: el.stroke ? `${Math.max(1, ptToPx(el.strokeWidth, stageWidth))}px` : 0,
            borderColor: el.stroke || 'transparent',
            background: el.fill || 'transparent',
        });
        const textStyle = (el) => ({
            left: `${el.x * 100}%`,
            top: `${el.y * 100}%`,
            fontSize: `${(el.size / geom.value.width) * 100}cqw`,
            lineHeight: TEXT_LINE_HEIGHT,
            color: el.color,
            fontFamily: cssFont(el.font),
            fontWeight: el.bold ? 700 : 400,
        });

        const toolList = mode.tools.map(id => ({ id, ...TOOL_META[id] }));
        const hasLine = computed(() => pageElements.value.some(el => el.type === 'line'));

        return {
            store, name, count, page, elements, pageElements, selectedEl, selectedId, editingId, marks, tool, toolList, overlay, assets,
            signatures, padOpen, history, undo, forget, armed, arm, findQuery, findResult, onSignature, chooseTool, onStageDown, onElementDown, startEditing, commitEdit, removeEl,
            setProp, copyToAllPages, runFind, save, placeImage, boxStyle, shapeStyle, textStyle, ptToPx, hasLine, ICONS,
            ELEMENT_TITLES, saveLabel: mode.save, applyRedactions, redactedPages, covers,
        };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="tool__row">
                    <div class="palette" role="toolbar">
                        <button v-for="t in toolList" :key="t.id" type="button"
                            :class="['palette__btn', { 'palette__btn--on': tool === t.id }]"
                            @click="chooseTool(t.id)" :title="t.label">
                            <icon :d="t.icon" :size="18"/><span>{{ t.label }}</span>
                        </button>
                    </div>
                    <div class="tool__primary">
                        <n-button :disabled="!history.length" @click="undo" title="Undo (Ctrl+Z)"><template #icon><icon :d="ICONS.undo"/></template>Undo</n-button>
                        <n-button v-if="mode !== 'redact'" type="primary" :disabled="!elements.length || !!store.state.busy" @click="save">
                            {{ saveLabel }}
                        </n-button>
                    </div>
                </div>
                <div v-if="mode === 'redact'" :class="['notice', elements.length ? 'notice--warning' : 'notice--info']" role="status">
                    <span v-if="elements.length" class="notice__text"><strong>Not applied yet.</strong> Until you apply, the text under the black boxes is still in the file and can be selected or copied.
                        Applying turns pages into images so it's gone for good.</span>
                    <span v-else class="notice__text">Drag over text to black it out, or use Find. Applying turns those pages into images, so the hidden text can't be selected or copied.</span>
                    <span class="notice__actions">
                        <n-button type="primary" size="small" :disabled="!elements.length || !!store.state.busy" @click="applyRedactions(false)">
                            Apply to {{ redactedPages || '' }} page{{ redactedPages === 1 ? '' : 's' }} with redactions
                        </n-button>
                        <n-button size="small" :disabled="!elements.length || !!store.state.busy" @click="applyRedactions(true)">Apply &amp; flatten all {{ count }} pages</n-button>
                    </span>
                </div>
                <div v-if="mode === 'edit' && covers" class="notice notice--warning" role="alert">
                    <span class="notice__text">Black or white boxes only cover text visually; it can still be selected and copied. To remove text for good, use Redact.</span>
                    <span class="notice__actions"><n-button size="small" @click="store.setTool('redact')">Open Redact</n-button></span>
                </div>
                <div v-if="mode === 'redact'" class="tool__row">
                    <div class="findbar">
                        <n-input v-model:value="findQuery" size="small" placeholder="Find text to redact, e.g. a name or number" clearable @keyup.enter="findQuery.trim() && !store.state.busy && runFind()"/>
                        <n-button size="small" :disabled="!findQuery.trim() || !!store.state.busy" @click="runFind">Mark all</n-button>
                        <span v-if="findResult" class="findbar__result">{{ findResult }}</span>
                    </div>
                </div>
                <div v-if="mode === 'sign' && signatures.length" class="tool__row">
                    <div class="sig-list">
                        <span class="field__label">Your signatures</span>
                        <span v-for="s in signatures" :key="s.id" class="sig-list__entry">
                            <button type="button" :class="['sig-list__item', { 'sig-list__item--on': tool === 'place' && armed === s.id }]"
                                :title="tool === 'place' && armed === s.id ? 'Stop placing' : 'Place this signature'" :aria-pressed="tool === 'place' && armed === s.id" @click="arm(s)">
                                <img :src="s.url" alt="Signature"/>
                            </button>
                            <button v-if="s.savedId" type="button" class="sig-list__forget" title="Forget on this device" @click="forget(s)"><icon :d="ICONS.close" :size="12"/></button>
                        </span>
                        <span class="sig-list__hint">{{ tool === 'place' ? 'Click on the page to sign · Esc to stop' : 'Pick one, then click where it goes' }}</span>
                    </div>
                </div>
            </div>

            <div class="editor">
                <div class="editor__main">
                    <page-nav v-model:page="page" :count="count" :marks="marks"/>
                    <page-stage :name="name" :page="page" :max-height="80" v-slot="{ width }">
                        <div ref="overlay" :class="['annot', 'annot--' + tool]" @pointerdown="onStageDown">
                            <svg v-if="hasLine" class="annot__lines" viewBox="0 0 1 1" preserveAspectRatio="none">
                                <template v-for="el in pageElements" :key="el.id">
                                    <g v-if="el.type === 'line'">
                                        <line :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2" :stroke="el.stroke" :stroke-width="Math.max(1, ptToPx(el.strokeWidth, width))"
                                              vector-effect="non-scaling-stroke" stroke-linecap="round"/>
                                        <line :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke"
                                              class="annot__hit" @pointerdown="onElementDown($event, el)"/>
                                    </g>
                                </template>
                            </svg>
                            <template v-for="el in pageElements" :key="el.id">
                                <div v-if="el.type === 'text'" :class="['annot__el', 'annot__text', { 'annot__el--on': selectedId === el.id }]" :style="textStyle(el)"
                                     @pointerdown="onElementDown($event, el)" @dblclick.stop="startEditing(el)">
                                    <div v-if="editingId === el.id" :data-edit="el.id" contenteditable="plaintext-only" class="annot__editing"
                                         @blur="commitEdit(el, $event)" @pointerdown.stop @keydown.esc.stop="$event.target.blur()"></div>
                                    <template v-else>{{ el.text }}</template>
                                </div>
                                <div v-else-if="el.type === 'image'" :class="['annot__el', { 'annot__el--on': selectedId === el.id }]" :style="boxStyle(el)"
                                     @pointerdown="onElementDown($event, el)">
                                    <img :src="assets[el.asset].url" class="annot__img" draggable="false" alt=""/>
                                </div>
                                <div v-else-if="el.type !== 'line'"
                                     :class="['annot__el', 'annot__shape', 'annot__shape--' + el.type, { 'annot__el--on': selectedId === el.id }]"
                                     :style="shapeStyle(el, width)" @pointerdown="onElementDown($event, el)"></div>

                                <template v-if="selectedId === el.id && editingId !== el.id">
                                    <template v-if="el.type === 'line'">
                                        <span class="annot__handle" :style="{ left: el.x1 * 100 + '%', top: el.y1 * 100 + '%' }" @pointerdown="onElementDown($event, el, 'p1')"></span>
                                        <span class="annot__handle" :style="{ left: el.x2 * 100 + '%', top: el.y2 * 100 + '%' }" @pointerdown="onElementDown($event, el, 'p2')"></span>
                                    </template>
                                    <template v-else-if="el.type !== 'text'">
                                        <span v-for="h in ['nw', 'ne', 'sw', 'se']" :key="h" class="annot__handle"
                                              :style="{ left: (el.x + (h.includes('e') ? el.w : 0)) * 100 + '%', top: (el.y + (h.includes('s') ? el.h : 0)) * 100 + '%' }"
                                              @pointerdown="onElementDown($event, el, h)"></span>
                                    </template>
                                </template>
                            </template>
                        </div>
                    </page-stage>
                    <p class="tool__note">
                        <template v-if="tool === 'text'">Click where the text should go</template>
                        <template v-else-if="tool === 'line'">Drag to draw a line</template>
                        <template v-else-if="tool !== 'select'">Drag on the page to draw · click for a default size</template>
                        <template v-else-if="mode === 'sign' && !elements.length">Click “Signature” to create one, then drag it into place</template>
                        <template v-else>Click an item to select it · drag to move · Del to remove · double-click text to edit</template>
                    </p>
                </div>

                <aside class="editor__props">
                    <p v-if="!selectedEl" class="editor__empty">Select an item on the page to change its color, size or font.</p>
                    <template v-else>
                    <h2 class="editor__title">{{ ELEMENT_TITLES[selectedEl.type] || 'Shape' }}</h2>
                    <template v-if="selectedEl.type === 'text'">
                        <n-input type="textarea" :value="selectedEl.text" @update:value="v => setProp('text', v)" :autosize="{ minRows: 2, maxRows: 6 }"/>
                        <div class="props-row">
                            <font-select :value="selectedEl.font" @update:value="v => setProp('font', v)"/>
                            <n-button size="small" :type="selectedEl.bold ? 'primary' : 'default'" @click="setProp('bold', !selectedEl.bold)"><b>B</b></n-button>
                        </div>
                        <label class="field"><span class="field__label">Size {{ selectedEl.size }}pt</span>
                            <n-slider :value="selectedEl.size" @update:value="v => setProp('size', v)" :min="6" :max="96" :tooltip="false"/></label>
                        <label class="field"><span class="field__label">Color</span>
                            <n-color-picker :value="selectedEl.color" @update:value="v => setProp('color', v)" :show-alpha="false" :modes="['hex']" size="small"/></label>
                    </template>
                    <template v-if="['rect', 'ellipse', 'line'].includes(selectedEl.type)">
                        <label class="field"><span class="field__label">{{ selectedEl.type === 'line' ? 'Color' : 'Border' }}</span>
                            <div class="props-row">
                                <n-color-picker :value="selectedEl.stroke || '#000000'" @update:value="v => setProp('stroke', v)" :show-alpha="false" :modes="['hex']" size="small"/>
                                <n-button v-if="selectedEl.type !== 'line'" size="small" :type="selectedEl.stroke ? 'default' : 'primary'"
                                    @click="setProp('stroke', selectedEl.stroke ? null : '#000000')">{{ selectedEl.stroke ? 'None' : 'Add' }}</n-button>
                            </div>
                        </label>
                        <label v-if="selectedEl.stroke" class="field"><span class="field__label">Thickness {{ selectedEl.strokeWidth }}pt</span>
                            <n-slider :value="selectedEl.strokeWidth" @update:value="v => setProp('strokeWidth', v)" :min="0.5" :max="12" :step="0.5" :tooltip="false"/></label>
                        <label v-if="selectedEl.type !== 'line'" class="field"><span class="field__label">Fill</span>
                            <div class="props-row">
                                <n-color-picker :value="selectedEl.fill || '#ffffff'" @update:value="v => setProp('fill', v)" :show-alpha="false" :modes="['hex']" size="small"/>
                                <n-button size="small" :type="selectedEl.fill ? 'default' : 'primary'" @click="setProp('fill', selectedEl.fill ? null : '#ffffff')">{{ selectedEl.fill ? 'None' : 'Add' }}</n-button>
                            </div>
                        </label>
                    </template>
                    <label v-if="selectedEl.type === 'highlight'" class="field"><span class="field__label">Color</span>
                        <n-color-picker :value="selectedEl.fill" @update:value="v => setProp('fill', v)" :show-alpha="false" :modes="['hex']" size="small"
                            :swatches="['#facc15', '#4ade80', '#60a5fa', '#f472b6']"/></label>
                    <div class="props-actions">
                        <n-button v-if="mode === 'sign' && count > 1" size="small" @click="copyToAllPages">Copy to all pages</n-button>
                        <n-button size="small" type="error" secondary @click="removeEl(selectedEl.id)"><template #icon><icon :d="ICONS.trash"/></template>Delete</n-button>
                    </div>
                </template>
                </aside>
            </div>

            <signature-pad v-model:show="padOpen" @done="onSignature"/>
        </div>`,
});
