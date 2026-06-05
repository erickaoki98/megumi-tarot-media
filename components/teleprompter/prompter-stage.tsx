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

  // Start the camera on mount and react to the on/off toggle.
  // (The hook stops all tracks on unmount automatically.)
  useEffect(() => {
    if (cameraOn) camera.start();
    else camera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

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
