import { Icon, ICONS, useSortable, useUpload, pickFiles } from './shared.js';
import { prepareImage, cleanUpScan } from '../pdf/images.js';
import { imagesToPdf } from '../pdf/ops.js';
import { canvasToBlob, releaseCanvas } from '../pdf/handler.js';
import { isImage } from '../store.js';
import { mapLimit } from '../util.js';

const { defineComponent, inject, ref, reactive, watch, onBeforeUnmount, nextTick } = Vue;

// Small JPEG preview so a stack of 12 MP photos doesn't keep full-size bitmaps alive in the grid.
async function previewUrl(file) {
    const bitmap = await createImageBitmap(file, { resizeWidth: 480, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
    releaseCanvas(canvas);
    return URL.createObjectURL(blob);
}

let nextId = 1;

// How an image becomes a page; used when creating PDFs from images and when changing an image page later.
export const ImageOptionFields = defineComponent({
    props: { options: { type: Object, required: true } },
    template: `
        <label class="field"><span class="field__label">Page size</span>
            <n-select v-model:value="options.pageSize" size="small" class="field__control--md"
                :options="[{ label: 'Same as image', value: 'fit' }, { label: 'A4', value: 'a4' }, { label: 'US Letter', value: 'letter' }]"/></label>
        <label v-if="options.pageSize !== 'fit'" class="field"><span class="field__label">Orientation</span>
            <n-select v-model:value="options.orientation" size="small" class="field__control--md"
                :options="[{ label: 'Auto', value: 'auto' }, { label: 'Portrait', value: 'portrait' }, { label: 'Landscape', value: 'landscape' }]"/></label>
        <label class="field"><span class="field__label">Margin</span>
            <n-select v-model:value="options.margin" size="small" class="field__control--md"
                :options="[{ label: 'None', value: 0 }, { label: 'Small', value: 18 }, { label: 'Large', value: 48 }]"/></label>
        <label class="field"><span class="field__label">Clean up (B&amp;W)</span><n-switch v-model:value="options.enhance"/></label>`,
});

const CameraCapture = defineComponent({
    components: { Icon },
    props: { show: Boolean, enhance: Boolean },
    emits: ['update:show', 'capture'],
    setup(props, { emit }) {
        const video = ref(null);
        const error = ref(null);
        const shots = ref(0);
        const flash = ref(false);
        const facing = ref('environment');
        let stream = null;
        let session = 0;

        const stop = () => {
            session++;
            stream?.getTracks().forEach(t => t.stop());
            stream = null;
        };
        const start = async () => {
            stop();
            const mine = session;
            error.value = null;
            try {
                const granted = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facing.value, width: { ideal: 3840 }, height: { ideal: 2160 } },
                    audio: false,
                });
                // Closed or flipped while the permission prompt was up.
                if (mine !== session) return granted.getTracks().forEach(t => t.stop());
                stream = granted;
                await nextTick();
                if (video.value) video.value.srcObject = stream;
            } catch (err) {
                if (mine !== session) return;
                error.value = err.name === 'NotAllowedError'
                    ? 'Camera access was blocked. Allow it in your browser settings, or take a photo with your camera app instead.'
                    : 'No live camera is available here. You can still take a photo with your camera app.';
            }
        };

        watch(() => props.show, (show) => {
            if (show) {
                shots.value = 0;
                start();
            } else stop();
        });
        onBeforeUnmount(stop);

        const capture = async () => {
            const v = video.value;
            if (!v?.videoWidth) return;
            const canvas = document.createElement('canvas');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0);
            if (props.enhance) cleanUpScan(ctx, canvas.width, canvas.height);
            const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
            emit('capture', new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }), props.enhance);
            shots.value++;
            flash.value = true;
            setTimeout(() => { flash.value = false; }, 150);
        };
        const flip = () => {
            facing.value = facing.value === 'environment' ? 'user' : 'environment';
            start();
        };

        // Fallback when the live camera can't start: the phone's own camera app, via a file input.
        const nativePhoto = async () => {
            const files = await pickFiles({ accept: 'image/*', capture: 'environment', multiple: true });
            files.forEach(file => emit('capture', file, false));
            if (files.length) emit('update:show', false);
        };

        return { video, error, shots, flash, capture, flip, nativePhoto, ICONS };
    },
    template: `
        <n-modal :show="show" @update:show="$emit('update:show', $event)">
            <div class="camera">
                <div class="camera__bar">
                    <span>{{ shots ? shots + ' page' + (shots > 1 ? 's' : '') + ' captured' : 'Point at the document' }}</span>
                    <button class="viewer__close" type="button" @click="$emit('update:show', false)" title="Close"><icon :d="ICONS.close" :size="20"/></button>
                </div>
                <div class="camera__view">
                    <div v-if="error" class="camera__error">
                        <p>{{ error }}</p>
                        <n-button type="primary" @click="nativePhoto">Take a photo instead</n-button>
                    </div>
                    <video v-else ref="video" autoplay playsinline muted></video>
                    <div v-if="flash" class="camera__flash"></div>
                </div>
                <div class="camera__controls">
                    <n-button quaternary text-color="#fff" class="camera__side" @click="flip" :disabled="!!error">Flip</n-button>
                    <button class="camera__shutter" type="button" :disabled="!!error" @click="capture" title="Capture page"></button>
                    <n-button type="primary" class="camera__side" @click="$emit('update:show', false)">Done</n-button>
                </div>
            </div>
        </n-modal>`,
});

