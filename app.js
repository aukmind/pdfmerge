// Initialize PDF handler
const pdfHandler = new PDFHandler();
let splitFiles = new Map();
let customFilenames = new Map(); // Store custom filenames
let nextFocusIndex = null; // Add this at the top with other state variables

// DOM Elements
const elements = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    fileList: document.getElementById('file-list'),
    mobileFileList: document.getElementById('mobile-file-list'),
    splitButton: document.getElementById('split-button'),
    mergeButton: document.getElementById('merge-button'),
    mobileMergeButton: document.getElementById('mobile-merge-button'),
    downloadZipButton: document.getElementById('download-zip'),
    mobileDownloadZipButton: document.getElementById('mobile-download-zip'),
    pageRangeInput: document.getElementById('page-range'),
    previewContainer: document.getElementById('preview-container'),
    helpButton: document.getElementById('help-button'),
    helpOverlay: document.getElementById('help-overlay'),
    closeHelp: document.getElementById('close-help')
};

// Validate DOM elements
Object.entries(elements).forEach(([key, element]) => {
    if (!element) {
        throw new Error(`Required DOM element not found: ${key}`);
    }
});

// State
let selectedFile = null;
let uploadedFiles = new Set();
let activeElement = null; // Track the currently focused element

// Event Listeners
function initializeEventListeners() {
    // Drop zone events
    elements.dropZone.addEventListener('dragover', handleDragOver);
    elements.dropZone.addEventListener('dragleave', handleDragLeave);
    elements.dropZone.addEventListener('drop', handleDrop);
    elements.dropZone.addEventListener('click', (e) => {
        // Don't trigger file input if clicking on the label (which already triggers it)
        if (e.target.tagName === 'LABEL' || e.target.closest('label')) {
            return;
        }
        elements.fileInput.click();
    });
    elements.dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            elements.fileInput.click();
        }
    });

    // File input events
    elements.fileInput.addEventListener('change', handleFileInputChange);

    // Button events
    elements.splitButton.addEventListener('click', handleSplit);
    elements.mergeButton.addEventListener('click', handleMerge);
    elements.mobileMergeButton.addEventListener('click', handleMerge);
    elements.downloadZipButton.addEventListener('click', handleDownloadZip);
    elements.mobileDownloadZipButton.addEventListener('click', handleDownloadZip);

    // Page range input events
    elements.pageRangeInput.addEventListener('input', handlePageRangeInput);
    elements.pageRangeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSplit();
        }
    });

    // Help overlay events
    elements.helpButton.addEventListener('click', toggleHelpOverlay);
    elements.closeHelp.addEventListener('click', toggleHelpOverlay);
    elements.helpOverlay.addEventListener('click', (e) => {
        if (e.target === elements.helpOverlay) {
            toggleHelpOverlay();
        }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', handleGlobalShortcuts);
    
    // Track focus for context-aware shortcuts
    document.addEventListener('focusin', (e) => {
        activeElement = e.target;
    });
}

// Toggle help overlay
function toggleHelpOverlay() {
    const isVisible = elements.helpOverlay.classList.contains('visible');
    elements.helpOverlay.classList.toggle('visible');
    elements.helpOverlay.setAttribute('aria-hidden', isVisible);
    
    if (!isVisible) {
        elements.closeHelp.focus();
    }
}

// Handle global keyboard shortcuts
function handleGlobalShortcuts(e) {
    // Handle Escape key for help overlay
    if (e.key === 'Escape' && elements.helpOverlay.classList.contains('visible')) {
        e.preventDefault();
        toggleHelpOverlay();
        return;
    }

    // Handle arrow keys for navigation
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        handleArrowNavigation(e);
        return;
    }

    // Handle Enter key for navigation
    if (e.key === 'Enter') {
        e.preventDefault();
        // Check if we're in the file list
        if (activeElement && activeElement.closest('.file-list')) {
            const selectedFileElement = document.querySelector('.file-name.selected');
            if (selectedFileElement) {
                const fileName = selectedFileElement.getAttribute('data-name');
                const file = pdfHandler.getFiles().find(f => f.name === fileName);
                if (file) {
                    // Focus on the first page preview
                    const firstPage = elements.previewContainer.querySelector('.page-preview');
                    if (firstPage) {
                        firstPage.focus();
                        showNotification('Navigated to page view');
                    }
                }
            }
        }
        return;
    }

    // Handle Backspace key
    if (e.key === 'Backspace') {
        e.preventDefault();
        // If in preview container, return to document selection
        if (activeElement && activeElement.closest('.preview-container')) {
            const selectedFileElement = document.querySelector('.file-name.selected');
            if (selectedFileElement) {
                selectedFileElement.focus();
                showNotification('Returned to document selection');
            }
            return;
        }
        // If in file list, remove the selected document
        if (activeElement && activeElement.closest('.file-list')) {
            handleDeleteShortcut();
            return;
        }
    }

    // Only handle shortcuts if not typing in an input and no modifier keys are pressed
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) {
        return;
    }

    switch (e.key.toLowerCase()) {
        case 'n':
            e.preventDefault();
            elements.fileInput.click();
            showNotification('Opening file dialog');
            break;
            
        case 'f':
            e.preventDefault();
            const selectedFileElement = document.querySelector('.file-name.selected');
            if (selectedFileElement) {
                selectedFileElement.focus();
                showNotification('Focused on selected file');
            } else {
                const firstFile = elements.fileList.querySelector('.file-name');
                if (firstFile) {
                    firstFile.focus();
                    showNotification('Focused on first file');
                }
            }
            break;
            
        case 'p':
            e.preventDefault();
            elements.pageRangeInput.focus();
            showNotification('Focused on page range input');
            break;
            
        case 'm':
            e.preventDefault();
            if (!elements.mergeButton.disabled) {
                handleMerge();
                showNotification('Merging PDFs');
            }
            break;
            
        case 's':
            e.preventDefault();
            if (!elements.splitButton.disabled) {
                handleSplit();
                showNotification('Splitting PDF');
            }
            break;
            
        case 'd':
            e.preventDefault();
            handleDownloadShortcut();
            break;
            
        case '?':
            e.preventDefault();
            toggleHelpOverlay();
            break;

        case 'delete':
            e.preventDefault();
            // Use the same logic as Backspace
            if (activeElement && activeElement.closest('.file-list')) {
                handleDeleteShortcut();
            }
            break;

        case 'r':
            e.preventDefault();
            handleRenameShortcut();
            break;
    }
}

