import { pagesToRangeString, safePagesFromRanges } from '../pdf/ranges.js';

const { defineComponent, inject, provide, computed, ref, shallowRef, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

export const ICONS = {
    rotateLeft: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    rotateRight: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
    zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    close: 'M18 6L6 18M6 6l12 12',
    check: 'M5 12l5 5L20 7',
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
    text: 'M4 7V4h16v3M9 20h6M12 4v16',
    square: 'M4 4h16v16H4z',
    circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    line: 'M5 19L19 5',
    highlight: 'M9 11l-6 6v3h6l6-6M14 4l6 6-8 8-6-6z',
    eraser: 'M20 20H8l-4-4 10-10 7 7-7 7M7 11l6 6',
    pointer: 'M4 3l7 17 2.5-7.5L21 10z',
    signature: 'M3 17c3-4 5-9 7-9s-1 9 2 9 3-4 5-4 2 3 4 3M3 21h18',
    calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    grid: 'M3 3h7v9H3zM14 3h7v9h-7zM3 15h7v6H3zM14 15h7v6h-7z',
    page: 'M5 3h14v18H5z',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    down: 'M6 9l6 6 6-6',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
};

export const Icon = defineComponent({
    props: { d: { type: String, required: true }, size: { type: Number, default: 16 } },
    template: `<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon-svg"><path :d="d"/></svg>`,
});

export function pageItems(name, count) {
    return Array.from({ length: count }, (_, i) => ({ key: `${name}#${i + 1}`, name, page: i + 1, rotation: 0 }));
}

// Page numbers of the selected items, or every page when nothing is selected.
export function selectedPages(items, selected) {
    const keys = new Set(selected);
    const picked = keys.size ? items.filter(i => keys.has(i.key)) : items;
    return picked.map(i => i.page);
}

export function keysToPositions(items, keys) {
    const set = new Set(keys);
    return items.flatMap((item, i) => (set.has(item.key) ? [i + 1] : []));
}

const ZoomSlider = defineComponent({
    components: { Icon },
    setup() {
        return { store: inject('store'), ICONS };
    },
    template: `
        <label class="zoom" title="Thumbnail size">
            <icon :d="ICONS.grid"/>
            <n-slider :value="store.state.thumbSize" @update:value="store.setThumbSize" :min="90" :max="360" :step="10" :tooltip="false" class="zoom__slider"/>
            <icon :d="ICONS.page" :size="20"/>
        </label>`,
});

// Selection is an array of item keys; the range box speaks page numbers (an item's `label`, else its 1-based position).
export const SelectionBar = defineComponent({
    components: { ZoomSlider },
    props: {
        items: { type: Array, required: true },
        selected: { type: Array, required: true },
        placeholder: { type: String, default: 'Pages, e.g. 1-3, 5' },
    },
    emits: ['update:selected'],
    setup(props, { emit }) {
        const text = ref('');
        const numberOf = (item, i) => item.label ?? i + 1;
        const highest = computed(() => props.items.reduce((max, item, i) => Math.max(max, numberOf(item, i)), 0));
        const positions = computed(() => {
            const keys = new Set(props.selected);
            return props.items.flatMap((item, i) => (keys.has(item.key) ? [numberOf(item, i)] : []));
        });

        watch(positions, (pos) => {
            const typed = safePagesFromRanges(text.value, highest.value).filter(p => props.items.some((item, i) => numberOf(item, i) === p));
            if (typed.join() !== pos.join()) text.value = pagesToRangeString(pos);
        }, { immediate: true });

        const onInput = (value) => {
            text.value = value;
            const pages = new Set(safePagesFromRanges(value, highest.value));
            emit('update:selected', props.items.filter((item, i) => pages.has(numberOf(item, i))).map(i => i.key));
        };
        const all = () => emit('update:selected', props.items.map(i => i.key));
        const parity = (odd) => emit('update:selected', props.items.filter((item, i) => (numberOf(item, i) % 2 === 1) === odd).map(i => i.key));
        const none = () => emit('update:selected', []);
        const invert = () => {
            const keys = new Set(props.selected);
            emit('update:selected', props.items.filter(i => !keys.has(i.key)).map(i => i.key));
        };

        return { text, onInput, all, parity, none, invert };
    },
    template: `
        <div class="selbar">
            <div class="selbar__main">
                <n-input :value="text" @update:value="onInput" :placeholder="placeholder" clearable size="small" class="selbar__input"/>
                <n-button-group size="small">
                    <n-button @click="all">All</n-button>
                    <n-button @click="parity(true)">Odd</n-button>
                    <n-button @click="parity(false)">Even</n-button>
                    <n-button @click="invert">Invert</n-button>
                    <n-button @click="none" :disabled="!selected.length">None</n-button>
                </n-button-group>
                <span class="selbar__count">{{ selected.length ? selected.length + ' of ' + items.length + ' selected' : 'Click pages to select · Shift-click for a range' }}</span>
            </div>
            <zoom-slider/>
        </div>`,
});

// Sortable moves DOM nodes itself; put the node back and report the move so Vue stays in charge.
export function useSortable(el, onMove, options = {}) {
    let sortable = null;
    onMounted(() => {
        sortable = Sortable.create(el.value, {
            animation: 150,
            delay: 180,
            delayOnTouchOnly: true,
            ghostClass: 'page-card--ghost',
            filter: '.page-card__tool',
            preventOnFilter: false,
            draggable: '.page-card',
            ...options,
            onEnd: ({ item, from, oldIndex, newIndex }) => {
                if (oldIndex === newIndex) return;
                const cards = [...from.children].filter(n => n !== item && n.matches('.page-card'));
                item.remove();
                if (cards[oldIndex]) from.insertBefore(item, cards[oldIndex]);
                else if (cards.length) cards[cards.length - 1].after(item);
                else from.prepend(item);
                onMove(oldIndex, newIndex);
            },
        });
    });
    onBeforeUnmount(() => sortable?.destroy());
}

// One card per page so a thumbnail arriving only re-renders its own card.
const PageCard = defineComponent({
    components: { Icon },
    props: {
        item: { type: Object, required: true },
        index: { type: Number, required: true },
        selected: Boolean,
        selectable: Boolean,
    },
    emits: ['pick', 'preview'],
    setup(props) {
        const store = inject('store');
        const observer = inject('pageObserver');
        const el = ref(null);
        const visible = ref(false);

        onMounted(() => observer.watch(el.value, () => { visible.value = true; }));
        onBeforeUnmount(() => observer.unwatch(el.value));

        const thumb = computed(() => (visible.value ? store.thumb(props.item.name, props.item.page) : null));
        const aspect = computed(() => {
            void store.state.revisions[props.item.name]; // in-place edits change page sizes
            return store.pageAspect(props.item.name, props.item.page);
        });
        const sheetStyle = computed(() => ({ aspectRatio: props.item.rotation % 180 ? 1 / aspect.value : aspect.value }));
        const imgStyle = computed(() => {
            const r = props.item.rotation || 0;
            if (!r) return null;
            if (r === 180) return { transform: 'rotate(180deg)' };
            const a = aspect.value;
            return {
                position: 'absolute', top: '50%', left: '50%',
                width: `${100 * a}%`, height: `${100 / a}%`,
                transform: `translate(-50%, -50%) rotate(${r}deg)`,
            };
        });

        return { el, visible, thumb, sheetStyle, imgStyle, ICONS };
    },
    template: `
        <div ref="el" :class="['page-card', { 'page-card--selected': selectable && selected, 'page-card--static': !selectable }]"
             @click="$emit('pick', index, $event)">
            <div class="page-card__sheet" :style="sheetStyle">
                <img v-if="thumb" :src="thumb" :style="imgStyle" class="page-card__img" draggable="false" :alt="'Page ' + (index + 1)"/>
                <div v-else class="page-card__loading"><n-spin size="small"/></div>
                <slot v-if="visible" name="overlay"></slot>
                <span v-if="selectable" class="page-card__check"><icon :d="ICONS.check" :size="14"/></span>
                <div class="page-card__tools" @click.stop>
                    <slot name="actions"></slot>
                    <button class="page-card__tool" type="button" title="Preview" @click="$emit('preview', index)"><icon :d="ICONS.zoom" :size="16"/></button>
                </div>
            </div>
            <span class="page-card__label">{{ item.label ?? index + 1 }}</span>
        </div>`,
});

export const PageGrid = defineComponent({
    components: { PageCard },
    props: {
        items: { type: Array, required: true },
        selected: { type: Array, default: () => [] },
        selectable: { type: Boolean, default: true },
        sortable: { type: Boolean, default: false },
    },
    emits: ['update:selected', 'reorder', 'preview'],
    setup(props, { emit }) {
        const store = inject('store');
        const grid = ref(null);
        const selectedSet = computed(() => new Set(props.selected));
        let anchor = null;

        const callbacks = new Map();
        const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                callbacks.get(entry.target)?.();
                callbacks.delete(entry.target);
                io.unobserve(entry.target);
            }
        }, { rootMargin: '400px' });
        provide('pageObserver', {
            watch: (el, cb) => { callbacks.set(el, cb); io.observe(el); },
            unwatch: (el) => { callbacks.delete(el); io.unobserve(el); },
        });
        onBeforeUnmount(() => io.disconnect());

        const onPick = (index, event) => {
            if (!props.selectable) return;
            const next = new Set(props.selected);
            const key = props.items[index].key;
            const anchorIndex = anchor === null ? -1 : props.items.findIndex(i => i.key === anchor);
            if (event.shiftKey && anchorIndex !== -1) {
                // The range copies the anchor's state, so shift-click can select or clear a run.
                const select = next.has(anchor);
                const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
                for (let i = from; i <= to; i++) select ? next.add(props.items[i].key) : next.delete(props.items[i].key);
            } else {
                next.has(key) ? next.delete(key) : next.add(key);
                anchor = key;
            }
            emit('update:selected', props.items.filter(i => next.has(i.key)).map(i => i.key));
        };

        if (props.sortable) useSortable(grid, (from, to) => emit('reorder', from, to));

        return { store, grid, selectedSet, onPick };
    },
    template: `
        <div class="page-grid" ref="grid" :style="{ '--thumb-size': store.state.thumbSize + 'px' }">
            <page-card v-for="(item, i) in items" :key="item.key" :item="item" :index="i"
                :selected="selectedSet.has(item.key)" :selectable="selectable" @pick="onPick" @preview="$emit('preview', $event)">
                <template #overlay><slot name="overlay" :item="item" :index="i"></slot></template>
                <template #actions><slot name="actions" :item="item" :index="i"></slot></template>
            </page-card>
        </div>`,
});

