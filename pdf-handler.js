pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PDF_MIME = 'application/pdf';

class PDFHandler {
    constructor() {
        this.items = new Map();
        this.fileOrder = [];
    }

    async loadPDF(file) {
        if (this.items.has(file.name)) throw new Error('File already loaded');

        const arrayBuffer = await file.arrayBuffer();
        // pdf.js detaches the source buffer; pdf-lib needs its own copy.
        const pdfBytes = arrayBuffer.slice(0);
        let manipulator;
        try {
            manipulator = await PDFLib.PDFDocument.load(arrayBuffer);
        } catch {
            throw new Error('Invalid PDF file');
        }

        this.items.set(file.name, {
            file,
            manipulator,
            pdfBytes,        // released after first pdf.js parse
            pdf: null,       // lazy: only created when a thumbnail is requested
            pdfPromise: null,
            thumbnails: new Map(),
        });
        this.fileOrder.push(file.name);
        return file.name;
    }

    getFiles() {
        return this.fileOrder
            .map(name => this.items.get(name)?.file)
            .filter(Boolean);
    }

    getPageCount(fileName) {
        const item = this._require(fileName);
        return item.manipulator.getPageCount();
    }

    async generateThumbnail(fileName, pageNumber) {
        const item = this._require(fileName);
        if (item.thumbnails.has(pageNumber)) return item.thumbnails.get(pageNumber);

        const pdf = await this._ensurePdfJs(item);
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
        }).promise;

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        item.thumbnails.set(pageNumber, url);
        return url;
    }

    removeFile(fileName) {
        const item = this.items.get(fileName);
        if (!item) return;
        this._dispose(item);
        this.items.delete(fileName);
        this.fileOrder = this.fileOrder.filter(name => name !== fileName);
    }

    async splitPDF(fileName, pageRanges) {
        const item = this._require(fileName);
        const ranges = this.parsePageRanges(pageRanges, item.manipulator.getPageCount());
        const newPdf = await PDFLib.PDFDocument.create();

        const selectedPages = new Set();
        ranges.forEach(range => {
            for (let i = range.start; i <= range.end; i++) selectedPages.add(i - 1);
        });

        const pages = await newPdf.copyPages(item.manipulator, Array.from(selectedPages));
        pages.forEach(page => newPdf.addPage(page));

        const pdfBytes = await newPdf.save();
        const baseName = item.file.name.replace(/\.pdf$/i, '');
        const selectionCode = pageRanges.replace(/\s+/g, '');
        return new File([pdfBytes], `${baseName}-[${selectionCode}].pdf`, { type: PDF_MIME });
    }

    async mergePDFs(order) {
        const mergedPdf = await PDFLib.PDFDocument.create();
        const sources = order.map(name => this._require(name).manipulator);
        const copied = await Promise.all(
            sources.map(src => mergedPdf.copyPages(src, src.getPageIndices()))
        );
        copied.flat().forEach(page => mergedPdf.addPage(page));
        const pdfBytes = await mergedPdf.save();
        return new File([pdfBytes], 'merged.pdf', { type: PDF_MIME });
    }

    parsePageRanges(pageRanges, totalPages) {
        if (!pageRanges.trim()) throw new Error('No page ranges provided');

        return pageRanges.split(',')
            .map(part => part.trim())
            .filter(part => part.length > 0)
            .map(part => {
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(num => parseInt(num.trim()));
                    if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                        throw new Error(`Invalid page range: ${part}`);
                    }
                    return { start, end };
                }
                const page = parseInt(part);
                if (isNaN(page) || page < 1 || page > totalPages) {
                    throw new Error(`Invalid page number: ${part}`);
                }
                return { start: page, end: page };
            });
    }

    moveFile(fileName, newIndex) {
        const currentIndex = this.fileOrder.indexOf(fileName);
        if (currentIndex === -1) return false;
        if (newIndex < 0 || newIndex >= this.fileOrder.length) return false;

        this.fileOrder.splice(currentIndex, 1);
        this.fileOrder.splice(newIndex, 0, fileName);
        return true;
    }

    _require(fileName) {
        const item = this.items.get(fileName);
        if (!item) throw new Error(`PDF not found: ${fileName}`);
        return item;
    }

    _ensurePdfJs(item) {
        // pdf.js detaches the source buffer, so concurrent callers must share one load.
        if (!item.pdfPromise) {
            item.pdfPromise = pdfjsLib.getDocument({ data: item.pdfBytes }).promise
                .then(pdf => {
                    item.pdf = pdf;
                    item.pdfBytes = null;
                    return pdf;
                });
        }
        return item.pdfPromise;
    }

    _dispose(item) {
        for (const url of item.thumbnails.values()) URL.revokeObjectURL(url);
        item.thumbnails.clear();
        item.pdf?.destroy();
        item.pdf = null;
        item.pdfPromise = null;
        item.manipulator = null;
        item.pdfBytes = null;
    }
}

window.PDFHandler = PDFHandler;
