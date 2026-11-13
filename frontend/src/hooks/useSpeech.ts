import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

// Jarvis patch: stop recording by itself after the speaker goes quiet.
const SPEECH_RMS = 0.015; // volume level that counts as speech
const SILENCE_MS = 1300; // quiet time after speech that ends the recording
const NO_SPEECH_MS = 8000; // give up if nobody speaks
const MAX_MS = 60000; // hard limit for one recording

export function useSpeech(onAutoText?: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const monitorRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const onAutoTextRef = useRef(onAutoText);
  onAutoTextRef.current = onAutoText;

  // Check if speech backend is available on mount
  useEffect(() => {
    fetchSpeechHealth()
      .then((health) => setAvailable(health.available))
      .catch(() => setAvailable(false));
  }, []);

  const stopMonitor = useCallback(() => {
    if (monitorRef.current !== null) {
      window.clearInterval(monitorRef.current);
      monitorRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => stopMonitor, [stopMonitor]);

  const stopRecording = useCallback(async (): Promise<string> => {
    stopMonitor();
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        reject(new Error('Not recording'));
        return;
      }

      recorder.onstop = async () => {
        setState('transcribing');

        // Stop all audio tracks
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];

        try {
          const result = await transcribeAudio(blob);
          setState('idle');
          resolve(result.text);
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          reject(err);
        }
      };

      recorder.stop();
    });
  }, [stopMonitor]);

  // Discard the recording without sending it to Whisper (nobody spoke).
  const cancelRecording = useCallback(() => {
    stopMonitor();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setState('idle');
  }, [stopMonitor]);

  const startMonitor = useCallback(
    (stream: MediaStream) => {
      const AC: typeof AudioContext | undefined =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const startedAt = Date.now();
      let heard = false;
      let lastLoud = startedAt;

      monitorRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > SPEECH_RMS) {
          heard = true;
          lastLoud = now;
        }
        const silentFor = now - lastLoud;
        if (heard && silentFor >= SILENCE_MS) {
          stopRecording()
            .then((text) => {
              if (text) onAutoTextRef.current?.(text);
            })
            .catch(() => {
              // Error is captured in state
            });
        } else if (!heard && now - startedAt >= NO_SPEECH_MS) {
          cancelRecording();
        } else if (now - startedAt >= MAX_MS) {
          stopRecording()
            .then((text) => {
              if (text) onAutoTextRef.current?.(text);
            })
            .catch(() => {});
        }
      }, 100);
    },
    [stopRecording, cancelRecording],
  );

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');
      startMonitor(stream);
    } catch (err) {
      setError('Microphone access denied');
      setState('idle');
    }
  }, [startMonitor]);

  return {
    state,
    error,
    available,
    startRecording,
    stopRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
