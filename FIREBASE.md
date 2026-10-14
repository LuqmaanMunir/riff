# Firebase music library

The web renderer connects to `riff-music-player` using the official Firebase
browser SDK. Google sign-in loads a private library and syncs changes across
devices. Guest playback still works without sign-in. Existing guest favourites,
history and playlists are imported only on the first setup of an account.

## Console setup

1. In Firebase Authentication, enable **Google** under **Sign-in method** and
   select the project's support email.
2. Under Authentication → Settings → Authorized domains, add your production
   Vercel hostname (without `https://`). Add any preview hostname you use too.
3. Create the default Cloud Firestore database, if it does not exist.
4. In Firestore → Rules, publish the exact contents of `firestore.rules`.
   Alternatively, with an authenticated Firebase CLI run:
   `firebase deploy --only firestore:rules --project riff-music-player`.

The web config alone cannot enable the provider or publish security rules.

## Schema and behaviour

- `users/{uid}`: first-import marker (`libraryVersion`).
- `users/{uid}/favorites/{sha256}`: one favourite track per document.
- `users/{uid}/history/{sha256}`: one recent track per document.
- `users/{uid}/playlists/{sha256}`: one playlist per document, including its tracks.

Each item has searchable `title`, `artist`, `platform`, its ordering, and a JSON
`data` field that preserves Riff metadata exactly. Only the authenticated owner
may access these records. Edits and deletions update individual documents; two
devices editing the same record use last-write-wins. Other remote additions are
preserved. Pending edits survive reload and can be retried from the account menu.
Playlists above 900 KB are rejected with an actionable error.

Firestore stores metadata, not audio files. Computer-local files are not uploaded
or made playable on another device. Google sign-in is for the HTTPS web app;
the Electron `file://` renderer retains local playback. Music search and streaming
still require Riff's separately hosted backend; the current renderer calls its
desktop localhost server.
