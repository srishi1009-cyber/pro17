"use strict";

/* ============================================================
   RISHI MUSIC — FULL ENGINE (merged + fixed + AI Voice DJ + Live AI Lyrics)
   ============================================================ */

/* 1. SERVICE WORKER */
if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function (err) {
            console.error("[Rishi Music] SW Registration Failed:", err);
        });
    });
}

/* 2. INDEXEDDB */
const DB_NAME = "RishiMusicDB_v4";
const DB_VERSION = 1;
const STORE_NAME = "audio_library";
let db = null;

function initDB() {
    return new Promise(function (resolve, reject) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function (e) {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = function () { db = request.result; resolve(db); };
        request.onerror = function () { reject(request.error); };
    });
}

function getAllTracksMetadata() {
    return new Promise(function (resolve) {
        if (!db) return resolve([]);
        const store = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME);
        const metadata = [];
        const req = store.openCursor();
        req.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
                metadata.push({ id: cursor.value.id, title: cursor.value.title, director: cursor.value.director });
                cursor.continue();
            } else resolve(metadata);
        };
        req.onerror = function () { resolve([]); };
    });
}

function getTrackAudioBlob(id) {
    return new Promise(function (resolve, reject) {
        if (!db) return reject(new Error("DB closed"));
        const req = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME).get(id);
        req.onsuccess = function () { resolve(req.result ? req.result.blob : null); };
        req.onerror = function () { reject(req.error); };
    });
}

function saveTracksBatch(trackList) {
    return new Promise(function (resolve, reject) {
        if (!db || !trackList.length) return resolve();
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        for (let i = 0; i < trackList.length; i++) store.put(trackList[i]);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e); };
    });
}

function removeTrackFromDB(id) {
    return new Promise(function (resolve) {
        if (!db) return resolve();
        const tx = db.transaction([STORE_NAME], "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = function () { resolve(); };
    });
}

/* 3. STATE */
let tracks = [];
let currentTrackIndex = -1;
let currentBlobUrl = null;
let playHistory = [];
let userManuallyPaused = false;
let isSwitchingSong = false;
let activeEditingTrackId = null;
let deferredPrompt = null;
let pendingImportFiles = [];
const BATCH_SIZE = 40;
let renderedCount = 0;
let filteredTrackIndices = [];
let wakeLock = null;

/* 4. DOM */
const audio = document.getElementById("audioEl");
const tracksContainer = document.getElementById("tracksContainer");
const searchInput = document.getElementById("searchInput");
const directorFilter = document.getElementById("directorFilter");
const importBtn = document.getElementById("importBtn");
const fileSelector = document.getElementById("fileSelector");
const mainPlayBtn = document.getElementById("mainPlayBtn");
const mainPlayIcon = document.getElementById("mainPlayIcon");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const progressBar = document.getElementById("progressBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const dockTitle = document.getElementById("dockTitle");
const dockSubtitle = document.getElementById("dockSubtitle");
const installBar = document.getElementById("installBar");
const installTriggerBtn = document.getElementById("installTriggerBtn");
const editModal = document.getElementById("editModal");
const editTitleInput = document.getElementById("editTitleInput");
const editDirectorInput = document.getElementById("editDirectorInput");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const saveEditBtn = document.getElementById("saveEditBtn");
const bulkDirectorModal = document.getElementById("bulkDirectorModal");
const bulkDirectorInput = document.getElementById("bulkDirectorInput");
const skipBulkDirectorBtn = document.getElementById("skipBulkDirectorBtn");
const saveBulkDirectorBtn = document.getElementById("saveBulkDirectorBtn");

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

/* 5. DAILY ROTATION */
function getTodayDateString() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function getDailyLog() {
    const today = getTodayDateString();
    try {
        const raw = localStorage.getItem("rishi_daily_plays_v4");
        let parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || parsed.date !== today || !Array.isArray(parsed.playedIds)) {
            parsed = { date: today, playedIds: [] };
            localStorage.setItem("rishi_daily_plays_v4", JSON.stringify(parsed));
        }
        return parsed;
    } catch (e) {
        return { date: today, playedIds: [] };
    }
}

function saveDailyLog(log) {
    try { localStorage.setItem("rishi_daily_plays_v4", JSON.stringify(log)); }
    catch (e) { console.warn("Storage error:", e); }
}

function markSongAsPlayed(songId) {
    const log = getDailyLog();
    if (!log.playedIds.includes(songId)) log.playedIds.push(songId);
    saveDailyLog(log);
    renderTrackList(false);
}

function getNextUnplayedIndex() {
    if (tracks.length === 0) return -1;
    const selectedDirector = directorFilter ? directorFilter.value : "ALL";
    const playedSet = new Set(getDailyLog().playedIds);
    const pool = [];
    for (let i = 0; i < tracks.length; i++) {
        if (selectedDirector === "ALL" || tracks[i].director === selectedDirector) pool.push(i);
    }
    if (!pool.length) return -1;
    const unplayed = pool.filter(function (idx) {
        return !playedSet.has(tracks[idx].id) && idx !== currentTrackIndex;
    });
    if (!unplayed.length) return -1;
    return unplayed[Math.floor(Math.random() * unplayed.length)];
}

/* 6. UNKILLABLE BACKGROUND ENGINE + AIRPODS / BOAT ROCKERZ MEDIA SESSION */
async function requestWakeLock() {
    try {
        if ("wakeLock" in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", function () { wakeLock = null; });
        }
    } catch (_) {}
}

function syncMediaPosition() {
    if (!("mediaSession" in navigator)) return;
    try {
        navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate || 1,
                position: Math.max(0, Math.min(audio.currentTime || 0, audio.duration))
            });
        }
    } catch (_) {}
}

