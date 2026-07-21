# Monitor de SLA de Atendimento via WhatsApp (whatsapp-web.js) — Design

## Contexto

O `PLANO.md` deste repositório documenta uma decisão anterior de abandonar
`whatsapp-web.js` (biblioteca não-oficial) em favor da WhatsApp Cloud API oficial
em modo Coexistence, por causa do risco de banimento do número.

Este projeto **conscientemente diverge dessa decisão**: o usuário pediu
explicitamente para construir sobre `whatsapp-web.js` mesmo assim (confirmado em
brainstorming, 2026-07-21), aceitando o risco de banimento por ora. Este spec
cobre apenas esse projeto (monitor de SLA read-only), não substitui o plano da
Cloud API.

## Objetivo

Um bot **somente leitura** que:
1. Escuta conversas do WhatsApp Web (DMs e grupos) e registra em SQLite quando um
   cliente manda mensagem e quando o dono do número responde.
2. Roda uma rotina diária (cron) que verifica pendências antigas e envia um
   relatório por e-mail, classificado por faixas de atraso.

O bot **nunca envia mensagens de volta pelo WhatsApp** — elimina o risco de
qualquer ação automatizada visível ao WhatsApp além de leitura de eventos.

## Stack

- Node.js (CommonJS, já configurado em `package.json`)
- `whatsapp-web.js` + `qrcode-terminal` + `LocalAuth` (sessão persistida local)
- `better-sqlite3` (API síncrona — mais simples para este volume de escrita)
- `node-cron` (agendamento diário)
- `nodemailer` (envio do relatório)
- `dotenv` (configuração sensível)

## Arquitetura / Módulos

- **`src/db.js`** — camada de dados. Inicializa o SQLite, cria a tabela
  `contacts` se não existir, expõe: `upsertClientMessage(chatId, name, isGroup)`,
  `markReplied(chatId)`, `getPendingContacts()`.
- **`src/whatsapp.js`** — inicializa o `Client` (`LocalAuth`), imprime QR Code,
  registra listeners `message` e `message_create`, delega toda escrita ao
  `db.js`. **Nunca chama `sendMessage`/`reply`.**
- **`src/mailer.js`** — monta o HTML do relatório (agrupado nas faixas
  configuráveis) e envia via `nodemailer`.
- **`src/scheduler.js`** — agenda `node-cron` no horário do `.env`, busca
  pendentes via `db.js`, calcula dias de atraso, só aciona o `mailer.js` se
  houver ao menos 1 pendente.
- **`index.js`** — ponto de entrada: inicializa DB, WhatsApp client e cron;
  trata erros de nível superior (`auth_failure`, `disconnected`,
  `unhandledRejection`).
- **`src/logger.js`** — registra erros em arquivo (`logs/errors.log`), com
  timestamp ISO e código do erro; usado pelos demais módulos.

**Fluxo de dados:** eventos do WhatsApp → `db.js` (SQLite) ← lido pelo
`scheduler.js` (cron diário) → `mailer.js` (e-mail).

## Schema (SQLite, tabela `contacts`)

| Coluna               | Tipo    | Descrição                                                   |
|-----------------------|---------|---------------------------------------------------------------|
| `chat_id`             | TEXT PK | `msg.from` / `chat.id._serialized` — `...@c.us` (DM) ou `...@g.us` (grupo) |
| `contact_name`        | TEXT    | Nome do contato (DM) ou assunto do grupo (grupo)              |
| `is_group`            | INTEGER | `0` (DM) ou `1` (grupo)                                       |
| `last_client_msg_at`  | DATETIME| Timestamp da última mensagem recebida de não-fromMe            |
| `last_reply_at`       | DATETIME| Timestamp da última mensagem fromMe nesse chat                 |
| `status`              | TEXT    | `PENDING` ou `REPLIED`                                        |

A PK é `chat_id` (não `phone_number`) para acomodar tanto DMs quanto grupos sob
a mesma tabela.

## Regras de negócio

### Mensagem recebida (evento `message`)