export const ImagesTool = defineComponent({
    components: { Icon, CameraCapture, ImageOptionFields },
    props: { mode: { type: String, required: true } },
    setup(props) {
        const store = inject('store');
        const images = ref([]);
        const grid = ref(null);
        const cameraOpen = ref(false);
        const options = reactive({
            pageSize: props.mode === 'scan' ? 'a4' : 'fit',
            orientation: 'auto',
            margin: 0,
            enhance: props.mode === 'scan',
        });

        const add = (files, enhanced = false) => {
            for (const file of files.filter(isImage)) {
                images.value.push({ id: nextId++, file, url: null, rotation: 0, enhanced });
                const item = images.value.at(-1);
                previewUrl(file).then(url => { item.url = url; }).catch(err => console.error('Preview failed', err));
            }
        };
        const onCapture = (file, cleaned) => add([file], cleaned);

        watch(() => store.state.pendingImages.length, () => {
            if (store.state.pendingImages.length) add(store.state.pendingImages.splice(0));
        }, { immediate: true });

        const upload = useUpload(files => add(files));

        const rotate = (img) => { img.rotation = (img.rotation + 90) % 360; };
        const remove = (img) => {
            if (img.url) URL.revokeObjectURL(img.url);
            images.value = images.value.filter(i => i !== img);
        };

        useSortable(grid, (from, to) => {
            const [moved] = images.value.splice(from, 1);
            images.value.splice(to, 0, moved);
        });
        onBeforeUnmount(() => images.value.forEach(i => i.url && URL.revokeObjectURL(i.url)));

        const create = () => store.output('Creating PDF', props.mode === 'scan' ? 'scan.pdf' : 'images.pdf', async (progress) => {
            let done = 0;
            const prepared = await mapLimit(images.value, 3, async (img) => {
                const result = await prepareImage(img.file, { rotation: img.rotation, enhance: options.enhance && !img.enhanced });
                progress(++done / (images.value.length + 1));
                return result;
            });
            return imagesToPdf(prepared, options);
        });

        return { store, images, grid, cameraOpen, options, upload, onCapture, rotate, remove, create, ICONS };
    },
    template: `
        <div class="tool">
            <div class="tool__bar">
                <div class="options">
                    <image-option-fields :options="options"/>
                    <div class="options__apply">
                        <n-button type="primary" :disabled="!images.length || !!store.state.busy" @click="create">
                            Create PDF{{ images.length ? ' (' + images.length + ' page' + (images.length > 1 ? 's' : '') + ')' : '' }}
                        </n-button>
                    </div>
                </div>
            </div>

            <div class="image-sources">
                <n-button v-if="mode === 'scan'" type="primary" size="large" @click="cameraOpen = true"><template #icon><icon :d="ICONS.camera"/></template>Open camera</n-button>
                <n-upload v-else multiple accept="image/*" :show-file-list="false" :default-upload="false" :file-list="upload.list" @change="upload.onChange">
                    <n-button type="primary" size="large"><template #icon><icon :d="ICONS.image"/></template>Add images</n-button>
                </n-upload>
            </div>

            <div class="page-grid" ref="grid" :style="{ '--thumb-size': store.state.thumbSize + 'px' }">
                <div v-for="(img, i) in images" :key="img.id" class="page-card page-card--static">
                    <div class="page-card__sheet page-card__sheet--image">
                        <div v-if="!img.url" class="page-card__loading"><n-spin size="small"/></div>
                        <img v-else :src="img.url" class="page-card__img page-card__img--photo" :style="{ transform: 'rotate(' + img.rotation + 'deg)' }" draggable="false" alt=""/>
                        <div class="page-card__tools">
                            <button class="page-card__tool" type="button" title="Rotate" @click="rotate(img)"><icon :d="ICONS.rotateRight"/></button>
                            <button class="page-card__tool page-card__tool--danger" type="button" title="Remove" @click="remove(img)"><icon :d="ICONS.trash"/></button>
                        </div>
                    </div>
                    <span class="page-card__label">{{ i + 1 }}</span>
                </div>
            </div>
            <p v-if="!images.length" class="tool__note tool__note--center">
                {{ mode === 'scan' ? 'Capture each page with your camera. They\\'ll appear here in order.' : 'Add images, or drop them anywhere on this page. Drag to reorder.' }}
            </p>

            <camera-capture v-model:show="cameraOpen" :enhance="options.enhance" @capture="onCapture"/>
        </div>`,
});
