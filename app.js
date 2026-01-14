// =====================
// Rock & Mineral Trainer
// app.js
// =====================

// ---------- Utilities ----------
function normalize(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

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
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
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

// ---------- Stats (per mode, saved in localStorage) ----------
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

function saveStats(mode, statsObj) {
  localStorage.setItem(statsKey(mode), JSON.stringify(statsObj));
}

function pct(correct, seen) {
  if (!seen) return "—";
  const p = (correct / seen) * 100;
  return `${p.toFixed(0)}%`;
}

// ---------- Hint ----------
function hintFor(specimen) {
  // First letter of each word in the display name
  // "Orthoclase Feldspar" -> "O F"
  return specimen.display
    .trim()
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() || "")
    .join(" ");
}

// ---------- App State ----------
let ALL = [];
let MODE = "general";
let pool = [];            // filtered specimens for mode
let lastId = null;        // last specimen id shown (avoid repeats)
let current = null;       // current specimen object
let currentImage = null;  // current image path
let revealed = false;

let stats = {}; // { [specimenId]: { seen: number, correct: number } }

const CUSTOM_MINERALS_MODE = "Custom Minerals";
const CUSTOM_MINERALS_KEY = "rmtrainer_custom_minerals_v1";

// Even weighting:
// - pick specimen TYPES evenly (each type has equal chance)
// - once type chosen, pick random image within that type
function pickNextSpecimen() {
  if (!pool.length) return null;

  // Avoid same type as last time
  const candidates = pool.filter(s => s.id !== lastId);
  const list = candidates.length ? candidates : pool; // fallback if only 1 exists

  // Even probability across types
  const next = choice(list);

  // Random image within chosen type
  const img = choice(next.images || []);
  if (!img) return null;

  lastId = next.id;
  current = next;
  currentImage = img;
  revealed = false;
  return next;
}

