const { createApp, defineComponent, ref, computed, watch } = Vue;
const naive = window.naive;

const PdfApp = defineComponent({
  template: '#pdf-app-template',
  setup() {
    const message = naive.useMessage();
    const pdfHandler = new window.PDFHandler();
    
    const files = ref([]);
    const selectedFile = ref(null);
    const pageRange = ref('');
    const currentThumbnails = ref([]);
    const pageSelections = new Map();

    const updateFilesList = () => {
      files.value = pdfHandler.getFiles();
      if (selectedFile.value && !files.value.includes(selectedFile.value)) {
        selectedFile.value = null;
        currentThumbnails.value = [];
        pageRange.value = '';
      }
    };

    const loadingFiles = new Set();
    const uploadFileList = ref([]);

    const handleUpload = async ({ fileList }) => {
      const existingNames = new Set(pdfHandler.getFiles().map(f => f.name));
      const candidates = fileList.filter(item =>
        item.file?.type === PDF_MIME &&
        !existingNames.has(item.file.name) &&
        !loadingFiles.has(item.file.name)
      );
      await Promise.all(candidates.map(async item => {
        const fileName = item.file.name;
        loadingFiles.add(fileName);
        try {
          await pdfHandler.loadPDF(item.file);
          message.success(`Loaded ${fileName}`);
        } catch (error) {
          message.error(`Error loading ${fileName}`);
        } finally {
          loadingFiles.delete(fileName);
        }
      }));
      uploadFileList.value = [];
      updateFilesList();

      if (!selectedFile.value && files.value.length > 0) {
        selectFile(files.value[0]);
      }
    };

    const THUMBNAIL_CONCURRENCY = 6;
    const selectFile = async (file) => {
      if (selectedFile.value === file) return;
      if (selectedFile.value) pageSelections.set(selectedFile.value, pageRange.value);
      selectedFile.value = file;
      pageRange.value = pageSelections.get(file) || '';

      const pageCount = pdfHandler.getPageCount(file.name);
      currentThumbnails.value = new Array(pageCount).fill(null);

      let nextPage = 0;
      const worker = async () => {
        while (nextPage < pageCount) {
          const i = nextPage++;
          try {
            const thumb = await pdfHandler.generateThumbnail(file.name, i + 1);
            if (selectedFile.value === file) currentThumbnails.value[i] = thumb;
          } catch (err) {
            console.error('Thumbnail generation error', err);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(THUMBNAIL_CONCURRENCY, pageCount) }, worker));
    };

    const removeFile = (file) => {
      pageSelections.delete(file);
      pdfHandler.removeFile(file.name);
      updateFilesList();
    };

    const downloadFile = (file) => {
        saveAs(file);
        message.success(`Downloaded ${file.name}`);
    };

    const handleSplit = async () => {
      if (!selectedFile.value || !pageRange.value) return;

      try {
        const splitFile = await pdfHandler.splitPDF(selectedFile.value.name, pageRange.value);
        await pdfHandler.loadPDF(splitFile);
        updateFilesList();
        message.success('PDF split successfully');
      } catch (error) {
        message.error(`Error splitting PDF: ${error.message}`);
      }
    };

    const handleMerge = async () => {
      try {
        if (files.value.length === 0) return;
        const merged = await pdfHandler.mergePDFs(files.value.map(f => f.name));
        saveAs(merged);
        message.success('PDFs merged and downloaded successfully');
      } catch (error) {
        message.error(`Error merging PDFs: ${error.message}`);
      }
    };

    const handleDownloadZip = async () => {
      try {
        if (files.value.length === 0) return;
        const zip = new JSZip();
        for (const f of files.value) zip.file(f.name, f);
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, 'pdf_files.zip');
        message.success('Files downloaded as ZIP successfully');
      } catch (error) {
        message.error(`Error creating ZIP file: ${error.message}`);
      }
    };

    const selectedPagesSet = computed(() => {
        if (!pageRange.value || !selectedFile.value) return new Set();
        try {
            const ranges = pdfHandler.parsePageRanges(pageRange.value, pdfHandler.getPageCount(selectedFile.value.name));
            const set = new Set();
            ranges.forEach(r => {
                for (let i = r.start; i <= r.end; i++) set.add(i);
            });
            return set;
        } catch {
            return new Set();
        }
    });

    const isPageInSelection = (pageNum) => selectedPagesSet.value.has(pageNum);

    // Collapse a Set of page numbers into range strings, e.g. Set{1,2,3,6} -> "1-3, 6"
    const pagesToRangeString = (pageSet) => {
        if (pageSet.size === 0) return '';
        const sorted = Array.from(pageSet).sort((a, b) => a - b);
        const parts = [];
        let start = sorted[0];
        let end = sorted[0];
        const flush = () => parts.push(start === end ? `${start}` : `${start}-${end}`);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                flush();
                start = sorted[i];
                end = sorted[i];
            }
        }
        flush();
        return parts.join(', ');
    };

    const togglePageSelection = (pageNum) => {
        if (!selectedFile.value) return;
        const next = new Set(selectedPagesSet.value);
        if (next.has(pageNum)) next.delete(pageNum);
        else next.add(pageNum);
        pageRange.value = pagesToRangeString(next);
    };

    const dragInsertPos = ref(null);
    let dragFromIndex = null;
    let dragBounds = null;

    const setInsertPos = (pos) => {
        if (dragInsertPos.value !== pos) dragInsertPos.value = pos;
    };

    const dragStart = (e, index) => {
        e.dataTransfer.effectAllowed = 'move';
        dragFromIndex = index;
        const items = e.currentTarget.parentElement.querySelectorAll('.file-item');
        dragBounds = {
            count: items.length,
            firstTop: items[0]?.getBoundingClientRect().top ?? 0,
            lastBottom: items[items.length - 1]?.getBoundingClientRect().bottom ?? 0,
        };
    };

    const dragOverItem = (e, index) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        setInsertPos(after ? index + 1 : index);
    };

    const dragOverList = (e) => {
        e.preventDefault();
        if (e.target !== e.currentTarget || !dragBounds) return;
        if (dragBounds.count === 0) {
            setInsertPos(0);
        } else if (e.clientY >= dragBounds.lastBottom) {
            setInsertPos(dragBounds.count);
        } else if (e.clientY <= dragBounds.firstTop) {
            setInsertPos(0);
        }
    };

    const dragLeaveList = (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setInsertPos(null);
        }
    };

    const dropFile = (e) => {
        e.preventDefault();
        const fromIndex = dragFromIndex;
        const insertPos = dragInsertPos.value;
        setInsertPos(null);
        dragFromIndex = null;
        dragBounds = null;
        if (fromIndex === null || insertPos === null) return;

        const newIndex = fromIndex < insertPos ? insertPos - 1 : insertPos;
        if (newIndex === fromIndex) return;

        const fileToMove = files.value[fromIndex];
        if (fileToMove) {
            pdfHandler.moveFile(fileToMove.name, newIndex);
            updateFilesList();
        }
    };

    watch(pageRange, (val) => {
        if (selectedFile.value) pageSelections.set(selectedFile.value, val);
    });

    return {
      files,
      selectedFile,
      pageRange,
      currentThumbnails,
      handleUpload,
      uploadFileList,
      selectFile,
      removeFile,
      downloadFile,
      handleSplit,
      handleMerge,
      handleDownloadZip,
      isPageInSelection,
      togglePageSelection,
      dragStart,
      dragOverItem,
      dragOverList,
      dragLeaveList,
      dropFile,
      dragInsertPos
    };
  }
});

const app = createApp({
  setup() {
    return {
      theme: window.aukmindTheme || null
    };
  }
});

app.use(naive);
app.component('pdf-app', PdfApp);
app.mount('#app');