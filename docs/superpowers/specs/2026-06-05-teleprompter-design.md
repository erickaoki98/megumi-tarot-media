# Teleprompter — Especificação de Design

**Data:** 2026-06-05
**Projeto:** `megumi-tarot-media` (PulsePost Admin — Next.js 15 + Tailwind)
**Branch:** `feat/teleprompter`

## 1. Visão geral

Nova aba **Teleprompter** no app, **100% pensada para celular (mobile-first)**. Ela mostra um roteiro em tela cheia que **rola automaticamente conforme a pessoa fala**, usando reconhecimento de fala do navegador em tempo real (pt-BR). No modo principal, a **câmera frontal** aparece como fundo e o texto flutua por cima (efeito "texto sobre o rosto"), permitindo **gravar um vídeo limpo** (só a imagem da câmera, sem o texto queimado) e baixá-lo.

O texto vem dos **roteiros já cadastrados** na aba Roteiros (cada `Script` tem `title` e `body`) **ou** de um texto avulso colado/digitado na hora.

**Acesso por desktop é bloqueado**: ao abrir a aba num computador, em vez do prompter aparece a mensagem exata `Página acessível apenas via mobile`.

## 2. Objetivos e não-objetivos

### Objetivos (Fase 1)
- Aba `teleprompter` integrada à navegação existente (`ViewKey`).
- **UX 100% mobile-first** (retrato, alvos de toque grandes, tela cheia). **Acesso por desktop é bloqueado** com a mensagem exata `Página acessível apenas via mobile`.
- Selecionar fonte do texto: roteiro existente **ou** texto avulso.
- Prompter em tela cheia com câmera frontal de fundo (espelhada) e texto por cima.
- **Rastreamento por voz**: o texto rola e destaca a linha atual conforme a pessoa fala.
- **Fallback manual** (rolagem em velocidade ajustável) sempre disponível quando o reconhecimento de fala não existir ou falhar.
- **Gravação limpa** (vídeo + áudio, sem o texto na imagem) com download do arquivo.
- Tratamento claro de permissões (câmera/microfone) e de falhas, em pt-BR.

### Objetivos (Fase 2 — secundário)
- Modo **flutuante Picture-in-Picture (PiP)**: texto desenhado num canvas vira vídeo e flutua sobre outros apps. **Sem rastreamento por voz** (o iOS congela o microfone em segundo plano) → rolagem em velocidade fixa/ajustável.

### Não-objetivos
- Sobrepor o teleprompter ao **app de câmera nativo** do iPhone (**impossível** com tecnologia web no iOS — ver §8).
- **Suporte a desktop** para a aba Teleprompter (é intencionalmente bloqueada no desktop).
- Enviar o vídeo gravado para a Biblioteca/R2 (fica para depois; por ora só download).
- Edição de vídeo, legendas automáticas no vídeo final, multi-idioma além de pt-BR.

## 3. Fluxo de uso (modo principal)

1. Usuário abre a aba **Teleprompter** **num celular** (no desktop vê só a mensagem de bloqueio).
2. Escolhe a fonte do texto:
   - **Roteiro**: lista os `scripts` do estado do app; seleciona um (usa o `body`).
   - **Avulso**: cola/digita o texto num campo.
3. Toca em **Iniciar** → entra na tela cheia do prompter:
   - **Fundo:** câmera frontal ao vivo, espelhada (como selfie).
   - **Frente:** texto rolando, com a **linha atual destacada**.
4. Usuário fala → o texto **acompanha a voz** e rola sozinho, mantendo a linha atual na zona de leitura (terço superior).
5. **● Gravar** grava o vídeo limpo; **■ Parar** finaliza e oferece o **download** do arquivo.
6. Se desviar, o usuário **toca numa linha** para re-sincronizar o ponteiro.

## 4. Arquitetura e arquivos

Decisão: o recurso é um **módulo isolado**, não inline no arquivo gigante `components/pulsepost-app.tsx` (3.610 linhas). Isso mantém o recurso testável e separado, e evita piorar o arquivo grande.

