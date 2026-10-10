import { PageGrid, SelectionBar, pageItems, selectedPages } from './shared.js';
import { FontSelect } from './fonts.js';
import { cssFont } from '../pdf/fonts.js';
import { addWatermark, tileCenters, fontLoader, referenceWidth, stampScale } from '../pdf/ops.js';
import { prepareImage } from '../pdf/images.js';

const { defineComponent, inject, ref, reactive, computed, watch, onBeforeUnmount, markRaw } = Vue;

// A throwaway document just to measure text with the real PDF font metrics; fonts are embedded on first use.
let metricsFont = null;
function measuringFont(family, bold) {
    metricsFont ??= PDFLib.PDFDocument.create().then(fontLoader);
    return metricsFont.then(font => font(family, bold));
}

export const WatermarkTool = defineComponent({
    components: { PageGrid, SelectionBar, FontSelect },
    setup() {
        const store = inject('store');
        const name = store.state.doc;
        const count = store.docInfo.pageCount;
        const items = pageItems(name, count);
        const selected = ref([]);
        const fonts = reactive({});

        const mark = reactive({
            kind: 'text', text: 'CONFIDENTIAL', font: 'helvetica', bold: true, size: 64, color: '#dc2626',
            opacity: 0.25, angle: 45, tile: false, image: null, imageUrl: null, scale: 0.5,
        });

        const targets = computed(() => selectedPages(items, selected.value));

        watch(() => `${mark.font}-${mark.bold}`, (key) => {
            if (fonts[key]) return;
            measuringFont(mark.font, mark.bold)
                .then(f => { fonts[key] = markRaw(f); })
                .catch(err => store.message.error(err.message));
        }, { immediate: true });

        const geometry = (page) => store.handler.geometry(name, page);
        // Same rule as when applying: sizes scale with the page's width relative to the widest page.
        const fullWidth = referenceWidth(items.map(i => geometry(i.page)));
        const scale = (page) => stampScale(geometry(page), fullWidth);
        const em = (size) => `${(size / fullWidth) * 100}cqw`;

        const targetSet = computed(() => new Set(targets.value));

        const markSize = (page) => {
            const g = geometry(page);
            if (mark.kind === 'image') {
                if (!mark.image) return null;
                const w = g.width * mark.scale;
                return { w, h: (w * mark.image.height) / mark.image.width };
            }
            const font = fonts[`${mark.font}-${mark.bold}`];
            if (!font) return null;
            const text = mark.text || ' ';
            const s = mark.size * scale(page);
            let w;
            try {
                w = font.widthOfTextAtSize(text, s);
            } catch {
                // Characters outside WinAnsi can't be measured (applying reports them); estimate so the preview still renders.
                w = text.length * s * 0.6;
            }
            return { w, h: s * 0.7 };
        };
        const markCenters = (page) => {
            const size = markSize(page);
            if (!size) return [];
            return mark.tile ? tileCenters(geometry(page), size.w, size.h, mark.angle) : [[0.5, 0.5]];
        };
        const markStyle = (page, [u, v]) => ({
            left: `${u * 100}%`,
            top: `${v * 100}%`,
            transform: `translate(-50%, -50%) rotate(${-mark.angle}deg)`,
            opacity: mark.opacity,
            ...(mark.kind === 'image'
                ? { width: `${mark.scale * 100}%` }
                : { fontSize: em(mark.size), color: mark.color, fontFamily: cssFont(mark.font), fontWeight: mark.bold ? 700 : 400 }),
        });

        const onImage = async ({ file }) => {
            if (!file?.file) return;
            const image = await store.run('Reading image', () => prepareImage(file.file, { maxSide: 2000 }));
            if (!image) return;
            if (mark.imageUrl) URL.revokeObjectURL(mark.imageUrl);
            mark.image = image;
            mark.imageUrl = URL.createObjectURL(file.file);
        };
        onBeforeUnmount(() => mark.imageUrl && URL.revokeObjectURL(mark.imageUrl));

        const canApply = computed(() => (mark.kind === 'text' ? mark.text.trim() : mark.image));
        const apply = () => store.edit('Adding watermark', async () =>
            addWatermark(await store.handler.freshDoc(name), { ...mark, pages: targets.value }), 'Watermark added');

        const preview = (index) => store.openViewer(items, index);

        return {
            store, items, selected, targets, targetSet, mark,
            markCenters, markStyle, onImage, canApply, apply, preview,
        };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="options">
                        <div class="field">
                            <span class="field__label">Stamp</span>
                            <n-radio-group v-model:value="mark.kind" size="small">
                                <n-radio-button value="text">Text</n-radio-button>
                                <n-radio-button value="image">Image</n-radio-button>
                            </n-radio-group>
                        </div>
                        <template v-if="mark.kind === 'text'">
                            <label class="field field--grow"><span class="field__label">Text</span>
                                <n-input v-model:value="mark.text" size="small" placeholder="Watermark text"/></label>
                            <label class="field"><span class="field__label">Font</span>
                                <font-select v-model:value="mark.font" class="field__control--md"/></label>
                            <label class="field"><span class="field__label">Bold</span><n-switch v-model:value="mark.bold"/></label>
                            <label class="field field--grow"><span class="field__label">Size {{ mark.size }}pt</span>
                                <n-slider v-model:value="mark.size" :min="12" :max="160" :tooltip="false"/></label>
                            <label class="field"><span class="field__label">Color</span>
                                <n-color-picker v-model:value="mark.color" :show-alpha="false" size="small" :modes="['hex']" class="field__control--sm"/></label>
                        </template>
                        <template v-else>
                            <div class="field">
                                <span class="field__label">Image</span>
                                <n-upload accept="image/*" :show-file-list="false" :default-upload="false" @change="onImage">
                                    <n-button size="small">{{ mark.image ? 'Change image' : 'Choose image' }}</n-button>
                                </n-upload>
                            </div>
                            <label class="field field--grow"><span class="field__label">Width {{ Math.round(mark.scale * 100) }}%</span>
                                <n-slider v-model:value="mark.scale" :min="0.05" :max="1" :step="0.05" :tooltip="false"/></label>
                        </template>
                        <label class="field field--grow"><span class="field__label">Opacity {{ Math.round(mark.opacity * 100) }}%</span>
                            <n-slider v-model:value="mark.opacity" :min="0.05" :max="1" :step="0.05" :tooltip="false"/></label>
                        <label class="field field--grow"><span class="field__label">Angle {{ mark.angle }}°</span>
                            <n-slider v-model:value="mark.angle" :min="-90" :max="90" :step="5" :tooltip="false"/></label>
                        <label class="field"><span class="field__label">Repeat</span><n-switch v-model:value="mark.tile"/></label>
                    <div class="options__apply">
                        <n-button type="primary" :disabled="!canApply || !!store.state.busy" @click="apply">
                            Add watermark to {{ selected.length ? targets.length + (targets.length === 1 ? ' page' : ' pages') : 'all pages' }}
                        </n-button>
                    </div>
                </div>
                <selection-bar :items="items" v-model:selected="selected" placeholder="All pages, or e.g. 2-5"/>
            </div>
            <page-grid :items="items" v-model:selected="selected" @preview="preview">
                <template #overlay="{ item }">
                    <template v-if="targetSet.has(item.page)">
                        <template v-for="(c, ci) in markCenters(item.page)" :key="ci">
                            <img v-if="mark.kind === 'image'" :src="mark.imageUrl" class="stamp-mark stamp-mark--image" :style="markStyle(item.page, c)" alt=""/>
                            <span v-else class="stamp-mark" :style="markStyle(item.page, c)">{{ mark.text }}</span>
                        </template>
                    </template>
                </template>
            </page-grid>
        </div>`,
});
