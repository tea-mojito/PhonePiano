import {
  ensureAudioStarted,
  setSynthType,
  setMasterVolume,
  startNote,
  stopNote,
  allNotesOff
} from "./audioEngine.js";

import {
  initMIDI,
  setInputFilter,
  setChannelFilter
} from "./midi.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const TONE_STORAGE_KEY = "piano:tone";
const VOLUME_STORAGE_KEY = "piano:volume";
const KEY_HEIGHT_STORAGE_KEY = "piano:key-height-scale";
const DESKTOP_RANGE_STORAGE_KEY = "piano:desktop-range";
const KEY_HEIGHT_STEP = 1;
const MOBILE_KEY_MIN_HEIGHT = 30;
const INPUT_WINDOW_MIN_HEIGHT = 100;

const DESKTOP_RANGES = [
  { start: 72, end: 96 }, // C5-C7
  { start: 60, end: 84 }  // C4-C6
];
const DESKTOP_ALT_RANGES = [
  { start: 72, end: 96 }, // C5-C7
  { start: 48, end: 72 }  // C3-C5
];
const MOBILE_RANGES = [
  { start: 96, end: 108 }, // C7-C8
  { start: 84, end: 96 }, // C6-C7
  { start: 72, end: 84 }, // C5-C6
  { start: 60, end: 72 }, // C4-C5
  { start: 48, end: 60 }  // C3-C4
];
const MOBILE_KEY_TIER_COUNT = MOBILE_RANGES.length;
const KEYBOARD_SLOTS = [
  { tierId: "tierLow", blackId: "kbLowBlack", whiteId: "kbLowWhite" },
  { tierId: "tierHigh", blackId: "kbHighBlack", whiteId: "kbHighWhite" },
  { tierId: "tierThird", blackId: "kbThirdBlack", whiteId: "kbThirdWhite" },
  { tierId: "tierFourth", blackId: "kbFourthBlack", whiteId: "kbFourthWhite" },
  { tierId: "tierFifth", blackId: "kbFifthBlack", whiteId: "kbFifthWhite" }
];

