import { pagesToRangeString, safePagesFromRanges } from '../pdf/ranges.js';
import { Icon, ICONS } from '/shared/icons.js';
import { usePinchZoom } from '/shared/zoom.js';
import { useWindowListener, useKeydown, pickFiles, useObjectUrls, useSortable, clamp01, pointIn, boxStyle, resizeRect, startDrag } from '/shared/dom.js';

const { defineComponent, inject, provide, computed, ref, shallowRef, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

export { Icon, ICONS, useWindowListener, useKeydown, pickFiles, useObjectUrls, useSortable, clamp01, pointIn, boxStyle, resizeRect, startDrag };

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
                    <n-button @click="parity(true)" class="selbar__extra">Odd</n-button>
                    <n-button @click="parity(false)" class="selbar__extra">Even</n-button>
                    <n-button @click="invert" class="selbar__extra">Invert</n-button>
                    <n-button @click="none" :disabled="!selected.length">None</n-button>
                </n-button-group>
                <span class="selbar__count">{{ selected.length ? selected.length + ' of ' + items.length + ' selected' : 'Click pages to select · Shift-click for a range' }}</span>
            </div>
            <zoom-slider/>
        </div>`,
});

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

        usePinchZoom(scroller, { get: () => zoom.value, set: setZoom });

        let resizeObserver;
        onMounted(() => {
            resizeObserver = new ResizeObserver(() => { measure(); render(); });
            resizeObserver.observe(wrap.value);
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

export function readFileBytes(file) {
    return file.arrayBuffer().then(b => new Uint8Array(b));
}
