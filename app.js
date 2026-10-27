"use strict";
/* Pixel Court — live 8-bit NBA scoreboard. Data: ESPN's public site API (CORS-open). */

const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
const LIVE_POLL = 20000, DETAIL_POLL = 15000, IDLE_POLL = 300000;

/* ---------- tiny helpers ---------- */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k.startsWith("--")) e.style.setProperty(k, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("pc:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pc:" + k, JSON.stringify(v)); } catch {} },
};
const hex = c => "#" + (c || "888888").replace("#", "");
// Black jerseys vanish on the dark arena, so fall back to the alternate color.
const teamColor = t => { const c = hex(t.color); return /^#(0{6}|1[0-9a-f]{5}|2[0-4][0-9a-f]{4})$/i.test(c) ? hex(t.alt) : c; };

/* ---------- dates: NBA game days are US Eastern dates ---------- */
const etParts = d => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map(p => [p.type, p.value]));
const etToday = () => { const p = etParts(new Date()); return p.year + p.month + p.day; };
const etHour = () => +etParts(new Date()).hour;
function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
const ymdDate = ymd => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12));
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = iso => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop().replace(/_/g, " ") + " time"; } catch { return "your time"; } };

/* ---------- fetch with a short memory cache + offline fallback via SW ---------- */
const cache = new Map();
async function getJSON(url, maxAge = 10000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < maxAge) return hit.v;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const v = await r.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}

/* ---------- 8-bit graphics ---------- */
const imgCache = new Map();
function loadImg(src) {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
  return imgCache.get(src);
}
// Draw any image down-sampled into a tiny canvas, then let CSS scale it up with hard pixels.
function pixelImg(src, w, h, cls) {
  const c = el("canvas", { width: w, height: h, class: cls, "aria-hidden": "true" });
  if (src) loadImg(src).then(i => { const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.drawImage(i, 0, 0, w, h); }).catch(() => {});
  return c;
}
const SPRITE = [
  "000077700000", "000711170000", "000111110000", "000011100006", "003222223066", "012222222166",
  "010222220100", "010232320100", "010222220000", "000444440000", "000440440000", "000110110000",
  "000110110000", "000110110000", "005500550000", "055505550000"];
function sprite(color, alt) {
  const c = el("canvas", { width: 12, height: 16, "aria-hidden": "true" }), x = c.getContext("2d");
  const pal = { 1: "#c98a5b", 2: color, 3: alt, 4: color, 5: "#f4f4f4", 6: "#ff6b2c", 7: "#1b1020" };
  SPRITE.forEach((r, y) => [...r].forEach((ch, i) => { if (ch !== "0") { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } }));
  return c;
}
function bounceBall() {
  const c = document.getElementById("ball"), x = c.getContext("2d");
  const B = ["0066660", "0666666", "6696966", "6666666", "6696966", "0666666", "0066660"];
  let t = 0;
  const frame = () => {
    x.clearRect(0, 0, 10, 14);
    const y = Math.round(6 - Math.abs(Math.sin(t)) * 6);
    B.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== "0") { x.fillStyle = ch === "9" ? "#7a2a00" : "#ff6b2c"; x.fillRect(i + 1, y + j, 1, 1); } }));
    x.fillStyle = "#3a3470"; x.fillRect(0, 13, 10, 1);
    t += 0.12;
  };
  frame();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setInterval(() => { if (!document.hidden) frame(); }, 60);
}

/* ---------- 8-bit sound ---------- */
let actx;
function beep(notes) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const [f, d] of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = f; g.gain.value = 0.05;
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d); t += d;
    }
  } catch {}
}
const SFX = { click: [[880, .04]], coin: [[988, .06], [1319, .12]], buzzer: [[196, .35]] };

/* ---------- state ---------- */
const settings = { fav: store.get("fav", ""), spoil: store.get("spoil", false), notify: store.get("notify", false), sound: store.get("sound", false) };
const revealed = new Set();
const state = { day: null, games: [], detailTab: {}, box: {}, plays: {}, shots: {}, conf: store.get("conf", 0) };
let pollTimer = null, renderToken = 0;
const alerted = store.get("alerted", {});
const lastScores = {};

/* ---------- parsing ---------- */
function parseTeam(c) {
  const t = c.team || {};
  return {
    id: t.id, abbr: t.abbreviation, name: t.shortDisplayName || t.name || t.displayName, full: t.displayName,
    color: hex(t.color), alt: hex(t.alternateColor),
    logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "",
    score: c.score != null && c.score !== "" ? +(c.score.value ?? c.score) : null,
    record: ((c.records || c.record || []).find(r => r.type === "total") || {}).summary || "",
    winner: !!c.winner,
    lines: (c.linescores || []).map(l => +(l.value ?? l.displayValue)),
    leaders: c.leaders || [],
  };
}
function leaderOf(team, names) {
  for (const l of team.leaders) if (names.includes(l.name) && l.leaders && l.leaders[0]) {
    const x = l.leaders[0];
    return { val: x.displayValue, num: +x.value || parseFloat(x.displayValue) || 0, name: x.athlete?.displayName || "", short: x.athlete?.shortName || "", head: x.athlete?.headshot || "", id: x.athlete?.id };
  }
  return null;
}
function parseEvent(e) {
  const c = e.competitions[0], st = e.status || c.status;
  const home = parseTeam(c.competitors.find(x => x.homeAway === "home"));
  const away = parseTeam(c.competitors.find(x => x.homeAway === "away"));
  const hl = (c.headlines || []).find(h => h.type === "Recap") || (c.headlines || [])[0];
  return {
    id: e.id, date: e.date, home, away, state: st.type.state, detail: st.type.shortDetail, clock: st.displayClock, period: st.period,
    tv: [...new Set((c.broadcasts || []).flatMap(b => b.names || []))],
    headline: hl?.shortLinkText || "", venue: c.venue?.fullName || "",
  };
}
const isFav = g => settings.fav && (g.home.id === settings.fav || g.away.id === settings.fav);
const hidden = g => settings.spoil && g.state !== "pre" && !revealed.has(g.id);
const winPct = r => { const m = /^(\d+)-(\d+)/.exec(r || ""); return m ? (+m[1] + +m[2] ? +m[1] / (+m[1] + +m[2]) : .5) : .5; };
const clockSecs = c => { const m = /^(\d+):(\d+)/.exec(c || ""); return m ? +m[1] * 60 + +m[2] : parseFloat(c) || 0; };