const midiStatusText = document.getElementById("midiStatusText");
const midiInputSel = document.getElementById("midiInputSel");
const midiChSel = document.getElementById("midiChSel");
const midiBtn = document.getElementById("midiBtn");
const testBtn = document.getElementById("testBtn");
const panicFloatingBtn = document.getElementById("panicFloatingBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const panicPanelBtn = document.getElementById("panicPanelBtn");
const fullscreenPanelBtn = document.getElementById("fullscreenPanelBtn");
const keyHeightScaleEl = document.getElementById("keyHeightScale");
const reloadBtn = document.getElementById("reloadBtn");
const reloadBtnTop = document.getElementById("reloadBtnTop");
const controlPanelEl = document.getElementById("topControlPanel") || document.querySelector(".top-control-panel");
const bottomControlPanelEl = document.getElementById("bottomControlPanel");
const topControlsMountEl = document.getElementById("topControlsMount");
const mobileSoundControlsMountEl = document.getElementById("mobileSoundControlsMount");
const soundControlsEl = document.getElementById("soundControls");
const controlPopupBtn = document.getElementById("controlPopupBtn");
const waveSel = document.getElementById("waveSel");
const desktopRangeSel = document.getElementById("desktopRangeSel");
const muteBtnEl = document.getElementById("muteBtn");
const volumeIconEl = document.getElementById("volumeIcon");
const volEl = document.getElementById("vol");
const heldNotesEl = document.getElementById("heldNotes");
const inputWindowEl = document.getElementById("inputWindow");
const pianoAreaEl = document.getElementById("pianoArea");
const startOverlayEl = document.getElementById("startOverlay");
const octaveUpBtnEl = document.getElementById("octaveUpBtn");
const octaveResetBtnEl = document.getElementById("octaveResetBtn");
const octaveDownBtnEl = document.getElementById("octaveDownBtn");
const octaveShiftButtons = [octaveUpBtnEl, octaveResetBtnEl, octaveDownBtnEl].filter(Boolean);

const midiToDots = new Map();
const noteSources = new Map();
const activePointers = new Map();
let mobileLayoutActive = null;
let lastNonZeroVolume = 1;
let keyboardInteractionEnabled = false;
let desktopOctaveShift = 0;
const LOG_MAX_LINES = 300;

function nowTimeLabel() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function sourceTag(sourceId) {
  if (typeof sourceId !== "string") return "unknown";
  if (sourceId.startsWith("ptr:")) return "ptr";
  return sourceId;
}

function appendLogLine(text) {
  if (!inputWindowEl) return;
  const line = document.createElement("div");
  line.className = "input-log-line";
  line.textContent = text;
  inputWindowEl.appendChild(line);

  while (inputWindowEl.childElementCount > LOG_MAX_LINES) {
    inputWindowEl.removeChild(inputWindowEl.firstElementChild);
  }
  inputWindowEl.scrollTop = inputWindowEl.scrollHeight;
}

function logNoteEvent(type, midi, sourceId, velocity) {
  const note = midiToNoteLabel(midi);
  const src = sourceTag(sourceId);
  const vel = Number.isFinite(velocity) ? ` vel=${Number(velocity).toFixed(2)}` : "";
  appendLogLine(`${nowTimeLabel()} ${type} ${note}${vel} src=${src}`);
}

function isCompactViewport() {
  return window.innerWidth <= 599;
}

function getCssVarPx(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function syncViewportHeightVar() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", `${Math.round(viewportHeight)}px`);
}

function syncMobileTierCountVar() {
  document.documentElement.style.setProperty("--mobile-key-tier-count", String(MOBILE_KEY_TIER_COUNT));
}

function pc(midi) {
  return ((midi % 12) + 12) % 12;
}

function midiToNoteLabel(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc(midi)]}${octave}`;
}

function registerDot(midi, dot) {
  if (!midiToDots.has(midi)) {
    midiToDots.set(midi, []);
  }
  midiToDots.get(midi).push(dot);
}

function setDotActive(midi, active) {
  const dots = midiToDots.get(midi);
  if (!dots) return;
  for (const dot of dots) {
    dot.classList.toggle("active", !!active);
    dot.classList.toggle("is-active", !!active);
  }
}

function refreshHeldNotesUI() {
  if (!heldNotesEl) return;
  const notes = [...noteSources.keys()].sort((a, b) => a - b);
  heldNotesEl.textContent = notes.length ? notes.map(midiToNoteLabel).join(" ") : "-";
}

function noteOn(midi, sourceId, velocity = 0.85) {
  if (!noteSources.has(midi)) noteSources.set(midi, new Set());
  const sources = noteSources.get(midi);
  const wasActive = sources.size > 0;
  sources.add(sourceId);

  if (!wasActive) {
    startNote(midi, velocity);
    setDotActive(midi, true);
    logNoteEvent("NOTE ON", midi, sourceId, velocity);
  }

  refreshHeldNotesUI();
}

function noteOff(midi, sourceId) {
  const sources = noteSources.get(midi);
  if (!sources) return;

  sources.delete(sourceId);
  if (sources.size === 0) {
    noteSources.delete(midi);
    stopNote(midi);
    setDotActive(midi, false);
    logNoteEvent("NOTE OFF", midi, sourceId);
  }

  refreshHeldNotesUI();
}

function allOffAndClear() {
  noteSources.clear();
  allNotesOff();
  for (const dots of midiToDots.values()) {
    for (const dot of dots) {
      dot.classList.remove("active");
      dot.classList.remove("is-active");
    }
  }
  refreshHeldNotesUI();
  appendLogLine(`${nowTimeLabel()} PANIC all notes off`);
}

function findKeyAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const key = el.closest(".key");
  if (!key || !key.dataset.note) return null;
  return key;
}

function findMidiForKey(keyEl) {
  if (!keyEl || !keyEl.dataset.note) return null;
  for (const [midi, dots] of midiToDots.entries()) {
    if (dots.includes(keyEl)) return midi;
  }
  return null;
}

function handlePointerSlide(event) {
  if (!keyboardInteractionEnabled) return;
  const pointerId = event.pointerId;
  if (!activePointers.has(pointerId)) return;

  const currentMidi = activePointers.get(pointerId);
  const keyEl = findKeyAtPoint(event.clientX, event.clientY);
  const newMidi = keyEl ? findMidiForKey(keyEl) : null;

  if (newMidi === currentMidi) return;

  const src = `ptr:${pointerId}`;
  if (currentMidi != null) noteOff(currentMidi, src);
  if (newMidi != null) noteOn(newMidi, src, 0.9);
  activePointers.set(pointerId, newMidi);
}

function addPointerHandlers(dot, midi) {
  dot.addEventListener("pointerdown", async (event) => {
    if (!keyboardInteractionEnabled) return;
    event.preventDefault();
    await ensureAudioStarted();
    activePointers.set(event.pointerId, midi);
    const src = `ptr:${event.pointerId}`;
    noteOn(midi, src, 0.9);
  });
}

function isWhiteKey(midi) {
  return WHITE_SEMIS.includes(pc(midi));
}

function isWideBlackKey(midi) {
  const p = pc(midi);
  return p === 1 || p === 3 || p === 6 || p === 10; // C#, D#, F#, A#
}

function setControlPanelOpen(open) {
  const compact = isCompactViewport();
  const topOpen = compact ? false : !!open;
  const bottomOpen = compact ? !!open : false;
  controlPanelEl?.classList.toggle("collapsed", !topOpen);
  bottomControlPanelEl?.classList.toggle("collapsed", !bottomOpen);
  controlPopupBtn?.setAttribute("aria-expanded", String(!!open));
}

function toggleControlPanelOpen() {
  const activePanelEl = isCompactViewport() ? bottomControlPanelEl : controlPanelEl;
  if (!activePanelEl) return;
  const isOpen = !activePanelEl.classList.contains("collapsed");
  setControlPanelOpen(!isOpen);
}

function getDesktopRanges() {
  const baseRanges = desktopRangeSel?.value === "c3c5" ? DESKTOP_ALT_RANGES : DESKTOP_RANGES;
  const offset = desktopOctaveShift * 12;
  return baseRanges.map((range) => ({
    start: Math.max(0, Math.min(127, range.start + offset)),
    end: Math.max(0, Math.min(127, range.end + offset))
  }));
}

function syncDesktopOctaveShiftButtons() {
  for (const button of octaveShiftButtons) {
    const shift = Number(button.dataset.shift);
    const isActive = shift === desktopOctaveShift;
    button.disabled = isActive;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function setDesktopOctaveShift(shift) {
  const next = Math.max(-1, Math.min(1, shift));
  if (next === desktopOctaveShift) return;
  desktopOctaveShift = next;
  syncDesktopOctaveShiftButtons();
  queueLayoutRefresh();
}

function applyKeyboardLayout(force = false) {
  const useMobile = isCompactViewport();
  if (!force && mobileLayoutActive === useMobile) return;
  mobileLayoutActive = useMobile;

  allOffAndClear();
  midiToDots.clear();

  const ranges = useMobile ? MOBILE_RANGES : getDesktopRanges();
  KEYBOARD_SLOTS.forEach((slot, index) => {
    const tierEl = document.getElementById(slot.tierId);
    const blackEl = document.getElementById(slot.blackId);
    const whiteEl = document.getElementById(slot.whiteId);
    if (!tierEl || !blackEl || !whiteEl) return;

    const range = ranges[index];
    if (!range) {
      tierEl.style.display = "none";
      blackEl.innerHTML = "";
      whiteEl.innerHTML = "";
      return;
    }

    tierEl.style.display = "";
    buildTier(range, blackEl, whiteEl);
  });

}

function runLayoutPass() {
  applyKeyboardLayout(true);
  syncMobileKeyHeightMax();
  syncPianoAreaHeight();
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function syncFullscreenButtonVisibility() {
  if (!fullscreenBtn) return;
  const hidden = isFullscreenActive();
  fullscreenBtn.hidden = hidden;
  if (fullscreenPanelBtn) fullscreenPanelBtn.hidden = hidden;
}

function syncControlPanelMode() {
  const activePanelEl = isCompactViewport() ? bottomControlPanelEl : controlPanelEl;
  const isOpen = !!activePanelEl && !activePanelEl.classList.contains("collapsed");
  controlPopupBtn?.setAttribute("aria-expanded", String(isOpen));
}

function syncControlPanelLayout() {
  if (!soundControlsEl || !topControlsMountEl || !mobileSoundControlsMountEl) return;
  const compact = isCompactViewport();
  if (compact) {
    if (soundControlsEl.parentElement !== mobileSoundControlsMountEl) {
      mobileSoundControlsMountEl.appendChild(soundControlsEl);
    }
    return;
  }
  if (soundControlsEl.parentElement !== topControlsMountEl) {
    topControlsMountEl.appendChild(soundControlsEl);
  }
}

function syncPianoAreaHeight() {
  if (!pianoAreaEl) return;
  const height = pianoAreaEl.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--piano-area-height", `${Math.round(height)}px`);
  syncInputWindowVisibility();
}

function syncInputWindowVisibility() {
  if (!inputWindowEl) return;
  if (!isCompactViewport()) {
    inputWindowEl.classList.remove("input-window-hidden");
    return;
  }

  const appVh = getCssVarPx("--app-vh") || (window.visualViewport?.height || window.innerHeight);
  const spaceY = getCssVarPx("--space-y");
  const floatingBtnSize = getCssVarPx("--floating-btn-size");
  const pianoAreaHeight = getCssVarPx("--piano-area-height");
  const availableHeight = appVh - (floatingBtnSize + (2 * spaceY) + 5 + pianoAreaHeight);
  inputWindowEl.classList.toggle("input-window-hidden", availableHeight < INPUT_WINDOW_MIN_HEIGHT);
}

async function unlockKeyboardInteraction() {
  if (keyboardInteractionEnabled) return;
  await ensureAudioStarted();
  keyboardInteractionEnabled = true;
  if (startOverlayEl) startOverlayEl.hidden = true;
}

function initKeyboardInteractionGate() {
  if (!startOverlayEl) {
    keyboardInteractionEnabled = true;
    return;
  }
  keyboardInteractionEnabled = false;
  startOverlayEl.hidden = false;
}

function getBaseKeyHeightPx() {
  const spaceY = getCssVarPx("--space-y");
  const appVh = getCssVarPx("--app-vh") || (window.visualViewport?.height || window.innerHeight);
  return Math.max(1, ((appVh / 2) - spaceY) / MOBILE_KEY_TIER_COUNT);
}

function syncMobileKeyHeightScale() {
  if (!keyHeightScaleEl) return;
  const targetPx = Number(keyHeightScaleEl.value);
  const baseKeyHeight = getBaseKeyHeightPx();
  const scale = Number.isFinite(targetPx) && targetPx > 0 ? (targetPx / baseKeyHeight) : 1;
  document.documentElement.style.setProperty("--key-height-mobile-scale", String(scale));
}

function restoreToneSelection() {
  if (!waveSel) return;
  try {
    const raw = window.localStorage.getItem(TONE_STORAGE_KEY);
    if (!raw) return;
    const exists = [...waveSel.options].some((option) => option.value === raw);
    if (!exists) return;
    waveSel.value = raw;
  } catch {
    // ignore storage errors
  }
}

function persistToneSelection() {
  if (!waveSel) return;
  try {
    window.localStorage.setItem(TONE_STORAGE_KEY, waveSel.value);
  } catch {
    // ignore storage errors
  }
}

function restoreVolumeSelection() {
  if (!volEl) return;
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    volEl.value = String(Math.max(0, Math.min(1, value)));
  } catch {
    // ignore storage errors
  }
}

function persistVolumeSelection() {
  if (!volEl) return;
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volEl.value));
  } catch {
    // ignore storage errors
  }
}

function restoreKeyHeightScaleSelection() {
  if (!keyHeightScaleEl) return;
  try {
    const raw = window.localStorage.getItem(KEY_HEIGHT_STORAGE_KEY);
    if (raw == null) return;
    const stored = Number(raw);
    if (!Number.isFinite(stored) || stored <= 0) return;
    const baseKeyHeight = getBaseKeyHeightPx();
    // Backward compatibility: old data stored scale (< 10 in practice).
    const pxValue = stored <= 10 ? stored * baseKeyHeight : stored;
    keyHeightScaleEl.value = String(Math.round(pxValue));
  } catch {
    // ignore storage errors
  }
}

function persistKeyHeightScaleSelection() {
  if (!keyHeightScaleEl) return;
  try {
    const value = Number(keyHeightScaleEl.value);
    if (!Number.isFinite(value) || value <= 0) return;
    window.localStorage.setItem(KEY_HEIGHT_STORAGE_KEY, String(Math.round(value)));
  } catch {
    // ignore storage errors
  }
}

function restoreDesktopRangeSelection() {
  if (!desktopRangeSel) return;
  try {
    const raw = window.localStorage.getItem(DESKTOP_RANGE_STORAGE_KEY);
    if (raw !== "c3c5" && raw !== "c4c6") return;
    desktopRangeSel.value = raw;
  } catch {
    // ignore storage errors
  }
}

function persistDesktopRangeSelection() {
  if (!desktopRangeSel) return;
  try {
    window.localStorage.setItem(DESKTOP_RANGE_STORAGE_KEY, desktopRangeSel.value);
  } catch {
    // ignore storage errors
  }
}

function syncVolumeIcon() {
  if (!volumeIconEl || !volEl) return;
  const volume = Number(volEl.value) || 0;
  volumeIconEl.textContent = volume <= 0 ? "volume_off" : "volume_up";
  muteBtnEl?.setAttribute("aria-label", volume <= 0 ? "Unmute" : "Mute");
  muteBtnEl?.setAttribute("title", volume <= 0 ? "Unmute" : "Mute");
}

function applyVolume(value, { persist = true } = {}) {
  if (!volEl) return;
  const clamped = Math.max(0, Math.min(1, Number(value)));
  volEl.value = String(clamped);
  if (clamped > 0) lastNonZeroVolume = clamped;
  setMasterVolume(clamped);
  syncVolumeIcon();
  if (persist) persistVolumeSelection();
}

function toggleMute() {
  if (!volEl) return;
  const current = Number(volEl.value) || 0;
  if (current > 0) {
    applyVolume(0);
    return;
  }
  applyVolume(lastNonZeroVolume > 0 ? lastNonZeroVolume : 1);
}

function syncMobileKeyHeightMax() {
  if (!keyHeightScaleEl) return;
  keyHeightScaleEl.step = String(KEY_HEIGHT_STEP);
  const appVh = getCssVarPx("--app-vh") || (window.visualViewport?.height || window.innerHeight);
  const spaceY = getCssVarPx("--space-y");
  const floatingBtnTop = getCssVarPx("--floating-btn-top");
  const floatingBtnSize = getCssVarPx("--floating-btn-size");
  const keyGap = getCssVarPx("--key-gap");
  const minPx = MOBILE_KEY_MIN_HEIGHT;
  const pianoAreaMaxHeight = Math.max(0, appVh - (2 * spaceY) - floatingBtnTop - floatingBtnSize);
  const fixedHeight = MOBILE_KEY_TIER_COUNT * (2 * keyGap) ;
  const perTierRows = 2;
  const maxByLayout = (pianoAreaMaxHeight - fixedHeight) / (MOBILE_KEY_TIER_COUNT * perTierRows);
  const maxPx = Math.max(minPx, Math.floor(maxByLayout));
  keyHeightScaleEl.min = String(minPx);
  keyHeightScaleEl.max = String(maxPx);

  const currentValue = Number(keyHeightScaleEl.value) || minPx;
  const clamped = Math.min(maxPx, Math.max(minPx, currentValue));
  const snapped = Math.round(clamped / KEY_HEIGHT_STEP) * KEY_HEIGHT_STEP;
  if (snapped !== currentValue) {
    keyHeightScaleEl.value = String(snapped);
    syncMobileKeyHeightScale();
    persistKeyHeightScaleSelection();
  }
}

function queueLayoutRefresh() {
  syncViewportHeightVar();
  syncControlPanelLayout();
  syncControlPanelMode();
  requestAnimationFrame(() => {
    runLayoutPass();
    requestAnimationFrame(() => {
      syncViewportHeightVar();
      runLayoutPass();
    });
  });
}

function handleFullscreenStateChange() {
  syncFullscreenButtonVisibility();
  queueLayoutRefresh();
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }

    const root = document.documentElement;
    if (root.requestFullscreen) {
      await root.requestFullscreen();
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    }
  } catch (e) {
    console.warn("[UI] Fullscreen toggle failed:", e);
  }
}

function buildTier({ start, end }, blackRowEl, whiteRowEl) {
  const whiteMidis = [];
  for (let midi = start; midi <= end; midi++) {
    if (isWhiteKey(midi)) whiteMidis.push(midi);
  }

  const blackKeys = [];
  for (let i = 0; i < whiteMidis.length; i++) {
    const cur = whiteMidis[i];
    const next = whiteMidis[i + 1];
    if (next == null) continue;
    const candidate = cur + 1;
    if (candidate < next && candidate >= start && candidate <= end) {
      blackKeys.push(candidate);
    }
  }

  const whiteCols = whiteMidis.length;
  const frValues = blackKeys.map(midi => pc(midi) === 8 ? 2 : 3);
  const frTotal = frValues.reduce((a, b) => a + b, 0);
  const spacer = whiteCols * 2 - frTotal;
  let blackGridCols = frValues.map(v => `${v}fr`).join(" ");
  if (spacer > 0) blackGridCols += ` ${spacer}fr`;

  blackRowEl.style.gridTemplateColumns = blackGridCols;
  whiteRowEl.style.gridTemplateColumns = `repeat(${whiteCols}, 1fr)`;

  blackRowEl.innerHTML = "";
  whiteRowEl.innerHTML = "";

  for (const blackMidi of blackKeys) {
    const cell = document.createElement("div");
    cell.className = "black-cell";
    const dot = document.createElement("div");
    dot.className = "key key--black";
    if (isWideBlackKey(blackMidi)) {
      dot.classList.add("is-wide");
    }
    dot.title = midiToNoteLabel(blackMidi);
    dot.dataset.note = midiToNoteLabel(blackMidi);
    registerDot(blackMidi, dot);
    addPointerHandlers(dot, blackMidi);
    cell.appendChild(dot);
    blackRowEl.appendChild(cell);
  }
  if (spacer > 0) {
    blackRowEl.appendChild(document.createElement("div"));
  }

  for (const midi of whiteMidis) {
    const cell = document.createElement("div");
    cell.className = "white-cell";
    const dot = document.createElement("div");
    dot.className = "key key--white";
    if (pc(midi) === 0 && midi === end) {
      dot.classList.add("edge-c");
    }
    dot.title = midiToNoteLabel(midi);
    dot.dataset.note = midiToNoteLabel(midi);
    const mark = document.createElement("span");
    mark.className = "key-note-label";
    mark.textContent = midiToNoteLabel(midi);
    if (pc(midi) !== 0) {
      mark.hidden = true;
    }
    dot.appendChild(mark);
    registerDot(midi, dot);
    addPointerHandlers(dot, midi);
    cell.appendChild(dot);
    whiteRowEl.appendChild(cell);
  }
}

function setupUI() {
  for (const button of octaveShiftButtons) {
    button.addEventListener("click", () => {
      setDesktopOctaveShift(Number(button.dataset.shift));
    });
  }

  startOverlayEl?.addEventListener("click", async () => {
    await unlockKeyboardInteraction();
  });

  waveSel?.addEventListener("change", () => {
    setSynthType(waveSel.value);
    persistToneSelection();
  });
  desktopRangeSel?.addEventListener("change", () => {
    persistDesktopRangeSelection();
    queueLayoutRefresh();
  });
  volEl?.addEventListener("input", () => applyVolume(volEl.value));
  muteBtnEl?.addEventListener("click", toggleMute);
  muteBtnEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMute();
  });

  midiInputSel?.addEventListener("change", () => setInputFilter(midiInputSel.value));
  midiChSel?.addEventListener("change", () => setChannelFilter(midiChSel.value));

  midiBtn?.addEventListener("click", async () => {
    await ensureAudioStarted();
    await initMIDI({
      statusEl: midiStatusText,
      inputSel: midiInputSel,
      onNoteOn: (midi, velocity) => {
        noteOn(midi, "midi", velocity);
      },
      onNoteOff: (midi) => {
        noteOff(midi, "midi");
      },
      onPanic: () => {
        allOffAndClear();
      }
    });
  });

  panicFloatingBtn?.addEventListener("click", allOffAndClear);
  panicPanelBtn?.addEventListener("click", allOffAndClear);
  keyHeightScaleEl?.addEventListener("input", () => {
    syncMobileKeyHeightScale();
    persistKeyHeightScaleSelection();
    queueLayoutRefresh();
  });
  fullscreenBtn?.addEventListener("click", async () => {
    await toggleFullscreen();
    setControlPanelOpen(false);
    handleFullscreenStateChange();
  });
  fullscreenPanelBtn?.addEventListener("click", async () => {
    await toggleFullscreen();
    setControlPanelOpen(false);
    handleFullscreenStateChange();
  });
  controlPopupBtn?.addEventListener("click", toggleControlPanelOpen);
  reloadBtn?.addEventListener("click", () => window.location.reload());
  reloadBtnTop?.addEventListener("click", () => window.location.reload());

  testBtn?.addEventListener("click", async () => {
    await ensureAudioStarted();
    const test = [60, 64, 67, 72, 76, 79];
    test.forEach((midi, i) => {
      setTimeout(() => noteOn(midi, "test", 0.9), i * 220);
      setTimeout(() => noteOff(midi, "test"), i * 220 + 180);
    });
  });

  document.addEventListener("pointermove", handlePointerSlide);

  const releasePointer = (event) => {
    if (!activePointers.has(event.pointerId)) return;
    const currentMidi = activePointers.get(event.pointerId);
    activePointers.delete(event.pointerId);
    const src = `ptr:${event.pointerId}`;
    if (currentMidi != null) noteOff(currentMidi, src);
  };
  document.addEventListener("pointerup", releasePointer);
  document.addEventListener("pointercancel", releasePointer);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { activePointers.clear(); allOffAndClear(); }
  });
  document.addEventListener("fullscreenchange", handleFullscreenStateChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenStateChange);
  window.addEventListener("resize", queueLayoutRefresh);
  window.addEventListener("orientationchange", queueLayoutRefresh);
  window.visualViewport?.addEventListener("resize", queueLayoutRefresh);
  window.visualViewport?.addEventListener("scroll", syncViewportHeightVar);
}

function init() {
  initKeyboardInteractionGate();
  syncDesktopOctaveShiftButtons();
  syncMobileTierCountVar();
  syncViewportHeightVar();
  syncControlPanelLayout();
  restoreToneSelection();
  restoreDesktopRangeSelection();
  restoreVolumeSelection();
  restoreKeyHeightScaleSelection();
  applyKeyboardLayout();
  syncMobileKeyHeightMax();
  syncMobileKeyHeightScale();
  persistKeyHeightScaleSelection();
  syncPianoAreaHeight();
  setSynthType(waveSel?.value || "triangle");
  persistToneSelection();
  persistDesktopRangeSelection();
  applyVolume(volEl?.value || 1);
  setControlPanelOpen(false);
  syncFullscreenButtonVisibility();
  setupUI();
}

init();
