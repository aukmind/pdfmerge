// Maps between "display" space (the page as the user sees it: top-left origin,
// /Rotate applied, normalized 0..1) and PDF user space (bottom-left origin).

export function normalizeRotation(angle) {
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

export function pageGeometry(box, rotation) {
    const r = normalizeRotation(rotation);
    const sideways = r === 90 || r === 270;
    return {
        box,
        rotation: r,
        width: sideways ? box.height : box.width,
        height: sideways ? box.width : box.height,
    };
}

export function toPdfPoint(geom, u, v) {
    const { box: { x, y, width: W, height: H }, rotation } = geom;
    const dx = u * geom.width;
    const dy = v * geom.height;
    switch (rotation) {
        case 90: return { x: x + dy, y: y + dx };
        case 180: return { x: x + W - dx, y: y + dy };
        case 270: return { x: x + W - dy, y: y + H - dx };
        default: return { x: x + dx, y: y + H - dy };
    }
}

export function toPdfRect(geom, rect) {
    const a = toPdfPoint(geom, rect.x, rect.y);
    const b = toPdfPoint(geom, rect.x + rect.w, rect.y + rect.h);
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
    };
}

// Origin + size + rotation for drawing content that must look upright on screen.
export function placement(geom, rect) {
    const origin = toPdfPoint(geom, rect.x, rect.y + rect.h);
    return {
        x: origin.x,
        y: origin.y,
        width: rect.w * geom.width,
        height: rect.h * geom.height,
        rotate: geom.rotation,
    };
}

// Bottom-left origin for content of size (w, h) in points, centered on display point (cu, cv)
// and turned `angle` degrees counter-clockwise as seen on screen.
export function centeredPlacement(geom, cu, cv, w, h, angle) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = cu * geom.width;
    const cyUp = (1 - cv) * geom.height;
    const ox = cx - (cos * w / 2 - sin * h / 2);
    const oyUp = cyUp - (sin * w / 2 + cos * h / 2);
    const origin = toPdfPoint(geom, ox / geom.width, 1 - oyUp / geom.height);
    return { x: origin.x, y: origin.y, rotate: geom.rotation + angle };
}

// Geometry of a pdf-lib page as pdf.js displays it (crop box, /Rotate applied).
export function geometryOfPage(page) {
    return pageGeometry(page.getCropBox(), page.getRotation().angle);
}
