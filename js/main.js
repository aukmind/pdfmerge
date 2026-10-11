import { createStore } from './store.js';
import { TOOLS, TOOL_GROUPS, toolById } from './tools.js';
import { Icon, ICONS, useObjectUrls, useWindowListener, pickFiles } from './components/shared.js';
import { OrganizeTool } from './components/organize.js';
import { WatermarkTool } from './components/watermark.js';
import { CropTool } from './components/crop.js';
import { AnnotateTool } from './components/annotate.js';
import { FormsTool } from './components/forms.js';
import { CompareTool } from './components/compare.js';
import { ConvertTool } from './components/convert.js';
import { SecurityTool } from './components/security.js';
import { PendingFiles } from './components/pending.js';
import { takeHandoff } from '/shared/handoff.js';
import { useFileDrop } from '/shared/dom.js';
import { useNaiveTheme, useNaiveOverrides } from '/shared/theme.js';

const { createApp, defineComponent, provide, inject, computed, ref, watch, nextTick, onMounted, h } = Vue;
const naive = window.naive;

const TOOL_VIEWS = {
    organize: () => h(OrganizeTool),
    compare: () => h(CompareTool),
    watermark: () => h(WatermarkTool),
    crop: () => h(CropTool),
    edit: () => h(AnnotateTool, { mode: 'edit' }),
    sign: () => h(AnnotateTool, { mode: 'sign' }),
    redact: () => h(AnnotateTool, { mode: 'redact' }),
    forms: () => h(FormsTool),
    'from-pdf': () => h(ConvertTool, { direction: 'from' }),
    'to-pdf': () => h(ConvertTool, { direction: 'to' }),
    security: () => h(SecurityTool),
};

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = '.pdf,application/pdf,image/*';

// The one document being built: rename (click the name), undo, download, close.
const DocBar = defineComponent({
    components: { Icon },
    setup() {
        const store = inject('store');
        const editing = ref(false);
        const draft = ref('');
        const bar = ref(null);
        const doc = computed(() => store.docInfo);

        const startRename = async () => {
            editing.value = true;
            draft.value = doc.value.name.replace(/\.pdf$/i, '');
            await nextTick();
            bar.value?.querySelector('.docbar__rename input')?.select();
        };
        const finishRename = () => {
            if (editing.value) store.rename(doc.value.name, draft.value);
            editing.value = false;
        };

        const menuOpen = ref(false);
        const saveOptions = [
            { key: 'download', label: 'Download', icon: ICONS.download },
            { key: 'sign', label: 'Sign', icon: ICONS.signature },
            { key: 'protect', label: 'Protect with a password', icon: ICONS.lock },
        ];
        const onSave = (key) => {
            menuOpen.value = false;
            if (key === 'download') store.download(doc.value.name);
            else if (key === 'sign') store.setTool('sign');
            else store.setTool('security', { tab: 'protect' });
        };

        return { store, doc, editing, draft, bar, startRename, finishRename, formatSize, menuOpen, saveOptions, onSave, ICONS };
    },
    template: `
        <div v-if="doc" class="docbar" ref="bar">
            <icon :d="ICONS.page" :size="16" class="docbar__icon"/>
            <n-input v-if="editing" v-model:value="draft" size="small" class="docbar__rename"
                @keyup.enter="finishRename" @keyup.esc="editing = false" @blur="finishRename"/>
            <button v-else type="button" class="docbar__name" :title="doc.name + ' — click to rename'" @click="startRename">{{ doc.name }}</button>
            <span class="docbar__meta">{{ doc.pageCount }} {{ doc.pageCount === 1 ? 'page' : 'pages' }}<span class="docbar__size"> · {{ formatSize(doc.size) }}</span></span>
            <span v-if="doc.edits" class="docbar__dot" title="Edited"></span>
            <div class="docbar__actions">
                <n-button v-if="doc.edits" size="small" quaternary :disabled="!!store.state.busy" @click="store.undoEdit(doc.name)" title="Undo the last change">
                    <template #icon><icon :d="ICONS.undo"/></template>Undo change
                </n-button>
                <n-button-group size="small" class="docbar__download">
                    <n-button type="primary" secondary @click="store.download(doc.name)">
                        <template #icon><icon :d="ICONS.download"/></template><span class="docbar__download-label">Download</span>
                    </n-button>
                    <n-popover trigger="click" placement="bottom-end" :show="menuOpen" @update:show="v => menuOpen = v" raw :show-arrow="false">
                        <template #trigger>
                            <n-button type="primary" secondary title="More ways to save" aria-label="More ways to save" :aria-expanded="menuOpen"><icon :d="ICONS.down" :size="14"/></n-button>
                        </template>
                        <div class="save-menu" role="menu">
                            <button v-for="o in saveOptions" :key="o.key" type="button" role="menuitem" class="save-menu__item" @click="onSave(o.key)">
                                <icon :d="o.icon" :size="16"/>{{ o.label }}
                            </button>
                        </div>
                    </n-popover>
                </n-button-group>
                <n-button size="small" quaternary :disabled="!!store.state.busy" @click="store.closeDocument()" title="Close the document">
                    <template #icon><icon :d="ICONS.close"/></template>
                </n-button>
            </div>
        </div>`,
});

