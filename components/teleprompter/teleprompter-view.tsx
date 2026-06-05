"use client";

import { useEffect, useState } from "react";
import { classNames } from "@/lib/utils";
import type { PersistedState } from "@/types/app";
import { useIsMobile } from "./use-is-mobile";
import { PrompterStage } from "./prompter-stage";
import { saveRecording } from "./save-recording";

export function TeleprompterView({ data }: { data: PersistedState }) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [active, setActive] = useState(false);
  const [lastRecording, setLastRecording] = useState<Blob | null>(null);
  const [lastRecordingUrl, setLastRecordingUrl] = useState<string | null>(null);

  // Keep a preview URL for the last recording; revoke it when it changes/unmounts.
  useEffect(() => {
    if (!lastRecording) {
      setLastRecordingUrl(null);
      return;
    }
    const url = URL.createObjectURL(lastRecording);
    setLastRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [lastRecording]);

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
    return (
      <PrompterStage
        scriptText={text}
        onClose={() => setActive(false)}
        onRecorded={(blob) => setLastRecording(blob)}
      />
    );
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

      {lastRecording && lastRecordingUrl && (
        <div className="grid gap-3 rounded-[1.4rem] border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-ink/75">Última gravação</p>
          <video src={lastRecordingUrl} controls playsInline className="w-full rounded-2xl bg-black" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (lastRecording) saveRecording(lastRecording);
              }}
              className="flex-1 rounded-full bg-emerald-500 px-4 py-3 text-center text-sm font-semibold text-black"
            >
              ⬇ Salvar vídeo
            </button>
            <button
              type="button"
              onClick={() => setLastRecording(null)}
              className="rounded-full border border-violet/15 px-4 py-3 text-sm font-medium text-ink/70"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <p className="text-xs leading-5 text-ink/45">
        Dica: o texto rola conforme você fala. Toque numa palavra para re-sincronizar. O vídeo gravado sai limpo (sem o
        texto na imagem). Para acompanhamento por voz, use no Safari; se a voz não funcionar, o modo manual assume
        automaticamente.
      </p>
    </section>
  );
}
