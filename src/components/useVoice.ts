"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice input via the browser's built-in speech recognition (Chrome, Edge, Safari, Android).
// Speaks in the user's browser language by default; the transcript fills the chat box so they can
// check it before sending (nothing is sent automatically).

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(onText: (text: string, final: boolean) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  useEffect(() => {
    // feature-detect after mount (no SSR mismatch)
    const t = setTimeout(() => setSupported(!!getRecognition()), 0);
    return () => clearTimeout(t);
  }, []);

  const start = useCallback(() => {
    const R = getRecognition();
    if (!R) return;
    setError(undefined);
    const r = new R();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    let text = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) text += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current((text + interim).trim(), false);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access was blocked." : e.error === "no-speech" ? "I didn't hear anything — try again." : `Voice error: ${e.error}`);
    r.onend = () => {
      setListening(false);
      if (text.trim()) cb.current(text.trim(), true);
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);
  return { supported, listening, error, start, stop };
}
