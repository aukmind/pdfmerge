import { Icon, ICONS } from './shared.js';

const { defineComponent, computed } = Vue;

// A button that shows one panel of options. Toggles sharing a v-model act as a group: one panel open at a time.
export const OptionsToggle = defineComponent({
    components: { Icon },
    props: {
        modelValue: { type: String, default: null },
        value: { type: String, required: true },
        label: { type: String, required: true },
        icon: { type: String, default: null },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const open = computed(() => props.modelValue === props.value);
        const toggle = () => emit('update:modelValue', open.value ? null : props.value);
        return { open, toggle, ICONS };
    },
    template: `
        <n-button size="small" :type="open ? 'primary' : 'default'" :secondary="open" :aria-expanded="open" @click="toggle">
            <template v-if="icon" #icon><icon :d="icon"/></template>
            {{ label }}
            <icon :d="ICONS.down" :size="14" :class="['options-toggle__chevron', { 'options-toggle__chevron--open': open }]"/>
        </n-button>`,
});

export const OptionsPanel = defineComponent({
    props: { open: Boolean },
    template: `
        <transition name="options-panel">
            <div v-if="open" class="options options-panel"><slot></slot></div>
        </transition>`,
});