// ---------- Zoom & Pan ----------
function setupZoomPan(viewerEl, imgEl) {
  let scale = 1;
  let baseScale = 1;
  let tx = 0, ty = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  function apply() {
    const finalScale = baseScale * scale;
    imgEl.style.transform =
      `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${finalScale})`;
  }

  function clampScale(s) {
    return Math.min(6, Math.max(1, s));
  }

  function zoomBy(delta) {
    scale = clampScale(scale + delta);
    apply();
  }

  viewerEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 0.15;
      zoomBy(delta);
    },
    { passive: false }
  );

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

  viewerEl.addEventListener("pointerup", () => {
    dragging = false;
  });
  viewerEl.addEventListener("pointercancel", () => {
    dragging = false;
  });

  // Reset on double click
  viewerEl.addEventListener("dblclick", () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  });

  function fitToViewer() {
    const viewerW = viewerEl.clientWidth;
    const viewerH = viewerEl.clientHeight;
    const imgW = imgEl.naturalWidth;
    const imgH = imgEl.naturalHeight;
    if (!viewerW || !viewerH || !imgW || !imgH) return;
    baseScale = Math.min(viewerW / imgW, viewerH / imgH, 1);
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  }

  return {
    reset: fitToViewer,
    zoomIn: () => zoomBy(0.2),
    zoomOut: () => zoomBy(-0.2),
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

  // Tune this threshold if needed
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

// Optional elements (safe if missing)
const hintBtn = document.getElementById("hintBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");
const sessionStatsEl = document.getElementById("sessionStats");
const perSpecimenStatsEl = document.getElementById("perSpecimenStats");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const formulaModal = document.getElementById("formulaModal");
const formulaResultEl = document.getElementById("formulaResult");
const formulaNameEl = document.getElementById("formulaName");
const formulaTextEl = document.getElementById("formulaText");
const closeFormulaBtn = document.getElementById("closeFormulaBtn");
const customizeBtn = document.getElementById("customizeBtn");
const customMineralsModal = document.getElementById("customMineralsModal");
const customMineralsList = document.getElementById("customMineralsList");
const customMineralsConfirm = document.getElementById("customMineralsConfirm");
const customMineralsClose = document.getElementById("customMineralsClose");
const customMineralsError = document.getElementById("customMineralsError");

let zoomControls = {
  reset: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
};

function showFormulaPopup(specimen, result) {
  if (!formulaModal || !formulaNameEl || !formulaTextEl || !formulaResultEl) return;
  formulaNameEl.textContent = specimen.display;
  const formula = specimen.formula?.trim();
  formulaTextEl.textContent = formula ? `Formula: ${formula}` : "Formula: Not set";
  formulaResultEl.classList.remove("ok", "bad");
  const resultText = result?.ok ? "Correct ✅" : "Not quite ❌";
  formulaResultEl.textContent = resultText;
  formulaResultEl.classList.add(result?.ok ? "ok" : "bad");
  formulaModal.classList.add("show");
  formulaModal.setAttribute("aria-hidden", "false");
}

function hideFormulaPopup() {
  if (!formulaModal) return;
  formulaModal.classList.remove("show");
  formulaModal.setAttribute("aria-hidden", "true");
  if (formulaResultEl) {
    formulaResultEl.textContent = "";
    formulaResultEl.classList.remove("ok", "bad");
  }
}

function setFeedback(html, kind) {
  feedbackEl.classList.remove("ok", "bad");
  if (kind) feedbackEl.classList.add(kind);
  feedbackEl.innerHTML = html;
}

function renderStats() {
  if (!sessionStatsEl || !perSpecimenStatsEl) return;

  // Overall (this mode)
  let totalSeen = 0,
    totalCorrect = 0;

  for (const s of pool) {
    const e = stats[s.id];
    if (e) {
      totalSeen += e.seen;
      totalCorrect += e.correct;
    }
  }
  sessionStatsEl.textContent = `Mode total: ${pct(totalCorrect, totalSeen)} (${totalCorrect}/${totalSeen})`;

  // Per-specimen list for ONLY specimens in this mode
  const rows = pool.map((s) => {
    const e = stats[s.id] || { seen: 0, correct: 0 };
    return {
      name: s.display,
      id: s.id,
      seen: e.seen,
      correct: e.correct,
      acc: e.seen ? e.correct / e.seen : null,
    };
  });

  // Sort: highest accuracy first, unseen last
  rows.sort((a, b) => {
    const ap = a.seen ? a.acc ?? 0 : -1;
    const bp = b.seen ? b.acc ?? 0 : -1;
    if (bp !== ap) return bp - ap;
    return a.name.localeCompare(b.name);
  });

  perSpecimenStatsEl.innerHTML = rows
    .map(
      (r) => `
      <div class="statRow">
        <div class="name">${r.name}</div>
        <div class="pct">${pct(r.correct, r.seen)} <span style="opacity:.7">(${r.correct}/${r.seen})</span></div>
      </div>
    `
    )
    .join("");
}

function updateCustomizeButton() {
  if (!customizeBtn) return;
  customizeBtn.classList.toggle("hidden", MODE !== CUSTOM_MINERALS_MODE);
}

function getMineralSpecimens() {
  return ALL.filter((s) => (s.modes || []).includes("Minerals"));
}

function loadCustomMineralIds() {
  try {
    const raw = localStorage.getItem(CUSTOM_MINERALS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomMineralIds(ids) {
  localStorage.setItem(CUSTOM_MINERALS_KEY, JSON.stringify(ids));
}

function getCustomMineralIds() {
  const stored = loadCustomMineralIds();
  if (stored.length) return stored;
  return getMineralSpecimens().map((s) => s.id);
}

function renderCustomMineralsModal() {
  if (!customMineralsList) return;
  const minerals = getMineralSpecimens().sort((a, b) => a.display.localeCompare(b.display));
  const selected = new Set(getCustomMineralIds());
  customMineralsList.innerHTML = minerals
    .map(
      (mineral) => `
        <label class="mineralOption">
          <input type="checkbox" value="${mineral.id}" ${selected.has(mineral.id) ? "checked" : ""} />
          <span>${mineral.display}</span>
        </label>
      `
    )
    .join("");
}

function showCustomMineralsModal() {
  if (!customMineralsModal) return;
  if (customMineralsError) customMineralsError.textContent = "";
  renderCustomMineralsModal();
  customMineralsModal.classList.add("show");
  customMineralsModal.setAttribute("aria-hidden", "false");
}

function hideCustomMineralsModal() {
  if (!customMineralsModal) return;
  customMineralsModal.classList.remove("show");
  customMineralsModal.setAttribute("aria-hidden", "true");
}

function setMode(mode, options = {}) {
  MODE = mode;
  if (MODE === CUSTOM_MINERALS_MODE) {
    const allowed = new Set(getCustomMineralIds());
    pool = getMineralSpecimens().filter(
      (s) => allowed.has(s.id) && Array.isArray(s.images) && s.images.length
    );
  } else {
    pool = ALL.filter(
      (s) =>
        (s.modes || []).includes(MODE) && Array.isArray(s.images) && s.images.length
    );
  }
  lastId = null;

  stats = loadStats(MODE);
  renderStats();
  updateCustomizeButton();

  if (!pool.length) {
    setFeedback("No specimens available for this mode.", "bad");
    return;
  }

  if (MODE === CUSTOM_MINERALS_MODE && !options.skipModal) {
    showCustomMineralsModal();
  }

  next();
}

function renderCurrent() {
  if (!current) return;

  hideFormulaPopup();
  imgEl.onload = () => zoomControls.reset();
  imgEl.src = currentImage;
  imgEl.alt = `Specimen image (${current.display})`;
  zoomControls.reset();

  answerInput.value = "";
  answerInput.focus();
  setFeedback("Type your guess, then click <b>Check</b>.", null);
}

function next() {
  hideFormulaPopup();
  const nextSpecimen = pickNextSpecimen();
  if (!nextSpecimen) {
    setFeedback("No specimens available to display.", "bad");
    return;
  }
  renderCurrent();
}

function ensureStatEntry(id) {
  if (!stats[id]) stats[id] = { seen: 0, correct: 0 };
}

function revealResult(result) {
  const correctName = current.display;

  // Update stats (count attempts when user clicks "Check")
  ensureStatEntry(current.id);
  stats[current.id].seen += 1;
  if (result.ok) stats[current.id].correct += 1;
  saveStats(MODE, stats);
  renderStats();

  if (result.ok) {
    setFeedback(`✅ <b>Correct!</b> (${correctName})`, "ok");
  } else {
    setFeedback(`❌ Not quite. Correct answer: <b>${correctName}</b>`, "bad");
  }
  showFormulaPopup(current, result);
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
  let basePath = window.location.pathname;
  if (!basePath.endsWith("/")) {
    basePath = basePath.includes(".") ? basePath.replace(/[^/]*$/, "") : `${basePath}/`;
  }
  const dataUrl = new URL("data/specimens.json", `${window.location.origin}${basePath}`);

  const resp = await fetch(dataUrl);
  if (!resp.ok) {
    throw new Error(`Failed to load specimens: ${resp.status}`);
  }
  const data = await resp.json();
  ALL = data.specimens || [];

  // Build mode list from data
  const modes = new Set();
  for (const s of ALL) for (const m of s.modes || []) modes.add(m);

  // Populate dropdown
  modes.add(CUSTOM_MINERALS_MODE);
  const sorted = Array.from(modes).sort();
  modeSelect.innerHTML = sorted.map((m) => `<option value="${m}">${m}</option>`).join("");

  // Default mode
  MODE = sorted.includes("ALL")
    ? "ALL"
    : sorted.includes("general")
    ? "general"
    : sorted[0] || "ALL";
  modeSelect.value = MODE;

  // Setup zoom/pan
  zoomControls = setupZoomPan(viewerEl, imgEl);

  // Wire events
  modeSelect.addEventListener("change", () => {
    const nextMode = modeSelect.value;
    if (nextMode === CUSTOM_MINERALS_MODE) {
      showCustomMineralsModal();
      return;
    }
    setMode(nextMode);
  });
  submitBtn.addEventListener("click", handleSubmit);
  nextBtn.addEventListener("click", next);
  zoomInBtn?.addEventListener("click", () => zoomControls.zoomIn());
  zoomOutBtn?.addEventListener("click", () => zoomControls.zoomOut());
  zoomResetBtn?.addEventListener("click", () => zoomControls.reset());
  closeFormulaBtn?.addEventListener("click", hideFormulaPopup);
  formulaModal?.addEventListener("click", (event) => {
    if (event.target === formulaModal) hideFormulaPopup();
  });
  customizeBtn?.addEventListener("click", showCustomMineralsModal);
  customMineralsClose?.addEventListener("click", () => {
    hideCustomMineralsModal();
    modeSelect.value = MODE;
  });
  customMineralsModal?.addEventListener("click", (event) => {
    if (event.target === customMineralsModal) hideCustomMineralsModal();
  });
  customMineralsConfirm?.addEventListener("click", () => {
    if (!customMineralsList) return;
    const checked = Array.from(
      customMineralsList.querySelectorAll('input[type="checkbox"]:checked')
    ).map((input) => input.value);
    if (!checked.length) {
      if (customMineralsError) {
        customMineralsError.textContent = "Select at least one mineral to continue.";
      }
      return;
    }
    saveCustomMineralIds(checked);
    hideCustomMineralsModal();
    modeSelect.value = CUSTOM_MINERALS_MODE;
    setMode(CUSTOM_MINERALS_MODE, { skipModal: true });
  });

  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  hintBtn?.addEventListener("click", () => {
    if (!current) return;
    const hint = hintFor(current);
    setFeedback(`💡 Hint: <b>${hint}</b>`, null);
  });

  resetStatsBtn?.addEventListener("click", () => {
    localStorage.removeItem(statsKey(MODE));
    stats = {};
    renderStats();
    setFeedback("Stats reset for this mode.", null);
  });

  // Start
  setMode(MODE);
}

init().catch((err) => {
  console.error(err);
  setFeedback("Failed to load specimen data. Check console + paths.", "bad");
});
