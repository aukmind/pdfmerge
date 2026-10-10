import { PageNav, useObjectUrls, pickFiles } from './shared.js';
import { canvasToBlob, releaseCanvas, baseName, PDF_MIME } from '../pdf/handler.js';
import { mapLimit } from '../util.js';

const { defineComponent, inject, ref, shallowRef, computed, watch, onBeforeUnmount } = Vue;

const VISUAL_WIDTH = 900;

function blankCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    return c;
}

function fitTo(canvas, w, h) {
    if (canvas.width === w && canvas.height === h) return canvas;
    const out = blankCanvas(w, h);
    out.getContext('2d').drawImage(canvas, 0, 0);
    return out;
}

// Red where pages differ, a faint copy of A elsewhere.
function diffCanvas(a, b) {
    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);
    const out = blankCanvas(w, h);
    out.getContext('2d').drawImage(a, 0, 0);
    const da = out.getContext('2d').getImageData(0, 0, w, h);
    const other = fitTo(b, w, h).getContext('2d').getImageData(0, 0, w, h).data;
    const px = da.data;
    let changed = 0;
    for (let i = 0; i < px.length; i += 4) {
        const d = Math.abs(px[i] - other[i]) + Math.abs(px[i + 1] - other[i + 1]) + Math.abs(px[i + 2] - other[i + 2]);
        if (d > 60) {
            px[i] = 220; px[i + 1] = 38; px[i + 2] = 38;
            changed++;
        } else {
            const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
            px[i] = px[i + 1] = px[i + 2] = 255 - (255 - lum) * 0.22;
        }
    }
    out.getContext('2d').putImageData(da, 0, 0);
    return { canvas: out, ratio: changed / (w * h) };
}

