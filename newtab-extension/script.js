/* ═══════════════════════════════════════════════════════════
   LUMINA — GLASS NEW TAB  |  script.js  v2.1
   Vanilla JS · Chrome MV3
   ─ Preferences → chrome.storage.local (small, fast)
   ─ Media blobs   → IndexedDB (no size limit, truly persistent)
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── DOM REFERENCES ──────────────────────────────────────── */
const bgVideo          = document.getElementById('bg-video');
const bgImage          = document.getElementById('bg-image');
const grainOverlay     = document.getElementById('grain-overlay');
const clockTime        = document.getElementById('clock-time');
const clockDate        = document.getElementById('clock-date');
const secondsBar       = document.getElementById('clock-seconds-bar');
const secondsFill      = document.getElementById('clock-seconds-fill');
const searchInput      = document.getElementById('search-input');
const searchBtn        = document.getElementById('search-btn');
const greetingLine     = document.getElementById('greeting-line');
const settingsBtn      = document.getElementById('settings-btn');
const settingsPanel    = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsClose    = document.getElementById('settings-close');

const blurToggle       = document.getElementById('blur-toggle');
const grainToggle      = document.getElementById('grain-toggle');
const overlaySlider    = document.getElementById('overlay-slider');
const overlayValue     = document.getElementById('overlay-value');
const format24Toggle   = document.getElementById('format-24h-toggle');
const secondsBarToggle = document.getElementById('seconds-bar-toggle');
const mediaFileInput   = document.getElementById('media-file-input');
const mediaStatus      = document.getElementById('media-status');
const removeMediaRow   = document.getElementById('remove-media-row');
const removeMediaBtn   = document.getElementById('remove-media-btn');
const mediaTypeBadge   = document.getElementById('media-type-badge');

/* ─── TRACKED OBJECT URL (revoked on clear) ───────────────── */
let currentObjectURL = null;

/* ════════════════════════════════════════════════════════════
   INDEXEDDB — MEDIA BLOB STORAGE
   DB: LuminaDB  |  Store: media  |  Key: 'background'
   Stores: { blob: Blob, name: string, type: 'video'|'image' }
   No base64 encode — the raw File is stored directly.
   Persists across tab closes, browser restarts, exactly like
   any other IndexedDB object store in a Chrome extension.
════════════════════════════════════════════════════════════ */

const IDB_NAME    = 'LuminaDB';
const IDB_VERSION = 1;
const IDB_STORE   = 'media';
const IDB_KEY     = 'background';

/** Open (or upgrade) the database. Returns a Promise<IDBDatabase>. */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
    req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
  });
}

/** Save a media record {blob, name, mediaType} under IDB_KEY. */
async function idbSaveMedia(blob, name, mediaType) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.put({ blob, name, mediaType }, IDB_KEY);
    req.onsuccess  = () => resolve();
    req.onerror    = (e) => reject(e.target.error);
    tx.oncomplete  = () => db.close();
  });
}

/** Load the saved media record. Returns null if none exists. */
async function idbLoadMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.get(IDB_KEY);
    req.onsuccess  = (e) => { db.close(); resolve(e.target.result || null); };
    req.onerror    = (e) => { db.close(); reject(e.target.error); };
  });
}

/** Remove the saved media record. */
async function idbClearMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.delete(IDB_KEY);
    req.onsuccess  = () => { db.close(); resolve(); };
    req.onerror    = (e) => { db.close(); reject(e.target.error); };
  });
}

/* ════════════════════════════════════════════════════════════
   CHROME STORAGE — PREFERENCES ONLY (no blobs, no base64)
════════════════════════════════════════════════════════════ */

const PREF_KEYS = ['blurBg','showGrain','overlayPct','use24h','showSecondsBar','mediaName','mediaType'];

const PREF_DEFAULTS = {
  blurBg:        false,
  showGrain:     true,
  overlayPct:    45,
  use24h:        false,
  showSecondsBar:true,
  mediaName:     null,   // display name of stored media
  mediaType:     null,   // 'video' | 'image' | null
};

