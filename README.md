# Monitor de SLA de Atendimento via WhatsApp

Bot somente-leitura que monitora conversas do WhatsApp Web e envia um e-mail
diário com clientes (DM ou grupo) que estão há 3+, 5+ ou 15+ dias sem resposta.

## Instalação

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Copie o arquivo de configuração e preencha com suas credenciais:
   ```bash
   cp .env.example .env
   ```
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`: credenciais do serviço de e-mail.
     - **Com Resend (recomendado, mais simples)**: crie uma conta grátis em resend.com,
       gere uma API key em *API Keys → Create API Key*. Use `SMTP_HOST=smtp.resend.com`,
       `SMTP_USER=resend` (literal, não é seu e-mail), `SMTP_PASS=<sua API key>`.
     - **Com Gmail**: use uma "senha de app" (não a senha normal da conta) — gere em
       myaccount.google.com/apppasswords.
   - `EMAIL_FROM`: remetente do e-mail (precisa ser um endereço válido). Com Resend e
     sem domínio verificado, use `onboarding@resend.dev` (funciona para testes, envia
     para qualquer destinatário). Se não definido, cai para `SMTP_USER` — o que só
     funciona se `SMTP_USER` já for um e-mail válido (ex: Gmail), não com Resend.
   - `EMAIL_TO`: quem recebe o relatório.
   - `CRON_SCHEDULE`: quando rodar a verificação (formato cron; padrão `0 9 * * *` = todo dia às 09:00).
   - `SLA_THRESHOLDS`: dias que iniciam cada faixa de alerta (padrão `3,5,15`).
   - `DB_PATH`: onde o SQLite é salvo (padrão `./data/contacts.db`).
   - `ERROR_LOG_PATH`: onde os erros são registrados (padrão `./logs/errors.log`).

3. Rode os testes automatizados (opcional, mas recomendado):
   ```bash
   npm test
   ```

## Rodando

```bash
npm start
```

Na primeira execução, um QR Code aparece no terminal — escaneie com o
WhatsApp do celular (Aparelhos conectados → Conectar um aparelho). A sessão
fica salva localmente (pasta `.wwebjs_auth/`), então não pede QR Code de novo
nas próximas execuções, a menos que você saia da sessão no celular.

O bot roda em segundo plano, escutando mensagens (sem nunca responder por
conta própria) e disparando o relatório por e-mail no horário configurado.

## O que ele NÃO faz

- Não envia nenhuma mensagem pelo WhatsApp, para clientes ou grupos.
- Não filtra mensagens de grupo por relevância (toda mensagem de não-fromMe
  conta como pendência) — melhoria futura.
- Não tem lista de grupos monitorados — todos os grupos entram no
  monitoramento hoje — melhoria futura.
