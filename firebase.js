'use strict';

// Riff serves its renderer directly, without an npm module bundler. Use the
// official browser SDK and keep cloud initialization independent of playback.
(() => {
  const firebaseConfig = {
    apiKey: 'AIzaSyBJ9iMn3mjs-vPrwDDXVF2bOo5PU0jwRR4',
    authDomain: 'riff-music-player.firebaseapp.com',
    projectId: 'riff-music-player',
    storageBucket: 'riff-music-player.firebasestorage.app',
    messagingSenderId: '348699680176',
    appId: '1:348699680176:web:905a839fc2739d98c28a75'
  };

  // Consumers can await this promise before adding Firebase services. Reuse
  // the same app if this script is loaded again.
  const sdkRoot = 'https://www.gstatic.com/firebasejs/12.19.0/';
  window.riffFirebaseReady = Promise.all([
    import(sdkRoot + 'firebase-app.js'),
    import(sdkRoot + 'firebase-auth.js'),
    import(sdkRoot + 'firebase-firestore.js')
  ]).then(([appSDK, authSDK, dbSDK]) => {
      const app = appSDK.getApps().find(existing => existing.name === '[DEFAULT]') || appSDK.initializeApp(firebaseConfig);
      window.riffFirebaseApp = app;
      return { app, auth: authSDK.getAuth(app), db: dbSDK.getFirestore(app), authSDK, dbSDK };
    });

  // An offline desktop session must still be able to use local playback.
  window.riffFirebaseReady.catch(error => {
    console.warn('Firebase initialization unavailable:', error);
  });
})();