// Holds blob URLs (a string or an object of them) and revokes whatever it replaces or outlives.
export function useObjectUrls() {
    const value = shallowRef(null);
    let token = 0;
    const urlsOf = (v) => (!v ? [] : typeof v === 'string' ? [v] : Object.values(v).filter(u => typeof u === 'string'));
    const revoke = (v) => urlsOf(v).forEach(u => URL.revokeObjectURL(u));

    const clear = () => {
        token++;
        revoke(value.value);
        value.value = null;
    };
    // Shows produce()'s result unless a newer load started meanwhile; keep=true leaves the old one up until then.
    const load = async (produce, { keep = false } = {}) => {
        const mine = ++token;
        if (!keep) {
            revoke(value.value);
            value.value = null;
        }
        const next = await produce();
        if (mine !== token) {
            revoke(next);
            return false;
        }
        revoke(value.value);
        value.value = next;
        return true;
    };
    onBeforeUnmount(clear);
    return { value, load, clear };
}

// A page rendered as large as fits; the default slot is an overlay in the same box.
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
// Browsers cap canvas area; past this, zooming in stretches the last render instead of failing.
const MAX_STAGE_PIXELS = 36e6;

// One page, large, with its own zoom (pinch, ctrl/⌘ + wheel or the buttons) re-rendered sharp at every level.
export const PageStage = defineComponent({
    components: { Icon },
    props: {
        name: { type: String, required: true },
        page: { type: Number, required: true },
        maxHeight: { type: Number, default: 75 },
    },
    setup(props) {
        const store = inject('store');
        const wrap = ref(null);
        const scroller = ref(null);
        const boxWidth = ref(0);
        const fitHeight = ref(0);
        const zoom = ref(1);
        const image = useObjectUrls();
        let renderedScale = 0;
        let renderedPage = null;

        const aspect = computed(() => {
            void store.state.revisions[props.name]; // in-place edits change page sizes
            return store.pageAspect(props.name, props.page);
        });

        const render = async () => {
            if (!boxWidth.value) return;
            const page = props.page;
            const g = store.handler.geometry(props.name, page);
            const scale = Math.min((boxWidth.value * (window.devicePixelRatio || 1)) / g.width, Math.sqrt(MAX_STAGE_PIXELS / (g.width * g.height)));
            if (renderedPage === page && scale <= renderedScale * 1.15) return;
            const keep = renderedPage === page;
            // The old image is gone now, so flipping back to that page mid-render must not count as rendered.
            if (!keep) renderedPage = null;
            const shown = await image.load(() => store.handler.renderUrl(props.name, page, scale), { keep });
            if (shown) {
                renderedScale = scale;
                renderedPage = page;
            }
        };
        let renderTimer = null;
        const renderSoon = () => {
            clearTimeout(renderTimer);
            renderTimer = setTimeout(render, 150);
        };

        const measure = () => {
            if (!wrap.value) return;
            // Leave room for the sticky top bar and tool bar so the whole page fits on screen.
            const maxH = Math.max(320, Math.min((window.innerHeight * props.maxHeight) / 100, window.innerHeight - 210));
            const fit = Math.min(wrap.value.clientWidth, maxH * aspect.value);
            fitHeight.value = Math.ceil(fit / aspect.value);
            boxWidth.value = Math.floor(fit * zoom.value);
        };

        // Keeps the point under the cursor (or the middle) in place while zooming.
        const setZoom = async (next, event = null) => {
            next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
            if (Math.abs(next - zoom.value) < 0.001) return;
            const sc = scroller.value;
            const rect = sc.getBoundingClientRect();
            const px = event ? event.clientX - rect.left : sc.clientWidth / 2;
            const py = event ? event.clientY - rect.top : sc.clientHeight / 2;
            const fx = (sc.scrollLeft + px) / sc.scrollWidth;
            const fy = (sc.scrollTop + py) / sc.scrollHeight;
            zoom.value = next;
            measure();
            await nextTick();
            sc.scrollLeft = fx * sc.scrollWidth - px;
            sc.scrollTop = fy * sc.scrollHeight - py;
            renderSoon();
        };
        const step = (factor) => setZoom(Math.round(zoom.value * factor * 4) / 4);

        // Trackpad pinches arrive as ctrl + wheel; take them so the browser doesn't zoom (and blur) the whole page.
        const onWheel = (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setZoom(zoom.value * Math.exp(-e.deltaY * 0.01), e);
        };
        // Safari reports pinches as gesture events instead.
        let gestureBase = 1;
        const onGestureStart = (e) => { e.preventDefault(); gestureBase = zoom.value; };
        const onGestureChange = (e) => { e.preventDefault(); setZoom(gestureBase * e.scale, e); };

        let resizeObserver;
        onMounted(() => {
            resizeObserver = new ResizeObserver(() => { measure(); render(); });
            resizeObserver.observe(wrap.value);
            const sc = scroller.value;
            sc.addEventListener('wheel', onWheel, { passive: false });
            sc.addEventListener('gesturestart', onGestureStart);
            sc.addEventListener('gesturechange', onGestureChange);
            measure();
            render();
        });
        onBeforeUnmount(() => {
            resizeObserver?.disconnect();
            clearTimeout(renderTimer);
        });
        watch(() => props.page, () => { measure(); render(); });
        // Edited in place: same page number, new contents.
        watch(() => store.state.revisions[props.name], () => {
            renderedPage = null;
            renderedScale = 0;
            measure();
            render();
        });

        return { wrap, scroller, boxWidth, fitHeight, zoom, url: image.value, aspect, step, setZoom, ICONS, MIN_ZOOM, MAX_ZOOM };
    },
    template: `
        <div class="stage" ref="wrap">
            <div ref="scroller" :class="['stage__scroll', { 'stage__scroll--zoomed': zoom > 1 }]" :style="zoom > 1 ? { height: fitHeight + 'px' } : null">
                <div class="stage__page" :style="{ width: boxWidth + 'px', aspectRatio: aspect }">
                    <img v-if="url" :src="url" class="stage__img" draggable="false" alt=""/>
                    <div v-else class="stage__spin"><n-spin/></div>
                    <slot :width="boxWidth"></slot>
                </div>
            </div>
            <div class="stage__zoom" role="group" aria-label="Zoom">
                <button type="button" title="Zoom out" :disabled="zoom <= MIN_ZOOM" @click="step(1 / 1.25)"><icon :d="ICONS.minus" :size="14"/></button>
                <button type="button" class="stage__zoom-level" title="Fit page" @click="setZoom(1)">{{ Math.round(zoom * 100) }}%</button>
                <button type="button" title="Zoom in (or pinch)" :disabled="zoom >= MAX_ZOOM" @click="step(1.25)"><icon :d="ICONS.plus" :size="14"/></button>
            </div>
        </div>`,
});