// Handle arrow key navigation
function handleArrowNavigation(e) {
    // Check if we're in the file list
    if (activeElement && activeElement.closest('.file-list')) {
        e.preventDefault();
        const currentFile = document.querySelector('.file-name.selected');
        const allFiles = [...elements.fileList.querySelectorAll('.file-name')];
        
        if (currentFile) {
            const currentIndex = allFiles.indexOf(currentFile);
            const newIndex = e.key === 'ArrowUp' 
                ? Math.max(0, currentIndex - 1)
                : Math.min(allFiles.length - 1, currentIndex + 1);
            
            if (newIndex !== currentIndex) {
                const fileName = allFiles[newIndex].getAttribute('data-name');
                const file = pdfHandler.getFiles().find(f => f.name === fileName);
                if (file) {
                    selectFile(file);
                    allFiles[newIndex].focus();
                }
            }
        } else if (allFiles.length > 0) {
            // If no file is selected, select the first/last one
            const targetIndex = e.key === 'ArrowUp' ? allFiles.length - 1 : 0;
            const fileName = allFiles[targetIndex].getAttribute('data-name');
            const file = pdfHandler.getFiles().find(f => f.name === fileName);
            if (file) {
                selectFile(file);
                allFiles[targetIndex].focus();
            }
        }
    }
    // Check if we're in the page preview
    else if (activeElement && activeElement.closest('.preview-container')) {
        e.preventDefault();
        const allPages = [...elements.previewContainer.querySelectorAll('.page-preview')];
        if (allPages.length === 0) return;

        // Get the currently focused page
        const currentPage = document.activeElement;
        if (!currentPage.classList.contains('page-preview')) {
            // If no page is focused, focus the first one
            allPages[0].focus();
            return;
        }

        // Calculate grid dimensions
        const containerWidth = elements.previewContainer.clientWidth;
        const pageWidth = allPages[0].offsetWidth;
        const gap = 20; // Gap between pages (from CSS)
        const pagesPerRow = Math.floor((containerWidth + gap) / (pageWidth + gap));
        
        const currentIndex = allPages.indexOf(currentPage);
        let newIndex = currentIndex;

        switch (e.key) {
            case 'ArrowUp':
                if (currentIndex >= pagesPerRow) {
                    newIndex = currentIndex - pagesPerRow;
                }
                break;
            case 'ArrowDown':
                if (currentIndex + pagesPerRow < allPages.length) {
                    newIndex = currentIndex + pagesPerRow;
                }
                break;
            case 'ArrowLeft':
                if (currentIndex % pagesPerRow !== 0) {
                    newIndex = currentIndex - 1;
                }
                break;
            case 'ArrowRight':
                if ((currentIndex + 1) % pagesPerRow !== 0 && currentIndex + 1 < allPages.length) {
                    newIndex = currentIndex + 1;
                }
                break;
        }

        if (newIndex !== currentIndex) {
            allPages[newIndex].focus();
        }
    }
}