/* ---------- routing ---------- */
function route() {
  const h = location.hash.slice(1);
  document.getElementById("nav-games").toggleAttribute("aria-current", !h.startsWith("standings"));
  document.getElementById("nav-games").setAttribute("aria-current", h.startsWith("standings") ? "false" : "page");
  document.getElementById("nav-standings").setAttribute("aria-current", h.startsWith("standings") ? "page" : "false");
  clearTimeout(pollTimer);
  const tok = ++renderToken;
  if (h.startsWith("g/")) return showGame(h.slice(2), tok, true);
  if (h.startsWith("standings")) return showStandings(tok);
  if (h.startsWith("d/")) state.day = h.slice(2);
  return showGames(tok, true);
}
function defaultDay() {
  const today = etToday();
  // Before the US afternoon, people abroad want last night's results; after that, tonight's slate.
  return etHour() < 15 ? addDays(today, -1) : today;
}
function schedule(fn, ms) { clearTimeout(pollTimer); pollTimer = setTimeout(() => { if (document.hidden) schedule(fn, 3000); else fn(); }, ms); }
function setUpdated() { document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
const view = () => document.getElementById("view");
function swap(node, keepScroll) {
  const y = window.scrollY;
  view().replaceChildren(node);
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
}

/* ---------- GAMES view ---------- */
async function showGames(tok, fresh) {
  if (!state.day) state.day = defaultDay();
  if (fresh) swap(el("div", { class: "stack" }, dayStrip(), el("div", { class: "box loading" }, "LOADING ARENA")));
  let data;
  try { data = await getJSON(`${API}/scoreboard?dates=${state.day}`, fresh ? 15000 : 0); }
  catch (err) { if (tok === renderToken) swap(el("div", { class: "stack" }, dayStrip(), errorBox(() => showGames(tok, true)))); return; }
  if (tok !== renderToken) return;
  const games = (data.events || []).map(parseEvent);
  checkAlerts(games);
  state.games = games;
  const live = games.some(g => g.state === "in");
  document.getElementById("live-pill").hidden = !live;
  swap(renderGames(games), !fresh);
  setUpdated();
  schedule(() => showGames(tok, false), live ? LIVE_POLL : IDLE_POLL);
}
function dayStrip() {
  const today = etToday(), wrap = el("div", { class: "days", role: "group", "aria-label": "Game day" });
  for (let i = -4; i <= 4; i++) {
    const d = addDays(today, i), dt = ymdDate(d);
    const label = i === -1 ? "LAST NIGHT" : i === 0 ? "TONIGHT" : "";
    const b = el("button", { class: "day", "aria-pressed": d === state.day ? "true" : "false", onclick: () => { beep(SFX.click); location.hash = "d/" + d; } },
      el("span", { class: "dw" }, dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()),
      el("span", { class: "dn" }, dt.getUTCDate()),
      el("span", { class: "dl" }, label));
    wrap.append(b);
  }
  requestAnimationFrame(() => wrap.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" }));
  return wrap;
}
function renderGames(games) {
  const root = el("div", { class: "stack" }, dayStrip());
  if (!games.length) { root.append(el("div", { class: "box empty" }, "No games this day. Swipe to another day.")); return root; }
  const finals = games.filter(g => g.state === "post"), pre = games.filter(g => g.state === "pre"), live = games.filter(g => g.state === "in");
  const order = (a, b) => isFav(b) - isFav(a);

  if (finals.length && !settings.spoil) root.append(heroes(finals));
  if (live.length) { root.append(el("h2", { class: "sec-h" }, "LIVE NOW", el("small", null, live.length + " game" + (live.length > 1 ? "s" : "")))); live.sort(order).forEach(g => root.append(gameCard(g))); }
  if (pre.length) {
    const must = pre.slice().sort((a, b) => hype(b) - hype(a))[0];
    root.append(playersToWatch(pre));
    root.append(el("h2", { class: "sec-h" }, "UP NEXT", el("small", null, tzName())));
    pre.sort((a, b) => order(a, b) || a.date.localeCompare(b.date)).forEach(g => root.append(gameCard(g, g === must && pre.length > 1)));
  }
  if (finals.length) {
    const close = finals.slice().sort((a, b) => margin(a) - margin(b))[0];
    root.append(el("h2", { class: "sec-h" }, "FINALS", el("small", null, finals.length + " game" + (finals.length > 1 ? "s" : ""))));
    finals.sort((a, b) => order(a, b) || margin(a) - margin(b)).forEach(g => root.append(gameCard(g, g === close && !settings.spoil)));
  }
  // Swipe between days
  let sx = 0, sy = 0;
  root.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  root.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && !e.target.closest(".days")) location.hash = "d/" + addDays(state.day, dx < 0 ? 1 : -1);
  });
  return root;
}
const margin = g => Math.abs((g.home.score || 0) - (g.away.score || 0)) - (g.home.lines.length > 4 ? 6 : 0);
const hype = g => (winPct(g.home.record) + winPct(g.away.record)) * 50 + (isFav(g) ? 100 : 0) +
  Math.max(leaderOf(g.home, ["pointsPerGame"])?.num || 0, leaderOf(g.away, ["pointsPerGame"])?.num || 0);

