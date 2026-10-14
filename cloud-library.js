'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const account = document.getElementById('cloud-account');
  const accountButton = document.getElementById('btn-cloud-account');
  const signIn = document.getElementById('btn-google-sign-in');
  const signOut = document.getElementById('btn-cloud-sign-out');
  const retry = document.getElementById('btn-cloud-retry');
  const status = document.getElementById('cloud-status');
  const identity = document.getElementById('cloud-identity');
  const setStatus = message => { status.textContent = message; accountButton.title = message; };
  accountButton.addEventListener('click', () => account.showModal());
  document.getElementById('btn-cloud-close').addEventListener('click', () => account.close());
  let services;
  try { services = await window.riffFirebaseReady; }
  catch (error) {
    setStatus('Cloud services could not load. Check your connection and reload. Local music still works.');
    console.warn('Firebase initialization unavailable:', error);
    return;
  }
  const { auth, db, authSDK, dbSDK } = services;
  const store = window.RiffMusicStore;
  const bridge = window.riffLibrary || await new Promise(resolve => {
    window.addEventListener('riff-library-ready', () => resolve(window.riffLibrary), { once: true });
  });
  signIn.disabled = false;
  let session = null;
  const emptyLibrary = () => Object.fromEntries(store.kinds.map(kind => [kind, []]));
  function readCache(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  // The visible localStorage lists may belong to the last signed-in account.
  // Keep a separate guest copy so account switches never import another user.
  let guest = readCache('riff_guest_library', localStorage.getItem('riff_library_owner') ? emptyLibrary() : bridge.read());
  localStorage.setItem('riff_guest_library', JSON.stringify(guest));
  let timer;
  let listeners = [];
  function report(error) {
    const messages = {
      'auth/unauthorized-domain': 'Add this website domain in Firebase Authentication → Settings → Authorized domains.',
      'auth/operation-not-allowed': 'Enable Google in Firebase Authentication → Sign-in method.',
      'auth/popup-blocked': 'Allow the Google sign-in popup, then try again.',
      'auth/popup-closed-by-user': 'Sign-in cancelled. Your local library is unchanged.',
      'permission-denied': 'Firestore access was denied. Publish the project’s firestore.rules in the Firebase console.',
      'unavailable': 'Cloud sync is offline. Your edits remain on this device; reconnect and press Retry sync.'
    };
    setStatus(messages[error.code] || error.message || 'Cloud sync failed. Try again.');
    retry.hidden = !session;
    console.warn('Riff cloud:', error);
  }
  signIn.addEventListener('click', () => {
    signIn.disabled = true;
    const provider = new authSDK.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    authSDK.signInWithPopup(auth, provider).catch(report).finally(() => { signIn.disabled = false; });
  });
  signOut.addEventListener('click', async () => {
    if (session && [...session.pending.values()].some(map => map.size)) {
      setStatus('Finish syncing your changes before signing out. Use Retry sync if needed.');
      retry.hidden = false;
      return;
    }
    try { await authSDK.signOut(auth); } catch (error) { report(error); }
  });
  async function recordRef(uid, kind, key) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return dbSDK.doc(db, 'users', uid, kind, id);
  }
  async function write(uid, kind, entries) {
    for (let offset = 0; offset < entries.length; offset += 350) {
      const batch = dbSDK.writeBatch(db);
      for (const [key, value] of entries.slice(offset, offset + 350)) {
        const ref = await recordRef(uid, kind, key);
        if (value === null) batch.delete(ref);
        else batch.set(ref, { ...value, updatedAt: dbSDK.serverTimestamp() });
      }
      await batch.commit();
    }
  }
  async function flush() {
    const current = session;
    if (!current || !current.loaded || current.saving) return;
    current.saving = true;
    retry.hidden = true;
    try {
      for (const kind of store.kinds) {
        const pending = current.pending.get(kind);
        const entries = [...pending];
        if (!entries.length) continue;
        setStatus('Syncing your library…');
        await write(current.uid, kind, entries);
        for (const [key, value] of entries) if (pending.get(key) === value) pending.delete(key);
        savePending(current);
      }
      if (session === current) setStatus('Library synced with Firestore.');
    } catch (error) { if (session === current) report(error); }
    finally {
      current.saving = false;
      if (session === current && retry.hidden && [...current.pending.values()].some(map => map.size)) {
        clearTimeout(timer); timer = setTimeout(flush, 500);
      }
    }
  }
  retry.addEventListener('click', () => {
    if (session && !session.loaded) loadLibrary(session); else flush();
  });
  window.addEventListener('riff-library-change', event => {
    const current = session;
    if (!current) {
      guest = bridge.read();
      localStorage.setItem('riff_guest_library', JSON.stringify(guest));
      return;
    }
    const { kind, items } = event.detail;
    try {
      const next = store.records(kind, items);
      for (const [key, value] of store.changes(current.local.get(kind), next)) current.pending.get(kind).set(key, value);
      current.local.set(kind, next);
      savePending(current);
      clearTimeout(timer); timer = setTimeout(flush, 500);
    } catch (error) { report(error); }
  });
  function savePending(current) {
    localStorage.setItem('riff_pending_library_' + current.uid,
      JSON.stringify(Object.fromEntries([...current.pending].map(([kind, entries]) => [kind, [...entries]]))));
  }
  async function loadLibrary(current) {
    setStatus('Loading your Firestore library…');
    try {
      const profileRef = dbSDK.doc(db, 'users', current.uid);
      const [profile, ...snapshots] = await Promise.all([
        dbSDK.getDoc(profileRef),
        ...store.kinds.map(kind => dbSDK.getDocs(dbSDK.collection(db, 'users', current.uid, kind)))
      ]);
      if (session !== current) return;
      // Import guest data once. An existing account's intentionally empty
      // library must not be filled again on every sign-in.
      if (!profile.exists() || profile.data().libraryVersion !== 1) {
        for (let i = 0; i < store.kinds.length; i++) {
          const kind = store.kinds[i];
          const remote = new Map(snapshots[i].docs.map(doc => [doc.data().key, doc.data()]));
          const seeds = [...current.local.get(kind)].filter(([key]) => !remote.has(key));
          await write(current.uid, kind, seeds);
        }
        await dbSDK.setDoc(profileRef, { libraryVersion: 1 }, { merge: true });
      }
      if (session !== current) return;
      current.loaded = true;
      for (const kind of store.kinds) {
        listeners.push(dbSDK.onSnapshot(dbSDK.collection(db, 'users', current.uid, kind), snapshot => {
          if (session !== current) return;
          const remote = new Map(snapshot.docs.map(doc => {
            const data = doc.data();
            return [data.key, { key: data.key, data: data.data, order: data.order, title: data.title, artist: data.artist, platform: data.platform }];
          }));
          try {
            const merged = store.overlay(remote, current.pending.get(kind));
            current.local.set(kind, merged);
            bridge.replace(kind, store.items(merged));
            if (!current.saving && ![...current.pending.values()].some(map => map.size)) setStatus('Library synced with Firestore.');
          } catch (error) { report(error); }
        }, error => {
          if (session !== current) return;
          current.loaded = false;
          listeners.forEach(stop => stop()); listeners = [];
          report(error);
        }));
      }
      flush();
    } catch (error) { if (session === current) report(error); }
  }
  authSDK.onAuthStateChanged(auth, user => {
    clearTimeout(timer);
    listeners.forEach(stop => stop()); listeners = [];
    const cachedOwner = localStorage.getItem('riff_library_owner');
    const cachedLibrary = bridge.read();
    if (session || (cachedOwner && cachedOwner !== user?.uid)) store.kinds.forEach(kind => bridge.replace(kind, guest[kind]));
    session = null;
    identity.textContent = user ? (user.displayName || user.email || 'Google account') : 'Your music library';
    accountButton.textContent = user ? 'Account' : 'Sign in';
    signIn.hidden = !!user;
    signOut.hidden = !user;
    retry.hidden = true;
    if (!user) {
      localStorage.removeItem('riff_library_owner');
      setStatus('Sign in with Google to sync your music library.');
      return;
    }
    localStorage.setItem('riff_library_owner', user.uid);
    const initial = cachedOwner === user.uid ? cachedLibrary : guest;
    const savedPending = readCache('riff_pending_library_' + user.uid, {});
    session = { uid: user.uid, loaded: false, saving: false,
      local: new Map(store.kinds.map(kind => [kind, store.records(kind, initial[kind])])),
      pending: new Map(store.kinds.map(kind => [kind, new Map(savedPending[kind] || [])])) };
    loadLibrary(session);
  }, report);
});
