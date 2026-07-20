# Assistente de IA para atendimento via WhatsApp (suporte)

## Contexto

Você atua no suporte e usa o WhatsApp (número da empresa) para falar com clientes.
Hoje isso é manual: você lê, responde, e depois abre um chamado no Movidesk. O
objetivo é ter uma camada de IA que "observe" as conversas e ajude a:

1. Dar um 1º retorno rápido ao cliente
2. Manter um contexto/histórico do caso (mensagens do cliente + suas respostas)
3. Avisar quando um cliente respondeu e ainda não foi atendido
4. Gerar o corpo de um "pré-chamado" (resumo do caso) — por enquanto basta ser uma
   mensagem que a IA te envia (não precisa integrar com Movidesk agora; você mesmo
   copia para lá depois)

Requisito inicial: **gratuito**. Requisito inegociável (levantado depois, ao
comparar abordagens): **não podemos correr o risco de perder esse número**.

Duas famílias de abordagem foram avaliadas:
- Biblioteca não-oficial (Baileys/whatsapp-web.js) rodando como dispositivo
  vinculado: gratuita, sem burocracia, mas viola os Termos de Uso do WhatsApp e tem
  risco real de bloqueio — mesmo com middlewares anti-ban, nenhum deles garante que o
  número não será banido.
- **WhatsApp Coexistence** (recurso oficial da Meta, lançado em 2026): permite ligar a
  Cloud API oficial no **mesmo número** que já roda o app WhatsApp Business no
  celular, ao mesmo tempo. É sancionado pela Meta — elimina o risco de bloqueio.
  Conversas de suporte iniciadas pelo cliente ("service conversations") são gratuitas
  e ilimitadas. O custo é mais burocracia de setup (verificação de empresa na Meta) e
  precisar de um webhook público (não dá mais pra rodar 100% isolado na sua máquina
  sem nenhuma exposição à internet).

Dado que perder o número não é uma opção, a decisão foi trocar para **Coexistence +
Cloud API**, aceitando o setup inicial mais burocrático em troca de eliminar o risco.

## Abordagem recomendada

**WhatsApp Cloud API oficial (Meta) em modo Coexistence** + **Cloudflare Tunnel**
(gratuito, expõe seu script local com HTTPS sem precisar de VPS/hospedagem paga) +
**Groq API** (LLM gratuito) para gerar os textos.

Por que essa combinação:
- **Coexistence** deixa o app do WhatsApp Business no celular funcionando normalmente
  (você continua podendo responder por lá) enquanto a Cloud API roda em paralelo no
  mesmo número — nenhuma automação não-oficial, nenhum risco de ToS.
- A Meta dispara um webhook (`smb_message_echoes`) toda vez que você manda mensagem
  pelo **app do celular** — então o script consegue saber que você respondeu mesmo
  sem você precisar interagir com o bot, resolvendo o "monitor de atraso" sem
  gambiarra.
- **Cloudflare Tunnel** é gratuito e permite manter o script rodando na sua própria
  máquina (como no plano original) — só adiciona uma camada que expõe uma URL
  `https://algo.trycloudflare.com` (ou um domínio seu) apontando pro seu processo
  local, sem custo de servidor.
- Conversas de suporte (cliente inicia, você responde dentro da janela de 24h) são
  gratuitas e ilimitadas na Cloud API — só mensagens de template (marketing/utilidade)
  iniciadas por você fora dessa janela é que são cobradas, e não é esse o seu caso.

**O que muda de burocracia (fora do código):**
1. Confirmar/criar uma conta no **Meta Business Manager** para a empresa (verificação
   de empresa, geralmente pede documentos como CNPJ) — pode levar de poucos dias a
   ~30 dias em casos raros, normalmente 3–10 dias úteis.
2. Criar um app no **Meta for Developers**, adicionar o produto "WhatsApp".
3. Ativar o **Coexistence** para o número atual (fluxo de "Embedded Signup" dentro do
   Business Manager) — isso vincula a Cloud API ao número que já está no WhatsApp
   Business App, sem perder o número nem o histórico do app.
4. Gerar um **token de acesso** (System User token, de longa duração) para o app
   chamar a API.

## Como vai funcionar (fluxo)

Um script Node.js roda na sua máquina, recebendo eventos via webhook (através do
Cloudflare Tunnel) e chamando a Cloud API para enviar mensagens de aviso. Ele guarda
um pequeno "banco" local (arquivo JSON ou SQLite) por contato: histórico de
mensagens, timestamps, e status (respondido / aguardando).

1. **Mensagem nova de um cliente chega** → a Meta envia um webhook de mensagem
   recebida → o script salva no histórico do contato, chama a Groq API com o
   histórico + a nova mensagem, gera uma sugestão de 1ª resposta, e te envia essa
   sugestão (mensagem para você mesmo, via Cloud API, ou você lê no terminal/log).
   Você decide: copiar e responder pelo app do celular, ou deixar a própria Cloud API
   enviar a resposta direto ao cliente (agora seguro, já que é canal oficial).