// Handle rename shortcut
function handleRenameShortcut() {
    const selectedFileElement = document.querySelector('.file-name.selected');
    if (selectedFileElement) {
        const originalName = selectedFileElement.getAttribute('data-name');
        makeEditable(selectedFileElement, originalName);
        showNotification('Renaming file');
    }
}

// Handle delete shortcut
async function handleDeleteShortcut() {
    // Check if we're in the file list
    if (activeElement && activeElement.closest('.file-list')) {
        const selectedFileElement = document.querySelector('.file-name.selected');
        if (selectedFileElement) {
            const fileName = selectedFileElement.getAttribute('data-name');
            const file = pdfHandler.getFiles().find(f => f.name === fileName);
            if (file) {
                // Get all file elements
                const allFiles = [...elements.fileList.querySelectorAll('.file-name')];
                const currentIndex = allFiles.indexOf(selectedFileElement);
                
                // Set the next focus index
                nextFocusIndex = Math.min(currentIndex, allFiles.length - 2);
                
                // Remove the file
                await removeFile(file);
                showNotification('File removed');
                return;
            }
        }
    }
}

// Handle download shortcut based on context
function handleDownloadShortcut() {
    // Check if we're in the file list
    if (activeElement && activeElement.closest('.file-list')) {
        const selectedFileElement = document.querySelector('.file-name.selected');
        if (selectedFileElement) {
            const fileName = selectedFileElement.getAttribute('data-name');
            const file = pdfHandler.getFiles().find(f => f.name === fileName);
            if (file) {
                downloadFile(file);
                showNotification('Downloading selected file');
                return;
            }
        }
    }
    
    // Check if we're in the page preview
    if (activeElement && activeElement.closest('.preview-container')) {
        const selectedPage = document.querySelector('.page-preview.selected-page');
        if (selectedPage) {
            const pageNum = parseInt(selectedPage.getAttribute('data-page'));
            const selectedFileElement = document.querySelector('.file-name.selected');
            if (selectedFileElement && pageNum) {
                const fileName = selectedFileElement.getAttribute('data-name');
                const file = pdfHandler.getFiles().find(f => f.name === fileName);
                if (file) {
                    // Download single page
                    downloadSinglePage(file, pageNum);
                    showNotification('Downloading selected page');
                    return;
                }
            }
        }
    }
    
    // Default to downloading all files as ZIP
    if (!elements.downloadZipButton.disabled) {
        handleDownloadZip();
        showNotification('Downloading all files as ZIP');
    }
}

