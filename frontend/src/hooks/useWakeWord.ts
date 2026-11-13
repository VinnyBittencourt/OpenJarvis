import { useEffect, useRef } from 'react';
import { transcribeAudio } from '../lib/api';
import { useHudStore } from '../lib/hud';
import { useAppStore } from '../lib/store';
import { useTtsStore } from '../lib/tts';
import { playSound } from '../lib/sounds';
import { cancelTurn, markSpeechEnd, markTranscribed } from '../lib/voiceMetrics';

// Hands-free listening. The microphone is analysed in the browser, every utterance is
// transcribed by the LOCAL Whisper (/v1/speech/transcribe) and only text that contains the
// wake word ("Jarvis") or starts with a greeting opens the conversation. After that first
// request, anything said within two minutes is taken as a request, no wake word needed.
const START_RMS = 0.02; // loudness that starts an utterance
const KEEP_RMS = 0.012; // loudness that keeps it going
const END_SILENCE_MS = 800; // quiet time that ends an utterance
// A pause shorter than this joins the next words to the same request instead of losing them.
const MERGE_MS = 1500;
const MIN_SPEECH_MS = 350; // shorter sounds are clicks and coughs
const MAX_UTTERANCE_MS = 15000;
const SESSION_MS = 120000; // open conversation: time without the wake word after each request or reply
const PREROLL_FRAMES = 10;
// Barge-in: while Jarvis is talking the microphone still listens, with a higher threshold, and
// only the wake word gets through. Saying "Jarvis" stops the voice and the answer in progress.
const BARGE_START_RMS = 0.03;
const BARGE_MAX_MS = 5000;
const WAKE = /(jarvis|jarvys|j[aá]rvis|javis|jarves|jarbis|garvis|jervis|zarvis|charvis|darvis)/i;
// A first phrase may also open the conversation with a greeting instead of the name.
const GREETING = /^[\s¡!,.]*(oi+|ol[aá]|bom dia|boa tarde|boa noite|bom noite)(?![\p{L}])/iu;
// "Desativar a escuta": Jarvis says goodbye, then stops speaking and listening.
const STOP_LISTENING =
  /\b(desativ|deslig|encerr|interromp)\p{L}*\s+(a\s+|o\s+)?(escuta|microfone)(?!\p{L})|\bpar(e|ar|a|em)\s+(a\s+escuta(?!\p{L})|de\s+(me\s+)?(escutar|ouvir)(?!\s+(?!por favor|agora|jarvis)\p{L}))/iu;