// Vertical rail on desktop, a horizontal strip on small screens. Every tool keeps a visible label.
const ToolRail = defineComponent({
    components: { Icon },
    setup() {
        const store = inject('store');
        const groups = TOOL_GROUPS.map(g => ({ name: g, tools: TOOLS.filter(t => t.group === g) }));
        const rail = ref(null);
        const reveal = () => nextTick(() => {
            const active = rail.value?.querySelector('.rail__item--active');
            if (!active) return;
            // Scroll only the rail itself; scrollIntoView would also move the page.
            const r = rail.value;
            r.scrollLeft += active.offsetLeft - r.offsetLeft - (r.clientWidth - active.offsetWidth) / 2;
        });
        watch(() => store.state.tool, reveal);
        onMounted(reveal);
        return { store, groups, rail };
    },
    template: `
        <nav class="rail" ref="rail" aria-label="Tools">
            <section v-for="g in groups" :key="g.name" class="rail__group" :aria-label="g.name">
                <h3 class="rail__title">{{ g.name }}</h3>
                <button v-for="t in g.tools" :key="t.id" type="button" :title="t.hint"
                    :class="['rail__item', { 'rail__item--active': store.state.tool === t.id }]"
                    :aria-current="store.state.tool === t.id ? 'page' : null"
                    @click="store.setTool(t.id)">
                    <icon :d="t.icon" :size="20"/><span>{{ t.label }}</span>
                </button>
            </section>
        </nav>`,
});

const PageViewer = defineComponent({
    components: { Icon },
    setup() {
        const store = inject('store');
        const v = store.state.viewer;
        const image = useObjectUrls();

        const current = computed(() => v.items[v.index]);
        watch(() => [v.show, v.index, v.items], () => {
            const item = current.value;
            if (!v.show || !item) return image.clear();
            image.load(() => store.handler.renderUrl(item.name, item.page, 2)).catch(err => console.error(err));
        });

        const step = (d) => {
            const next = v.index + d;
            if (next >= 0 && next < v.items.length) v.index = next;
        };
        const selected = computed(() => !!(v.isSelected && current.value && v.isSelected(current.value)));
        const toggle = () => current.value && v.toggle?.(current.value);
        useWindowListener('keydown', (e) => {
            if (!v.show) return;
            if (e.key === 'ArrowLeft') step(-1);
            else if (e.key === 'ArrowRight') step(1);
            else if (e.key === ' ' && v.toggle) {
                e.preventDefault();
                toggle();
            }
        });

        const rotation = computed(() => current.value?.rotation || 0);
        return { v, url: image.value, step, selected, toggle, rotation, ICONS };
    },
    template: `
        <n-modal v-model:show="v.show" :auto-focus="false">
            <div class="viewer" @click.self="v.show = false">
                <div class="viewer__bar">
                    <span class="viewer__title">Page {{ v.index + 1 }} / {{ v.items.length }}</span>
                    <div class="viewer__actions">
                        <n-button v-if="v.toggle" size="small" :type="selected ? 'primary' : 'default'" @click="toggle">
                            {{ selected ? 'Selected' : 'Select' }}
                        </n-button>
                        <button class="viewer__close" type="button" @click="v.show = false" title="Close"><icon :d="ICONS.close" :size="20"/></button>
                    </div>
                </div>
                <div class="viewer__stage" @click.self="v.show = false">
                    <button class="viewer__nav viewer__nav--prev" type="button" :disabled="v.index <= 0" @click="step(-1)" title="Previous (←)"><icon :d="ICONS.left" :size="26"/></button>
                    <img v-if="url" :src="url" class="viewer__img" :style="rotation ? { transform: 'rotate(' + rotation + 'deg)' } : null" alt=""/>
                    <n-spin v-else/>
                    <button class="viewer__nav viewer__nav--next" type="button" :disabled="v.index >= v.items.length - 1" @click="step(1)" title="Next (→)"><icon :d="ICONS.right" :size="26"/></button>
                </div>
                <p class="viewer__keys">← → to browse<span v-if="v.toggle"> · Space to select</span> · Esc to close</p>
            </div>
        </n-modal>`,
});