function registerMediaHandlers() {
    if (!("mediaSession" in navigator)) return;
    const handlers = {
        play: function () { userManuallyPaused = false; playCurrentTrack(); },
        pause: function () { pauseCurrentTrack(); },
        stop: function () { pauseCurrentTrack(); },
        nexttrack: function () { userManuallyPaused = false; advanceToNextTrack(); },
        previoustrack: function () { userManuallyPaused = false; playPreviousTrack(); },
        seekto: function (e) {
            if (e.seekTime != null && Number.isFinite(e.seekTime)) {
                audio.currentTime = e.seekTime;
                syncMediaPosition();
            }
        }
    };
    Object.keys(handlers).forEach(function (action) {
        try { navigator.mediaSession.setActionHandler(action, handlers[action]); } catch (_) {}
    });
}

function updateMediaSession(track) {
    if (!("mediaSession" in navigator) || !track) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.director,
            album: "Rishi Music",
            artwork: [{ src: "./icon-512.png?v=3", sizes: "512x512", type: "image/png" }]
        });
        registerMediaHandlers();
        syncMediaPosition();
    } catch (e) { console.warn("MediaSession error:", e); }
}

/* 7. SMOOTH STUTTER-FREE PLAYBACK LOADER */
async function loadTrackSource(index) {
    if (index < 0 || index >= tracks.length) return false;
    currentTrackIndex = index;
    const track = tracks[currentTrackIndex];
    const blob = await getTrackAudioBlob(track.id);
    if (!blob) { console.error("Audio data missing for track:", track); return false; }

    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }

    currentBlobUrl = URL.createObjectURL(blob);
    audio.preload = "auto";
    audio.src = currentBlobUrl;
    audio.load();

    audio.playbackRate = Number(appSettings.speed) || 1;
    audio.volume = Math.max(0, Math.min(1, Number(appSettings.volume) / 100));
    dockTitle.textContent = track.title;
    dockSubtitle.textContent = track.director;
    currentTimeEl.textContent = "0:00";
    durationEl.textContent = "0:00";
    progressBar.value = 0;
    updateMediaSession(track);
    renderTrackList(false);
    return true;
}

async function playCurrentTrack() {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        const firstIdx = getNextUnplayedIndex();
        if (firstIdx === -1) {
            alert("All songs in this selection have been played today!");
            return;
        }
        await loadTrackSource(firstIdx);
    }
    const track = tracks[currentTrackIndex];
    if (!track) return;
    userManuallyPaused = false;
    try {
        await audio.play();
        setPlayIconState(true);
        syncMediaPosition();
        requestWakeLock();
        renderTrackList(false);
    } catch (error) {
        console.warn("Playback prevented or deferred:", error);
        setPlayIconState(false);
    }
}

