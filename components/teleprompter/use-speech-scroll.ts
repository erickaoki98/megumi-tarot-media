"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from "react";
import { matchPosition, tokenize, type Token } from "./match-position";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

export type SpeechSupport = "unknown" | "supported" | "unsupported";

export type UseSpeechScroll = {
  tokens: Token[];
  currentIndex: number;
  listening: boolean;
  support: SpeechSupport;
  start: () => void;
  stop: () => void;
  resync: (index: number) => void;
  advance: (n?: number) => void;
  reset: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useSpeechScroll(scriptText: string): UseSpeechScroll {
  const tokensRef = useRef<Token[]>([]);
  const indexRef = useRef(0);
  const wantListeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [tokens, setTokens] = useState<Token[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [support, setSupport] = useState<SpeechSupport>("unknown");

  useEffect(() => {
    const t = tokenize(scriptText);
    tokensRef.current = t;
    indexRef.current = 0;
    setTokens(t);
    setCurrentIndex(0);
  }, [scriptText]);

  useEffect(() => {
    setSupport(getRecognitionCtor() ? "supported" : "unsupported");
  }, []);

  const setIndex = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(next, tokensRef.current.length));
    indexRef.current = clamped;
    setCurrentIndex(clamped);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupport("unsupported");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let heard = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        heard += event.results[i][0].transcript + " ";
      }
      const heardTokens = heard.trim().split(/\s+/);
      const next = matchPosition(tokensRef.current, heardTokens, indexRef.current);
      if (next !== indexRef.current) setIndex(next);
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      } else {
        setListening(false);
      }
    };
    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    try {
      recognition.start();
      setListening(true);
    } catch {
      /* ignore double-start */
    }
  }, [setIndex]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const resync = useCallback((index: number) => setIndex(index), [setIndex]);
  const advance = useCallback((n = 1) => setIndex(indexRef.current + n), [setIndex]);
  const reset = useCallback(() => setIndex(0), [setIndex]);

  useEffect(
    () => () => {
      wantListeningRef.current = false;
      recognitionRef.current?.stop();
    },
    [],
  );

  return { tokens, currentIndex, listening, support, start, stop, resync, advance, reset };
}
