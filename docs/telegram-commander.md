# Telegram Commander

Control the Passport **Command Brain** and inspect the fleet from Telegram. The
bot is a *bridge*, not a second control plane: every command funnels into the
same choke points the executive console uses (`runBrainCycle`, `getFleetStatus`),
so authz, audit and money gates are identical.

## Commands

| Command | Action |
| --- | --- |
| `/status` | Brain health, fleet counts, halt state, last decision |
| `/fleet` | Roster summary by tier + status |
| `/brain` | Run one autonomous brain cycle now |
| `/brain <ACTION>` | Force an action (e.g. `/brain RUN_LOCUM_SEARCH`) |
| `/actions` | List forceable actions |
| `/help` | Help text |

Money-tier actions (`REQUEST_MONEY_INTENT`) are **refused from chat** — they still
require the console plus an Ed25519 signature.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Set env on the Passport droplet (`/opt/passport/.env.production`):

   ```
   TELEGRAM_BOT_TOKEN="123456:ABC..."
   TELEGRAM_WEBHOOK_SECRET="<random 32+ chars>"
   TELEGRAM_COMMANDER_CHAT_IDS="<your chat id>"
   ```

   Get your chat id by messaging the bot `/start`, then visiting
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and reading
   `message.chat.id`. Until your id is in `TELEGRAM_COMMANDER_CHAT_IDS`, the bot
   replies "Not authorized" (fail closed).

3. Register the webhook (one shot):

   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<passport-host>/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

4. Verify: `GET https://<passport-host>/api/telegram/webhook` returns
   `{ "ok": true, "configured": true, "allowlistedChats": 1 }`.

## Security

- Every update must carry `X-Telegram-Bot-Api-Secret-Token` matching
  `TELEGRAM_WEBHOOK_SECRET` (Telegram's documented integrity control). Mismatch → 401.
- Only chat ids in `TELEGRAM_COMMANDER_CHAT_IDS` may issue commands.
- Each forced cycle writes an `AdminAuditLog` row (`brain_cycle_telegram_trigger`)
  with the sender's handle.
- The route always returns 200 for well-formed updates to avoid Telegram retry storms.