function pauseCurrentTrack() {
    userManuallyPaused = true;
    audio.pause();
    setPlayIconState(false);
    syncMediaPosition();
    renderTrackList(false);
}

async function advanceToNextTrack() {
    if (isSwitchingSong || tracks.length === 0) return;
    isSwitchingSong = true;
    userManuallyPaused = false;
    if (currentTrackIndex !== -1) {
        playHistory.push(currentTrackIndex);
        if (playHistory.length > 50) playHistory.shift();
    }
    const nextIndex = getNextUnplayedIndex();
    if (nextIndex === -1) {
        pauseCurrentTrack();
        dockTitle.textContent = "Finished for today";
        dockSubtitle.textContent = "All songs played.";
        isSwitchingSong = false;
        return;
    }
    const loaded = await loadTrackSource(nextIndex);
    if (loaded) await playCurrentTrack();
    isSwitchingSong = false;
}

async function playPreviousTrack() {
    if (tracks.length === 0) return;
    userManuallyPaused = false;
    if (audio.currentTime > 3) { audio.currentTime = 0; await playCurrentTrack(); return; }
    if (playHistory.length > 0) {
        await loadTrackSource(playHistory.pop());
        await playCurrentTrack();
    } else {
        audio.currentTime = 0;
        await playCurrentTrack();
    }
}

/* 8. AUDIO EVENTS & FOCUS RECOVERY */
audio.addEventListener("ended", function () {
    if (userManuallyPaused || isSwitchingSong) return;
    const t = tracks[currentTrackIndex];
    if (t) markSongAsPlayed(t.id);
    advanceToNextTrack();
});

audio.addEventListener("error", function () {
    if (userManuallyPaused || isSwitchingSong) return;
    advanceToNextTrack();
});

function reclaimPlaybackFocus() {
    if (!userManuallyPaused && !audio.ended && !isSwitchingSong && currentTrackIndex >= 0) {
        if (audio.paused) {
            audio.play().then(function () {
                setPlayIconState(true);
                syncMediaPosition();
            }).catch(function () {});
        }
    }
}

audio.addEventListener("pause", function () {
    if (!userManuallyPaused && !audio.ended && !isSwitchingSong) {
        setTimeout(reclaimPlaybackFocus, 150);
    } else {
        syncMediaPosition();
    }
});

audio.addEventListener("loadedmetadata", syncMediaPosition);

audio.addEventListener("timeupdate", function () {
    if (!audio.duration) return;
    progressBar.value = (audio.currentTime / audio.duration) * 100;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent = formatTime(audio.duration);
});

progressBar.addEventListener("input", function () {
    if (audio.duration) {
        audio.currentTime = (Number(progressBar.value) / 100) * audio.duration;
        syncMediaPosition();
    }
});

setInterval(function () {
    if (!userManuallyPaused && currentTrackIndex >= 0) {
        reclaimPlaybackFocus();
        syncMediaPosition();
    }
}, 1000);

document.addEventListener("visibilitychange", function () {
    if (!userManuallyPaused && currentTrackIndex >= 0) {
        if (document.visibilityState === "visible") requestWakeLock();
        reclaimPlaybackFocus();
    }
});

function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
}

function setPlayIconState(isPlaying) {
    if (!mainPlayIcon) return;
    mainPlayIcon.innerHTML = isPlaying
        ? '<rect x="6" y="4" width="4" height="16" fill="#ffffff"></rect><rect x="14" y="4" width="4" height="16" fill="#ffffff"></rect>'
        : '<polygon points="6,4 20,12 6,20"></polygon>';
}