let state = { ...PREF_DEFAULTS };

function loadPrefs() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(PREF_KEYS, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('[Lumina] prefs.get error:', chrome.runtime.lastError);
          resolve({ ...PREF_DEFAULTS });
          return;
        }
        resolve({ ...PREF_DEFAULTS, ...result });
      });
    } catch {
      resolve({ ...PREF_DEFAULTS });
    }
  });
}

function savePrefs(partial) {
  state = { ...state, ...partial };
  try {
    chrome.storage.local.set(partial, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Lumina] prefs.set error:', chrome.runtime.lastError);
      }
    });
  } catch { /* silent */ }
}

/* ════════════════════════════════════════════════════════════
   CLOCK & DATE
════════════════════════════════════════════════════════════ */

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

const padZero  = (n) => String(n).padStart(2, '0');
const getAmPm  = (h) => h < 12 ? 'AM' : 'PM';
const fmtHour  = (h, use24) => use24 ? padZero(h) : padZero(h % 12 || 12);

function getGreeting(h) {
  if (h < 5)  return 'Still up? 🌙';
  if (h < 12) return 'Good morning ☀️';
  if (h < 17) return 'Good afternoon 🌤️';
  if (h < 21) return 'Good evening 🌆';
  return 'Good night 🌙';
}

let lastSecond = -1;

function tickClock() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();

  const ampm = state.use24h ? '' : ` ${getAmPm(h)}`;
  clockTime.textContent = `${fmtHour(h, state.use24h)}:${padZero(m)}${ampm}`;

  if (s !== lastSecond) {
    secondsFill.style.width = ((s / 60) * 100) + '%';
    lastSecond = s;
  }

  clockDate.textContent = `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()} · ${now.getFullYear()}`;
  greetingLine.textContent = getGreeting(h);
}

function startClock() {
  tickClock();
  const msUntilNext = 1000 - new Date().getMilliseconds();
  setTimeout(() => { tickClock(); setInterval(tickClock, 1000); }, msUntilNext);
}

/* ════════════════════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════════════════════ */

function executeSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  const urlPat = /^(https?:\/\/)|(www\.)|([\w-]+\.[a-z]{2,}(\/|$))/i;
  if (urlPat.test(query)) {
    window.location.href = query.startsWith('http') ? query : 'https://' + query;
  } else {
    window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
  }
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeSearch();
  if (e.key === 'Escape') searchInput.blur();
});
searchBtn.addEventListener('click', executeSearch);

window.addEventListener('load', () => setTimeout(() => searchInput.focus(), 350));

/* ════════════════════════════════════════════════════════════
   SETTINGS PANEL
════════════════════════════════════════════════════════════ */

function openSettings() {
  settingsPanel.classList.add('open');
  settingsBackdrop.classList.add('active');
  settingsBtn.classList.add('active');
  settingsPanel.setAttribute('aria-hidden', 'false');
  settingsBackdrop.setAttribute('aria-hidden', 'false');
  settingsClose.focus();
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsBackdrop.classList.remove('active');
  settingsBtn.classList.remove('active');
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsBackdrop.setAttribute('aria-hidden', 'true');
  settingsBtn.focus();
}

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.contains('open') ? closeSettings() : openSettings();
});
settingsClose.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsPanel.classList.contains('open')) closeSettings();
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    settingsPanel.classList.contains('open') ? closeSettings() : openSettings();
  }
});

/* ════════════════════════════════════════════════════════════
   APPLY UI SETTINGS
════════════════════════════════════════════════════════════ */

function applyBlur(active) {
  document.body.classList.toggle('blur-active', active);
}

function applyGrain(active) {
  grainOverlay.classList.toggle('hidden', !active);
}

function applyOverlay(pct) {
  document.documentElement.style.setProperty('--overlay-opacity', pct / 100);
}

