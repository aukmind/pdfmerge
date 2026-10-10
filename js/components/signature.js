import { canvasToBlob } from '../pdf/handler.js';
import { cssFont } from '../pdf/fonts.js';
import { FontSelect } from './fonts.js';

const { defineComponent, ref, watch, nextTick } = Vue;

const SCRIPT_FONTS = ['"Caveat"', '"Dancing Script"', '"Great Vibes"'];
const INKS = [{ color: '#111827', label: 'Black ink' }, { color: '#1d4ed8', label: 'Blue ink' }];

function trimCanvas(source) {
    const { width, height } = source;
    const px = source.getContext('2d').getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (px[(y * width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1 + pad * 2;
    out.height = maxY - minY + 1 + pad * 2;
    out.getContext('2d').drawImage(source, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}

export const SignaturePad = defineComponent({
    components: { FontSelect },
    props: { show: { type: Boolean, default: false } },
    emits: ['update:show', 'done'],
    setup(props, { emit }) {
        const tab = ref('draw');
        const ink = ref(INKS[0].color);
        const canvas = ref(null);
        const hasInk = ref(false);
        const typed = ref('');
        // A CSS font-family list: one of the script fonts, or any other font picked below.
        const font = ref(SCRIPT_FONTS[0]);
        const otherFont = ref('helvetica');
        const pickOther = (key) => {
            otherFont.value = key;
            font.value = cssFont(key);
        };
        const upload = ref(null);
        const removeBackground = ref(true);
        const remember = ref(false);
        let ctx = null;
        let last = null;

        const setupCanvas = () => {
            const el = canvas.value;
            if (!el) return;
            const ratio = window.devicePixelRatio || 1;
            el.width = el.clientWidth * ratio;
            el.height = el.clientHeight * ratio;
            ctx = el.getContext('2d');
            ctx.scale(ratio, ratio);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 2.6;
            hasInk.value = false;
        };
        watch(() => [props.show, tab.value], async ([show, t]) => {
            if (show && t === 'draw') {
                await nextTick();
                setupCanvas();
            }
        });

        const pos = (e) => {
            const r = canvas.value.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const down = (e) => {
            canvas.value.setPointerCapture(e.pointerId);
            last = pos(e);
            ctx.strokeStyle = ink.value;
            ctx.beginPath();
            ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = ink.value;
            ctx.fill();
            hasInk.value = true;
        };
        const move = (e) => {
            if (!last) return;
            const p = pos(e);
            const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
            ctx.beginPath();
            ctx.moveTo(last.mid?.x ?? last.x, last.mid?.y ?? last.y);
            ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
            ctx.stroke();
            last = { ...p, mid };
        };
        const up = () => { last = null; };
        const clear = () => setupCanvas();

        const typedCanvas = async () => {
            const size = 96;
            await document.fonts.load(`${size}px ${font.value}`);
            const c = document.createElement('canvas');
            const m = c.getContext('2d');
            m.font = `${size}px ${font.value}`;
            c.width = Math.ceil(m.measureText(typed.value).width + size);
            c.height = size * 2;
            m.font = `${size}px ${font.value}`;
            m.fillStyle = ink.value;
            m.textBaseline = 'middle';
            m.fillText(typed.value, size / 2, size);
            return c;
        };

        const uploadCanvas = async () => {
            const bitmap = await createImageBitmap(upload.value);
            const scale = Math.min(1, 1200 / bitmap.width);
            const c = document.createElement('canvas');
            c.width = Math.round(bitmap.width * scale);
            c.height = Math.round(bitmap.height * scale);
            const m = c.getContext('2d');
            m.drawImage(bitmap, 0, 0, c.width, c.height);
            bitmap.close();
            if (removeBackground.value) {
                const data = m.getImageData(0, 0, c.width, c.height);
                const px = data.data;
                for (let i = 0; i < px.length; i += 4) {
                    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
                    // Fade near-white paper to transparent, keep ink solid.
                    px[i + 3] = Math.min(px[i + 3], Math.max(0, Math.min(255, (235 - lum) * 4)));
                }
                m.putImageData(data, 0, 0);
            }
            return c;
        };

        const tabs = {
            draw: { ready: () => hasInk.value, source: async () => canvas.value },
            type: { ready: () => !!typed.value.trim(), source: typedCanvas },
            upload: { ready: () => !!upload.value, source: uploadCanvas },
        };
        const canSave = () => tabs[tab.value].ready();

        const save = async () => {
            const source = await tabs[tab.value].source();
            const trimmed = trimCanvas(source);
            if (!trimmed) return;
            const blob = await canvasToBlob(trimmed, 'image/png');
            emit('done', {
                bytes: new Uint8Array(await blob.arrayBuffer()),
                type: 'png',
                width: trimmed.width,
                height: trimmed.height,
                url: URL.createObjectURL(blob),
                remember: remember.value,
            });
            emit('update:show', false);
        };

        const onUpload = ({ file }) => { upload.value = file?.file || null; };

        return { tab, ink, INKS, canvas, hasInk, typed, font, otherFont, pickOther, cssFont, SCRIPT_FONTS, upload, removeBackground, remember, down, move, up, clear, canSave, save, onUpload };
    },
    template: `
        <n-modal :show="show" @update:show="$emit('update:show', $event)" preset="card" title="Create signature" :style="{ width: 'min(640px, calc(100vw - 32px))' }">
            <n-tabs v-model:value="tab" type="segment" size="small">
                <n-tab-pane name="draw" tab="Draw">
                    <canvas ref="canvas" class="sigpad__canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"></canvas>
                    <div class="sigpad__row">
                        <span class="sigpad__hint">Sign with your mouse, finger or stylus</span>
                        <n-button size="small" quaternary @click="clear" :disabled="!hasInk">Clear</n-button>
                    </div>
                </n-tab-pane>
                <n-tab-pane name="type" tab="Type">
                    <n-input v-model:value="typed" placeholder="Your name" size="large"/>
                    <div class="sigpad__fonts">
                        <button v-for="f in SCRIPT_FONTS" :key="f" type="button" :class="['sigpad__font', { 'sigpad__font--on': font === f }]"
                            :style="{ fontFamily: f, color: ink }" @click="font = f">{{ typed || 'Your name' }}</button>
                        <div :class="['sigpad__font', 'sigpad__font--other', { 'sigpad__font--on': font === cssFont(otherFont) }]">
                            <button type="button" :style="{ fontFamily: cssFont(otherFont), color: ink }" @click="pickOther(otherFont)">{{ typed || 'Your name' }}</button>
                            <font-select :value="otherFont" @update:value="pickOther"/>
                        </div>
                    </div>
                </n-tab-pane>
                <n-tab-pane name="upload" tab="Upload">
                    <n-upload accept="image/*" :show-file-list="false" :default-upload="false" @change="onUpload">
                        <n-upload-dragger class="sigpad__drop">{{ upload ? upload.name : 'Choose a photo or scan of your signature' }}</n-upload-dragger>
                    </n-upload>
                    <label class="sigpad__row"><n-switch v-model:value="removeBackground" size="small"/> Remove white background</label>
                </n-tab-pane>
            </n-tabs>
            <template #footer>
                <div class="sigpad__footer">
                    <div v-if="tab !== 'upload'" class="sigpad__inks">
                        <button v-for="c in INKS" :key="c.color" type="button" :class="['sigpad__ink', { 'sigpad__ink--on': ink === c.color }]"
                            :style="{ background: c.color }" @click="ink = c.color" :title="c.label"></button>
                    </div>
                    <span v-else></span>
                    <label class="sigpad__remember"><n-checkbox v-model:checked="remember" size="small"/> Remember on this device</label>
                    <n-button type="primary" :disabled="!canSave()" @click="save">Use signature</n-button>
                </div>
            </template>
        </n-modal>`,
});