function heroes(finals) {
  let star = null;
  for (const g of finals) for (const t of [g.away, g.home]) {
    const p = leaderOf(t, ["points"]);
    if (p && (!star || p.num > star.p.num)) star = { p, t, g };
  }
  const close = finals.slice().sort((a, b) => margin(a) - margin(b))[0];
  const w = close.home.winner ? close.home : close.away;
  const card = (tag, t, big, sub, id) => el("div", { class: "box", role: "button", tabindex: "0", onclick: () => location.hash = "g/" + id, onkeydown: e => e.key === "Enter" && (location.hash = "g/" + id) },
    sprite(teamColor(t), t.alt), el("div", { class: "who" }, el("div", { class: "tag" }, tag), el("div", { class: "big" }, big), el("div", { class: "sub" }, sub)));
  return el("section", { class: "hero" },
    star && card("MVP OF THE NIGHT", star.t, star.p.val + " PTS", star.p.name + " · " + star.t.abbr, star.g.id),
    card("CLUTCH FINISH", w, `${close.away.score}-${close.home.score}`, `${close.away.abbr} @ ${close.home.abbr}` + (close.home.lines.length > 4 ? " · OT" : ""), close.id));
}
function playersToWatch(pre) {
  const ps = [];
  for (const g of pre) for (const t of [g.away, g.home]) { const p = leaderOf(t, ["pointsPerGame"]); if (p) ps.push({ ...p, t, g }); }
  ps.sort((a, b) => b.num - a.num);
  const top = ps.slice(0, 6), max = Math.max(1, ...top.map(p => p.num));
  if (!top.length) return null;
  return el("div", { class: "stack" },
    el("h2", { class: "sec-h" }, "PLAYERS TO WATCH", el("small", null, "season PPG")),
    el("div", { class: "box watch" }, top.map(p => el("div", { class: "pw", role: "button", tabindex: "0", style: { cursor: "pointer" }, onclick: () => location.hash = "g/" + p.g.id },
      pixelImg(p.head, 24, 18), el("div", { class: "nm" }, p.name + " ", el("small", null, `${p.t.abbr} · ${fmtTime(p.g.date)}`)),
      el("div", { class: "v" }, (+p.val).toFixed(1)),
      el("div", { class: "hp" }, el("div", { style: { width: Math.round(p.num / max * 100) + "%" } }))))));
}
function teamRow(t, g, showScore) {
  const res = g.state === "post" ? (t.winner ? "win" : "lose") : "";
  return el("div", { class: "trow " + res },
    pixelImg(t.logo, 16, 16, "logo-img"),
    el("div", { class: "tn" }, el("span", { class: t.id === settings.fav ? "fav" : "" }, t.name), el("small", null, t.record)),
    g.state === "pre" ? el("div") : el("div", { class: "sc" + (showScore ? "" : " blur") }, showScore ? t.score : "88"));
}
function gameCard(g, hot) {
  const show = !hidden(g);
  const st = g.state === "in" ? el("span", { class: "lv" }, "LIVE " + g.detail.toUpperCase()) : el("span", null, g.state === "pre" ? fmtDay(g.date).toUpperCase() : g.detail.toUpperCase());
  const prev = lastScores[g.id], now = `${g.away.score}-${g.home.score}`;
  const changed = prev && prev !== now && g.state === "in";
  lastScores[g.id] = now;
  const card = el("button", { class: "box card" + (g.state === "in" ? " live" : hot ? " hot" : "") + (changed ? " flash" : ""), onclick: () => { beep(SFX.click); location.hash = "g/" + g.id; } },
    el("div", { class: "status" }, st, hot && el("b", null, g.state === "pre" ? "> MUST WATCH" : "> GAME OF THE NIGHT")),
    g.state === "pre" && el("div", { class: "time" }, fmtTime(g.date)),
    teamRow(g.away, g, show), teamRow(g.home, g, show),
    g.state === "pre" ? el("div", { class: "mini" }, el("span", null, g.tv.join(" · ") || "League Pass"), el("span", null, g.venue))
      : !show ? el("div", { class: "shield" }, "SPOILER SHIELD · TAP TO OPEN")
      : g.headline ? el("div", { class: "mini" }, el("b", null, g.headline)) : null);
  if (changed) beep(SFX.coin);
  return card;
}
function errorBox(retry) {
  return el("div", { class: "box err" }, "Can't reach the scoreboard. Check your connection.", el("div", { style: { marginTop: "12px" } }, el("button", { class: "btn", onclick: retry }, "RETRY")));
}

/* ---------- alerts (while the app is open) ---------- */
async function notify(title, body) {
  beep(SFX.buzzer);
  toast(title + " · " + body);
  if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try { const reg = await navigator.serviceWorker?.ready; if (reg) reg.showNotification(title, { body, icon: "icon-192.png", tag: title + body }); else new Notification(title, { body }); } catch {}
}
function checkAlerts(games) {
  const prev = Object.fromEntries(state.games.map(g => [g.id, g]));
  for (const g of games) {
    const p = prev[g.id]; if (!p) continue;
    const line = `${g.away.abbr} ${g.away.score} - ${g.home.score} ${g.home.abbr}`;
    if (p.state === "in" && g.state === "post" && !alerted["f" + g.id]) { alerted["f" + g.id] = 1; notify("FINAL", settings.spoil ? `${g.away.abbr} @ ${g.home.abbr} is over` : line); }
    if (g.state === "in" && g.period >= 4 && clockSecs(g.clock) <= 180 && Math.abs(g.home.score - g.away.score) <= 5 && !alerted["c" + g.id]) {
      alerted["c" + g.id] = 1; notify("CLOSE GAME", `${line} · ${g.detail}`);
    }
  }
  store.set("alerted", Object.fromEntries(Object.entries(alerted).slice(-60)));
}
let toastT;
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4500); }