function applySecondsBar(active) {
  secondsBar.classList.toggle('hidden', !active);
}

function applyAllSettings() {
  blurToggle.checked       = state.blurBg;
  grainToggle.checked      = state.showGrain;
  overlaySlider.value      = state.overlayPct;
  overlayValue.textContent = state.overlayPct + '%';
  format24Toggle.checked   = state.use24h;
  secondsBarToggle.checked = state.showSecondsBar;

  applyBlur(state.blurBg);
  applyGrain(state.showGrain);
  applyOverlay(state.overlayPct);
  applySecondsBar(state.showSecondsBar);
}

/* ════════════════════════════════════════════════════════════
   MEDIA BACKGROUND — RENDER FROM BLOB
   Detects whether the blob is video or image.
   Revokes prior object URL before creating a new one.
════════════════════════════════════════════════════════════ */

/**
 * Given a Blob and metadata, renders it as the background.
 * mediaType: 'video' | 'image'
 */
function renderMediaBlob(blob, name, mediaType) {
  // Revoke prior object URL to free memory
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }

  const url = URL.createObjectURL(blob);
  currentObjectURL = url;

  // Remove both media body classes
  document.body.classList.remove('media-video', 'media-image', 'no-media');

  if (mediaType === 'video') {
    // Reset image
    bgImage.removeAttribute('src');
    bgImage.style.opacity = '0';

    bgVideo.src = url;
    bgVideo.load();
    bgVideo.play().catch(() => {
      // Autoplay policy — play on first user interaction
      document.addEventListener('click', () => bgVideo.play(), { once: true });
      document.addEventListener('keydown', () => bgVideo.play(), { once: true });
    });
    document.body.classList.add('media-video');

    // Update badge
    mediaTypeBadge.style.display = '';
    mediaTypeBadge.className = 'media-badge badge-video';
    mediaTypeBadge.textContent = '▶ Video';

  } else {
    // Reset video
    bgVideo.pause();
    bgVideo.removeAttribute('src');
    bgVideo.load();

    bgImage.src = url;
    bgImage.onload = () => { bgImage.style.opacity = '1'; };
    document.body.classList.add('media-image');

    // Update badge
    mediaTypeBadge.style.display = '';
    mediaTypeBadge.className = 'media-badge badge-image';
    mediaTypeBadge.textContent = '🖼 Image';
  }

  // Status + remove button
  mediaStatus.textContent = name ? `✓ ${name}` : `✓ Background loaded`;
  mediaStatus.className   = 'video-status success';
  removeMediaRow.style.display = '';
}

/**
 * Determine 'video' or 'image' from a MIME type string.
 */
function mimeToMediaType(mimeType) {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

/* ════════════════════════════════════════════════════════════
   MEDIA UPLOAD
════════════════════════════════════════════════════════════ */

mediaFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const mediaType = mimeToMediaType(file.type);
  if (!mediaType) {
    mediaStatus.textContent = '⚠ Unsupported file type.';
    mediaStatus.className   = 'video-status error';
    return;
  }

  mediaStatus.textContent = '⏳ Saving to storage...';
  mediaStatus.className   = 'video-status';

  try {
    // Save the raw File blob to IndexedDB — no size limit, no base64
    await idbSaveMedia(file, file.name, mediaType);

    // Persist only lightweight metadata to chrome.storage
    savePrefs({ mediaName: file.name, mediaType });

    // Render immediately from the original File (no round-trip read needed)
    renderMediaBlob(file, file.name, mediaType);

  } catch (err) {
    console.error('[Lumina] IndexedDB save failed:', err);
    mediaStatus.textContent = `✕ Failed to save: ${err.message}`;
    mediaStatus.className   = 'video-status error';
  }

  // Reset so re-selecting same file triggers change
  mediaFileInput.value = '';
});

/* ════════════════════════════════════════════════════════════
   REMOVE MEDIA
════════════════════════════════════════════════════════════ */

