import { Icon, ICONS, readFileBytes } from './shared.js';
import { decryptPdf } from '../pdf/qpdf.js';
import { repairPdf } from '../pdf/ops.js';

const { defineComponent, inject, reactive, computed } = Vue;

// Locked or damaged files can't join the document until they're unlocked or repaired.
export const PendingFiles = defineComponent({
    components: { Icon },
    props: { only: { type: String, default: null } },
    setup(props) {
        const store = inject('store');
        const files = computed(() => store.pending.filter(f => !props.only || f.status === props.only));
        const passwords = reactive({});

        const unlock = async (name) => {
            const done = await store.resolvePending(name, 'Unlocking', async () => decryptPdf(await readFileBytes(store.handler.file(name)), passwords[name] || ''));
            if (done) delete passwords[name];
        };
        const repair = (name) => store.resolvePending(name, 'Repairing', async () => {
            const { bytes, method } = await repairPdf(store.handler.file(name));
            if (method === 'rasterized') store.message.warning(`${name} was too damaged to keep its text, so its pages were rebuilt as images`, { duration: 6000 });
            return bytes;
        });

        return { store, files, passwords, unlock, repair, ICONS };
    },
    template: `
        <div v-if="files.length" class="pending">
            <div v-for="f in files" :key="f.name" :class="['pending__row', 'pending__row--' + f.status]">
                <icon :d="f.status === 'locked' ? ICONS.lock : ICONS.alert" :size="16" class="pending__icon"/>
                <span class="pending__text"><strong>{{ f.name }}</strong>
                    {{ f.status === 'locked' ? 'is password-protected. Enter its password to add it.' : 'looks damaged. Repair it to add it.' }}</span>
                <template v-if="f.status === 'locked'">
                    <n-input v-model:value="passwords[f.name]" type="password" show-password-on="click" size="small" placeholder="Password"
                        class="pending__password" @keyup.enter="!store.state.busy && unlock(f.name)"/>
                    <n-button size="small" type="primary" :disabled="!!store.state.busy" @click="unlock(f.name)">Unlock &amp; add</n-button>
                </template>
                <n-button v-else size="small" type="primary" :disabled="!!store.state.busy" @click="repair(f.name)">Repair &amp; add</n-button>
                <button type="button" class="pending__dismiss" title="Don't add this file" @click="store.dismiss(f.name)"><icon :d="ICONS.close" :size="14"/></button>
            </div>
        </div>`,
});
