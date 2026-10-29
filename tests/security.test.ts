import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCUMENT_SIZE, validateDocumentContent } from '../src/document-input.ts';
import { readDocument } from '../src/files.ts';

test('document byte limit is identical for ASCII, Japanese, emoji and reimport', async () => {
  for (const unit of ['a', 'あ', '😀']) {
    const bytes = new TextEncoder().encode(unit).length;
    const content = unit.repeat(Math.floor(MAX_DOCUMENT_SIZE / bytes)) + 'a'.repeat(MAX_DOCUMENT_SIZE % bytes);
    assert.doesNotThrow(() => validateDocumentContent(content));
    assert.equal((await readDocument(new File([content], 'limit.md'))).content, content);
    assert.throws(() => validateDocumentContent(content + 'a'), /2 MB/);
    await assert.rejects(readDocument(new File([content + 'a'], 'over.md')), /2 MB/);
  }
});
