import { PageGrid, SelectionBar, Icon, ICONS, pageItems, selectedPages } from './shared.js';
import { ImagesTool } from './images.js';
import { markdownPages, joinMarkdownPages } from '../pdf/markdown.js';
import { baseName, canvasToBlob, releaseCanvas } from '../pdf/handler.js';

const { defineComponent, inject, ref, computed, watch } = Vue;

// Browsers cap canvas area; stay well under it so big pages at 300 DPI still render.
const MAX_PIXELS = 36e6;

const ExportImages = defineComponent({
    components: { PageGrid, SelectionBar },
    props: { format: { type: String, required: true } },
    setup(props) {
        const store = inject('store');
        const name = store.state.doc;
        const count = store.docInfo.pageCount;
        const items = pageItems(name, count);
        const selected = ref([]);
        const format = computed(() => props.format);
        const dpi = ref(150);

        const pages = computed(() => selectedPages(items, selected.value));

        const exportImages = async () => {
            const type = format.value === 'png' ? 'image/png' : 'image/jpeg';
            const base = baseName(name);
            await store.run('Rendering images', async (progress) => {
                const files = [];
                for (const [i, p] of pages.value.entries()) {
                    const g = store.handler.geometry(name, p);
                    let scale = dpi.value / 72;
                    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (g.width * g.height)));
                    const canvas = await store.handler.renderCanvas(name, p, scale);
                    files.push({ name: `${base}-page-${String(p).padStart(String(count).length, '0')}.${format.value}`, blob: await canvasToBlob(canvas, type, 0.92) });
                    releaseCanvas(canvas);
                    progress((i + 1) / pages.value.length);
                }
                if (files.length === 1) return saveAs(files[0].blob, files[0].name);
                return store.saveZip(files, `${base}-images.zip`);
            });
        };

        const preview = (index) => store.openViewer(items, index);

        return { store, items, selected, format, dpi, pages, exportImages, preview };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="options">
                    <div class="field"><span class="field__label">Quality</span>
                        <n-radio-group v-model:value="dpi" size="small">
                            <n-radio-button :value="72">Screen</n-radio-button>
                            <n-radio-button :value="150">Standard</n-radio-button>
                            <n-radio-button :value="300">Print</n-radio-button>
                        </n-radio-group>
                    </div>
                    <div class="options__apply">
                        <n-button type="primary" :disabled="!!store.state.busy" @click="exportImages">
                            Download {{ pages.length }} {{ format.toUpperCase() }}{{ pages.length > 1 ? 's (ZIP)' : '' }}
                        </n-button>
                    </div>
                </div>
                <selection-bar :items="items" v-model:selected="selected" placeholder="All pages, or e.g. 1-3"/>
            </div>
            <page-grid :items="items" v-model:selected="selected" @preview="preview"/>
        </div>`,
});

const TextExport = defineComponent({
    components: { Icon },
    props: { format: { type: String, required: true } },
    setup(props) {
        const store = inject('store');
        const name = store.state.doc;
        const pages = ref(null);
        const pageBreaks = ref(false);
        const copied = ref(false);

        const plain = (page) => page.items.map(run => run.str + (run.eol ? '\n' : '')).join('').replace(/[ \t]+/g, ' ').trim();
        store.run('Reading text', progress => store.handler.allTextItems(name, progress))
            .then(result => { pages.value = props.format === 'md' ? markdownPages(result || []) : (result || []).map(plain); });

        const markdown = computed(() => {
            if (!pages.value) return '';
            if (props.format === 'md') return joinMarkdownPages(pages.value, { pageBreaks: pageBreaks.value });
            return pages.value.map((text, i) => (i && pageBreaks.value ? `--- Page ${i + 1} ---\n\n${text}` : text)).join('\n\n') + '\n';
        });
        const empty = computed(() => pages.value && !markdown.value.trim());

        const copy = async () => {
            await navigator.clipboard.writeText(markdown.value);
            copied.value = true;
            setTimeout(() => { copied.value = false; }, 1500);
        };
        const download = () => saveAs(
            new Blob([markdown.value], { type: `${props.format === 'md' ? 'text/markdown' : 'text/plain'};charset=utf-8` }),
            `${baseName(name)}.${props.format}`);

        return { pages, pageBreaks, markdown, empty, copied, copy, download, ICONS };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="tool__row">
                    <label class="inline-switch"><n-switch v-model:value="pageBreaks" size="small"/> Mark page breaks</label>
                    <div class="tool__primary">
                        <n-button :disabled="!markdown.trim()" @click="copy"><template #icon><icon :d="ICONS.copy"/></template>{{ copied ? 'Copied!' : 'Copy' }}</n-button>
                        <n-button type="primary" :disabled="!markdown.trim()" @click="download"><template #icon><icon :d="ICONS.download"/></template>Download .{{ format }}</n-button>
                    </div>
                </div>
            </div>
            <div v-if="!pages" class="hero"><n-spin/></div>
            <div v-else-if="empty" class="hero">
                <h2>No text found</h2>
                <p>This PDF looks like scanned images, so there's no text layer to extract.</p>
            </div>
            <textarea v-else class="markdown-out" readonly :value="markdown" spellcheck="false"></textarea>
        </div>`,
});

