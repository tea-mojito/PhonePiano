let midiAccess = null;
let midiInitialized = false;
let selectedInputId = "";
let selectedChannel = 0;
let sustainOn = false;
const inputHandlers = new Map();
const midiHeld = new Set();
const sustainPendingOff = new Set();

let callbacks = {
  onNoteOn: () => {},
  onNoteOff: () => {},
  onPanic: () => {}
};

function handleMIDIMessage(event, inputId) {
  if (selectedInputId && selectedInputId !== inputId) return;

  const [status, d1, d2] = event.data;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (selectedChannel && selectedChannel !== channel) return;

  if (command === 0x90) {
    if (d2 === 0) {
      noteOff(d1);
      return;
    }
    noteOn(d1, d2 / 127);
    return;
  }

  if (command === 0x80) {
    noteOff(d1);
    return;
  }

  if (command === 0xb0) {
    if (d1 === 64) {
      sustainOn = d2 >= 64;
      if (!sustainOn) {
        releaseSustain();
      }
      return;
    }

    if (d1 === 120 || d1 === 123) {
      panic();
    }
  }
}

function noteOn(midi, velocity) {
  midiHeld.add(midi);
  sustainPendingOff.delete(midi);
  callbacks.onNoteOn(midi, velocity);
}

function noteOff(midi) {
  midiHeld.delete(midi);
  if (sustainOn) {
    sustainPendingOff.add(midi);
    return;
  }
  callbacks.onNoteOff(midi);
}

function releaseSustain() {
  for (const midi of sustainPendingOff) {
    if (!midiHeld.has(midi)) {
      callbacks.onNoteOff(midi);
    }
  }
  sustainPendingOff.clear();
}

function panic() {
  midiHeld.clear();
  sustainPendingOff.clear();
  sustainOn = false;
  callbacks.onPanic();
}

function refreshInputList(statusEl, inputSel) {
  if (!midiAccess) return;
  const inputs = [...midiAccess.inputs.values()];

  if (inputSel) {
    const prevValue = inputSel.value;
    inputSel.innerHTML = '<option value="">-</option>' +
      inputs.map((input) => `<option value="${input.id}">${input.name || input.id}</option>`).join("");
    inputSel.value = inputs.some((input) => input.id === prevValue) ? prevValue : "";
  }

  for (const input of inputs) {
    if (inputHandlers.has(input.id)) continue;
    const handler = (event) => handleMIDIMessage(event, input.id);
    input.addEventListener("midimessage", handler);
    inputHandlers.set(input.id, handler);
  }

  if (statusEl) {
    statusEl.textContent = inputs.length
      ? `接続OK: ${inputs.map((input) => input.name || input.id).join(", ")}`
      : "入力なし";
  }
}

export async function initMIDI({ statusEl, inputSel, onNoteOn, onNoteOff, onPanic }) {
  callbacks = {
    onNoteOn: onNoteOn || (() => {}),
    onNoteOff: onNoteOff || (() => {}),
    onPanic: onPanic || (() => {})
  };

  if (midiInitialized && midiAccess) {
    refreshInputList(statusEl, inputSel);
    return;
  }

  if (!navigator.requestMIDIAccess) {
    if (statusEl) statusEl.textContent = "WebMIDI未対応";
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    if (statusEl) statusEl.textContent = "権限拒否/未対応";
    return;
  }

  midiInitialized = true;
  refreshInputList(statusEl, inputSel);

  midiAccess.addEventListener("statechange", (event) => {
    if (event.port?.type === "input") {
      refreshInputList(statusEl, inputSel);
      if (event.port.state === "disconnected") {
        panic();
      }
    }
  });
}

export function setInputFilter(inputId) {
  selectedInputId = inputId || "";
}

export function setChannelFilter(channel) {
  selectedChannel = parseInt(channel || "0", 10) || 0;
}
