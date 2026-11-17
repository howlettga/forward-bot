# forward-bot

A Cloudflare Email Worker. Mail sent to `contact@howlettga.net` is:

1. **forwarded** to a personal inbox (critical path: if forwarding fails, the handler throws so Cloudflare bounces/retries), then
2. **summarized in Telegram** by a dedicated bot (best effort: failures are logged and swallowed, never dropping the email).

```
sender -> Cloudflare Email Routing -> rule: contact@howlettga.net -> Worker email()
                                                        |- message.forward(FORWARD_TO)
                                                        '- Telegram sendMessage(CHAT_ID)
```

The summary has from, to, subject, date, a text body (HTML is stripped if there is no text part, truncated to fit Telegram's 4096-char limit) and attachment names/sizes. Mail over 1 MiB gets a header-only summary to stay inside the CPU budget (Free plan: 10 ms). The raw message is copied out of the stream before forwarding (cheap), but parsing happens only after the forward succeeds.

## Secrets

Nothing sensitive is in this repo. Three values are needed, all as Worker secrets (and in the gitignored `.dev.vars` locally; see `.dev.vars.example`):

| Name | Meaning |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token from @BotFather |
| `TELEGRAM_CHAT_ID` | numeric id of the chat the bot posts to |
| `FORWARD_TO` | the destination inbox (must be a verified Email Routing destination) |

## One-time setup

1. **Email Routing.** Enable it for the zone (Dashboard > Compute & AI > Email Service > Email Routing > your zone > Enable, or `npx wrangler email routing enable <zone>`). This adds MX and SPF records. Keep the catch-all disabled/drop.
2. **Destination address.** `npx wrangler email routing addresses create <DESTINATION_EMAIL>`, then click the verification link Cloudflare emails to that inbox. `forward()` only works for verified destinations.
3. **Telegram bot.** In Telegram, message @BotFather, run `/newbot`, and keep the token. Then send your new bot any message.
4. **Chat id.** `curl https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[].message.chat.id` (your private chat).
5. **Secrets.** For each of the three names: `npx wrangler secret put <NAME>` (after the first deploy, or `wrangler secret bulk` from a dotenv file).
6. **Routing rule.** Route `contact@howlettga.net` to the Worker `forward-bot` (Dashboard > Email Routing > Routing rules, or `npx wrangler email routing rules create ...`; check `--help` for the worker-action flags).

## Local testing

```sh
cp .dev.vars.example .dev.vars   # fill in real values; never commit it
npm run dev
```

In another terminal, post the sample message to the local email handler (it must have a `Message-ID` header):

```sh
curl -X POST 'http://localhost:8787/cdn-cgi/local/email' \
  --url-query 'from=alice@example.com' \
  --url-query 'to=contact@howlettga.net' \
  --data-binary @test/fixtures/sample.eml
```

Locally, `forward()` is simulated (wrangler logs the destination and headers) and the Telegram call is real, so use a real bot token and chat id to see the message. Unit tests for the formatter: `npm test`. Type check: `npm run typecheck`.

## Deploy

```sh
npm run deploy
```

Logs: `npx wrangler tail forward-bot --format pretty`. End-to-end check: send mail from another account to `contact@howlettga.net` and confirm it arrives in the inbox and in Telegram.
