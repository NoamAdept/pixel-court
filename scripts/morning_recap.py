#!/usr/bin/env python3
"""Morning NBA recap sent to Telegram (or WhatsApp via CallMeBot, if configured).

Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, and/or WHATSAPP_PHONE + CALLMEBOT_APIKEY.
Without any (or with --dry-run) it just prints the message.
"""
import html, json, os, re, subprocess, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
LOCAL = ZoneInfo(os.environ.get("LOCAL_TZ", "Asia/Jerusalem"))
API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
APP = "https://noamadept.github.io/pixel-court/"


def get(url, data=None):
    try:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        return e.read()
    except urllib.error.URLError:
        # python.org builds on macOS ship without CA certs; curl uses the system store.
        cmd = ["curl", "-s", "--max-time", "20", url] + (["-H", "Content-Type: application/json", "-d", data.decode()] if data else [])
        return subprocess.run(cmd, capture_output=True, check=True).stdout


def events(day):
    return json.loads(get(API.format(day.strftime("%Y%m%d")))).get("events", [])


def team(c):
    t = c["team"]
    rec = next((r["summary"] for r in c.get("records", []) if r.get("type") == "total"), "")
    return {"abbr": t["abbreviation"], "score": int(c.get("score") or 0), "winner": c.get("winner", False),
            "record": rec, "leaders": c.get("leaders", []), "ot": len(c.get("linescores", [])) > 4}


def leader(t, name):
    for l in t["leaders"]:
        if l["name"] == name and l["leaders"]:
            x = l["leaders"][0]
            return x["athlete"]["displayName"], x["displayValue"], float(x.get("value") or 0)
    return None


def game(e):
    c = e["competitions"][0]
    home = team(next(x for x in c["competitors"] if x["homeAway"] == "home"))
    away = team(next(x for x in c["competitors"] if x["homeAway"] == "away"))
    hl = next((h for h in c.get("headlines", []) if h.get("type") == "Recap"), None)
    return {"home": home, "away": away, "start": datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(LOCAL),
            "headline": (hl or {}).get("shortLinkText", ""), "state": e["status"]["type"]["state"],
            "tv": sorted({n for b in c.get("broadcasts", []) for n in b.get("names", [])})}


def build():
    today = datetime.now(ET).date()
    finals, slate = [], []
    for back in range(0, 4):
        finals = [game(e) for e in events(today - timedelta(days=back)) if e["status"]["type"]["state"] == "post"]
        if finals:
            break
    for fwd in range(0, 5):
        slate = [game(e) for e in events(today + timedelta(days=fwd)) if e["status"]["type"]["state"] == "pre"]
        if slate:
            break

    out = ["🏀 *PIXEL COURT · MORNING RECAP*", ""]
    if finals:
        margin = lambda g: abs(g["home"]["score"] - g["away"]["score"]) - (6 if g["home"]["ot"] else 0)
        finals.sort(key=margin)
        star = max(((leader(t, "points"), t["abbr"]) for g in finals for t in (g["away"], g["home"]) if leader(t, "points")),
                   key=lambda s: s[0][2], default=None)
        if star:
            out.append(f"⭐ *MVP:* {star[0][0]} ({star[1]}) {star[0][1]} PTS")
        g = finals[0]
        out.append(f"⚡ *Clutch:* {g['away']['abbr']} {g['away']['score']}-{g['home']['score']} {g['home']['abbr']}" + (" (OT)" if g["home"]["ot"] else ""))
        out += ["", "*LAST NIGHT*", "```"]
        for g in finals:
            a, h = g["away"], g["home"]
            mark = lambda t: "◀" if t["winner"] else " "
            out.append(f"{a['abbr']:<4}{a['score']:>4}{mark(a)} {h['abbr']:<4}{h['score']:>4}{mark(h)}{' OT' if h['ot'] else ''}")
        out.append("```")
        for g in finals[:3]:
            if g["headline"]:
                out.append(f"• {g['headline']}")
    else:
        out.append("No games last night.")

    if slate:
        out += ["", f"*TONIGHT* ({slate[0]['start'].strftime('%a %d %b')}, Israel time)", "```"]
        for g in sorted(slate, key=lambda g: g["start"]):
            out.append(f"{g['start'].strftime('%H:%M')}  {g['away']['abbr']} @ {g['home']['abbr']}")
        out.append("```")
        hype = lambda g: sum(int(r.split('-')[0]) / max(1, sum(map(int, r.split('-')))) for r in (g["home"]["record"], g["away"]["record"]) if '-' in r)
        must = max(slate, key=hype)
        out.append(f"📺 *Must watch:* {must['away']['abbr']} @ {must['home']['abbr']} {must['start'].strftime('%H:%M')}" + (f" on {', '.join(must['tv'][:2])}" if must["tv"] else ""))
        watch = sorted(((leader(t, "pointsPerGame"), t["abbr"], g["start"]) for g in slate for t in (g["away"], g["home"]) if leader(t, "pointsPerGame")),
                       key=lambda w: -w[0][2])[:4]
        if watch:
            out += ["", "*PLAYERS TO WATCH*"]
            out += [f"• {w[0][0]} ({w[1]}) {float(w[0][1]):.1f} PPG · {w[2].strftime('%H:%M')}" for w in watch]
    out += ["", f"👾 Box scores & shot charts: {APP}"]
    return "\n".join(out)


def to_html(text):
    """WhatsApp-style markup (*bold*, ```pre```) -> Telegram HTML."""
    parts = text.split("```")
    out = []
    for i, part in enumerate(parts):
        part = html.escape(part, quote=False)
        out.append(f"<pre>{part.strip(chr(10))}</pre>" if i % 2 else re.sub(r"\*([^*\n]+)\*", r"<b>\1</b>", part))
    return "".join(out)


def send_telegram(text):
    token, chat = os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"]
    body = json.dumps({
        "chat_id": chat, "text": to_html(text.replace(f"\n👾 Box scores & shot charts: {APP}", "")), "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "reply_markup": {"inline_keyboard": [[{"text": "👾 OPEN PIXEL COURT", "url": APP}]]},
    }).encode()
    res = json.loads(get(f"https://api.telegram.org/bot{token}/sendMessage", body) or b"{}")
    if not res.get("ok"):
        sys.exit(f"Telegram rejected the message: {res.get('description')}")
    print("Sent to Telegram")


def send_whatsapp(text):
    phone, key = os.environ.get("WHATSAPP_PHONE"), os.environ.get("CALLMEBOT_APIKEY")
    q = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": key})
    body = get("https://api.callmebot.com/whatsapp.php?" + q).decode("utf-8", "replace")
    print(body[:300])
    if "error" in body.lower() and "queued" not in body.lower():
        sys.exit("CallMeBot rejected the message")


if __name__ == "__main__":
    msg = build()
    print(msg)
    if "--dry-run" in sys.argv:
        sys.exit()
    if os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"):
        send_telegram(msg)
    if os.environ.get("CALLMEBOT_APIKEY") and os.environ.get("WHATSAPP_PHONE"):
        send_whatsapp(msg)
