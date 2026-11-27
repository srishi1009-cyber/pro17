"use strict";

/* ============================================================
   RISHI VOICE DJ — THEME-ACCENTED BUTTON & TRUE CONVERSATIONAL MOOD FLOW
   Connects directly to index.html (#sm, #dock, window.RishiBridge)
   ============================================================ */
(function initRishiVoiceDJ() {
  const $ = id => document.getElementById(id);
  const LS = localStorage;

  const jget = (k, d) => {
    try { return JSON.parse(LS.getItem(k)) || d; } catch (_) { return d; }
  };
  const jset = (k, v) => {
    try { LS.setItem(k, JSON.stringify(v)); } catch (_) {}
  };

  let prefs = {
    aiDj: true,
    voiceGender: "female",
    voiceLang: "en-US",
    liveAiLyrics: true,
    lyricsLang: "ta-IN",
    ...jget("rishi_voice_prefs_v6", {})
  };
  const savePrefs = () => jset("rishi_voice_prefs_v6", prefs);

  const au = $("au");
  if (!au) return;

  /* ------------------------------------------------------------
   1. TAMIL -> ENGLISH PHONETIC TRANSLITERATION & CLEANERS
     ------------------------------------------------------------ */
  const TAMIL_VOWELS = {
    "அ": "a", "ஆ": "aa", "இ": "i", "ஈ": "ee", "உ": "u", "ஊ": "oo",
    "எ": "e", "ஏ": "ae", "ஐ": "ai", "ஒ": "o", "ஓ": "oo", "ஔ": "au"
  };
  const TAMIL_CONSONANTS = {
    "க": "k", "ங": "ng", "ச": "s", "ஞ": "nj", "ட": "t", "ண": "n",
    "த": "th", "ந": "n", "ப": "p", "ம": "m", "ய": "y", "ர": "r",
    "ல": "l", "வ": "v", "ழ": "zh", "ள": "l", "ற": "r", "ன": "n",
    "ஜ": "j", "ஷ": "sh", "ஸ": "s", "ஹ": "h", "க்ஷ": "ksh"
  };
  const TAMIL_MARKS = {
    "ா": "aa", "ி": "i", "ீ": "ee", "ு": "u", "ூ": "oo",
    "ெ": "e", "ே": "ae", "ை": "ai", "ொ": "o", "ோ": "oo", "ௌ": "au",
    "்": ""
  };

  function tamilToEnglishPhonetic(input) {
    const str = String(input || "");
    if (!/[\u0B80-\u0BFF]/.test(str)) return str;

    let out = "";
    const chars = Array.from(str);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const next = chars[i + 1];
      if (TAMIL_VOWELS[ch]) {
        out += TAMIL_VOWELS[ch];
      } else if (TAMIL_CONSONANTS[ch]) {
        let base = TAMIL_CONSONANTS[ch];
        if (i > 0 && chars[i - 1] !== " ") {
          if (ch === "ப") base = "b";
          if (ch === "ட") base = "d";
          if (ch === "க") base = "g";
          if (ch === "ச") base = "ch";
        }
        if (next && Object.prototype.hasOwnProperty.call(TAMIL_MARKS, next)) {
          out += base + TAMIL_MARKS[next];
          i++;
        } else {
          out += base + "a";
        }
      } else {
        out += ch;
      }
    }
    return out;
  }

  function cleanDisplay(s) {
    return String(s || "")
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/[\[\(\{].*?[\]\)\}]/g, " ")
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function skeleton(s) {
    return tamilToEnglishPhonetic(s)
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/[\[\(\{].*?[\]\)\}]/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .replace(/aa+/g, "a")
      .replace(/ee+|ii+/g, "i")
      .replace(/oo+|uu+/g, "u")
      .replace(/th/g, "t")
      .replace(/sh|zh/g, "s")
      .replace(/b/g, "p")
      .replace(/d/g, "t")
      .replace(/g/g, "k")
      .replace(/v/g, "w")
      .replace(/(.)\1+/g, "$1");
  }

  /* ------------------------------------------------------------
   2. DYNAMIC THEME-ACCENTED VOICE DJ WIDGET & ROUND FAB BUTTON
      The mic symbol is an inline SVG drawn with currentColor, so it
      always follows the active theme's accent colour (an emoji can't).
     ------------------------------------------------------------ */
  const style = document.createElement("style");
  style.textContent = `
    #rvdj-widget {
      position: fixed;
      right: 14px;
      bottom: calc(140px + env(safe-area-inset-bottom));
      z-index: 9;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: calc(100vw - 28px);
      pointer-events: none;
    }
    body.compact #rvdj-widget {
      bottom: calc(84px + env(safe-area-inset-bottom));
    }
    #rvdj-card {
      pointer-events: auto;
      display: none;
      flex-direction: column;
      gap: 4px;
      min-width: 215px;
      max-width: 290px;
      padding: 11px 14px;
      border-radius: 18px;
      background: linear-gradient(145deg, var(--card-light), var(--card));
      border: 1px solid rgba(var(--accent-rgb), 0.5);
      box-shadow: 0 10px 30px var(--shadow), 0 0 22px rgba(var(--accent-rgb), 0.35);
      color: var(--text);
      font-size: 12px;
    }
    #rvdj-card.open { display: flex; }
    .rvdj-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: .6px;
      text-transform: uppercase;
      color: var(--accent-light);
    }
    .rvdj-lang-pill {
      border: 1px solid rgba(var(--accent-rgb), 0.5);
      background: rgba(var(--accent-rgb), 0.18);
      color: var(--accent-light);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
    }
    #rvdj-heard { color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
    #rvdj-reply { color: var(--text); font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
    #rvdj-fab {
      pointer-events: auto;
      width: 54px;
      height: 54px;
      border-radius: 50%;
      border: 2px solid rgba(var(--accent-rgb), 0.85);
      background: linear-gradient(145deg, var(--card-light), var(--card));
      color: var(--accent-light);
      display: grid;
      place-items: center;
      cursor: pointer;
      flex: none;
      padding: 0;
      box-shadow: 0 6px 20px rgba(var(--accent-rgb), 0.45), inset 0 0 12px rgba(var(--accent-rgb), 0.25);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    #rvdj-fab svg {
      width: 26px;
      height: 26px;
      display: block;
      filter: drop-shadow(0 0 5px rgba(var(--accent-rgb), 0.85));
    }
    #rvdj-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 28px rgba(var(--accent-rgb), 0.7), inset 0 0 14px rgba(var(--accent-rgb), 0.35);
    }
    #rvdj-fab:focus-visible {
      outline: 2px solid var(--accent-light);
      outline-offset: 3px;
    }
    #rvdj-widget.listening #rvdj-fab {
      animation: rvdjGlow 1.1s infinite;
    }
    @keyframes rvdjGlow {
      0%   { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.8), 0 0 24px rgba(var(--accent-rgb), 0.9); }
      70%  { box-shadow: 0 0 0 16px rgba(var(--accent-rgb), 0), 0 0 32px rgba(var(--accent-rgb), 1); }
      100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0), 0 0 24px rgba(var(--accent-rgb), 0.9); }
    }
    @media (prefers-reduced-motion: reduce) {
      #rvdj-widget.listening #rvdj-fab { animation: none; }
    }
  `;
  document.head.appendChild(style);

  const MIC_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3"></rect>
      <path d="M5 11a7 7 0 0 0 14 0"></path>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="8" y1="22" x2="16" y2="22"></line>
    </svg>`;

  const widget = document.createElement("div");
  widget.id = "rvdj-widget";
  widget.innerHTML = `
    <div id="rvdj-card">
      <div class="rvdj-head">
        <span>✦ Rishi Voice DJ</span>
        <button type="button" class="rvdj-lang-pill" id="rvdj-lang-toggle">
          ${prefs.voiceLang === "ta-IN" ? "தமிழ் / EN" : "EN / தமிழ்"}
        </button>
      </div>
      <div id="rvdj-heard">Tap mic &amp; speak</div>
      <div id="rvdj-reply">Try: "Play a song" or a song name</div>
    </div>
    <button type="button" id="rvdj-fab" title="Rishi Voice DJ" aria-label="Rishi Voice DJ">${MIC_SVG}</button>
  `;
  document.body.appendChild(widget);

  let hideCardTimer = null;
  function showCard(ms = 0) {
    $("rvdj-card").classList.add("open");
    clearTimeout(hideCardTimer);
    if (ms > 0) {
      hideCardTimer = setTimeout(() => {
        if (!widget.classList.contains("listening")) $("rvdj-card").classList.remove("open");
      }, ms);
    }
  }

  /* ------------------------------------------------------------
   3. VOICE SYNTHESIS (LADIES / MALE)
     ------------------------------------------------------------ */
  let cachedVoices = [];
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    const v = window.speechSynthesis.getVoices();
    if (v && v.length) cachedVoices = v;
  }
  loadVoices();
  if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = loadVoices;

  function pickSystemVoice(lang, gender) {
    loadVoices();
    if (!cachedVoices.length) return null;
    const isTa = lang.toLowerCase().startsWith("ta");
    const pool = cachedVoices.filter(v =>
      isTa ? v.lang.toLowerCase().includes("ta") : v.lang.toLowerCase().startsWith("en")
    );
    const list = pool.length ? pool : cachedVoices;

    const femaleKeys = ["female", "woman", "girl", "zira", "samantha", "victoria", "heera", "kalpana", "shruti", "veena", "aria", "jenny"];
    const maleKeys = ["male", "man", "boy", "david", "mark", "ravi", "hemant", "daniel", "alex", "rishi"];
    const keys = gender === "male" ? maleKeys : femaleKeys;

    const match = list.find(v => keys.some(k => v.name.toLowerCase().includes(k)));
    if (match) return match;
    if (list.length > 1) return gender === "male" ? list[list.length - 1] : list[0];
    return list[0];
  }

  function speakRishi(text, onDone) {
    $("rvdj-reply").textContent = text;
    if ($("aiDjStatus")) $("aiDjStatus").textContent = text;
    showCard();

    if (!("speechSynthesis" in window)) {
      if (onDone) onDone();
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (_) {}

    const utter = new SpeechSynthesisUtterance(text);
    const isTamilText = /[\u0B80-\u0BFF]/.test(text);
    const lang = isTamilText ? "ta-IN" : "en-US";
    utter.lang = lang;

    const v = pickSystemVoice(lang, prefs.voiceGender);
    if (v) {
      utter.voice = v;
      utter.lang = v.lang;
    }

    utter.pitch = prefs.voiceGender === "male" ? 0.62 : 1.42;
    utter.rate = prefs.voiceGender === "male" ? 0.95 : 1.04;
    utter.volume = 1.0;

    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        if (onDone) onDone();
      }
    };
    utter.onend = finish;
    utter.onerror = finish;
    setTimeout(finish, Math.max(2000, text.length * 100));
    window.speechSynthesis.speak(utter);
  }

  /* ------------------------------------------------------------
   4. AUTOMATIC SYNCED LYRICS
     ------------------------------------------------------------ */
  const fetchedIds = new Set();
  function setLyricsStatus(msg) {
    if ($("liveAiLyricsStatus")) $("liveAiLyricsStatus").textContent = msg;
  }

  async function autoFetchLyrics(track) {
    if (!prefs.liveAiLyrics || !track || !window.RishiBridge) return;
    const existing = window.RishiBridge.getLyricsForTrack(track.id);
    if (existing && existing.trim()) {
      setLyricsStatus("♪ Synced lyrics active");
      if ($("liveLyricBar")) $("liveLyricBar").style.display = "block";
      return;
    }
    if (fetchedIds.has(track.id)) return;
    fetchedIds.add(track.id);

    const titleClean = cleanDisplay(track.title);
    const artistClean = track.director && track.director !== "UNKNOWN DIRECTOR" ? cleanDisplay(track.director) : "";

    try {
      const q = encodeURIComponent(`${titleClean} ${artistClean}`.trim());
      const res = await fetch(`https://lrclib.net/api/search?q=${q}`);
      if (res.ok) {
        const items = await res.json();
        const best = Array.isArray(items) ? (items.find(x => x.syncedLyrics) || items.find(x => x.plainLyrics)) : null;
        if (best && (best.syncedLyrics || best.plainLyrics)) {
          window.RishiBridge.setFullLyrics(track.id, best.syncedLyrics || best.plainLyrics);
          setLyricsStatus("♪ Synced lyrics loaded");
          if ($("liveLyricBar")) $("liveLyricBar").style.display = "block";
        }
      }
    } catch (_) {}
  }

  /* ------------------------------------------------------------
   5. CONVERSATIONAL MOOD & SMART MATCHING ENGINE
      "play a song" / "play song" / "play some song"
          -> asks "What mood are you in?" -> plays a song for that mood
      any mood (even one not in the list)
          -> plays a random song
      a song / movie / director name
          -> plays it directly, no questions asked
     ------------------------------------------------------------ */
  let waitingForMood = false;

  const MOOD_DICTIONARY = {
    happy: ["happy", "joy", "dance", "kuthu", "fun", "upbeat", "festive", "santhosham", "மகிழ்ச்சி", "குத்து"],
    sad: ["sad", "soup", "breakup", "pain", "sogam", "melancholy", "crying", "சோகம்", "வலி"],
    romantic: ["love", "romance", "romantic", "kadhal", "melody", "heart", "duet", "cute", "காதல்", "மெலடி"],
    chill: ["chill", "relax", "sleep", "night", "calm", "peaceful", "lofi", "அமைதி", "இரவு"],
    mass: ["mass", "action", "hero", "energy", "beats", "peppy", "fire", "மாஸ்", "அடிதடி"]
  };

  // lower-case, drop punctuation the recogniser adds ("Play a song." -> "play a song")
  const norm = s => String(s || "")
    .toLowerCase()
    .replace(/[.,!?;:"“”।]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const WAKE_RE = /^(hey\s+rishi|ok\s+rishi|okay\s+rishi|rishi|ஹே\s+ரிஷி|ரிஷி)(\s+|$)/i;
  const stripWake = s => norm(s).replace(WAKE_RE, "").trim();

  // Words that can appear in a "just play something" request. If nothing
  // else is left after removing them, the request has no song name in it.
  const GENERIC_FILLER = /\b(please|can|could|you|will|would|play|put|on|start|some|any|a|an|one|the|song|songs|music|track|tracks|something|anything|me|for|paattu|paadal|podu|hey|ok|okay|rishi)\b|பாட்டு|பாடல்கள்|பாடல்|போடு|ஒரு|இசை|ரிஷி|ஹே/gi;

  function isGenericPlayRequest(text) {
    const t = stripWake(text);
    if (!t) return false;
    if (!/(play|put on|start|song|music|paattu|paadal|podu|பாட்டு|பாடல்|போடு|இசை)/i.test(t)) return false;
    return t.replace(GENERIC_FILLER, " ").replace(/\s+/g, "") === "";
  }

  function detectMood(text) {
    const t = norm(text);
    for (const [mood, keywords] of Object.entries(MOOD_DICTIONARY)) {
      if (keywords.some(k => t.includes(k))) return mood;
    }
    return null;
  }

  // Tracks tagged with the mood (by title/director). If none are, use the
  // whole library so the user always gets a song.
  function moodPool(mood, list) {
    const all = list.map((_, i) => i);
    if (!mood) return all;
    const kws = MOOD_DICTIONARY[mood];
    const tagged = all.filter(i => {
      const combo = `${list[i].title || ""} ${list[i].director || ""}`.toLowerCase();
      return kws.some(k => combo.includes(k));
    });
    return tagged.length ? tagged : all;
  }

  function pickRandom(pool, list) {
    const bridge = window.RishiBridge;
    const cur = bridge && bridge.getCurrentTrack ? bridge.getCurrentTrack() : null;
    // avoid repeating the song that is already loaded when there is a choice
    const fresh = cur ? pool.filter(i => list[i].id !== cur.id) : pool;
    const src = fresh.length ? fresh : pool;
    return src[Math.floor(Math.random() * src.length)];
  }

  // Score tracks against a spoken song / movie / director name.
  function scoreTracksByName(queryRaw, list) {
    const cleaned = stripWake(queryRaw)
      .replace(/\b(play|songs?|music|tracks?|by|from|of|the|my|please|podu|paattu|paadal)\b|பாட்டு|பாடல்கள்|பாடல்|போடு/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return [];

    const phonetic = tamilToEnglishPhonetic(cleaned);
    const qSkel = skeleton(phonetic);
    const words = phonetic.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length >= 2);

    const scored = [];
    list.forEach((track, idx) => {
      const tSkel = skeleton(track.title);
      const dSkel = skeleton(track.director);
      const tLow = cleanDisplay(track.title).toLowerCase();
      const dLow = cleanDisplay(track.director).toLowerCase();
      let score = 0;

      if (qSkel && tSkel === qSkel) score += 150;
      else if (qSkel && tSkel.includes(qSkel) && qSkel.length >= 3) score += 100;
      else if (tSkel && qSkel.includes(tSkel) && tSkel.length >= 3) score += 90;
      if (qSkel && dSkel && (dSkel.includes(qSkel) || qSkel.includes(dSkel)) && qSkel.length >= 3) score += 95;

      words.forEach(w => {
        const ws = skeleton(w);
        if (ws.length >= 3 && tSkel.includes(ws)) score += 30;
        if (ws.length >= 3 && dSkel.includes(ws)) score += 35;
        if (tLow.includes(w)) score += 25;
        if (dLow.includes(w)) score += 30;
      });

      if (score >= 25) scored.push({ idx, score });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // Best match across all speech-recognition alternatives.
  function bestNameMatch(transcripts, list) {
    let best = null;
    for (const alt of transcripts) {
      const top = scoreTracksByName(alt, list)[0];
      if (top && (!best || top.score > best.score)) best = top;
    }
    return best;
  }

  async function executeVoiceCommand(transcripts) {
    const bridge = window.RishiBridge;
    const list = (bridge && bridge.getTracks()) || [];
    const isTa = prefs.voiceLang === "ta-IN";
    const alts = transcripts.map(stripWake).filter(Boolean);
    const cmd = alts[0] || "";

    const playAt = (index, message) => {
      speakRishi(message, async () => {
        if (bridge) await bridge.playIndex(index);
      });
      showCard(5000);
    };

    // 1. PLAYER CONTROLS (always available, even mid-conversation)
    if (/(pause|stop\s+music|stop\s+song|நிறுத்து)/.test(cmd)) {
      waitingForMood = false;
      au.pause();
      speakRishi(isTa ? "இசை நிறுத்தப்பட்டது." : "Music paused.");
      showCard(4000);
      return;
    }
    const wantsResume =
      /^(resume|continue|தொடர்)$/.test(cmd) ||
      (/^play\s+music$/.test(cmd) && au.paused && au.currentSrc);
    if (wantsResume) {
      waitingForMood = false;
      if ($("play")) $("play").click();
      speakRishi(isTa ? "பாடல் தொடர்கிறது." : "Resuming music.");
      showCard(4000);
      return;
    }
    if (/(next|skip|அடுத்த)/.test(cmd)) {
      waitingForMood = false;
      if ($("next")) $("next").click();
      speakRishi(isTa ? "அடுத்த பாடல் ஒலிக்கிறது." : "Playing next song.");
      showCard(4000);
      return;
    }
    if (/(previous|prev|back|முந்தைய)/.test(cmd)) {
      waitingForMood = false;
      if ($("prev")) $("prev").click();
      speakRishi(isTa ? "முந்தைய பாடல்." : "Playing previous song.");
      showCard(4000);
      return;
    }

    if (!list.length) {
      waitingForMood = false;
      speakRishi("Your library is empty. Please import songs first.");
      showCard(4500);
      return;
    }

    // 2. WE JUST ASKED "WHAT MOOD?" -> whatever they said is the mood
    if (waitingForMood) {
      waitingForMood = false;

      // if they answered with an exact song name instead, honour that
      const named = bestNameMatch(alts, list);
      if (named && named.score >= 100) {
        playAt(named.idx, `Playing ${cleanDisplay(list[named.idx].title)}`);
        return;
      }

      const mood = alts.map(detectMood).find(Boolean) || null;
      const pick = pickRandom(moodPool(mood, list), list);
      playAt(pick, mood ? `Playing a ${mood} song for you!` : "Here's a random song for your mood!");
      return;
    }

    // 3. "PLAY A SONG" / "PLAY SONG" / "PLAY SOME SONG" -> ASK THE MOOD
    if (alts.some(isGenericPlayRequest)) {
      waitingForMood = true;
      speakRishi(
        isTa ? "நிச்சயமாக! உங்கள் மனநிலை என்ன? மகிழ்ச்சி, சோகம், காதல், அமைதி, அல்லது மாஸ்?"
             : "Sure! What mood are you in? Happy, sad, romantic, chill, or mass?",
        () => setTimeout(startListening, 600)
      );
      showCard(6000);
      return;
    }

    // 4. A SONG / MOVIE / DIRECTOR NAME -> PLAY IT DIRECTLY
    const named = bestNameMatch(alts, list);
    if (named && named.score >= 60) {
      playAt(named.idx, `Playing ${cleanDisplay(list[named.idx].title)}`);
      return;
    }

    // 5. A MOOD WORD IN A FULL REQUEST ("play happy songs")
    const mood = alts.map(detectMood).find(Boolean) || null;
    if (mood) {
      const pick = pickRandom(moodPool(mood, list), list);
      playAt(pick, `Playing a ${mood} song for you!`);
      return;
    }

    // 6. WEAK NAME MATCH, OTHERWISE A RANDOM SONG
    if (named) {
      playAt(named.idx, `Playing ${cleanDisplay(list[named.idx].title)}`);
      return;
    }
    const rnd = pickRandom(moodPool(null, list), list);
    playAt(rnd, isTa ? "அந்த பாடல் கிடைக்கவில்லை. ஒரு பாடலை இசைக்கிறேன்." : "I couldn't find that, so here's a random song.");
  }

  /* ------------------------------------------------------------
   6. SPEECH RECOGNITION TRIGGER
     ------------------------------------------------------------ */
  let recognition = null;
  let isListening = false;

  function stopListening() {
    isListening = false;
    widget.classList.remove("listening");
    if (recognition) {
      const r = recognition;
      recognition = null;
      // detach first: abort() fires a late "aborted" error that used to
      // reset the mood prompt and overwrite the reply text
      r.onstart = r.onresult = r.onerror = r.onend = null;
      try { r.abort(); } catch (_) {}
    }
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice recognition requires Google Chrome over HTTPS.");
      return;
    }
    if (isListening) {
      stopListening();
      return;
    }

    const wasPlaying = !au.paused;
    if (wasPlaying) au.pause();
    try { window.speechSynthesis.cancel(); } catch (_) {}

    const lang = prefs.voiceLang === "ta-IN" ? "ta-IN" : "en-US";
    const rec = new SR();
    recognition = rec;
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 5;

    rec.onstart = () => {
      isListening = true;
      widget.classList.add("listening");
      $("rvdj-heard").textContent = lang === "ta-IN" ? "🎙️ கேட்கிறேன்..." : "🎙️ Listening...";
      $("rvdj-reply").textContent = waitingForMood ? "Tell me your mood (happy, sad...)" : "Say a song name or 'Play a song'";
      showCard();
    };

    rec.onresult = e => {
      let interim = "";
      const finalAlts = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          for (let j = 0; j < res.length; j++) finalAlts.push(res[j].transcript.trim());
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) $("rvdj-heard").textContent = `You: "${interim.trim()}"`;
      if (finalAlts.length) {
        stopListening();
        $("rvdj-heard").textContent = `You said: "${finalAlts[0]}"`;
        executeVoiceCommand(finalAlts);
      }
    };

    rec.onerror = ev => {
      if (ev && ev.error === "aborted") return;
      stopListening();
      waitingForMood = false;
      $("rvdj-reply").textContent = "Didn't catch that. Tap mic again.";
      showCard(4500);
      if (wasPlaying && $("play")) $("play").click();
    };

    rec.onend = () => {
      isListening = false;
      widget.classList.remove("listening");
      if (recognition === rec) recognition = null;
    };

    try { rec.start(); } catch (_) { stopListening(); }
  }

  $("rvdj-fab").onclick = startListening;

  $("rvdj-lang-toggle").onclick = () => {
    prefs.voiceLang = prefs.voiceLang === "ta-IN" ? "en-US" : "ta-IN";
    savePrefs();
    $("rvdj-lang-toggle").textContent = prefs.voiceLang === "ta-IN" ? "தமிழ் / EN" : "EN / தமிழ்";
    speakRishi(prefs.voiceLang === "ta-IN" ? "தமிழ் குரல் தேர்வு செய்யப்பட்டது." : "English voice selected.");
    showCard(3500);
  };

  au.addEventListener("play", () => {
    const cur = window.RishiBridge && window.RishiBridge.getCurrentTrack();
    if (cur) autoFetchLyrics(cur);
  });
})();
