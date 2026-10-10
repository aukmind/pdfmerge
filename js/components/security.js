import { encryptPdf } from '../pdf/qpdf.js';
import { repairPdf } from '../pdf/ops.js';
import { readFileBytes } from './shared.js';
import { PendingFiles } from './pending.js';

const { defineComponent, inject, ref, reactive, computed, watch } = Vue;

function randomPassword() {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode(...bytes));
}

export const SecurityTool = defineComponent({
    components: { PendingFiles },
    setup() {
        const store = inject('store');
        const info = computed(() => store.docInfo);
        const waiting = (status) => store.pending.some(f => f.status === status);
        const tab = ref(store.state.toolParams?.tab || (waiting('locked') ? 'unlock' : waiting('broken') ? 'repair' : 'protect'));
        // A deep link picks the tab once; later visits fall back to what's waiting.
        store.state.toolParams = null;
        watch(() => store.state.toolParams?.tab, (wanted) => {
            if (!wanted) return;
            tab.value = wanted;
            store.state.toolParams = null;
        });
        const protect = reactive({ password: '', confirm: '', allowPrint: true, allowCopy: true, allowModify: false });

        const mismatch = computed(() => protect.confirm && protect.password !== protect.confirm);
        const canProtect = computed(() => protect.password && protect.password === protect.confirm && info.value);

        const lock = async () => {
            const name = info.value.name;
            const outName = store.outputName('protected', name);
            const saved = await store.output('Encrypting', outName, async () => encryptPdf(await readFileBytes(store.handler.file(name)), {
                userPassword: protect.password,
                // A separate random owner password keeps the permission limits enforceable.
                ownerPassword: randomPassword(),
                allowPrint: protect.allowPrint,
                allowCopy: protect.allowCopy,
                allowModify: protect.allowModify,
            }));
            if (saved) protect.password = protect.confirm = '';
        };

        const repair = async () => {
            let method;
            const ok = await store.edit('Repairing', async () => {
                const result = await repairPdf(store.handler.file(info.value.name));
                method = result.method;
                return result.bytes;
            }, 'Repaired');
            if (ok && method === 'rasterized') {
                store.message.warning('The file was too damaged to keep its text, so pages were rebuilt as images', { duration: 6000 });
            }
        };

        return { store, info, waiting, tab, protect, mismatch, canProtect, lock, repair };
    },
    template: `
        <div class="tool tool--narrow">
            <n-tabs v-model:value="tab" type="segment" animated>
                <n-tab-pane name="protect" tab="Protect">
                    <div class="security-card">
                        <template v-if="info">
                            <p>Downloads a copy of <strong>{{ info.name }}</strong> that needs this password to open (AES-256).</p>
                            <n-input v-model:value="protect.password" type="password" show-password-on="click" placeholder="Password"/>
                            <n-input v-model:value="protect.confirm" type="password" show-password-on="click" placeholder="Repeat password"
                                :status="mismatch ? 'error' : undefined" @keyup.enter="canProtect && !store.state.busy && lock()"/>
                            <p v-if="mismatch" class="security-card__error">Passwords don't match</p>
                            <div class="security-card__perms">
                                <span class="field__label">After entering the password, people can</span>
                                <n-checkbox v-model:checked="protect.allowPrint">Print</n-checkbox>
                                <n-checkbox v-model:checked="protect.allowCopy">Copy text</n-checkbox>
                                <n-checkbox v-model:checked="protect.allowModify">Edit</n-checkbox>
                                <span class="security-card__note">Most PDF readers respect these limits, but some tools ignore them. Only the password itself is guaranteed.</span>
                            </div>
                            <n-button type="primary" block :disabled="!canProtect || !!store.state.busy" @click="lock">Protect &amp; download</n-button>
                        </template>
                        <p v-else>Add a PDF first.</p>
                    </div>
                </n-tab-pane>
                <n-tab-pane name="unlock" tab="Unlock">
                    <div class="security-card">
                        <template v-if="waiting('locked')">
                            <p>Enter each file's password. Once unlocked, its pages are added to the end of the document.
                               Leave it empty if the file opens without one and only has editing restrictions.</p>
                            <pending-files only="locked"/>
                        </template>
                        <p v-else>Add a password-protected PDF with <strong>+</strong> or by dropping it here, then enter its password to add its pages.</p>
                    </div>
                </n-tab-pane>
                <n-tab-pane name="repair" tab="Repair">
                    <div class="security-card">
                        <pending-files v-if="waiting('broken')" only="broken"/>
                        <template v-if="info">
                            <p>Rebuilds <strong>{{ info.name }}</strong> in place, for files that open but misbehave in other apps.</p>
                            <n-button type="primary" block :disabled="!!store.state.busy" @click="repair">Repair PDF</n-button>
                        </template>
                        <p v-else-if="!waiting('broken')">Add a PDF first.</p>
                    </div>
                </n-tab-pane>
            </n-tabs>
        </div>`,
});
