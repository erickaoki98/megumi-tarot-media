# Teleprompter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only **Teleprompter** tab to `megumi-tarot-media` that scrolls a script in real time as the user speaks (voice tracking), over a live front-camera background, with clean in-app recording + download.

**Architecture:** Isolated module under `components/teleprompter/`. Pure, unit-tested logic (`match-position.ts`, `is-mobile.ts`) drives React hooks (`use-speech-scroll.ts`, `use-camera-recorder.ts`, `use-is-mobile.ts`). A full-screen `PrompterStage` composes them; `TeleprompterView` applies the desktop block and the text-source selector. The giant `pulsepost-app.tsx` is touched minimally (1 nav item, the `Record<ViewKey>` maps, 1 icon case, 1 render line) plus `ViewKey` in `types/app.ts`.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind (custom `violet`/`ink` theme) · Web Speech API (`SpeechRecognition`) · `getUserMedia` + `MediaRecorder` · Vitest (new, for pure logic).

**Key constraints (from the spec):**
- Mobile-first. On desktop the tab shows the **exact** text `Página acessível apenas via mobile`.
- The text overlay is HTML over the `<video>`, so recordings are **clean** (camera only, no text).
- iOS risks (speech in standalone PWA; mic shared by speech + recorder) are validated on device in Task 8; a manual auto-scroll fallback guarantees the tab always works.
- Phase 2 (PiP floating mode) is Task 9, done only after Phase 1 is verified on an iPhone.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `components/teleprompter/match-position.ts` | Pure: tokenize/normalize text + advance the prompter pointer from heard words. |
| `components/teleprompter/match-position.test.ts` | Vitest unit tests for the matcher. |
| `components/teleprompter/is-mobile.ts` | Pure: decide mobile vs desktop from pointer/width/UA. |
| `components/teleprompter/is-mobile.test.ts` | Vitest unit tests for the decision. |
| `components/teleprompter/use-is-mobile.ts` | Hook: wraps `isMobileDevice` with a `resize` listener; SSR-safe (`null` until known). |
| `components/teleprompter/use-camera-recorder.ts` | Hook: front camera preview + `MediaRecorder` clean recording + download URL + permission state. |
| `components/teleprompter/use-speech-scroll.ts` | Hook: `SpeechRecognition` (pt-BR) → `matchPosition` → current word index; support detection + manual `advance`. |
| `components/teleprompter/prompter-stage.tsx` | Full-screen UI: camera background + scrolling text + control bar + manual fallback. |
| `components/teleprompter/teleprompter-view.tsx` | Tab screen: desktop block + text-source selector (scripts + paste) + launch stage. |
| `components/teleprompter/use-pip-prompter.ts` | (Phase 2) Hook: canvas→stream→Picture-in-Picture floating prompter. |
| `vitest.config.ts` | Vitest config (node env, our test globs). |
| `types/app.ts` | **Modify**: add `"teleprompter"` to `ViewKey`. |
| `components/pulsepost-app.tsx` | **Modify**: import, nav item, `viewMeta`, `pageTitleMap`, `NavIcon` case, render line. |
| `package.json` | **Modify**: add `vitest` devDependency + `test` script. |

Build stays green after every task: hooks/components are created bottom-up (an unused new file never breaks the build); the tab is wired only in Task 7, after all imports exist.

---

### Task 1: Test runner + `match-position.ts` (pure matcher, TDD)

**Files:**
- Modify: `package.json` (add `vitest` + `test` script)
- Create: `vitest.config.ts`
- Create: `components/teleprompter/match-position.ts`
- Test: `components/teleprompter/match-position.test.ts`

- [ ] **Step 1: Install Vitest and add the test script**

Run:
```bash
cd /Users/erickaoki/megumi-tarot-media
npm install -D vitest@^2
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["components/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `components/teleprompter/match-position.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalize, tokenize, matchPosition } from "./match-position";

