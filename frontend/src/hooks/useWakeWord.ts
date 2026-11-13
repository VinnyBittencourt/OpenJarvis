import { useEffect, useRef } from 'react';
import { transcribeAudio } from '../lib/api';
import { useHudStore } from '../lib/hud';
import { useTtsStore } from '../lib/tts';

// Hands-free listening. The microphone is analysed in the browser, every utterance is
// transcribed by the LOCAL Whisper (/v1/speech/transcribe) and only text that contains the
// wake word ("Jarvis") or starts with a greeting opens the conversation. After that first
// request, anything said within two minutes is taken as a request, no wake word needed.
const START_RMS = 0.02; // loudness that starts an utterance
const KEEP_RMS = 0.012; // loudness that keeps it going
const END_SILENCE_MS = 600; // quiet time that ends an utterance
const MIN_SPEECH_MS = 350; // shorter sounds are clicks and coughs
const MAX_UTTERANCE_MS = 15000;
const SESSION_MS = 120000; // open conversation: time without the wake word after each request or reply
const PREROLL_FRAMES = 10;
const WAKE = /(jarvis|jarvys|j[aá]rvis|javis|jarves|jarbis|garvis|jervis|zarvis|charvis|darvis)/i;
// A first phrase may also open the conversation with a greeting instead of the name.
const GREETING = /^[\s¡!,.]*(oi+|ol[aá]|bom dia|boa tarde|boa noite|bom noite)(?![\p{L}])/iu;
// "Desativar a escuta": Jarvis says goodbye, then stops speaking and listening.
const STOP_LISTENING =
  /\b(desativ|deslig|encerr|interromp)\p{L}*\s+(a\s+|o\s+)?(escuta|microfone)(?!\p{L})|\bpar(e|ar|a|em)\s+(a\s+escuta(?!\p{L})|de\s+(me\s+)?(escutar|ouvir)(?!\s+(?!por favor|agora|jarvis)\p{L}))/iu;
// Text Whisper invents out of silence or background noise; never treated as a request.
const NOISE = /^(obrigad[oa]\.?|tchau\.?|legendas? .*|.*amara\.org.*|e a[ií]\.?|\.+|m+h*m*\.?|h[uã]m+\.?)$/i;

function encodeWav16k(frames: Float32Array[], sampleRate: number): Blob {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const ratio = sampleRate / 16000;
  const outLen = Math.floor(total / ratio);
  const flat = new Float32Array(total);
  let o = 0;
  for (const f of frames) {
    flat.set(f, o);
    o += f.length;
  }
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += flat[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  const w = (off: number, s: string) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

function beep(ctx: AudioContext) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    /* the chime is optional */
  }
}

interface Options {
  enabled: boolean;
  busy: boolean; // Jarvis is thinking or speaking: ignore the microphone so it never hears itself
  onCommand: (text: string) => void;
}

