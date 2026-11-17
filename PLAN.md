# forward-bot: build plan

A Cloudflare Email Worker. Mail sent to **contact@howlettga.net** is (1) forwarded to the owner's personal inbox and (2) summarized in a Telegram message from a dedicated bot.

```
sender ──SMTP──▶ Cloudflare Email Routing (MX on howlettga.net)
                   └─ rule: contact@howlettga.net ─▶ Worker "forward-bot" email()
                                                      ├─ message.forward(FORWARD_TO)   [must succeed]
                                                      └─ Telegram sendMessage(CHAT_ID) [best effort]
```

This file contains no secrets and is safe to commit.

---

## Facts established (2026-11-16)

| Item | Value |
|---|---|
| Cloudflare account | the one wrangler is logged into (`npx wrangler whoami`) |
| Wrangler auth scopes | include `email_routing (write)`, `email_sending (write)`, `workers (write)`, `zone (read)`. There is **no DNS write** scope. |
| Zones | `howlettga.net` (no MX, no SPF, so it's safe), `borrow.community` and `emergentcollective.software` (both use **Google Workspace MX**, so **do not touch**) |
| Email Routing | not enabled on any zone yet |
| GitHub | `gh` is logged in as `howlettga` over ssh with `repo` scope |
| Reference project | `../rude-bot` (TS Worker, wrangler 4, `.dev.vars` for local secrets, manual `wrangler deploy`) |

## Decisions

- **Address:** only `contact@howlettga.net` gets a rule. The catch-all stays **disabled/drop**.
- **Telegram:** a new bot from @BotFather. It only sends messages outbound, so it needs no webhook.
- **Repo:** `github.com/howlettga/forward-bot`, **public**.
- **Secrets** live only in Cloudflare Worker secrets and the gitignored `.dev.vars`:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - `FORWARD_TO`: the personal address. It's a secret rather than a var so it never appears in `wrangler.jsonc`.
- **Failure semantics:** email forwarding is the critical path. If `forward()` throws, let the handler throw so Cloudflare bounces or retries. A Telegram failure gets logged and is swallowed, so it never drops the email.
- **CPU budget:** the plan is unknown and may be Free, which allows 10 ms of CPU per call. Forward first. Run postal-mime only when `rawSize <= 1 MiB`. Above that, send a header-only Telegram summary.

---

## Human gates (the owner must do these; runners cannot)

| Gate | When | What |
|---|---|---|
| **H0: approve DNS change** | before Runner B | OK to enable Email Routing on howlettga.net. This adds MX and SPF TXT records. |
| **H1: Telegram bot** | any time before Runner D | 1. In @BotFather run `/newbot` and pick a name.<br>2. Paste the token into `forward-bot/.dev.vars` as `TELEGRAM_BOT_TOKEN=...` (not into chat).<br>3. Send the new bot any message so `getUpdates` can see your chat ID. |
| **H2: verify destination** | after Runner B | Click the Cloudflare verification link sent to the personal inbox. |
| **H3: E2E check** | end of Runner D | Send a real email from another account to contact@howlettga.net and confirm it arrives in both places. |

---

## Runners and dependencies

```
           ┌─ Runner A: code + tests (local only) ──┐
H0 ─▶ Runner B: Cloudflare routing + destination ─▶ H2 ─┐
           │                                         │  │
           └──▶ Orchestrator review of A ─▶ Runner C: GitHub repo + push
                                                      │
H1 ──────────────────────────────────────────────────▶ Runner D: secrets, deploy, routing rule, E2E ─▶ H3
```

- A and B run **in parallel**.
- C runs after A passes orchestrator review.
- D runs after A, B, H1 and H2 are done. D can overlap with C.
- All runners use `model: sonnet`. The orchestrator (Opus) reviews A's diff before C pushes.

---

### Runner A: scaffold, code, tests (no external side effects)

**Working directory:** `/Users/howlettga/dev/personal/forward-bot`

Prompt:

> Build a Cloudflare Email Worker named `forward-bot` in /Users/howlettga/dev/personal/forward-bot. Use ../rude-bot as the style reference (TS, wrangler.jsonc, ES modules), but share no code with it. Do not deploy, do not run `wrangler secret`, and do not touch git remotes.
>
> First load the `cloudflare-email-service` and `workers-best-practices` skills. Verify these against current docs or `@cloudflare/workers-types`:
> - the `ForwardableEmailMessage` API;
> - whether `message.raw` can still be read after `message.forward()`. If it can't, buffer raw first and forward after.
>
> Files:
> - `package.json`
>   - devDeps: latest `wrangler` 4.x, `@cloudflare/workers-types`, `typescript`, `vitest`
>   - dep: `postal-mime`
>   - scripts: `dev`, `deploy`, `test`, `typecheck`
> - `wrangler.jsonc`
>   - `name: "forward-bot"`, `main: "src/index.ts"`, `compatibility_date: "2026-11-16"`
>   - observability logs enabled, as in rude-bot
>   - **no vars containing addresses or tokens**
> - `src/index.ts`: the `email(message, env, ctx)` handler.
>   1. `await message.forward(env.FORWARD_TO, new Headers({ "X-Forwarded-By": "forward-bot" }))`. Let errors propagate.
>   2. Build the Telegram summary: from (envelope plus header display name), to, subject, date. For bodies up to 1 MiB, use postal-mime to get a text body (strip HTML when there's no text part) and a list of attachment names and sizes.
>   3. POST `https://api.telegram.org/bot${TOKEN}/sendMessage` with `parse_mode: "HTML"` and `disable_web_page_preview: true`.
>   4. Wrap steps 2 and 3 in try/catch and `console.error`. Never throw from them.
> - `src/format.ts`: a pure function that turns parsed email fields into Telegram HTML.
>   - HTML-escape `&`, `<` and `>` in every field.
>   - Truncate the body so the whole message stays under 4096 chars; target 3500 for the body and add `…(truncated)`.
>   - Never log or print the bot token.
> - `src/env.d.ts` or `wrangler types` output for `Env { TELEGRAM_BOT_TOKEN; TELEGRAM_CHAT_ID; FORWARD_TO }`.
> - `test/format.test.ts`: vitest tests for escaping, truncation, the no-subject and no-text cases, and the attachment list.
> - `.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars*` but with `!.dev.vars.example`, `.env*`, `worker-configuration.d.ts` only if generated.
> - `.dev.vars.example`: the three keys with placeholder values.
> - `README.md`, aimed at a future maintainer:
>   - what the Worker does;
>   - one-time setup (Email Routing, destination verification, BotFather, getting the chat ID with `getUpdates`, `wrangler secret put` for each secret);
>   - local testing with `wrangler dev` plus `curl -X POST 'http://localhost:8787/cdn-cgi/local/email?from=a@example.com&to=contact@howlettga.net' --data-binary @test/fixtures/sample.eml`. Verify the exact local email-testing endpoint in the docs;
>   - deploy.
>
>   Use placeholders, never the real personal address.
> - `test/fixtures/sample.eml`: a small multipart message (text plus html plus a tiny attachment) using example.com addresses.
>
> Run `npm install`, `npm run typecheck` and `npm test`. All must pass. Then `git init -b main` and make one commit (no remote).
>
> Before committing, run `git ls-files` and `git grep -nE '[0-9]{8,}:[A-Za-z0-9_-]{30,}|@gmail\.com|TELEGRAM_BOT_TOKEN=[^<y]'`. Confirm no secrets or personal addresses are tracked.
>
> Report: the file list, test output, and anything in the docs that contradicted these instructions.

### Runner B: Cloudflare Email Routing (needs H0)

Prompt:

> Configure Cloudflare Email Routing for the zone **howlettga.net only**. Never modify borrow.community or emergentcollective.software: they use Google Workspace mail. Load the `wrangler` and `cloudflare-email-service` skills first. Check each subcommand's flags with `--help` before using it (`npx wrangler email routing ...`, an open-beta command).
>
> 1. `npx wrangler email routing enable howlettga.net`. Then `npx wrangler email routing dns get howlettga.net` and confirm the MX and SPF records exist. The wrangler OAuth token has no DNS write scope. If enable fails for that reason, stop and report the exact error plus the dashboard path (Compute & AI › Email Service › Email Routing › howlettga.net › Enable). Do not create an API token yourself.
> 2. Create the destination address: `npx wrangler email routing addresses create <PERSONAL_EMAIL>`. The orchestrator supplies `<PERSONAL_EMAIL>` in the prompt. Do not write it to any file in the repo.
> 3. Confirm the catch-all rule is disabled or set to drop. Create **no** routing rule yet: Runner D does that after the Worker exists.
> 4. Check with `dig +short MX howlettga.net` (it may take a few minutes).
>
> Report: the commands run, their outputs (redact the personal address as `<PERSONAL_EMAIL>`), the destination's verification status, and that the owner must click the verification email (H2).

### Runner C: GitHub repo and push (after orchestrator review of A)

Prompt:

> In /Users/howlettga/dev/personal/forward-bot:
>
> 1. Run a secret scan of the full history. Use `git log -p --all | grep -nE '[0-9]{8,}:[A-Za-z0-9_-]{30,}|@gmail\.com'`, and also `npx --yes gitleaks detect --source . -v` (or `brew`'s gitleaks if installed). Abort and report on any hit.
> 2. Confirm `.dev.vars` is ignored: `git check-ignore .dev.vars` must print it.
> 3. `gh repo create howlettga/forward-bot --public --source . --remote origin --description "Cloudflare Email Worker: forwards contact@ mail to inbox + Telegram" --push`.
> 4. Turn on push protection for secret scanning: `gh api -X PATCH repos/howlettga/forward-bot -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`. Report if this isn't allowed.
>
> Report: the repo URL and the scan results.

### Runner D: secrets, deploy, routing rule, E2E (after A, B, H1, H2)

Prompt:

> In /Users/howlettga/dev/personal/forward-bot. Never print secret values to output. When you have to show them, mask them as `abc…xyz`.
>
> 1. Read `TELEGRAM_BOT_TOKEN` from `.dev.vars`. Call `https://api.telegram.org/bot$TOKEN/getUpdates` and take the owner's private chat `id`. Write it to `.dev.vars` as `TELEGRAM_CHAT_ID`. If there are no updates, stop and ask for H1 step 3.
> 2. Ensure `.dev.vars` also has `FORWARD_TO=<PERSONAL_EMAIL>` (supplied by the orchestrator).
> 3. Confirm the destination address shows as verified: `npx wrangler email routing addresses list`.
> 4. `npm run deploy`, then `npx wrangler secret bulk .dev.vars`. Check that `bulk` accepts dotenv format; if it doesn't, use `wrangler secret put` per key, piping from the file. Then `npx wrangler secret list` should show the three names.
> 5. Create the routing rule `contact@howlettga.net` → Worker `forward-bot` with `npx wrangler email routing rules create ...` (check `--help` for the worker-action flags). Confirm with `rules list`. Make sure the catch-all is still drop.
> 6. Smoke test: send a test message to the bot with the deployed token via curl `sendMessage`, to confirm the chat ID works.
> 7. Tail logs with `npx wrangler tail forward-bot --format pretty` in the background, then ask the owner to do H3. Report what the logs show for that delivery.
>
> Report: the deploy URL or version, the secret names (not values), the rule list, and the tail output from the E2E email.

---

## Orchestrator checklist

1. Get H0 approval and the personal destination address from the owner. Keep the address out of every file.
2. Launch A and B in parallel (sonnet).
3. Relay B's result → the owner does H2. Remind them about H1.
4. Review A's diff: failure semantics, escaping, no leaked secrets, `.gitignore`. Fix issues or resume A.
5. Launch C, then D (or both at once once the gates are cleared).
6. Close-out: confirm H3 worked, `git status` is clean, and the repo has no `.dev.vars`.

## Later (out of scope for v1)

- Send small attachments to Telegram with `sendDocument`.
- More aliases or a catch-all with per-alias tagging. This would add rules only; no code changes.
- GitHub Actions deploy using a scoped `CLOUDFLARE_API_TOKEN` repo secret.
- A `/reply` flow from Telegram via Email Sending. This needs a webhook and `send_email` binding.
