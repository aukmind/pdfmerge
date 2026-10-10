import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsToMarkdown } from '../js/pdf/markdown.js';

const run = (str, x, y, size = 10) => ({ str, x, y, size, width: str.length * size * 0.5 });
const page = (items) => ({ width: 600, height: 800, items });

test('detects headings by size relative to body text', () => {
    const md = itemsToMarkdown([page([run('Big Title', 50, 100, 24), run('Body text here.', 50, 140)])]);
    assert.equal(md, '# Big Title\n\nBody text here.\n');
});

test('merges wrapped lines and removes hyphenation', () => {
    const md = itemsToMarkdown([page([run('A para-', 50, 100), run('graph continues', 50, 112)])]);
    assert.equal(md, 'A paragraph continues\n');
});

test('splits paragraphs on large vertical gaps', () => {
    const md = itemsToMarkdown([page([run('First.', 50, 100), run('Second.', 50, 140)])]);
    assert.equal(md, 'First.\n\nSecond.\n');
});

test('turns bullets and numbers into lists', () => {
    const md = itemsToMarkdown([page([run('• one', 50, 100), run('• two', 50, 112), run('2) three', 50, 124)])]);
    assert.equal(md, '- one\n- two\n2. three\n');
});

test('joins runs on one line with spaces where there is a gap', () => {
    const md = itemsToMarkdown([page([run('Hello', 50, 100), run('world', 90, 100)])]);
    assert.equal(md, 'Hello world\n');
});

test('drops bare page numbers in the margins', () => {
    const md = itemsToMarkdown([page([run('Body.', 50, 100), run('3', 300, 780)])]);
    assert.equal(md, 'Body.\n');
});

test('optional page breaks between pages', () => {
    const md = itemsToMarkdown([page([run('One.', 50, 100)]), page([run('Two.', 50, 100)])], { pageBreaks: true });
    assert.equal(md, 'One.\n\n---\n\nTwo.\n');
});
