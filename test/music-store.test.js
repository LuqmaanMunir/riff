'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../music-store');
const track = (id, title = id, platform = 'youtube') => ({ id, title, platform });

test('cloud updates preserve unrelated remote additions while applying local deletes', () => {
  const before = store.records('favorites', [track('a'), track('b')]);
  const edited = store.records('favorites', [track('b'), track('c')]);
  const remote = store.records('favorites', [track('a'), track('b'), track('d')]);
  const merged = store.overlay(remote, store.changes(before, edited));
  assert.deepEqual(new Set(store.items(merged).map(item => item.id)), new Set(['b', 'c', 'd']));
});
test('local metadata edits survive an older snapshot and a retry', () => {
  const before = store.records('history', [track('a', 'Old')]);
  const edited = store.records('history', [track('a', 'New')]);
  const pending = store.changes(before, edited);
  assert.equal(store.items(store.overlay(before, pending))[0].title, 'New');
  assert.equal(store.changes(edited, edited).size, 0);
});
test('playlist track arrays round trip and platform ids remain distinct', () => {
  const playlist = { id: 'pl/1', name: 'Study', tracks: [track('a'), track('b')] };
  assert.deepEqual(store.items(store.records('playlists', [playlist])), [playlist]);
  assert.equal(store.records('favorites', [track('a'), track('a', 'Other', 'soundcloud')]).size, 2);
});
test('oversize playlists fail clearly before Firestore rejects a write', () => {
  assert.throws(() => store.records('playlists', [{ id: 'big', name: 'x'.repeat(900001) }]), /too large/);
});