- Ignorar `status@broadcast` e listas de transmissão.
- Ignorar se `msg.fromMe === true` (evita duplicar com `message_create`).
- **DM**: resolver nome via `msg.getContact()` → `contact.name` (nome salvo na
  agenda), com fallback para `pushname`, com fallback para o número. Upsert
  `status='PENDING'`, `last_client_msg_at=agora`.
- **Grupo**: monitorado também (não ignorado). Nome = `chat.name` (assunto do
  grupo). Qualquer mensagem de não-fromMe no grupo — de qualquer participante —
  marca o registro daquele `chat_id` de grupo como `PENDING`,
  `last_client_msg_at=agora`.

### Mensagem enviada (evento `message_create`)

- Processar somente se `msg.fromMe === true`.
- Ignorar `status@broadcast` e listas de transmissão.
- **DM ou grupo**: marca `status='REPLIED'`, `last_reply_at=agora` no
  `chat_id` correspondente. Em grupos, isso vale independente de quem mandou a
  última mensagem do cliente — só a mensagem do dono do número (fromMe) zera o
  SLA.

### Fora de escopo agora (melhorias futuras, não implementar nesta versão)

- Filtro de "esta mensagem era para o suporte?" (ex: via reação de emoji ou
  comando de texto) para excluir mensagens de grupo que não devem contar no
  SLA.
- Whitelist de grupos monitorados (hoje: **todos os grupos são monitorados**).

### Rotina de verificação (cron)

- Agenda via `node-cron`, horário configurável em `.env` (`CRON_SCHEDULE`,
  padrão `0 9 * * *`).
- Busca todos os registros com `status='PENDING'`.
- Calcula dias corridos entre agora e `last_client_msg_at`.
- Classifica em faixas configuráveis via `.env` (padrão: 3–4 dias, 5–14 dias,
  15+ dias).
- Se houver ao menos um contato pendente em qualquer faixa, gera e envia um
  e-mail HTML com a lista (nome, telefone/ID do grupo, indicação DM vs Grupo,
  dias de espera), agrupado por faixa.
- Se não houver pendentes, não envia e-mail.

### Erros

- Erros de conexão do WhatsApp (`auth_failure`, `disconnected`) são logados;
  o processo não derruba, mas reporta no console.
- Erros de escrita/leitura no SQLite são logados e não interrompem o listener.
- Erro de envio de e-mail (SMTP) é logado; não derruba o cron (tenta de novo no
  próximo ciclo agendado).
- **Log em arquivo**: todo erro tratado (WhatsApp, SQLite, SMTP) é também
  registrado em `logs/errors.log` (`.env`: `ERROR_LOG_PATH`, padrão
  `./logs/errors.log`), uma linha por erro, formato
  `[<ISO timestamp>] [<código>] <mensagem>` — ex:
  `[2026-07-21T09:00:03.000Z] [SMTP_SEND_FAILED] Connection timeout`.
  Códigos usados: `WHATSAPP_AUTH_FAILURE`, `WHATSAPP_DISCONNECTED`,
  `DB_WRITE_ERROR`, `DB_READ_ERROR`, `SMTP_SEND_FAILED`. Um módulo
  **`src/logger.js`** centraliza essa escrita (append, cria o diretório/arquivo
  se não existir) para os demais módulos chamarem.

## Configuração (`.env`)

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
- `EMAIL_TO` (destinatário do relatório)
- `CRON_SCHEDULE` (padrão `0 9 * * *`)
- `SLA_THRESHOLDS` (padrão `3,5,15` — dias que definem o início de cada faixa)
- `DB_PATH` (padrão `./data/contacts.db`)
- `ERROR_LOG_PATH` (padrão `./logs/errors.log`)

## Fora de escopo (não incluído nesta versão)

- Reenvio automático de e-mail / fila de retry.
- Dashboard web.
- Testes automatizados (a menos que solicitado depois).
- Qualquer envio de mensagem de volta ao WhatsApp.
- Filtro de relevância de mensagem em grupo (reação/comando).
- Whitelist de grupos monitorados.