// Download a single page
async function downloadSinglePage(file, pageNum) {
    try {
        const manipulator = pdfHandler.getManipulator(file.name);
        if (!manipulator) {
            throw new Error('PDF not found');
        }

        const newPdf = await PDFLib.PDFDocument.create();
        const [page] = await newPdf.copyPages(manipulator, [pageNum - 1]);
        newPdf.addPage(page);

        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const downloadName = `${pdfHandler.getCustomFilename(file.name)}-page-${pageNum}.pdf`;
        saveAs(blob, downloadName);
        
        showNotification('Page downloaded successfully');
    } catch (error) {
        showNotification('Error downloading page', true);
    }
}

// Event Handlers
function handleDragOver(e) {
    e.preventDefault();
    elements.dropZone.classList.add('drag-over');
}

function handleDragLeave() {
    elements.dropZone.classList.remove('drag-over');
}

async function handleDrop(e) {
    e.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(isPDFFile);
    await handleFiles(files);
}

function handleFileInputChange(e) {
    const files = Array.from(e.target.files).filter(isPDFFile);
    handleFiles(files);
}

function isPDFFile(file) {
    return file.type === 'application/pdf';
}

async function handleFiles(files) {
    for (const file of files) {
        try {
            await pdfHandler.loadPDF(file);
            await updateFileList();
            showNotification(`Successfully loaded ${file.name}`);
        } catch (error) {
            showNotification(`Error loading ${file.name}: ${error.message}`, true);
        }
    }
    
    // After loading all files, select the first one if none is selected
    if (!document.querySelector('.file-name.selected')) {
        const firstFile = elements.fileList.querySelector('.file-name');
        if (firstFile) {
            const fileName = firstFile.getAttribute('data-name');
            const file = pdfHandler.getFiles().find(f => f.name === fileName);
            if (file) {
                selectFile(file);
                firstFile.focus();
                showNotification('Selected first document');
            }
        }
    }
}

async function updateFileList() {
    // Clear both lists
    elements.fileList.innerHTML = '';
    elements.mobileFileList.innerHTML = '';

    // Add main files
    pdfHandler.getFiles().forEach(file => {
        const fileItem = createFileItem(file);
        elements.fileList.appendChild(fileItem);
        
        // Create a new file item for mobile instead of cloning
        const mobileFileItem = createFileItem(file);
        elements.mobileFileList.appendChild(mobileFileItem);
    });

    // Add split files
    for (const [name, file] of splitFiles) {
        const fileItem = createSplitFileItem(name, file);
        elements.fileList.appendChild(fileItem);
        
        // Create a new split file item for mobile instead of cloning
        const mobileFileItem = createSplitFileItem(name, file);
        elements.mobileFileList.appendChild(mobileFileItem);
    }

    // Handle focus after update
    if (nextFocusIndex !== null) {
        const files = elements.fileList.querySelectorAll('.file-name');
        const mobileFiles = elements.mobileFileList.querySelectorAll('.file-name');
        
        if (files.length > 0) {
            const targetIndex = Math.min(nextFocusIndex, files.length - 1);
            const targetFile = files[targetIndex];
            const mobileTargetFile = mobileFiles[targetIndex];
            
            if (targetFile) {
                const fileName = targetFile.getAttribute('data-name');
                const file = pdfHandler.getFiles().find(f => f.name === fileName);
                if (file) {
                    selectFile(file);
                    targetFile.focus();
                    mobileTargetFile.classList.add('selected');
                }
            }
        }
        nextFocusIndex = null;
    }

    updateButtonStates();
}