export const CompareTool = defineComponent({
    components: { PageNav },
    setup() {
        const store = inject('store');
        const a = ref(store.state.doc);
        const b = ref(null);
        // What the document is compared with: its version before your changes, or PDFs picked here. Never added to the document.
        const others = shallowRef([]);

        const addOther = async (file) => {
            const name = await store.handler.add(file);
            if (store.handler.info(name).status !== 'ok') {
                store.handler.remove(name);
                store.message.error(`Can't compare with ${file.name}: it's password-protected or damaged`);
                return;
            }
            others.value = [...others.value, name];
            b.value = name;
        };
        const choose = async () => {
            const [file] = await pickFiles({ accept: '.pdf,application/pdf' });
            if (file) await addOther(file);
        };
        const original = store.handler.original(a.value);
        const starting = ref(!!original);
        if (original) addOther(new File([original], `${baseName(a.value)} (before changes).pdf`, { type: PDF_MIME })).finally(() => { starting.value = false; });
        onBeforeUnmount(() => others.value.forEach(name => store.handler.remove(name)));
        const mode = ref('text');
        const onlyChanged = ref(true);
        const textPages = ref(null);
        const page = ref(1);
        const visual = useObjectUrls();

        const options = computed(() => others.value.map(name => ({ label: name, value: name })));
        const info = (name) => (name ? store.handler.info(name) : null);
        const pageCount = computed(() => Math.max(info(a.value)?.pageCount || 0, info(b.value)?.pageCount || 0));
        const valid = computed(() => a.value && b.value && a.value !== b.value && info(a.value) && info(b.value));

        const pageText = (name, p) => (p <= info(name).pageCount ? store.handler.pageText(name, p) : '');
        const words = (parts, key) => parts.filter(x => x[key]).reduce((n, x) => n + (x.value.match(/\S+/g)?.length || 0), 0);

        let textRun = 0;
        const runText = async () => {
            const mine = ++textRun;
            textPages.value = null;
            if (!valid.value) return;
            const [nameA, nameB, total] = [a.value, b.value, pageCount.value];
            const result = await store.run('Comparing text', (progress) => {
                if (mine !== textRun) return null;
                let done = 0;
                return mapLimit(Array.from({ length: total }, (_, i) => i + 1), 6, async (p) => {
                    const parts = Diff.diffWordsWithSpace(await pageText(nameA, p), await pageText(nameB, p));
                    progress(++done / total);
                    return { page: p, parts, added: words(parts, 'added'), removed: words(parts, 'removed') };
                });
            });
            if (mine === textRun) textPages.value = result || [];
        };

        const runVisual = () => {
            if (!valid.value) return visual.clear();
            const [nameA, nameB, p] = [a.value, b.value, page.value];
            const render = (name) => (p > info(name).pageCount
                ? blankCanvas(VISUAL_WIDTH, Math.round(VISUAL_WIDTH * 1.414))
                : store.handler.renderCanvas(name, p, VISUAL_WIDTH / store.handler.geometry(name, p).width));
            return visual.load(async () => {
                const [ca, cb] = await Promise.all([render(nameA), render(nameB)]);
                const { canvas, ratio } = diffCanvas(ca, cb);
                const toUrl = async (c, type) => URL.createObjectURL(await canvasToBlob(c, type, 0.9));
                const [ua, ub, ud] = await Promise.all([toUrl(ca, 'image/jpeg'), toUrl(cb, 'image/jpeg'), toUrl(canvas, 'image/png')]);
                [ca, cb, canvas].forEach(releaseCanvas);
                return { a: ua, b: ub, diff: ud, ratio };
            });
        };

        watch([a, b, mode], () => {
            page.value = Math.min(page.value, pageCount.value || 1);
            mode.value === 'text' ? runText() : runVisual();
        }, { immediate: true });
        watch(page, () => mode.value === 'visual' && runVisual());

        const shown = computed(() => (textPages.value || []).filter(p => !onlyChanged.value || p.added || p.removed));
        const totals = computed(() => (textPages.value || []).reduce((t, p) => ({
            added: t.added + p.added, removed: t.removed + p.removed, pages: t.pages + (p.added || p.removed ? 1 : 0),
        }), { added: 0, removed: 0, pages: 0 }));

        return { a, b, starting, choose, mode, onlyChanged, options, valid, textPages, shown, totals, page, pageCount, visual: visual.value };
    },
    template: `
        <div class="tool">
            <div v-if="starting" class="hero"><n-spin/></div>
            <div v-else-if="!b" class="hero">
                <h2>Compare {{ a }} with another PDF</h2>
                <p>Pick the other version. It's only compared, not added to your document.</p>
                <n-button type="primary" @click="choose">Choose a PDF</n-button>
            </div>
            <template v-else>
                <div class="tool__bar">
                    <div class="tool__row">
                        <div class="compare-pick">
                            <span class="compare-pick__doc" :title="a">{{ a }}</span>
                            <span class="tool__label">with</span>
                            <n-select v-model:value="b" :options="options" size="small" class="compare-pick__select"/>
                            <n-button size="small" @click="choose">Choose a PDF…</n-button>
                        </div>
                        <n-radio-group v-model:value="mode" size="small">
                            <n-radio-button value="text">Text</n-radio-button>
                            <n-radio-button value="visual">Visual</n-radio-button>
                        </n-radio-group>
                    </div>
                    <div v-if="valid && mode === 'text' && textPages" class="tool__row">
                        <span class="diff-summary">
                            <template v-if="totals.pages">
                                {{ totals.pages }} page{{ totals.pages > 1 ? 's' : '' }} changed ·
                                <span class="diff-summary__add">+{{ totals.added }} words</span> ·
                                <span class="diff-summary__del">−{{ totals.removed }} words</span>
                            </template>
                            <template v-else>No text differences</template>
                        </span>
                        <label class="inline-switch"><n-switch v-model:value="onlyChanged" size="small"/> Only changed pages</label>
                    </div>
                    <div v-if="valid && mode === 'visual'" class="tool__row">
                        <page-nav v-model:page="page" :count="pageCount"/>
                        <span v-if="visual" class="diff-summary">{{ visual.ratio < 0.0005 ? 'Pages look identical' : (visual.ratio * 100).toFixed(1) + '% of pixels differ' }}</span>
                    </div>
                </div>

                <p v-if="!valid" class="tool__note">Pick a PDF to compare with.</p>
                <div v-else-if="mode === 'text'" class="diff-pages">
                    <div v-if="!textPages" class="hero"><n-spin/></div>
                    <section v-for="p in shown" :key="p.page" class="diff-page">
                        <h3>Page {{ p.page }}
                            <span v-if="p.added" class="diff-summary__add">+{{ p.added }}</span>
                            <span v-if="p.removed" class="diff-summary__del">−{{ p.removed }}</span>
                        </h3>
                        <div class="diff-cols">
                            <div class="diff-col"><span class="diff-col__label">{{ a }}</span>
                                <p><template v-for="(part, i) in p.parts" :key="i"><del v-if="part.removed">{{ part.value }}</del><span v-else-if="!part.added">{{ part.value }}</span></template></p>
                            </div>
                            <div class="diff-col"><span class="diff-col__label">{{ b }}</span>
                                <p><template v-for="(part, i) in p.parts" :key="i"><ins v-if="part.added">{{ part.value }}</ins><span v-else-if="!part.removed">{{ part.value }}</span></template></p>
                            </div>
                        </div>
                    </section>
                </div>
                <div v-else class="diff-visual">
                    <div v-if="!visual" class="hero"><n-spin/></div>
                    <template v-else>
                        <figure><figcaption>{{ a }}</figcaption><img :src="visual.a" alt=""/></figure>
                        <figure><figcaption>{{ b }}</figcaption><img :src="visual.b" alt=""/></figure>
                        <figure><figcaption>Differences</figcaption><img :src="visual.diff" alt=""/></figure>
                    </template>
                </div>
            </template>
        </div>`,
});
