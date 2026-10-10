// Accepts "1-3, 5, 8-" (open-ended ranges run to the last page).
export function parsePageRanges(input, totalPages) {
    if (!input || !input.trim()) throw new Error('No page ranges provided');

    return input.split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const range = part.match(/^(\d+)\s*-\s*(\d*)$/);
            if (range) {
                const start = Number(range[1]);
                const end = range[2] === '' ? totalPages : Number(range[2]);
                if (start < 1 || end > totalPages || start > end) {
                    throw new Error(`Invalid page range: ${part}`);
                }
                return { start, end };
            }
            if (!/^\d+$/.test(part)) throw new Error(`Invalid page number: ${part}`);
            const page = Number(part);
            if (page < 1 || page > totalPages) throw new Error(`Invalid page number: ${part}`);
            return { start: page, end: page };
        });
}

export function pagesFromRanges(input, totalPages) {
    const pages = new Set();
    for (const { start, end } of parsePageRanges(input, totalPages)) {
        for (let i = start; i <= end; i++) pages.add(i);
    }
    return [...pages].sort((a, b) => a - b);
}

export function safePagesFromRanges(input, totalPages) {
    try {
        return pagesFromRanges(input, totalPages);
    } catch {
        return [];
    }
}

// [1,2,3,6] -> "1-3, 6"
export function pagesToRangeString(pages) {
    const sorted = [...new Set(pages)].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i];
        while (sorted[i + 1] === sorted[i] + 1) i++;
        parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
    }
    return parts.join(', ');
}
