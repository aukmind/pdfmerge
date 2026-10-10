// Rebuilds Markdown from positioned text runs.
// pages: [{ width, height, items: [{ str, x, y, size, width }] }], y = baseline from page top.

const BULLET = /^[•◦▪▫‣⁃●○■□–—*-]\s*/;
const NUMBERED = /^(\d{1,3})[.)]\s+/;
const PAGE_NUMBER = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i;

function groupLines(page) {
    const items = page.items
        .filter(item => item.str.trim())
        .sort((a, b) => a.y - b.y || a.x - b.x);

    const lines = [];
    for (const item of items) {
        // Items are sorted by y, so only the most recent lines can match.
        const line = lines.slice(-3).find(l => Math.abs(l.y - item.y) <= Math.max(l.size, item.size) * 0.4);
        if (line) {
            line.items.push(item);
            line.size = Math.max(line.size, item.size);
        } else {
            lines.push({ y: item.y, size: item.size, items: [item] });
        }
    }

    return lines
        .map(line => {
            const runs = line.items.sort((a, b) => a.x - b.x);
            let text = '';
            let prevEnd = null;
            for (const run of runs) {
                const gap = prevEnd === null ? 0 : run.x - prevEnd;
                if (prevEnd !== null && gap > run.size * 0.15 && !text.endsWith(' ') && !run.str.startsWith(' ')) {
                    text += ' ';
                }
                text += run.str;
                prevEnd = run.x + run.width;
            }
            return { text: text.replace(/\s+/g, ' ').trim(), x: runs[0].x, y: line.y, size: line.size };
        })
        .sort((a, b) => a.y - b.y);
}

function bodySize(lines) {
    const weight = new Map();
    for (const line of lines) {
        const key = Math.round(line.size * 2) / 2;
        weight.set(key, (weight.get(key) || 0) + line.text.length);
    }
    let best = 0;
    let bestWeight = -1;
    for (const [size, w] of weight) {
        if (w > bestWeight) {
            best = size;
            bestWeight = w;
        }
    }
    return best || 12;
}

function escapeLeading(text) {
    return text.replace(/^([#>])/, '\\$1');
}

function joinWrapped(prev, next) {
    if (/[A-Za-zÀ-ÿ]-$/.test(prev)) return prev.slice(0, -1) + next;
    return `${prev} ${next}`;
}

// One Markdown string per page, sharing the body font size across the document.
export function markdownPages(pages) {
    const pageLines = pages.map(page =>
        groupLines(page).filter(line => {
            const nearEdge = line.y < page.height * 0.08 || line.y > page.height * 0.92;
            return !(nearEdge && PAGE_NUMBER.test(line.text));
        })
    );
    const body = bodySize(pageLines.flat());

    const pageBlocks = pageLines.map(lines => {
        const blocks = [];
        for (const line of lines) {
            const prev = blocks[blocks.length - 1];
            const at = { lastY: line.y, size: line.size, x: line.x };
            const gap = prev ? line.y - prev.lastY : Infinity;
            const close = gap <= Math.max(prev?.size || 0, line.size) * 1.5;
            const ratio = line.size / body;

            if (ratio >= 1.15 && line.text.length < 200) {
                const level = ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : 3;
                if (prev?.type === 'heading' && prev.level === level && close) {
                    prev.text += ` ${line.text}`;
                    prev.lastY = line.y;
                } else {
                    blocks.push({ type: 'heading', level, text: line.text, ...at });
                }
                continue;
            }

            const numbered = line.text.match(NUMBERED);
            if (numbered) {
                blocks.push({ type: 'list', marker: `${numbered[1]}.`, text: line.text.slice(numbered[0].length), ...at });
                continue;
            }
            if (BULLET.test(line.text) && line.text.replace(BULLET, '')) {
                blocks.push({ type: 'list', marker: '-', text: line.text.replace(BULLET, ''), ...at });
                continue;
            }

            const sameSize = prev && Math.abs(prev.size - line.size) <= line.size * 0.1;
            const continuesList = prev?.type === 'list' && line.x > prev.x + line.size * 0.5;
            if (prev && close && sameSize && (prev.type === 'paragraph' || continuesList)) {
                prev.text = joinWrapped(prev.text, line.text);
                prev.lastY = line.y;
                continue;
            }
            blocks.push({ type: 'paragraph', text: line.text, ...at });
        }

        const out = [];
        blocks.forEach((block, i) => {
            if (block.type === 'heading') out.push(`${'#'.repeat(block.level)} ${block.text}`);
            else if (block.type === 'list') {
                const item = `${block.marker} ${block.text}`;
                // Consecutive list items render as one list, so no blank line between them.
                if (blocks[i - 1]?.type === 'list') out[out.length - 1] += `\n${item}`;
                else out.push(item);
            } else out.push(escapeLeading(block.text));
        });
        return out.join('\n\n');
    });

    return pageBlocks;
}

export function joinMarkdownPages(pages, { pageBreaks = false } = {}) {
    return pages.filter(Boolean).join(pageBreaks ? '\n\n---\n\n' : '\n\n') + '\n';
}

export function itemsToMarkdown(pages, options) {
    return joinMarkdownPages(markdownPages(pages), options);
}