function createFileItem(file) {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.draggable = true;
    fileItem.setAttribute('data-filename', file.name);
    fileItem.setAttribute('role', 'listitem');
    fileItem.setAttribute('tabindex', '0');
    fileItem.setAttribute('aria-label', `File: ${pdfHandler.getCustomFilename(file.name)}`);
    
    // Add drag and drop event listeners
    fileItem.addEventListener('dragstart', handleDragStart);
    fileItem.addEventListener('dragover', handleDragOver);
    fileItem.addEventListener('drop', handleDrop);
    fileItem.addEventListener('dragend', handleDragEnd);
    
    // Add keyboard navigation
    fileItem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectFile(file);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            removeFile(file);
        }
    });
    
    const downloadButton = createDownloadButton(file);
    const fileName = createFileName(file);
    const removeButton = createRemoveButton(file);
    
    fileItem.appendChild(downloadButton);
    fileItem.appendChild(fileName);
    fileItem.appendChild(removeButton);
    
    return fileItem;
}

function createDownloadButton(file) {
    const button = document.createElement('button');
    button.className = 'download-button';
    button.innerHTML = '↓';
    button.title = 'Download file';
    button.setAttribute('aria-label', `Download ${pdfHandler.getCustomFilename(file.name)}`);
    button.onclick = (e) => {
        e.stopPropagation();
        downloadFile(file);
    };
    return button;
}

function createFileName(file) {
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = pdfHandler.getCustomFilename(file.name);
    fileName.setAttribute('data-name', file.name);
    fileName.setAttribute('data-original-name', file.name);
    fileName.setAttribute('role', 'button');
    fileName.setAttribute('tabindex', '0');
    fileName.setAttribute('aria-label', `Select ${pdfHandler.getCustomFilename(file.name)}`);
    
    fileName.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        makeEditable(fileName, file.name);
    });
    
    fileName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectFile(file);
        }
    });
    
    fileName.onclick = () => selectFile(file);
    
    return fileName;
}

function createRemoveButton(file) {
    const button = document.createElement('button');
    button.className = 'remove-button';
    button.textContent = '×';
    button.setAttribute('aria-label', `Remove ${pdfHandler.getCustomFilename(file.name)}`);
    button.onclick = (e) => {
        e.stopPropagation();
        removeFile(file);
    };
    return button;
}

function createSplitFileItem(name, file) {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = name;
    fileName.addEventListener('click', () => previewSplitFile(file));
    
    const removeButton = document.createElement('span');
    removeButton.className = 'remove-file';
    removeButton.innerHTML = '&times;';
    removeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSplitFile(name);
    });
    
    fileItem.appendChild(fileName);
    fileItem.appendChild(removeButton);
    
    return fileItem;
}

function selectFile(file) {
    // Remove selection from all files in both lists
    document.querySelectorAll('.file-name').forEach(el => el.classList.remove('selected'));
    
    // Add selection to clicked file in both lists
    const fileElements = document.querySelectorAll(`.file-name[data-name="${file.name}"]`);
    fileElements.forEach(fileElement => {
        fileElement.classList.add('selected');
    });
    
    generateThumbnails(file);
    
    // Restore saved selection
    const savedSelection = pdfHandler.getPageSelection(file.name);
    elements.pageRangeInput.value = savedSelection;
    
    updatePageSelection(savedSelection, file);
}

function updatePageSelection(selection, file) {
    // Clear existing highlights
    document.querySelectorAll('.page-preview').forEach(preview => {
        preview.classList.remove('selected-page');
    });
    
    if (!selection) return;
    
    try {
        const ranges = pdfHandler.parsePageRanges(selection, pdfHandler.getPageCount(file));
        const selectedPages = new Set();
        
        ranges.forEach(range => {
            for (let i = range.start; i <= range.end; i++) {
                selectedPages.add(i);
            }
        });

        document.querySelectorAll('.page-preview').forEach(preview => {
            const pageNum = parseInt(preview.getAttribute('data-page'));
            if (selectedPages.has(pageNum)) {
                preview.classList.add('selected-page');
            }
        });
    } catch (error) {
        console.error('Error updating page selection:', error);
    }
}

async function removeFile(file) {
    try {
        pdfHandler.removeFile(file.name);
        elements.previewContainer.innerHTML = '';
        elements.pageRangeInput.value = '';
        await updateFileList();
        updateButtonStates();
    } catch (error) {
        showNotification('Error removing file', true);
    }
}