/* 9. VIRTUAL PAGINATION & UI RENDERING */
function computeFilteredList() {
    const query = String(searchInput.value || "").trim().toLowerCase();
    const filter = directorFilter.value || "ALL";
    filteredTrackIndices = [];
    for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const matchSearch = t.title.toLowerCase().includes(query) || t.director.toLowerCase().includes(query);
        const matchDirector = filter === "ALL" || t.director === filter;
        if (matchSearch && matchDirector) filteredTrackIndices.push(i);
    }
}

const PLAY_SVG = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';

function appendTrackCards(count) {
    const playedSet = new Set(getDailyLog().playedIds);
    const endIndex = Math.min(renderedCount + count, filteredTrackIndices.length);
    for (let i = renderedCount; i < endIndex; i++) {
        const idx = filteredTrackIndices[i];
        const track = tracks[idx];
        const isCurrent = idx === currentTrackIndex;
        const isPlaying = isCurrent && !audio.paused;
        const isPlayedToday = playedSet.has(track.id);
        const card = document.createElement("div");
        card.className = "track-card" + (isCurrent ? " active" : "") + (isPlayedToday ? " played-today" : "");
        card.innerHTML =
            '<div class="track-main"><span class="music-glyph">♬</span><div class="track-text">' +
            '<div class="track-name">' + esc(track.title) + '</div>' +
            '<div class="track-sub">' + esc(track.director) +
            (isPlayedToday ? '<span class="daily-status"> Played Today</span>' : "") + '</div></div></div>' +
            '<div class="track-actions">' +
            '<button class="edit-btn" data-action="edit" data-id="' + esc(track.id) + '">Edit</button>' +
            '<button class="delete-btn" data-action="delete" data-id="' + esc(track.id) + '">🗑</button>' +
            '<button class="card-play-btn" data-action="play" data-idx="' + idx + '">' + (isPlaying ? PAUSE_SVG : PLAY_SVG) + '</button></div>';
        tracksContainer.appendChild(card);
    }
    renderedCount = endIndex;
}

function renderTrackList(resetList) {
    if (resetList === undefined) resetList = true;
    if (!tracksContainer) return;
    if (resetList) {
        computeFilteredList();
        tracksContainer.innerHTML = "";
        renderedCount = 0;
    }
    if (tracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-state">Your library is empty.<br>Click <strong>+ Import Track</strong> above to add songs.</div>';
        return;
    }
    if (resetList) {
        appendTrackCards(BATCH_SIZE);
    } else {
        const playedSet = new Set(getDailyLog().playedIds);
        tracksContainer.querySelectorAll(".track-card").forEach(function (card, domIdx) {
            const trackIdx = filteredTrackIndices[domIdx];
            if (trackIdx === undefined) return;
            const track = tracks[trackIdx];
            const isCurrent = trackIdx === currentTrackIndex;
            card.className = "track-card" + (isCurrent ? " active" : "") + (playedSet.has(track.id) ? " played-today" : "");
            const playBtn = card.querySelector(".card-play-btn");
            if (playBtn) playBtn.innerHTML = (isCurrent && !audio.paused) ? PAUSE_SVG : PLAY_SVG;
        });
    }
}

window.addEventListener("scroll", function () {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        if (renderedCount < filteredTrackIndices.length) appendTrackCards(BATCH_SIZE);
    }
});

function updateDirectorDropdown() {
    const cur = directorFilter.value || "ALL";
    const dirs = Array.from(new Set(tracks.map(function (t) { return t.director; }))).filter(Boolean).sort();
    directorFilter.innerHTML = '<option value="ALL">ALL DIRECTORS</option>';
    dirs.forEach(function (d) {
        const opt = document.createElement("option");
        opt.value = d; opt.textContent = d;
        directorFilter.appendChild(opt);
    });
    directorFilter.value = dirs.indexOf(cur) >= 0 ? cur : "ALL";
}

