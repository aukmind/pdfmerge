import { formatPageNumber, referenceWidth, stampScale, ANCHORS } from '../pdf/ops.js';
import { cssFont } from '../pdf/fonts.js';
import { FontSelect } from './fonts.js';

const { defineComponent, reactive, computed } = Vue;

const FORMATS = [
    { label: '1', value: '{n}' },
    { label: 'Page 1', value: 'Page {n}' },
    { label: 'Page 1 of 9', value: 'Page {n} of {total}' },
    { label: '1 / 9', value: '{n} / {total}' },
    { label: '- 1 -', value: '- {n} -' },
];

export function numberOptions() {
    return reactive({ position: 'bottom-center', format: '{n}', start: 1, size: 11, margin: 28, color: '#111827', font: 'helvetica' });
}

// Preview of the numbers on page cards, matching addPageNumbers.
// geometries: display size of every page in order; targets: 1-based positions that get a number.
export function useNumberPreview(numbers, geometries, targets) {
    const targetIndex = computed(() => new Map(targets.value.map((p, i) => [p, i])));
    const fullWidth = computed(() => referenceWidth(geometries.value));

    const numberStyle = (position) => {
        const g = geometries.value[position - 1];
        const m = numbers.margin * stampScale(g, fullWidth.value);
        const [au, av] = ANCHORS[numbers.position];
        const style = { fontSize: `${(numbers.size / fullWidth.value) * 100}cqw`, color: numbers.color, fontFamily: cssFont(numbers.font) };
        const mx = `${(m / g.width) * 100}%`;
        if (au === 0) style.left = mx;
        else if (au === 1) style.right = mx;
        else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
        if (av === 0) style.top = `${(m / g.height) * 100}%`;
        else style.bottom = `calc(${(m / g.height) * 100}% - 0.22em)`;
        return style;
    };
    const numberText = (position) => formatPageNumber(numbers.format, numbers.start + targetIndex.value.get(position), numbers.start + targets.value.length - 1);

    return { targetIndex, numberStyle, numberText };
}

export const NumberFields = defineComponent({
    components: { FontSelect },
    props: { numbers: { type: Object, required: true } },
    setup() {
        return { FORMATS, positions: Object.keys(ANCHORS) };
    },
    template: `
        <div class="field">
            <span class="field__label">Position</span>
            <div class="anchor-picker">
                <button v-for="p in positions" :key="p" type="button" :title="p.replace('-', ' ')"
                    :class="['anchor-picker__cell', 'anchor-picker__cell--' + p, { 'anchor-picker__cell--on': numbers.position === p }]"
                    @click="numbers.position = p"></button>
            </div>
        </div>
        <label class="field"><span class="field__label">Format</span>
            <n-select v-model:value="numbers.format" :options="FORMATS" size="small" class="field__control--md"/></label>
        <label class="field"><span class="field__label">Font</span>
            <font-select v-model:value="numbers.font" class="field__control--md"/></label>
        <label class="field"><span class="field__label">First number</span>
            <n-input-number :value="numbers.start" @update:value="v => numbers.start = v ?? 1" :min="0" size="small" class="field__control--sm"/></label>
        <label class="field field--grow"><span class="field__label">Size {{ numbers.size }}pt</span>
            <n-slider v-model:value="numbers.size" :min="6" :max="36" :tooltip="false"/></label>
        <label class="field field--grow"><span class="field__label">Margin</span>
            <n-slider v-model:value="numbers.margin" :min="8" :max="72" :tooltip="false"/></label>
        <label class="field"><span class="field__label">Color</span>
            <n-color-picker v-model:value="numbers.color" :show-alpha="false" size="small" :modes="['hex']" class="field__control--sm"/></label>`,
});
