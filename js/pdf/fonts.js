import { customFont, fontCss } from '/shared/fonts.js';
import { loadScript } from '/shared/load.js';

// Fonts text can be drawn with: the PDF standard fonts, fonts installed on the device, and font files the user adds.
// Keys: 'helvetica' | 'times' | 'courier' | 'device:<family>' | 'file:<name>'.

const FONTKIT_URL = 'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

export const BUILTIN_FONTS = [
    { key: 'helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
    { key: 'times', label: 'Times', css: '"Times New Roman", Times, serif' },
    { key: 'courier', label: 'Courier', css: '"Courier New", Courier, monospace' },
];

const builtins = new Map(BUILTIN_FONTS.map(f => [f.key, f]));

export function isBuiltinFont(key) {
    return builtins.has(key);
}

export function cssFont(key) {
    return fontCss(key, BUILTIN_FONTS);
}

export function fontLabel(key) {
    return (builtins.get(key) || customFont(key))?.label || key;
}

export async function fontBytes(key, bold) {
    const font = customFont(key);
    if (!font) throw new Error(`The font ${key} is no longer available`);
    const read = (bold && font.source.bold) || font.source.regular;
    return new Uint8Array(await read());
}

export function loadFontkit() {
    return loadScript(FONTKIT_URL, 'fontkit');
}