// "Jarvis, pare" / "já chega": silence right away, keep listening.
const HUSH =
  /^(?:(?:por favor|please)[\s,]*)?(?:pare|para|parar|chega|j[aá] chega|basta|sil[eê]ncio|quieto|fica quieto|cala(?: a boca)?|stop|enough|that'?s enough|be quiet|quiet)(?:[\s,]+(?:por favor|agora|please|now|jarvis))*[\s.!]*$/iu;
// "Jarvis, desligue" / "estou ocupado": silence and switch the listening off, without a goodbye.
const SHUTDOWN =
  /^(?:(?:por favor|please)[\s,]*)?(?:deslig(?:ue|a|ar)(?: (?:a escuta|tudo|agora))?|estou ocupad[oa]|t[oô] ocupad[oa]|(?:i'?m|i am) busy|shut ?down|turn off)(?:[\s,]+(?:por favor|agora|please|now))*[\s.!]*$/iu;
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

interface Options {
  enabled: boolean;
  busy: boolean; // Jarvis is thinking or speaking: ignore the microphone so it never hears itself
  onCommand: (text: string) => void;
  onInterrupt?: () => void; // stop the voice and the answer in progress
}

export function useWakeWord({ enabled, busy, onCommand, onInterrupt }: Options) {
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;
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
    let barge = false; // the current utterance started while Jarvis was talking
    let bargeChecking = false;
    // Pause in the middle of a sentence: the first part is held so the rest can join it.
    let pending: { frames: Float32Array[]; endedAt: number } | null = null;
    let mergeFrames: Float32Array[] | null = null;
    let token = 0;

    const reset = () => {
      frames = [];
      inSpeech = false;
      loudMs = 0;
    };

    const send = (command: string) => {
      playSound('sent');
      hud.setHeard(command);
      session.current = true;
      awakeUntil.current = Date.now() + SESSION_MS;
      hud.setWake('awake');
      onCommandRef.current(command);
    };

    const goodbye = () => {
      cancelTurn();
      playSound('off');
      session.current = false;
      awakeUntil.current = 0;
      const tts = useTtsStore.getState();
      tts.stop();
      // The goodbye keeps playing after the microphone is released.
      if (tts.available === true) void tts.speak(`bye-${Date.now()}`, 'Até logo, senhor.');
      hud.setActive(false);
    };

    // Stop talking now; the conversation stays open.
    const hush = () => {
      cancelTurn();
      onInterruptRef.current?.();
      useTtsStore.getState().stop();
      playSound('interrupt');
      session.current = true;
      awakeUntil.current = Date.now() + SESSION_MS;
      hud.setWake('awake');
    };

    // Stop talking and stop listening, without a spoken goodbye.
    const shutdown = () => {
      cancelTurn();
      onInterruptRef.current?.();
      useTtsStore.getState().stop();
      playSound('off');
      session.current = false;
      awakeUntil.current = 0;
      hud.setActive(false);
    };

    const english = () => {
      try { return localStorage.getItem('jarvis-lang') === 'en'; } catch { return false; }
    };

    // Speech that Whisper could not make out: a line in the chat, a soft "no" and a red core.
    const notUnderstood = () => {
      cancelTurn();
      playSound('unclear');
      hud.flagUnclear();
      hud.setWake('awake');
      awakeUntil.current = Date.now() + SESSION_MS;
      const app = useAppStore.getState();
      if (app.activeId) {
        app.addMessage(app.activeId, {
          id: `unclear-${Date.now()}`,
          role: 'assistant',
          content: english() ? "Sorry, sir, I didn't catch that." : 'Não entendi o que foi dito, senhor.',
          timestamp: Date.now(),
        });
      }
    };

    // The request itself (after the name): stop words act at once, everything else goes to Jarvis.
    const act = (command: string) => {
      if (HUSH.test(command)) return hush();
      if (SHUTDOWN.test(command)) return shutdown();
      if (STOP_LISTENING.test(command)) return goodbye();
      return send(command);
    };

    const handleText = (raw: string, unclear = false) => {
      const text = raw.trim();
      const open = session.current && Date.now() < awakeUntil.current;
      if (!open) session.current = false;
      const idle = () => {
        cancelTurn();
        hud.setWake(open ? 'awake' : 'standby');
      };
      // Not understood: only said inside a conversation, so background talk never turns it red.
      if (unclear) return open ? notUnderstood() : idle();
      if (!text || !/\p{L}/u.test(text) || NOISE.test(text)) return idle();
      const m = WAKE.exec(text);
      // Inside the open conversation everything is a request, with or without the name.
      if (open) {
        const command = m && m.index < 3 ? text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim() : text;
        return command ? act(command) : idle();
      }
      if (m) {
        const command = text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim();
        if (command) return act(command);
        // Only the name: the conversation opens and Jarvis waits for the request.
        cancelTurn();
        session.current = true;
        awakeUntil.current = Date.now() + SESSION_MS;
        hud.setWake('awake');
        playSound('wake');
        return;
      }
      if (GREETING.test(text)) return send(text);
      idle();
    };

    // An utterance heard over Jarvis's own voice: it only counts when it has the wake word.
    const finishBarge = async () => {
      const captured = frames;
      const long = loudMs >= MIN_SPEECH_MS;
      reset();
      barge = false;
      if (!long || !ctx || captured.length === 0 || bargeChecking) return;
      bargeChecking = true;
      try {
        const result = await transcribeAudio(encodeWav16k(captured, ctx.sampleRate), 'speech.wav');
        const text = (result.text || '').trim();
        const m = WAKE.exec(text);
        if (cancelled) return;
        if (!busyRef.current) {
          // Jarvis finished talking while this was being transcribed: an ordinary utterance
          handleText(text);
          return;
        }
        if (!m) return;
        playSound('interrupt');
        onInterruptRef.current?.();
        const command = text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim();
        session.current = true;
        awakeUntil.current = Date.now() + SESSION_MS;
        hud.setWake('awake');
        if (!command) return;
        if (HUSH.test(command)) return hush();
        if (SHUTDOWN.test(command)) return shutdown();
        if (STOP_LISTENING.test(command)) return goodbye();
        // give the interrupted answer a moment to close before the new request goes out
        window.setTimeout(() => {
          if (!cancelled) send(command);
        }, 400);
      } catch {
        /* a failed barge-in check is simply ignored */
      } finally {
        bargeChecking = false;
      }
    };

    const finish = async () => {
      const merged = mergeFrames;
      mergeFrames = null;
      const captured = merged ? [...merged, ...frames] : frames;
      const long = loudMs >= MIN_SPEECH_MS || merged !== null;
      reset();
      if (!long || !ctx || captured.length === 0) {
        hud.setWake(Date.now() < awakeUntil.current ? 'awake' : 'standby');
        return;
      }
      const mine = ++token;
      pending = { frames: captured, endedAt: Date.now() };
      hud.setWake('transcribing');
      try {
        markSpeechEnd();
        const wav = encodeWav16k(captured, ctx.sampleRate);
        const result = await transcribeAudio(wav, 'speech.wav');
        if (cancelled || mine !== token) return; // he kept talking: the joined audio is transcribed instead
        pending = null;
        markTranscribed();
        handleText(result.text || '', result.language === 'unclear');
      } catch (err) {
        if (!cancelled && mine === token) {
          pending = null;
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
        const copyBusy = new Float32Array(input);
        if (!inSpeech) {
          preroll.push(copyBusy);
          if (preroll.length > PREROLL_FRAMES) preroll.shift();
          if (rms > BARGE_START_RMS && !bargeChecking) {
            inSpeech = true;
            barge = true;
            startedAt = now;
            lastLoud = now;
            loudMs = 0;
            frames = [...preroll];
            preroll.length = 0;
          }
          return;
        }
        if (!barge) {
          reset(); // Jarvis started talking in the middle of an utterance: drop it
          return;
        }
        frames.push(copyBusy);
        if (rms > KEEP_RMS) {
          lastLoud = now;
          loudMs += dt;
        }
        if (now - lastLoud > END_SILENCE_MS || now - startedAt > BARGE_MAX_MS) void finishBarge();
        return;
      }
      if (barge) {
        // Jarvis stopped talking while the user was still speaking: treat it as a normal utterance
        barge = false;
      }
      const current = useHudStore.getState().wake;
      if (current === 'awake' && now > awakeUntil.current) {
        session.current = false;
        hud.setWake('standby');
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
          // Speaking again right after a pause: this is the same sentence, keep the first part.
          if (pending && now - pending.endedAt < MERGE_MS) {
            mergeFrames = pending.frames;
            token++; // the transcription of the first part alone is dropped
          }
          pending = null;
          const w = useHudStore.getState().wake;
          if (w === 'standby' || w === 'transcribing') hud.setWake('capturing');
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