export const PageNav = defineComponent({
    components: { Icon },
    props: {
        page: { type: Number, required: true },
        count: { type: Number, required: true },
        marks: { type: Object, default: null },
    },
    emits: ['update:page'],
    setup() {
        return { ICONS };
    },
    template: `
        <div class="pagenav">
            <n-button size="small" circle :disabled="page <= 1" @click="$emit('update:page', page - 1)" title="Previous page"><icon :d="ICONS.left"/></n-button>
            <span class="pagenav__label">Page
                <n-input-number :value="page" @update:value="v => v && $emit('update:page', Math.min(count, Math.max(1, v)))"
                    :min="1" :max="count" size="small" :show-button="false" class="pagenav__input"/>
                of {{ count }}
            </span>
            <n-button size="small" circle :disabled="page >= count" @click="$emit('update:page', page + 1)" title="Next page"><icon :d="ICONS.right"/></n-button>
            <span v-if="marks && marks.size" class="pagenav__marks">
                Edited:
                <button v-for="p in [...marks].sort((a, b) => a - b)" :key="p" type="button"
                    :class="['pagenav__mark', { 'pagenav__mark--on': p === page }]" @click="$emit('update:page', p)">{{ p }}</button>
            </span>
        </div>`,
});

export function useWindowListener(type, handler) {
    onMounted(() => window.addEventListener(type, handler));
    onBeforeUnmount(() => window.removeEventListener(type, handler));
}

