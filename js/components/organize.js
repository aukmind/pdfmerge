import { PageGrid, SelectionBar, Icon, ICONS, useKeydown, keysToPositions } from './shared.js';
import { OptionsToggle, OptionsPanel } from './options.js';
import { NumberFields, numberOptions, useNumberPreview } from './numbers.js';
import { ImageOptionFields } from './images.js';
import { composePages, addPageNumbers, imagesToPdf, replacePages, DEFAULT_IMAGE_OPTIONS } from '../pdf/ops.js';
import { prepareImage } from '../pdf/images.js';
import { pagesToRangeString } from '../pdf/ranges.js';
import { baseName } from '../pdf/handler.js';

const { defineComponent, inject, ref, reactive, shallowRef, computed, watch, markRaw } = Vue;

let nextId = 0;

const NUMBERS_ICON = 'M4 4h16v16H4zM9 9h2v6M9 15h4';

export const OrganizeTool = defineComponent({
    components: { PageGrid, SelectionBar, Icon, OptionsToggle, OptionsPanel, NumberFields, ImageOptionFields },
    setup() {
        const store = inject('store');
        const name = store.state.doc;
        const board = ref([]);
        const selected = ref([]);
        // Snapshots are plain, non-reactive copies; only the list itself needs to be watched.
        const history = shallowRef([]);
        const panel = ref(store.state.toolParams?.panel || null);
        store.state.toolParams = null;

        const itemsFrom = (from) => Array.from({ length: store.docInfo.pageCount - from }, (_, i) => ({
            key: `p${nextId++}`, name, page: from + i + 1, index: from + i, rotation: 0,
        }));
        const build = () => {
            board.value = itemsFrom(0);
            selected.value = [];
            history.value = [];
        };
        build();

        // Stays mounted across edits so pages added while reordering join the board instead of wiping it.
        watch(() => store.state.revisions[name], (rev) => {
            const appended = store.state.appended;
            if (appended?.revision !== rev || !history.value.length) return build();
            const added = itemsFrom(appended.from);
            board.value.push(...added);
            history.value = history.value.map(snap => markRaw([...snap, ...added.map(item => ({ ...item }))]));
        });

        const snapshot = () => {
            history.value = [...history.value.slice(-49), markRaw(board.value.map(item => ({ ...item })))];
        };
        const undo = () => {
            const prev = history.value.at(-1);
            if (!prev) return;
            history.value = history.value.slice(0, -1);
            board.value = prev.map(item => ({ ...item }));
            const keys = new Set(prev.map(i => i.key));
            selected.value = selected.value.filter(k => keys.has(k));
        };

        const targets = () => (selected.value.length ? new Set(selected.value) : new Set(board.value.map(i => i.key)));
        const rotate = (delta, only = null) => {
            snapshot();
            const keys = only ? new Set([only]) : targets();
            for (const item of board.value) {
                if (keys.has(item.key)) item.rotation = (item.rotation + delta + 360) % 360;
            }
        };
        const remove = (only = null) => {
            const keys = only ? new Set([only]) : new Set(selected.value);
            if (!keys.size || keys.size >= board.value.length) return;
            snapshot();
            board.value = board.value.filter(i => !keys.has(i.key));
            selected.value = selected.value.filter(k => !keys.has(k));
        };
        const reorder = (from, to) => {
            snapshot();
            const [item] = board.value.splice(from, 1);
            board.value.splice(to, 0, item);
        };

        const compose = (items) => () => composePages(store.handler, items);
        const save = () => store.edit('Saving pages', compose(board.value), 'Pages updated');
        const extract = () => {
            const keys = new Set(selected.value);
            const range = pagesToRangeString(keysToPositions(board.value, selected.value)).replace(/\s+/g, '');
            store.output('Extracting pages', `${baseName(name)}-pages-${range}.pdf`, compose(board.value.filter(i => keys.has(i.key))));
        };

        const numbers = numberOptions();
        const numbered = computed(() => (selected.value.length ? keysToPositions(board.value, selected.value) : board.value.map((_, i) => i + 1)));
        const displaySizes = computed(() => board.value.map((item) => {
            const g = store.handler.geometry(item.name, item.page);
            return item.rotation % 180 ? { width: g.height, height: g.width } : g;
        }));
        const { targetIndex, numberStyle, numberText } = useNumberPreview(numbers, displaySizes, numbered);
        // Unsaved reordering is applied in the same step, so page edits follow the board's order.
        const boardDoc = async () => (history.value.length
            ? PDFLib.PDFDocument.load(await composePages(store.handler, board.value))
            : store.handler.freshDoc(name));

        const addNumbers = async () => {
            const done = await store.edit('Adding page numbers', async () =>
                addPageNumbers(await boardDoc(), { ...numbers, pages: numbered.value }), 'Page numbers added');
            if (done) panel.value = null;
        };

        // Pages made from a dropped image can be rebuilt from the original with other options.
        const sourceOf = (item) => store.imageSource(store.handler.imageTag(item.name, item.page));
        const imagePages = computed(() => board.value.filter(sourceOf));
        // Image options show only image pages, with their place in the document, and nothing can be moved meanwhile.
        const imageMode = computed(() => panel.value === 'image' && imagePages.value.length > 0);
        const imageItems = computed(() => imagePages.value.map(item => ({ ...item, label: board.value.indexOf(item) + 1 })));
        const imageSelected = ref([]);
        const imageTargets = computed(() => {
            const keys = new Set(imageSelected.value);
            const picked = imagePages.value.filter(i => keys.has(i.key));
            return picked.length ? picked : imagePages.value;
        });
        const gridItems = computed(() => (imageMode.value ? imageItems.value : board.value));
        const gridSelected = computed(() => (imageMode.value ? imageSelected.value : selected.value));
        const setGridSelected = (keys) => { (imageMode.value ? imageSelected : selected).value = keys; };
        const imageOptions = reactive({ ...DEFAULT_IMAGE_OPTIONS });
        watch(panel, (open, was) => {
            if (open === 'image' && imageTargets.value.length) Object.assign(imageOptions, sourceOf(imageTargets.value[0]).options);
            else if (was === 'image') imageSelected.value = [];
        });
        const editImage = (item) => {
            imageSelected.value = [item.key];
            panel.value = 'image';
        };
        const updateImages = async () => {
            const options = { ...imageOptions };
            const targets = imageTargets.value.map(item => ({
                index: board.value.indexOf(item), tag: store.handler.imageTag(item.name, item.page), source: sourceOf(item),
            }));
            const done = await store.edit('Updating image pages', async (progress) => {
                const doc = await boardDoc();
                const replacements = new Map();
                for (const [i, t] of targets.entries()) {
                    const image = await prepareImage(t.source.file, { enhance: options.enhance });
                    replacements.set(t.index, await imagesToPdf([{ ...image, tag: t.tag }], options));
                    progress((i + 1) / targets.length);
                }
                return replacePages(doc, replacements);
            }, targets.length === 1 ? 'Image page updated' : 'Image pages updated');
            if (!done) return;
            targets.forEach(t => { t.source.options = options; });
            panel.value = null;
        };

        const preview = (index) => {
            const items = gridItems.value;
            store.openViewer(items, index, {
                isSelected: item => gridSelected.value.includes(item.key),
                toggle: item => {
                    const keys = gridSelected.value;
                    setGridSelected(keys.includes(item.key)
                        ? keys.filter(k => k !== item.key)
                        : items.filter(i => i.key === item.key || keys.includes(i.key)).map(i => i.key));
                },
            });
        };

        useKeydown((e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                setGridSelected(gridItems.value.map(i => i.key));
            } else if (imageMode.value) {
                return;
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value.length) {
                e.preventDefault();
                remove();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undo();
            }
        });

        const n = computed(() => selected.value.length);

        return {
            store, board, selected, rotate, remove, reorder, undo, history, n, save, extract, preview, panel,
            numbers, numbered, targetIndex, numberStyle, numberText, addNumbers, NUMBERS_ICON, ICONS,
            sourceOf, imagePages, imageMode, imageTargets, imageOptions, editImage, updateImages, gridItems, gridSelected, setGridSelected,
        };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="tool__row">
                    <div class="tool__actions">
                        <span class="tool__label">{{ n && !imageMode ? 'Selected:' : 'All pages:' }}</span>
                        <n-button size="small" :disabled="imageMode" @click="rotate(-90)" title="Rotate left"><template #icon><icon :d="ICONS.rotateLeft"/></template></n-button>
                        <n-button size="small" :disabled="imageMode" @click="rotate(90)" title="Rotate right"><template #icon><icon :d="ICONS.rotateRight"/></template></n-button>
                        <n-button size="small" :disabled="imageMode || !n || n >= board.length" @click="remove()" title="Delete selected (Del)"><template #icon><icon :d="ICONS.trash"/></template>Delete</n-button>
                        <n-button size="small" :disabled="imageMode || !history.length" @click="undo" title="Undo (Ctrl+Z)"><template #icon><icon :d="ICONS.undo"/></template>Undo</n-button>
                    </div>
                    <options-toggle v-model="panel" value="numbers" label="Page numbers" :icon="NUMBERS_ICON"/>
                    <options-toggle v-if="imagePages.length" v-model="panel" value="image" label="Image options" :icon="ICONS.image"/>
                    <div class="tool__primary">
                        <span class="tool__summary">{{ imageMode ? imagePages.length + ' of ' + board.length : board.length }} {{ board.length === 1 ? 'page' : 'pages' }}{{ history.length ? ' · unsaved changes' : '' }}</span>
                        <n-button v-if="n" @click="extract" :disabled="imageMode || !!store.state.busy">Extract {{ n }} {{ n === 1 ? 'page' : 'pages' }}</n-button>
                        <n-button type="primary" @click="save" :disabled="imageMode || !history.length || !!store.state.busy">Apply changes</n-button>
                    </div>
                </div>
                <options-panel :open="panel === 'numbers'">
                    <number-fields :numbers="numbers"/>
                    <div class="options__apply">
                        <n-button type="primary" :disabled="!!store.state.busy" @click="addNumbers">
                            Add numbers to {{ n ? numbered.length + (numbered.length === 1 ? ' page' : ' pages') : 'all pages' }}
                        </n-button>
                    </div>
                </options-panel>
                <options-panel :open="panel === 'image' && imagePages.length > 0">
                    <image-option-fields :options="imageOptions"/>
                    <span class="options-panel__hint">Only image pages are shown. Pick the ones to change, or leave none picked to change them all.</span>
                    <div class="options__apply">
                        <n-button type="primary" :disabled="!!store.state.busy" @click="updateImages">
                            Update {{ imageTargets.length }} image {{ imageTargets.length === 1 ? 'page' : 'pages' }}
                        </n-button>
                    </div>
                </options-panel>
                <selection-bar :items="gridItems" :selected="gridSelected" @update:selected="setGridSelected"/>
            </div>
            <page-grid :key="imageMode ? 'images' : 'pages'" :items="gridItems" :selected="gridSelected" @update:selected="setGridSelected"
                :sortable="!imageMode" @reorder="reorder" @preview="preview">
                <template #overlay="{ index }">
                    <span v-if="panel === 'numbers' && targetIndex.has(index + 1)" class="stamp-number" :style="numberStyle(index + 1)">{{ numberText(index + 1) }}</span>
                </template>
                <template v-if="!imageMode" #actions="{ item }">
                    <button v-if="sourceOf(item)" class="page-card__tool" type="button" title="Image options" @click="editImage(item)"><icon :d="ICONS.settings"/></button>
                    <button class="page-card__tool" type="button" title="Rotate" @click="rotate(90, item.key)"><icon :d="ICONS.rotateRight"/></button>
                    <button v-if="board.length > 1" class="page-card__tool page-card__tool--danger" type="button" title="Delete" @click="remove(item.key)"><icon :d="ICONS.trash"/></button>
                </template>
            </page-grid>
        </div>`,
});
