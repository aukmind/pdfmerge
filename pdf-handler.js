// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

class PdfItem {
    constructor(file) {
        if (!(file instanceof File || file instanceof Blob)) {
            throw new Error('Invalid file type: must be File or Blob');
        }
        this.file = file;
        this.pdf = null;
        this.manipulator = null;
        this.thumbnails = new Map();
        this.pageSelection = '';
        this.customFilename = file.name;
    }

    async load() {
        try {
            const arrayBuffer = await this.file.arrayBuffer();
            const arrayBufferCopy = arrayBuffer.slice(0);

            // Load with PDF.js for viewing
            this.pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            // Load with PDF-lib for manipulation
            this.manipulator = await PDFLib.PDFDocument.load(arrayBufferCopy);

            return true;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            throw new Error(`Failed to load PDF: ${errorMessage}`);
        }
    }

    getErrorMessage(error) {
        if (error.name === 'InvalidPDFException') return 'Invalid PDF file';
        if (error.name === 'MissingPDFException') return 'PDF file is missing or corrupted';
        return error.message;
    }

    getPageCount() {
        if (!this.pdf) throw new Error('PDF not loaded');
        return this.pdf.numPages;
    }

    async generateThumbnail(pageNumber) {
        if (!this.pdf) throw new Error('PDF not loaded');
        if (pageNumber < 1 || pageNumber > this.getPageCount()) {
            throw new Error(`Invalid page number: ${pageNumber}`);
        }

        // Return cached thumbnail if available
        if (this.thumbnails.has(pageNumber)) {
            return this.thumbnails.get(pageNumber);
        }

        try {
            const page = await this.pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 0.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const thumbnail = canvas.toDataURL();
            this.thumbnails.set(pageNumber, thumbnail);
            return thumbnail;
        } catch (error) {
            throw new Error(`Failed to generate thumbnail: ${error.message}`);
        }
    }

    dispose() {
        if (this.pdf) {
            this.pdf.destroy();
            this.pdf = null;
        }
        this.manipulator = null;
        this.thumbnails.clear();
    }
}

class PDFHandler {
    constructor() {
        this.items = new Map();
        this.fileOrder = [];
    }

    async loadPDF(file) {
        if (!file) throw new Error('No file provided');
        if (this.items.has(file.name)) throw new Error('File already loaded');

        try {
            const item = new PdfItem(file);
            await item.load();
            this.items.set(file.name, item);
            this.fileOrder.push(file.name);
            return file.name;
        } catch (error) {
            throw new Error(`Failed to load PDF: ${error.message}`);
        }
    }

    getFiles() {
        return this.fileOrder
            .map(name => this.items.get(name)?.file)
            .filter(Boolean);
    }

    getFile(name) {
        return this.items.get(name)?.file;
    }

    getPageSelection(fileName) {
        return this.items.get(fileName)?.pageSelection || '';
    }

    setPageSelection(fileName, selection) {
        const item = this.items.get(fileName);
        if (item) {
            item.pageSelection = selection;
        }
    }

    removeFile(fileName) {
        const item = this.items.get(fileName);
        if (item) {
            item.dispose();
            this.items.delete(fileName);
            this.fileOrder = this.fileOrder.filter(name => name !== fileName);
        }
    }

    async generateThumbnail(fileName, pageNumber) {
        const item = this.items.get(fileName);
        if (!item) throw new Error('PDF not found');
        return item.generateThumbnail(pageNumber);
    }

    async splitPDF(file, pageRanges) {
        const item = this.items.get(file.name);
        if (!item?.manipulator) throw new Error('PDF not found');

        try {
            const ranges = this.parsePageRanges(pageRanges, item.getPageCount());
            const newPdf = await PDFLib.PDFDocument.create();
            
            // Collect and validate selected pages
            const selectedPages = new Set();
            ranges.forEach(range => {
                for (let i = range.start; i <= range.end; i++) {
                    selectedPages.add(i - 1);
                }
            });

            // Copy selected pages
            const pages = await newPdf.copyPages(item.manipulator, Array.from(selectedPages));
            pages.forEach(page => newPdf.addPage(page));

            const pdfBytes = await newPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            
            const baseName = item.customFilename.replace('.pdf', '');
            const selectionCode = pageRanges.replace(/\s+/g, '');
            return new Map([[`${baseName}-[${selectionCode}].pdf`, new File([blob], `${baseName}-[${selectionCode}].pdf`, { type: 'application/pdf' })]]);
        } catch (error) {
            throw new Error(`Failed to split PDF: ${error.message}`);
        }
    }

    async mergePDFs() {
        try {
            const mergedPdf = await PDFLib.PDFDocument.create();
            
            // Use fileOrder to maintain the correct order
            for (const fileName of this.fileOrder) {
                const item = this.items.get(fileName);
                if (!item?.manipulator) {
                    throw new Error(`PDF not found: ${fileName}`);
                }
                
                const pages = await mergedPdf.copyPages(item.manipulator, item.manipulator.getPageIndices());
                pages.forEach(page => mergedPdf.addPage(page));
            }

            const pdfBytes = await mergedPdf.save();
            return new File([pdfBytes], 'merged.pdf', { type: 'application/pdf' });
        } catch (error) {
            throw new Error(`Failed to merge PDFs: ${error.message}`);
        }
    }

    parsePageRanges(pageRanges, totalPages) {
        if (!pageRanges.trim()) {
            throw new Error('No page ranges provided');
        }

        try {
            return pageRanges.split(',')
                .map(part => part.trim())
                .filter(part => part.length > 0) // Filter out empty parts
                .map(part => {
                    if (part.includes('-')) {
                        const [start, end] = part.split('-').map(num => parseInt(num.trim()));
                        if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                            throw new Error(`Invalid page range: ${part}`);
                        }
                        return { start, end };
                    } else {
                        const page = parseInt(part);
                        if (isNaN(page) || page < 1 || page > totalPages) {
                            throw new Error(`Invalid page number: ${part}`);
                        }
                        return { start: page, end: page };
                    }
                });
        } catch (error) {
            throw new Error(`Invalid page range format: ${error.message}`);
        }
    }

    getPageCount(file) {
        const item = this.items.get(file.name);
        if (!item) throw new Error('PDF not found');
        return item.getPageCount();
    }

    getPDF(fileName) {
        return this.items.get(fileName)?.pdf;
    }

    getManipulator(fileName) {
        return this.items.get(fileName)?.manipulator;
    }

    setCustomFilename(originalName, newName) {
        const item = this.items.get(originalName);
        if (item) {
            item.customFilename = newName;
        }
    }

    getCustomFilename(originalName) {
        return this.items.get(originalName)?.customFilename || originalName;
    }

    moveFile(fileName, newIndex) {
        const currentIndex = this.fileOrder.indexOf(fileName);
        if (currentIndex === -1) return false;
        if (newIndex < 0 || newIndex >= this.fileOrder.length) return false;

        this.fileOrder.splice(currentIndex, 1);
        this.fileOrder.splice(newIndex, 0, fileName);
        return true;
    }

    getFileOrder() {
        return [...this.fileOrder];
    }
}

// Export the PDFHandler class
window.PDFHandler = PDFHandler; 