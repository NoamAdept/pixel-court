#!/usr/bin/env bash
# One-time setup: connects your Telegram bot to the morning recap and sends a test message.
set -euo pipefail
REPO="NoamAdept/pixel-court"

read -rsp "Paste your bot token from @BotFather (hidden): " TOKEN; echo
NAME=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['result']['username'] if d.get('ok') else '')")
[ -z "$NAME" ] && { echo "That token didn't work. Copy it again from @BotFather."; exit 1; }

echo "Now open Telegram, find @${NAME}, and tap START (or send it any message)."
echo "Waiting for your message..."
CHAT=""
for _ in $(seq 1 60); do
  CHAT=$(curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('result',[])
ids=[u['message']['chat']['id'] for u in d if 'message' in u]
print(ids[-1] if ids else '')")
  [ -n "$CHAT" ] && break
  sleep 3
done
[ -z "$CHAT" ] && { echo "Didn't see a message from you within 3 minutes. Run this again."; exit 1; }

printf '%s' "$TOKEN" | gh secret set TELEGRAM_BOT_TOKEN --repo "$REPO"
printf '%s' "$CHAT" | gh secret set TELEGRAM_CHAT_ID --repo "$REPO"
echo "Saved. Sending a test recap now..."
gh workflow run morning-recap.yml --repo "$REPO"
echo "Done. Your first recap should arrive in Telegram within a minute or two."
