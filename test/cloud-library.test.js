'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const store = require('../music-store');

async function fixture(initial, remote = new Map(), savedCache = []) {
  const elements = new Map();
  class Element extends EventTarget {
    disabled = true; hidden = false; textContent = ''; title = '';
    showModal() {} close() {}
    click() { this.dispatchEvent(new Event('click')); }
  }
  const document = new EventTarget();
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const cache = new Map(savedCache);
  const localStorage = {
    getItem: key => cache.get(key) || null,
    setItem: (key, value) => cache.set(key, value),
    removeItem: key => cache.delete(key)
  };
  let library = structuredClone(initial);
  let authListener;
  const subscriptions = new Map();
  const snapshot = prefix => ({ docs: [...remote].filter(([key]) => key.startsWith(prefix + '/')).map(([, value]) => ({ data: () => value })) });
  function emit() {
    for (const [prefix, listener] of subscriptions) listener(snapshot(prefix));
  }
  const authSDK = {
    GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged: (_, callback) => { authListener = callback; callback(null); },
    signInWithPopup: async () => { authListener({ uid: 'alice', displayName: 'Alice' }); },
    signOut: async () => { authListener(null); }
  };
  const dbSDK = {
    doc: (_, ...parts) => parts.join('/'), collection: (_, ...parts) => parts.join('/'),
    getDoc: async ref => ({ exists: () => remote.has(ref), data: () => remote.get(ref) }),
    getDocs: async ref => snapshot(ref),
    setDoc: async (ref, value) => { remote.set(ref, value); },
    serverTimestamp: () => 'timestamp',
    writeBatch: () => {
      const writes = [];
      return {
        set: (ref, value) => writes.push(() => remote.set(ref, value)),
        delete: ref => writes.push(() => remote.delete(ref)),
        commit: async () => { writes.forEach(write => write()); emit(); }
      };
    },
    onSnapshot: (ref, callback) => {
      subscriptions.set(ref, callback); callback(snapshot(ref));
      return () => subscriptions.delete(ref);
    }
  };
  const window = new EventTarget();
  window.RiffMusicStore = store;
  window.riffLibrary = { read: () => structuredClone(library), replace: (kind, items) => { library[kind] = structuredClone(items); } };
  window.riffFirebaseReady = Promise.resolve({ auth: {}, db: {}, authSDK, dbSDK });
  const context = { window, document, localStorage, crypto: webcrypto, TextEncoder, console,
    setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloud-library'), 'utf8'), context);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  await settle();
  return { remote, elements, get library() { return library; }, auth: user => authListener(user), settle,
    edit(kind, items) {
      library[kind] = items;
      const event = new Event('riff-library-change'); event.detail = { kind, items }; window.dispatchEvent(event);
    } };
}
const empty = () => ({ favorites: [], history: [], playlists: [] });
const track = id => ({ id, title: id, platform: 'youtube' });

test('Google sign-in imports guest music once and subsequent edits reach Firestore', async () => {
  const app = await fixture({ ...empty(), favorites: [track('guest')] });
  app.elements.get('btn-google-sign-in').click(); await app.settle();
  assert.equal(app.remote.get('users/alice').libraryVersion, 1);
  assert.equal([...app.remote.keys()].filter(key => key.includes('/favorites/')).length, 1);
  app.edit('favorites', [track('new')]); await app.settle();
  const records = [...app.remote].filter(([key]) => key.includes('/favorites/')).map(([, value]) => JSON.parse(value.data));
  assert.deepEqual(records, [track('new')]);
  app.elements.get('btn-cloud-sign-out').click(); await app.settle();
  assert.deepEqual(app.library.favorites, [track('guest')]);
});
test('an existing empty account stays empty and switching accounts keeps guest data separate', async () => {
  const remote = new Map([['users/alice', { libraryVersion: 1 }]]);
  const app = await fixture({ ...empty(), favorites: [track('guest')] }, remote);
  app.auth({ uid: 'alice' }); await app.settle();
  assert.deepEqual(app.library.favorites, []);
  app.edit('favorites', [track('alice-only')]); await app.settle();
  app.auth({ uid: 'bob' }); await app.settle();
  assert.deepEqual(app.library.favorites, [track('guest')]);
  assert.equal([...remote].filter(([key, value]) => key.includes('users/bob/favorites') && value.title === 'alice-only').length, 0);
});
test('pending account edits survive reload without becoming the guest library', async () => {
  const unsynced = track('unsynced');
  const pending = [...store.records('favorites', [unsynced])];
  const cache = [
    ['riff_library_owner', 'alice'],
    ['riff_guest_library', JSON.stringify(empty())],
    ['riff_pending_library_alice', JSON.stringify({ favorites: pending, history: [], playlists: [] })]
  ];
  const app = await fixture({ ...empty(), favorites: [unsynced] }, new Map([['users/alice', { libraryVersion: 1 }]]), cache);
  app.auth({ uid: 'alice' }); await app.settle();
  assert.deepEqual(app.library.favorites, [unsynced]);
  assert.equal([...app.remote].filter(([key, value]) => key.includes('/favorites/') && value.title === 'unsynced').length, 1);
  app.auth(null); await app.settle();
  assert.deepEqual(app.library.favorites, []);
});
