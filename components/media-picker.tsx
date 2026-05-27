"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classNames, getMediaHealth } from "@/lib/utils";
import type { MediaItem, MediaStatus } from "@/types/app";

/* ─── Gradient palette for thumbnails without an image URL ─── */
const gradients = [
  "linear-gradient(150deg,#b39bff,#7c5cff)",
  "linear-gradient(150deg,#ffb3c8,#ff6f9c)",
  "linear-gradient(150deg,#9be7d4,#2bb7a3)",
  "linear-gradient(150deg,#ffd59b,#ff9f43)",
  "linear-gradient(150deg,#a0c4ff,#5b8def)",
  "linear-gradient(150deg,#d4a0ff,#9b51e0)",
];

function stableGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

function rankMedal(rank: number): string | null {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}k`;
  return String(views);
}

function averageEngagement(item: MediaItem): number {
  const stats = Object.values(item.stats);
  const total = stats.reduce((sum, s) => sum + s.engagement, 0);
  return stats.length ? Math.round(total / stats.length) : 0;
}

function totalViews(item: MediaItem): number {
  return Object.values(item.stats).reduce((sum, s) => sum + s.views, 0);
}

/* ─── Filter chip options ─── */
type ChipFilter = "all" | "active" | "review" | "category";

type FilterConfig = {
  key: ChipFilter;
  label: string;
  category?: string;
};

function buildFilters(library: MediaItem[]): FilterConfig[] {
  const categories = Array.from(new Set(library.map((m) => m.category))).sort();
  const base: FilterConfig[] = [
    { key: "all", label: "Todas" },
    { key: "active", label: "Ativas" },
    { key: "review", label: "Em revisão" },
  ];
  for (const cat of categories) {
    base.push({ key: "category", label: cat, category: cat });
  }
  base.push({ key: "all", label: "Nunca repostada" });
  return base;
}

/* ─── Props ─── */
export type MediaPickerProps = {
  library: MediaItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
};

export function MediaPicker({ library, selectedId, onSelect, onClose }: MediaPickerProps) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("Todas");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /* Score and rank every item */
  const scored = useMemo(() => {
    return library
      .map((item) => {
        const { average } = getMediaHealth(item);
        return { item, score: average };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }, [library]);

  /* Apply search + filter */
  const filtered = useMemo(() => {
    let list = scored;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.item.title.toLowerCase().includes(q) ||
          e.item.category.toLowerCase().includes(q),
      );
    }

    if (activeFilter === "Ativas") {
      list = list.filter((e) => e.item.status === "active");
    } else if (activeFilter === "Em revisão") {
      list = list.filter((e) => e.item.status === "review");
    } else if (activeFilter === "Nunca repostada") {
      list = list.filter((e) => !e.item.repostCount);
    } else if (activeFilter !== "Todas") {
      list = list.filter((e) => e.item.category === activeFilter);
    }

    return list;
  }, [scored, search, activeFilter]);

  const filters = useMemo(() => buildFilters(library), [library]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[6vh] backdrop-blur-sm">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-3xl border border-violet/15 bg-white shadow-2xl shadow-violet/15">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-violet/8 px-5 py-4">
          <h3 className="text-[17px] font-semibold text-ink">Escolher mídia da biblioteca</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full bg-violet/6 text-ink/50 transition hover:bg-violet/12 hover:text-ink"
          >
            ×
          </button>
        </div>

        {/* Search + sort */}
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-2xl border border-violet/10 bg-violet/4 px-4 py-2.5 text-sm text-ink/50">
            <span>🔎</span>
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar por título ou categoria…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent outline-none placeholder:text-ink/40"
            />
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-violet px-4 py-2.5 text-[13px] font-medium text-white">
            ↕ Melhor desempenho
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 px-5 pt-3 pb-2">
          {filters.map((f, i) => {
            const isActive = activeFilter === f.label;
            return (
              <button
                key={`${f.label}-${i}`}
                type="button"
                onClick={() => setActiveFilter(f.label)}
                className={classNames(
                  "rounded-full border px-3 py-1.5 text-xs transition",
                  isActive
                    ? "border-violet/30 bg-violet/12 font-semibold text-violet"
                    : "border-violet/10 bg-violet/4 text-ink/50 hover:border-violet/20 hover:bg-violet/8",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto px-5 pb-5 pt-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-ink/40">
              Nenhuma mídia encontrada.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map(({ item, score, rank }) => {
                const isSelected = item.id === selectedId;
                const medal = rankMedal(rank);
                const views = totalViews(item);
                const eng = averageEngagement(item);
                const hasThumb = item.url && (item.type === "image" || item.url.match(/\.(jpg|jpeg|png|gif|webp)/i));

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelect(isSelected ? null : item.id);
                    }}
                    className={classNames(
                      "group relative overflow-hidden rounded-2xl border text-left transition",
                      isSelected
                        ? "border-violet ring-2 ring-violet"
                        : "border-violet/12 hover:-translate-y-0.5 hover:border-violet/25 hover:shadow-lg hover:shadow-violet/10",
                    )}
                  >
                    {/* Thumbnail area */}
                    <div
                      className="relative flex aspect-[9/12] items-end p-2"
                      style={
                        hasThumb
                          ? { backgroundImage: `url(${item.url})`, backgroundSize: "cover", backgroundPosition: "center" }
                          : { background: stableGradient(item.id) }
                      }
                    >
                      {/* Rank badge */}
                      {medal ? (
                        <span className="absolute top-2 left-2 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
                          {medal} #{rank}
                        </span>
                      ) : null}

                      {/* Score badge */}
                      <span className="absolute top-2 right-2 rounded-xl bg-white/90 px-2 py-0.5 text-xs font-bold text-ink">
                        {score}
                      </span>

                      {/* Duration */}
                      <span className="rounded-lg bg-black/40 px-2 py-0.5 text-[11px] text-white">
                        {item.duration || (item.type === "image" ? "Imagem" : "—")}
                      </span>
                    </div>

                    {/* Body */}
                    <div className="p-3">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">
                        {item.title}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink/50">
                        <span>{item.category}</span>
                        <span
                          className={classNames(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            item.status === "active"
                              ? "bg-emerald-50 text-emerald-600"
                              : item.status === "review"
                                ? "bg-amber-50 text-amber-600"
                                : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {item.status === "active" ? "ativa" : item.status === "review" ? "revisão" : "arquivada"}
                        </span>
                      </div>

                      {/* Score bar */}
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-violet/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet to-violet/50"
                          style={{ width: `${Math.min(score, 100)}%` }}
                        />
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink/45">
                        <span>▶ {formatViews(views)} · ❤ {eng}%</span>
                        <span>
                          {item.repostCount
                            ? `repostada ${item.repostCount}×`
                            : "nova"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-violet/8 px-5 py-3">
          <p className="text-xs text-ink/45">
            {filtered.length} mídia{filtered.length !== 1 ? "s" : ""}
            {selectedId ? " · 1 selecionada" : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                onClose();
              }}
              className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet transition hover:bg-violet/5"
            >
              Sem vínculo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-violet px-5 py-2 text-sm font-medium text-white transition hover:bg-violet/90"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Trigger button to open the picker ─── */
export function MediaPickerTrigger({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 text-left text-sm outline-none transition hover:border-violet/25 hover:bg-violet/8 focus:border-violet"
    >
      <span className="text-ink/75">{label}</span>
      <span className="text-ink/40">▾</span>
    </button>
  );
}