/* 10. CARD ACTIONS */
tracksContainer.addEventListener("click", async function (e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === "play") {
        const idx = Number(btn.dataset.idx);
        if (idx === currentTrackIndex) {
            if (audio.paused) await playCurrentTrack(); else pauseCurrentTrack();
        } else {
            await loadTrackSource(idx);
            await playCurrentTrack();
        }
    } else if (action === "edit") {
        const track = tracks.find(function (t) { return t.id === btn.dataset.id; });
        if (!track) return;
        activeEditingTrackId = track.id;
        editTitleInput.value = track.title;
        editDirectorInput.value = track.director;
        editModal.classList.add("open");
    } else if (action === "delete") {
        const track = tracks.find(function (t) { return t.id === btn.dataset.id; });
        if (!track || !confirm('Delete "' + track.title + '"?')) return;
        await removeTrackFromDB(track.id);
        const idx = tracks.indexOf(track);
        if (idx === currentTrackIndex) {
            pauseCurrentTrack();
            currentTrackIndex = -1;
            dockTitle.textContent = "No track playing";
            dockSubtitle.textContent = "Select a song from your library";
        } else if (idx < currentTrackIndex) {
            currentTrackIndex--;
        }
        tracks.splice(idx, 1);
        updateDirectorDropdown();
        renderTrackList(true);
    }
});

cancelEditBtn.addEventListener("click", function () {
    editModal.classList.remove("open");
    activeEditingTrackId = null;
});

saveEditBtn.addEventListener("click", async function () {
    if (!activeEditingTrackId) return;
    const track = tracks.find(function (t) { return t.id === activeEditingTrackId; });
    if (!track) return;
    const t = editTitleInput.value.trim();
    const d = editDirectorInput.value.trim();
    if (!t) { alert("Title cannot be empty."); return; }
    track.title = t;
    track.director = d || "UNKNOWN DIRECTOR";
    const blob = await getTrackAudioBlob(track.id);
    await saveTracksBatch([{ id: track.id, title: track.title, director: track.director, blob: blob }]);
    if (tracks[currentTrackIndex] && tracks[currentTrackIndex].id === track.id) {
        dockTitle.textContent = track.title;
        dockSubtitle.textContent = track.director;
        updateMediaSession(track);
    }
    editModal.classList.remove("open");
    activeEditingTrackId = null;
    updateDirectorDropdown();
    renderTrackList(true);
});

/* 11. BULK IMPORT */
importBtn.addEventListener("click", function () {
    fileSelector.value = "";
    fileSelector.click();
});

fileSelector.addEventListener("change", function (e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    pendingImportFiles = files;
    if (bulkDirectorModal) {
        bulkDirectorInput.value = "";
        bulkDirectorModal.classList.add("open");
    } else {
        const entered = prompt("Enter Music Director for selected song(s):", "UNKNOWN DIRECTOR");
        processImportQueue(entered && entered.trim() ? entered.trim() : "UNKNOWN DIRECTOR");
    }
});

if (skipBulkDirectorBtn) {
    skipBulkDirectorBtn.addEventListener("click", function () {
        bulkDirectorModal.classList.remove("open");
        processImportQueue("UNKNOWN DIRECTOR");
    });
}

if (saveBulkDirectorBtn) {
    saveBulkDirectorBtn.addEventListener("click", function () {
        const name = bulkDirectorInput.value.trim() || "UNKNOWN DIRECTOR";
        bulkDirectorModal.classList.remove("open");
        processImportQueue(name);
    });
}

async function processImportQueue(musicDirector) {
    if (!pendingImportFiles.length) return;
    importBtn.disabled = true;
    const total = pendingImportFiles.length;
    let savedCount = 0;
    const CHUNK_SIZE = 15;
    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = pendingImportFiles.slice(i, i + CHUNK_SIZE);
        const batchRecords = [];
        for (let j = 0; j < chunk.length; j++) {
            const f = chunk[j];
            const rec = {
                id: "track_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9),
                title: f.name.replace(/\.[^.]+$/, ""),
                director: musicDirector,
                blob: f
            };
            batchRecords.push(rec);
            tracks.push({ id: rec.id, title: rec.title, director: rec.director });
            savedCount++;
        }
        importBtn.textContent = "Saving (" + savedCount + "/" + total + ")...";
        await saveTracksBatch(batchRecords);
        await new Promise(function (r) { setTimeout(r, 40); });
    }
    pendingImportFiles = [];
    importBtn.disabled = false;
    importBtn.textContent = "+ Import Track";
    fileSelector.value = "";
    updateDirectorDropdown();
    renderTrackList(true);
}

