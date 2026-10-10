import { BUILTIN_FONTS, deviceFontsSupported, loadDeviceFonts, addFontFile } from '../pdf/fonts.js';
import { pickFiles } from './shared.js';

const { defineComponent, reactive, computed, h, inject } = Vue;

const DEVICE = '__device';
const FILE = '__file';

const fonts = reactive({ device: [], files: [], deviceState: deviceFontsSupported ? 'idle' : 'unsupported' });

async function loadDevice() {
    if (fonts.deviceState === 'loading' || fonts.deviceState === 'done') return;
    fonts.deviceState = 'loading';
    try {
        fonts.device = (await loadDeviceFonts()).map(({ key, label, css }) => ({ key, label, css }));
        fonts.deviceState = 'done';
    } catch (err) {
        console.error(err);
        fonts.deviceState = 'denied';
    }
}

// Once allowed, the device's fonts are listed without asking again.
if (deviceFontsSupported) {
    navigator.permissions?.query({ name: 'local-fonts' })
        .then(status => { if (status.state === 'granted') loadDevice(); })
        .catch(() => {});
}

const option = (f) => ({ label: f.label, value: f.key, css: f.css });

export const FontSelect = defineComponent({
    props: { value: { type: String, required: true } },
    emits: ['update:value'],
    setup(props, { emit }) {
        const store = inject('store');
        const options = computed(() => {
            const groups = [{ type: 'group', label: 'PDF fonts', key: 'builtin', children: BUILTIN_FONTS.map(option) }];
            if (fonts.files.length) groups.push({ type: 'group', label: 'Added', key: 'files', children: fonts.files.map(option) });
            if (fonts.device.length) groups.push({ type: 'group', label: 'On this device', key: 'device', children: fonts.device.map(option) });
            const more = [];
            if (fonts.deviceState === 'idle' || fonts.deviceState === 'denied') more.push({ label: 'Fonts on this device…', value: DEVICE, action: true });
            if (fonts.deviceState === 'loading') more.push({ label: 'Loading fonts…', value: DEVICE, action: true, disabled: true });
            more.push({ label: 'Add a font file…', value: FILE, action: true });
            groups.push({ type: 'group', label: 'More', key: 'more', children: more });
            return groups;
        });

        const choose = async (value) => {
            if (value === DEVICE) {
                await loadDevice();
                if (fonts.deviceState === 'denied') store.message.warning('Allow font access in the browser to use the fonts on this device');
                return;
            }
            if (value === FILE) {
                const [file] = await pickFiles({ accept: '.ttf,.otf,font/ttf,font/otf' });
                if (!file) return;
                try {
                    const entry = await addFontFile(file);
                    if (!fonts.files.some(f => f.key === entry.key)) fonts.files.push({ key: entry.key, label: entry.label, css: entry.css });
                    emit('update:value', entry.key);
                } catch (err) {
                    console.error(err);
                    store.message.error(`${file.name} isn't a font this browser can read`);
                }
                return;
            }
            emit('update:value', value);
        };

        const renderLabel = (o) => (o.type === 'group' || o.action
            ? (o.action ? h('em', { class: 'font-select__action' }, o.label) : o.label)
            : h('span', { style: { fontFamily: o.css } }, o.label));

        return { options, choose, renderLabel };
    },
    template: `
        <n-select :value="value" @update:value="choose" :options="options" :render-label="renderLabel"
            filterable size="small" :consistent-menu-width="false" class="font-select"/>`,
});