const Landing = defineComponent({
    components: { Icon },
    props: { tool: { type: Object, default: null } },
    setup() {
        const store = inject('store');
        const groups = TOOL_GROUPS.map(g => ({ name: g, tools: TOOLS.filter(t => t.group === g) }));
        const choose = async () => store.loadFiles(await pickFiles({ accept: ACCEPT, multiple: true }));
        return { store, groups, choose, ICONS };
    },
    template: `
        <div class="landing">
            <section class="landing__hero">
                <h2 v-if="tool">{{ tool.label }}</h2>
                <h2 v-else>Every PDF tool, private by design</h2>
                <p>{{ tool ? tool.hint : 'Merge, edit, sign, convert and protect PDFs right in your browser.' }}</p>
                <n-button type="primary" size="large" class="landing__cta" @click="choose">
                    <template #icon><icon :d="ICONS.upload" :size="20"/></template>
                    Choose PDF files
                </n-button>
                <span class="landing__or">or drop PDFs and images anywhere on this page</span>
                <span class="landing__privacy"><icon :d="ICONS.lock" :size="14"/> Files never leave your device — nothing is uploaded.</span>
            </section>
            <section v-for="g in groups" :key="g.name" class="landing__group">
                <h3>{{ g.name }}</h3>
                <div class="landing__grid">
                    <button v-for="t in g.tools" :key="t.id" type="button"
                        :class="['tool-card', { 'tool-card--active': tool && tool.id === t.id }]" @click="store.setTool(t.id)">
                        <span class="tool-card__icon"><icon :d="t.icon" :size="22"/></span>
                        <span class="tool-card__text"><strong>{{ t.label }}</strong><small>{{ t.hint }}</small></span>
                    </button>
                </div>
            </section>
        </div>`,
});

const ToolGuard = defineComponent({
    components: { Icon },
    props: { tool: { type: Object, required: true } },
    setup() {
        return { store: inject('store'), ICONS };
    },
    template: `
        <div class="hero">
            <template v-if="store.pending.length">
                <icon :d="ICONS.lock" :size="44" class="hero__icon"/>
                <h2>Nothing to {{ tool.label.toLowerCase() }} yet</h2>
                <p>Unlock or repair the file above and its pages become your document.</p>
            </template>
            <template v-else>
                <h2>Add a PDF</h2>
                <p>Use + or drop PDFs anywhere on this page.</p>
            </template>
        </div>`,
});

