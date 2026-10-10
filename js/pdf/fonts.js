// Fonts text can be drawn with: the PDF standard fonts, fonts installed on the device, and font files the user adds.
// Keys: 'helvetica' | 'times' | 'courier' | 'device:<family>' | 'file:<name>'.

const FONTKIT_URL = 'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

export const BUILTIN_FONTS = [
    { key: 'helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
    { key: 'times', label: 'Times', css: '"Times New Roman", Times, serif' },
    { key: 'courier', label: 'Courier', css: '"Courier New", Courier, monospace' },
];

const builtins = new Map(BUILTIN_FONTS.map(f => [f.key, f]));
// key -> { key, label, css, source: { regular, bold } } where each source returns the font file's bytes.
const custom = new Map();

export function isBuiltinFont(key) {
    return builtins.has(key);
}

export function cssFont(key) {
    return (builtins.get(key) || custom.get(key))?.css || BUILTIN_FONTS[0].css;
}

export function fontLabel(key) {
    return (builtins.get(key) || custom.get(key))?.label || key;
}

export async function fontBytes(key, bold) {
    const font = custom.get(key);
    if (!font) throw new Error(`The font ${key} is no longer available`);
    const read = (bold && font.source.bold) || font.source.regular;
    return new Uint8Array(await read());
}

let fontkit = null;
export function loadFontkit() {
    fontkit ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = FONTKIT_URL;
        script.onload = () => resolve(window.fontkit);
        script.onerror = () => {
            fontkit = null;
            reject(new Error('Could not download the font module'));
        };
        document.head.appendChild(script);
    });
    return fontkit;
}

export const deviceFontsSupported = typeof window !== 'undefined' && 'queryLocalFonts' in window;

const REGULAR = /^(regular|normal|book|roman|medium)$/i;
const ITALIC = /italic|oblique/i;

// Lists installed fonts (asks for permission the first time). Returns the registered entries, sorted.
export async function loadDeviceFonts() {
    const faces = await window.queryLocalFonts();
    const families = new Map();
    for (const face of faces) {
        if (!families.has(face.family)) families.set(face.family, []);
        families.get(face.family).push(face);
    }
    const added = [];
    for (const [family, list] of families) {
        const upright = list.filter(f => !ITALIC.test(f.style));
        if (!upright.length) continue;
        const regular = upright.find(f => REGULAR.test(f.style)) || upright.find(f => !/bold|black|heavy/i.test(f.style)) || upright[0];
        const bold = upright.find(f => /^bold$/i.test(f.style)) || upright.find(f => /bold/i.test(f.style) && f !== regular);
        const entry = {
            key: `device:${family}`,
            label: family,
            css: `"${family}", sans-serif`,
            source: { regular: () => regular.blob().then(b => b.arrayBuffer()), bold: bold ? () => bold.blob().then(b => b.arrayBuffer()) : null },
        };
        custom.set(entry.key, entry);
        added.push(entry);
    }
    return added.sort((a, b) => a.label.localeCompare(b.label));
}

// A .ttf/.otf the user picked; also registered with the page so previews use it.
export async function addFontFile(file) {
    const bytes = await file.arrayBuffer();
    const label = file.name.replace(/\.[^.]+$/, '');
    const family = `pdfeditor-${label}`;
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    const entry = { key: `file:${label}`, label, css: `"${family}", sans-serif`, source: { regular: async () => bytes, bold: null } };
    custom.set(entry.key, entry);
    return entry;
}