### Arquivos a criar
- `components/teleprompter/teleprompter-view.tsx` — a tela da aba: aplica o gate mobile-only, e (no celular) o seletor de fonte do texto + entrada no modo tela cheia.
- `components/teleprompter/prompter-stage.tsx` — a camada de tela cheia: `<video>` da câmera ao fundo + texto rolável por cima + barra de controles (mobile-first).
- `components/teleprompter/use-speech-scroll.ts` — hook do rastreamento por voz (encapsula a Web Speech API + a lógica de avanço do ponteiro). Expõe posição/linha atual e controles (iniciar/parar/re-sincronizar).
- `components/teleprompter/use-camera-recorder.ts` — hook da câmera + gravação (`getUserMedia`, `MediaRecorder`, estado de permissão, blob gravado).
- `components/teleprompter/use-is-mobile.ts` — detecção de dispositivo móvel para o gate (ponteiro grosso + largura de viewport pequena, com user-agent como sinal secundário; reavalia no `resize`).
- `components/teleprompter/match-position.ts` — **função pura** que casa as palavras reconhecidas com o roteiro e retorna a nova posição do ponteiro. Sem dependência de browser → unit-testável.

### Arquivos a tocar (mínimo)
- `types/app.ts` — adicionar `"teleprompter"` ao union `ViewKey`.
- `components/pulsepost-app.tsx` — 1 item no menu (`nav`), 1 caso no `NavIcon`, 1 entrada em `viewMeta`/`pageTitleMap`, e renderizar `<TeleprompterView/>` quando `activeView === "teleprompter"`. **Nenhuma** lógica pesada entra aqui.

## 4.1 Gate mobile-only (bloqueio no desktop)

Toda a UX é desenhada para **celular em modo retrato** (alvos de toque grandes, tela cheia). Ao abrir a aba Teleprompter num **desktop** (ponteiro fino + viewport larga), em vez do prompter renderiza-se uma tela simples e centralizada com a mensagem **exata**:

> Página acessível apenas via mobile

- Detecção em `use-is-mobile.ts`: considera "mobile" quando `(pointer: coarse)` **e** a largura da viewport é pequena (limiar ~820px), com user-agent (iPhone/Android) como sinal secundário. Reavalia em `resize`.
- O **modo de emulação de dispositivo** do navegador (DevTools) satisfaz esses critérios, então a UI ainda pode ser testada no desktop via emulação durante o desenvolvimento.
- O gate é aplicado no `TeleprompterView`; o resto do app (admin) continua acessível normalmente no desktop.

## 5. Rastreamento por voz (algoritmo)

- **API:** Web Speech API (`webkitSpeechRecognition`/`SpeechRecognition`), `lang = "pt-BR"`, `continuous = true`, `interimResults = true`.
- **Pré-processo:** o roteiro é tokenizado em palavras, com normalização (minúsculas, sem acentos, sem pontuação) para comparação.
- **A cada resultado** (parcial ou final):
  1. Pega as últimas N palavras reconhecidas (ex.: 4–6).
  2. Procura o melhor alinhamento dessas palavras numa **janela** de palavras à frente da posição atual (ex.: próximas 15–20), tolerando palavras puladas e erros de transcrição.
  3. Se achar um casamento bom o suficiente, **avança o ponteiro** para o fim do trecho casado.
- **Função pura** `matchPosition(scriptTokens, recognizedTokens, currentIndex)` contém essa lógica (testável).
- **Rolagem:** mantém a palavra/linha atual na zona de leitura (terço superior), com transição suave; destaca a linha atual.
- **Re-sincronizar:** tocar numa linha move o ponteiro para ela (corrige desvios e improvisos longos).
- **Anti-travamento:** se ficar sem casar por um tempo, mantém a última posição (não pula para trás) e o usuário pode assumir no manual ou re-sincronizar.

## 6. Gravação limpa

