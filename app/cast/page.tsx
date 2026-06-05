"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Teleprompter "cast" spike.
 *
 * A presenter device (e.g. a Mac) renders a scrolling script to a <canvas>,
 * captures it as a video stream, and sends it over WebRTC (PeerJS) to a viewer
 * device (e.g. an iPhone). The viewer plays the stream and can float it in
 * Picture-in-Picture over other apps (like the native Camera).
 *
 * Goal of this step: confirm the iPhone keeps the PiP video updating while
 * Safari is in the background. If it does, step 2 swaps the fixed-speed scroll
 * for microphone-driven voice tracking on the presenter side.
 */

type Role = "presenter" | "viewer" | null;

const DEFAULT_SCRIPT =
  "Olá pessoal! Este é o teste do teleprompter flutuante. " +
  "Se este texto continuar rolando na janelinha enquanto você abre o aplicativo de Câmera do iPhone, a ideia funciona. " +
  "Mantenha o Safari aberto neste aparelho visor e troque para a Câmera: o Picture-in-Picture deve continuar se mexendo. " +
  "Quando confirmarmos isso, o próximo passo é trocar a velocidade fixa pela rolagem por voz, usando o microfone do computador.";

function makeCode(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "mtp-" + s;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function makeDummyStream(): MediaStream {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const cap = (c as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
  return cap ? cap.call(c, 1) : new MediaStream();
}

export default function CastPage() {
  const [role, setRole] = useState<Role>(null);

  return (
    <main className="min-h-dvh bg-neutral-950 px-5 py-8 text-white">
      <div className="mx-auto grid max-w-md gap-6">
        <header className="grid gap-1">
          <p className="text-xs font-medium uppercase tracking-widest text-violet-300">Megumi Tarot</p>
          <h1 className="text-2xl font-semibold">Teleprompter flutuante — teste</h1>
          <p className="text-sm text-white/55">
            Emissor (computador) transmite o texto rolando; visor (iPhone) recebe e joga em Picture-in-Picture.
          </p>
        </header>

        {role === null && (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setRole("presenter")}
              className="rounded-2xl bg-violet-600 px-5 py-4 text-left font-medium transition hover:bg-violet-500"
            >
              💻 Sou o emissor (computador)
              <span className="mt-1 block text-xs font-normal text-white/70">Cola o texto, transmite e mostra o código.</span>
            </button>
            <button
              type="button"
              onClick={() => setRole("viewer")}
              className="rounded-2xl bg-white/10 px-5 py-4 text-left font-medium backdrop-blur transition hover:bg-white/15"
            >
              📱 Sou o visor (iPhone)
              <span className="mt-1 block text-xs font-normal text-white/70">Digita o código, recebe o vídeo e flutua (PiP).</span>
            </button>
          </div>
        )}

        {role === "presenter" && <Presenter onBack={() => setRole(null)} />}
        {role === "viewer" && <Viewer onBack={() => setRole(null)} />}
      </div>
    </main>
  );
}

function Presenter({ onBack }: { onBack: () => void }) {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [speed, setSpeed] = useState(40); // px/s
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState("Cole o texto e toque em Transmitir.");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scriptRef = useRef(script);
  const speedRef = useRef(speed);
  const offsetRef = useRef(0);
  const lastTsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peerRef = useRef<any>(null);

  useEffect(() => {
    scriptRef.current = script;
  }, [script]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const drawLoop = useCallback((ts: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
    lastTsRef.current = ts;
    offsetRef.current += dt * speedRef.current;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "44px -apple-system, system-ui, sans-serif";
    ctx.textBaseline = "top";

    const margin = 32;
    const lineHeight = 64;
    const lines = wrapLines(ctx, scriptRef.current, canvas.width - margin * 2);
    const totalHeight = lines.length * lineHeight;
    const span = totalHeight + canvas.height;
    const off = span > 0 ? offsetRef.current % span : 0;

    lines.forEach((line, i) => {
      const y = canvas.height - off + i * lineHeight;
      if (y > -lineHeight && y < canvas.height) ctx.fillText(line, margin, y);
    });

    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const startCasting = useCallback(async () => {
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Start the scroll animation + capture it as a stream.
    offsetRef.current = 0;
    lastTsRef.current = 0;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawLoop);
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30);
    streamRef.current = stream;
    setLive(true);

    const newCode = makeCode();
    setCode(newCode);
    setStatus("Conectando ao serviço…");

    try {
      const { default: Peer } = await import("peerjs");
      const peer = new Peer(newCode);
      peerRef.current = peer;
      peer.on("open", (id: string) => setStatus(`Pronto. Código: ${id}. Aguardando o visor…`));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peer.on("call", (call: any) => {
        call.answer(streamRef.current ?? undefined);
        setStatus("Visor conectado ✓ — transmitindo.");
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peer.on("error", (e: any) => setError(`Erro de conexão (${e?.type ?? "desconhecido"}). Tente recarregar.`));
    } catch (e) {
      setError("Falha ao carregar o serviço de conexão: " + (e as Error).message);
    }
  }, [drawLoop]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      peerRef.current?.destroy?.();
    };
  }, []);

  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="justify-self-start text-sm text-white/50 hover:text-white">
        ← voltar
      </button>

      {code && (
        <div className="rounded-2xl border border-violet-500/40 bg-violet-500/10 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-violet-200">Código para o iPhone</p>
          <p className="mt-1 select-all text-3xl font-bold tracking-wider">{code}</p>
        </div>
      )}

      <p className="text-sm text-white/70">{status}</p>
      {error && <p className="text-sm text-amber-300">{error}</p>}

      <label className="grid gap-2 text-sm">
        <span className="text-white/70">Texto</span>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={5}
          className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-violet-400"
        />
      </label>

      <label className="grid gap-2 text-sm">
        <span className="text-white/70">Velocidade: {speed} px/s</span>
        <input type="range" min={10} max={120} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      </label>

      {!live ? (
        <button type="button" onClick={startCasting} className="rounded-2xl bg-violet-600 px-5 py-4 font-medium transition hover:bg-violet-500">
          ▶ Transmitir
        </button>
      ) : (
        <p className="text-xs text-white/45">Transmitindo. Deixe esta aba aberta no computador.</p>
      )}

      {/* Preview of exactly what is being streamed. */}
      <canvas ref={canvasRef} width={540} height={960} className="mx-auto w-40 rounded-xl border border-white/10 bg-black" />
    </div>
  );
}

function Viewer({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Digite o código que aparece no computador.");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peerRef = useRef<any>(null);

  const connect = useCallback(async () => {
    setError(null);
    const target = code.trim().toLowerCase();
    if (!target) {
      setError("Digite o código primeiro.");
      return;
    }
    setStatus("Conectando…");
    try {
      const { default: Peer } = await import("peerjs");
      const peer = new Peer();
      peerRef.current = peer;
      peer.on("open", () => {
        const call = peer.call(target, makeDummyStream());
        if (!call) {
          setError("Não foi possível iniciar a chamada. Confira o código.");
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call.on("stream", (remote: MediaStream) => {
          const v = videoRef.current;
          if (v) {
            v.srcObject = remote;
            v.play().catch(() => {});
          }
          setConnected(true);
          setStatus("Recebendo vídeo ✓ — toque em Flutuar e abra a Câmera.");
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call.on("error", (e: any) => setError("Erro na transmissão: " + (e?.type ?? e)));
        call.on("close", () => setStatus("Conexão encerrada."));
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peer.on("error", (e: any) => setError(`Erro de conexão (${e?.type ?? "desconhecido"}). Confira o código e a rede.`));
    } catch (e) {
      setError("Falha ao carregar o serviço de conexão: " + (e as Error).message);
    }
  }, [code]);

  const enterPip = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (v as any).requestPictureInPicture();
    } catch (e) {
      setError("PiP não disponível neste navegador: " + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    return () => {
      peerRef.current?.destroy?.();
    };
  }, []);

  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="justify-self-start text-sm text-white/50 hover:text-white">
        ← voltar
      </button>

      {!connected && (
        <div className="grid gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="código (ex: mtp-ab3kd)"
            autoCapitalize="none"
            autoCorrect="off"
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-center text-lg tracking-wider outline-none focus:border-violet-400"
          />
          <button type="button" onClick={connect} className="rounded-2xl bg-violet-600 px-5 py-4 font-medium transition hover:bg-violet-500">
            Conectar
          </button>
        </div>
      )}

      <p className="text-sm text-white/70">{status}</p>
      {error && <p className="text-sm text-amber-300">{error}</p>}

      <video ref={videoRef} playsInline autoPlay muted className="aspect-[9/16] w-full rounded-2xl bg-black" />

      {connected && (
        <button type="button" onClick={enterPip} className="rounded-2xl bg-emerald-500 px-5 py-4 font-semibold text-black transition hover:bg-emerald-400">
          ⬆ Flutuar (PiP) — depois abra a Câmera
        </button>
      )}
    </div>
  );
}