2. **Você responde ao cliente** → seja pelo app do celular (webhook
   `smb_message_echoes`) ou pela Cloud API — o script detecta e marca o caso como
   "respondido", zerando o cronômetro de atraso.
3. **Monitor de atraso** → uma rotina roda em intervalos (ex. a cada 5–10 min) e
   verifica: para cada contato, se a última mensagem foi do cliente e já passou X
   minutos sem resposta sua, dispara um aviso (mensagem para você via Cloud API).
4. **Gerar pré-chamado** → quando você quiser fechar/registrar o caso, envia um
   comando no seu canal de controle identificando o contato (ex. `/case
   5511999999999`). O script busca o histórico daquele contato, pede pra Groq
   resumir (cliente, resumo do problema, respostas dadas, status) e te manda esse
   texto pronto para colar no Movidesk.

## Componentes principais

- **Webhook receiver** (Node.js + Express, ou `http` puro): endpoint que recebe os
  eventos da Cloud API (mensagem recebida, `smb_message_echoes`, status de entrega) e
  valida o `verify_token` na configuração inicial do webhook.
- **Cloudflare Tunnel**: processo separado (`cloudflared`) que expõe o servidor local
  publicamente com HTTPS, sem custo e sem precisar abrir portas no roteador.
- **Cliente da Cloud API**: funções que chamam `POST
  https://graph.facebook.com/v<versão>/<phone_number_id>/messages` (via `axios`) para
  enviar mensagens — usadas tanto pra avisos no canal de controle quanto,
  opcionalmente, pra responder o cliente direto.
- **Armazenamento de contexto**: arquivo `contatos.json` (ou SQLite) — chave = número
  do contato, valor = histórico + timestamps + status.
- **Gerador de resposta/resumo** (Groq API): mesmo desenho do plano anterior — um
  prompt pra sugerir 1ª resposta, outro pra resumir em formato de chamado.
- **Monitor de atraso**: `setInterval` que varre o armazenamento e dispara alerta.

## Passo a passo de implementação

**Setup fora do código (você/Meta):**
1. Confirmar se a empresa já tem Meta Business Manager verificado; se não, criar e
   verificar (CNPJ e documentos da empresa).
2. Criar um app em developers.facebook.com, adicionar o produto WhatsApp.
3. Rodar o fluxo de Coexistence/Embedded Signup pra vincular o número atual (o mesmo
   que já está no WhatsApp Business App) à Cloud API.
4. Gerar o token de acesso de longa duração (System User) e guardar o
   `phone_number_id` e o `WABA ID`.

**Código:**
1. Instalar Node.js (LTS) e `cloudflared` (Cloudflare Tunnel) na máquina que vai
   rodar o script.
2. Criar o projeto, instalar `express`, `axios`, `dotenv`.
3. Criar conta gratuita na Groq (console.groq.com) e gerar uma API key.
4. Escrever o servidor com:
   - endpoint `GET /webhook` para validação inicial (`hub.challenge`),
   - endpoint `POST /webhook` que recebe mensagens recebidas, `smb_message_echoes` e
     atualiza o armazenamento de contexto,
   - função de envio de mensagem via Cloud API,
   - integração com Groq (sugestão de resposta / resumo),
   - rotina de verificação de atraso,
   - handler do comando de gerar pré-chamado (via mensagem no canal de controle).
5. Subir o `cloudflared tunnel` apontando pro servidor local, pegar a URL pública e
   configurar no webhook do app da Meta.
6. Testar o fluxo de ponta a ponta com o número real (não precisa de número
   descartável aqui, já que não há risco de bloqueio).

## Verificação

- Confirmar que o webhook de verificação (`GET /webhook`) responde corretamente
  durante a configuração no painel da Meta.
- Mandar uma mensagem de um número de teste para o WhatsApp da empresa e confirmar:
  a) o histórico é salvo, b) você recebe a sugestão de resposta no canal de controle.
- Responder pelo app do celular e confirmar que o `smb_message_echoes` chega e marca
  o caso como "respondido" (zera o alerta de atraso).
- Deixar uma mensagem sem resposta além do tempo configurado e confirmar que o alerta
  de atraso chega.
- Rodar o comando de gerar pré-chamado e conferir se o resumo faz sentido e cobre:
  identificação do cliente, resumo do problema, o que já foi respondido.

## Evolução futura (fora do escopo inicial)

Se depois disso for bem, dá pra: integrar direto com a API do Movidesk para criar o
chamado automaticamente (em vez de só te mandar o texto), ou deixar a Cloud API
responder automaticamente ao cliente em vez de só sugerir (já é seguro fazer isso
aqui, diferente da abordagem não-oficial — é uma escolha de quanto você confia na IA,
não mais uma questão de risco de bloqueio).
