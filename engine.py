#!/usr/bin/env python3
"""
EB Outlook engine — Economic Bearings
=====================================

Every quarter (Jan 1, Apr 1, Jul 1, Oct 1) it scores every theme in themes.json
on six pillars, picks the 5 best (with a diversification rule) and freezes them
for the quarter. Every week it refreshes the performance of the frozen picks.

Output: docs/eb-outlook.json  (read by the EB Outlook Framer component)
State:  state/<YYYY>-Q<n>.json (frozen outlook of each quarter)
        state/track.json       (final result of every finished quarter)

Free data only, no API key:
  - Prices: Yahoo Finance via the yfinance library
  - Macro:  FRED (St. Louis Fed) public CSV
  - News:   GDELT DOC 2.0 API (tone and volume of world news coverage)

Usage:
  python engine.py                 # normal run (weekly / quarterly, decides itself)
  python engine.py --rebuild       # recompute the current quarter's outlook from scratch
  EBO_SYNTHETIC=1 python engine.py # offline test with fake random prices
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "themes.json"
OUT = ROOT / "docs" / "eb-outlook.json"
STATE = ROOT / "state"

# ------------------------------------------------------------------ method

PILLARS = [
    # key, label, weight (%)
    ("momentum", "Momentum", 30),
    ("trend", "Trend", 20),
    ("strength", "Strength", 15),
    ("risk", "Risk", 15),
    ("news", "News", 10),
    ("macro", "Macro", 10),
]
TOP_N = 5
CORR_MAX = 0.85          # two picks may not move together more than this (1y weekly returns)
NEWS_BUDGET_S = 600     # max seconds spent on GDELT per run
MIN_DAYS = 273           # ~13 months of trading days needed to score a theme
TD = {"m1": 21, "m3": 63, "m6": 126, "m12": 252}

SYNTHETIC = os.environ.get("EBO_SYNTHETIC") == "1"
UA = {"User-Agent": "Mozilla/5.0 (EB Outlook engine; non-commercial magazine)"}

SUFFIX_CCY = {
    ".PA": "EUR", ".DE": "EUR", ".F": "EUR", ".MI": "EUR", ".AS": "EUR", ".MC": "EUR",
    ".BR": "EUR", ".HE": "EUR", ".VI": "EUR", ".LS": "EUR", ".IR": "EUR",
    ".SW": "CHF", ".L": "GBP", ".T": "JPY", ".HK": "HKD", ".ST": "SEK", ".CO": "DKK",
    ".OL": "NOK", ".TO": "CAD", ".AX": "AUD", ".KS": "KRW", ".TW": "TWD",
    ".SS": "CNY", ".SZ": "CNY", ".NS": "INR", ".SA": "BRL", ".SI": "SGD",
}


def log(*a):
    print("[eb-outlook]", *a, flush=True)


# ------------------------------------------------------------------ calendar

def quarter_of(d: dt.date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def q_start(y: int, q: int) -> dt.date:
    return dt.date(y, 3 * (q - 1) + 1, 1)


def q_next(y: int, q: int) -> tuple[int, int]:
    return (y + 1, 1) if q == 4 else (y, q + 1)


def q_prev(y: int, q: int) -> tuple[int, int]:
    return (y - 1, 4) if q == 1 else (y, q - 1)


def q_end(y: int, q: int) -> dt.date:
    ny, nq = q_next(y, q)
    return q_start(ny, nq) - dt.timedelta(days=1)


def q_key(y: int, q: int) -> str:
    return f"{y}-Q{q}"


def q_label(y: int, q: int) -> str:
    return f"Q{q} {y}"


# ------------------------------------------------------------------ data: prices

def ccy_of(t: str) -> str:
    for suf, c in SUFFIX_CCY.items():
        if t.upper().endswith(suf):
            return c
    return "USD"


def _yf_close(tickers: list[str], start: str) -> pd.DataFrame:
    import yfinance as yf

    df = yf.download(tickers, start=start, auto_adjust=True, progress=False,
                     threads=True, group_by="column")
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        close = df["Close"]
    else:
        close = df[["Close"]].rename(columns={"Close": tickers[0]})
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    return close


def synthetic_prices(tickers: list[str], start: str) -> pd.DataFrame:
    idx = pd.bdate_range(start, dt.date.today())
    out = {}
    for t in tickers:
        rng = np.random.default_rng(abs(hash(t)) % (2**32))
        drift = rng.normal(0.0003, 0.0004)
        vol = rng.uniform(0.008, 0.025)
        r = rng.normal(drift, vol, len(idx))
        if t.endswith("=X"):
            r = rng.normal(0, 0.004, len(idx))
        out[t] = 100 * np.exp(np.cumsum(r))
    return pd.DataFrame(out, index=idx)


def fetch_prices(tickers: list[str], start: str) -> pd.DataFrame:
    tickers = sorted(set(tickers))
    if SYNTHETIC:
        return synthetic_prices(tickers, start)
    close = _yf_close(tickers, start)
    missing = [t for t in tickers if t not in close.columns or close[t].dropna().empty]
    for t in missing:  # one retry each, alone
        try:
            time.sleep(1)
            c = _yf_close([t], start)
            if not c.empty and c.iloc[:, 0].dropna().size:
                close[t] = c.iloc[:, 0]
        except Exception as e:  # noqa: BLE001
            log("price retry failed", t, e)
    return close


def usd_prices(close: pd.DataFrame, start: str) -> pd.DataFrame:
    """Convert non-USD listings to US dollars with Yahoo FX rates (CCYUSD=X)."""
    ccys = sorted({ccy_of(t) for t in close.columns} - {"USD"})
    if not ccys:
        return close
    fx = fetch_prices([f"{c}USD=X" for c in ccys], start).sort_index().ffill()
    out = close.copy()
    for t in close.columns:
        c = ccy_of(t)
        if c == "USD":
            continue
        rate = fx.get(f"{c}USD=X")
        if rate is None or rate.dropna().empty:
            log("no FX for", t, c, "- kept in local currency")
            continue
        out[t] = close[t] * rate.reindex(close.index, method="ffill")
    return out


# ------------------------------------------------------------------ data: macro (FRED)

FRED = {"rates": "DGS10", "oil": "DCOILWTICO", "dollar": "DTWEXBGS",
        "credit": "BAMLH0A0HYM2", "curve": "T10Y2Y"}


def fetch_fred(series: str) -> pd.Series | None:
    if SYNTHETIC:
        idx = pd.bdate_range("2023-01-01", dt.date.today())
        rng = np.random.default_rng(abs(hash(series)) % (2**32))
        return pd.Series(4 + np.cumsum(rng.normal(0, 0.03, len(idx))), index=idx)
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                df = pd.read_csv(io.BytesIO(r.read()), na_values=".")
            df.columns = ["date", "v"]
            s = pd.Series(pd.to_numeric(df["v"], errors="coerce").values,
                          index=pd.to_datetime(df["date"])).dropna()
            return s
        except Exception as e:  # noqa: BLE001
            log("FRED", series, "attempt", attempt + 1, "failed:", e)
            time.sleep(3)
    return None


# Macro from Yahoo Finance (reliable from GitHub). FRED is the fallback.
YAHOO_MACRO = {"rates": "^TNX", "short": "^IRX", "oil": "CL=F", "dollar": "DX-Y.NYB",
               "hy": "HYG", "tsy": "IEF"}


def macro_series(start: str) -> dict[str, pd.Series | None]:
    out: dict[str, pd.Series | None] = {}
    try:
        px = fetch_prices(list(YAHOO_MACRO.values()), start).sort_index()
        g = lambda k: px[YAHOO_MACRO[k]].dropna() if YAHOO_MACRO[k] in px.columns else None
        out["rates"] = g("rates")                     # 10-year Treasury yield, %
        out["oil"] = g("oil")                         # WTI crude, $
        out["dollar"] = g("dollar")                   # US dollar index
        hy, tsy = g("hy"), g("tsy")
        if hy is not None and tsy is not None and len(hy) and len(tsy):
            # credit stress: high-yield bonds lagging Treasuries (higher = more stress)
            out["credit"] = (-np.log(hy / tsy.reindex(hy.index, method="ffill"))).dropna()
        sh = g("short")
        if out["rates"] is not None and sh is not None and len(sh):
            out["curve"] = (out["rates"] - sh.reindex(out["rates"].index, method="ffill")).dropna()
    except Exception as e:  # noqa: BLE001
        log("Yahoo macro failed:", e)
    for k, sid in FRED.items():
        if out.get(k) is None or len(out[k]) < 300:
            log("macro", k, "from FRED")
            out[k] = fetch_fred(sid)
    log("macro series:", {k: (0 if v is None else len(v)) for k, v in out.items()})
    return out


# ------------------------------------------------------------------ data: news
#
# Two free sources. GDELT (tone of full articles, worldwide) is tried first; if it does
# not answer from GitHub, the whole run switches to Google News RSS headlines scored with
# VADER (+ a small finance word list). One source per run, so scores stay comparable.

def news_query(theme: dict) -> str:
    if theme.get("news"):
        return theme["news"]
    parts = [p.strip().lower() for p in theme["name"].replace(" and ", " & ").split("&")]
    parts = [p for p in parts if len(p) >= 4]
    q = " OR ".join(f'"{p}"' for p in parts)
    return f"({q})" if len(parts) > 1 else q


def gdelt_timeline(query: str, mode: str, start: dt.date, end: dt.date) -> pd.Series | None:
    if SYNTHETIC:
        idx = pd.date_range(start, end)
        rng = np.random.default_rng(abs(hash(query + mode)) % (2**32))
        base = rng.normal(-0.5, 1.2) if mode == "timelinetone" else rng.uniform(0.01, 0.2)
        return pd.Series(base + rng.normal(0, 0.3, len(idx)), index=idx)
    params = {
        "query": f"{query} sourcelang:english",
        "mode": mode,
        "format": "json",
        "startdatetime": start.strftime("%Y%m%d") + "000000",
        "enddatetime": end.strftime("%Y%m%d") + "235959",
    }
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8", "ignore")
        j = json.loads(raw)
        data = (j.get("timeline") or [{}])[0].get("data") or []
        if not data:
            return None
        return pd.Series([float(d["value"]) for d in data],
                         index=pd.to_datetime([d["date"][:8] for d in data]))
    except Exception as e:  # noqa: BLE001
        log("GDELT", mode, query[:40], "failed:", str(e)[:120])
    return None


# ---- Google News RSS + VADER

FIN_WORDS = {
    # negative market words VADER does not know well
    "plunge": -2.6, "plunges": -2.6, "plunged": -2.6, "slump": -2.2, "slumps": -2.2, "slumped": -2.2,
    "tumble": -2.2, "tumbles": -2.2, "tumbled": -2.2, "sink": -1.8, "sinks": -1.8, "sank": -1.8,
    "slide": -1.5, "slides": -1.5, "slid": -1.5, "fall": -1.3, "falls": -1.3, "fell": -1.3,
    "drop": -1.4, "drops": -1.4, "dropped": -1.4, "crash": -2.8, "crashes": -2.8, "selloff": -2.4,
    "sell-off": -2.4, "rout": -2.6, "warns": -1.8, "warning": -1.6, "downgrade": -2.0,
    "downgrades": -2.0, "downgraded": -2.0, "cuts": -1.2, "layoffs": -2.0, "lawsuit": -1.8,
    "probe": -1.6, "investigation": -1.6, "ban": -1.6, "bans": -1.6, "tariff": -1.2, "tariffs": -1.2,
    "recall": -1.6, "misses": -1.8, "missed": -1.8, "weak": -1.6, "weaker": -1.6, "bankruptcy": -3.0,
    "default": -2.2, "fraud": -3.0, "shortage": -1.4, "bubble": -1.6, "losses": -1.8, "slowdown": -1.8,
    "resigns": -1.4, "ousted": -2.0, "sanctions": -1.6, "halts": -1.6, "delays": -1.2,
    # positive market words
    "rally": 2.2, "rallies": 2.2, "rallied": 2.2, "surge": 2.2, "surges": 2.2, "surged": 2.2,
    "soar": 2.6, "soars": 2.6, "soared": 2.6, "jump": 1.8, "jumps": 1.8, "jumped": 1.8,
    "gains": 1.6, "gain": 1.4, "beat": 1.6, "beats": 1.8, "record": 1.4, "upgrade": 2.0,
    "upgrades": 2.0, "upgraded": 2.0, "boost": 1.6, "boosts": 1.6, "rebound": 1.8, "rebounds": 1.8,
    "outperform": 1.8, "wins": 1.8, "approval": 1.6, "approved": 1.6, "breakthrough": 2.4,
    "demand": 0.6, "expands": 1.2, "expansion": 1.2, "profit": 1.2, "profits": 1.2,
}
_VADER = None


def headline_score(title: str) -> float:
    global _VADER
    if _VADER is None:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        _VADER = SentimentIntensityAnalyzer()
        _VADER.lexicon.update(FIN_WORDS)
    return float(_VADER.polarity_scores(title)["compound"])


def parse_rss(xml_bytes: bytes) -> list[dict]:
    import email.utils
    import xml.etree.ElementTree as ET

    items = []
    root = ET.fromstring(xml_bytes)
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src_el = it.find("source")
        src = (src_el.text or "").strip() if src_el is not None else ""
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3].strip()
        try:
            d = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
            day = d.date().isoformat()
        except Exception:  # noqa: BLE001
            day = ""
        if title:
            items.append({"t": title, "url": (it.findtext("link") or "").strip(), "src": src,
                          "date": day, "s": round(headline_score(title), 3)})
    return items


def rss_items(query: str, after: dt.date, before: dt.date) -> list[dict] | None:
    """Google News headlines published between two dates (max ~100)."""
    if SYNTHETIC:
        rng = np.random.default_rng(abs(hash(query + str(after))) % (2**32))
        words = ["rally", "plunge", "record", "warns", "steady", "deal", "probe", "growth"]
        n = int(rng.integers(8, 60))
        return [{"t": f"{query.strip('()\"')} {rng.choice(words)} story {i}", "url": "https://example.com",
                 "src": "Example News", "date": (before - dt.timedelta(days=int(rng.integers(1, max(2, (before - after).days))))).isoformat(),
                 "s": float(rng.normal(0, 0.35))} for i in range(n)]
    q = f"{query} {MARKET_CONTEXT} after:{after.isoformat()} before:{before.isoformat()}"
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                return parse_rss(r.read())
        except Exception as e:  # noqa: BLE001
            log("RSS", query[:40], "attempt", attempt + 1, "failed:", str(e)[:120])
            time.sleep(3)
    return None


# keeps Google News on business coverage (e.g. "banks" the sector, not people named Banks)
MARKET_CONTEXT = "(stocks OR shares OR sector OR industry OR market OR investors)"

_SOURCE: str | None = None


def news_source(probe: str, end: dt.date) -> str | None:
    """'gdelt', 'rss' or None. Decided once per run."""
    global _SOURCE
    if _SOURCE is not None:
        return _SOURCE or None
    if gdelt_timeline(probe, "timelinetone", end - dt.timedelta(days=30), end) is not None:
        _SOURCE = "gdelt"
    elif rss_items(probe, end - dt.timedelta(days=7), end + dt.timedelta(days=1)):
        _SOURCE = "rss"
    else:
        _SOURCE = ""
    log("news source:", _SOURCE or "none")
    return _SOURCE or None


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return float(np.mean(xs)) if xs else None


def news_signals(themes: list[dict], asof: dt.date) -> dict[str, dict]:
    """Quarterly News pillar: tone of the last 30 days, its change vs the 60 days before,
    and attention (volume change)."""
    if not themes:
        return {}
    src = news_source(news_query(themes[0]), asof)
    if not src:
        return {}
    start = asof - dt.timedelta(days=89)
    mid = asof - dt.timedelta(days=29)
    out = {}
    t0 = time.time()
    tried = 0
    for th in themes:
        tried += 1
        if src == "gdelt" and tried == 6 and len(out) < 3:
            # GDELT answered the probe but not the themes: redo everything with Google News
            log("news: GDELT unreliable this run, switching to Google News")
            return _rss_signals(themes, asof)
        if time.time() - t0 > NEWS_BUDGET_S:
            log("news: time budget reached, remaining themes get a neutral score")
            break
        q = news_query(th)
        if src == "gdelt":
            tone = gdelt_timeline(q, "timelinetone", start, asof)
            time.sleep(0 if SYNTHETIC else 6)  # GDELT asks for max one request every 5 s
            vol = gdelt_timeline(q, "timelinevol", start, asof)
            time.sleep(0 if SYNTHETIC else 6)
            if tone is None or tone.dropna().size < 20:
                continue
            recent = tone[tone.index >= pd.Timestamp(mid)].mean()
            prior = tone[tone.index < pd.Timestamp(mid)].mean()
            buzz = None
            if vol is not None and vol.dropna().size >= 20:
                vr = vol[vol.index >= pd.Timestamp(mid)].mean()
                vp = vol[vol.index < pd.Timestamp(mid)].mean()
                buzz = float(vr / vp) if vp and vp > 0 else None
            out[th["id"]] = {"tone": float(recent), "toneChg": float(recent - prior), "buzz": buzz}
        else:
            return _rss_signals(themes, asof)
        log("news", th["id"], out[th["id"]])
    return out


def _rss_signals(themes: list[dict], asof: dt.date) -> dict[str, dict]:
    global _SOURCE
    _SOURCE = "rss"
    start = asof - dt.timedelta(days=89)
    mid = asof - dt.timedelta(days=29)
    out = {}
    t0 = time.time()
    for th in themes:
        if time.time() - t0 > NEWS_BUDGET_S:
            log("news: time budget reached, remaining themes get a neutral score")
            break
        q = news_query(th)
        rec = rss_items(q, mid, asof + dt.timedelta(days=1))
        time.sleep(0 if SYNTHETIC else 1.5)
        pri = rss_items(q, start, mid)
        time.sleep(0 if SYNTHETIC else 1.5)
        if not rec or len(rec) < 5:
            continue
        tr = _mean([i["s"] for i in rec])
        tp = _mean([i["s"] for i in pri]) if pri and len(pri) >= 5 else tr
        out[th["id"]] = {"tone": tr, "toneChg": tr - tp, "buzz": None}
        log("news", th["id"], out[th["id"]])
    return out


# ---- Weekly News Watch for the Top 5

def news_watch(themes: list[dict], today: dt.date) -> tuple[dict[str, dict], str | None]:
    """This week's coverage vs the 4 weeks before: status, attention and 3 headlines.
    Always Google News: one consistent source, and it gives the headlines."""
    if not themes:
        return {}, None
    w0 = today - dt.timedelta(days=7)
    b0 = today - dt.timedelta(days=35)
    out = {}
    for th in themes:
        q = news_query(th)
        recent = base = buzz = None
        week = rss_items(q, w0, today + dt.timedelta(days=1)) or []
        time.sleep(0 if SYNTHETIC else 1.5)
        prior = rss_items(q, b0, w0) or []
        time.sleep(0 if SYNTHETIC else 1.5)
        n = len(week)
        recent = _mean([i["s"] for i in week]) if n >= 5 else None
        base = _mean([i["s"] for i in prior]) if len(prior) >= 5 else None
        # no attention measure from RSS: Google returns fewer old articles, so counts are biased
        th_d, th_lvl = 0.07, 0.20
        status = "neutral"
        if recent is not None and n >= 5:
            d = recent - (base if base is not None else recent)
            if d <= -th_d or recent <= -th_lvl:
                status = "negative"
            elif d >= th_d or recent >= th_lvl:
                status = "positive"
        # headlines that explain the status
        uniq, seen = [], set()
        for it in week:
            k = it["t"].lower()[:70]
            if k not in seen:
                seen.add(k)
                uniq.append(it)
        if status == "negative":
            uniq.sort(key=lambda i: i["s"])
        elif status == "positive":
            uniq.sort(key=lambda i: -i["s"])
        else:
            uniq.sort(key=lambda i: i["date"], reverse=True)
        heads = [{"t": i["t"][:160], "url": i["url"], "src": i["src"], "date": i["date"],
                  "tone": "up" if i["s"] >= 0.2 else "dn" if i["s"] <= -0.2 else "flat"}
                 for i in uniq[:3]]
        out[th["id"]] = {
            "status": status,
            "recent": r1(recent, 2), "base": r1(base, 2),
            "buzz": r1(buzz, 2), "rising": bool(buzz and buzz >= 1.5), "n": n,
            "headlines": heads,
        }
        log("news watch", th["id"], status, out[th["id"]]["recent"], out[th["id"]]["base"], n)
    label = "Google News" if any(v["n"] for v in out.values()) else None
    return out, label


# ------------------------------------------------------------------ maths helpers

def pct_rank(s: pd.Series) -> pd.Series:
    """Cross-sectional rank to 0..100 (worst 0, best 100). NaN stays NaN."""
    v = s.dropna()
    if len(v) <= 1:
        return pd.Series(50.0, index=s.index).where(s.notna())
    r = v.rank(method="average")
    return ((r - 1) / (len(v) - 1) * 100).reindex(s.index)


def ret(p: pd.Series, n: int) -> float:
    p = p.dropna()
    if len(p) <= n:
        return float("nan")
    return float(p.iloc[-1] / p.iloc[-1 - n] - 1)


def max_drawdown(p: pd.Series) -> float:
    p = p.dropna()
    return float((p / p.cummax() - 1).min()) if len(p) else float("nan")


def r1(x, k=1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), k)


# ------------------------------------------------------------------ build theme indices

def build_indices(cfg: dict, px: pd.DataFrame, cal: pd.DatetimeIndex, asof_ts: pd.Timestamp,
                  fixed: dict[str, list[str]] | None = None):
    """Equal-weight daily-rebalanced index (start 100) per theme, in USD, on the US calendar."""
    px = px.reindex(px.index.union(cal)).sort_index().ffill(limit=5).reindex(cal)
    idx, used = {}, {}
    hist_start = cal[max(0, cal.get_indexer([asof_ts], method="pad")[0] - MIN_DAYS)]
    for th in cfg["themes"]:
        tick = [p["t"] for p in th["proxies"]]
        if fixed and th["id"] in fixed:
            ok = [t for t in fixed[th["id"]] if t in px.columns]
        else:
            ok = [t for t in tick if t in px.columns
                  and pd.notna(px.at[asof_ts, t]) and pd.notna(px.at[hist_start, t])]
        if not ok:
            log("skip theme (no usable prices):", th["id"])
            continue
        r = px[ok].pct_change(fill_method=None).mean(axis=1, skipna=True)
        first = px[ok].dropna(how="all").index.min()
        r = r[r.index > first].fillna(0.0)
        idx[th["id"]] = 100 * (1 + r).cumprod()
        used[th["id"]] = ok
    return pd.DataFrame(idx), used


# ------------------------------------------------------------------ scoring

def macro_frame(fred: dict[str, pd.Series | None], weeks: pd.DatetimeIndex) -> pd.DataFrame:
    cols = {}
    for k in ("rates", "oil", "dollar", "credit"):
        s = fred.get(k)
        if s is None or s.empty:
            continue
        w = s.resample("W-FRI").last().reindex(weeks, method="ffill")
        cols[k] = np.log(w).diff() if k in ("oil", "dollar") else w.diff()
    return pd.DataFrame(cols)


MACRO_TEXT = {
    "rates": ("Helped by rising interest rates", "Hurt by rising interest rates"),
    "oil": ("Helped by higher oil prices", "Hurt by higher oil prices"),
    "dollar": ("Helped by a stronger US dollar", "Hurt by a stronger US dollar"),
    "credit": ("Holds up when credit stress rises", "Hurt when credit stress rises"),
}


def macro_scores(idx: pd.DataFrame, bench: pd.Series, fred: dict, asof_ts: pd.Timestamp):
    """Data-driven macro fit: how each theme's return vs the world reacted to rates, oil,
    the dollar and credit spreads over 2 years (ridge regression), multiplied by how those
    factors moved over the last 13 weeks. Positive = recent macro moves are a tailwind."""
    wk = idx[idx.index <= asof_ts].resample("W-FRI").last()
    bw = bench[bench.index <= asof_ts].resample("W-FRI").last()
    wk, bw = wk.iloc[-105:], bw.iloc[-105:]
    X = macro_frame(fred, wk.index).iloc[1:]
    if X.shape[1] == 0:
        return {}, {}
    ex = np.log(wk).diff().iloc[1:].sub(np.log(bw).diff().iloc[1:], axis=0)
    X = X.dropna()
    ex = ex.reindex(X.index)
    if len(X) < 52:
        return {}, {}
    mu, sd = X.mean(), X.std().replace(0, np.nan)
    Z = ((X - mu) / sd).fillna(0)
    recent = X.iloc[-13:].sum() / (sd * math.sqrt(13))
    recent = recent.clip(-2, 2).fillna(0)
    lam = 10.0
    A = Z.values
    tail, watch = {}, {}
    for tid in ex.columns:
        y = ex[tid].values
        m = np.isfinite(y)
        if m.sum() < 52:
            continue
        a, yy = A[m], y[m] - y[m].mean()
        beta = np.linalg.solve(a.T @ a + lam * np.eye(a.shape[1]), a.T @ yy)
        resid = yy - a @ beta
        se = np.sqrt(np.diag(np.linalg.inv(a.T @ a + lam * np.eye(a.shape[1])))
                     * resid.var(ddof=a.shape[1] + 1))
        tail[tid] = float(beta @ recent.values)
        w = []
        for k, b, s in sorted(zip(Z.columns, beta, se), key=lambda z: -abs(z[1] / (z[2] or 1))):
            if s and abs(b / s) >= 2 and len(w) < 2:
                txt = MACRO_TEXT[k][0 if b > 0 else 1]
                # factor moved clearly (half a usual 13-week move or more) in the last quarter
                now = "flat" if abs(recent[k]) < 0.5 else ("up" if b * recent[k] > 0 else "dn")
                w.append({"t": txt, "now": now})
        watch[tid] = w
    return tail, watch


def regime_now(bench: pd.Series, fred: dict, at: pd.Timestamp) -> dict:
    b = bench[bench.index <= at].dropna()
    parts, notes = [], []
    if len(b) > 200:
        above = b.iloc[-1] > b.iloc[-200:].mean()
        parts.append(1.0 if above else 0.0)
        notes.append("World stocks above 200-day average" if above else "World stocks below 200-day average")
        parts.append(1.0 if ret(b, 126) > 0 else 0.0)
    cr = fred.get("credit")
    if cr is not None and not cr.empty:
        c = cr[cr.index <= at]
        if len(c) > 70:
            calm = c.iloc[-1] <= c.iloc[-64]
            parts.append(1.0 if calm else 0.0)
            notes.append("credit spreads narrowing" if calm else "credit spreads widening")
    cv = fred.get("curve")
    if cv is not None and not cv.empty:
        c = cv[cv.index <= at]
        if len(c):
            parts.append(1.0 if c.iloc[-1] > 0 else 0.0)
    score = round(100 * sum(parts) / len(parts)) if parts else 50
    label = "Risk-on" if score >= 65 else "Risk-off" if score <= 35 else "Neutral"
    note = ", ".join(notes[:2])
    return {"label": label, "score": score, "note": note[:1].upper() + note[1:] if note else ""}


def score_quarter(cfg, idx, bench, fred, news, asof_ts):
    ids = list(idx.columns)
    I = idx[idx.index <= asof_ts]
    B = bench[bench.index <= asof_ts]
    raw = pd.DataFrame(index=ids, dtype=float)
    facts = {}
    for tid in ids:
        p = I[tid].dropna()
        if len(p) < MIN_DAYS:
            log("not enough history:", tid, len(p))
            continue
        m12 = p.iloc[-22] / p.iloc[-253] - 1
        m6 = p.iloc[-22] / p.iloc[-127] - 1
        ma200 = p.iloc[-200:].mean()
        ma200_prev = p.iloc[-221:-21].mean()
        dist = p.iloc[-1] / ma200 - 1
        slope = ma200 / ma200_prev - 1
        rs3 = ret(p, 63) - ret(B, 63)
        d = p.pct_change().iloc[-252:]
        vol = d.std() * math.sqrt(252)
        mdd = max_drawdown(p.iloc[-253:])
        bd = B.pct_change().reindex(d.index)
        beta = d.cov(bd) / bd.var() if bd.var() else float("nan")
        corr = d.corr(bd)
        monthly = p.iloc[-253:].iloc[::21].pct_change().dropna()
        raw.loc[tid, "mom"] = 0.5 * m12 + 0.5 * m6
        raw.loc[tid, "dist"] = dist
        raw.loc[tid, "slope"] = slope
        raw.loc[tid, "rs"] = rs3
        raw.loc[tid, "riskraw"] = -(vol + 0.5 * abs(mdd))
        facts[tid] = dict(vol=vol, mdd=mdd, beta=beta, corr=corr, dist=dist, slope=slope,
                          worst=float(monthly.min()) if len(monthly) else float("nan"))
    raw = raw.dropna(how="all")
    if raw.empty:
        raise SystemExit("No theme could be scored — check the price data.")

    sc = pd.DataFrame(index=raw.index)
    sc["momentum"] = pct_rank(raw["mom"])
    sc["trend"] = (pct_rank(raw["dist"]) + pct_rank(raw["slope"])) / 2
    sc["strength"] = pct_rank(raw["rs"])
    sc["risk"] = pct_rank(raw["riskraw"])

    # News: only used if at least half the themes have data; missing themes get 50 (neutral)
    news_ok = sum(1 for t in raw.index if t in news) >= len(raw.index) / 2
    if news_ok:
        tone = pd.Series({t: news[t]["tone"] for t in raw.index if t in news})
        chg = pd.Series({t: news[t]["toneChg"] for t in raw.index if t in news})
        sc["news"] = (0.6 * pct_rank(tone) + 0.4 * pct_rank(chg)).reindex(raw.index).fillna(50)
    tail, watch = macro_scores(idx, bench, fred, asof_ts)
    macro_ok = len(tail) >= len(raw.index) / 2
    if macro_ok:
        sc["macro"] = pct_rank(pd.Series(tail)).reindex(raw.index).fillna(50)

    weights = {k: w for k, _, w in PILLARS if k in sc.columns}
    tot = sum(weights.values())
    weights = {k: round(100 * w / tot) for k, w in weights.items()}
    sc["score"] = sum(sc[k] * w for k, w in weights.items()) / sum(weights.values())
    sc = sc.sort_values("score", ascending=False)

    # Top 5 with the diversification rule
    wr = np.log(I[sc.index].resample("W-FRI").last()).diff().iloc[-52:]
    cm = wr.corr()
    top, skipped = [], {}
    for tid in sc.index:
        clash = next((o for o in top if cm.at[tid, o] > CORR_MAX), None)
        if clash:
            skipped[tid] = clash
            continue
        top.append(tid)
        if len(top) == TOP_N:
            break
    return sc, weights, top, skipped, facts, watch, news_ok, macro_ok


# ------------------------------------------------------------------ reader-facing labels

def risk_level(vol: float) -> str:
    return "low" if vol < 0.18 else "medium" if vol < 0.28 else "high"


def make_tags(s: pd.Series, f: dict, news: dict | None) -> list[dict]:
    pos, neg = [], []
    if f["dist"] > 0 and f["slope"] > 0:
        pos.append(("Uptrend", s["trend"]))
    elif f["dist"] < 0 and f["slope"] < 0:
        neg.append(("Downtrend", 100 - s["trend"]))
    if s["momentum"] >= 75:
        pos.append(("Strong momentum", s["momentum"]))
    if s["strength"] >= 75:
        pos.append(("Beating the market", s["strength"]))
    if "news" in s and pd.notna(s.get("news")):
        if s["news"] >= 75:
            pos.append(("Positive news", s["news"]))
        elif s["news"] <= 20:
            neg.append(("Negative news", 100 - s["news"]))
    if news and news.get("buzz") and news["buzz"] >= 1.4:
        pos.append(("Rising attention", 70 + min(30, news["buzz"] * 5)))
    if "macro" in s and pd.notna(s.get("macro")):
        if s["macro"] >= 75:
            pos.append(("Macro tailwind", s["macro"]))
        elif s["macro"] <= 20:
            neg.append(("Macro headwind", 100 - s["macro"]))
    if s["risk"] >= 80:
        pos.append(("Low volatility", s["risk"]))
    if f["vol"] >= 0.30:
        neg.append(("High volatility", 90))
    if f["dist"] >= 0.25:
        neg.append(("Stretched", 85))
    pos.sort(key=lambda x: -x[1])
    neg.sort(key=lambda x: -x[1])
    out = [{"t": t, "tone": "up"} for t, _ in pos[:2]] + [{"t": t, "tone": "dn"} for t, _ in neg[:1]]
    if len(out) < 3:
        out += [{"t": t, "tone": "up"} for t, _ in pos[2:2 + 3 - len(out)]]
    return out[:3]


def risk_notes(f: dict) -> list[str]:
    n = []
    if f["vol"] >= 0.30:
        n.append("Large price swings: a fall of 20% or more within a quarter is possible.")
    if f["dist"] >= 0.25:
        n.append("Far above its 200-day average: pullbacks are common after big runs.")
    if f["mdd"] <= -0.30:
        n.append("Lost more than 30% from a peak in the past year.")
    if pd.notna(f["beta"]) and f["beta"] >= 1.3:
        n.append("Tends to fall harder than world stocks in a sell-off.")
    return n


# ------------------------------------------------------------------ dynamic part (weekly)

def weekly_spark(p: pd.Series, last: pd.Timestamp, weeks=53) -> list[float]:
    w = p[p.index <= last].resample("W-FRI").last().dropna()
    if w.index[-1] > last:
        w.index = w.index[:-1].append(pd.DatetimeIndex([last]))
    w = w.iloc[-weeks:]
    return [round(float(v / w.iloc[0] * 100), 1) for v in w]


def dynamic_fields(p: pd.Series, b: pd.Series, asof_ts, last_ts):
    p = p[p.index <= last_ts].dropna()
    perf = {k: r1(100 * ret(p, n)) for k, n in TD.items()}
    vs = {k: r1(100 * (ret(p, n) - ret(b[b.index <= last_ts], n))) for k, n in TD.items()}
    since = r1(100 * (p.iloc[-1] / p.loc[:asof_ts].iloc[-1] - 1), 2)
    return perf, vs, since


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="recompute this quarter's outlook")
    ap.add_argument("--today", help="pretend today is YYYY-MM-DD (testing)")
    args = ap.parse_args()

    cfg = json.loads(CONFIG.read_text())
    STATE.mkdir(exist_ok=True)
    OUT.parent.mkdir(exist_ok=True)

    today = dt.date.fromisoformat(args.today) if args.today else dt.datetime.now(dt.timezone.utc).date()
    y, q = quarter_of(today)
    qs, qe = q_start(y, q), q_end(y, q)
    state_file = STATE / f"{q_key(y, q)}.json"

    bench_t = cfg["benchmark"]["t"]
    all_t = [bench_t] + [p["t"] for th in cfg["themes"] for p in th["proxies"]]
    start = (qs - dt.timedelta(days=3 * 365)).isoformat()
    log("downloading", len(set(all_t)), "tickers from", start)
    close = fetch_prices(all_t, start)
    close = close[close.index.date <= today]
    px = usd_prices(close, start)
    if bench_t not in px.columns or px[bench_t].dropna().empty:
        raise SystemExit("Benchmark prices missing — aborting without touching the published file.")
    cal = px[bench_t].dropna().index
    bench = px[bench_t].reindex(cal)

    pre = cal[cal < pd.Timestamp(qs)]
    asof_ts = pre[-1]                       # last close before the quarter starts
    last_ts = cal[-1]                       # latest close available
    log("quarter", q_label(y, q), "asOf", asof_ts.date(), "latest", last_ts.date())

    fred = macro_series(start)

    state = None
    if state_file.exists() and not args.rebuild:
        state = json.loads(state_file.read_text())
        log("weekly refresh of frozen outlook", state_file.name)

    if state is None:
        # ---------------- new outlook for this quarter
        idx, used = build_indices(cfg, px, cal, asof_ts)
        active = [th for th in cfg["themes"] if th["id"] in idx.columns]
        news = news_signals(active, asof_ts.date())
        sc, weights, top, skipped, facts, watch, news_ok, macro_ok = score_quarter(
            cfg, idx, bench, fred, news, asof_ts)

        py, pq = q_prev(y, q)
        prev_file = STATE / f"{q_key(py, pq)}.json"
        prev = json.loads(prev_file.read_text()) if prev_file.exists() else None
        prev_top = {t["id"]: t["topRank"] for t in prev["themes"] if t.get("topRank")} if prev else {}
        prev_all = {t["id"]: t["rank"] for t in prev["themes"]} if prev else {}

        by_id = {th["id"]: th for th in cfg["themes"]}
        frozen = []
        for rank, tid in enumerate(sc.index, start=1):
            th, s, f = by_id[tid], sc.loc[tid], facts[tid]
            pillars = [{"key": k, "label": lab, "weight": weights[k], "score": r1(s[k], 0)}
                       for k, lab, _ in PILLARS if k in weights]
            t = {
                "id": tid, "name": th["name"], "category": th.get("category", ""),
                "icon": th.get("icon", ""), "rank": rank,
                "topRank": top.index(tid) + 1 if tid in top else None,
                "score": r1(s["score"], 0), "pillars": pillars,
                "risk": {"level": risk_level(f["vol"]), "vol": r1(100 * f["vol"]),
                         "mdd": r1(100 * f["mdd"]), "beta": r1(f["beta"], 2),
                         "worstMonth": r1(100 * f["worst"]), "dist200": r1(100 * f["dist"]),
                         "corr": r1(f["corr"], 2)},
                "tags": make_tags(s, f, news.get(tid)),
                "watch": watch.get(tid, []),
                "notes": risk_notes(f),
                "proxies": [p for p in th["proxies"] if p["t"] in used[tid]],
            }
            if tid in skipped:
                t["skipped"] = by_id[skipped[tid]]["name"]
            if prev:
                if t["topRank"]:
                    t["prevRank"] = prev_top.get(tid)  # None = new in the top 5
                t["prevAllRank"] = prev_all.get(tid)
            frozen.append(t)

        state = {
            "quarter": q_label(y, q), "key": q_key(y, q), "start": qs.isoformat(),
            "end": qe.isoformat(), "asOf": asof_ts.date().isoformat(),
            "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z",
            "method": {"weights": weights, "news": news_ok, "macro": macro_ok,
                       "newsSource": {"gdelt": "GDELT", "rss": "Google News"}.get(_SOURCE or "") if news_ok else None,
                       "corrMax": CORR_MAX, "universe": len(frozen)},
            "used": used, "themes": frozen,
        }
        state_file.write_text(json.dumps(state, indent=1))
        log("outlook frozen:", [t["name"] for t in frozen if t["topRank"]])

        # ---------------- close the previous quarter in the track record
        if prev:
            track_file = STATE / "track.json"
            track = json.loads(track_file.read_text()) if track_file.exists() else []
            if not any(r["key"] == prev["key"] for r in track):
                pidx, _ = build_indices(cfg, px, cal, pd.Timestamp(prev["asOf"]), fixed=prev["used"])
                p0 = pd.Timestamp(prev["asOf"])
                picks = []
                for t in sorted([t for t in prev["themes"] if t.get("topRank")], key=lambda t: t["topRank"]):
                    if t["id"] in pidx.columns:
                        s = pidx[t["id"]]
                        picks.append({"id": t["id"], "name": t["name"], "icon": t.get("icon", ""),
                                      "rank": t["topRank"],
                                      "ret": r1(100 * (s.loc[:asof_ts].iloc[-1] / s.loc[:p0].iloc[-1] - 1), 2)})
                world = r1(100 * (bench.loc[:asof_ts].iloc[-1] / bench.loc[:p0].iloc[-1] - 1), 2)
                avg = r1(sum(p["ret"] for p in picks) / len(picks), 2) if picks else None
                track.append({"key": prev["key"], "quarter": prev["quarter"], "start": prev["start"],
                              "end": prev["end"], "picks": picks, "avg": avg, "world": world})
                track_file.write_text(json.dumps(track, indent=1))
                log("track record: closed", prev["quarter"], "avg", avg, "world", world)

    # ---------------- dynamic fields (every run)
    idx, _ = build_indices(cfg, px, cal, pd.Timestamp(state["asOf"]), fixed=state["used"])
    a_ts = pd.Timestamp(state["asOf"])
    themes = []
    for t in state["themes"]:
        if t["id"] not in idx.columns:
            continue
        p = idx[t["id"]]
        perf, vs, since = dynamic_fields(p, bench, a_ts, last_ts)
        spark = weekly_spark(p, last_ts)
        themes.append({**t, "perf": perf, "vsWorld": vs, "since": since, "spark": spark})

    # weekly News Watch for the Top 5 (picks stay frozen; this only flags the news)
    by_cfg = {th["id"]: th for th in cfg["themes"]}
    picks = [by_cfg.get(t["id"], {"id": t["id"], "name": t["name"]})
             for t in sorted(themes, key=lambda t: t.get("topRank") or 99) if t.get("topRank")]
    watch, watch_src = {}, None
    try:
        watch, watch_src = news_watch(picks, today)
    except Exception as e:  # noqa: BLE001
        log("news watch failed:", e)
    for t in themes:
        if t["id"] in watch:
            t["newsWatch"] = watch[t["id"]]

    wspark = weekly_spark(bench, last_ts)
    wk_dates = bench[bench.index <= last_ts].resample("W-FRI").last().dropna().index[-53:]
    spark_start = int(sum(1 for d in wk_dates if d < a_ts))

    track_file = STATE / "track.json"
    track = json.loads(track_file.read_text()) if track_file.exists() else []
    cum = None
    if track:
        pc = np.prod([1 + (r["avg"] or 0) / 100 for r in track]) - 1
        wc = np.prod([1 + (r["world"] or 0) / 100 for r in track]) - 1
        cum = {"quarters": len(track), "picks": r1(100 * pc, 2), "world": r1(100 * wc, 2),
               "from": track[0]["quarter"]}

    ny, nq = q_next(y, q)
    feed = {
        "sample": False,
        "quarter": state["quarter"], "start": state["start"], "end": state["end"],
        "asOf": state["asOf"], "updated": last_ts.date().isoformat(),
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z",
        "nextOutlook": q_start(ny, nq).isoformat(),
        "regime": regime_now(bench, fred, last_ts),
        "world": {"name": cfg["benchmark"]["n"], "ticker": bench_t,
                  "since": r1(100 * (bench.loc[:last_ts].iloc[-1] / bench.loc[:a_ts].iloc[-1] - 1), 2),
                  "perf": {k: r1(100 * ret(bench[bench.index <= last_ts], n)) for k, n in TD.items()},
                  "spark": wspark},
        "sparkStart": spark_start,
        "method": state["method"],
        "themes": themes,
        "track": {"last": track[-1] if track else None, "history": track, "cumulative": cum},
        "newsWeek": {"from": (today - dt.timedelta(days=7)).isoformat(), "to": today.isoformat(),
                     "source": watch_src} if watch else None,
        "sources": ", ".join(["Yahoo Finance"] + sorted({x for x in (
            state["method"].get("newsSource"), watch_src) if x})),
    }
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(feed, separators=(",", ":"), allow_nan=False))
    tmp.replace(OUT)
    log("written", OUT, f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        log("FAILED:", repr(e))
        raise
