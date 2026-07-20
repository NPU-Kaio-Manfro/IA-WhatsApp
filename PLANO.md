# Assistente de IA para atendimento via WhatsApp (suporte)

## Contexto

Você atua no suporte e usa o WhatsApp Web (conta/número da empresa, sem API oficial
contratada) para falar com clientes. Hoje isso é manual: você lê, responde, e depois
abre um chamado no Movidesk. O objetivo é ter uma camada de IA que "observe" as
conversas e ajude a:

1. Dar um 1º retorno rápido ao cliente
2. Manter um contexto/histórico do caso (mensagens do cliente + suas respostas)
3. Avisar quando um cliente respondeu e ainda não foi atendido
4. Gerar o corpo de um "pré-chamado" (resumo do caso) — por enquanto basta ser uma
   mensagem que a IA te envia (não precisa integrar com Movidesk agora; você mesmo
   copia para lá depois)

Requisito: **gratuito**, e você topa seguir um tutorial/rodar scripts (não precisa
ser 100% no-code, mas o caminho mais simples é preferível).

Não existe uma ferramenta pronta gratuita de mercado que já faça exatamente essas 4
coisas juntas para WhatsApp Web pessoal/comercial sem API oficial — as ferramentas
prontas (Zaia, Chatwoot, etc.) ou exigem a API oficial paga/Meta, ou são pagas, ou não
cobrem o fluxo de "monitorar + avisar atraso + gerar resumo". O caminho viável e
gratuito é montar um script próprio, pequeno, usando uma biblioteca não-oficial que
controla o WhatsApp Web pelo navegador, mais uma IA gratuita para gerar texto.

## Abordagem recomendada

**whatsapp-web.js** (Node.js, controla uma sessão real do WhatsApp Web via um
Chromium automatizado, login por QR Code) + **Groq API** (LLM gratuito, sem cartão de
crédito, modelos Llama, rápido) para gerar os textos.

Por que essa combinação:
- `whatsapp-web.js` é a biblioteca mais simples de configurar para "ler e escrever"
  mensagens do WhatsApp Web (comparado a Baileys, que é mais leve mas tem API mais
  crua/baixo nível). Você só precisa escanear o QR Code uma vez.
- Groq é gratuito (sem cartão), com limite de uso generoso para o volume de um
  atendente individual (ex.: `llama-3.1-8b-instant` permite ~14.400 requisições/dia).

**Aviso importante sobre risco:** essas bibliotecas são não-oficiais — elas emulam o
WhatsApp Web e violam os Termos de Uso do WhatsApp. Uso de baixo volume, para
atendimento pessoal (não disparo em massa), tem risco baixo, mas existe risco de
bloqueio do número, principalmente se você automatizar respostas em massa ou operar
muito rápido. Recomendação: testar primeiro num número secundário (ex. um chip de
teste) antes de ligar no número da empresa, e não fazer envio automático em massa —
o uso aqui é assistivo (a IA sugere, você decide/envia o retorno inicial ou uma
resposta automática simples e comedida).

## Como vai funcionar (fluxo)

Um único script Node.js roda na sua máquina (precisa ficar ligada/logada enquanto
estiver em uso), com uma sessão do WhatsApp Web conectada. Ele guarda um pequeno
"banco" local (arquivo JSON ou SQLite) por contato, com: histórico de mensagens do
cliente, suas respostas, timestamp da última mensagem de cada lado, e status
(respondido / aguardando).

1. **Mensagem nova de um cliente chega** → o script salva no histórico do contato,
   chama a Groq API com o histórico + a nova mensagem, e gera uma sugestão de 1ª
   resposta. Essa sugestão é enviada para você (ex. numa conversa "só sua" no próprio
   WhatsApp, tipo uma mensagem para si mesmo, ou um grupo de controle) — você copia e
   cola, ajusta e envia, ou (se confiar) deixa enviar direto ao cliente.
2. **Você responde ao cliente pelo WhatsApp normalmente** → o script detecta a
   mensagem enviada por você para aquele contato e marca o caso como "respondido",
   zerando o cronômetro de atraso.
3. **Monitor de atraso** → uma rotina roda em intervalos (ex. a cada 5–10 min) e
   verifica: para cada contato, se a última mensagem foi do cliente e já passou X
   minutos sem resposta sua, dispara um aviso (mensagem para você / notificação).
4. **Gerar pré-chamado** → quando você quiser fechar/registrar o caso, envia um
   comando simples na própria conversa com o cliente (ex. `/case`) ou comando num chat
   de controle. O script pega o histórico daquele contato, pede pra Groq resumir
   (cliente, resumo do problema, respostas dadas, status) e te manda esse texto
   pronto para colar no Movidesk.

## Componentes principais

- **Sessão WhatsApp** (`whatsapp-web.js` + `whatsapp-web.js`'s `Client`): autenticação
  via QR Code, listeners de mensagem (`message`, `message_create`).
- **Armazenamento de contexto**: arquivo `contatos.json` (ou SQLite se preferir mais
  robustez) — chave = número do contato, valor = lista de mensagens + timestamps +
  status.
- **Gerador de resposta/resumo** (chamadas à Groq API): dois prompts distintos —
  um para "sugerir 1ª resposta" e outro para "resumir caso em formato de chamado".
- **Monitor de atraso**: um `setInterval` simples que varre o armazenamento de
  contexto e dispara alerta quando aplicável.
- **Canal de aviso**: mensagens do próprio bot para você (contato "Mensagens para
  mim"/self-chat do WhatsApp, ou um grupo dedicado "Controle Suporte").

## Passo a passo de implementação

1. Instalar Node.js (LTS) na máquina que ficará rodando o script.
2. Criar o projeto, instalar `whatsapp-web.js` e `qrcode-terminal` (para exibir o QR
   no terminal) e `axios`/`node-fetch` para chamar a Groq API.
3. Criar conta gratuita na Groq (console.groq.com) e gerar uma API key.
4. Escrever o script principal com:
   - inicialização do client e exibição do QR Code para login,
   - listener de mensagens recebidas (grava contexto, chama IA, envia sugestão),
   - listener de mensagens enviadas por você (marca "respondido"),
   - rotina de verificação de atraso,
   - handler do comando de gerar pré-chamado.
5. Testar primeiro com um número descartável/pessoal por alguns dias antes de migrar
   para o número da empresa.
6. Ajustar o tempo de "atraso aceitável" e o texto dos prompts conforme o seu estilo
   de atendimento.

## Verificação

- Rodar o script, escanear o QR Code, confirmar que a sessão conecta (`ready` event).
- Enviar uma mensagem de teste de outro celular simulando "cliente" e confirmar que:
  a) o histórico é salvo, b) você recebe a sugestão de resposta no seu canal de
  controle.
- Responder ao "cliente" de teste e confirmar que o status muda para "respondido"
  (não deve disparar alerta de atraso depois disso).
- Deixar uma mensagem de teste sem resposta além do tempo configurado e confirmar
  que o alerta de atraso chega.
- Rodar o comando de gerar pré-chamado e conferir se o resumo faz sentido e cobre:
  identificação do cliente, resumo do problema, o que já foi respondido.

## Evolução futura (fora do escopo inicial)

Se depois disso for bem, dá pra: integrar direto com a API do Movidesk para criar o
chamado automaticamente (em vez de só te mandar o texto), ou migrar para a API
oficial do WhatsApp Business (Cloud API) para eliminar o risco de bloqueio — mas isso
tem custo e processo de aprovação, por isso não faz parte do escopo gratuito inicial.
