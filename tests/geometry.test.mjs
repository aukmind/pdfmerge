import test from 'node:test';
import assert from 'node:assert/strict';
import { pageGeometry, toPdfPoint, toPdfRect, placement, centeredPlacement, normalizeRotation } from '../js/pdf/geometry.js';

const box = { x: 10, y: 20, width: 600, height: 800 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('normalizes rotation into 0/90/180/270', () => {
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(450), 90);
});

test('display size swaps for sideways pages', () => {
    assert.deepEqual([pageGeometry(box, 90).width, pageGeometry(box, 90).height], [800, 600]);
});

test('display top-left maps to the right PDF corner per rotation', () => {
    assert.deepEqual(toPdfPoint(pageGeometry(box, 0), 0, 0), { x: 10, y: 820 });
    assert.deepEqual(toPdfPoint(pageGeometry(box, 90), 0, 0), { x: 10, y: 20 });
    assert.deepEqual(toPdfPoint(pageGeometry(box, 180), 0, 0), { x: 610, y: 20 });
    assert.deepEqual(toPdfPoint(pageGeometry(box, 270), 0, 0), { x: 610, y: 820 });
});

test('full display rect maps to the whole box at any rotation', () => {
    for (const r of [0, 90, 180, 270]) {
        assert.deepEqual(toPdfRect(pageGeometry(box, r), { x: 0, y: 0, w: 1, h: 1 }), { x: 10, y: 20, width: 600, height: 800 });
    }
});

test('placement origin is the display bottom-left and rotation follows the page', () => {
    const p = placement(pageGeometry(box, 0), { x: 0.5, y: 0.25, w: 0.25, h: 0.25 });
    assert.deepEqual(p, { x: 310, y: 420, width: 150, height: 200, rotate: 0 });
    assert.equal(placement(pageGeometry(box, 90), { x: 0, y: 0, w: 1, h: 1 }).rotate, 90);
});

test('centered placement with no angle centers the content', () => {
    const p = centeredPlacement(pageGeometry(box, 0), 0.5, 0.5, 100, 40, 0);
    close(p.x, 10 + 300 - 50);
    close(p.y, 20 + 400 - 20);
});