async function clearMedia() {
  try {
    await idbClearMedia();
  } catch (err) {
    console.warn('[Lumina] IndexedDB clear error:', err);
  }

  // Revoke object URL
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }

  // Reset video element
  bgVideo.pause();
  bgVideo.removeAttribute('src');
  bgVideo.load();

  // Reset image element
  bgImage.removeAttribute('src');

  // Restore fallback gradient
  document.body.classList.remove('media-video', 'media-image');
  document.body.classList.add('no-media');

  // Clear badge
  mediaTypeBadge.style.display = 'none';
  mediaTypeBadge.className     = 'media-badge';

  mediaStatus.textContent = 'No background selected — using default gradient';
  mediaStatus.className   = 'video-status';
  removeMediaRow.style.display = 'none';

  savePrefs({ mediaName: null, mediaType: null });
}

removeMediaBtn.addEventListener('click', clearMedia);

/* ════════════════════════════════════════════════════════════
   SETTINGS TOGGLES
════════════════════════════════════════════════════════════ */

blurToggle.addEventListener('change', () => {
  applyBlur(blurToggle.checked);
  savePrefs({ blurBg: blurToggle.checked });
});

grainToggle.addEventListener('change', () => {
  applyGrain(grainToggle.checked);
  savePrefs({ showGrain: grainToggle.checked });
});

overlaySlider.addEventListener('input', () => {
  const val = parseInt(overlaySlider.value, 10);
  overlayValue.textContent = val + '%';
  applyOverlay(val);
});

overlaySlider.addEventListener('change', () => {
  savePrefs({ overlayPct: parseInt(overlaySlider.value, 10) });
});

format24Toggle.addEventListener('change', () => {
  state.use24h = format24Toggle.checked;
  savePrefs({ use24h: format24Toggle.checked });
  tickClock();
});

secondsBarToggle.addEventListener('change', () => {
  applySecondsBar(secondsBarToggle.checked);
  savePrefs({ showSecondsBar: secondsBarToggle.checked });
});

/* ════════════════════════════════════════════════════════════
   VIDEO ERROR FALLBACK
════════════════════════════════════════════════════════════ */

bgVideo.addEventListener('error', (e) => {
  // Only log if we actually had a src set
  if (bgVideo.src && bgVideo.src !== window.location.href && bgVideo.src !== location.origin + '/') {
    console.warn('[Lumina] Video playback error — code:', bgVideo.error?.code, e);
  }
});

/* ════════════════════════════════════════════════════════════
   INIT — Boot sequence
   1. Open IndexedDB (creates it if first run)
   2. Load preferences from chrome.storage
   3. Apply UI state
   4. Load media blob from IndexedDB and render
   5. Start clock
════════════════════════════════════════════════════════════ */

async function init() {
  // ── Step 1: Load UI preferences ──────────────────────────
  state = await loadPrefs();
  applyAllSettings();

  // ── Step 2: Restore media from IndexedDB ─────────────────
  let mediaRecord = null;
  try {
    mediaRecord = await idbLoadMedia();
  } catch (err) {
    console.warn('[Lumina] IndexedDB load failed:', err);
  }

  if (mediaRecord && mediaRecord.blob && mediaRecord.mediaType) {
    // Blob is intact — render it
    renderMediaBlob(mediaRecord.blob, mediaRecord.name, mediaRecord.mediaType);
  } else {
    // Nothing in IndexedDB — show gradient fallback
    document.body.classList.add('no-media');
    mediaTypeBadge.style.display = 'none';
    mediaStatus.textContent = 'No background selected — using default gradient';
    mediaStatus.className   = 'video-status';

    // Clean up stale metadata if blob was lost
    if (state.mediaName || state.mediaType) {
      savePrefs({ mediaName: null, mediaType: null });
    }
  }

  // ── Step 3: Start clock ───────────────────────────────────
  startClock();

  console.log('[Lumina] Booted ✓  |  IndexedDB storage active');
}

init();
