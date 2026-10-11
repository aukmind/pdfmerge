import { FontSelect as SharedFontSelect } from '/shared/fonts.js';
import { BUILTIN_FONTS } from '../pdf/fonts.js';

const { defineComponent, h } = Vue;

export const FontSelect = defineComponent({
    props: { value: { type: String, required: true } },
    emits: ['update:value'],
    setup(props, { emit }) {
        return () => h(SharedFontSelect, {
            value: props.value, builtins: BUILTIN_FONTS, builtinsLabel: 'PDF fonts',
            'onUpdate:value': v => emit('update:value', v),
        });
    },
});
