#!/usr/bin/env python3
"""Morning NBA recap, sent as a web push notification to every phone that turned on
"Morning push" in the Pixel Court app. No third-party messaging service involved.

Env: VAPID_PRIVATE_KEY (base64url raw P-256 key), PUSH_SUBSCRIPTIONS (one or more push codes
from the app, separated by commas/newlines). With --dry-run, or without them, it only prints.
"""
import base64, json, os, re, subprocess, sys, urllib.error, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
LOCAL = ZoneInfo(os.environ.get("LOCAL_TZ", "Asia/Jerusalem"))
API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
APP = "https://noamadept.github.io/pixel-court/"


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read()
    except urllib.error.URLError:
        # python.org builds on macOS ship without CA certs; curl uses the system store.
        return subprocess.run(["curl", "-sf", "--max-time", "20", url], capture_output=True, check=True).stdout


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
    return {"home": team(next(x for x in c["competitors"] if x["homeAway"] == "home")),
            "away": team(next(x for x in c["competitors"] if x["homeAway"] == "away")),
            "start": datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(LOCAL)}


def last_name(n):
    return n.split(" ", 1)[-1] if " " in n else n


def build():
    today = datetime.now(ET).date()
    finals, slate, recap_day = [], [], None
    for back in range(0, 4):
        d = today - timedelta(days=back)
        finals = [game(e) for e in events(d) if e["status"]["type"]["state"] == "post"]
        if finals:
            recap_day = d
            break
    for fwd in range(0, 5):
        slate = [game(e) for e in events(today + timedelta(days=fwd)) if e["status"]["type"]["state"] == "pre"]
        if slate:
            break

    title, lines = "🏀 Pixel Court", []
    if finals:
        star = max(((leader(t, "points"), t["abbr"]) for g in finals for t in (g["away"], g["home"]) if leader(t, "points")),
                   key=lambda s: s[0][2], default=None)
        if star:
            title = f"🏀 MVP: {star[0][0]} {star[0][1]} PTS ({star[1]})"
        g = min(finals, key=lambda g: abs(g["home"]["score"] - g["away"]["score"]) - (6 if g["home"]["ot"] else 0))
        lines.append(f"⚡ Clutch: {g['away']['abbr']} {g['away']['score']}-{g['home']['score']} {g['home']['abbr']}" + (" OT" if g["home"]["ot"] else ""))
    else:
        lines.append("No games last night.")
    if slate:
        first = min(slate, key=lambda g: g["start"])
        watch = max(((leader(t, "pointsPerGame"), t["abbr"], g) for g in slate for t in (g["away"], g["home"]) if leader(t, "pointsPerGame")),
                    key=lambda w: w[0][2], default=None)
        tonight = f"🌙 Tonight: {len(slate)} game{'s' if len(slate) > 1 else ''} from {first['start'].strftime('%H:%M')}"
        if watch:
            g = watch[2]
            tonight += f" · watch {last_name(watch[0][0])} ({watch[0][1]} PPG) {g['away']['abbr']}@{g['home']['abbr']} {g['start'].strftime('%H:%M')}"
        lines.append(tonight)
    if finals:
        lines.append("Finals: " + "  ".join(f"{g['away']['abbr']} {g['away']['score']}-{g['home']['score']} {g['home']['abbr']}" for g in finals))
    url = APP + (f"#d/{recap_day.strftime('%Y%m%d')}" if recap_day else "")
    return {"title": title, "body": "\n".join(lines), "url": url}


def subscriptions():
    raw = os.environ.get("PUSH_SUBSCRIPTIONS", "")
    subs = []
    for code in re.split(r"[\s,]+", raw.strip()):
        if code:
            subs.append(json.loads(base64.b64decode(code + "=" * (-len(code) % 4))))
    return subs


def send(payload):
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid
    key, subs = os.environ["VAPID_PRIVATE_KEY"], subscriptions()
    Vapid.from_string(key)  # fail loudly on a bad key before touching any device
    if not subs:
        sys.exit("No PUSH_SUBSCRIPTIONS saved yet: turn on Morning push in the app first.")
    ok = 0
    for s in subs:
        try:
            webpush(subscription_info=s, data=json.dumps(payload), vapid_private_key=key,
                    vapid_claims={"sub": "https://github.com/NoamAdept/pixel-court"}, ttl=6 * 3600)
            ok += 1
        except WebPushException as e:
            print("Push failed:", getattr(e.response, "status_code", ""), str(e)[:200])
    print(f"Sent to {ok}/{len(subs)} device(s)")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    p = build()
    print(p["title"], p["body"], p["url"], sep="\n")
    if "--dry-run" not in sys.argv and os.environ.get("VAPID_PRIVATE_KEY"):
        send(p)