- O texto fica numa **camada HTML por cima** do `<video>`; essa camada **nunca** entra no `MediaStream` da câmera.
- Gravo diretamente o fluxo de `getUserMedia` (faixas de vídeo **e** áudio) com `MediaRecorder` → o arquivo sai **só com a imagem da câmera + áudio**, sem o teleprompter.
- Ao parar, gero um `Blob` e ofereço **download** (link com o arquivo). Formato conforme suporte do navegador (ex.: `video/mp4` quando possível; `webm` no desktop/emulação).
- Integração futura (fora do escopo): enviar o `Blob` para a Biblioteca/R2 via `app/api/media/upload/route.ts`.

## 7. Permissões e tratamento de falhas

- Solicitar **câmera + microfone** via `getUserMedia`; se negado/indisponível, mostrar mensagem clara em pt-BR e oferecer alternativas (ex.: prompter sem câmera, ou só leitura).
- **Feature-detection** da Web Speech API. Se ausente/falhar → **modo manual** (rolagem automática com velocidade ajustável). A aba **sempre** funciona, mesmo sem voz.
- Mensagens de estado visíveis: microfone ouvindo, gravando (ponto vermelho + tempo), erro de permissão.

## 8. Riscos reais do iOS (a validar cedo no aparelho)

Não dá para prometer 100% sem testar no iPhone. Riscos conhecidos e mitigação:

1. **Reconhecimento de fala em PWA (instalado como web app) no iOS** historicamente falha — pode só funcionar no Safari normal. **Mitigação:** detectar e cair no fallback manual; orientar abrir no Safari se necessário.
2. **Microfone compartilhado** entre o reconhecimento de fala e a gravação (`MediaRecorder`) pode conflitar no iOS. **Mitigação:** se conflitar, "rastrear voz" e "gravar" viram ações separadas (ou a gravação usa o mic e a voz pausa).
3. **Sobrepor à câmera nativa é impossível:** o iOS não deixa web app desenhar sobre outro app, e congela JS/microfone em segundo plano. Por isso o modo principal mantém **tudo numa tela só** (câmera dentro do app).

Esses riscos serão verificados com um teste mínimo no início da implementação, antes de construir o resto.

## 9. Modo flutuante PiP — Fase 2 (secundário)

- Desenhar o texto num `<canvas>` → `canvas.captureStream()` → `<video>` oculto → `requestPictureInPicture()`.
- A janela PiP flutua sobre outros apps (inclusive a câmera nativa), mas é **somente exibição**.
- **Sem rastreamento por voz** (mic congela em segundo plano) → rolagem em **velocidade fixa/ajustável**.
- É o mais próximo da ideia original do usuário, com essa limitação assumida e comunicada.

## 10. Testes

- `match-position.ts`: unit tests com transcrições de exemplo — fala exata, palavra pulada, erro de transcrição, improviso/ad-lib. Verifica que o ponteiro avança corretamente e não volta atrás indevidamente.
- `use-is-mobile.ts`: teste da lógica de decisão (mobile vs desktop) com diferentes combinações de ponteiro/viewport/user-agent.
- Câmera, gravação, voz e PiP: teste manual via **emulação de dispositivo móvel** no Chrome (DevTools) e, principalmente, **no iPhone do usuário** (onde moram os riscos do §8). Em desktop real (sem emulação), a aba mostra apenas a mensagem de bloqueio mobile-only.

## 11. Decisões padrão (assumidas)

- **Mobile-only**: UX desenhada para celular (retrato); desktop recebe a mensagem `Página acessível apenas via mobile`.
- Câmera **frontal** com **espelho ligado** por padrão (botão para desligar).
- Reconhecimento em **pt-BR**.
- Gravação **vídeo + áudio**, baixável.
- Controles na tela cheia: voz on/off · ● gravar/■ parar · tamanho da fonte · espelho on/off · câmera on/off · velocidade manual (fallback) · fechar.

## 12. Fases de entrega

- **Fase 1 (núcleo):** aba + gate mobile-only + seletor de fonte (roteiros + avulso) + prompter tela cheia com câmera de fundo + rastreamento por voz + fallback manual + gravação limpa com download. Inicia com um **teste mínimo dos riscos do §8** no iPhone.
- **Fase 2 (secundário):** modo flutuante PiP (velocidade fixa).
