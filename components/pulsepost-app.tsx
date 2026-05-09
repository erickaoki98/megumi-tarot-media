"use client";

import { useEffect, useMemo, useState } from "react";
import { seedState, STORAGE_KEY, networkLabels } from "@/lib/constants";
import { calculateScoreSummary, classNames, formatDate, formatNetworkList, getMediaHealth } from "@/lib/utils";
import { FlashState, MediaItem, MediaStatus, NetworkKey, PersistedState, RepostRule, ScheduleItem, ViewKey } from "@/types/app";

type FiltersState = {
  mediaStatus: "all" | MediaStatus;
};

const defaultFilters: FiltersState = {
  mediaStatus: "all",
};

function loadState(): PersistedState {
  if (typeof window === "undefined") {
    return seedState;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
    return seedState;
  }

  try {
    return {
      ...seedState,
      ...JSON.parse(stored),
    } as PersistedState;
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
    return seedState;
  }
}

function saveState(state: PersistedState) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function PulsePostApp() {
  const [data, setData] = useState<PersistedState>(seedState);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [flash, setFlash] = useState<FlashState>(null);

  useEffect(() => {
    const nextState = loadState();
    setData(nextState);
  }, []);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timer = window.setTimeout(() => setFlash(null), 3000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const currentUser = useMemo(
    () => data.users.find((user) => user.id === sessionUserId) ?? null,
    [data.users, sessionUserId],
  );

  const isAdmin = currentUser?.role === "admin";

  const suggestedRemovals = useMemo(
    () => data.mediaLibrary.filter((item) => getMediaHealth(item).underperforming),
    [data.mediaLibrary],
  );

  const scoreSummary = useMemo(() => calculateScoreSummary(data.mediaLibrary), [data.mediaLibrary]);

  const metrics = [
    {
      label: "Postagens agendadas",
      value: data.schedules.filter((item) => item.status === "scheduled").length,
      hint: "Fila pronta para publicar",
    },
    {
      label: "Midias ativas",
      value: data.mediaLibrary.filter((item) => item.status === "active").length,
      hint: "Disponiveis para novos agendamentos",
    },
    {
      label: "Score medio",
      value: `${scoreSummary}/100`,
      hint: "Media calculada entre redes monitoradas",
    },
    {
      label: "Itens em revisao",
      value: data.mediaLibrary.filter((item) => item.status !== "active").length + suggestedRemovals.length,
      hint: "Pontos de atencao do algoritmo",
    },
  ];

  const networkStats = (Object.keys(networkLabels) as NetworkKey[]).map((key) => ({
    key,
    label: networkLabels[key],
    posts: data.schedules.filter((schedule) => schedule.networks.includes(key)).length,
    views: data.mediaLibrary.reduce((total, item) => total + item.stats[key].views, 0),
  }));

  function persist(nextState: PersistedState, message?: string, kind: "success" | "error" = "success") {
    setData(nextState);
    saveState(nextState);
    if (message) {
      setFlash({ message, kind });
    }
  }

  function resetDemo() {
    persist(seedState, "Dados de exemplo restaurados.");
  }

  function handleLogin(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const user = data.users.find((item) => item.email.toLowerCase() === email && item.password === password);

    if (!user) {
      setFlash({ message: "E-mail ou senha invalidos.", kind: "error" });
      return;
    }

    setSessionUserId(user.id);
    setActiveView("dashboard");
    setFlash({ message: `Bem-vinda, ${user.name}.`, kind: "success" });
  }

  function handleCreateMedia(formData: FormData) {
    const nextItem: MediaItem = {
      id: randomId("media"),
      title: String(formData.get("title") ?? "").trim(),
      type: String(formData.get("type") ?? "video") as MediaItem["type"],
      format: String(formData.get("format") ?? "").trim(),
      duration: String(formData.get("duration") ?? "").trim(),
      status: String(formData.get("status") ?? "active") as MediaStatus,
      category: String(formData.get("category") ?? "").trim(),
      fileName: String(formData.get("fileName") ?? "").trim(),
      createdAt: new Date().toISOString(),
      stats: {
        instagram: { views: 0, engagement: 0, score: 0 },
        facebook: { views: 0, engagement: 0, score: 0 },
        youtube: { views: 0, engagement: 0, score: 0 },
        tiktok: { views: 0, engagement: 0, score: 0 },
      },
    };

    persist({ ...data, mediaLibrary: [nextItem, ...data.mediaLibrary] }, "Midia adicionada na biblioteca.");
  }

  function handleCreateSchedule(formData: FormData) {
    const networks = formData.getAll("networks").map((item) => String(item) as NetworkKey);

    if (!networks.length) {
      setFlash({ message: "Selecione pelo menos uma rede social.", kind: "error" });
      return;
    }

    const nextSchedule: ScheduleItem = {
      id: randomId("schedule"),
      title: String(formData.get("title") ?? "").trim(),
      mediaId: String(formData.get("mediaId") ?? "") || null,
      networks,
      scheduledFor: String(formData.get("scheduledFor") ?? ""),
      caption: String(formData.get("caption") ?? "").trim(),
      status: "scheduled",
      repostRuleId: String(formData.get("repostRuleId") ?? "") || null,
    };

    persist({ ...data, schedules: [nextSchedule, ...data.schedules] }, "Agendamento criado com sucesso.");
  }

  function handleCreateRule(formData: FormData) {
    const networks = formData.getAll("ruleNetworks").map((item) => String(item) as NetworkKey);

    if (!networks.length) {
      setFlash({ message: "Escolha ao menos uma rede para a regra.", kind: "error" });
      return;
    }

    const nextRule: RepostRule = {
      id: randomId("rule"),
      name: String(formData.get("name") ?? "").trim(),
      minScore: Number(formData.get("minScore") ?? 0),
      removeBelowScore: Number(formData.get("removeBelowScore") ?? 0),
      intervalDays: Number(formData.get("intervalDays") ?? 0),
      maxReposts: Number(formData.get("maxReposts") ?? 0),
      networks,
      active: true,
    };

    persist({ ...data, repostRules: [nextRule, ...data.repostRules] }, "Regra de repostagem salva.");
  }

  function handleCreateUser(formData: FormData) {
    if (!isAdmin) {
      setFlash({ message: "Somente administradores podem criar novos usuarios.", kind: "error" });
      return;
    }

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const exists = data.users.some((user) => user.email.toLowerCase() === email);

    if (exists) {
      setFlash({ message: "Ja existe um usuario com esse e-mail.", kind: "error" });
      return;
    }

    persist(
      {
        ...data,
        users: [
          {
            id: randomId("user"),
            name: String(formData.get("name") ?? "").trim(),
            role: String(formData.get("role") ?? "editor") as "admin" | "editor",
            email,
            password: String(formData.get("password") ?? ""),
            createdAt: new Date().toISOString(),
          },
          ...data.users,
        ],
      },
      "Novo usuario criado.",
    );
  }

  function removeMedia(id: string) {
    const media = data.mediaLibrary.find((item) => item.id === id);
    if (!media) {
      setFlash({ message: "Midia nao encontrada.", kind: "error" });
      return;
    }

    persist(
      {
        ...data,
        mediaLibrary: data.mediaLibrary.filter((item) => item.id !== id),
        schedules: data.schedules.map((schedule) =>
          schedule.mediaId === id ? { ...schedule, mediaId: null } : schedule,
        ),
      },
      `Midia "${media.title}" removida da biblioteca.`,
    );
  }

  function refreshStats(id: string) {
    const nextState: PersistedState = {
      ...data,
      mediaLibrary: data.mediaLibrary.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const nextStats = { ...item.stats };
        (Object.keys(nextStats) as NetworkKey[]).forEach((network) => {
          const current = nextStats[network];
          const views = Math.max(0, current.views + Math.round((Math.random() - 0.15) * 2400));
          const engagement = Math.max(0, Number((current.engagement + (Math.random() - 0.4) * 1.8).toFixed(1)));
          const score = Math.max(0, Math.min(100, Math.round(views / 350 + engagement * 7)));
          nextStats[network] = { views, engagement, score };
        });

        return { ...item, stats: nextStats };
      }),
    };

    persist(nextState, "Estatisticas simuladas atualizadas.");
  }

  function getLinkedMediaTitle(mediaId: string | null) {
    return data.mediaLibrary.find((item) => item.id === mediaId)?.title ?? "Midia nao vinculada";
  }

  if (!currentUser) {
    return (
      <main className="min-h-screen px-4 py-6 md:px-6">
        <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative overflow-hidden rounded-[2.25rem] border border-white/50 bg-panel p-8 shadow-panel backdrop-blur-xl md:p-10">
            <span className="inline-flex rounded-full bg-ink/5 px-4 py-2 text-xs uppercase tracking-[0.22em] text-ink/60">
              Operacao social centralizada
            </span>
            <h1 className="mt-6 max-w-[10ch] font-display text-5xl leading-none md:text-7xl">
              Agende, recicle e monitore conteudo em varias redes.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-ink/65">
              O PulsePost Admin organiza biblioteca de fotos e videos, programa publicacoes simultaneas para
              Instagram, Facebook, YouTube Shorts e TikTok, e sinaliza criativos com baixa performance para
              retirada da biblioteca.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {[
                { label: "Midias prontas", value: data.mediaLibrary.length },
                { label: "Agendamentos ativos", value: data.schedules.length },
                { label: "Regras de repost", value: data.repostRules.length },
                { label: "Midias em risco", value: suggestedRemovals.length },
              ].map((item) => (
                <article key={item.label} className="rounded-3xl border border-ink/10 bg-white/60 p-5">
                  <strong className="block text-4xl font-semibold">{item.value}</strong>
                  <span className="mt-2 block text-sm text-ink/60">{item.label}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="flex flex-col justify-center rounded-[2.25rem] border border-white/50 bg-panel p-8 shadow-panel backdrop-blur-xl md:p-10">
            <span className="inline-flex w-fit rounded-full bg-ink/5 px-4 py-2 text-xs uppercase tracking-[0.22em] text-ink/60">
              Entrar no painel
            </span>
            <h2 className="mt-4 font-display text-4xl">PulsePost Admin</h2>
            <p className="mt-3 text-ink/65">Apenas administradores podem criar novos usuarios.</p>

            {flash ? (
              <div
                className={classNames(
                  "mt-6 rounded-2xl px-4 py-3 text-sm",
                  flash.kind === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800",
                )}
              >
                {flash.message}
              </div>
            ) : null}

            <form
              className="mt-6 grid gap-4"
              action={(formData) => {
                handleLogin(formData);
              }}
            >
              <label className="grid gap-2 font-medium">
                <span>E-mail</span>
                <input
                  className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 outline-none ring-0 transition focus:border-ember"
                  name="email"
                  type="email"
                  placeholder="erickaoki@icloud.com"
                  required
                />
              </label>
              <label className="grid gap-2 font-medium">
                <span>Senha</span>
                <input
                  className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 outline-none ring-0 transition focus:border-ember"
                  name="password"
                  type="password"
                  placeholder="larissa3105"
                  required
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-3">
                <button className="rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30">
                  Entrar
                </button>
                <button
                  type="button"
                  className="rounded-full bg-ink/5 px-5 py-3 font-medium text-ink"
                  onClick={resetDemo}
                >
                  Restaurar dados de exemplo
                </button>
              </div>
            </form>

            <div className="mt-6 rounded-3xl bg-gradient-to-br from-lagoon/10 to-ember/10 p-5">
              <strong className="block text-lg">Usuario padrao</strong>
              <p className="mt-2 text-sm leading-6 text-ink/70">
                Login: erickaoki@icloud.com
                <br />
                Senha: larissa3105
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const filteredMedia = data.mediaLibrary.filter((item) =>
    filters.mediaStatus === "all" ? true : item.status === filters.mediaStatus,
  );

  return (
    <main className="min-h-screen px-4 py-6 md:px-6">
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex h-full flex-col rounded-[2rem] bg-[#16221d] p-6 text-white xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
          <div>
            <p className="font-display text-3xl">PulsePost</p>
            <p className="mt-2 text-sm text-white/70">Painel de operacao e agendamento social</p>
          </div>

          <nav className="mt-8 grid gap-2">
            {[
              { key: "dashboard", label: "Dashboard" },
              { key: "library", label: "Biblioteca" },
              { key: "scheduler", label: "Agendamentos" },
              { key: "reposts", label: "Repostagem" },
              ...(isAdmin ? [{ key: "users", label: "Usuarios" }] : []),
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key as ViewKey)}
                className={classNames(
                  "rounded-2xl border border-white/10 px-4 py-3 text-left transition",
                  activeView === item.key ? "bg-white/15" : "bg-transparent",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto border-t border-white/10 pt-5">
            <p className="font-medium">{currentUser.name}</p>
            <p className="mt-1 text-sm text-white/70">
              {currentUser.email} · {currentUser.role}
            </p>
            <button
              type="button"
              className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm"
              onClick={() => {
                setSessionUserId(null);
                setActiveView("dashboard");
                setFlash({ message: "Sessao encerrada.", kind: "success" });
              }}
            >
              Sair
            </button>
          </div>
        </aside>

        <section className="grid content-start gap-5">
          <header className="flex flex-col gap-4 rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel backdrop-blur-xl lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="font-display text-4xl md:text-5xl">Controle total do calendario social.</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/65 md:text-base">
                Centralize biblioteca de fotos e videos, distribua posts para varias redes ao mesmo tempo e use o
                score de desempenho para decidir o que repostar ou remover.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30"
                onClick={() => setActiveView("scheduler")}
              >
                Novo agendamento
              </button>
              <button
                type="button"
                className="rounded-full bg-ink/5 px-5 py-3 font-medium text-ink"
                onClick={() => setActiveView("library")}
              >
                Adicionar midia
              </button>
            </div>
          </header>

          {flash ? (
            <div
              className={classNames(
                "rounded-2xl px-4 py-3 text-sm",
                flash.kind === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800",
              )}
            >
              {flash.message}
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-[1.5rem] border border-white/50 bg-panel p-5 shadow-panel">
                <span className="text-sm text-ink/60">{metric.label}</span>
                <strong className="mt-3 block text-4xl font-semibold">{metric.value}</strong>
                <p className="mt-2 text-sm text-ink/60">{metric.hint}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {networkStats.map((network) => (
              <article key={network.key} className="rounded-[1.5rem] border border-white/50 bg-panel p-5 shadow-panel">
                <span className="inline-flex rounded-full bg-ink/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/60">
                  {network.label}
                </span>
                <h2 className="mt-4 text-2xl font-semibold">{network.posts} agendamentos</h2>
                <p className="mt-2 text-sm text-ink/60">
                  {network.views.toLocaleString("pt-BR")} visualizacoes acumuladas nas midias cadastradas.
                </p>
              </article>
            ))}
          </section>

          {activeView === "dashboard" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Proximas publicacoes</h2>
                  <p className="mt-2 text-sm text-ink/60">Agendamentos prontos para sair em multiplas redes.</p>
                </div>
                <div className="overflow-hidden rounded-3xl border border-ink/10">
                  <table className="min-w-full divide-y divide-ink/10 text-sm">
                    <thead className="bg-white/50 text-left uppercase tracking-[0.2em] text-ink/50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Post</th>
                        <th className="px-4 py-3 font-medium">Redes</th>
                        <th className="px-4 py-3 font-medium">Horario</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/10">
                      {[...data.schedules]
                        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                        .slice(0, 4)
                        .map((schedule) => (
                          <tr key={schedule.id}>
                            <td className="px-4 py-4">{schedule.title}</td>
                            <td className="px-4 py-4 text-ink/65">{formatNetworkList(schedule.networks)}</td>
                            <td className="px-4 py-4 text-ink/65">{formatDate(schedule.scheduledFor)}</td>
                            <td className="px-4 py-4">
                              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                {schedule.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Midias em risco</h2>
                  <p className="mt-2 text-sm text-ink/60">Itens que o algoritmo ja sugere retirar da biblioteca.</p>
                </div>
                <div className="grid gap-4">
                  {suggestedRemovals.length ? (
                    suggestedRemovals.slice(0, 3).map((item) => {
                      const health = getMediaHealth(item);
                      return (
                        <article key={item.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                            Score minimo {health.weakest}
                          </span>
                          <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                          <div className="mt-3 grid gap-2 text-sm text-ink/60">
                            <span>{item.fileName}</span>
                            <span>
                              {item.category} · {item.format}
                            </span>
                            <span>Media {health.average}/100</span>
                          </div>
                          <button
                            type="button"
                            className="mt-4 rounded-full bg-red-100 px-4 py-2 text-sm font-medium text-red-700"
                            onClick={() => removeMedia(item.id)}
                          >
                            Remover da biblioteca
                          </button>
                        </article>
                      );
                    })
                  ) : (
                    <div className="rounded-3xl border border-dashed border-ink/15 bg-white/45 p-8 text-sm text-ink/60">
                      Nenhum item abaixo da faixa critica no momento.
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "library" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Cadastrar midia</h2>
                  <p className="mt-2 text-sm text-ink/60">Organize fotos e videos com score inicial e categoria.</p>
                </div>
                <form
                  className="grid gap-4"
                  action={(formData) => {
                    handleCreateMedia(formData);
                  }}
                >
                  <Field label="Titulo da midia" name="title" placeholder="Ex: teaser do produto" />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Arquivo" name="fileName" placeholder="video-campanha.mp4" />
                    <Field label="Categoria" name="category" placeholder="Campanha" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectField
                      label="Tipo"
                      name="type"
                      options={[
                        { label: "Video", value: "video" },
                        { label: "Imagem", value: "image" },
                      ]}
                    />
                    <Field label="Formato" name="format" placeholder="Reel / Short" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Duracao" name="duration" placeholder="00:30 ou Imagem" />
                    <SelectField
                      label="Status"
                      name="status"
                      options={[
                        { label: "Ativa", value: "active" },
                        { label: "Revisao", value: "review" },
                        { label: "Arquivada", value: "archived" },
                      ]}
                    />
                  </div>
                  <button className="mt-2 w-fit rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30">
                    Salvar midia
                  </button>
                </form>
              </section>

              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-display text-3xl">Biblioteca de conteudo</h2>
                    <p className="mt-2 text-sm text-ink/60">Biblioteca central para agendamento e repostagem.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Todos", value: "all" },
                      { label: "Ativas", value: "active" },
                      { label: "Revisao", value: "review" },
                      { label: "Arquivadas", value: "archived" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setFilters((current) => ({
                            ...current,
                            mediaStatus: option.value as FiltersState["mediaStatus"],
                          }))
                        }
                        className={classNames(
                          "rounded-full px-4 py-2 text-sm font-medium",
                          filters.mediaStatus === option.value ? "bg-ember/15 text-ember" : "bg-ink/5 text-ink",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredMedia.length ? (
                    filteredMedia.map((item) => {
                      const health = getMediaHealth(item);
                      return (
                        <article key={item.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                          <span
                            className={classNames(
                              "rounded-full px-3 py-1 text-xs font-semibold",
                              health.underperforming
                                ? "bg-red-100 text-red-700"
                                : item.status === "active"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-amber-100 text-amber-700",
                            )}
                          >
                            {item.status}
                          </span>
                          <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                          <div className="mt-3 grid gap-2 text-sm text-ink/60">
                            <span>{item.fileName}</span>
                            <span>
                              {item.type} · {item.format} · {item.duration}
                            </span>
                            <span>
                              {item.category} · Criada em {formatDate(item.createdAt)}
                            </span>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {(Object.keys(item.stats) as NetworkKey[])
                              .filter((network) => item.stats[network].views > 0)
                              .map((network) => (
                                <span
                                  key={network}
                                  className={classNames(
                                    "rounded-xl px-3 py-2 text-xs font-medium",
                                    item.stats[network].score < 35
                                      ? "bg-red-100 text-red-700"
                                      : "bg-emerald-100 text-emerald-700",
                                  )}
                                >
                                  {networkLabels[network]} {item.stats[network].score}/100
                                </span>
                              ))}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              className="rounded-full bg-ink/5 px-4 py-2 text-sm font-medium"
                              onClick={() => refreshStats(item.id)}
                            >
                              Atualizar estatisticas
                            </button>
                            <button
                              type="button"
                              className="rounded-full bg-red-100 px-4 py-2 text-sm font-medium text-red-700"
                              onClick={() => removeMedia(item.id)}
                            >
                              Remover
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="rounded-3xl border border-dashed border-ink/15 bg-white/45 p-8 text-sm text-ink/60">
                      Nenhuma midia encontrada com esse filtro.
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "scheduler" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Agendar postagem</h2>
                  <p className="mt-2 text-sm text-ink/60">
                    Publique em varias redes de uma vez e associe uma regra de repostagem se quiser.
                  </p>
                </div>
                <form
                  className="grid gap-4"
                  action={(formData) => {
                    handleCreateSchedule(formData);
                  }}
                >
                  <Field label="Nome interno do post" name="title" placeholder="Lancamento da semana" />
                  <SelectField
                    label="Midia da biblioteca"
                    name="mediaId"
                    options={[
                      { label: "Sem vinculo", value: "" },
                      ...data.mediaLibrary.map((item) => ({ label: item.title, value: item.id })),
                    ]}
                  />
                  <fieldset className="grid gap-3">
                    <legend className="text-sm font-medium">Redes de publicacao</legend>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                        <label key={network} className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white/70 px-4 py-3">
                          <input name="networks" type="checkbox" value={network} className="size-4" />
                          <span>{networkLabels[network]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Data e hora" name="scheduledFor" type="datetime-local" />
                    <SelectField
                      label="Regra de repostagem"
                      name="repostRuleId"
                      options={[
                        { label: "Sem regra", value: "" },
                        ...data.repostRules.map((rule) => ({ label: rule.name, value: rule.id })),
                      ]}
                    />
                  </div>
                  <Field label="Legenda base" name="caption" placeholder="Escreva a base da legenda aqui" />
                  <button className="mt-2 w-fit rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30">
                    Criar agendamento
                  </button>
                </form>
              </section>

              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Fila programada</h2>
                  <p className="mt-2 text-sm text-ink/60">Visualize rapidamente os proximos disparos por rede.</p>
                </div>
                <div className="grid gap-4">
                  {[...data.schedules]
                    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                    .map((schedule) => (
                      <article key={schedule.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {schedule.status}
                        </span>
                        <h3 className="mt-4 text-lg font-semibold">{schedule.title}</h3>
                        <div className="mt-3 grid gap-2 text-sm text-ink/60">
                          <span>{formatDate(schedule.scheduledFor)}</span>
                          <span>{formatNetworkList(schedule.networks)}</span>
                          <span>Midia: {getLinkedMediaTitle(schedule.mediaId)}</span>
                          <span>{schedule.caption}</span>
                        </div>
                      </article>
                    ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "reposts" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Configurar algoritmo de repostagem</h2>
                  <p className="mt-2 text-sm text-ink/60">
                    Defina score minimo para republicar e score critico para remocao da biblioteca.
                  </p>
                </div>
                <form
                  className="grid gap-4"
                  action={(formData) => {
                    handleCreateRule(formData);
                  }}
                >
                  <Field label="Nome da regra" name="name" placeholder="Repostar vencedores" />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Score minimo para repostar" name="minScore" type="number" defaultValue="70" />
                    <Field
                      label="Score para sugerir remocao"
                      name="removeBelowScore"
                      type="number"
                      defaultValue="35"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Intervalo entre reposts (dias)" name="intervalDays" type="number" defaultValue="14" />
                    <Field label="Maximo de repostagens" name="maxReposts" type="number" defaultValue="3" />
                  </div>
                  <fieldset className="grid gap-3">
                    <legend className="text-sm font-medium">Redes consideradas</legend>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                        <label key={network} className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white/70 px-4 py-3">
                          <input name="ruleNetworks" type="checkbox" value={network} className="size-4" />
                          <span>{networkLabels[network]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <button className="mt-2 w-fit rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30">
                    Salvar regra
                  </button>
                </form>
              </section>

              <section className="grid gap-5">
                <div className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                  <div className="mb-5">
                    <h2 className="font-display text-3xl">Regras e sugestoes</h2>
                    <p className="mt-2 text-sm text-ink/60">
                      As sugestoes simulam a leitura de estatisticas das redes para apoiar remocao de midias.
                    </p>
                  </div>
                  <div className="grid gap-4">
                    {data.repostRules.map((rule) => (
                      <article key={rule.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                        <span
                          className={classNames(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            rule.active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                          )}
                        >
                          {rule.active ? "ativa" : "pausada"}
                        </span>
                        <h3 className="mt-4 text-lg font-semibold">{rule.name}</h3>
                        <div className="mt-3 grid gap-2 text-sm text-ink/60">
                          <span>Repostar acima de {rule.minScore}/100</span>
                          <span>Remover abaixo de {rule.removeBelowScore}/100</span>
                          <span>
                            {rule.intervalDays} dias entre ciclos · max {rule.maxReposts} reposts
                          </span>
                          <span>{formatNetworkList(rule.networks)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                  <div className="mb-5">
                    <h2 className="font-display text-3xl">Midias com baixa performance</h2>
                    <p className="mt-2 text-sm text-ink/60">Acao manual recomendada apos consolidacao das APIs reais.</p>
                  </div>
                  <div className="grid gap-4">
                    {suggestedRemovals.length ? (
                      suggestedRemovals.map((item) => {
                        const health = getMediaHealth(item);
                        return (
                          <article key={item.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                              Recomendado remover
                            </span>
                            <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                            <div className="mt-3 grid gap-2 text-sm text-ink/60">
                              <span>Media {health.average}/100</span>
                              <span>Pior score {health.weakest}/100</span>
                              <span>{item.fileName}</span>
                            </div>
                            <button
                              type="button"
                              className="mt-4 rounded-full bg-red-100 px-4 py-2 text-sm font-medium text-red-700"
                              onClick={() => removeMedia(item.id)}
                            >
                              Remover da biblioteca
                            </button>
                          </article>
                        );
                      })
                    ) : (
                      <div className="rounded-3xl border border-dashed border-ink/15 bg-white/45 p-8 text-sm text-ink/60">
                        Nenhuma midia abaixo do limite definido pelas regras.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "users" && isAdmin ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Criar usuario</h2>
                  <p className="mt-2 text-sm text-ink/60">
                    Apenas administradores podem cadastrar novos acessos ao sistema.
                  </p>
                </div>
                <form
                  className="grid gap-4"
                  action={(formData) => {
                    handleCreateUser(formData);
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Nome" name="name" placeholder="Nome completo" />
                    <SelectField
                      label="Perfil"
                      name="role"
                      options={[
                        { label: "Editor", value: "editor" },
                        { label: "Admin", value: "admin" },
                      ]}
                    />
                  </div>
                  <Field label="E-mail" name="email" type="email" placeholder="usuario@empresa.com" />
                  <Field label="Senha" name="password" placeholder="Crie uma senha" />
                  <button className="mt-2 w-fit rounded-full bg-ember px-5 py-3 font-medium text-white shadow-lg shadow-ember/30">
                    Cadastrar usuario
                  </button>
                </form>
              </section>

              <section className="rounded-[2rem] border border-white/50 bg-panel p-6 shadow-panel">
                <div className="mb-5">
                  <h2 className="font-display text-3xl">Usuarios cadastrados</h2>
                  <p className="mt-2 text-sm text-ink/60">Controle simples de acessos do painel.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.users.map((user) => (
                    <article key={user.id} className="rounded-[1.4rem] border border-ink/10 bg-white/55 p-5">
                      <span
                        className={classNames(
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          user.role === "admin" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {user.role}
                      </span>
                      <h3 className="mt-4 text-lg font-semibold">{user.name}</h3>
                      <div className="mt-3 grid gap-2 text-sm text-ink/60">
                        <span>{user.email}</span>
                        <span>Criado em {formatDate(user.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

type FieldProps = {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
};

function Field({ label, name, placeholder, type = "text", defaultValue }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 outline-none transition focus:border-ember"
      />
    </label>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
};

function SelectField({ label, name, options }: SelectFieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      <select
        name={name}
        className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 outline-none transition focus:border-ember"
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