const AppShell = defineComponent({
    components: { Icon, DocBar, ToolRail, PageViewer, ToolGuard, Landing, PendingFiles },
    setup() {
        const store = createStore(naive.useMessage());
        provide('store', store);

        const tool = computed(() => toolById(store.state.tool));
        const ready = computed(() => {
            return tool.value.needs === 'none' || !!store.state.doc;
        });
        // Remount tools when the document changes so each starts from a clean state.
        const viewKey = computed(() => {
            const t = tool.value;
            if (t.needs === 'none') return t.id;
            const rev = t.keepsState ? '' : store.state.revisions[store.state.doc] || 0;
            return `${t.id}|${store.state.doc}|${rev}`;
        });
        // The viewer shows the current tool's pages, so it can't outlive a tool or document change.
        watch(viewKey, () => { store.state.viewer.show = false; });
        const ToolView = () => TOOL_VIEWS[tool.value.id]();

        const fileDrag = useFileDrop(files => store.loadFiles(files));

        const empty = computed(() => !store.state.doc && !store.pending.length);
        // With nothing loaded, only the image tools have something to show; the rest get the landing page.
        const landing = computed(() => empty.value && tool.value.accepts !== 'images');

        const addFiles = async () => store.loadFiles(await pickFiles({ accept: ACCEPT, multiple: true }));

        if (location.hash === '#import') {
            history.replaceState(null, '', '#organize');
            takeHandoff().then((files) => files.length && store.loadFiles(files)).catch(err => console.error('Hand-off failed', err));
        }

        return { store, tool, ready, viewKey, ToolView, fileDrag, empty, landing, addFiles, ICONS };
    },
    template: `
        <div :class="{ 'app--landing': landing }">
            <header class="topbar">
                <div class="topbar__brand">
                    <span class="topbar__logo"><icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h2" :size="18"/></span>
                    <h1>PDF Editor</h1>
                    <p>Every PDF tool, right in your browser</p>
                </div>
                <span class="privacy-badge">
                    <icon :d="ICONS.lock" :size="14"/>
                    <span>100% local<span class="privacy-badge__long"> · files never leave your device</span></span>
                </span>
                <div v-if="store.state.busy" class="topbar__progress">
                    <div class="topbar__progress-bar" :style="store.state.busy.progress != null ? { width: (store.state.busy.progress * 100) + '%' } : null"
                         :class="{ 'topbar__progress-bar--indeterminate': store.state.busy.progress == null }"></div>
                </div>
            </header>

            <div :class="['layout', { 'layout--empty': landing }]">
                <main class="workspace">
                    <landing v-if="landing" :tool="store.state.toolChosen ? tool : null"/>
                    <template v-else>
                        <header class="workhead">
                            <div class="toolhead">
                                <span class="toolhead__icon"><icon :d="tool.icon" :size="18"/></span>
                                <h2>{{ tool.label }}</h2>
                                <p :title="tool.hint">{{ tool.hint }}</p>
                            </div>
                            <doc-bar/>
                        </header>
                        <pending-files v-if="tool.id !== 'security'" class="pending--shell"/>
                        <component v-if="ready" :is="ToolView" :key="viewKey"/>
                        <tool-guard v-else :tool="tool"/>
                    </template>
                </main>
                <tool-rail v-if="!landing"/>
            </div>

            <page-viewer/>

            <button v-if="!landing" type="button" class="fab" title="Add PDFs (appended to the document) or images — or drop them anywhere" @click="addFiles">
                <icon :d="ICONS.plus" :size="26"/>
            </button>

            <div v-if="store.state.notice && !store.state.busy" class="busy-toast" role="status">
                {{ store.state.notice.text }}
                <button v-if="store.state.notice.action" type="button" class="busy-toast__action" @click="store.state.notice.action()">{{ store.state.notice.actionLabel }}</button>
            </div>

            <div v-if="store.state.busy" class="busy-toast" role="status">
                <n-spin size="small"/> {{ store.state.busy.label }}…
                <span v-if="store.state.busy.progress != null">{{ Math.round(store.state.busy.progress * 100) }}%</span>
            </div>

            <div v-if="fileDrag" class="drop-overlay">
                <div class="drop-overlay__box">
                    <icon :d="ICONS.upload" :size="44"/>
                    <strong>Drop PDFs to add their pages, or images to convert them</strong>
                </div>
            </div>
        </div>`,
});

const app = createApp({
    components: { AppShell },
    setup() {
        const naiveTheme = useNaiveTheme();
        return { naiveTheme, naiveOverrides: useNaiveOverrides(naiveTheme) };
    },
    template: `
        <n-config-provider :theme="naiveTheme" :theme-overrides="naiveOverrides">
            <n-message-provider placement="top">
                <app-shell/>
            </n-message-provider>
        </n-config-provider>`,
});

app.use(naive);
app.mount('#app');
