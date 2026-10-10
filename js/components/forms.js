import { readFormFields, fillForm } from '../pdf/ops.js';

const { defineComponent, inject, ref, reactive } = Vue;

// "topmostSubform[0].Page1[0].first_name[0]" -> "first name"
function prettyName(name) {
    const last = name.split('.').pop().replace(/\[\d+\]/g, '');
    return last.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || name;
}

export const FormsTool = defineComponent({
    setup() {
        const store = inject('store');
        const name = store.state.doc;
        const flatten = ref(false);
        let fields = [];
        try {
            fields = readFormFields(store.handler.doc(name));
        } catch (err) {
            console.error('Unreadable form', err);
        }
        const editable = fields
            .filter(f => f.type !== 'unsupported')
            .map(f => ({ ...f, label: prettyName(f.name) }));
        const values = reactive(Object.fromEntries(editable.map(f => [f.name, f.value])));
        const toOptions = (opts) => opts.map(o => ({ label: o, value: o }));

        const save = () => store.edit('Filling form',
            async () => fillForm(await store.handler.freshDoc(name), { ...values }, flatten.value), 'Form filled');

        return { store, editable, values, flatten, toOptions, save };
    },
    template: `
        <div class="tool">
            <div v-if="!editable.length" class="hero">
                <h2>No fillable fields</h2>
                <p>This PDF has no form fields. To write on it anyway, use the <a href="#edit" @click.prevent="store.setTool('edit')">Edit</a> tool.</p>
            </div>
            <template v-else>
                <div class="tool__bar">
                    <div class="tool__row">
                        <span class="tool__count">{{ editable.length }} field{{ editable.length > 1 ? 's' : '' }}</span>
                        <label class="inline-switch"><n-switch v-model:value="flatten" size="small"/> Lock fields after filling</label>
                        <div class="tool__primary">
                            <n-button type="primary" :disabled="!!store.state.busy" @click="save">Apply</n-button>
                        </div>
                    </div>
                </div>
                <div class="form-grid">
                    <label v-for="f in editable" :key="f.name" :class="['form-field', { 'form-field--wide': f.multiline || f.type === 'multiselect' }]" :title="f.name">
                        <span class="field__label">{{ f.label }}<em v-if="f.readOnly"> · read-only</em></span>
                        <n-input v-if="f.type === 'text'" v-model:value="values[f.name]" :type="f.multiline ? 'textarea' : 'text'" :disabled="f.readOnly"
                            :autosize="f.multiline ? { minRows: 2, maxRows: 8 } : false"/>
                        <n-checkbox v-else-if="f.type === 'checkbox'" v-model:checked="values[f.name]" :disabled="f.readOnly">Checked</n-checkbox>
                        <n-select v-else-if="f.type === 'select'" v-model:value="values[f.name]" :options="toOptions(f.options)" clearable :disabled="f.readOnly"/>
                        <n-select v-else-if="f.type === 'multiselect'" v-model:value="values[f.name]" :options="toOptions(f.options)" multiple clearable :disabled="f.readOnly"/>
                        <n-radio-group v-else-if="f.type === 'radio'" v-model:value="values[f.name]" :disabled="f.readOnly">
                            <n-radio v-for="o in f.options" :key="o" :value="o" :label="o"/>
                        </n-radio-group>
                    </label>
                </div>
            </template>
        </div>`,
});