/* ---------- GAME detail ---------- */
async function showGame(id, tok, fresh) {
  if (fresh) swap(el("div", { class: "stack" }, backBtn(), el("div", { class: "box loading" }, "LOADING GAME")));
  let d;
  try { d = await getJSON(`${API}/summary?event=${id}`, fresh ? 10000 : 0); }
  catch { if (tok === renderToken) swap(el("div", { class: "stack" }, backBtn(), errorBox(() => showGame(id, tok, true)))); return; }
  if (tok !== renderToken) return;
  const g = parseSummary(d, id);
  document.getElementById("live-pill").hidden = g.state !== "in";
  swap(renderGame(g, d), !fresh);
  setUpdated();
  if (g.state === "in") schedule(() => showGame(id, tok, false), DETAIL_POLL);
  else if (g.state === "pre") schedule(() => showGame(id, tok, false), IDLE_POLL);
}
function backBtn() { return el("button", { class: "btn back", onclick: () => history.length > 1 ? history.back() : (location.hash = "") }, "< BACK"); }
function parseSummary(d, id) {
  const c = d.header.competitions[0], st = c.status || {};
  const fromBoard = state.games.find(x => x.id === id);
  return {
    id, date: c.date, state: st.type?.state || fromBoard?.state, detail: st.type?.shortDetail || fromBoard?.detail || "",
    clock: st.displayClock ?? fromBoard?.clock, period: st.period ?? fromBoard?.period,
    home: parseTeam(c.competitors.find(x => x.homeAway === "home")), away: parseTeam(c.competitors.find(x => x.homeAway === "away")),
  };
}
function renderGame(g, d) {
  const show = !hidden(g);
  const tabs = g.state === "pre" ? ["PREVIEW"] : [g.state === "in" ? "LIVE" : "RECAP", "BOX", "PLAYS", "SHOTS"];
  let tab = state.detailTab[g.id] || tabs[0];
  if (!tabs.includes(tab)) tab = tabs[0];
  const body = el("div", { class: "stack" });
  const bar = el("div", { class: "subtabs", role: "tablist" }, tabs.map(t => el("button", { class: "chip", role: "tab", "aria-pressed": t === tab ? "true" : "false", onclick: () => { beep(SFX.click); state.detailTab[g.id] = t; swap(renderGame(g, d), true); } }, t)));
  const side = (t) => el("div", { class: "side " + (g.state === "post" && !t.winner ? "lose" : "") },
    pixelImg(t.logo, 20, 20), el("div", { class: "ab" + (t.id === settings.fav ? " fav" : "") }, t.abbr), el("div", { class: "rec" }, t.record),
    g.state !== "pre" && el("div", { class: "bigsc" + (show ? "" : " blur") }, show ? t.score : "88"));
  const mid = el("div", { class: "mid" },
    g.state === "in" ? el("div", { class: "lv" }, "LIVE") : null,
    el("div", null, g.state === "pre" ? fmtTime(g.date) : g.detail.toUpperCase()),
    g.state === "pre" ? el("div", null, fmtDay(g.date).toUpperCase()) : null);
  const head = el("div", { class: "box gh" }, side(g.away), mid, side(g.home));

  if (!show) {
    body.append(el("div", { class: "box empty" }, "Spoiler shield is on.", el("div", { style: { marginTop: "14px" } },
      el("button", { class: "btn primary", onclick: () => { revealed.add(g.id); beep(SFX.coin); swap(renderGame(g, d), true); } }, "REVEAL SCORE"))));
    return el("div", { class: "stack" }, backBtn(), head, body);
  }
  if (tab === "PREVIEW") body.append(...preview(g, d));
  else if (tab === "BOX") body.append(boxScore(g, d));
  else if (tab === "PLAYS") body.append(playByPlay(g, d));
  else if (tab === "SHOTS") body.append(shotChart(g, d));
  else body.append(...recap(g, d));
  const espn = el("a", { class: "chip", href: `https://www.espn.com/nba/game/_/gameId/${g.id}`, target: "_blank", rel: "noopener", style: { justifySelf: "start" } }, "ESPN GAMECAST >");
  return el("div", { class: "stack" }, backBtn(), head, bar, body, espn);
}
function linescore(g) {
  const n = Math.max(g.away.lines.length, g.home.lines.length, 4);
  const hdr = Array.from({ length: n }, (_, i) => i < 4 ? "Q" + (i + 1) : "OT" + (n > 5 ? i - 3 : ""));
  return el("div", { class: "box scroll-x" }, el("table", { class: "linescore" },
    el("thead", null, el("tr", null, el("th", null, ""), hdr.map(h => el("th", null, h)), el("th", null, "T"))),
    el("tbody", null, [g.away, g.home].map(t => el("tr", null, el("td", null, t.abbr), hdr.map((_, i) => el("td", null, t.lines[i] ?? "–")), el("td", null, t.score))))));
}
function recap(g, d) {
  const out = [];
  if (d.article?.headline && g.state === "post") out.push(el("div", { class: "box recap" }, el("h3", null, d.article.headline), el("p", null, (d.article.description || "").replace(/^[—\-\s]+/, ""))));
  out.push(linescore(g));
  if ((d.winprobability || []).length > 2) out.push(winProb(g, d));
  const cmp = teamCompare(g, d); if (cmp) out.push(el("h2", { class: "sec-h" }, "TEAM STATS"), cmp);
  const perf = performers(g, d); if (perf) out.push(el("h2", { class: "sec-h" }, "TOP PERFORMERS"), perf);
  const info = [d.gameInfo?.venue?.fullName, d.gameInfo?.attendance ? (+d.gameInfo.attendance).toLocaleString() + " fans" : null, d.seasonseries?.[0]?.summary].filter(Boolean);
  if (info.length) out.push(el("div", { class: "mini", style: { padding: "0 4px" } }, info.map(s => el("span", null, s))));
  return out;
}
function winProb(g, d) {
  const wp = d.winprobability.map(w => w.homeWinPercentage);
  const W = 160, H = 48, c = el("canvas", { id: "wp", width: W, height: H, "aria-label": "Win probability chart" }), x = c.getContext("2d");
  const hc = teamColor(g.home), ac = teamColor(g.away);
  x.fillStyle = "#0d0b1f"; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i++) {
    const p = wp[Math.min(wp.length - 1, Math.floor(i / W * wp.length))];
    const y = Math.round((1 - p) * (H - 1));
    const mid = H / 2;
    x.fillStyle = (p >= .5 ? hc : ac) + "55";
    x.fillRect(i, Math.min(y, mid), 1, Math.abs(mid - y));
    x.fillStyle = p >= .5 ? hc : ac; x.fillRect(i, y, 1, 2);
  }
  x.fillStyle = "#3a3470"; for (let i = 0; i < W; i += 4) x.fillRect(i, H / 2, 2, 1);
  for (let q = 1; q < 4; q++) { x.fillStyle = "#3a347088"; x.fillRect(Math.round(W * q / 4), 0, 1, H); }
  const last = wp[wp.length - 1];
  return el("div", { class: "box" }, el("div", { class: "tag" }, "WIN PROBABILITY"),
    el("div", { class: "wp-lab" }, el("span", null, g.home.abbr + " ▲"), el("span", null, `${g.home.abbr} ${Math.round(last * 100)}%`)), c,
    el("div", { class: "wp-lab" }, el("span", null, g.away.abbr + " ▼"), el("span", null, "Q1 · Q2 · Q3 · Q4")));
}
function teamCompare(g, d) {
  const teams = d.boxscore?.teams || []; if (teams.length < 2) return null;
  const by = id => Object.fromEntries((teams.find(t => t.team.id === id)?.statistics || []).map(s => [s.name, s.displayValue]));
  const A = by(g.away.id), H = by(g.home.id);
  const rows = [["FG%", "fieldGoalPct"], ["3P%", "threePointFieldGoalPct"], ["FT%", "freeThrowPct"], ["REBOUNDS", "totalRebounds"], ["ASSISTS", "assists"], ["TURNOVERS", "totalTurnovers", true], ["STEALS", "steals"], ["BLOCKS", "blocks"], ["PAINT PTS", "pointsInPaint"], ["FAST BREAK", "fastBreakPoints"], ["LARGEST LEAD", "largestLead"]];
  const ac = teamColor(g.away), hc = teamColor(g.home);
  return el("div", { class: "box cmp" }, rows.filter(([, k]) => A[k] != null && H[k] != null).map(([lab, k, lowGood]) => {
    const a = parseFloat(A[k]) || 0, h = parseFloat(H[k]) || 0, tot = a + h || 1;
    const aBest = lowGood ? a < h : a > h, hBest = lowGood ? h < a : h > a;
    return el("div", { class: "cmp-row" }, el("div", { class: "lab" }, lab),
      el("div", { class: "l" + (aBest ? " best" : "") }, A[k]),
      el("div", { class: "cmp-bar" }, el("div", { style: { width: a / tot * 100 + "%", background: ac } }), el("div", { style: { width: h / tot * 100 + "%", background: hc } })),
      el("div", { class: "r" + (hBest ? " best" : "") }, H[k]));
  }));
}
function performers(g, d) {
  const L = d.leaders || []; if (!L.length) return null;
  const boxes = [];
  for (const tl of L) {
    const abbr = tl.team?.abbreviation;
    for (const cat of tl.leaders || []) {
      const top = cat.leaders?.[0]; if (!top || !["points", "rebounds", "assists", "pointsPerGame", "reboundsPerGame", "assistsPerGame"].includes(cat.name)) continue;
      boxes.push(el("div", { class: "stat" }, el("div", { class: "k" }, `${cat.shortDisplayName || cat.displayName} · ${abbr}`.toUpperCase()), el("div", { class: "v" }, top.displayValue.split(",")[0]), el("div", { class: "n" }, top.athlete?.displayName || "")));
    }
  }
  return boxes.length ? el("div", { class: "box perf" }, boxes) : null;
}
function boxScore(g, d) {
  const players = d.boxscore?.players || [];
  if (!players.length) return el("div", { class: "box empty" }, "Box score appears once the game tips off.");
  const st = state.box[g.id] || (state.box[g.id] = { team: settings.fav === g.home.id ? 1 : 0, sort: null, desc: true });
  const pick = [g.away, g.home][st.team];
  const tp = players.find(p => p.team.id === pick.id) || players[st.team];
  const S = tp.statistics[0], labels = S.labels || S.names;
  const played = S.athletes.filter(a => !a.didNotPlay && a.stats.length), dnp = S.athletes.filter(a => a.didNotPlay || !a.stats.length);
  const num = v => { const n = parseFloat(String(v).split("-")[0]); return isNaN(n) ? -999 : n; };
  const highs = labels.map((_, i) => Math.max(...played.map(a => num(a.stats[i]))));
  let rows = played.map((a, i) => ({ a, i }));
  if (st.sort != null) rows.sort((x, y) => (num(y.a.stats[st.sort]) - num(x.a.stats[st.sort])) * (st.desc ? 1 : -1));
  const rerender = () => swap(renderGame(g, d), true);
  const firstBench = st.sort == null ? played.findIndex(a => !a.starter) : -1;
  const table = el("table", { class: "tbl" },
    el("thead", null, el("tr", null, el("th", { onclick: () => { st.sort = null; rerender(); } }, "PLAYER"),
      labels.map((l, i) => el("th", { class: st.sort === i ? "on" : "", onclick: () => { st.desc = st.sort === i ? !st.desc : true; st.sort = i; beep(SFX.click); rerender(); } }, l + (st.sort === i ? (st.desc ? " v" : " ^") : ""))))),
    el("tbody", null,
      rows.map(({ a }, k) => el("tr", { class: (k === firstBench ? "bench-start" : "") },
        el("td", null, (a.starter ? "" : "") + (a.athlete.shortName || a.athlete.displayName) + (a.starter ? " ★" : "")),
        a.stats.map((v, i) => el("td", { class: num(v) === highs[i] && highs[i] > 0 && labels[i] !== "PF" && labels[i] !== "TO" ? "hi" : "" }, v)))),
      S.totals?.length ? el("tr", { class: "tot" }, el("td", null, "TEAM"), S.totals.map(v => el("td", null, v))) : null,
      dnp.map(a => el("tr", { class: "dnp" }, el("td", null, a.athlete.shortName || a.athlete.displayName), el("td", { colspan: labels.length, style: { textAlign: "left" } }, (a.reason || "DNP").toLowerCase())))));
  return el("div", { class: "stack" },
    el("div", { class: "filters" }, [g.away, g.home].map((t, i) => el("button", { class: "chip", "aria-pressed": st.team === i ? "true" : "false", onclick: () => { st.team = i; st.sort = null; beep(SFX.click); rerender(); } }, t.abbr)),
      el("span", { style: { color: "var(--dim)", fontSize: "17px" } }, "★ starter · tap a column to sort")),
    el("div", { class: "box scroll-x", style: { padding: "0" } }, table));
}
function playByPlay(g, d) {
  const all = d.plays || [];
  if (!all.length) return el("div", { class: "box empty" }, "No plays yet.");
  const st = state.plays[g.id] || (state.plays[g.id] = { q: "all", scoring: false, team: "all" });
  const colors = { [g.home.id]: teamColor(g.home), [g.away.id]: teamColor(g.away) };
  const periods = [...new Set(all.map(p => p.period?.number))].filter(Boolean);
  let list = all.filter(p => (st.q === "all" || p.period?.number === +st.q) && (!st.scoring || p.scoringPlay) && (st.team === "all" || p.team?.id === st.team));
  list = list.slice().reverse();
  const rerender = () => swap(renderGame(g, d), true);
  const sel = (id, val, opts, on) => el("select", { id, "aria-label": id, onchange: e => { on(e.target.value); rerender(); } }, opts.map(([v, l]) => el("option", { value: v, selected: String(v) === String(val) }, l)));
  return el("div", { class: "stack" },
    el("div", { class: "filters" },
      sel("pbp-q", st.q, [["all", "All quarters"], ...periods.map(n => [n, n <= 4 ? "Q" + n : "OT" + (n - 4)])], v => st.q = v),
      sel("pbp-t", st.team, [["all", "Both teams"], [g.away.id, g.away.abbr], [g.home.id, g.home.abbr]], v => st.team = v),
      el("button", { class: "chip", "aria-pressed": st.scoring ? "true" : "false", onclick: () => { st.scoring = !st.scoring; rerender(); } }, "SCORING ONLY")),
    el("div", { class: "box plays" }, list.slice(0, 300).map(p => el("div", { class: "play" + (p.scoringPlay ? " score" : "") },
      el("span", { class: "clk" }, (p.period?.number <= 4 ? "Q" + p.period.number : "OT") + " " + (p.clock?.displayValue || "")),
      el("span", { class: "dot", style: { background: colors[p.team?.id] || "transparent" } }),
      el("span", { class: "tx" }, p.text),
      el("span", { class: "ps" }, p.scoringPlay ? `${p.awayScore}-${p.homeScore}` : ""))),
      list.length > 300 ? el("div", { class: "empty" }, "Showing the latest 300 plays. Filter by quarter to see more.") : null));
}
function shotChart(g, d) {
  const shots = (d.plays || []).filter(p => p.shootingPlay && p.coordinate && p.coordinate.x >= 0 && p.coordinate.x <= 50 && p.coordinate.y >= 0 && p.coordinate.y <= 47 && !/free throw/i.test(p.type?.text || p.text));
  if (!shots.length) return el("div", { class: "box empty" }, "No shot locations yet.");
  const st = state.shots[g.id] || (state.shots[g.id] = { team: "all", player: "all" });
  const names = {};
  for (const p of shots) { const id = p.participants?.[0]?.athlete?.id; if (id && !names[id]) names[id] = { name: (p.text.match(/^(.+?) (makes|misses|blocks)/) || [])[1] || id, team: p.team?.id }; }
  const list = shots.filter(p => (st.team === "all" || p.team?.id === st.team) && (st.player === "all" || p.participants?.[0]?.athlete?.id === st.player));
  const made = list.filter(p => p.scoringPlay).length, threes = list.filter(p => /three point/i.test(p.text)), threesMade = threes.filter(p => p.scoringPlay).length;
  const colors = { [g.home.id]: teamColor(g.home), [g.away.id]: teamColor(g.away) };
  const S = 4, W = 50 * S, H = 47 * S;
  const c = el("canvas", { id: "court", width: W, height: H, "aria-label": "Shot chart" }), x = c.getContext("2d");
  // court
  x.fillStyle = "#2a1c3f"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#3a2752"; for (let i = 0; i < W; i += 8) x.fillRect(i, 0, 4, H);
  const line = "#8f88c9";
  const px = (fx, fy) => [Math.round(fx * S), Math.round(fy * S)];
  const dot = (fx, fy) => { const [a, b] = px(fx, fy); x.fillRect(a, b, 2, 2); };
  x.fillStyle = line;
  x.fillRect(0, 0, W, 2); x.fillRect(0, 0, 2, H); x.fillRect(W - 2, 0, 2, H); x.fillRect(0, H - 2, W, 2);
  x.fillStyle = "#ff6b2c22"; x.fillRect(17 * S, 0, 16 * S, 19 * S); x.fillStyle = line;
  x.fillRect(17 * S, 0, 2, 19 * S); x.fillRect(33 * S, 0, 2, 19 * S); x.fillRect(17 * S, 19 * S, 16 * S + 2, 2);
  for (let a = 0; a <= Math.PI; a += 0.02) dot(25 + 6 * Math.cos(a), 19 + 6 * Math.sin(a));
  for (let y = 0; y <= 14; y += 0.25) { dot(3, y); dot(47, y); }
  const a0 = Math.acos(22 / 23.75);
  for (let a = a0; a <= Math.PI - a0; a += 0.01) dot(25 + 23.75 * Math.cos(a), 5.25 + 23.75 * Math.sin(a));
  for (let a = Math.PI; a <= 2 * Math.PI; a += 0.03) dot(25 + 6 * Math.cos(a), 47 + 6 * Math.sin(a));
  x.fillStyle = "#ff6b2c"; for (let a = 0; a < 2 * Math.PI; a += 0.3) dot(25 + .75 * Math.cos(a), 5.25 + .75 * Math.sin(a));
  x.fillRect(22 * S, 4 * S, 6 * S, 2);
  // shots
  for (const p of list) {
    const [sx, sy] = px(p.coordinate.x, p.coordinate.y), col = colors[p.team?.id] || "#fff";
    if (p.scoringPlay) { x.fillStyle = "#000"; x.fillRect(sx - 3, sy - 3, 8, 8); x.fillStyle = col; x.fillRect(sx - 2, sy - 2, 6, 6); }
    else { x.fillStyle = col + "aa"; for (let k = -2; k <= 2; k++) { x.fillRect(sx + k, sy + k, 2, 2); x.fillRect(sx + k, sy - k, 2, 2); } }
  }
  const tip = el("div", { class: "shot-tip" }, "Tap a shot to see who took it");
  c.addEventListener("click", e => {
    const r = c.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * 50, fy = (e.clientY - r.top) / r.height * 47;
    let best = null, bd = 2.5;
    for (const p of list) { const dd = Math.hypot(p.coordinate.x - fx, p.coordinate.y - fy); if (dd < bd) { bd = dd; best = p; } }
    tip.textContent = best ? `${best.period?.number <= 4 ? "Q" + best.period.number : "OT"} ${best.clock?.displayValue || ""} · ${best.text}` : "No shot there";
  });
  const rerender = () => swap(renderGame(g, d), true);
  const playerOpts = Object.entries(names).filter(([, v]) => st.team === "all" || v.team === st.team).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return el("div", { class: "stack" },
    el("div", { class: "filters" },
      el("select", { id: "shot-team", "aria-label": "Team", onchange: e => { st.team = e.target.value; st.player = "all"; rerender(); } },
        [["all", "Both teams"], [g.away.id, g.away.abbr], [g.home.id, g.home.abbr]].map(([v, l]) => el("option", { value: v, selected: v === st.team }, l))),
      el("select", { id: "shot-player", "aria-label": "Player", onchange: e => { st.player = e.target.value; rerender(); } },
        el("option", { value: "all" }, "All players"), playerOpts.map(([id, v]) => el("option", { value: id, selected: id === st.player }, v.name)))),
    el("div", { class: "box court-wrap" }, c,
      el("div", { class: "legend" }, el("span", null, el("i", { style: { background: "var(--fg)" } }), "make"), el("span", null, "✕ miss"),
        el("span", null, `FG ${made}/${list.length} · ${list.length ? Math.round(made / list.length * 100) : 0}%`), el("span", null, `3PT ${threesMade}/${threes.length}`)),
      tip));
}
function preview(g, d) {
  const out = [];
  const info = [fmtDay(g.date) + " · " + fmtTime(g.date) + " " + tzName(), d.gameInfo?.venue?.fullName, (d.broadcasts || []).flatMap(b => b.media?.shortName || b.names || []).join(" · "), d.seasonseries?.[0]?.summary].filter(Boolean);
  out.push(el("div", { class: "box mini", style: { display: "grid", gap: "6px" } }, info.map(s => el("span", null, s))));
  const perf = performers(g, d); if (perf) out.push(el("h2", { class: "sec-h" }, "SEASON LEADERS"), perf);
  const lf = d.lastFiveGames || [];
  if (lf.length) out.push(el("h2", { class: "sec-h" }, "LAST 5"), el("div", { class: "box", style: { display: "grid", gap: "10px" } }, lf.map(t => el("div", { class: "mini" },
    el("b", null, t.team?.abbreviation || ""), el("span", { style: { display: "flex", gap: "6px" } }, (t.events || []).map(e => el("span", { style: { color: e.gameResult === "W" ? "var(--win)" : "var(--bad)", fontFamily: "var(--display)", fontSize: "10px" }, title: `${e.atVs || ""} ${e.opponent?.abbreviation || ""} ${e.score || ""}` }, e.gameResult || "·")))))));
  const inj = (d.injuries || []).filter(t => (t.injuries || []).length);
  if (inj.length) out.push(el("h2", { class: "sec-h" }, "INJURY REPORT"), el("div", { class: "box inj" }, inj.flatMap(t => (t.injuries || []).map(i => el("div", null,
    el("span", null, `${t.team?.abbreviation || ""} · ${i.athlete?.displayName || ""}`), el("span", { class: "st" }, (i.status || i.type?.description || "").toUpperCase()))))));
  return out;
}

