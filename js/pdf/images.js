import { canvasToBytes, releaseCanvas } from './handler.js';

// Decodes any browser-supported image into JPEG/PNG bytes pdf-lib can embed,
// applying EXIF orientation, an extra rotation and optional scan cleanup.
export async function prepareImage(blob, { rotation = 0, enhance = false, maxSide = 4000 } = {}) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const sideways = rotation % 180 !== 0;

    const canvas = document.createElement('canvas');
    canvas.width = sideways ? h : w;
    canvas.height = sideways ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    bitmap.close();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const png = !enhance && blob.type !== 'image/jpeg' && (blob.type === 'image/png' || hasTransparency(ctx, canvas.width, canvas.height));
    if (!png) {
        // JPEG has no alpha: transparent pixels would turn black, so put white paper behind them.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
    }
    if (enhance) cleanUpScan(ctx, canvas.width, canvas.height);

    const result = {
        bytes: await canvasToBytes(canvas, png ? 'image/png' : 'image/jpeg', 0.9),
        type: png ? 'png' : 'jpg',
        width: canvas.width,
        height: canvas.height,
    };
    releaseCanvas(canvas);
    return result;
}

function hasTransparency(ctx, width, height) {
    const px = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
    return false;
}

// Grayscale plus a levels stretch so paper turns white and ink turns dark.
export function cleanUpScan(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height);
    const px = data.data;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
        const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
        px[i] = g;
        histogram[g]++;
    }
    const total = px.length / 4;
    let low = 0;
    let high = 255;
    for (let acc = 0; low < 255 && (acc += histogram[low]) < total * 0.02; low++);
    for (let acc = 0; high > 0 && (acc += histogram[high]) < total * 0.25; high--);
    const range = Math.max(1, high - low);
    for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(0, Math.min(255, ((px[i] - low) / range) * 255));
        px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
}