/* 12. BOTTOM CONTROLS */
mainPlayBtn.addEventListener("click", async function () {
    if (audio.paused) await playCurrentTrack(); else pauseCurrentTrack();
});
prevBtn.addEventListener("click", playPreviousTrack);
nextBtn.addEventListener("click", advanceToNextTrack);
searchInput.addEventListener("input", function () { renderTrackList(true); });
directorFilter.addEventListener("change", function () { renderTrackList(true); });

/* 13. PWA INSTALL */
function isAppInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.matchMedia("(display-mode: minimal-ui)").matches ||
           window.matchMedia("(display-mode: fullscreen)").matches ||
           window.navigator.standalone === true ||
           localStorage.getItem("rishi_pwa_installed") === "true";
}

function hideInstallBar() {
    if (installBar) installBar.style.display = "none";
}

if (isAppInstalled()) {
    hideInstallBar();
}

window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    if (isAppInstalled()) {
        hideInstallBar();
        return;
    }
    deferredPrompt = e;
    if (installBar) installBar.style.display = "flex";
});

window.addEventListener("appinstalled", function () {
    localStorage.setItem("rishi_pwa_installed", "true");
    hideInstallBar();
    deferredPrompt = null;
});

if (installTriggerBtn) {
    installTriggerBtn.addEventListener("click", async function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const res = await deferredPrompt.userChoice;
        if (res.outcome === "accepted") {
            localStorage.setItem("rishi_pwa_installed", "true");
            hideInstallBar();
        }
        deferredPrompt = null;
    });
}

/* 14. SETTINGS */
const SETTINGS_KEY = "rishi_settings_v1";
const DEFAULT_SETTINGS = { theme: "dark", accent: "#00d2ff", speed: 1, volume: 100 };
let appSettings = loadAppSettings();

function loadAppSettings() {
    try {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
    } catch (error) { return Object.assign({}, DEFAULT_SETTINGS); }
}

function saveAppSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings)); }
    catch (error) { console.warn("Could not save settings:", error); }
}

function hexToRgb(hex) {
    const clean = String(hex).replace("#", "");
    const full = clean.length === 3 ? clean.split("").map(function (c) { return c + c; }).join("") : clean;
    const n = parseInt(full, 16);
    if (!Number.isFinite(n)) return "0,210,255";
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
}

function applyAppSettings() {
    document.body.dataset.theme = appSettings.theme === "light" ? "light" : "dark";
    document.documentElement.style.setProperty("--accent", appSettings.accent);
    document.documentElement.style.setProperty("--accent-rgb", hexToRgb(appSettings.accent));
    audio.playbackRate = Number(appSettings.speed) || 1;
    audio.volume = Math.max(0, Math.min(1, Number(appSettings.volume) / 100));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = appSettings.theme === "light" ? "#f0f7ff" : "#030814";
}

const settingsModal = document.getElementById("settingsModal");
const settingsBtn = document.getElementById("settingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const doneSettingsBtn = document.getElementById("doneSettingsBtn");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const themeSelect = document.getElementById("themeSelect");
const accentColor = document.getElementById("accentColor");
const accentHex = document.getElementById("accentHex");
const playbackSpeed = document.getElementById("playbackSpeed");
const defaultVolume = document.getElementById("defaultVolume");
const volumeValue = document.getElementById("volumeValue");
const settingsTrackCount = document.getElementById("settingsTrackCount");
const storageUsage = document.getElementById("storageUsage");

function openSettings() {
    if (!settingsModal) return;
    themeSelect.value = appSettings.theme;
    accentColor.value = appSettings.accent;
    accentHex.value = appSettings.accent.toUpperCase();
    playbackSpeed.value = String(appSettings.speed);
    defaultVolume.value = String(appSettings.volume);
    volumeValue.textContent = appSettings.volume + "%";
    if (settingsTrackCount) settingsTrackCount.textContent = String(tracks.length);
    settingsModal.classList.add("open");
    settingsModal.setAttribute("aria-hidden", "false");
    updateStorageEstimate();
}

function closeSettings() {
    if (!settingsModal) return;
    settingsModal.classList.remove("open");
    settingsModal.setAttribute("aria-hidden", "true");
}

function updateSetting(changes) {
    appSettings = Object.assign({}, appSettings, changes);
    saveAppSettings();
    applyAppSettings();
}

function updateStorageEstimate() {
    if (!storageUsage) return;
    if (!navigator.storage || !navigator.storage.estimate) {
        storageUsage.textContent = "Not available in this browser";
        return;
    }
    navigator.storage.estimate().then(function (info) {
        const mb = Number(info.usage || 0) / (1024 * 1024);
        storageUsage.textContent = mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB";
    }).catch(function () { storageUsage.textContent = "Unavailable"; });
}

if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettings);
if (doneSettingsBtn) doneSettingsBtn.addEventListener("click", closeSettings);
if (settingsModal) settingsModal.addEventListener("click", function (e) { if (e.target === settingsModal) closeSettings(); });
if (themeSelect) themeSelect.addEventListener("change", function () { updateSetting({ theme: themeSelect.value }); });

