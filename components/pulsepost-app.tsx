"use client";

import { useEffect, useMemo, useState } from "react";
import { networkLabels, seedState, STORAGE_KEY } from "@/lib/constants";
import { classNames, formatDate, formatNetworkList, getMediaHealth } from "@/lib/utils";
import {
  AppUser,
  FlashState,
  MediaItem,
  MediaStatus,
  NetworkKey,
  PersistedState,
  RepostRule,
  ScheduleItem,
  SocialConnection,
  ViewKey,
} from "@/types/app";

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
  const [activeView, setActiveView] = useState<ViewKey>("scheduler");
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [flash, setFlash] = useState<FlashState>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);

  useEffect(() => {
    setData(loadState());
  }, []);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timer = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const pageTitle = pageTitleMap[activeView];
    document.title = `Megumi Tarot - Media Center${pageTitle ? ` - ${pageTitle}` : ""}`;
  }, [activeView]);

  const currentUser = useMemo(
    () => data.users.find((user) => user.id === sessionUserId) ?? null,
    [data.users, sessionUserId],
  );

  const isAdmin = currentUser?.role === "admin";

  const suggestedRemovals = useMemo(
    () => data.mediaLibrary.filter((item) => getMediaHealth(item).underperforming),
    [data.mediaLibrary],
  );

  const filteredMedia = useMemo(
    () => data.mediaLibrary.filter((item) => (filters.mediaStatus === "all" ? true : item.status === filters.mediaStatus)),
    [data.mediaLibrary, filters.mediaStatus],
  );


  function persist(nextState: PersistedState, message?: string, kind: "success" | "error" = "success") {
    setData(nextState);
    saveState(nextState);
    if (message) {
      setFlash({ message, kind });
    }
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
    setActiveView("scheduler");
    setFlash({ message: `Sessao iniciada para ${user.name}.`, kind: "success" });
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

    persist({ ...data, schedules: [nextSchedule, ...data.schedules] }, "Agendamento criado.");
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

    persist({ ...data, repostRules: [nextRule, ...data.repostRules] }, "Regra salva.");
  }

  function handleCreateUser(formData: FormData) {
    if (!isAdmin) {
      setFlash({ message: "Somente administradores podem criar usuarios.", kind: "error" });
      return;
    }

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const exists = data.users.some((user) => user.email.toLowerCase() === email);
    if (exists) {
      setFlash({ message: "Ja existe um usuario com esse e-mail.", kind: "error" });
      return;
    }

    const nextUser: AppUser = {
      id: randomId("user"),
      name: String(formData.get("name") ?? "").trim(),
      email,
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "editor") as AppUser["role"],
      createdAt: new Date().toISOString(),
    };

    persist({ ...data, users: [nextUser, ...data.users] }, "Usuario criado.");
  }

  function handleUpdateUser(userId: string, formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const duplicate = data.users.some((user) => user.id !== userId && user.email.toLowerCase() === email);

    if (duplicate) {
      setFlash({ message: "Outro usuario ja usa esse e-mail.", kind: "error" });
      return;
    }

    const nextUsers = data.users.map((user) =>
      user.id === userId
        ? {
            ...user,
            name: String(formData.get("name") ?? "").trim(),
            email,
            password: String(formData.get("password") ?? ""),
            role: String(formData.get("role") ?? user.role) as AppUser["role"],
          }
        : user,
    );

    persist({ ...data, users: nextUsers }, "Usuario atualizado.");
    setEditingUserId(null);
  }

  function deleteUser(userId: string) {
    if (!isAdmin) {
      setFlash({ message: "Somente administradores podem remover usuarios.", kind: "error" });
      return;
    }

    const user = data.users.find((item) => item.id === userId);
    if (!user) {
      return;
    }

    const adminCount = data.users.filter((item) => item.role === "admin").length;
    if (user.role === "admin" && adminCount === 1) {
      setFlash({ message: "O ultimo admin nao pode ser removido.", kind: "error" });
      return;
    }

    if (user.id === sessionUserId) {
      setFlash({ message: "Nao e possivel remover o usuario em uso.", kind: "error" });
      return;
    }

    persist({ ...data, users: data.users.filter((item) => item.id !== userId) }, "Usuario removido.");
  }

  function handleUpdateConnection(connectionId: string, formData: FormData) {
    const nextConnections = data.connections.map((connection) =>
      connection.id === connectionId
        ? {
            ...connection,
            accountName: String(formData.get("accountName") ?? "").trim(),
            apiKey: String(formData.get("apiKey") ?? "").trim(),
            apiSecret: String(formData.get("apiSecret") ?? "").trim(),
            accessToken: String(formData.get("accessToken") ?? "").trim(),
            refreshToken: String(formData.get("refreshToken") ?? "").trim(),
            webhookUrl: String(formData.get("webhookUrl") ?? "").trim(),
            status: String(formData.get("status") ?? connection.status) as SocialConnection["status"],
            lastSync:
              String(formData.get("status") ?? connection.status) === "connected" ? new Date().toISOString() : connection.lastSync,
          }
        : connection,
    );

    persist({ ...data, connections: nextConnections }, "Configuracao de conexao salva.");
    setEditingConnectionId(null);
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
        schedules: data.schedules.map((schedule) => (schedule.mediaId === id ? { ...schedule, mediaId: null } : schedule)),
      },
      `Midia "${media.title}" removida.`,
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

    persist(nextState, "Estatisticas atualizadas.");
  }

  function getLinkedMediaTitle(mediaId: string | null) {
    return data.mediaLibrary.find((item) => item.id === mediaId)?.title ?? "Midia nao vinculada";
  }

  if (!currentUser) {
    return (
      <main className="min-h-screen px-4 py-6 md:px-6">
        <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-violet/10 bg-white/70 p-8 shadow-panel backdrop-blur md:p-12">
            <div className="inline-flex items-center gap-4">
              <LogoMark />
              <div>
                <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Megumi Tarot</div>
                <div className="mt-1 font-display text-2xl tracking-[-0.04em]">Media Center</div>
              </div>
            </div>
            <h1 className="mt-10 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[-0.04em] md:text-7xl">
              Conteudo bem guiado, visual e pronto para publicar.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">
              Um painel mais calmo e intuitivo para organizar midias, publicar em varias redes e configurar conexoes
              de API sem ruido visual.
            </p>

            <div className="mt-10 grid gap-4">
              <IllustrationRow
                icon={<HeartPlayIcon className="size-5 text-violet" />}
                title="Publicacao multicanal"
                description="Organize uma mesma campanha para Instagram, Facebook, YouTube Shorts e TikTok."
              />
              <IllustrationRow
                icon={<LibraryIcon className="size-5 text-violet" />}
                title="Biblioteca central"
                description="Fotos e videos ficam reunidos em um fluxo mais limpo para selecionar, revisar e publicar."
              />
              <IllustrationRow
                icon={<ConnectionIcon className="size-5 text-violet" />}
                title="Conexoes de API"
                description="A area de configuracao concentra tokens, chaves, webhooks e status por rede."
              />
            </div>
          </section>

          <section className="rounded-[2rem] border border-violet/10 bg-white/88 p-8 shadow-panel backdrop-blur md:p-10">
            <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Entrar</div>
            <h2 className="mt-4 font-display text-4xl tracking-[-0.04em]">Megumi Tarot - Media Center</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-ink/60">
              Entre com as credenciais da sua operacao para abrir o painel administrativo.
            </p>

            {flash ? <FlashBanner flash={flash} className="mt-6" /> : null}

            <form
              className="mt-8 grid gap-4"
              action={(formData) => {
                handleLogin(formData);
              }}
            >
              <Field label="E-mail" name="email" type="email" placeholder="seuemail@empresa.com" />
              <Field label="Senha" name="password" type="password" placeholder="Digite sua senha" />
              <button className="mt-2 rounded-full bg-violet px-5 py-3 font-medium text-white shadow-lg shadow-violet/20">
                Acessar painel
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[2rem] border border-violet/10 bg-white/80 shadow-panel backdrop-blur">
          <header className="flex flex-col gap-5 border-b border-violet/10 px-5 py-5 md:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <LogoMark compact />
              <div>
                <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Megumi Tarot</div>
                <h1 className="mt-1 font-display text-3xl tracking-[-0.04em] md:text-4xl">Media Center</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-violet/10 bg-violet/5 px-4 py-2 text-sm text-ink/70">
                {currentUser.name} · {currentUser.role}
              </div>
              <button
                type="button"
                className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet"
                onClick={() => setActiveView("config")}
              >
                Config
              </button>
              <button
                type="button"
                className="rounded-full bg-violet px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  setSessionUserId(null);
                  setActiveView("scheduler");
                  setFlash({ message: "Sessao encerrada.", kind: "success" });
                }}
              >
                Sair
              </button>
            </div>
          </header>

          <div className="border-b border-violet/10 px-5 py-4 md:px-8">
            <nav className="flex flex-wrap gap-2">
                {[
                  { key: "library", label: "Biblioteca" },
                  { key: "scheduler", label: "Agendamentos" },
                  { key: "reposts", label: "Repostagem" },
                  { key: "users", label: "Usuarios" },
                  { key: "config", label: "Config" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveView(item.key as ViewKey)}
                    className={classNames(
                      "rounded-full px-4 py-2.5 text-sm transition",
                      activeView === item.key ? "bg-violet text-white shadow-lg shadow-violet/15" : "bg-violet/5 text-ink/65 hover:bg-violet/10",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <NavIcon view={item.key as ViewKey} />
                      {item.label}
                    </span>
                  </button>
                ))}
            </nav>
          </div>

          <section className="grid gap-6 p-5 md:p-8">
              {flash ? <FlashBanner flash={flash} /> : null}

              <ViewHeader
                title={viewMeta[activeView].title}
                description={viewMeta[activeView].description}
                actionLabel={viewMeta[activeView].actionLabel}
                onAction={viewMeta[activeView].onAction(setActiveView)}
              />

              {activeView === "library" ? (
                <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card title="Nova midia" description="Adicione fotos e videos para uso em varias redes.">
                    <FormGrid action={handleCreateMedia}>
                      <Field label="Titulo" name="title" placeholder="Ex: video da semana" />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Arquivo" name="fileName" placeholder="video.mp4" />
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
                        <Field label="Formato" name="format" placeholder="Reel / Story" />
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
                      <PrimaryButton label="Salvar midia" />
                    </FormGrid>
                  </Card>

                  <Card title="Biblioteca" description="Visual limpo para filtrar, revisar e remover ativos.">
                    <div className="mb-5 flex flex-wrap gap-2">
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
                            "rounded-full px-4 py-2 text-sm",
                            filters.mediaStatus === option.value ? "bg-violet text-white" : "bg-violet/6 text-ink/70",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-3">
                      {filteredMedia.map((item) => {
                        const health = getMediaHealth(item);
                        return (
                          <article key={item.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="font-medium">{item.title}</h3>
                                <p className="mt-1 text-sm text-ink/55">
                                  {item.fileName} · {item.format} · {item.category}
                                </p>
                              </div>
                              <span className="rounded-full bg-violet/8 px-3 py-1 text-xs text-violet">{item.status}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(Object.keys(item.stats) as NetworkKey[])
                                .filter((network) => item.stats[network].views > 0)
                                .map((network) => (
                                  <span
                                    key={network}
                                    className={classNames(
                                      "rounded-full px-3 py-1 text-xs",
                                      item.stats[network].score < 35 ? "bg-rose-100 text-rose-700" : "bg-violet/8 text-violet",
                                    )}
                                  >
                                    {networkLabels[network]} {item.stats[network].score}/100
                                  </span>
                                ))}
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                                media {health.average}/100
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <SecondaryButton label="Atualizar estatisticas" onClick={() => refreshStats(item.id)} />
                              <GhostDangerButton label="Remover" onClick={() => removeMedia(item.id)} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "scheduler" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card title="Novo agendamento" description="Programe uma postagem para varias redes ao mesmo tempo.">
                    <FormGrid action={handleCreateSchedule}>
                      <Field label="Titulo interno" name="title" placeholder="Lote de domingo" />
                      <SelectField
                        label="Midia"
                        name="mediaId"
                        options={[
                          { label: "Sem vinculo", value: "" },
                          ...data.mediaLibrary.map((item) => ({ label: item.title, value: item.id })),
                        ]}
                      />
                      <CheckGrid legend="Redes">
                        {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                          <CheckCard key={network} name="networks" value={network} label={networkLabels[network]} />
                        ))}
                      </CheckGrid>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Data e hora" name="scheduledFor" type="datetime-local" />
                        <SelectField
                          label="Regra de repost"
                          name="repostRuleId"
                          options={[
                            { label: "Sem regra", value: "" },
                            ...data.repostRules.map((rule) => ({ label: rule.name, value: rule.id })),
                          ]}
                        />
                      </div>
                      <Field label="Legenda base" name="caption" placeholder="Legenda adaptavel por rede" />
                      <PrimaryButton label="Salvar agendamento" />
                    </FormGrid>
                  </Card>

                  <Card title="Fila programada" description="Timeline clara dos proximos disparos.">
                    <div className="grid gap-3">
                      {[...data.schedules]
                        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                        .map((schedule) => (
                          <article key={schedule.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="font-medium">{schedule.title}</h3>
                                <p className="mt-1 text-sm text-ink/55">{formatNetworkList(schedule.networks)}</p>
                              </div>
                              <span className="text-sm text-violet">{formatDate(schedule.scheduledFor)}</span>
                            </div>
                            <p className="mt-3 text-sm text-ink/60">Midia: {getLinkedMediaTitle(schedule.mediaId)}</p>
                            <p className="mt-1 text-sm text-ink/60">{schedule.caption}</p>
                          </article>
                        ))}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "reposts" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card title="Nova regra de repostagem" description="Defina como o algoritmo deve reciclar ou cortar conteudos.">
                    <FormGrid action={handleCreateRule}>
                      <Field label="Nome da regra" name="name" placeholder="Repostar melhores clips" />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Score minimo" name="minScore" type="number" defaultValue="70" />
                        <Field label="Score para remocao" name="removeBelowScore" type="number" defaultValue="35" />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Intervalo em dias" name="intervalDays" type="number" defaultValue="14" />
                        <Field label="Maximo de reposts" name="maxReposts" type="number" defaultValue="3" />
                      </div>
                      <CheckGrid legend="Redes consideradas">
                        {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                          <CheckCard key={network} name="ruleNetworks" value={network} label={networkLabels[network]} />
                        ))}
                      </CheckGrid>
                      <PrimaryButton label="Salvar regra" />
                    </FormGrid>
                  </Card>

                  <div className="grid gap-5">
                    <Card title="Regras ativas" description="Visualizacao rapida das automatizacoes de repost.">
                      <div className="grid gap-3">
                        {data.repostRules.map((rule) => (
                          <article key={rule.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="font-medium">{rule.name}</h3>
                              <span className={classNames("rounded-full px-3 py-1 text-xs", rule.active ? "bg-violet/8 text-violet" : "bg-slate-100 text-slate-600")}>
                                {rule.active ? "ativa" : "pausada"}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-1 text-sm text-ink/60">
                              <span>Reposta acima de {rule.minScore}/100</span>
                              <span>Remove abaixo de {rule.removeBelowScore}/100</span>
                              <span>{rule.intervalDays} dias · max {rule.maxReposts} reposts</span>
                              <span>{formatNetworkList(rule.networks)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </Card>

                    <Card title="Itens para revisar" description="Baixa performance identificada nas estatisticas atuais.">
                      <div className="grid gap-3">
                        {suggestedRemovals.map((item) => {
                          const health = getMediaHealth(item);
                          return (
                            <article key={item.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                              <h3 className="font-medium">{item.title}</h3>
                              <p className="mt-2 text-sm text-ink/60">Media {health.average}/100 · pior score {health.weakest}/100</p>
                              <div className="mt-3">
                                <GhostDangerButton label="Remover da biblioteca" onClick={() => removeMedia(item.id)} />
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </Card>
                  </div>
                </section>
              ) : null}

              {activeView === "users" ? (
                <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card title="Novo usuario" description="Admins podem criar novos acessos para a operacao.">
                    <FormGrid action={handleCreateUser}>
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
                      <Field label="Senha" name="password" type="text" placeholder="Defina a senha inicial" />
                      <PrimaryButton label="Criar usuario" />
                    </FormGrid>
                  </Card>

                  <Card title="Gerenciar usuarios" description="Edite nome, e-mail, senha e papel sem sair do painel.">
                    <div className="grid gap-3">
                      {data.users.map((user) => (
                        <article key={user.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                          {editingUserId === user.id ? (
                            <form
                              className="grid gap-4"
                              action={(formData) => {
                                handleUpdateUser(user.id, formData);
                              }}
                            >
                              <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Nome" name="name" defaultValue={user.name} />
                                <SelectField
                                  label="Perfil"
                                  name="role"
                                  defaultValue={user.role}
                                  options={[
                                    { label: "Editor", value: "editor" },
                                    { label: "Admin", value: "admin" },
                                  ]}
                                />
                              </div>
                              <Field label="E-mail" name="email" type="email" defaultValue={user.email} />
                              <Field label="Senha" name="password" type="text" defaultValue={user.password} />
                              <div className="flex flex-wrap gap-3">
                                <PrimaryButton label="Salvar alteracoes" />
                                <SecondaryButton label="Cancelar" onClick={() => setEditingUserId(null)} type="button" />
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-medium">{user.name}</h3>
                                  <p className="mt-1 text-sm text-ink/55">{user.email}</p>
                                </div>
                                <span className="rounded-full bg-violet/8 px-3 py-1 text-xs text-violet">{user.role}</span>
                              </div>
                              <p className="mt-3 text-sm text-ink/50">Criado em {formatDate(user.createdAt)}</p>
                              <div className="mt-4 flex flex-wrap gap-3">
                                <SecondaryButton label="Editar" onClick={() => setEditingUserId(user.id)} />
                                <GhostDangerButton label="Remover" onClick={() => deleteUser(user.id)} />
                              </div>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "config" ? (
                <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                  <Card title="Conexoes por API" description="Area dedicada para configurar cada integracao com as redes sociais.">
                    <div className="grid gap-3">
                      {data.connections.map((connection) => (
                        <article key={connection.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                          {editingConnectionId === connection.id ? (
                            <form
                              className="grid gap-4"
                              action={(formData) => {
                                handleUpdateConnection(connection.id, formData);
                              }}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <h3 className="font-medium">{networkLabels[connection.network]}</h3>
                                <SelectField
                                  label="Status"
                                  name="status"
                                  defaultValue={connection.status}
                                  options={[
                                    { label: "Conectado", value: "connected" },
                                    { label: "Pendente", value: "pending" },
                                    { label: "Desconectado", value: "disconnected" },
                                  ]}
                                />
                              </div>
                              <Field label="Nome da conta" name="accountName" defaultValue={connection.accountName} placeholder="@sua_conta" />
                              <Field label="API key" name="apiKey" defaultValue={connection.apiKey} placeholder="Cole a chave da API" />
                              <Field label="API secret" name="apiSecret" defaultValue={connection.apiSecret} placeholder="Cole o segredo da API" />
                              <Field label="Access token" name="accessToken" defaultValue={connection.accessToken} placeholder="Token de acesso" />
                              <Field label="Refresh token" name="refreshToken" defaultValue={connection.refreshToken} placeholder="Token de refresh" />
                              <Field label="Webhook URL" name="webhookUrl" defaultValue={connection.webhookUrl} placeholder="https://..." />
                              <div className="flex flex-wrap gap-3">
                                <PrimaryButton label="Salvar conexao" />
                                <SecondaryButton label="Cancelar" onClick={() => setEditingConnectionId(null)} type="button" />
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-medium">{networkLabels[connection.network]}</h3>
                                  <p className="mt-1 text-sm text-ink/55">
                                    {connection.accountName || "Conta ainda nao configurada"}
                                  </p>
                                </div>
                                <StatusPill status={connection.status} />
                              </div>
                              <div className="mt-3 grid gap-1 text-sm text-ink/60">
                                <span>API key: {connection.apiKey ? "configurada" : "pendente"}</span>
                                <span>Access token: {connection.accessToken ? "configurado" : "pendente"}</span>
                                <span>
                                  Ultima sincronizacao: {connection.lastSync ? formatDate(connection.lastSync) : "ainda nao executada"}
                                </span>
                              </div>
                              <div className="mt-4">
                                <SecondaryButton label="Editar conexao" onClick={() => setEditingConnectionId(connection.id)} />
                              </div>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  </Card>

                  <div className="grid gap-5">
                    <Card title="Boas praticas de conexao" description="Checklist de UX para quando voce plugar as APIs reais.">
                      <ul className="grid gap-3 text-sm leading-6 text-ink/60">
                        <li>Defina uma conta por rede para reduzir erro operacional.</li>
                        <li>Salve tokens com rotacao e data de ultima sincronizacao.</li>
                        <li>Centralize callbacks e webhooks por ambiente.</li>
                        <li>Mostre estado de autenticacao antes de liberar agendamentos.</li>
                      </ul>
                    </Card>

                    <Card title="Resumo tecnico" description="Base pronta para integrar publicacao, analytics e refresh de credenciais.">
                      <div className="grid gap-3 text-sm text-ink/60">
                        <p>Esta aba foi criada para concentrar os fluxos de conexao por API com Instagram, Facebook, YouTube Shorts e TikTok.</p>
                        <p>Por enquanto os dados ficam salvos localmente, mas a estrutura do estado ja separa credenciais, conta conectada e ultimo sync.</p>
                      </div>
                    </Card>
                  </div>
                </section>
              ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

const viewMeta: Record<
  ViewKey,
  {
    title: string;
    description: string;
    actionLabel: string;
    onAction: (setActiveView: (view: ViewKey) => void) => (() => void) | undefined;
  }
> = {
  library: {
    title: "Biblioteca",
    description: "Gerencie arquivos, filtros e conteudos que continuam ou saem da base.",
    actionLabel: "Novo agendamento",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
  scheduler: {
    title: "Agendamentos",
    description: "Planeje a distribuicao de posts de forma simultanea entre redes.",
    actionLabel: "Abrir conexoes",
    onAction: (setActiveView) => () => setActiveView("config"),
  },
  reposts: {
    title: "Repostagem",
    description: "Configure os gatilhos de reaproveitamento e de remocao por score.",
    actionLabel: "Ajustar conexoes",
    onAction: (setActiveView) => () => setActiveView("config"),
  },
  users: {
    title: "Usuarios",
    description: "Crie, edite e revise acessos, nomes, e-mails e senhas.",
    actionLabel: "Novo usuario",
    onAction: () => undefined,
  },
  config: {
    title: "Config",
    description: "Central de conexoes e parametros de integracao via API.",
    actionLabel: "Ir para agendamentos",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
};

const pageTitleMap: Record<ViewKey, string> = {
  library: "Biblioteca",
  scheduler: "Agendamentos",
  reposts: "Repostagem",
  users: "Usuarios",
  config: "Config",
};

function ViewHeader({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="font-display text-3xl tracking-[-0.04em]">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">{description}</p>
      </div>
      {onAction ? (
        <button type="button" onClick={onAction} className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={classNames(
        "flex items-center justify-center rounded-[1.4rem] border border-violet/12 bg-white shadow-sm",
        compact ? "size-14" : "size-16",
      )}
    >
      <HeartPlayIcon className={compact ? "size-8 text-rose-600" : "size-9 text-rose-600"} />
    </div>
  );
}

function IllustrationRow({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="flex items-start gap-4 rounded-[1.4rem] border border-violet/10 bg-violet/5 p-4">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-white">{icon}</div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-ink/58">{description}</p>
      </div>
    </article>
  );
}

function NavIcon({ view }: { view: ViewKey }) {
  switch (view) {
    case "library":
      return <LibraryIcon className="size-4" />;
    case "scheduler":
      return <CalendarIcon className="size-4" />;
    case "reposts":
      return <CycleIcon className="size-4" />;
    case "users":
      return <UsersIcon className="size-4" />;
    case "config":
      return <ConnectionIcon className="size-4" />;
    default:
      return <HeartPlayIcon className="size-4" />;
  }
}

function HeartPlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7.1 6A3.6 3.6 0 0 0 3.5 9.6c0 4.3 6.5 7.9 7.8 8.6a1.2 1.2 0 0 0 1.1 0c1.3-.7 7.8-4.3 7.8-8.6A3.6 3.6 0 0 0 16.6 6c-1.2 0-2.3.5-3 1.7C12.9 6.5 11.8 6 10.6 6c-1 0-2 .3-2.7.9A3.5 3.5 0 0 0 7.1 6Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path d="M11.4 8.4v6.8l5.4-3.4-5.4-3.4Z" fill="#fca5a5" />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5" width="4" height="14" rx="1.2" fill="currentColor" opacity="0.95" />
      <rect x="10" y="4" width="4" height="15" rx="1.2" fill="currentColor" opacity="0.72" />
      <rect x="16" y="7" width="4" height="12" rx="1.2" fill="currentColor" opacity="0.52" />
    </svg>
  );
}

function ConnectionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9.2 8.2 6.8 10.6a2.4 2.4 0 0 0 0 3.4 2.4 2.4 0 0 0 3.4 0l2.3-2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m14.8 15.8 2.4-2.4a2.4 2.4 0 0 0 0-3.4 2.4 2.4 0 0 0-3.4 0l-2.3 2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m9.8 14.2 4.4-4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4v4M16 4v4M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function CycleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 7h5V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17h-5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 17.6A6 6 0 0 1 6 9.5L7 8.3M16.4 6.4A6 6 0 0 1 18 14.5L17 15.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" opacity="0.7" />
      <path d="M4.5 18.5a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14.5 18.5a3.5 3.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
      <div className="mb-5">
        <h3 className="font-display text-2xl tracking-[-0.04em]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/58">{description}</p>
      </div>
      {children}
    </section>
  );
}

function FormGrid({ action, children }: { action: (formData: FormData) => void; children: React.ReactNode }) {
  return <form action={action} className="grid gap-4">{children}</form>;
}

function FlashBanner({ flash, className }: { flash: NonNullable<FlashState>; className?: string }) {
  return (
    <div
      className={classNames(
        "rounded-2xl px-4 py-3 text-sm",
        flash.kind === "error" ? "bg-rose-100 text-rose-700" : "bg-violet/10 text-violet",
        className,
      )}
    >
      {flash.message}
    </div>
  );
}

function StatusPill({ status }: { status: SocialConnection["status"] }) {
  return (
    <span
      className={classNames(
        "rounded-full px-3 py-1 text-xs",
        status === "connected"
          ? "bg-emerald-100 text-emerald-700"
          : status === "pending"
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-600",
      )}
    >
      {status}
    </span>
  );
}

function CheckGrid({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium text-ink/75">{legend}</legend>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function CheckCard({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
      <input name={name} type="checkbox" value={value} className="size-4 accent-violet" />
      <span className="text-sm text-ink/75">{label}</span>
    </label>
  );
}

function PrimaryButton({ label }: { label: string }) {
  return <button className="mt-2 rounded-full bg-violet px-5 py-3 text-sm font-medium text-white">{label}</button>;
}

function SecondaryButton({
  label,
  onClick,
  type = "button",
}: {
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet"
    >
      {label}
    </button>
  );
}

function GhostDangerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-rose-100 px-4 py-2 text-sm font-medium text-rose-700">
      {label}
    </button>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  defaultValue,
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="text-ink/75">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required
        className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="text-ink/75">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
      >
        {options.map((option) => (
          <option key={`${name}-${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
