"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraPermission = "idle" | "prompting" | "granted" | "denied" | "unsupported";

export type UseCameraRecorder = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  permission: CameraPermission;
  recording: boolean;
  elapsedMs: number;
  recordedUrl: string | null;
  recordedBlob: Blob | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
};

export function useCameraRecorder(facingMode: "user" | "environment" = "user"): UseCameraRecorder {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const urlRef = useRef<string | null>(null);

  const [permission, setPermission] = useState<CameraPermission>("idle");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
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
      ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => {
        try {
          return MediaRecorder.isTypeSupported(t);
        } catch {
          return false;
        }
      }) || "";
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      setError("Não foi possível iniciar a gravação neste navegador.");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      setError("Ocorreu um erro durante a gravação.");
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || "video/mp4";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) {
        setError("A gravação saiu vazia. Tente gravar de novo.");
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setRecordedBlob(blob);
      setRecordedUrl(url);
    };
    // Timeslice so iOS Safari reliably emits data chunks during recording.
    recorder.start(1000);
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

  const clearRecording = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    videoRef,
    permission,
    recording,
    elapsedMs,
    recordedUrl,
    recordedBlob,
    error,
    start,
    stop,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
