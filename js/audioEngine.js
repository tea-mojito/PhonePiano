const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
export const audio = new AudioContextCtor();
export const masterGain = audio.createGain();
masterGain.gain.setValueAtTime(1, audio.currentTime);
masterGain.connect(audio.destination);

const activeVoices = new Map();
let synthType = "triangle";

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export async function ensureAudioStarted() {
  if (audio.state !== "running") {
    try {
      await audio.resume();
    } catch {
      // ignore
    }
  }
}

export function setSynthType(type) {
  synthType = type || "triangle";
}

export function setMasterVolume(value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  masterGain.gain.setTargetAtTime(v, audio.currentTime, 0.02);
}

export function startNote(midi, velocity = 0.9) {
  stopNote(midi);

  const now = audio.currentTime;
  const freq = midiToFreq(midi);
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = synthType;
  osc.frequency.value = freq;

  const amp = Math.max(0.04, Math.min(1, velocity));
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(amp * 0.4, now + 0.01);
  gain.gain.setTargetAtTime(amp * 0.18, now + 0.05, 0.18);

  osc.connect(gain).connect(masterGain);
  osc.start(now);

  activeVoices.set(midi, { osc, gain });
}

export function stopNote(midi) {
  const voice = activeVoices.get(midi);
  if (!voice) return;

  const now = audio.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.15);
    voice.osc.stop(now + 0.6);
  } catch {
    // ignore
  }

  activeVoices.delete(midi);
}

export function allNotesOff() {
  for (const midi of [...activeVoices.keys()]) {
    stopNote(midi);
  }
}