describe("normalize", () => {
  it("lowercases and strips accents + punctuation", () => {
    expect(normalize("Olá,")).toBe("ola");
    expect(normalize("AÇÃO!")).toBe("acao");
  });
});

describe("tokenize", () => {
  it("splits into normalized tokens, keeping raw", () => {
    const t = tokenize("Olá pessoal, tudo bem?");
    expect(t.map((x) => x.norm)).toEqual(["ola", "pessoal", "tudo", "bem"]);
    expect(t[0].raw).toBe("Olá");
  });
});

describe("matchPosition", () => {
  const script = tokenize("olá pessoal tudo bem hoje vou falar de tarot");

  it("advances to the next word on exact speech", () => {
    expect(matchPosition(script, ["olá", "pessoal", "tudo", "bem"], 0)).toBe(4);
  });
  it("tolerates a skipped word", () => {
    expect(matchPosition(script, ["olá", "tudo", "bem"], 0)).toBe(4);
  });
  it("tolerates a misrecognized last word", () => {
    expect(matchPosition(script, ["olá", "pessoal", "tudo", "xpto"], 0)).toBe(4);
  });
  it("stays put when nothing matches", () => {
    expect(matchPosition(script, ["banana", "abacaxi"], 0)).toBe(0);
  });
  it("does not jump far on a single common word", () => {
    expect(matchPosition(script, ["bem"], 0)).toBe(0);
  });
  it("keeps progressing from a mid-script position", () => {
    expect(matchPosition(script, ["hoje", "vou", "falar"], 4)).toBe(7);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./match-position` (file does not exist yet).

- [ ] **Step 5: Implement `match-position.ts`**

Create `components/teleprompter/match-position.ts`:
```ts
export type Token = { raw: string; norm: string };

const COMBINING = /[̀-ͯ]/g;

/** Lowercase, strip accents, keep only a-z0-9. */
export function normalize(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Split text on whitespace into tokens, dropping pure punctuation. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const norm = normalize(raw);
    if (!norm) continue;
    tokens.push({ raw, norm });
  }
  return tokens;
}

const WINDOW = 18; // how far ahead of the pointer to search
const LOOKBACK = 5; // how many recent heard words to align

/**
 * Given the script tokens, the recently heard words, and the current pointer,
 * return the new pointer (index of the next expected token). Never moves
 * backward; guards against single common-word false jumps.
 */
export function matchPosition(
  scriptTokens: Token[],
  heardTokens: string[],
  currentIndex: number,
): number {
  const heard = heardTokens.map(normalize).filter(Boolean).slice(-LOOKBACK);
  if (heard.length === 0) return currentIndex;

  const end = Math.min(scriptTokens.length, currentIndex + WINDOW);
  let best = currentIndex;
  let bestScore = 0;

  for (let p = currentIndex; p < end; p++) {
    let score = 0;
    for (let k = 0; k < heard.length; k++) {
      const sIdx = p - k;
      if (sIdx < currentIndex - 1 || sIdx < 0) break;
      if (scriptTokens[sIdx].norm === heard[heard.length - 1 - k]) score++;
    }
    if (score > 0 && score >= bestScore) {
      bestScore = score;
      best = p + 1; // next expected token
    }
  }

  // A single matched (possibly common) word must not cause a big jump.
  if (bestScore < 2 && best - currentIndex > 3) return currentIndex;
  return Math.max(best, currentIndex);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `match-position` tests green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts components/teleprompter/match-position.ts components/teleprompter/match-position.test.ts
git commit -m "feat(teleprompter): add Vitest + voice-tracking matcher" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `is-mobile.ts` (pure decision, TDD) + `use-is-mobile.ts` hook

**Files:**
- Create: `components/teleprompter/is-mobile.ts`
- Test: `components/teleprompter/is-mobile.test.ts`
- Create: `components/teleprompter/use-is-mobile.ts`

- [ ] **Step 1: Write the failing test**

Create `components/teleprompter/is-mobile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isMobileDevice } from "./is-mobile";

const iPhoneUA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const macUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

describe("isMobileDevice", () => {
  it("true for an iPhone user agent", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 390, userAgent: iPhoneUA })).toBe(true);
  });
  it("true for a narrow coarse-pointer viewport (device emulation)", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 414, userAgent: macUA })).toBe(true);
  });
  it("false for desktop (fine pointer, wide, mac UA)", () => {
    expect(isMobileDevice({ pointerCoarse: false, viewportWidth: 1440, userAgent: macUA })).toBe(false);
  });
  it("false for a wide coarse screen (large tablet landscape)", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 1200, userAgent: macUA })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./is-mobile`.

- [ ] **Step 3: Implement `is-mobile.ts`**

Create `components/teleprompter/is-mobile.ts`:
```ts
export type MobileSignals = {
  pointerCoarse: boolean;
  viewportWidth: number;
  userAgent: string;
};

const MAX_MOBILE_WIDTH = 820;

/** "Mobile" = a phone UA, OR a coarse pointer on a small viewport. */
export function isMobileDevice({ pointerCoarse, viewportWidth, userAgent }: MobileSignals): boolean {
  const uaMobile = /iphone|ipod|android.*mobile/i.test(userAgent);
  const smallCoarse = pointerCoarse && viewportWidth <= MAX_MOBILE_WIDTH;
  return uaMobile || smallCoarse;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `is-mobile` tests green (and Task 1 tests still pass).

- [ ] **Step 5: Implement the hook `use-is-mobile.ts`**

Create `components/teleprompter/use-is-mobile.ts`:
```ts
"use client";

import { useEffect, useState } from "react";
import { isMobileDevice } from "./is-mobile";

/** Returns null until determined on the client, then true/false. Re-evaluates on resize. */
export function useIsMobile(): boolean | null {
  const [mobile, setMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const compute = () =>
      setMobile(
        isMobileDevice({
          pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
          viewportWidth: window.innerWidth,
          userAgent: navigator.userAgent,
        }),
      );
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return mobile;
}
```

- [ ] **Step 6: Commit**

```bash
git add components/teleprompter/is-mobile.ts components/teleprompter/is-mobile.test.ts components/teleprompter/use-is-mobile.ts
git commit -m "feat(teleprompter): add mobile-only detection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `use-camera-recorder.ts` (front camera + clean recording)

**Files:**
- Create: `components/teleprompter/use-camera-recorder.ts`

Not unit-tested (browser-only APIs); verified live in Task 8.

- [ ] **Step 1: Implement the hook**

Create `components/teleprompter/use-camera-recorder.ts`:
```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraPermission = "idle" | "prompting" | "granted" | "denied" | "unsupported";

export type UseCameraRecorder = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  permission: CameraPermission;
  recording: boolean;
  elapsedMs: number;
  recordedUrl: string | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  startRecording: () => void;
  stopRecording: () => void;
};

export function useCameraRecorder(facingMode: "user" | "environment" = "user"): UseCameraRecorder {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const [permission, setPermission] = useState<CameraPermission>("idle");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setError("Câmera não suportada neste navegador.");
      return;
    }
    if (streamRef.current) return; // already running
    try {
      setPermission("prompting");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPermission("granted");
      setError(null);
    } catch {
      setPermission("denied");
      setError("Acesso à câmera/microfone negado. Libere a permissão e tente de novo.");
    }
  }, [facingMode]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setError("Gravação de vídeo não suportada neste navegador.");
      return;
    }
    chunksRef.current = [];
    const mime =
      ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      ) || "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      setRecordedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    };
    recorder.start();
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setRecording(true);
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, permission, recording, elapsedMs, recordedUrl, error, start, stop, startRecording, stopRecording };
}
```

- [ ] **Step 2: Verify it type-checks via the build**

Run: `npm run build`
Expected: PASS (compiles; the new file is unused for now, which is fine).

- [ ] **Step 3: Commit**

```bash
git add components/teleprompter/use-camera-recorder.ts
git commit -m "feat(teleprompter): add camera + clean recorder hook" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `use-speech-scroll.ts` (voice tracking)

**Files:**
- Create: `components/teleprompter/use-speech-scroll.ts`

- [ ] **Step 1: Implement the hook**

Create `components/teleprompter/use-speech-scroll.ts`:
```ts
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
```

- [ ] **Step 2: Verify it type-checks via the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/teleprompter/use-speech-scroll.ts
git commit -m "feat(teleprompter): add speech voice-tracking hook" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `prompter-stage.tsx` (full-screen camera + text + controls)

**Files:**
- Create: `components/teleprompter/prompter-stage.tsx`

- [ ] **Step 1: Implement the component**

Create `components/teleprompter/prompter-stage.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { classNames } from "@/lib/utils";
import { useSpeechScroll } from "./use-speech-scroll";
import { useCameraRecorder } from "./use-camera-recorder";

const FONT_SIZES = [22, 28, 34, 42, 52];

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function CtrlButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "min-w-[60px] flex-1 rounded-2xl px-2 py-3 text-xs font-medium transition",
        active ? "bg-white text-black" : "bg-white/15 text-white backdrop-blur",
      )}
    >
      {label}
    </button>
  );
}

export function PrompterStage({ scriptText, onClose }: { scriptText: string; onClose: () => void }) {
  const speech = useSpeechScroll(scriptText);
  const camera = useCameraRecorder("user");

  const [running, setRunning] = useState(false);
  const [fontIdx, setFontIdx] = useState(2);
  const [mirror, setMirror] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [manual, setManual] = useState(false);
  const [speed, setSpeed] = useState(3);

  const currentRef = useRef<HTMLSpanElement | null>(null);
  const voiceMode = !manual && speech.support !== "unsupported";

  // Camera on/off (also starts on mount).
  useEffect(() => {
    if (cameraOn) camera.start();
    else camera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  // Stop everything on unmount.
  useEffect(() => () => camera.stop(), [camera]);

  // Drive voice recognition while running in voice mode.
  useEffect(() => {
    if (running && voiceMode) speech.start();
    else speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, voiceMode]);

  // Manual / fallback auto-advance.
  useEffect(() => {
    if (!running || voiceMode) return;
    const id = window.setInterval(() => speech.advance(1), Math.max(120, 700 - speed * 120));
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, voiceMode, speed]);

  // Keep the current word centered.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [speech.currentIndex]);

  const fontSize = FONT_SIZES[fontIdx];

  return (
    <div className="fixed inset-0 z-50 select-none bg-black text-white">
      <video
        ref={camera.videoRef}
        playsInline
        muted
        className={classNames(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          cameraOn && camera.permission === "granted" ? "opacity-100" : "opacity-0",
          mirror ? "scale-x-[-1]" : "",
        )}
      />
      <div className="absolute inset-0 bg-black/45" />

      <div className="absolute inset-x-0 top-0 bottom-44 overflow-y-auto px-6 py-[42vh]">
        <p className="mx-auto max-w-3xl font-medium leading-[1.5] tracking-tight" style={{ fontSize }}>
          {speech.tokens.map((tok, i) => {
            const spoken = i < speech.currentIndex;
            const current = i === speech.currentIndex;
            return (
              <span
                key={i}
                ref={current ? currentRef : undefined}
                onClick={() => speech.resync(i)}
                className={classNames(
                  "cursor-pointer transition-colors",
                  spoken ? "text-white/35" : current ? "text-amber-300" : "text-white",
                )}
              >
                {tok.raw}{" "}
              </span>
            );
          })}
        </p>
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-xs">
        <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-4 py-2 font-medium backdrop-blur">
          ✕ Fechar
        </button>
        <div className="flex items-center gap-2">
          {camera.recording && (
            <span className="flex items-center gap-1 rounded-full bg-red-600/90 px-3 py-1 font-semibold">
              <span className="size-2 animate-pulse rounded-full bg-white" />
              {formatTime(camera.elapsedMs)}
            </span>
          )}
          {speech.support === "unsupported" && (
            <span className="rounded-full bg-amber-500/90 px-3 py-1 font-medium text-black">Voz indisponível — modo manual</span>
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-6">
        {camera.error && <p className="text-center text-sm text-amber-300">{camera.error}</p>}
        {camera.recordedUrl && !camera.recording && (
          <a
            href={camera.recordedUrl}
            download="teleprompter.webm"
            className="block rounded-2xl bg-emerald-500 px-4 py-3 text-center text-sm font-semibold text-black"
          >
            ⬇ Baixar vídeo gravado
          </a>
        )}
        {(manual || speech.support === "unsupported") && (
          <label className="flex items-center gap-3 text-xs text-white/80">
            Velocidade
            <input
              type="range"
              min={1}
              max={5}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="flex-1"
            />
          </label>
        )}
        <div className="flex items-center gap-2">
          <CtrlButton label={running ? "⏸ Pausar" : "▶ Iniciar"} active={running} onClick={() => setRunning((r) => !r)} />
          <CtrlButton
            label={camera.recording ? "■ Parar" : "● Gravar"}
            active={camera.recording}
            onClick={() => (camera.recording ? camera.stopRecording() : camera.startRecording())}
          />
          <CtrlButton label={`A ${fontSize}`} onClick={() => setFontIdx((i) => (i + 1) % FONT_SIZES.length)} />
          <CtrlButton label={mirror ? "Espelho ✓" : "Espelho"} active={mirror} onClick={() => setMirror((m) => !m)} />
          <CtrlButton label={cameraOn ? "Câmera ✓" : "Câmera"} active={cameraOn} onClick={() => setCameraOn((c) => !c)} />
          {speech.support !== "unsupported" && (
            <CtrlButton label={manual ? "Manual ✓" : "Voz"} active={manual} onClick={() => setManual((m) => !m)} />
          )}
          <CtrlButton label="↺" onClick={() => speech.reset()} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks via the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/teleprompter/prompter-stage.tsx
git commit -m "feat(teleprompter): add full-screen prompter stage" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `teleprompter-view.tsx` (desktop block + text source)

**Files:**
- Create: `components/teleprompter/teleprompter-view.tsx`

- [ ] **Step 1: Implement the component**

Create `components/teleprompter/teleprompter-view.tsx`:
```tsx
"use client";

import { useState } from "react";
import { classNames } from "@/lib/utils";
import type { PersistedState } from "@/types/app";
import { useIsMobile } from "./use-is-mobile";
import { PrompterStage } from "./prompter-stage";

export function TeleprompterView({ data }: { data: PersistedState }) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [active, setActive] = useState(false);

  if (isMobile === null) {
    return <p className="text-sm text-ink/50">Carregando…</p>;
  }

  if (!isMobile) {
    return (
      <div className="grid min-h-[40vh] place-items-center rounded-[1.4rem] border border-violet/10 bg-violet/5 p-10 text-center">
        <p className="text-lg font-medium text-ink/70">Página acessível apenas via mobile</p>
      </div>
    );
  }

  if (active && text.trim()) {
    return <PrompterStage scriptText={text} onClose={() => setActive(false)} />;
  }

  return (
    <section className="grid gap-5">
      <div className="grid gap-3 rounded-[1.4rem] border border-violet/10 bg-violet/5 p-4">
        <p className="text-sm font-medium text-ink/75">Escolha um roteiro</p>
        {data.scripts.length === 0 ? (
          <p className="text-sm text-ink/50">Nenhum roteiro cadastrado ainda. Cole um texto abaixo.</p>
        ) : (
          <div className="grid gap-2">
            {data.scripts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setText(s.body)}
                className={classNames(
                  "rounded-2xl border px-4 py-3 text-left text-sm transition",
                  text === s.body ? "border-violet bg-white" : "border-violet/12 bg-white/60 hover:bg-white",
                )}
              >
                <span className="font-medium text-ink/80">{s.title}</span>
                <span className="mt-1 block truncate text-xs text-ink/45">{s.body.slice(0, 80)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="grid gap-2 text-sm font-medium">
        <span className="text-ink/75">Ou cole / edite o texto</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Cole aqui o texto que você vai narrar…"
          className="rounded-2xl border border-violet/12 bg-white px-4 py-3 text-sm outline-none focus:border-violet"
        />
      </label>

      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => setActive(true)}
        className="rounded-full bg-violet px-5 py-3 text-sm font-medium text-white shadow-lg shadow-violet/15 transition enabled:hover:bg-violet/85 disabled:opacity-40"
      >
        ▶ Iniciar teleprompter
      </button>

      <p className="text-xs leading-5 text-ink/45">
        Dica: o texto rola conforme você fala. Toque numa palavra para re-sincronizar. O vídeo gravado sai limpo (sem o
        texto na imagem). Para acompanhamento por voz, use no Safari; se a voz não funcionar, o modo manual assume
        automaticamente.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks via the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/teleprompter/teleprompter-view.tsx
git commit -m "feat(teleprompter): add tab view with desktop block + source picker" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Wire the tab into the app

**Files:**
- Modify: `types/app.ts` (the `ViewKey` union)
- Modify: `components/pulsepost-app.tsx` (import, nav item, `viewMeta`, `pageTitleMap`, `NavIcon`, render)

- [ ] **Step 1: Add `"teleprompter"` to `ViewKey`**

In `types/app.ts`, change the `ViewKey` union (currently ends at `"config"`):
```ts
export type ViewKey =
  | "dashboard"
  | "library"
  | "calendar"
  | "scheduler"
  | "scripts"
  | "plan"
  | "insights"
  | "competitors"
  | "reposts"
  | "users"
  | "config"
  | "teleprompter";
```

- [ ] **Step 2: Run the build to see the forced gaps**

Run: `npm run build`
Expected: FAIL — TypeScript errors that `viewMeta` and `pageTitleMap` are missing the `"teleprompter"` key. (This is expected and confirms the maps are exhaustive.)

- [ ] **Step 3: Import the view**

In `components/pulsepost-app.tsx`, just after the existing media-picker import (line ~31):
```tsx
import { MediaPicker, MediaPickerTrigger } from "@/components/media-picker";
import { TeleprompterView } from "@/components/teleprompter/teleprompter-view";
```

- [ ] **Step 4: Add the nav item**

In the nav items array (the list that starts with `{ key: "dashboard", label: "Dashboard" }`), add after the `scripts` entry:
```tsx
                  { key: "scripts", label: "Roteiros" },
                  { key: "teleprompter", label: "Teleprompter" },
```

- [ ] **Step 5: Add the `viewMeta` entry**

In the `viewMeta` object, add a `teleprompter` entry (e.g. after the `scripts` block):
```tsx
  teleprompter: {
    title: "Teleprompter",
    description: "Leia seus roteiros em tela cheia com a câmera, rolagem por voz e gravação. Use no celular.",
    actionLabel: "Ver roteiros",
    onAction: (setActiveView) => () => setActiveView("scripts"),
  },
```

- [ ] **Step 6: Add the `pageTitleMap` entry**

In `pageTitleMap`, add:
```tsx
  config: "Config",
  teleprompter: "Teleprompter",
```

- [ ] **Step 7: Add the `NavIcon` case**

In `NavIcon`'s `switch`, add before `default:`:
```tsx
    case "teleprompter":
      return <ScriptIcon className="size-4" />;
    default:
```

- [ ] **Step 8: Render the view**

In the render section, after the Scripts block (`{activeView === "scripts" ? (<ScriptsView .../>) : null}`), add:
```tsx
              {/* ── Teleprompter ── */}
              {activeView === "teleprompter" ? (
                <TeleprompterView data={data} />
              ) : null}
```

- [ ] **Step 9: Run the build to verify it passes**

Run: `npm run build`
Expected: PASS — no type errors; the `teleprompter` tab is wired.

- [ ] **Step 10: Commit**

```bash
git add types/app.ts components/pulsepost-app.tsx
git commit -m "feat(teleprompter): wire teleprompter tab into the app" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Live verification (preview emulation + iPhone)

No code. Validate the build and the iOS risks from the spec (§8). The agent does the desktop/emulation checks; the user does the iPhone checks.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (project dev port is 3007; preview entry "Media Center"). Use the preview tooling to open the app.

- [ ] **Step 2: Desktop block check (real desktop viewport)**

Open the app at desktop width, go to the **Teleprompter** tab.
Expected: shows exactly `Página acessível apenas via mobile` (no camera, no selector).

- [ ] **Step 3: Mobile emulation check**

Enable device emulation (e.g. iPhone) so `(pointer: coarse)` + narrow width are true, reload, open **Teleprompter**.
Expected: shows the script picker + textarea + "Iniciar teleprompter". Pick/paste text → Iniciar → camera permission prompt → camera background appears; control bar visible.
- Press ▶ Iniciar and read aloud (desktop Chrome supports speech): text advances and highlights.
- Press ● Gravar, read a few seconds, ■ Parar → "Baixar vídeo gravado" appears; download and confirm the video shows the **camera only, no text**.
- Toggle "Voz"→Manual: a speed slider appears and the text auto-advances.
- Tap a word: pointer jumps there.

- [ ] **Step 4: iPhone device checks (hand off to the user)**

Ask the user to open the deployed/preview URL on their iPhone (Safari first, then "Add to Home Screen" PWA) and report:
1. Does the camera background appear and is recording downloadable? (validates recorder on iOS)
2. With "Voz" on, does the text follow speech in **Safari**? And in **installed PWA** mode? (validates the standalone-PWA speech risk)
3. While recording **and** voice-tracking at the same time, do both work, or does one stop? (validates the shared-mic risk)
If speech fails in PWA mode, confirm the **manual fallback** engages and the tab stays usable.

- [ ] **Step 5: Record findings**

Note the iPhone results in the PR / a short comment. If shared-mic conflict is confirmed, open a follow-up to split "voz" and "gravar" into separate actions (already anticipated in the spec).

---

### Task 9: (Phase 2) Floating Picture-in-Picture prompter

Do this only **after Task 8 confirms Phase 1 works on the iPhone.** Adds a display-only floating prompter that scrolls at a fixed speed (no voice tracking in background — iOS suspends the mic).

**Files:**
- Create: `components/teleprompter/use-pip-prompter.ts`
- Modify: `components/teleprompter/prompter-stage.tsx` (add a "Flutuante (PiP)" button)

- [ ] **Step 1: Implement the PiP hook**

Create `components/teleprompter/use-pip-prompter.ts`:
```ts
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Renders the script to a hidden canvas, turns it into a video stream, and
 * requests Picture-in-Picture so the text floats over other apps. Scrolls at a
 * fixed pixel speed (no voice tracking — the mic is suspended in the background).
 */
export function usePipPrompter(scriptText: string, pxPerSec = 40) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const lastTsRef = useRef(0);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(
      typeof document !== "undefined" && (document as any).pictureInPictureEnabled === true,
    );
  }, []);

  const draw = useCallback(
    (ts: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
      lastTsRef.current = ts;
      offsetRef.current += dt * pxPerSec;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "32px sans-serif";

      const margin = 24;
      const lineHeight = 40;
      const maxWidth = canvas.width - margin * 2;
      const words = scriptText.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      lines.forEach((l, i) => {
        const y = margin + i * lineHeight - offsetRef.current;
        if (y > -lineHeight && y < canvas.height + lineHeight) ctx.fillText(l, margin, y);
      });

      rafRef.current = requestAnimationFrame(draw);
    },
    [scriptText, pxPerSec],
  );

  const enter = useCallback(async () => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 270;
      canvasRef.current = canvas;
    }
    offsetRef.current = 0;
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);

    const stream = (canvasRef.current as any).captureStream(30) as MediaStream;
    const video = videoRef.current ?? document.createElement("video");
    videoRef.current = video;
    video.muted = true;
    (video as any).playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    try {
      await (video as any).requestPictureInPicture();
      setActive(true);
    } catch {
      /* user gesture / unsupported */
    }
  }, [draw]);

  const exit = useCallback(async () => {
    try {
      if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture();
    } catch {
      /* ignore */
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setActive(false);
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { enter, exit, active, supported };
}
```

- [ ] **Step 2: Add a PiP button in `prompter-stage.tsx`**

Near the top of `PrompterStage`, add the hook:
```tsx
  const pip = usePipPrompter(scriptText);
```
with the import:
```tsx
import { usePipPrompter } from "./use-pip-prompter";
```
Then add a control button in the control row (only when supported):
```tsx
          {pip.supported && (
            <CtrlButton label={pip.active ? "PiP ✓" : "Flutuar"} active={pip.active} onClick={() => (pip.active ? pip.exit() : pip.enter())} />
          )}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Verify on device**

On the iPhone, press **Flutuar**, switch to another app (e.g. the Camera), confirm the text floats and scrolls at a fixed speed. Confirm voice tracking does **not** run in the background (expected limitation).

- [ ] **Step 5: Commit**

```bash
git add components/teleprompter/use-pip-prompter.ts components/teleprompter/prompter-stage.tsx
git commit -m "feat(teleprompter): add Phase 2 floating PiP mode" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Aba `teleprompter` no `ViewKey` + nav → Task 7. ✓
- UX mobile-first + bloqueio desktop com mensagem exata → Task 2 + Task 6 + Task 8 (Step 2). ✓
- Fonte do texto (roteiros + avulso) → Task 6 (uses `data.scripts` + textarea). ✓
- Prompter tela cheia, câmera frontal espelhada, texto por cima → Task 5. ✓
- Rastreamento por voz (pt-BR, contínuo, parcial) + matcher → Tasks 1 & 4. ✓
- Fallback manual com velocidade → Task 5 (manual effect + slider). ✓
- Gravação limpa + download → Task 3 + Task 5 (download link). ✓
- Permissões + falhas em pt-BR → Task 3 (error strings) + Task 5 (status row). ✓
- Riscos iOS validados cedo → Task 8 (Steps 4–5). ✓
- Modo PiP Fase 2 → Task 9. ✓

**Placeholder scan:** No "TBD"/"add error handling here"/"similar to Task N" — every code step has complete code. ✓

**Type consistency:** `Token` (defined in `match-position.ts`) is reused by `use-speech-scroll.ts`. `UseCameraRecorder`/`UseSpeechScroll` shapes used in `prompter-stage.tsx` match their hook returns (`videoRef`, `permission`, `recording`, `elapsedMs`, `recordedUrl`, `error`, `start`, `stop`, `startRecording`, `stopRecording`; `tokens`, `currentIndex`, `listening`, `support`, `start`, `stop`, `resync`, `advance`, `reset`). `useIsMobile(): boolean | null` matches the `=== null` / `!isMobile` checks in `teleprompter-view.tsx`. `isMobileDevice(MobileSignals)` args match the hook call. ✓
