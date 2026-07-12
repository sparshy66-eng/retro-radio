/* ==========================================================================
   Wallflow Radio — Spotify OAuth 2.0 (Authorization Code Flow with PKCE)
   Works entirely client-side, no backend required (GitHub Pages friendly).
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // CONFIG — edit these two values if your app moves
  // ---------------------------------------------------------------------
  const SPOTIFY_CLIENT_ID = '6b9f72faedec431687760a74dcc91134';
  const SPOTIFY_REDIRECT_URI = 'https://sparshy66-eng.github.io/retro-radio/callback.html';

  // Scopes needed for reading the profile + basic playback control.
  // Trim this down if you don't need playback control.
  const SPOTIFY_SCOPES = [
    'user-read-email',
    'user-read-private',
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing'
  ].join(' ');

  const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
  const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
  const PROFILE_ENDPOINT = 'https://api.spotify.com/v1/me';

  const LS_TOKENS_KEY = 'spotifyTokens';       // { access_token, refresh_token, expires_at }
  const SS_VERIFIER_KEY = 'spotify_code_verifier';
  const SS_STATE_KEY = 'spotify_auth_state';

  // ---------------------------------------------------------------------
  // PKCE helpers
  // ---------------------------------------------------------------------

  // Random string from an unreserved character set, used for the verifier & state.
  function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = crypto.getRandomValues(new Uint8Array(length));
    let text = '';
    randomValues.forEach((v) => { text += possible[v % possible.length]; });
    return text;
  }

  function base64UrlEncode(buffer) {
    let str = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
  }

  // ---------------------------------------------------------------------
  // 1. Kick off login — generates PKCE pair, redirects to Spotify
  // ---------------------------------------------------------------------
  async function loginSpotify() {
    try {
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateRandomString(16);

      // sessionStorage survives the redirect to Spotify and back, but is
      // scoped to this tab — good enough since PKCE only needs same-browser.
      sessionStorage.setItem(SS_VERIFIER_KEY, codeVerifier);
      sessionStorage.setItem(SS_STATE_KEY, state);

      const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        state: state,
        scope: SPOTIFY_SCOPES
      });

      window.location.href = `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
    } catch (err) {
      console.error('Spotify login failed to start:', err);
      alert('Could not start Spotify login. See console for details.');
    }
  }
  window.loginSpotify = loginSpotify;

  // ---------------------------------------------------------------------
  // 2. Token refresh (public client — no client secret involved)
  // ---------------------------------------------------------------------
  async function refreshSpotifyToken(refreshToken) {
    if (!refreshToken) return null;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: SPOTIFY_CLIENT_ID
      });

      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });

      if (!res.ok) {
        console.error('Spotify token refresh failed:', await res.text());
        return null;
      }

      const data = await res.json();
      const tokens = {
        access_token: data.access_token,
        // Spotify doesn't always return a new refresh_token — keep the old one if absent.
        refresh_token: data.refresh_token || refreshToken,
        expires_at: Date.now() + (data.expires_in * 1000)
      };
      localStorage.setItem(LS_TOKENS_KEY, JSON.stringify(tokens));
      return tokens;
    } catch (err) {
      console.error('Spotify token refresh error:', err);
      return null;
    }
  }
  window.refreshSpotifyToken = refreshSpotifyToken;

  // ---------------------------------------------------------------------
  // 3. Fetch the logged-in user's profile with a valid access token
  // ---------------------------------------------------------------------
  async function fetchSpotifyProfile(accessToken) {
    const res = await fetch(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Spotify profile fetch failed: ${res.status}`);
    return res.json();
  }

  // Returns a valid (non-expired) access token, refreshing it first if needed.
  // Exposed globally so player code elsewhere can call it before API requests.
  async function getValidSpotifyAccessToken() {
    const raw = localStorage.getItem(LS_TOKENS_KEY);
    if (!raw) return null;
    let tokens;
    try { tokens = JSON.parse(raw); } catch (e) { localStorage.removeItem(LS_TOKENS_KEY); return null; }

    // Refresh a little early (60s buffer) to avoid edge-of-expiry failures.
    if (Date.now() > tokens.expires_at - 60000) {
      tokens = await refreshSpotifyToken(tokens.refresh_token);
      if (!tokens) return null;
    }
    return tokens.access_token;
  }
  window.getValidSpotifyAccessToken = getValidSpotifyAccessToken;

  // ---------------------------------------------------------------------
  // 4. On page load: if callback.html already stored tokens, hydrate the
  //    Wallflow session from the Spotify profile automatically.
  // ---------------------------------------------------------------------
  async function initSpotifySession() {
    // Don't clobber an existing normal (email/password) session.
    if (localStorage.getItem('wallflowSession')) return;

    const accessToken = await getValidSpotifyAccessToken();
    if (!accessToken) return;

    try {
      const profile = await fetchSpotifyProfile(accessToken);
      const session = {
        name: profile.display_name || 'Spotify User',
        email: profile.email || '',
        provider: 'spotify',
        spotifyId: profile.id
      };
      localStorage.setItem('wallflowSession', JSON.stringify(session));
      if (window.wallflowShowApp) window.wallflowShowApp(session);
    } catch (err) {
      console.error('Failed to load Spotify profile:', err);
      // Tokens are bad/expired beyond refresh — clear them so login can retry cleanly.
      localStorage.removeItem(LS_TOKENS_KEY);
    }
  }

  // ---------------------------------------------------------------------
  // 5. Make sure logging out also clears the Spotify tokens
  // ---------------------------------------------------------------------
  function wireLogout() {
    const logoutBtn = document.getElementById('dropdownLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem(LS_TOKENS_KEY);
      });
    }
  }

  // This script is loaded at the end of <body>, so the DOM is already
  // parsed — no need to wait on DOMContentLoaded.
  wireLogout();
  initSpotifySession();
})();