function removeSplitFile(name) {
    splitFiles.delete(name);
    updateFileList();
    updateButtonStates();
}

async function handleSplit() {
    const selectedFile = document.querySelector('.file-name.selected');
    if (!selectedFile) {
        showNotification('Please select a file to split', true);
        return;
    }

    const pageRange = elements.pageRangeInput.value.trim();
    if (!pageRange) {
        showNotification('Please enter page ranges', true);
        return;
    }

    try {
        const originalName = selectedFile.getAttribute('data-name');
        const file = pdfHandler.getFiles().find(f => f.name === originalName);
        if (!file) {
            throw new Error('Selected file not found');
        }
        
        const results = await pdfHandler.splitPDF(file, pageRange);
        
        for (const [name, splitFile] of results) {
            await pdfHandler.loadPDF(splitFile);
        }
        
        await updateFileList();
        
        const fileElement = document.querySelector(`.file-name[data-name="${originalName}"]`);
        if (fileElement) {
            fileElement.classList.add('selected');
        }
        
        showNotification('PDF split successfully');
        updateButtonStates();
    } catch (error) {
        showNotification(`Error splitting PDF: ${error.message}`, true);
    }
}

async function handleMerge() {
    const files = pdfHandler.getFiles();

    try {
        // Get the current order of files from the UI
        const fileItems = [...elements.fileList.querySelectorAll('.file-item')];
        const orderedFiles = fileItems
            .map(item => item.querySelector('.file-name').getAttribute('data-name'))
            .filter(name => name) // Filter out any null/undefined values
            .map(name => files.find(f => f.name === name))
            .filter(Boolean); // Filter out any null/undefined values

        if (orderedFiles.length !== files.length) {
            throw new Error('File order mismatch');
        }

        const mergedFile = await pdfHandler.mergePDFs();
        saveAs(mergedFile, 'merged.pdf');
        showNotification('PDFs merged and downloaded successfully');
    } catch (error) {
        showNotification(`Error merging PDFs: ${error.message}`, true);
    }
}

async function handleDownloadZip() {
    const files = pdfHandler.getFiles();
    if (files.length === 0) {
        showNotification('No files to download', true);
        return;
    }

    try {
        const zip = new JSZip();
        
        for (const file of files) {
            const manipulator = pdfHandler.getManipulator(file.name);
            if (!manipulator) {
                throw new Error(`PDF not found: ${file.name}`);
            }
            
            const pdfBytes = await manipulator.save();
            const customName = pdfHandler.getCustomFilename(file.name);
            zip.file(customName, pdfBytes);
        }
        
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, 'pdf_files.zip');
        showNotification('Files downloaded as ZIP successfully');
    } catch (error) {
        showNotification(`Error creating ZIP file: ${error.message}`, true);
    }
}

async function generateThumbnails(file) {
    try {
        const pdf = pdfHandler.getPDF(file.name);
        if (!pdf) {
            throw new Error('PDF not loaded');
        }

        const numPages = pdf.numPages;
        elements.previewContainer.innerHTML = '';

        // Create placeholder thumbnails
        for (let i = 1; i <= numPages; i++) {
            const placeholder = createThumbnailPlaceholder(i);
            elements.previewContainer.appendChild(placeholder);
        }

        // Generate actual thumbnails
        for (let i = 1; i <= numPages; i++) {
            try {
                const thumbnail = await pdfHandler.generateThumbnail(file.name, i);
                if (thumbnail) {
                    const preview = createThumbnailPreview(i, thumbnail);
                    const placeholder = elements.previewContainer.querySelector(`.page-preview[data-page="${i}"]`);
                    if (placeholder) {
                        if (placeholder.classList.contains('selected-page')) {
                            preview.classList.add('selected-page');
                        }
                        elements.previewContainer.replaceChild(preview, placeholder);
                    } else {
                        elements.previewContainer.appendChild(preview);
                    }
                }
            } catch (error) {
                console.error(`Error generating thumbnail for page ${i}:`, error);
            }
        }
    } catch (error) {
        showNotification('Error generating thumbnails', true);
    }
}

