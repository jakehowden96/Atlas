import { log } from "./logger";

/** One context for the app's lifetime: browsers cap how many can exist, and a
 *  new one per ping would also start suspended each time. */
let context: AudioContext | null = null;

const PING_HZ = 880;
const PING_SECONDS = 0.18;
const PING_PEAK_GAIN = 0.15;

/**
 * A short sine ping for "a session needs you". Synthesised, so no audio asset
 * or dependency. Never throws: a missing or blocked audio device must not break
 * the needs-you handler that calls it.
 */
export function playPing(): void {
  try {
    context ??= new AudioContext();
    const ctx = context;
    // Autoplay policy can leave a context suspended until a user gesture; the
    // resume is a no-op once one has happened.
    if (ctx.state === "suspended") void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.value = PING_HZ;
    // A fast attack and an exponential fade avoid the click of a hard start/stop.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(PING_PEAK_GAIN, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + PING_SECONDS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + PING_SECONDS);
  } catch (e) {
    log.warn("sound", `could not play the needs-you ping: ${e}`);
  }
}
