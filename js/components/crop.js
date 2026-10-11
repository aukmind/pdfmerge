import { PageStage, PageNav, Icon, ICONS, startDrag, resizeRect, boxStyle, useKeydown } from './shared.js';
import { cropPages } from '../pdf/ops.js';

const { defineComponent, inject, ref, reactive, computed } = Vue;

const MIN = 0.03;
const FULL = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

const Neighbor = defineComponent({
    components: { Icon },
    props: { name: String, page: Number, label: String, icon: String },
    emits: ['go'],
    setup(props) {
        const store = inject('store');
        const thumb = computed(() => (props.page ? store.thumb(props.name, props.page) : null));
        const aspect = computed(() => {
            void store.state.revisions[props.name];
            return props.page ? store.pageAspect(props.name, props.page) : 1;
        });
        return { thumb, aspect };
    },
    template: `
        <button v-if="page" type="button" class="crop-neighbor" @click="$emit('go')" :title="label + ' (page ' + page + ')'">
            <span class="crop-neighbor__sheet" :style="{ aspectRatio: aspect }">
                <img v-if="thumb" :src="thumb" alt="" draggable="false"/>
            </span>
            <span class="crop-neighbor__label"><icon :d="icon" :size="14"/>{{ label }} · {{ page }}</span>
        </button>
        <div v-else class="crop-neighbor crop-neighbor--empty"></div>`,
});

export const CropTool = defineComponent({
    components: { PageStage, PageNav, Neighbor, Icon },
    setup() {
        const store = inject('store');
        const name = store.state.doc;
        const count = store.docInfo.pageCount;
        const page = ref(1);
        const rect = reactive({ ...FULL });
        const overlay = ref(null);

        const drag = (event, mode) => {
            const orig = { ...rect };
            startDrag(event, overlay.value, (p, s) => {
                const dx = p.x - s.x;
                const dy = p.y - s.y;
                if (mode === 'move') {
                    rect.x = Math.min(1 - orig.w, Math.max(0, orig.x + dx));
                    rect.y = Math.min(1 - orig.h, Math.max(0, orig.y + dy));
                    return;
                }
                if (mode === 'new') {
                    rect.x = Math.min(s.x, p.x);
                    rect.y = Math.min(s.y, p.y);
                    rect.w = Math.max(MIN, Math.abs(p.x - s.x));
                    rect.h = Math.max(MIN, Math.abs(p.y - s.y));
                    return;
                }
                Object.assign(rect, resizeRect(orig, mode, dx, dy, MIN));
            });
        };

        const sizeLabel = computed(() => {
            void store.state.revisions[name];
            const g = store.handler.geometry(name, page.value);
            const mm = (pt) => Math.round((pt * 25.4) / 72);
            return `${mm(rect.w * g.width)} × ${mm(rect.h * g.height)} mm`;
        });

        const crop = (pages, summary) => store.edit('Cropping',
            async () => cropPages(await store.handler.freshDoc(name), { ...rect }, pages), summary);

        // The same box carries over, so cropping a stack of scans is one click per page.
        // Done cropping: show every page in Organize.
        const finish = () => store.setTool('organize');
        const cropThis = async () => {
            const current = page.value;
            if (!(await crop([current], `Cropped page ${current} of ${count}`))) return;
            if (current < count) page.value = current + 1;
            else finish();
        };
        const cropAll = async () => {
            if (await crop(Array.from({ length: count }, (_, i) => i + 1), `Cropped all ${count} pages`)) finish();
        };

        const go = (p) => { if (p >= 1 && p <= count) page.value = p; };
        useKeydown((e) => {
            if (e.key === 'Enter' && !store.state.busy) {
                e.preventDefault();
                cropThis();
            }
            else if (e.key === 'ArrowLeft') go(page.value - 1);
            else if (e.key === 'ArrowRight') go(page.value + 1);
        });

        const reset = () => Object.assign(rect, FULL);

        return { store, name, count, page, rect, overlay, drag, sizeLabel, cropThis, cropAll, go, reset, boxStyle, ICONS };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="tool__row">
                    <page-nav v-model:page="page" :count="count"/>
                    <div class="tool__primary">
                        <n-button quaternary @click="reset">Reset box</n-button>
                        <n-button v-if="count > 1" :disabled="!!store.state.busy" @click="cropAll">Crop all {{ count }} pages</n-button>
                        <n-button type="primary" :disabled="!!store.state.busy" @click="cropThis">
                            Crop page {{ page }}<template v-if="page < count"> &amp; next</template>
                        </n-button>
                    </div>
                </div>
            </div>
            <div class="crop-flow">
                <neighbor :name="name" :page="page > 1 ? page - 1 : 0" label="Previous" :icon="ICONS.left" @go="go(page - 1)"/>
                <div class="crop-flow__main">
                    <page-stage :name="name" :page="page">
                        <div class="crop" ref="overlay" @pointerdown="drag($event, 'new')">
                            <div class="crop__rect" :style="boxStyle(rect)" @pointerdown="drag($event, 'move')">
                                <span class="crop__size">{{ sizeLabel }}</span>
                                <span v-for="h in ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']" :key="h" :class="['crop__handle', 'crop__handle--' + h]"
                                      @pointerdown="drag($event, h)"></span>
                            </div>
                        </div>
                    </page-stage>
                    <p class="tool__note">Drag the box or its handles · Enter crops this page and moves to the next · ← → to browse</p>
                </div>
                <neighbor :name="name" :page="page < count ? page + 1 : 0" label="Next" :icon="ICONS.right" @go="go(page + 1)"/>
            </div>
        </div>`,
});