if (accentColor) accentColor.addEventListener("input", function () {
    accentHex.value = accentColor.value.toUpperCase();
    updateSetting({ accent: accentColor.value });
});

if (accentHex) accentHex.addEventListener("change", function () {
    const value = accentHex.value.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        const normalized = value.length === 4
            ? "#" + value.slice(1).split("").map(function (c) { return c + c; }).join("")
            : value;
        accentColor.value = normalized;
        accentHex.value = normalized.toUpperCase();
        updateSetting({ accent: normalized });
    } else {
        accentHex.value = appSettings.accent.toUpperCase();
        alert("Enter a valid HEX colour, such as #00D2FF.");
    }
});

if (playbackSpeed) playbackSpeed.addEventListener("change", function () {
    updateSetting({ speed: Number(playbackSpeed.value) });
});

if (defaultVolume) defaultVolume.addEventListener("input", function () {
    const v = Number(defaultVolume.value);
    volumeValue.textContent = v + "%";
    updateSetting({ volume: v });
});

if (resetSettingsBtn) resetSettingsBtn.addEventListener("click", function () {
    appSettings = Object.assign({}, DEFAULT_SETTINGS);
    saveAppSettings();
    applyAppSettings();
    openSettings();
});

applyAppSettings();

/* 15. INITIALIZE */
initDB().then(async function () {
    tracks = await getAllTracksMetadata();
    updateDirectorDropdown();
    renderTrackList(true);
    if (window.rishiAfterInit) window.rishiAfterInit();
}).catch(function (error) {
    console.error("Rishi Music database error:", error);
    alert("Unable to open your music library.");
});

/* 16. PRO FEATURES */
(function RishiProFeatures() {
    const FEATURE_KEY = "rishi_music_features_v1";
    const $ = function (id) { return document.getElementById(id); };
    const safeParse = function (v, fb) { try { return v ? JSON.parse(v) : fb; } catch (_) { return fb; } };

    const featureData = Object.assign({
        tracks: {}, queue: [], history: [], totalSeconds: 0,
        crossfade: false, effects: false, reverb: 0, width: 100,
        bass: 0, mid: 0, treble: 0, frequency: 1000,
        aiDjEnabled: true, liveAiLyrics: false
    }, safeParse(localStorage.getItem(FEATURE_KEY), {}));
    featureData.tracks = featureData.tracks || {};
    featureData.queue = featureData.queue || [];
    featureData.history = featureData.history || [];
    if (!featureData.width) featureData.width = 100;

    function saveFeatureData() {
        try { localStorage.setItem(FEATURE_KEY, JSON.stringify(featureData)); }
        catch (e) { console.warn("Feature storage full:", e); }
    }

    function metaFor(id) {
        if (!featureData.tracks[id]) {
            featureData.tracks[id] = { lyrics: "", art: "", favorite: false, plays: 0, lastPlayed: 0, folder: "" };
        }
        return featureData.tracks[id];
    }

    function currentTrack() { return currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null; }
    
    updateDashboard();
})();
