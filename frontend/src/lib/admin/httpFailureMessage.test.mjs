import assert from 'node:assert/strict';
import test from 'node:test';
import { httpFailureMessage } from './httpFailureMessage.ts';

test('a non-empty server message is shown as-is', () => {
  assert.equal(httpFailureMessage(409, 'Catalogue product revision conflict. Reload before saving.'),
    'Catalogue product revision conflict. Reload before saving.');
  assert.equal(httpFailureMessage(413, 'Custom too large.'), 'Custom too large.');
});

test('413 without a message explains the photo size limit', () => {
  assert.equal(httpFailureMessage(413), 'Photo is too large (max 4 MB). It was not saved.');
  assert.equal(httpFailureMessage(413, ''), 'Photo is too large (max 4 MB). It was not saved.');
  assert.equal(httpFailureMessage(413, '   '), 'Photo is too large (max 4 MB). It was not saved.');
});

test('timeouts ask the admin to reload before retrying', () => {
  for (const status of [504, 408]) {
    assert.equal(httpFailureMessage(status), 'The server timed out. Reload and check before retrying.');
  }
});

test('other failures keep the HTTP status', () => {
  assert.equal(httpFailureMessage(500), 'Save failed (HTTP 500).');
  assert.equal(httpFailureMessage(502), 'Save failed (HTTP 502).');
  assert.equal(httpFailureMessage(400, undefined), 'Save failed (HTTP 400).');
});
