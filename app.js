// ---------- Utilities ----------
function normalize(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

const hintBtn = document.getElementById("hintBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");
const sessionStatsEl = document.getElementById("sessionStats");
const perSpecimenStatsEl = document.getElementById("perSpecimenStats");

function statsKey(mode) {
  return `rmtrainer_stats_v1_${mode}`;
}

function loadStats(mode) {
  try {
    return JSON.parse(localStorage.getItem(statsKey(mode)) || "{}");
  } catch {
    return {};
  }
}

function saveStats(mode, stats) {
  localStorage.setItem(statsKey(mode), JSON.stringify(stats));
}

let stats = {}; // { [specimenId]: { seen: number, correct: number } }

// Levenshtein distance (edit distance)
function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

// Similarity score: 1.0 is perfect, closer to 0 is worse
function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - dist / maxLen;
}

// Random choice helper
function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- App State ----------
let ALL = [];
let MODE = "general";
let pool = [];           // filtered specimens for mode
let lastId = null;       // last specimen id shown (to avoid repeats)
let current = null;      // current specimen object
let currentImage = null; // current image path
let revealed = false;

// Even weighting rule:
// - pick specimen TYPES evenly (each type has equal chance)
// - once type chosen, pick random image within that type
function pickNextSpecimen() {
  if (!pool.length) return null;

  // Avoid same type as last time
  const candidates = pool.filter(s => s.id !== lastId);
  const list = candidates.length ? candidates : pool; // fallback if only 1 item exists

  // Even probability across types
  const next = choice(list);

  // Image: random within chosen type
  const img = choice(next.images);

  lastId = next.id;
  current = next;
  currentImage = img;
  revealed = false;
  return next;
}

// ---------- Zoom & Pan ----------
function setupZoomPan(viewerEl, imgEl) {
  let scale = 1;
  let tx = 0, ty = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  function apply() {
    imgEl.style.transform =
      `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`;
  }

  function clampScale(s) {
    return Math.min(6, Math.max(1, s));
  }

  viewerEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.15;
    scale = clampScale(scale + delta);
    apply();
  }, { passive: false });

  viewerEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    viewerEl.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  viewerEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    tx += dx;
    ty += dy;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });

  viewerEl.addEventListener("pointerup", () => { dragging = false; });
  viewerEl.addEventListener("pointercancel", () => { dragging = false; });

  // Reset on double click / double tap
  viewerEl.addEventListener("dblclick", () => {
    scale = 1; tx = 0; ty = 0; apply();
  });

  // Expose reset when image changes
  return function reset() {
    scale = 1; tx = 0; ty = 0; apply();
  };
}

// ---------- Checking Answer ----------
function checkAnswer(userText, specimen) {
  const input = normalize(userText);
  if (!input) return { ok: false, best: null, score: 0 };

  // Compare to display + aliases
  const options = [specimen.display, ...(specimen.aliases || [])];

  let best = options[0];
  let bestScore = -1;

  for (const opt of options) {
    const sc = similarity(input, opt);
    if (sc > bestScore) {
      bestScore = sc;
      best = opt;
    }
  }

  // Tune this threshold:
  // 0.86 is fairly strict for short names; for longer names it still works.
  const ok = bestScore >= 0.86;

  return { ok, best, score: bestScore };
}

// ---------- UI Wiring ----------
const modeSelect = document.getElementById("modeSelect");
const imgEl = document.getElementById("specimenImg");
const viewerEl = document.getElementById("viewer");
const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");
const nextBtn = document.getElementById("nextBtn");
const feedbackEl = document.getElementById("feedback");

let resetZoom = () => {};

function setFeedback(html, kind) {
  feedbackEl.classList.remove("ok", "bad");
  if (kind) feedbackEl.classList.add(kind);
  feedbackEl.innerHTML = html;
}

function setMode(mode) {
  MODE = mode;
  pool = ALL.filter(s => (s.modes || []).includes(MODE));
  lastId = null;

  stats = loadStats(MODE); // <-- load per-mode stats
  renderStats();

  next();
}


function renderCurrent() {
  if (!current) return;
  imgEl.src = currentImage;
  imgEl.alt = `Specimen image (${current.display})`;
  resetZoom();

  answerInput.value = "";
  answerInput.focus();
  setFeedback("Type your guess, then click <b>Check</b>.", null);
}

function next() {
  pickNextSpecimen();
  renderCurrent();
}

function revealResult(result) {
  const correctName = current.display;
  if (result.ok) {
    setFeedback(`✅ <b>Correct!</b> (${correctName})`, "ok");
  } else {
    // “If it's wrong, it'll display the right mineral.”
    setFeedback(`❌ Not quite. Correct answer: <b>${correctName}</b>`, "bad");
  }
  revealed = true;
}

// Optional behavior: pressing "Check" again after revealing moves to next
function handleSubmit() {
  if (!current) return;

  if (revealed) {
    next();
    return;
  }

  const res = checkAnswer(answerInput.value, current);
  revealResult(res);
}

// ---------- Load Data ----------
async function init() {
  const resp = await fetch("data/specimens.json");
  const data = await resp.json();
  ALL = data.specimens || [];

  // Build mode list from data
  const modes = new Set();
  for (const s of ALL) for (const m of (s.modes || [])) modes.add(m);

  // Populate dropdown
  const sorted = Array.from(modes).sort();
  modeSelect.innerHTML = sorted.map(m => `<option value="${m}">${m}</option>`).join("");

  // Default mode preference
  MODE = sorted.includes("general") ? "general" : (sorted[0] || "general");
  modeSelect.value = MODE;

  // Setup zoom/pan
  resetZoom = setupZoomPan(viewerEl, imgEl);

  // Wire events
  modeSelect.addEventListener("change", () => setMode(modeSelect.value));
  submitBtn.addEventListener("click", handleSubmit);
  nextBtn.addEventListener("click", next);
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  setMode(MODE);
}

init().catch(err => {
  console.error(err);
  setFeedback("Failed to load specimen data. Check console + paths.", "bad");
});
