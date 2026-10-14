'use strict';
(function (root, factory) {
  const store = factory();
  if (typeof module === 'object' && module.exports) module.exports = store;
  else root.RiffMusicStore = store;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const kinds = ['favorites', 'history', 'playlists'];
  function keyFor(kind, item) {
    if (!item || typeof item !== 'object') throw new Error('Invalid library item');
    const id = item.id || item.url;
    if (!id) throw new Error('A library item needs an id or URL');
    return kind === 'playlists' ? String(id) : JSON.stringify([item.platform || 'youtube', String(id)]);
  }
  function records(kind, items) {
    const result = new Map();
    items.forEach((item, order) => {
      // Preserve playlist arrays and all Riff metadata as JSON. Searchable
      // title, artist and platform fields also live on the Firestore record.
      const data = JSON.stringify(item);
      if (new TextEncoder().encode(data).length > 900000) throw new Error('This playlist is too large to sync. Split it into smaller playlists.');
      const key = keyFor(kind, item);
      result.set(key, { key, data, order, title: String(item.title || item.name || ''), artist: String(item.artist || ''), platform: String(item.platform || '') });
    });
    return result;
  }
  function changes(previous, next) {
    const delta = new Map();
    for (const [key, value] of next) if (JSON.stringify(previous.get(key)) !== JSON.stringify(value)) delta.set(key, value);
    for (const key of previous.keys()) if (!next.has(key)) delta.set(key, null);
    return delta;
  }
  function overlay(remote, pending) {
    const result = new Map(remote);
    for (const [key, value] of pending) {
      if (value === null) result.delete(key); else result.set(key, value);
    }
    return result;
  }
  function items(records) {
    return [...records.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map(record => JSON.parse(record.data));
  }
  return { kinds, keyFor, records, changes, overlay, items };
});