function createThumbnailPreview(pageNum, thumbnail) {
    const preview = document.createElement('div');
    preview.className = 'page-preview';
    preview.setAttribute('data-page', pageNum);
    preview.setAttribute('role', 'listitem');
    preview.setAttribute('tabindex', '0');
    preview.setAttribute('aria-label', `Page ${pageNum}`);
    
    const img = document.createElement('img');
    img.src = thumbnail;
    img.alt = `Page ${pageNum}`;
    preview.appendChild(img);
    
    const pageNumber = document.createElement('div');
    pageNumber.className = 'page-number';
    pageNumber.textContent = pageNum;
    preview.appendChild(pageNumber);
    
    preview.addEventListener('click', () => handleThumbnailClick(preview, pageNum));
    preview.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleThumbnailClick(preview, pageNum);
        }
    });
    
    return preview;
}

function createThumbnailPlaceholder(pageNum) {
    const placeholder = document.createElement('div');
    placeholder.className = 'page-preview loading';
    placeholder.setAttribute('data-page', pageNum);
    placeholder.setAttribute('role', 'listitem');
    placeholder.setAttribute('tabindex', '0');
    placeholder.setAttribute('aria-label', `Page ${pageNum} (loading)`);
    
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'loading-spinner';
    loadingSpinner.setAttribute('aria-hidden', 'true');
    placeholder.appendChild(loadingSpinner);
    
    const pageNumber = document.createElement('div');
    pageNumber.className = 'page-number';
    pageNumber.textContent = pageNum;
    placeholder.appendChild(pageNumber);
    
    placeholder.addEventListener('click', () => handleThumbnailClick(placeholder, pageNum));
    placeholder.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleThumbnailClick(placeholder, pageNum);
        }
    });
    
    return placeholder;
}

function handleThumbnailClick(thumbnail, pageNum) {
    const selectedFile = document.querySelector('.file-name.selected');
    if (!selectedFile) return;

    const originalName = selectedFile.getAttribute('data-name');
    const file = pdfHandler.getFiles().find(f => f.name === originalName);
    if (!file) return;

    // Toggle the selected-page class
    thumbnail.classList.toggle('selected-page');

    // Get all selected pages
    const selectedPages = new Set();
    document.querySelectorAll('.page-preview.selected-page').forEach(preview => {
        const page = parseInt(preview.getAttribute('data-page'));
        if (!isNaN(page)) {
            selectedPages.add(page);
        }
    });

    // Convert selected pages to ranges
    const ranges = convertToRanges(Array.from(selectedPages).sort((a, b) => a - b));
    const newValue = ranges.join(',');
    elements.pageRangeInput.value = newValue;

    try {
        const pageCount = pdfHandler.getPageCount(file);
        pdfHandler.parsePageRanges(newValue, pageCount);
        elements.pageRangeInput.classList.remove('invalid');
    } catch (error) {
        elements.pageRangeInput.classList.add('invalid');
    }

    elements.pageRangeInput.dispatchEvent(new Event('input'));
}

function convertToRanges(pages) {
    if (pages.length === 0) return [];
    
    const ranges = [];
    let start = pages[0];
    let prev = start;

    for (let i = 1; i <= pages.length; i++) {
        if (i === pages.length || pages[i] !== prev + 1) {
            ranges.push(start === prev ? start.toString() : `${start}-${prev}`);
            if (i < pages.length) {
                start = pages[i];
            }
        }
        if (i < pages.length) {
            prev = pages[i];
        }
    }

    return ranges;
}

