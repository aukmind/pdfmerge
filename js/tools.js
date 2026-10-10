import { ICONS } from './components/shared.js';

// needs: 'doc' = the document must be open, 'none' = works without one.
// keepsState: stays mounted across in-place edits (others remount to show the new contents).
// accepts: 'images' marks tools that take dropped images themselves (otherwise they're converted and appended).
export const TOOLS = [
    { id: 'organize', keepsState: true, group: 'Organize', label: 'Organize', needs: 'doc',
      hint: 'Reorder, rotate, delete or extract pages, and number them. PDFs you add are appended at the end.',
      icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },

    { id: 'edit', group: 'Edit', label: 'Edit', needs: 'doc',
      hint: 'Add text, shapes, highlights and images on top of pages.',
      icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
    { id: 'crop', keepsState: true, group: 'Edit', label: 'Crop', needs: 'doc',
      hint: 'Drag the corners to choose the area to keep.',
      icon: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14' },
    { id: 'forms', group: 'Edit', label: 'Fill form', needs: 'doc',
      hint: 'Fill in the PDF\'s form fields.',
      icon: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4' },

    { id: 'from-pdf', group: 'Convert', label: 'From PDF', needs: 'doc',
      hint: 'Save a PDF as JPG or PNG images, Markdown or plain text.',
      icon: 'M13 3H6v18h7M13 3l5 5v3M13 3v5h5M15 17h7M19 14l3 3-3 3' },
    { id: 'to-pdf', group: 'Convert', label: 'To PDF', needs: 'none', accepts: 'images',
      hint: 'Turn images or camera scans into a PDF.',
      icon: 'M11 3h7v18H6v-7M11 3L6 8v1M11 3v5H6M2 14h7M6 11l3 3-3 3' },

    { id: 'security', keepsState: true, group: 'Security', label: 'Protect', needs: 'none',
      hint: 'Add a password, unlock protected PDFs, or repair a damaged one.',
      icon: ICONS.lock },
    { id: 'sign', group: 'Security', label: 'Sign', needs: 'doc',
      hint: 'Draw, type or upload your signature and place it on the page.',
      icon: ICONS.signature },
    { id: 'redact', group: 'Security', label: 'Redact', needs: 'doc',
      hint: 'Black out text for good. Redacted pages are flattened to images.',
      icon: 'M4 6h16v4H4zM4 14h10v4H4z' },
    { id: 'watermark', group: 'Security', label: 'Watermark', needs: 'doc',
      hint: 'Stamp text or an image across pages.',
      icon: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z' },
    { id: 'compare', group: 'Security', label: 'Compare', needs: 'doc',
      hint: 'See what changed against an earlier version, as text or side by side.',
      icon: 'M4 4h7v16H4zM13 4h7v16h-7zM7 9h1M16 9h1M7 13h1M16 13h1' },
];

export const TOOL_GROUPS = [...new Set(TOOLS.map(t => t.group))];

export function toolById(id) {
    return TOOLS.find(t => t.id === id) || TOOLS[0];
}