export function useWakeWord({ enabled, busy, onCommand }: Options) {
  const busyRef = useRef(busy);
  const onCommandRef = useRef(onCommand);
  const awakeUntil = useRef(0);
  const wasBusy = useRef(false);
  onCommandRef.current = onCommand;
  busyRef.current = busy;

  // Once the conversation is open, every reply renews the two minutes. The spoken greeting of
  // a new chat does not open it: the first phrase still needs "Jarvis" or a greeting.
  const session = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && enabled && session.current) {
      awakeUntil.current = Date.now() + SESSION_MS;
      useHudStore.getState().setWake('awake');
    }
    wasBusy.current = busy;
  }, [busy, enabled]);

  // A new chat starts over: the first phrase needs the wake word or a greeting again.
  const greetNonce = useHudStore((s) => s.greetNonce);
  useEffect(() => {
    session.current = false;
    awakeUntil.current = 0;
  }, [greetNonce]);

  useEffect(() => {
    if (!enabled) return;
    const hud = useHudStore.getState();
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;

    const preroll: Float32Array[] = [];
    let frames: Float32Array[] = [];
    let inSpeech = false;
    let startedAt = 0;
    let lastLoud = 0;
    let loudMs = 0;
    let lastFrameAt = 0;

    const reset = () => {
      frames = [];
      inSpeech = false;
      loudMs = 0;
    };

    const send = (command: string) => {
      hud.setHeard(command);
      session.current = true;
      awakeUntil.current = Date.now() + SESSION_MS;
      hud.setWake('awake');
      onCommandRef.current(command);
    };

    const goodbye = () => {
      session.current = false;
      awakeUntil.current = 0;
      const tts = useTtsStore.getState();
      tts.stop();
      // The goodbye keeps playing after the microphone is released.
      if (tts.available === true) void tts.speak(`bye-${Date.now()}`, 'Até logo, senhor.');
      hud.setActive(false);
    };

    const handleText = (raw: string) => {
      const text = raw.trim();
      const open = session.current && Date.now() < awakeUntil.current;
      if (!open) session.current = false;
      const idle = () => hud.setWake(open ? 'awake' : 'standby');
      if (!text || !/\p{L}/u.test(text) || NOISE.test(text)) return idle();
      // Inside the open conversation everything is a request, with or without the name.
      if (open) return STOP_LISTENING.test(text) ? goodbye() : send(text);
      const m = WAKE.exec(text);
      if (m) {
        const command = text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim();
        if (command) return STOP_LISTENING.test(command) ? goodbye() : send(command);
        // Only the name: the conversation opens and Jarvis waits for the request.
        session.current = true;
        awakeUntil.current = Date.now() + SESSION_MS;
        hud.setWake('awake');
        if (ctx) beep(ctx);
        return;
      }
      if (GREETING.test(text)) return send(text);
      idle();
    };

    const finish = async () => {
      const captured = frames;
      const long = loudMs >= MIN_SPEECH_MS;
      reset();
      if (!long || !ctx || captured.length === 0) {
        hud.setWake(Date.now() < awakeUntil.current ? 'awake' : 'standby');
        return;
      }
      hud.setWake('transcribing');
      try {
        const wav = encodeWav16k(captured, ctx.sampleRate);
        const result = await transcribeAudio(wav, 'speech.wav');
        if (!cancelled) handleText(result.text || '');
      } catch (err) {
        if (!cancelled) {
          hud.setWake('standby');
          hud.setError(err instanceof Error ? err.message : 'Transcription failed');
        }
      }
    };

    const onFrame = (input: Float32Array) => {
      const now = Date.now();
      const dt = lastFrameAt ? now - lastFrameAt : 0;
      lastFrameAt = now;
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      hud.setLevel(Math.min(1, rms * 9));

      if (busyRef.current) {
        reset();
        preroll.length = 0;
        return;
      }
      const current = useHudStore.getState().wake;
      if (current === 'awake' && now > awakeUntil.current) {
        session.current = false;
        hud.setWake('standby');
      }
      if (current === 'transcribing') {
        preroll.length = 0;
        return; // one utterance at a time
      }
      const copy = new Float32Array(input);
      if (!inSpeech) {
        preroll.push(copy);
        if (preroll.length > PREROLL_FRAMES) preroll.shift();
        if (rms > START_RMS) {
          inSpeech = true;
          startedAt = now;
          lastLoud = now;
          loudMs = 0;
          frames = [...preroll];
          preroll.length = 0;
          if (useHudStore.getState().wake === 'standby') hud.setWake('capturing');
        }
        return;
      }
      frames.push(copy);
      if (rms > KEEP_RMS) {
        lastLoud = now;
        loudMs += dt;
      }
      if (now - lastLoud > END_SILENCE_MS || now - startedAt > MAX_UTTERANCE_MS) void finish();
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        await ctx.resume();
        const src = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(2048, 1, 1);
        proc.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
        src.connect(proc);
        proc.connect(ctx.destination); // outputs silence; required for the processor to run
        hud.setError(null);
        hud.setWake('standby');
      } catch {
        hud.setError('Microphone blocked. Allow it in the browser and click Activate again.');
        hud.setActive(false);
      }
    })();

    return () => {
      cancelled = true;
      proc?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      useHudStore.getState().setWake('off');
      useHudStore.getState().setLevel(0);
    };
  }, [enabled]);
}