/* ---------- STANDINGS ---------- */
let standingsData = null;
async function loadStandings() { standingsData = await getJSON(STANDINGS, 600000); return standingsData; }
async function showStandings(tok) {
  swap(el("div", { class: "box loading" }, "LOADING STANDINGS"));
  let s;
  try { s = await loadStandings(); } catch { if (tok === renderToken) swap(errorBox(() => showStandings(tok))); return; }
  if (tok !== renderToken) return;
  document.getElementById("live-pill").hidden = true;
  swap(renderStandings(s));
  setUpdated();
}
function renderStandings(s) {
  const confs = s.children || [];
  const conf = confs[state.conf] || confs[0];
  const stat = (e, n) => (e.stats.find(x => x.name === n || x.type === n) || {}).displayValue ?? "";
  const rows = conf.standings.entries.slice().sort((a, b) => (+stat(a, "playoffSeed") || 99) - (+stat(b, "playoffSeed") || 99));
  const switcher = el("div", { class: "conf-switch" }, confs.map((c, i) => el("button", { class: "chip", "aria-pressed": i === state.conf ? "true" : "false", onclick: () => { state.conf = i; store.set("conf", i); beep(SFX.click); swap(renderStandings(s), true); } }, c.name.replace(" Conference", "").toUpperCase())));
  const tbl = el("table", { class: "tbl stand" },
    el("thead", null, el("tr", null, ["#", "TEAM", "W", "L", "PCT", "GB", "L10", "STRK", "DIFF"].map(h => el("th", { style: { cursor: "default" } }, h)))),
    el("tbody", null, rows.map((e, i) => {
      const strk = stat(e, "streak");
      return el("tr", { class: (i === 6 ? "cut " : i === 10 ? "cut-pi " : "") + (e.team.id === settings.fav ? "fav-row" : "") },
        el("td", { class: "seed" }, i + 1),
        el("td", null, el("span", { style: { display: "inline-flex", gap: "8px", alignItems: "center" } }, pixelImg(e.team.logos?.[0]?.href, 12, 12, "logo-img"), e.team.abbreviation, e.team.id === settings.fav ? " ★" : "")),
        el("td", null, stat(e, "wins")), el("td", null, stat(e, "losses")), el("td", null, stat(e, "winPercent")),
        el("td", null, stat(e, "gamesBehind")), el("td", null, stat(e, "Last Ten Games")),
        el("td", { class: "strk-" + strk[0] }, strk), el("td", null, stat(e, "differential")));
    })));
  return el("div", { class: "stack" }, switcher, el("div", { class: "box scroll-x", style: { padding: "0" } }, tbl),
    el("div", { class: "mini", style: { padding: "0 4px" } }, el("span", null, "Orange line: playoff cut (top 6)"), el("span", null, "Purple line: play-in (7–10)")));
}

