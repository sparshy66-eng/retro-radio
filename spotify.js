const CLIENT_ID = "6b9f72faedec431687760a74dcc91134";

const REDIRECT_URI =
"https://sparshy66-eng.github.io/retro-radio/callback.html";

const SCOPES = [
  "user-read-private",
  "user-library-modify",
  "user-library-read"
];

function loginSpotify() {
    const auth =
`https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES.join("%20")}`;

    window.location.href = auth;
}
