# PDF Editor Web Application

A frontend-only web application that allows users to split and merge PDF files directly in their browser. All processing is done locally - no data is ever sent to any server.

## Privacy & Security

- **100% Local Processing**: All PDF operations (split, merge, preview) happen directly in your browser
- **No Server Communication**: Your files never leave your computer
- **No Data Collection**: We don't collect or store any of your data
- **No Analytics**: No tracking or analytics are used
- **No Dependencies**: Works completely offline after initial load

## Features

- **Upload PDFs**
  - Drag-and-drop interface
  - Multiple file selection
  - File preview with thumbnails
  - All files processed locally

- **Split PDFs**
  - Split by page ranges
  - Visual page selection
  - Preview functionality
  - Instant local processing

- **Merge PDFs**
  - Combine multiple PDFs
  - Drag-and-drop reordering
  - Preview before merging
  - Local file combination

- **Download Options**
  - Individual PDF downloads
  - ZIP archive of all processed files
  - All downloads processed locally

## Technical Details

- Built with vanilla JavaScript (ES6+)
- Uses PDF.js for PDF manipulation
- No server-side processing required
- Responsive design for all screen sizes
- Works completely offline

## Setup

1. Clone this repository
2. Open `index.html` in a modern web browser
3. No build process or dependencies required
4. No internet connection needed after initial load

## Browser Support

- Chrome (recommended)
- Firefox
- Edge
- Safari

## Libraries Used

- PDF.js - For PDF manipulation and rendering
- JSZip - For creating ZIP archives

## License

MIT License 