const FORMATS = [
    { id: 'jpg', direction: 'from', label: 'JPG images', icon: ICONS.image },
    { id: 'png', direction: 'from', label: 'PNG images', icon: ICONS.image },
    { id: 'md', direction: 'from', label: 'Markdown', icon: 'M3 6h18v12H3zM6 15V9l3 3 3-3v6M15 12l2 3 2-3M17 9v6' },
    { id: 'txt', direction: 'from', label: 'Plain text', icon: ICONS.text },
    { id: 'images', direction: 'to', label: 'Images', icon: 'M14 3v5h5M5 3h9l5 5v13H5zM9 14l2 2 4-4' },
    { id: 'scan', direction: 'to', label: 'Camera scan', icon: ICONS.camera },
];

function storedFormat(direction) {
    try {
        return localStorage.getItem(`pdfmerge.format.${direction}`);
    } catch {
        return null;
    }
}

// One component for both convert tools; `direction` picks which formats are offered.
export const ConvertTool = defineComponent({
    components: { Icon, ExportImages, TextExport, ImagesTool },
    props: { direction: { type: String, required: true } },
    setup(props) {
        const store = inject('store');
        const formats = FORMATS.filter(f => f.direction === props.direction);
        const wanted = store.state.toolParams?.format || storedFormat(props.direction);
        store.state.toolParams = null;
        const format = ref(formats.some(f => f.id === wanted) ? wanted : formats[0].id);

        watch(format, (f) => {
            try { localStorage.setItem(`pdfmerge.format.${props.direction}`, f); } catch {}
        });

        return { store, format, formats };
    },
    template: `
        <div class="tool">
            <div class="convert-pick" role="radiogroup" :aria-label="direction === 'from' ? 'Save as' : 'Create from'">
                <span class="convert-pick__label">{{ direction === 'from' ? 'Save as' : 'Create from' }}</span>
                <div class="convert-pick__options">
                    <button v-for="f in formats" :key="f.id" type="button" role="radio" :aria-checked="format === f.id"
                        :class="['convert-pick__option', { 'convert-pick__option--on': format === f.id }]" @click="format = f.id">
                        <icon :d="f.icon" :size="18"/>{{ f.label }}
                    </button>
                </div>
            </div>
            <export-images v-if="format === 'jpg' || format === 'png'" :key="'img-' + format + store.state.doc" :format="format"/>
            <text-export v-else-if="format === 'md' || format === 'txt'" :key="'text-' + format + store.state.doc" :format="format"/>
            <images-tool v-else :key="'pdf-' + format" :mode="format"/>
        </div>`,
});
