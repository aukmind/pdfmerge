import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageRanges, pagesFromRanges, pagesToRangeString, safePagesFromRanges } from '../js/pdf/ranges.js';

test('parses singles, ranges and open-ended ranges', () => {
    assert.deepEqual(pagesFromRanges('1-3, 5, 8-', 9), [1, 2, 3, 5, 8, 9]);
});

test('rejects junk that parseInt would accept', () => {
    assert.throws(() => parsePageRanges('3abc', 9), /Invalid page number/);
    assert.throws(() => parsePageRanges('1-2-3', 9), /Invalid page/);
});

test('rejects out-of-bounds and reversed ranges', () => {
    assert.throws(() => parsePageRanges('0', 5));
    assert.throws(() => parsePageRanges('4-2', 5));
    assert.throws(() => parsePageRanges('2-6', 5));
});

test('safe variant returns empty on invalid input', () => {
    assert.deepEqual(safePagesFromRanges('x', 5), []);
});

test('collapses pages into a range string', () => {
    assert.equal(pagesToRangeString([6, 1, 2, 3, 3]), '1-3, 6');
    assert.equal(pagesToRangeString([]), '');
});
