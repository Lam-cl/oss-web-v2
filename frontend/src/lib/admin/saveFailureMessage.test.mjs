import assert from 'node:assert/strict';
import test from 'node:test';
import { saveFailureMessage } from './saveFailureMessage.ts';

const GENERIC = 'Some product details are not valid yet. Review the choices, prices, stock, and photos.';

test('save errors keep their real reason instead of the generic validation banner', () => {
  for (const reason of [
    'Catalogue product revision conflict. Reload before saving.',
    'Catalogue media changed. Reload before saving.',
    'Catalogue media orders must be contiguous from zero.',
    'The request timed out. Please try again.',
  ]) {
    const shown = saveFailureMessage(new Error(reason));
    assert.equal(shown, `Save failed: ${reason}`);
    assert.notEqual(shown, GENERIC);
  }
});

test('blank or non-Error failures get a clear retry message', () => {
  assert.equal(saveFailureMessage(new Error('   ')), 'Save failed. Please try again.');
  assert.equal(saveFailureMessage('boom'), 'Save failed. Please try again.');
  assert.equal(saveFailureMessage(undefined), 'Save failed. Please try again.');
});

test('messages that are already complete are not prefixed twice', () => {
  for (const reason of [
    'Save failed (HTTP 500).',
    'Save failed: Catalogue media changed. Reload before saving.',
    'The product was created, but a photo could not be added: Request failed (HTTP 502). Reopen the product to finish it.',
  ]) {
    const shown = saveFailureMessage(new Error(reason));
    assert.equal(shown, reason);
    assert.ok(!/^Save failed: Save failed/.test(shown));
  }
});

test('an HTTP failure without a server message gets a single prefix', () => {
  assert.equal(saveFailureMessage(new Error('Request failed (HTTP 500).')), 'Save failed: Request failed (HTTP 500).');
});