function handlePageRangeInput() {
    const selectedFile = document.querySelector('.file-name.selected');
    if (!selectedFile) return;

    const originalName = selectedFile.getAttribute('data-name');
    const file = pdfHandler.getFiles().find(f => f.name === originalName);
    if (!file) return;

    const pageRange = this.value.trim();
    this.classList.remove('invalid');

    if (!pageRange) {
        document.querySelectorAll('.page-preview').forEach(preview => {
            preview.classList.remove('selected-page');
        });
        pdfHandler.setPageSelection(originalName, '');
        return;
    }

    try {
        const ranges = pdfHandler.parsePageRanges(pageRange, pdfHandler.getPageCount(file));
        const selectedPages = new Set();
        
        ranges.forEach(range => {
            for (let i = range.start; i <= range.end; i++) {
                selectedPages.add(i);
            }
        });

        document.querySelectorAll('.page-preview').forEach(preview => {
            const pageNum = parseInt(preview.getAttribute('data-page'));
            if (selectedPages.has(pageNum)) {
                preview.classList.add('selected-page');
            } else {
                preview.classList.remove('selected-page');
            }
        });

        pdfHandler.setPageSelection(originalName, pageRange);
    } catch (error) {
        this.classList.add('invalid');
    }
}

function makeEditable(element, originalName) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = element.textContent;
    
    input.addEventListener('blur', () => finishEditing(input, element, originalName));
    input.addEventListener('keydown', (e) => {
        // Prevent event propagation for all keys during editing
        e.stopPropagation();
        
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            element.textContent = pdfHandler.getCustomFilename(originalName);
            element.classList.remove('editing');
        }
    });
    
    element.textContent = '';
    element.appendChild(input);
    element.classList.add('editing');
    input.focus();
    
    const lastDotIndex = input.value.lastIndexOf('.');
    if (lastDotIndex !== -1) {
        input.setSelectionRange(0, lastDotIndex);
    } else {
        input.select();
    }
}

function finishEditing(input, element, originalName) {
    const newName = input.value.trim();
    if (newName && newName !== pdfHandler.getCustomFilename(originalName)) {
        pdfHandler.setCustomFilename(originalName, newName);
        element.textContent = newName;
    } else {
        element.textContent = pdfHandler.getCustomFilename(originalName);
    }
    element.classList.remove('editing');
}

async function downloadFile(file) {
    try {
        const manipulator = pdfHandler.getManipulator(file.name);
        if (!manipulator) {
            throw new Error('PDF not found');
        }

        const pdfBytes = await manipulator.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const downloadName = pdfHandler.getCustomFilename(file.name);
        saveAs(blob, downloadName);
        
        showNotification('File downloaded successfully');
    } catch (error) {
        showNotification('Error downloading file', true);
    }
}

function updateButtonStates() {
    const hasFiles = pdfHandler.getFiles().length > 0;
    elements.splitButton.disabled = !hasFiles;
    elements.mergeButton.disabled = !hasFiles;
    elements.mobileMergeButton.disabled = !hasFiles;
    elements.downloadZipButton.disabled = !hasFiles;
    elements.mobileDownloadZipButton.disabled = !hasFiles;
}

function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(notification);
    notification.offsetHeight; // Trigger reflow
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Drag and drop handlers
function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.getAttribute('data-filename'));
    e.target.classList.add('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const draggingItem = document.querySelector('.dragging');
    if (!draggingItem) return;
    
    const items = [...elements.fileList.querySelectorAll('.file-item:not(.dragging)')];
    
    const closestItem = items.reduce((closest, item) => {
        const box = item.getBoundingClientRect();
        const offset = e.clientY - (box.top + box.height / 2);
        
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: item };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
    
    if (closestItem) {
        elements.fileList.insertBefore(draggingItem, closestItem);
    } else {
        elements.fileList.appendChild(draggingItem);
    }
}

function handleDrop(e) {
    e.preventDefault();
    const fileName = e.dataTransfer.getData('text/plain');
    const items = [...elements.fileList.querySelectorAll('.file-item')];
    const newIndex = items.findIndex(item => item === e.target.closest('.file-item'));
    
    if (newIndex !== -1) {
        pdfHandler.moveFile(fileName, newIndex);
        updateFileList();
    }
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

// Initialize the application
initializeEventListeners(); 