/* ---------- settings ---------- */
async function openSettings() {
  const dlg = document.getElementById("settings"), fav = document.getElementById("fav");
  document.getElementById("opt-spoil").checked = settings.spoil;
  document.getElementById("opt-notify").checked = settings.notify;
  document.getElementById("opt-sound").checked = settings.sound;
  dlg.showModal();
  if (fav.options.length <= 1) {
    try {
      const s = standingsData || await loadStandings();
      const teams = s.children.flatMap(c => c.standings.entries.map(e => e.team)).sort((a, b) => a.displayName.localeCompare(b.displayName));
      teams.forEach(t => fav.append(el("option", { value: t.id }, t.displayName)));
    } catch {}
  }
  fav.value = settings.fav;
}
function bindSettings() {
  document.getElementById("btn-settings").onclick = () => { beep(SFX.click); openSettings(); };
  document.getElementById("fav").onchange = e => { settings.fav = e.target.value; store.set("fav", settings.fav); };
  document.getElementById("opt-spoil").onchange = e => { settings.spoil = e.target.checked; store.set("spoil", settings.spoil); revealed.clear(); };
  document.getElementById("opt-sound").onchange = e => { settings.sound = e.target.checked; store.set("sound", settings.sound); beep(SFX.coin); };
  document.getElementById("opt-notify").onchange = async e => {
    settings.notify = e.target.checked;
    if (settings.notify && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission().catch(() => "denied");
      if (p !== "granted") { settings.notify = false; e.target.checked = false; toast("Notifications are blocked. On iPhone, add the app to your Home Screen first."); }
    } else if (settings.notify && !("Notification" in window)) { toast("This browser can't show alerts. Alerts will show inside the app."); }
    store.set("notify", settings.notify);
  };
  document.getElementById("settings").addEventListener("close", () => route());
}

/* ---------- boot ---------- */
document.getElementById("tzname").textContent = tzName();
bounceBall();
bindSettings();
window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { cache.clear(); route(); } });
route();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