// Keyboard shortcuts that stay out of the way while the user is typing.
export function useKeydown(handler) {
    useWindowListener('keydown', (e) => {
        const t = e.target;
        if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        handler(e);
    });
}

const NO_FILES = Object.freeze([]);

// Bind :file-list="upload.list" so n-upload keeps no history; it reports each picked file separately, so batch them.
export function useUpload(onFiles) {
    const batch = [];
    const onChange = ({ file }) => {
        if (!file?.file) return;
        if (!batch.length) setTimeout(() => onFiles(batch.splice(0)));
        batch.push(file.file);
    };
    return { list: NO_FILES, onChange };
}

export function pickFiles({ accept = '', capture = null, multiple = false } = {}) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        if (capture) input.capture = capture;
        input.onchange = () => resolve([...input.files]);
        input.oncancel = () => resolve([]);
        input.click();
    });
}

export function readFileBytes(file) {
    return file.arrayBuffer().then(b => new Uint8Array(b));
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function pointIn(event, el) {
    const r = el.getBoundingClientRect();
    return { x: clamp01((event.clientX - r.left) / r.width), y: clamp01((event.clientY - r.top) / r.height) };
}

export function boxStyle(rect) {
    return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };
}

// Drags one edge or corner (handle like 'nw', 'e') of a normalized rect, keeping a minimum size.
export function resizeRect(orig, handle, dx, dy, minW, minH = minW) {
    let left = orig.x, top = orig.y, right = orig.x + orig.w, bottom = orig.y + orig.h;
    if (handle.includes('w')) left = Math.min(clamp01(left + dx), right - minW);
    if (handle.includes('e')) right = Math.max(clamp01(right + dx), left + minW);
    if (handle.includes('n')) top = Math.min(clamp01(top + dy), bottom - minH);
    if (handle.includes('s')) bottom = Math.max(clamp01(bottom + dy), top + minH);
    return { x: left, y: top, w: right - left, h: bottom - top };
}

// Pointer drags in normalized coordinates of `el`. onMove(point, start) runs until release.
export function startDrag(event, el, onMove, onEnd = null) {
    event.preventDefault();
    event.stopPropagation();
    const start = pointIn(event, el);
    const move = (e) => onMove(pointIn(e, el), start, e);
    const up = (e) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        onEnd?.(pointIn(e, el), start, e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return start;
}
