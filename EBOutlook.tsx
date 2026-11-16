import * as React from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"

/**
 * EB Outlook — Economic Bearings
 * Investment Outlook: the 5 strongest investment themes of the quarter,
 * ranked by the EB Outlook Method. Same editorial look as EB Monitor:
 * flat beige page, serif titles and numbers, sans-serif text, thin rules,
 * ▲ green / ▼ red, blue text tabs.
 *
 * Three views: Top 5 Themes · All Themes · Track Record.
 * Click a theme to open its full analysis (chart, performance, EB Score, risks).
 *
 * Data: one JSON file published by the EB Outlook engine. New outlook every
 * quarter (Jan 1, Apr 1, Jul 1, Oct 1); performance refreshed weekly.
 * Leave "Data URL" empty to see the built-in SAMPLE data (illustrative numbers).
 * No cookies, no third-party scripts, no API key.
 *
 * @framerIntrinsicWidth 1200
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight auto
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Tone = "up" | "dn" | "flat"
type Pillar = { key: string; label: string; score: number | null; weight?: number }
type Perf = { m1?: number | null; m3?: number | null; m6?: number | null; m12?: number | null }
type Risk = {
    level: "low" | "medium" | "high"
    vol?: number | null
    mdd?: number | null
    beta?: number | null
    worstMonth?: number | null
    dist200?: number | null
    corr?: number | null
}
type Headline = { t: string; url?: string; src?: string; date?: string; tone?: Tone }
type NewsWatch = {
    status: "positive" | "neutral" | "negative"
    recent?: number | null
    base?: number | null
    buzz?: number | null
    rising?: boolean
    n?: number
    headlines?: Headline[]
}
type Theme = {
    id: string
    name: string
    category?: string
    icon?: string
    rank: number
    topRank?: number | null
    prevRank?: number | null
    prevAllRank?: number | null
    score: number
    pillars: Pillar[]
    risk?: Risk
    tags?: { t: string; tone?: Tone }[]
    watch?: { t: string; now?: Tone }[]
    notes?: string[]
    proxies?: { t: string; n?: string }[]
    perf?: Perf
    vsWorld?: Perf
    since?: number | null
    spark?: number[]
    skipped?: string
    newsWatch?: NewsWatch
}
type TrackQ = {
    key: string
    quarter: string
    start?: string
    end?: string
    picks: { id: string; name: string; icon?: string; rank: number; ret: number | null }[]
    avg: number | null
    world: number | null
}
type Feed = {
    sample?: boolean
    quarter: string
    start: string
    end: string
    asOf?: string
    updated?: string
    nextOutlook?: string
    regime?: { label: string; score?: number; note?: string }
    world?: { name?: string; ticker?: string; since?: number | null; perf?: Perf; spark?: number[] }
    sparkStart?: number
    newsWeek?: { from: string; to: string; source?: string | null } | null
    method?: { weights?: Record<string, number>; universe?: number; news?: boolean; macro?: boolean }
    themes: Theme[]
    track?: {
        last?: TrackQ | null
        history?: TrackQ[]
        cumulative?: { quarters: number; picks: number | null; world: number | null; from?: string } | null
    }
    sources?: string
}
type View = "top" | "all" | "track"
type Layout = "carousel" | "row" | "spotlight" | "ranking"

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isNum = (v: any): v is number => typeof v === "number" && isFinite(v)

const fam = (f: any, fallback: string) =>
    f && f.fontFamily ? '"' + String(f.fontFamily).replace(/"/g, "") + '",' + fallback : ""

const DAY = 86400000
const utc = (iso?: string) => {
    if (!iso) return null
    const d = new Date(/T/.test(iso) ? iso : iso + "T00:00:00Z")
    return isFinite(d.getTime()) ? d : null
}
const fmtDay = (iso?: string, year = false) => {
    const d = utc(iso)
    if (!d) return ""
    try {
        return d.toLocaleDateString("en-US", {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
            ...(year ? { year: "numeric" } : {}),
        })
    } catch {
        return iso || ""
    }
}
const countdown = (ms: number) => {
    if (ms <= 0) return ""
    const m = Math.floor(ms / 60000)
    const d = Math.floor(m / 1440)
    const h = Math.floor((m % 1440) / 60)
    const mm = m % 60
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`
}
const tone = (v?: number | null, eps = 0.005): Tone =>
    !isNum(v) || Math.abs(v) < eps ? "flat" : v > 0 ? "up" : "dn"

const fill = (s: string, o: Record<string, string | number>) =>
    String(s || "").replace(/\{(\w+)\}/g, (m, k) => (k in o ? String(o[k]) : m))

function useNow(enabled: boolean, every = 60000) {
    const [now, setNow] = React.useState<Date>(() => new Date())
    React.useEffect(() => {
        if (!enabled) return
        setNow(new Date())
        const id = setInterval(() => setNow(new Date()), every)
        return () => clearInterval(id)
    }, [enabled, every])
    return now
}

/* ---------- Data ---------- */

function useFeed(url: string) {
    const [feed, setFeed] = React.useState<Feed | null>(url ? null : SAMPLE)
    const [state, setState] = React.useState<"sample" | "loading" | "ok" | "error">(
        url ? "loading" : "sample"
    )
    React.useEffect(() => {
        if (!url) {
            setFeed(SAMPLE)
            setState("sample")
            return
        }
        let dead = false
        let have = false
        const KEY = "ebo_feed_v1|" + url
        try {
            const c = JSON.parse(window.localStorage.getItem(KEY) || "null")
            if (c && c.feed && Array.isArray(c.feed.themes)) {
                setFeed(c.feed)
                setState("ok")
                have = true
            }
        } catch {}
        const load = () =>
            fetch(url, { cache: "no-cache" })
                .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
                .then((j: Feed) => {
                    if (dead) return
                    if (!j || !Array.isArray(j.themes)) throw new Error("bad data")
                    setFeed(j)
                    setState("ok")
                    have = true
                    try {
                        window.localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), feed: j }))
                    } catch {}
                })
                .catch(() => {
                    if (!dead && !have) setState("error")
                })
        if (!have) setState("loading")
        load()
        const id = setInterval(load, 30 * 60 * 1000)
        return () => {
            dead = true
            clearInterval(id)
        }
    }, [url])
    return { feed, state }
}

/* ------------------------------------------------------------------ */
/* Small parts                                                         */
/* ------------------------------------------------------------------ */

const initials = (name: string) =>
    String(name || "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("") || "?"

function Icon({ name, icon, size }: { name: string; icon?: string; size: number }) {
    const svg = icon ? ICONS[icon] : ""
    return (
        <span className="ebo-mark" style={{ width: size, height: size }} aria-hidden>
            {svg ? (
                <svg
                    viewBox="0 0 24 24"
                    width={Math.round(size * 0.56)}
                    height={Math.round(size * 0.56)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            ) : (
                <span style={{ fontSize: Math.max(10, size * 0.38) }}>{initials(name)}</span>
            )}
        </span>
    )
}

function Move({
    rank,
    prev,
    tx,
}: {
    rank: number
    prev: number | null | undefined
    tx: Record<string, string>
}) {
    if (prev === undefined) return null
    if (prev === null) return <span className="ebo-move up">{tx.moveNew}</span>
    if (prev === rank) return <span className="ebo-move flat">{tx.moveHeld}</span>
    const up = prev > rank
    return (
        <span className={"ebo-move " + (up ? "up" : "dn")}>
            {up ? "▲" : "▼"} {tx.moveFrom.replace("{n}", String(prev))}
        </span>
    )
}

function Pct({ v, unit = "%", digits = 1, bare }: { v?: number | null; unit?: string; digits?: number; bare?: boolean }) {
    if (!isNum(v)) return <span className="ebo-pct flat">—</span>
    const t = tone(v, Math.pow(10, -digits) / 2)
    const a = Math.abs(v).toFixed(digits)
    return (
        <span className={"ebo-pct " + t}>
            {bare ? (v < 0 ? "−" : "+") : t === "up" ? "▲ " : t === "dn" ? "▼ " : ""}
            {a}
            {unit === "pt" ? " pt" : unit}
        </span>
    )
}

// Hairline meter: thin rule, ink line up to the score, small dot at the score.
// Rounded bar, same as the Dashboard: green 60+, amber 40–59, red under 40.
function Meter({ v, size = "sm", mid, plain }: { v: number; size?: "sm" | "lg"; mid?: boolean; plain?: boolean }) {
    const x = Math.max(0, Math.min(100, Number(v) || 0))
    const c = plain ? "ink" : x >= 60 ? "up" : x >= 40 ? "mid" : "dn"
    return (
        <span className={"ebo-meter is-" + size + (mid ? " has-mid" : "")} aria-hidden>
            <i className={c} style={{ width: x + "%" }} />
        </span>
    )
}

function Bar({ p }: { p: Pillar }) {
    const v = Math.max(0, Math.min(100, Number(p.score) || 0))
    return (
        <div className="ebo-bar">
            <span className="ebo-barlab">{p.label}</span>
            <Meter v={v} />
            <span className="num">{isNum(p.score) ? Math.round(v) : "—"}</span>
        </div>
    )
}

function RiskDots({ level, tx, label = true }: { level?: string; tx: Record<string, string>; label?: boolean }) {
    const n = level === "low" ? 1 : level === "medium" ? 2 : level === "high" ? 3 : 0
    if (!n) return <span className="ebo-meta">—</span>
    const t = n === 1 ? "up" : n === 3 ? "dn" : "mid"
    const txt = n === 1 ? tx.riskLow : n === 2 ? tx.riskMedium : tx.riskHigh
    return (
        <span className="ebo-risk" aria-label={tx.riskLabel + ": " + txt}>
            <span className={"ebo-dots " + t} aria-hidden>
                {[1, 2, 3].map((i) => (
                    <i key={i} className={i <= n ? "on" : ""} />
                ))}
            </span>
            {label && <span className={"ebo-risktxt " + t}>{txt}</span>}
        </span>
    )
}

function Tags({ tags, max = 3 }: { tags?: { t: string; tone?: Tone }[]; max?: number }) {
    if (!tags || !tags.length) return null
    return (
        <div className="ebo-tags">
            {tags.slice(0, max).map((g) => (
                <span className="ebo-tag" key={g.t}>
                    <i className={g.tone || "flat"} />
                    {g.t}
                </span>
            ))}
        </div>
    )
}

function NewsBadge({ w, tx, rising = true }: { w?: NewsWatch; tx: Record<string, string>; rising?: boolean }) {
    if (!w) return <span className="ebo-meta">—</span>
    const t: Tone = w.status === "positive" ? "up" : w.status === "negative" ? "dn" : "flat"
    const lab = w.status === "positive" ? tx.newsPositive : w.status === "negative" ? tx.newsNegative : tx.newsNeutral
    return (
        <span className="ebo-news">
            <i className={t} aria-hidden />
            <span className={"ebo-newstxt " + t}>{lab}</span>
            {rising && w.rising && <span className="ebo-rising">· {tx.rising}</span>}
        </span>
    )
}

// Sparkline: theme (ink) and world (muted, dashed), both rebased to 100,
// with a thin tick where the outlook started.
function Spark({
    values,
    world,
    start,
    height = 34,
    labels,
}: {
    values?: number[]
    world?: number[]
    start?: number
    height?: number
    labels?: boolean
}) {
    if (!values || values.length < 2) return null
    const n = values.length
    const w = world && world.length === n ? world : undefined
    const all = w ? values.concat(w) : values
    let lo = Math.min(...all)
    let hi = Math.max(...all)
    if (hi - lo < 1e-6) {
        hi += 1
        lo -= 1
    }
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
    const W = 100
    const x = (i: number) => (i / (n - 1)) * W
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height
    const pts = (a: number[]) => a.map((v, i) => x(i).toFixed(2) + "," + y(v).toFixed(2)).join(" ")
    const s = isNum(start) && start > 0 && start < n ? start : null
    const base = y(100)
    return (
        <div className={"ebo-spark" + (labels ? " has-lab" : "")} style={{ height }}>
            <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
                {base > 0 && base < height && (
                    <line x1="0" x2={W} y1={base} y2={base} className="ebo-sp-base" vectorEffect="non-scaling-stroke" />
                )}
                {s !== null && (
                    <line x1={x(s)} x2={x(s)} y1="0" y2={height} className="ebo-sp-start" vectorEffect="non-scaling-stroke" />
                )}
                {w && <polyline points={pts(w)} className="ebo-sp-world" vectorEffect="non-scaling-stroke" />}
                <polyline points={pts(values)} className="ebo-sp-line" vectorEffect="non-scaling-stroke" />
            </svg>
            {labels && (
                <>
                    <span className="ebo-sp-hi">{Math.round(hi - pad)}</span>
                    <span className="ebo-sp-lo">{Math.round(lo + pad)}</span>
                </>
            )}
        </div>
    )
}

function Tabs({
    items,
    value,
    onPick,
    label,
}: {
    items: { v: string; t: string }[]
    value: string
    onPick: (v: any) => void
    label: string
}) {
    return (
        <div className="ebo-tabs" role="group" aria-label={label}>
            {items.map((it, i) => (
                <React.Fragment key={it.v}>
                    {i > 0 && <span className="ebo-sep">|</span>}
                    <button type="button" aria-pressed={value === it.v} onClick={() => onPick(it.v)}>
                        {it.t}
                    </button>
                </React.Fragment>
            ))}
        </div>
    )
}

function Chevron({ dir }: { dir: "left" | "right" | "down" | "up" }) {
    const d =
        dir === "left"
            ? "M6.5 1.5 L3 5 L6.5 8.5"
            : dir === "right"
              ? "M3.5 1.5 L7 5 L3.5 8.5"
              : dir === "up"
                ? "M1.5 6.5 L5 3 L8.5 6.5"
                : "M1.5 3.5 L5 7 L8.5 3.5"
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

const pickable = (on: () => void, pressed: boolean) => ({
    onClick: on,
    onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            on()
        }
    },
    tabIndex: 0,
    role: "button",
    "aria-expanded": pressed,
})

/* ------------------------------------------------------------------ */
/* Card, carousel, tables                                              */
/* ------------------------------------------------------------------ */

type Ctx = { feed: Feed; tx: Record<string, string>; p: any; since: string }

function Card({ t, sel, onPick, big, c }: { t: Theme; sel: boolean; onPick: () => void; big?: boolean; c: Ctx }) {
    const { tx, p, feed } = c
    const bars = Math.max(0, Math.min(6, Number(p.cardBars) || 0))
    const ps = (t.pillars || []).slice(0, big ? 99 : bars)
    const r = t.topRank || t.rank
    const icon = Math.max(24, Math.min(64, Number(p.iconSize) || 36))
    return (
        <article
            className={"ebo-card is-click" + (sel ? " is-sel" : "") + (big ? " is-big" : "")}
            {...pickable(onPick, sel)}
            aria-label={`${r}. ${t.name}, EB Score ${t.score}`}
        >
            <div className="ebo-ctop">
                <span className="ebo-rank">{r}</span>
                <Move rank={r} prev={t.prevRank} tx={tx} />
            </div>
            <div className="ebo-id">
                <Icon name={t.name} icon={t.icon} size={big ? icon + 8 : icon} />
                <div className="ebo-idtxt">
                    <div className="ebo-name">{t.name}</div>
                    {t.category && <div className="ebo-sub">{t.category}</div>}
                </div>
            </div>
            <div className="ebo-scorerow">
                <span className="ebo-lab">{tx.score}</span>
                <span className="ebo-score">
                    {Math.round(t.score)}
                    <small> /100</small>
                </span>
            </div>
            {p.showSpark !== false && (
                <Spark values={t.spark} world={feed.world?.spark} start={feed.sparkStart} height={big ? 48 : 34} />
            )}
            {ps.length > 0 && (
                <div className="ebo-bars">
                    {ps.map((x) => (
                        <Bar key={x.key} p={x} />
                    ))}
                </div>
            )}
            {p.showRisk !== false && t.risk && (
                <div className="ebo-kv">
                    <span className="ebo-lab">{tx.riskLabel}</span>
                    <RiskDots level={t.risk.level} tx={tx} />
                </div>
            )}
            <div className="ebo-kv">
                <span className="ebo-lab">{c.since}</span>
                <Pct v={t.since} digits={1} />
            </div>
            {p.showNews !== false && t.newsWatch && (
                <div className="ebo-kv">
                    <span className="ebo-lab">{tx.newsLabel}</span>
                    <NewsBadge w={t.newsWatch} tx={tx} rising={false} />
                </div>
            )}
            {p.showTags !== false && <Tags tags={t.tags} />}
            <span className="ebo-open">
                {sel ? tx.close : tx.open}
                <Chevron dir={sel ? "up" : "down"} />
            </span>
        </article>
    )
}

function Track({
    count,
    visible,
    arrows,
    children,
    tx,
    toolbar,
}: {
    count: number
    visible: number
    arrows: boolean
    children: React.ReactNode[]
    tx: Record<string, string>
    toolbar?: React.ReactNode
}) {
    const ref = React.useRef<HTMLDivElement>(null)
    const [pos, setPos] = React.useState({ first: 1, last: Math.min(visible, count) })
    const update = React.useCallback(() => {
        const el = ref.current
        if (!el) return
        const kids = Array.from(el.children) as HTMLElement[]
        const L = el.scrollLeft
        const R = L + el.clientWidth
        let first = 0
        let last = 0
        kids.forEach((k, i) => {
            const a = k.offsetLeft
            const b = a + k.offsetWidth
            if (a >= L - 4 && b <= R + 4) {
                if (!first) first = i + 1
                last = i + 1
            }
        })
        if (!first) {
            first = 1
            last = 1
        }
        setPos((p) => (p.first === first && p.last === last ? p : { first, last }))
    }, [])
    React.useEffect(() => {
        update()
        const el = ref.current
        if (!el || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [count, update])
    const go = (dir: number) => {
        const el = ref.current
        if (!el) return
        const kids = Array.from(el.children) as HTMLElement[]
        const step = kids.length > 1 ? kids[1].offsetLeft - kids[0].offsetLeft : el.clientWidth
        let reduce = false
        try {
            reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        } catch {}
        el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" })
    }
    const all = pos.first <= 1 && pos.last >= count
    return (
        <div className="ebo-carousel">
            <div className="ebo-toolbar">
                {toolbar || <span />}
                {arrows && !all && (
                    <div className="ebo-nav">
                        <span className="ebo-count">
                            {tx.showing
                                .replace("{a}", String(pos.first))
                                .replace("{b}", String(pos.last))
                                .replace("{n}", String(count))}
                        </span>
                        <button type="button" className="ebo-arrow" aria-label={tx.prev} data-off={pos.first <= 1 || undefined} onClick={() => go(-1)}>
                            <Chevron dir="left" />
                        </button>
                        <button type="button" className="ebo-arrow" aria-label={tx.next} data-off={pos.last >= count || undefined} onClick={() => go(1)}>
                            <Chevron dir="right" />
                        </button>
                    </div>
                )}
            </div>
            <div className="ebo-track" ref={ref} onScroll={update} style={{ ["--vis" as any]: visible }}>
                {children.map((ch, i) => (
                    <div className="ebo-slot" key={i}>
                        {ch}
                    </div>
                ))}
            </div>
        </div>
    )
}

function ThemeTable({
    items,
    selId,
    onPick,
    c,
    mode,
    compact,
}: {
    items: Theme[]
    selId: string | null
    onPick: (t: Theme) => void
    c: Ctx
    mode: "top" | "all"
    compact?: boolean
}) {
    const { tx, p } = c
    const icon = Math.round(Math.max(24, Math.min(64, Number(p.iconSize) || 36)) * 0.7)
    const heads = (items[0]?.pillars || []).slice(0, 3)
    const showNews = mode === "top" && p.showNews !== false && items.some((t) => t.newsWatch)
    return (
        <table className={"ebo-tbl" + (compact ? " is-compact" : "")}>
            <thead>
                <tr>
                    <th className="c-rank">#</th>
                    <th>{tx.theme}</th>
                    <th className="c-score">{tx.score}</th>
                    {!compact &&
                        heads.map((h) => (
                            <th key={h.key} className="r c-pil">
                                {h.label}
                            </th>
                        ))}
                    {!compact && <th className="c-risk">{tx.riskLabel}</th>}
                    {!compact && showNews && <th className="c-news">{tx.newsLabel}</th>}
                    <th className="r c-since">{c.since}</th>
                    {!compact && <th className="r c-move">{tx.vsLast}</th>}
                </tr>
            </thead>
            <tbody>
                {items.map((t) => {
                    const sel = selId === t.id
                    const r = mode === "top" ? t.topRank || t.rank : t.rank
                    return (
                        <tr key={t.id} className={"is-click" + (sel ? " is-sel" : "") + (mode === "all" && t.topRank ? " is-top" : "")} {...pickable(() => onPick(t), sel)}>
                            <td className="c-rank num">{r}</td>
                            <td>
                                <span className="ebo-tname">
                                    <Icon name={t.name} icon={t.icon} size={icon} />
                                    <span className="ebo-tnw">
                                        <span className="ebo-tn">
                                            {t.name}
                                            {mode === "all" && t.topRank ? <span className="ebo-badge">{tx.topBadge}</span> : null}
                                        </span>
                                        <span className="ebo-sub">
                                            {mode === "all" && t.skipped ? fill(tx.skippedNote, { name: t.skipped }) : t.category}
                                        </span>
                                    </span>
                                </span>
                            </td>
                            <td className="c-score">
                                <span className="ebo-tscore">
                                    <span className="num">{Math.round(t.score)}</span>
                                    <Meter v={t.score} />
                                </span>
                            </td>
                            {!compact &&
                                heads.map((h) => {
                                    const x = (t.pillars || []).find((y) => y.key === h.key)
                                    return (
                                        <td key={h.key} className="r num c-pil">
                                            {x && isNum(x.score) ? Math.round(x.score) : "—"}
                                        </td>
                                    )
                                })}
                            {!compact && (
                                <td className="c-risk">
                                    <RiskDots level={t.risk?.level} tx={tx} />
                                </td>
                            )}
                            {!compact && showNews && (
                                <td className="c-news">
                                    <NewsBadge w={t.newsWatch} tx={tx} rising={false} />
                                </td>
                            )}
                            <td className="r c-since">
                                <Pct v={t.since} />
                            </td>
                            {!compact && (
                                <td className="r c-move">
                                    <Move rank={r} prev={mode === "top" ? t.prevRank : t.prevAllRank} tx={tx} />
                                </td>
                            )}
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}

/* ------------------------------------------------------------------ */
/* Detail panel (full analysis)                                        */
/* ------------------------------------------------------------------ */

function Detail({ t, onClose, c }: { t: Theme; onClose: () => void; c: Ctx }) {
    const { tx, p, feed } = c
    const [tab, setTab] = React.useState("overview")
    React.useEffect(() => setTab("overview"), [t.id])
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
        const el = ref.current
        if (!el || p.scrollToDetail === false) return
        const r = el.getBoundingClientRect()
        const vh = window.innerHeight || 800
        if (r.top < 0 || r.top > vh * 0.75) {
            try {
                el.scrollIntoView({ behavior: "smooth", block: "nearest" })
            } catch {}
        }
    }, [t.id])
    React.useEffect(() => {
        if (tab === "news" && !t.newsWatch) setTab("overview")
    }, [t.id])
    const n = feed.method?.universe || feed.themes.length
    const TABS = [
        { v: "overview", t: tx.tOverview },
        { v: "score", t: tx.tScore },
        { v: "risks", t: tx.tRisks },
        ...(t.newsWatch ? [{ v: "news", t: tx.tNews }] : []),
    ]
    const perfRows: [keyof Perf, string][] = [
        ["m1", tx.p1m],
        ["m3", tx.p3m],
        ["m6", tx.p6m],
        ["m12", tx.p12m],
    ]
    const rk = t.risk
    const riskRows: { k: string; v: React.ReactNode; note: string }[] = rk
        ? [
              { k: tx.rVol, v: isNum(rk.vol) ? rk.vol.toFixed(1) + "%" : "—", note: tx.gVol },
              { k: tx.rMdd, v: <Pct v={rk.mdd} bare />, note: tx.gMdd },
              { k: tx.rWorst, v: <Pct v={rk.worstMonth} bare />, note: tx.gWorst },
              { k: tx.rBeta, v: isNum(rk.beta) ? rk.beta.toFixed(2) : "—", note: tx.gBeta },
              { k: tx.rDist, v: <Pct v={rk.dist200} bare />, note: tx.gDist },
              { k: tx.rCorr, v: isNum(rk.corr) ? rk.corr.toFixed(2) : "—", note: tx.gCorr },
          ]
        : []
    return (
        <div className="ebo-detail" ref={ref} aria-live="polite">
            <div className="ebo-dhead">
                <div className="ebo-dhl">
                    <Icon name={t.name} icon={t.icon} size={44} />
                    <div>
                        <h4 className="ebo-dname">{t.name}</h4>
                        <div className="ebo-caps">
                            {[t.category, fill(tx.rankOf, { r: t.rank, n }), feed.quarter].filter(Boolean).join(" · ")}
                        </div>
                    </div>
                </div>
                <div className="ebo-dhr">
                    <div className="ebo-hval">
                        <Pct v={t.since} digits={2} />
                    </div>
                    <div className="ebo-caps">
                        {c.since}
                        {isNum(feed.world?.since) && (
                            <>
                                {" · "}
                                {tx.world} <Pct v={feed.world!.since} digits={2} />
                            </>
                        )}
                    </div>
                </div>
            </div>
            <div className="ebo-dtabs">
                <Tabs label={tx.analysis} value={tab} onPick={setTab} items={TABS} />
                <button type="button" className="ebo-x" onClick={onClose} aria-label={tx.close}>
                    ×
                </button>
            </div>

            {tab === "overview" && (
                <div className="ebo-dgrid">
                    <div className="ebo-dleft">
                        <div className="ebo-row">
                            <span className="ebo-caps">{tx.chartTitle}</span>
                            <span className="ebo-legend">
                                <span>
                                    <i className="l-theme" />
                                    {tx.legendTheme}
                                </span>
                                {feed.world?.spark && (
                                    <span>
                                        <i className="l-world" />
                                        {tx.world}
                                    </span>
                                )}
                                {isNum(feed.sparkStart) && (
                                    <span>
                                        <i className="l-start" />
                                        {fill(tx.legendStart, { q: feed.quarter })}
                                    </span>
                                )}
                            </span>
                        </div>
                        <Spark values={t.spark} world={feed.world?.spark} start={feed.sparkStart} height={150} labels />
                        {t.proxies && t.proxies.length > 0 && (
                            <div className="ebo-proxies">
                                <div className="ebo-caps">{tx.measured}</div>
                                <table className="ebo-mini">
                                    <tbody>
                                        {t.proxies.map((x) => (
                                            <tr key={x.t}>
                                                <td className="num">{x.t}</td>
                                                <td className="r">{x.n || ""}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div className="ebo-dright">
                        <div className="ebo-row">
                            <span className="ebo-caps">{tx.performance}</span>
                            <span className="ebo-meta">{fill(tx.perfTo, { d: fmtDay(feed.updated) })}</span>
                        </div>
                        <div className="ebo-metrics">
                            {perfRows.map(([k, lab]) => (
                                <div className="ebo-m" key={k}>
                                    <span>
                                        <span className="ebo-mlab">{lab}</span>
                                        <span className="ebo-msub">
                                            {tx.vsWorld} <Pct v={t.vsWorld?.[k]} unit="pt" />
                                        </span>
                                    </span>
                                    <span className="ebo-mval">
                                        <span className="ebo-mnum">
                                            <Pct v={t.perf?.[k]} bare />
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                        {t.tags && t.tags.length > 0 && (
                            <div className="ebo-sig">
                                <div className="ebo-caps">{tx.signals}</div>
                                <Tags tags={t.tags} max={6} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === "score" && (
                <div className="ebo-dgrid">
                    <div className="ebo-dleft">
                        <div className="ebo-caps">{tx.score}</div>
                        <div className="ebo-bigscore">
                            {Math.round(t.score)}
                            <small> /100</small>
                        </div>
                        <p className="ebo-bio">{tx.scoreHint}</p>
                        {t.skipped && <p className="ebo-bio ebo-skip">{fill(tx.skippedLong, { name: t.skipped })}</p>}
                    </div>
                    <div className="ebo-dright">
                        <div className="ebo-row">
                            <span className="ebo-caps">{tx.pillars}</span>
                            <span className="ebo-meta">{tx.weight}</span>
                        </div>
                        <div className="ebo-pillars">
                            {(t.pillars || []).map((pl) => (
                                <div className="ebo-pil" key={pl.key}>
                                    <div className="ebo-pilhead">
                                        <span>{pl.label}</span>
                                        <span className="ebo-meta">{isNum(pl.weight) ? pl.weight + "%" : ""}</span>
                                    </div>
                                    <div className="ebo-pilbar">
                                        <Meter v={pl.score || 0} size="lg" mid />
                                        <span className="num">{isNum(pl.score) ? Math.round(pl.score) : "—"}</span>
                                    </div>
                                    {PILLAR_INFO[pl.key] && <div className="ebo-msub">{PILLAR_INFO[pl.key]}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === "risks" && (
                <div className="ebo-dgrid">
                    <div className="ebo-dleft">
                        <div className="ebo-caps">{tx.riskLevel}</div>
                        <div className="ebo-bigrisk">
                            <RiskDots level={rk?.level} tx={tx} />
                        </div>
                        <p className="ebo-bio">{tx.riskHint}</p>
                        {t.notes && t.notes.length > 0 && (
                            <ul className="ebo-notes">
                                {t.notes.map((x, i) => (
                                    <li key={i}>{x}</li>
                                ))}
                            </ul>
                        )}
                        {t.watch && t.watch.length > 0 && (
                            <div className="ebo-watch">
                                <div className="ebo-caps">{tx.macroWatch}</div>
                                {t.watch.map((w, i) => (
                                    <div className="ebo-w" key={i}>
                                        <span>{w.t}</span>
                                        {w.now && w.now !== "flat" && (
                                            <span className={"ebo-wnow " + w.now}>{w.now === "up" ? tx.nowTail : tx.nowHead}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="ebo-dright">
                        <div className="ebo-row">
                            <span className="ebo-caps">{tx.riskMetrics}</span>
                            <span className="ebo-meta">{tx.past12m}</span>
                        </div>
                        <table className="ebo-tbl ebo-fintbl">
                            <tbody>
                                {riskRows.map((r) => (
                                    <tr key={r.k}>
                                        <td>{r.k}</td>
                                        <td className="r num">{r.v}</td>
                                        <td className="c-note">{r.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {tab === "news" && t.newsWatch && (
                <div className="ebo-dgrid">
                    <div className="ebo-dleft">
                        <div className="ebo-caps">{tx.newsLabel}</div>
                        <div className="ebo-bignews">
                            <NewsBadge w={t.newsWatch} tx={tx} rising={false} />
                        </div>
                        <div className="ebo-meta ebo-newsmeta">
                            {feed.newsWeek
                                ? fill(tx.newsMeta, { a: fmtDay(feed.newsWeek.from), b: fmtDay(feed.newsWeek.to), n: t.newsWatch.n || 0 })
                                : ""}
                            {t.newsWatch.rising && <span className="ebo-rising"> · {tx.rising}</span>}
                        </div>
                        <p className="ebo-bio">{tx.newsHint}</p>
                    </div>
                    <div className="ebo-dright">
                        <div className="ebo-row">
                            <span className="ebo-caps">{tx.headlines}</span>
                            {feed.newsWeek?.source && (
                                <span className="ebo-meta">{fill(tx.newsSource, { s: feed.newsWeek.source })}</span>
                            )}
                        </div>
                        {t.newsWatch.headlines && t.newsWatch.headlines.length ? (
                            <div className="ebo-heads">
                                {t.newsWatch.headlines.map((h, i) => (
                                    <div className="ebo-head1" key={i}>
                                        <i className={h.tone || "flat"} aria-hidden />
                                        <span>
                                            {h.url ? (
                                                <a className="ebo-hlink" href={h.url} target="_blank" rel="noopener noreferrer">
                                                    {h.t}
                                                </a>
                                            ) : (
                                                <span className="ebo-hlink">{h.t}</span>
                                            )}
                                            <span className="ebo-msub">{[h.src, fmtDay(h.date)].filter(Boolean).join(" · ")}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="ebo-note">{tx.noHeadlines}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function TopSection({ c, layout }: { c: Ctx; layout: Layout }) {
    const { feed, tx, p } = c
    const [view, setView] = React.useState<Layout>(layout)
    React.useEffect(() => setView(layout), [layout])
    const [selId, setSelId] = React.useState<string | null>(null)
    const items = feed.themes.filter((t) => t.topRank).sort((a, b) => (a.topRank || 0) - (b.topRank || 0))
    const sel = items.find((t) => t.id === selId) || null
    const toggle = (t: Theme) => setSelId((s) => (s === t.id ? null : t.id))
    const vis = Math.max(1, Math.min(5, Number(p.cardsVisible) || 3))
    const card = (t: Theme, big?: boolean) => (
        <Card key={t.id} t={t} sel={selId === t.id} onPick={() => toggle(t)} big={big} c={c} />
    )
    const switchItems = [
        { v: layout === "ranking" ? "carousel" : layout, t: tx.viewCards },
        { v: "ranking", t: tx.viewRanking },
    ]
    const toolbar =
        p.readerSwitch !== false && items.length > 0 ? (
            <Tabs label={tx.view} value={view === "ranking" ? "ranking" : switchItems[0].v} onPick={(v) => setView(v)} items={switchItems} />
        ) : null
    const plain = toolbar ? <div className="ebo-toolbar">{toolbar}</div> : null

    let body: React.ReactNode
    if (!items.length) body = <p className="ebo-note">{tx.empty}</p>
    else if (view === "ranking")
        body = (
            <>
                {plain}
                <ThemeTable items={items} selId={selId} onPick={toggle} c={c} mode="top" />
            </>
        )
    else if (view === "spotlight")
        body = (
            <>
                {plain}
                <div className="ebo-spot">
                    <div className="ebo-spot-l">{card(items[0], true)}</div>
                    <div className="ebo-spot-r">
                        <ThemeTable items={items.slice(1)} selId={selId} onPick={toggle} c={c} mode="top" compact />
                    </div>
                </div>
            </>
        )
    else
        body = (
            <Track count={items.length} visible={view === "row" ? items.length : vis} arrows={view === "carousel"} tx={tx} toolbar={toolbar}>
                {items.map((t) => card(t))}
            </Track>
        )
    return (
        <section className="ebo-sec" id="top-themes" role="tabpanel">
            <div className="ebo-row ebo-sechead">
                <span className="ebo-meta">{fill(tx.topNote, { q: feed.quarter })}</span>
            </div>
            {body}
            {sel && <Detail t={sel} onClose={() => setSelId(null)} c={c} />}
        </section>
    )
}

function AllSection({ c }: { c: Ctx }) {
    const { feed, tx } = c
    const [cat, setCat] = React.useState("__all")
    const [sort, setSort] = React.useState("rank")
    const [selId, setSelId] = React.useState<string | null>(null)
    const cats = Array.from(new Set(feed.themes.map((t) => t.category).filter(Boolean))) as string[]
    let items = feed.themes.filter((t) => cat === "__all" || t.category === cat)
    items = [...items].sort((a, b) =>
        sort === "since" ? (isNum(b.since) ? b.since : -1e9) - (isNum(a.since) ? a.since : -1e9) : a.rank - b.rank
    )
    const sel = items.find((t) => t.id === selId) || null
    const toggle = (t: Theme) => setSelId((s) => (s === t.id ? null : t.id))
    return (
        <section className="ebo-sec" id="all-themes" role="tabpanel">
            <div className="ebo-row ebo-sechead">
                <span className="ebo-meta">{fill(tx.allNote, { n: feed.themes.length, q: feed.quarter })}</span>
            </div>
            <div className="ebo-toolbar">
                <Tabs
                    label={tx.category}
                    value={cat}
                    onPick={(v) => {
                        setCat(v)
                        setSelId(null)
                    }}
                    items={[{ v: "__all", t: tx.allCats }, ...cats.map((x) => ({ v: x, t: x }))]}
                />
                <Tabs
                    label={tx.sortBy}
                    value={sort}
                    onPick={setSort}
                    items={[
                        { v: "rank", t: tx.sortScore },
                        { v: "since", t: c.since },
                    ]}
                />
            </div>
            {items.length ? (
                <ThemeTable items={items} selId={selId} onPick={toggle} c={c} mode="all" />
            ) : (
                <p className="ebo-note">{tx.empty}</p>
            )}
            {sel && <Detail t={sel} onClose={() => setSelId(null)} c={c} />}
        </section>
    )
}

function TrackSection({ c }: { c: Ctx }) {
    const { feed, tx, p } = c
    const icon = Math.round(Math.max(24, Math.min(64, Number(p.iconSize) || 36)) * 0.7)
    const top = feed.themes.filter((t) => t.topRank).sort((a, b) => (a.topRank || 0) - (b.topRank || 0))
    const nums = top.map((t) => t.since).filter(isNum)
    const avgNow = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    const w = feed.world?.since
    const hist = (feed.track?.history || []).slice().reverse()
    const last = feed.track?.last || null
    const cum = feed.track?.cumulative || null

    const Block = ({ title, note, avg, world, rows, live }: { title: string; note: string; avg: number | null; world?: number | null; rows: { id: string; name: string; icon?: string; rank: number; ret: number | null | undefined }[]; live?: boolean }) => {
        const beat = isNum(world) ? rows.filter((r) => isNum(r.ret) && r.ret! > world!).length : null
        return (
            <div className="ebo-tq">
                <div className="ebo-row">
                    <h3 className="ebo-h">{title}</h3>
                    <span className="ebo-meta">
                        {live && <span className="ebo-dot is-live" />}
                        {note}
                    </span>
                </div>
                <div className="ebo-tqsum">
                    <div>
                        <div className="ebo-caps">{tx.picksAvg}</div>
                        <div className="ebo-tqbig">
                            <Pct v={avg} digits={2} />
                        </div>
                    </div>
                    <div>
                        <div className="ebo-caps">{tx.world}</div>
                        <div className="ebo-tqbig">
                            <Pct v={world} digits={2} />
                        </div>
                    </div>
                    <div>
                        <div className="ebo-caps">{tx.difference}</div>
                        <div className="ebo-tqbig">
                            <Pct v={isNum(avg) && isNum(world) ? avg - world : null} unit="pt" digits={2} />
                        </div>
                    </div>
                    {beat !== null && (
                        <div>
                            <div className="ebo-caps">{tx.beatWorld}</div>
                            <div className="ebo-tqbig num">
                                {beat}
                                <small> {fill(tx.ofN, { n: rows.length })}</small>
                            </div>
                        </div>
                    )}
                </div>
                <table className="ebo-tbl is-compact">
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id}>
                                <td className="c-rank num">{r.rank}</td>
                                <td>
                                    <span className="ebo-tname">
                                        <Icon name={r.name} icon={r.icon} size={icon} />
                                        <span className="ebo-tn">{r.name}</span>
                                    </span>
                                </td>
                                <td className="r">
                                    <Pct v={r.ret} digits={2} />
                                </td>
                                <td className="r c-pil">
                                    {isNum(r.ret) && isNum(world) ? <Pct v={r.ret - world} unit="pt" digits={1} /> : ""}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )
    }

    return (
        <section className="ebo-sec" id="track-record" role="tabpanel">
            <div className="ebo-row ebo-sechead">
                <span className="ebo-meta">{tx.trackNote}</span>
            </div>
            {top.length > 0 && (
                <Block
                    title={fill(tx.inProgress, { q: feed.quarter })}
                    note={fill(tx.inProgressNote, { s: fmtDay(feed.start), d: fmtDay(feed.updated) })}
                    avg={avgNow}
                    world={w}
                    rows={top.map((t) => ({ id: t.id, name: t.name, icon: t.icon, rank: t.topRank || t.rank, ret: t.since }))}
                    live
                />
            )}
            {last ? (
                <Block
                    title={fill(tx.finalTitle, { q: last.quarter })}
                    note={fmtDay(last.start) + " – " + fmtDay(last.end, true)}
                    avg={last.avg}
                    world={last.world}
                    rows={last.picks}
                />
            ) : (
                <p className="ebo-note">{fill(tx.trackEmpty, { q: feed.quarter, d: fmtDay(feed.nextOutlook, true) })}</p>
            )}
            {hist.length > 1 && (
                <div className="ebo-tq">
                    <div className="ebo-row">
                        <h3 className="ebo-h">{tx.allQuarters}</h3>
                        {cum && (
                            <span className="ebo-meta">
                                {fill(tx.cumNote, { q: cum.from || "", n: cum.quarters })} <Pct v={cum.picks} digits={1} /> · {tx.world}{" "}
                                <Pct v={cum.world} digits={1} />
                            </span>
                        )}
                    </div>
                    <table className="ebo-tbl">
                        <thead>
                            <tr>
                                <th>{tx.quarter}</th>
                                <th className="r">{tx.picksAvg}</th>
                                <th className="r">{tx.world}</th>
                                <th className="r">{tx.difference}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {hist.map((q) => (
                                <tr key={q.key}>
                                    <td className="ebo-tn">{q.quarter}</td>
                                    <td className="r">
                                        <Pct v={q.avg} digits={2} />
                                    </td>
                                    <td className="r">
                                        <Pct v={q.world} digits={2} />
                                    </td>
                                    <td className="r">
                                        <Pct v={isNum(q.avg) && isNum(q.world) ? q.avg - q.world : null} unit="pt" digits={2} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function EBOutlook(props: any) {
    const clean = (o: any) =>
        Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""))
    const p: any = { ...DEFAULTS, ...clean(props) }
    const keepEmpty = (o: any) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null))
    const tx = { ...DEF_TEXTS, ...keepEmpty(p.texts) } as Record<string, string>
    const isCanvas = RenderTarget.current() === RenderTarget.canvas

    const url = String(p.dataUrl || "").trim()
    const { feed, state } = useFeed(url)
    const data: Feed | null = feed || (isCanvas ? SAMPLE : null)
    const isSample = !url || !!(data && data.sample)

    const now = useNow(!!p.showHeader)

    const vars = {
        "--bg": p.background,
        "--ink": p.ink,
        "--mute": p.muted,
        "--rule": p.rule,
        "--strong": p.strongRule,
        "--link": p.link,
        "--up": p.upColor,
        "--dn": p.downColor,
        "--maxw": Math.max(320, Number(p.maxWidth) || 1040) + "px",
        "--padx": Math.max(0, Number(p.padding) || 0) + "px",
        "--padt": Math.max(0, Number(p.spaceTop) || 0) + "px",
        "--padb": Math.max(0, Number(p.spaceBottom) || 0) + "px",
        "--secgap": Math.max(0, Number(p.sectionGap) || 0) + "px",
        "--gap": Math.max(0, isNum(Number(p.cardGap)) ? Number(p.cardGap) : 0) + "px",
        "--panel": p.panel,
        "--mid": p.midColor,
        "--soft": "color-mix(in srgb, " + p.rule + " 45%, transparent)",
        "--t1": Math.max(14, Number(p.titleSize) || 22) + "px",
        "--t2": Math.max(12, Number(p.sectionTitleSize) || 18) + "px",
        "--row": Math.max(11, Number(p.rowSize) || 15) + "px",
        "--big": Math.max(16, Number(p.scoreSize) || 28) + "px",
        "--fsz": Math.max(9, Math.min(18, Number(p.footerSize) || 11)) + "px",
        "--fh": fam(p.headingFont, 'Georgia,"Times New Roman",serif') || '"Libre Caslon Text",Georgia,"Times New Roman",serif',
        "--fb": fam(p.bodyFont, '"Helvetica Neue",Arial,sans-serif') || 'Inter,"Helvetica Neue",Arial,sans-serif',
    } as React.CSSProperties

    const views = [
        p.showTop !== false ? { v: "top" as View, t: tx.topTitle } : null,
        p.showAll !== false ? { v: "all" as View, t: tx.allTitle } : null,
        p.showTrack !== false ? { v: "track" as View, t: tx.trackTitle } : null,
    ].filter(Boolean) as { v: View; t: string }[]
    const pickStart = (): View => (views.find((x) => x.v === p.startWith) || views[0] || { v: "top" as View }).v
    const [active, setActive] = React.useState<View>(pickStart)
    React.useEffect(() => setActive(pickStart()), [p.startWith, p.showTop, p.showAll, p.showTrack])
    React.useEffect(() => {
        try {
            const h = window.location.hash
            if (/all-themes/i.test(h)) setActive("all")
            else if (/track/i.test(h)) setActive("track")
            else if (/top-themes/i.test(h)) setActive("top")
        } catch {}
    }, [])
    const [open, setOpen] = React.useState(false)

    const regime = data?.regime
    const regTone: Tone = regime ? (/on/i.test(regime.label) ? "up" : /off/i.test(regime.label) ? "dn" : "flat") : "flat"

    // quarter clock
    const qs = utc(data?.start)
    const qe = utc(data?.end)
    const nx = utc(data?.nextOutlook) || (qe ? new Date(qe.getTime() + DAY) : null)
    const total = qs && qe ? Math.round((qe.getTime() - qs.getTime()) / DAY) + 1 : 0
    const dayN = qs && total ? Math.max(1, Math.min(total, Math.floor((now.getTime() - qs.getTime()) / DAY) + 1)) : 0
    const left = nx ? countdown(nx.getTime() - now.getTime()) : ""
    const since = fill(tx.since, { d: fmtDay(data?.start) })
    const c: Ctx | null = data ? { feed: data, tx, p, since } : null

    return (
        <div className="ebo" style={vars}>
            <style>{CSS}</style>
            <div className="ebo-wrap">
                {p.showHeader && (
                    <header className="ebo-head">
                        <div className="ebo-mast">
                            <div>
                                {tx.kicker && <div className="ebo-kick">{tx.kicker}</div>}
                                <h2 className="ebo-title">{tx.title}</h2>
                                {tx.subtitle && <p className="ebo-subt">{tx.subtitle}</p>}
                            </div>
                            {data && p.showClock !== false && (
                                <div className="ebo-stamp">
                                    <span className={"ebo-dot" + (isSample ? " is-sample" : state === "error" ? "" : " is-live")} />
                                    <b>{data.quarter}</b>
                                    {isSample && <span className="ebo-sample">{tx.sampleBadge}</span>}
                                    {data.updated && <span>{fill(tx.updatedOn, { d: fmtDay(data.updated) })}</span>}
                                    {nx && (
                                        <span>
                                            {fill(tx.nextOutlook, { d: fmtDay(data.nextOutlook || "") || fmtDay(nx.toISOString()) })}
                                            {left ? " · " + tx.inTime.replace("{t}", left) : ""}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                        {data && (
                            <div className="ebo-kpis">
                                {p.showRegime !== false && regime && (
                                    <div className="ebo-kpi">
                                        <span className="ebo-kl">{tx.regime}</span>
                                        <span className={"ebo-kv " + regTone}>{regime.label}</span>
                                        <span className="ebo-ks">
                                            {isNum(regime.score) ? Math.round(regime.score) + "/100" : ""}
                                            {regime.note ? (isNum(regime.score) ? " · " : "") + regime.note : ""}
                                        </span>
                                    </div>
                                )}
                                {isNum(data.world?.since) && (
                                    <div className="ebo-kpi">
                                        <span className="ebo-kl">{fill(tx.worldSince, { d: fmtDay(data.start) })}</span>
                                        <span className="ebo-kv">
                                            <Pct v={data.world!.since} digits={2} />
                                        </span>
                                        <span className="ebo-ks">{data.world?.name || ""}</span>
                                    </div>
                                )}
                                {p.showProgress !== false && total > 0 && (
                                    <div className="ebo-kpi">
                                        <span className="ebo-kl">{fill(tx.quarterKpi, { q: data.quarter })}</span>
                                        <span className="ebo-kv">
                                            {fill(tx.dayOf, { d: dayN, n: total })}
                                        </span>
                                        <Meter v={(dayN / total) * 100} plain />
                                    </div>
                                )}
                            </div>
                        )}
                    </header>
                )}

                {state === "loading" && !data && <p className="ebo-note">{tx.loading}</p>}
                {state === "error" && !feed && !isCanvas && <p className="ebo-note is-err">{tx.unavailable}</p>}

                {c && views.length > 1 && (
                    <nav className="ebo-views" role="tablist" aria-label={tx.views}>
                        {views.map((x) => {
                            const on = x.v === active
                            return (
                                <button
                                    key={x.v}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    className={"ebo-view" + (on ? " is-on" : "")}
                                    onClick={() => setActive(x.v)}
                                >
                                    {x.t}
                                </button>
                            )
                        })}
                    </nav>
                )}

                {c && active === "top" && views.some((x) => x.v === "top") && <TopSection c={c} layout={p.topLayout} />}
                {c && active === "all" && views.some((x) => x.v === "all") && <AllSection c={c} />}
                {c && active === "track" && views.some((x) => x.v === "track") && <TrackSection c={c} />}

                {p.showFooter && (
                    <footer className="ebo-foot">
                        <div className="ebo-refresh">
                            <span>
                                {tx.footBold && <b>{tx.footBold} </b>}
                                {tx.dataLabel} {(data && data.sources) || tx.sources}
                                <span className="ebo-sep2"> · </span>
                                <span className="ebo-rtxt">{tx.refresh}</span>
                            </span>
                            <button type="button" className="ebo-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                                {tx.details}
                                <Chevron dir={open ? "up" : "down"} />
                            </button>
                        </div>
                        {open && (
                            <div className="ebo-details">
                                {[
                                    fill(tx.methodText, { n: data?.method?.universe || data?.themes.length || "" }),
                                    tx.methodRules,
                                    tx.proxiesNote,
                                    tx.notAdvice,
                                ]
                                    .filter(Boolean)
                                    .map((d, i) => (
                                        <p key={i}>{d}</p>
                                    ))}
                            </div>
                        )}
                    </footer>
                )}
            </div>
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* Explanations shown to readers                                       */
/* ------------------------------------------------------------------ */

const PILLAR_INFO: Record<string, string> = {
    momentum: "Performance over 6 and 12 months, skipping the last month. Themes that have risen steadily tend to keep going for a while.",
    trend: "Price vs. its 200-day average, and whether that average is rising.",
    strength: "Performance over the last 3 months compared with world stocks.",
    risk: "Lower price swings and smaller falls over the past year score higher.",
    news: "Tone of world news coverage of the theme over 90 days, and whether it is improving (GDELT).",
    macro: "How the theme has reacted to interest rates, oil, the dollar and credit spreads, applied to how these moved recently.",
}

/* ------------------------------------------------------------------ */
/* Icons (drawn for EB, 24 × 24, stroke only)                          */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, string> = {
    ai: '<circle cx="12" cy="12" r="2.2"/><path d="M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="1"/><rect x="10" y="10" width="4" height="4"/><path d="M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A5.6 5.6 0 0 0 7.2 9.1 4.7 4.7 0 0 0 7 18.5z"/>',
    quantum: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="7" stroke-dasharray="2.2 2.4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 5v3M9.5 12.5v1M14.5 12.5v1M9 16h6M3 12v3.5M21 12v3.5"/><circle cx="12" cy="4" r="1"/>',
    rocket: '<path d="M12 2.8c3 2 4.5 5.5 4.5 9.5L14 16h-4l-2.5-3.7C7.5 8.3 9 4.8 12 2.8z"/><circle cx="12" cy="9.5" r="1.5"/><path d="M10 16l-.8 4.2L12 19l2.8 1.2L14 16M7.6 12.5 5 15.5l2.8.6M16.4 12.5l2.6 3-2.8.6"/>',
    game: '<path d="M7 8.5h10a4 4 0 0 1 4 4v2a2.5 2.5 0 0 1-4.6 1.4L15 14H9l-1.4 1.9A2.5 2.5 0 0 1 3 14.5v-2a4 4 0 0 1 4-4z"/><path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14.5h4"/>',
    atom: '<circle cx="12" cy="12" r="1.4"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(-60 12 12)"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    flame: '<path d="M12 21.2c-3.8 0-6.5-2.6-6.5-6.3 0-3.4 2.4-5.3 3.6-8.3.6 2 1.7 3 2.9 3.5-.2-2.8 1-5.4 3-7 0 3.2 3.5 5.4 3.5 10.5 0 4.2-2.7 7.6-6.5 7.6z"/><path d="M12 21.2c-1.6 0-2.8-1.2-2.8-2.9 0-1.9 1.6-2.6 2.3-4.1 1.6 1 3.3 2.3 3.3 4.2 0 1.6-1.2 2.8-2.8 2.8z"/>',
    gem: '<path d="M6.5 4h11l3.5 5-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3M11.8 9l-2 3.2h3l-2 3.3"/>',
    coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
    drop: '<path d="M12 3.5c3 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
    plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.7 12l2.3 2.3 4.3-4.6"/>',
    bridge: '<path d="M2.5 17h19M2.5 12.5h19M4 12.5c3-5.3 13-5.3 16 0M4 12.5V17M20 12.5V17M8 10.3V17M12 9.2V17M16 10.3V17"/>',
    bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
    car: '<path d="M3.5 16v-3.8L5.8 7h12.4l2.3 5.2V16zM3.5 12.2h17"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
    truck: '<path d="M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    house: '<path d="M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5h4v5"/>',
    cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
    dna: '<path d="M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9M8.5 6.5h7M8.5 17.5h7M10 12h4"/>',
    pill: '<path d="M4.6 13.4a4 4 0 0 1 0-5.7l3.1-3.1a4 4 0 0 1 5.7 5.7l-6.9 6.9M10.3 7.7l6 6"/><path d="M19.4 10.6a4 4 0 0 1 0 5.7l-3.1 3.1a4 4 0 0 1-5.7-5.7z" opacity=".55"/>',
    pulse: '<path d="M2.5 12h4.5l2-5 4 10 2.5-5h6"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18.5 12v3M15.5 12v2.5"/>',
    plane: '<path d="M21 4.5 3 11.5l7 2.5 2.5 7z"/><path d="M10 14l4.5-4.5"/>',
    fork: '<path d="M7 3v6a2 2 0 0 0 4 0V3M9 3v18M17 21V3c-2 0-3 3-3 7h3"/>',
    watch: '<circle cx="12" cy="12" r="5.5"/><path d="M12 9.5V12l1.8 1.2M9 6.8 9.8 3h4.4l.8 3.8M9 17.2l.8 3.8h4.4l.8-3.8"/>',
    shirt: '<path d="M8.5 3.5l-5 3 2 4 2-1v11h9v-11l2 1 2-4-5-3c-.5 1.5-1.8 2.5-3.5 2.5S9 5 8.5 3.5z"/>',
    cart: '<path d="M3 4h2.5l2.2 10.5h10.3L20 7.5H6.3"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    basket: '<path d="M3.5 10h17l-2 10h-13zM8 10l3-6M16 10l-3-6M9 13.5V17M12 13.5V17M15 13.5V17"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-7 9.5-9"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5M4.5 9.5h15M6 9.5V18M10 9.5V18M14 9.5V18M18 9.5V18M3.5 18.5h17M3 21h18"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0zM12 12v6.5a2 2 0 0 1-4 0M12 3v0"/>',
    building: '<path d="M5 21V4h9v17M14 9h5v12M3.5 21h17M8 7.5h3M8 11h3M8 14.5h3M16.5 12.5h.01M16.5 16h.01"/>',
}

/* ------------------------------------------------------------------ */
/* Sample data (illustrative numbers, for the design only)             */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
// 53 weekly points rebased to 100, ending at +m12 %
function walk(seed: number, m12: number, vol: number) {
    const r = rng(seed)
    const n = 53
    const w: number[] = [0]
    for (let i = 1; i < n; i++) w.push(w[i - 1] + (r() - 0.5) * (vol / 100) * 0.48)
    const end = Math.log(1 + m12 / 100)
    return w.map((x, i) => Math.round(100 * Math.exp(x - (w[n - 1] * i) / (n - 1) + (end * i) / (n - 1)) * 10) / 10)
}
const PW: [string, string, number][] = [
    ["momentum", "Momentum", 30],
    ["trend", "Trend", 20],
    ["strength", "Strength", 15],
    ["risk", "Risk", 15],
    ["news", "News", 10],
    ["macro", "Macro", 10],
]
type S = [string, string, string, string, number[], "low" | "medium" | "high", number, number, number, { t: string; tone?: Tone }[], { t: string; n: string }[], number | null | undefined]
const S_ROWS: S[] = [
    ["semis", "Semiconductors", "Technology", "chip", [94, 90, 88, 34, 82, 58], "high", 31.4, 38.2, 6.4, [{ t: "Strong momentum", tone: "up" }, { t: "Beating the market", tone: "up" }, { t: "High volatility", tone: "dn" }], [{ t: "SMH", n: "VanEck Semiconductor ETF" }, { t: "SOXX", n: "iShares Semiconductor ETF" }], undefined],
    ["ai", "Artificial Intelligence", "Technology", "ai", [92, 88, 84, 38, 86, 55], "high", 28.9, 34.0, 5.1, [{ t: "Strong momentum", tone: "up" }, { t: "Positive news", tone: "up" }, { t: "High volatility", tone: "dn" }], [{ t: "AIQ", n: "Global X Artificial Intelligence & Technology ETF" }, { t: "IGPT", n: "Invesco AI and Next Gen Software ETF" }], undefined],
    ["defense", "Defense & Aerospace", "Industry", "shield", [88, 92, 71, 62, 74, 66], "medium", 21.2, 29.5, 3.8, [{ t: "Uptrend", tone: "up" }, { t: "Strong momentum", tone: "up" }, { t: "Stretched", tone: "dn" }], [{ t: "ITA", n: "iShares U.S. Aerospace & Defense ETF" }, { t: "XAR", n: "SPDR S&P Aerospace & Defense ETF" }, { t: "RHM.DE", n: "Rheinmetall" }, { t: "HO.PA", n: "Thales" }, { t: "LDO.MI", n: "Leonardo" }], undefined],
    ["electro", "Electrification & Grid", "Industry", "bolt", [80, 84, 76, 64, 70, 72], "medium", 19.8, 24.1, 2.9, [{ t: "Uptrend", tone: "up" }, { t: "Macro tailwind", tone: "up" }], [{ t: "GRID", n: "First Trust NASDAQ Clean Edge Smart Grid Infrastructure ETF" }, { t: "ETN", n: "Eaton" }, { t: "SU.PA", n: "Schneider Electric" }, { t: "SIE.DE", n: "Siemens" }, { t: "ABBN.SW", n: "ABB" }], undefined],
    ["nuclear", "Nuclear & Uranium", "Energy & Resources", "atom", [86, 78, 82, 30, 79, 61], "high", 33.6, 41.7, -2.4, [{ t: "Strong momentum", tone: "up" }, { t: "Rising attention", tone: "up" }, { t: "High volatility", tone: "dn" }], [{ t: "URA", n: "Global X Uranium ETF" }, { t: "NLR", n: "VanEck Uranium and Nuclear ETF" }], undefined],
    ["gold", "Gold & Precious Metals", "Energy & Resources", "coin", [76, 80, 68, 70, 66, 74], "medium", 17.9, 22.4, 4.6, [{ t: "Uptrend", tone: "up" }, { t: "Macro tailwind", tone: "up" }], [{ t: "GLD", n: "SPDR Gold Shares" }, { t: "GDX", n: "VanEck Gold Miners ETF" }], undefined],
    ["luxury", "Luxury & Watches", "Consumer", "watch", [52, 58, 66, 60, 48, 52], "medium", 22.6, 8.1, 1.2, [{ t: "Beating the market", tone: "up" }], [{ t: "MC.PA", n: "LVMH" }, { t: "RMS.PA", n: "Hermès" }, { t: "CFR.SW", n: "Richemont" }, { t: "UHR.SW", n: "Swatch Group" }], undefined],
    ["health", "Healthcare", "Health", "cross", [44, 50, 52, 88, 56, 48], "low", 13.1, 4.2, 0.6, [{ t: "Low volatility", tone: "up" }], [{ t: "IXJ", n: "iShares Global Healthcare ETF" }], undefined],
    ["hospitality", "Hospitality & Travel", "Consumer", "key", [60, 62, 48, 56, 60, 40], "medium", 20.4, 12.6, -0.8, [{ t: "Uptrend", tone: "up" }], [{ t: "MAR", n: "Marriott" }, { t: "HLT", n: "Hilton" }, { t: "AC.PA", n: "Accor" }, { t: "BKNG", n: "Booking Holdings" }], undefined],
    ["robotics", "Robotics & Automation", "Technology", "robot", [58, 54, 56, 42, 72, 50], "medium", 24.8, 11.4, 1.9, [{ t: "Positive news", tone: "up" }], [{ t: "ROBO", n: "ROBO Global Robotics & Automation ETF" }, { t: "BOTZ", n: "Global X Robotics & Artificial Intelligence ETF" }], undefined],
    ["agri", "Agriculture", "Consumer", "leaf", [36, 40, 44, 74, 44, 62], "low", 15.6, 1.8, -1.1, [{ t: "Low volatility", tone: "up" }], [{ t: "MOO", n: "VanEck Agribusiness ETF" }], undefined],
    ["airlines", "Airlines", "Consumer", "plane", [40, 34, 38, 20, 50, 30], "high", 32.2, -3.9, -4.3, [{ t: "Downtrend", tone: "dn" }], [{ t: "JETS", n: "U.S. Global Jets ETF" }], undefined],
    ["restaurants", "Restaurants", "Consumer", "fork", [30, 36, 34, 82, 38, 46], "low", 14.2, -1.2, -0.4, [{ t: "Low volatility", tone: "up" }], [{ t: "MCD", n: "McDonald's" }, { t: "CMG", n: "Chipotle" }, { t: "YUM", n: "Yum! Brands" }, { t: "SBUX", n: "Starbucks" }], undefined],
    ["fashion", "Fashion & Apparel", "Consumer", "shirt", [22, 26, 30, 50, 34, 36], "medium", 23.5, -9.6, -2.7, [{ t: "Downtrend", tone: "dn" }, { t: "Negative news", tone: "dn" }], [{ t: "ITX.MC", n: "Inditex" }, { t: "NKE", n: "Nike" }, { t: "ADS.DE", n: "adidas" }, { t: "9983.T", n: "Fast Retailing" }], undefined],
]
// Illustrative headlines (invented for the design, no real source)
const SAMPLE_NEWS: Record<string, NewsWatch> = {
    semis: {
        status: "negative", recent: -0.21, base: 0.06, n: 64, rising: true,
        headlines: [
            { t: "Chip stocks slide as a top executive warns on next year's demand", src: "Sample source", date: "2026-11-13", tone: "dn" },
            { t: "Export rules tighten again for advanced processors", src: "Sample source", date: "2026-11-12", tone: "dn" },
            { t: "Data-center orders stay strong, suppliers say", src: "Sample source", date: "2026-11-10", tone: "up" },
        ],
    },
    defense: {
        status: "positive", recent: 0.24, base: 0.11, n: 41,
        headlines: [
            { t: "European defence budgets set for another record year", src: "Sample source", date: "2026-11-14", tone: "up" },
            { t: "Order books at major contractors keep growing", src: "Sample source", date: "2026-11-11", tone: "up" },
            { t: "Supply chains remain the main bottleneck", src: "Sample source", date: "2026-11-09", tone: "flat" },
        ],
    },
    electro: {
        status: "neutral", recent: 0.08, base: 0.07, n: 33,
        headlines: [
            { t: "Utilities plan higher grid spending through 2030", src: "Sample source", date: "2026-11-13", tone: "up" },
            { t: "Transformer shortage persists into next year", src: "Sample source", date: "2026-11-12", tone: "flat" },
            { t: "Grid operators publish winter outlook", src: "Sample source", date: "2026-11-10", tone: "flat" },
        ],
    },
    nuclear: {
        status: "neutral", recent: 0.05, base: 0.09, n: 28, rising: true,
        headlines: [
            { t: "New reactor projects move ahead in Asia and Europe", src: "Sample source", date: "2026-11-14", tone: "up" },
            { t: "Uranium price steadies after October swings", src: "Sample source", date: "2026-11-12", tone: "flat" },
            { t: "Regulator delays review of small reactor design", src: "Sample source", date: "2026-11-09", tone: "dn" },
        ],
    },
    gold: {
        status: "positive", recent: 0.19, base: 0.04, n: 52,
        headlines: [
            { t: "Gold rallies as central banks keep buying", src: "Sample source", date: "2026-11-14", tone: "up" },
            { t: "Miners report record margins for the quarter", src: "Sample source", date: "2026-11-12", tone: "up" },
            { t: "Dollar weakness supports precious metals", src: "Sample source", date: "2026-11-10", tone: "up" },
        ],
    },
}

const SAMPLE: Feed = (() => {
    const themes: Theme[] = S_ROWS.map((r, i) => {
        const pillars = PW.map((w, k) => ({ key: w[0], label: w[1], weight: w[2], score: r[4][k] }))
        const score = Math.round(pillars.reduce((a, b) => a + (b.score || 0) * (b.weight || 0), 0) / 100)
        const m12 = r[7]
        const vol = r[6]
        return {
            id: r[0],
            name: r[1],
            category: r[2],
            icon: r[3],
            rank: 0,
            score,
            pillars,
            risk: {
                level: r[5],
                vol,
                mdd: -Math.round(vol * 0.55 * 10) / 10,
                beta: Math.round((vol / 15) * 0.8 * 100) / 100,
                worstMonth: -Math.round(vol * 0.32 * 10) / 10,
                dist200: Math.round(m12 * 0.35 * 10) / 10,
                corr: Math.round((0.55 + (i % 4) * 0.08) * 100) / 100,
            },
            tags: r[9],
            watch:
                i % 3 === 0
                    ? [{ t: "Hurt by rising interest rates", now: "up" as Tone }, { t: "Helped by a stronger US dollar", now: "dn" as Tone }]
                    : [{ t: "Hurt by higher oil prices", now: "up" as Tone }],
            notes: vol >= 30 ? ["Large price swings: a fall of 20% or more within a quarter is possible."] : [],
            proxies: r[10],
            perf: { m1: Math.round(r[8] * 0.7 * 10) / 10, m3: Math.round(m12 * 0.32 * 10) / 10, m6: Math.round(m12 * 0.6 * 10) / 10, m12 },
            vsWorld: { m1: Math.round((r[8] * 0.7 - 1.1) * 10) / 10, m3: Math.round((m12 * 0.32 - 3.4) * 10) / 10, m6: Math.round((m12 * 0.6 - 7.9) * 10) / 10, m12: Math.round((m12 - 14.6) * 10) / 10 },
            since: r[8],
            spark: walk(i * 977 + 13, m12, vol),
        }
    })
    themes.sort((a, b) => b.score - a.score).forEach((t, i) => (t.rank = i + 1))
    // diversification rule demo: AI moves with Semiconductors, so it is skipped
    let n = 0
    const prev: Record<string, number | null> = { semis: 2, defense: 1, electro: null, nuclear: 4, gold: null }
    themes.forEach((t) => {
        if (t.id === "ai") t.skipped = "Semiconductors"
        else if (n < 5) {
            t.topRank = ++n
            t.prevRank = prev[t.id] === undefined ? null : prev[t.id]
            t.newsWatch = SAMPLE_NEWS[t.id]
        }
        t.prevAllRank = Math.max(1, t.rank + ((t.rank * 7) % 5) - 2)
    })
    return {
        sample: true,
        quarter: "Q4 2026",
        start: "2026-10-01",
        end: "2026-12-31",
        asOf: "2026-09-30",
        updated: "2026-11-13",
        nextOutlook: "2027-01-01",
        regime: { label: "Risk-on", score: 75, note: "World stocks above 200-day average, credit spreads narrowing" },
        world: { name: "iShares MSCI ACWI ETF", ticker: "ACWI", since: 2.14, perf: { m1: 1.1, m3: 3.4, m6: 7.9, m12: 14.6 }, spark: walk(4242, 14.6, 14) },
        sparkStart: 46,
        newsWeek: { from: "2026-11-08", to: "2026-11-15", source: "Google News" },
        method: { weights: { momentum: 30, trend: 20, strength: 15, risk: 15, news: 10, macro: 10 }, universe: 38, news: true, macro: true },
        themes,
        track: {
            last: {
                key: "2026-Q3",
                quarter: "Q3 2026",
                start: "2026-07-01",
                end: "2026-09-30",
                picks: [
                    { id: "defense", name: "Defense & Aerospace", icon: "shield", rank: 1, ret: 7.82 },
                    { id: "semis", name: "Semiconductors", icon: "chip", rank: 2, ret: 11.4 },
                    { id: "health", name: "Healthcare", icon: "cross", rank: 3, ret: -1.35 },
                    { id: "nuclear", name: "Nuclear & Uranium", icon: "atom", rank: 4, ret: 5.06 },
                    { id: "banks", name: "Banks", icon: "bank", rank: 5, ret: 3.9 },
                ],
                avg: 5.37,
                world: 3.62,
            },
            history: [
                { key: "2026-Q2", quarter: "Q2 2026", picks: [], avg: 4.1, world: 5.2 },
                {
                    key: "2026-Q3",
                    quarter: "Q3 2026",
                    picks: [],
                    avg: 5.37,
                    world: 3.62,
                },
            ],
            cumulative: { quarters: 2, picks: 9.69, world: 9.01, from: "Q2 2026" },
        },
        sources: "Yahoo Finance, Google News",
    }
})()

/* ------------------------------------------------------------------ */
/* Styles (same system as EB Monitor)                                  */
/* ------------------------------------------------------------------ */

const CSS = `
.ebo{width:100%;box-sizing:border-box;background:var(--bg);color:var(--ink);font-family:var(--fb);font-size:13px;line-height:1.35;-webkit-font-smoothing:antialiased}
.ebo *{box-sizing:border-box}
.ebo-wrap{container-type:inline-size;max-width:var(--maxw);margin:0 auto;padding:var(--padt) var(--padx) var(--padb);display:flex;flex-direction:column;gap:var(--secgap)}
.ebo-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px}
.ebo .up{color:var(--up)}.ebo .dn{color:var(--dn)}.ebo .flat{color:var(--mute)}.ebo .mid{color:var(--mid)}
.ebo .num{font-variant-numeric:tabular-nums lining-nums}
.ebo-pct{white-space:nowrap;font-variant-numeric:tabular-nums lining-nums;font-weight:600}
.ebo-meta{font-size:11px;color:var(--mute)}
.ebo-lab,.ebo-caps,.ebo-kl{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--mute)}
.ebo-note{margin:12px 0 0;font-size:12px;color:var(--mute);line-height:1.5}
.ebo-note.is-err{color:var(--dn)}
.ebo-h{font-family:var(--fh);font-size:var(--t2);font-weight:700;line-height:1.2;margin:0}

/* masthead */
.ebo-head{display:flex;flex-direction:column;gap:14px}
.ebo-mast{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;border-bottom:2px solid var(--strong);padding-bottom:10px}
.ebo-kick{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin-bottom:2px}
.ebo-title{font-family:var(--fh);font-weight:700;font-size:var(--t1);line-height:1.1;margin:0}
.ebo-subt{margin:4px 0 0;color:var(--mute);max-width:640px;font-size:14px}
.ebo-stamp{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums}
.ebo-stamp b{color:var(--ink)}
.ebo-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--mute);flex:none}
.ebo-dot.is-live{background:var(--up);animation:eboPulse 2s infinite}
.ebo-dot.is-sample{background:#C98B00}
@keyframes eboPulse{0%{box-shadow:0 0 0 0 rgba(26,143,60,.5)}70%{box-shadow:0 0 0 7px rgba(26,143,60,0)}100%{box-shadow:0 0 0 0 rgba(26,143,60,0)}}
.ebo-sample{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C98B00}
.ebo-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));background:var(--panel);border:1px solid var(--rule)}
.ebo-kpi{box-shadow:inset -1px -1px 0 var(--rule);padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}
.ebo-kv{font-family:var(--fh);font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.ebo-kv .ebo-pct{font-weight:700}
.ebo-ks{font-size:12px;color:var(--mute);overflow:hidden;text-overflow:ellipsis}
.ebo-kpi .ebo-meter{margin-top:4px}

/* views = panel with tabs in its header */
.ebo-views{display:flex;flex-wrap:wrap;gap:0 22px;background:var(--panel);border:1px solid var(--rule);border-bottom:0;border-top:2px solid var(--strong);padding:9px 14px 0;margin-bottom:calc(-1 * var(--secgap))}
.ebo-view{appearance:none;border:0;background:none;margin:0 0 -1px;padding:0 0 8px;cursor:pointer;font-family:var(--fh);font-size:var(--t2);font-weight:700;line-height:1.2;color:var(--mute);border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.ebo-view:hover{color:var(--ink)}
.ebo-view.is-on{color:var(--ink);border-bottom-color:var(--ink);cursor:default}
.ebo-view:focus-visible{outline:1px solid var(--link);outline-offset:3px}
.ebo-sec{background:var(--panel);border:1px solid var(--rule);border-top:2px solid var(--strong);padding:10px 14px 14px;min-width:0}
.ebo-views + .ebo-sec{border-top:1px solid var(--rule)}
.ebo-sechead{margin-bottom:8px}
.ebo-sechead .ebo-meta{font-size:12px}
.ebo-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px 16px;flex-wrap:wrap;margin:0 0 10px;min-height:28px}
.ebo-tabs{display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px 0;font-size:12.5px}
.ebo-tabs button{appearance:none;border:0;background:none;margin:0;cursor:pointer;font:inherit;color:var(--link);padding:2px 6px}
.ebo-tabs button:first-of-type{padding-left:0}
.ebo-tabs button:hover{text-decoration:underline}
.ebo-tabs button[aria-pressed="true"]{color:var(--ink);font-weight:700;text-decoration:none;cursor:default}
.ebo-sep{color:var(--rule)}

/* cards */
.ebo-carousel{position:relative}
.ebo-card{height:100%;display:flex;flex-direction:column;gap:2px;padding:12px 14px 10px;border-top:3px solid transparent;outline:none;background:transparent;transition:background .15s}
.ebo-card.is-click{cursor:pointer}
.ebo-card:hover{background:var(--bg)}
.ebo-card.is-sel{border-top-color:var(--link);background:var(--bg)}
.ebo-card:focus-visible{outline:1px solid var(--link);outline-offset:-1px}
.ebo-ctop{display:flex;justify-content:space-between;align-items:baseline}
.ebo-rank{font-family:var(--fh);font-weight:700;font-size:22px;line-height:1;color:var(--mute);font-variant-numeric:tabular-nums}
.ebo-move{font-size:11px;font-weight:600;white-space:nowrap}
.ebo-id{display:flex;align-items:center;gap:8px;margin-top:10px;min-width:0}
.ebo-idtxt{display:flex;flex-direction:column;min-width:0}
.ebo-name{font-size:15px;font-weight:700;line-height:1.25;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .15s}
.ebo-card:hover .ebo-name{color:var(--link)}
.ebo-sub{display:block;font-size:11px;color:var(--mute);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ebo-scorerow{display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px}
.ebo-score{font-family:var(--fh);font-size:var(--big);font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.ebo-score small,.ebo-bigscore small,.ebo-tqbig small{font-family:var(--fb);font-size:12px;color:var(--mute);font-weight:400;margin-left:2px}
.ebo-card .ebo-spark{margin-top:8px}
.ebo-bars{margin-top:6px}
.ebo-bar{display:grid;grid-template-columns:minmax(0,72px) minmax(0,1fr) 30px;align-items:center;gap:10px;padding:4px 0}
.ebo-barlab{font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ebo-bar .num{font-size:13px;font-weight:700;text-align:right;color:var(--ink)}
.ebo-kv{}
.ebo-card .ebo-kv,.ebo-card > .ebo-kv{font-family:var(--fb);font-size:12px;font-weight:400;line-height:1.35}
.ebo-card > div.ebo-kv{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-top:1px solid var(--rule)}
.ebo-bars + div.ebo-kv{margin-top:6px}
.ebo-card > div.ebo-kv .ebo-pct{font-size:14px;font-weight:700}
.ebo-meter{position:relative;display:block;height:4px;min-width:40px;background:var(--soft);border-radius:2px;overflow:hidden}
.ebo-meter i{display:block;height:100%;border-radius:2px;background:var(--ink)}
.ebo-meter i.up{background:var(--up)}.ebo-meter i.mid{background:var(--mid)}.ebo-meter i.dn{background:var(--dn)}.ebo-meter i.ink{background:var(--link)}
.ebo-meter.is-lg{height:6px;border-radius:3px}
.ebo-meter.has-mid::after{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--panel)}
.ebo-risk{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.ebo-dots{display:inline-flex;gap:3px}
.ebo-dots i{width:6px;height:6px;border-radius:50%;border:1px solid currentColor}
.ebo-dots i.on{background:currentColor}
.ebo-risktxt{font-size:12px;font-weight:600}
.ebo-tags{display:flex;flex-wrap:wrap;gap:3px 12px;margin-top:8px}
.ebo-tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink);white-space:nowrap}
.ebo-tag i{width:6px;height:6px;border-radius:50%;background:var(--mute);flex:none}
.ebo-tag i.up{background:var(--up)}.ebo-tag i.dn{background:var(--dn)}
.ebo-open{display:inline-flex;align-items:center;gap:5px;margin-top:auto;padding-top:10px;font-size:12px;color:var(--link)}
.ebo-card.is-big .ebo-rank{font-size:30px}
.ebo-card.is-big .ebo-name{font-size:17px}
.ebo-card.is-big .ebo-score{font-size:calc(var(--big) * 1.2)}

.ebo-mark{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;background:#fff;border:1px solid var(--rule);color:var(--ink);font-weight:700;line-height:1}
.ebo-mark span{color:var(--mute)}
.ebo-mark svg{display:block}

/* news */
.ebo-news{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ebo-news > i{width:7px;height:7px;border-radius:50%;background:var(--mute);flex:none}
.ebo-news > i.up{background:var(--up)}.ebo-news > i.dn{background:var(--dn)}
.ebo-newstxt{font-size:12px;font-weight:600}
.ebo-newstxt.flat{color:var(--ink)}
.ebo-rising{font-size:11px;color:var(--link)}
.ebo-bignews{margin-top:8px}
.ebo-bignews .ebo-news > i{width:12px;height:12px}
.ebo-bignews .ebo-newstxt{font-family:var(--fh);font-weight:700;font-size:30px;line-height:1.05}
.ebo-newsmeta{margin-top:6px;font-size:12px}
.ebo-heads{display:flex;flex-direction:column}
.ebo-head1{display:grid;grid-template-columns:12px minmax(0,1fr);gap:6px;align-items:baseline;padding:6px 0;border-top:1px dotted var(--rule)}
.ebo-head1:first-child{border-top:0}
.ebo-head1 > i{width:7px;height:7px;border-radius:50%;background:var(--mute);transform:translateY(-1px)}
.ebo-head1 > i.up{background:var(--up)}.ebo-head1 > i.dn{background:var(--dn)}
.ebo-hlink{display:block;font-size:13px;line-height:1.4;color:var(--ink);text-decoration:none}
a.ebo-hlink:hover{color:var(--link);text-decoration:underline}
.ebo-tbl .c-news{width:120px}

/* sparkline */
.ebo-spark{position:relative;width:100%}
.ebo-spark svg{display:block;overflow:visible}
.ebo-sp-line{fill:none;stroke:var(--ink);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.ebo-sp-world{fill:none;stroke:var(--mute);stroke-width:1;stroke-dasharray:3 3;opacity:.9}
.ebo-sp-base{stroke:var(--strong);stroke-width:1;stroke-dasharray:3 3;opacity:.5}
.ebo-sp-start{stroke:var(--link);stroke-width:1;stroke-dasharray:2 3;opacity:.8}
.ebo-spark.has-lab{margin-top:10px;padding-right:30px}
.ebo-spark.has-lab svg{width:100%}
.ebo-sp-hi,.ebo-sp-lo{position:absolute;right:0;font-size:10.5px;color:var(--mute);font-variant-numeric:tabular-nums}
.ebo-sp-hi{top:-4px}.ebo-sp-lo{bottom:-4px}
.ebo-legend{display:inline-flex;flex-wrap:wrap;gap:6px}
.ebo-legend span{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule);border-radius:3px;padding:2px 7px;font-size:11.5px;color:var(--ink);background:var(--bg)}
.ebo-legend i{display:inline-block;width:14px;height:0;border-top:1.5px solid var(--ink)}
.ebo-legend i.l-world{border-top:1px dashed var(--mute)}
.ebo-legend i.l-start{width:0;height:10px;border-top:0;border-left:1px dashed var(--link)}

/* carousel */
.ebo-nav{display:flex;align-items:center;gap:6px;margin-left:auto}
.ebo-count{font-size:11px;color:var(--mute);margin-right:6px;font-variant-numeric:tabular-nums}
.ebo-arrow{appearance:none;width:28px;height:28px;margin:0;padding:0;border:1px solid var(--rule);border-radius:3px;background:var(--bg);color:var(--link);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.ebo-arrow:hover{border-color:var(--strong)}
.ebo-arrow[data-off]{color:var(--mute);opacity:.45;cursor:default}
.ebo-track{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - (var(--vis) - 1) * var(--gap)) / var(--vis));gap:0 var(--gap);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.ebo-track::-webkit-scrollbar{display:none}
.ebo-slot{scroll-snap-align:start;min-width:0;border-right:1px solid var(--rule)}
.ebo-slot:last-child{border-right:0}

/* tables */
.ebo-tbl{width:100%;border-collapse:collapse;font-size:var(--row);font-variant-numeric:tabular-nums}
.ebo-tbl th{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);background:var(--soft);text-align:left;padding:5px 8px;white-space:nowrap}
.ebo-tbl td{padding:7px 8px;border-top:1px solid var(--rule);vertical-align:middle}
.ebo-tbl thead + tbody tr:first-child td{border-top:0}
.ebo-tbl .r{text-align:right}
.ebo-tbl .c-rank{width:34px;color:var(--mute);font-size:12px;font-weight:600}
.ebo-tbl .c-score{width:150px}
.ebo-tbl .c-risk{width:120px}
.ebo-tbl .c-since{width:110px}
.ebo-tbl .c-move{width:110px}
.ebo-tbl tr.is-click{cursor:pointer}
.ebo-tbl tr.is-click:hover td{background:var(--bg)}
.ebo-tbl tr.is-click:hover .ebo-tn{color:var(--link)}
.ebo-tbl tr.is-sel td{background:rgba(31,95,197,.05)}
.ebo-tbl tr.is-sel td:first-child{box-shadow:inset 2px 0 0 var(--link)}
.ebo-tbl tr:focus-visible{outline:2px solid var(--link);outline-offset:-2px}
.ebo-tname{display:inline-flex;align-items:center;gap:8px;min-width:0}
.ebo-tnw{display:flex;flex-direction:column;min-width:0}
.ebo-tn{display:block;font-weight:700;font-size:var(--row)}
.ebo-tnw .ebo-sub{font-size:11px}
.ebo-badge{display:inline-block;margin-left:6px;font-family:var(--fh);font-size:9.5px;font-weight:700;color:#fff;background:var(--ink);padding:1px 4px;border-radius:2px;line-height:1.4;vertical-align:1px;text-transform:uppercase;letter-spacing:.03em}
.ebo-tscore{display:flex;align-items:center;gap:10px}
.ebo-tscore .num{font-size:var(--row);font-weight:700;width:24px}
.ebo-tscore .ebo-meter{flex:1}
.ebo-tbl.is-compact .c-score{width:120px}
.ebo-tbl .c-pil{font-weight:600}

/* spotlight */
.ebo-spot{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:0 20px;align-items:start}
.ebo-spot-l .ebo-card{border:1px solid var(--rule);border-top:3px solid var(--strong)}
.ebo-spot-l .ebo-card.is-sel{border-top-color:var(--link)}

/* detail */
.ebo-detail{margin-top:14px;padding-top:12px;border-top:1px solid var(--strong)}
.ebo-dhead{display:flex;justify-content:space-between;align-items:center;gap:12px 24px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--strong)}
.ebo-dhl{display:flex;align-items:center;gap:12px;min-width:0}
.ebo-dname{font-family:var(--fh);font-size:22px;font-weight:700;line-height:1.15;margin:0 0 3px}
.ebo-dhr{text-align:right;display:flex;flex-direction:column-reverse;gap:2px}
.ebo-dhr .ebo-caps{font-size:10.5px;letter-spacing:.08em}
.ebo-dhr .ebo-caps .ebo-pct{font-size:10.5px}
.ebo-hval{font-family:var(--fh);font-size:var(--big);font-weight:700;line-height:1}
.ebo-hval .ebo-pct{font-weight:700}
.ebo-dtabs{display:flex;justify-content:space-between;align-items:center;margin:10px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
.ebo-x{appearance:none;border:0;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--mute);padding:0 2px}
.ebo-x:hover{color:var(--ink)}
.ebo-dgrid{display:grid;grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:0 28px;align-items:start}
.ebo-dleft > .ebo-caps:first-child,.ebo-dright > .ebo-row:first-child .ebo-caps,.ebo-dleft > .ebo-row:first-child .ebo-caps{display:block;margin:2px 0 6px}
.ebo-proxies{margin-top:16px}
.ebo-mini{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px;font-variant-numeric:tabular-nums}
.ebo-mini td{padding:5px 0;border-top:1px solid var(--rule)}
.ebo-mini td.num{font-weight:700;width:80px}
.ebo-mini .r{text-align:right;color:var(--mute)}
.ebo-bio{font-size:12.5px;line-height:1.45;color:var(--ink);margin:10px 0 0}
.ebo-skip{margin-top:12px;padding:8px 10px;background:var(--bg);border-left:2px solid var(--link)}
.ebo-metrics{margin-top:2px}
.ebo-m{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:8px 0;border-top:1px solid var(--rule)}
.ebo-mlab{display:block;font-size:13px;font-weight:600}
.ebo-msub{display:block;font-size:11px;color:var(--mute);margin-top:2px;line-height:1.45}
.ebo-msub .ebo-pct{font-size:11px}
.ebo-mval{text-align:right;flex:none}
.ebo-mnum{display:block;font-family:var(--fh);font-size:20px;font-weight:700;line-height:1.1}
.ebo-mnum .ebo-pct{font-weight:700}
.ebo-sig{margin-top:14px}
.ebo-bigscore{font-family:var(--fh);font-size:calc(var(--big) * 1.6);font-weight:700;line-height:1;margin-top:6px;font-variant-numeric:tabular-nums}
.ebo-bigrisk{margin-top:8px}
.ebo-bigrisk .ebo-dots i{width:11px;height:11px}
.ebo-bigrisk .ebo-dots{gap:5px}
.ebo-bigrisk .ebo-risktxt{font-family:var(--fh);font-weight:700;font-size:30px;line-height:1.05}
.ebo-notes{margin:10px 0 0;padding:0 0 0 16px;font-size:12.5px;line-height:1.45}
.ebo-notes li{padding:2px 0}
.ebo-watch{margin-top:14px}
.ebo-watch .ebo-caps{display:block;margin-bottom:4px}
.ebo-w{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-top:1px solid var(--rule);font-size:12.5px}
.ebo-wnow{font-size:11px;font-weight:600;white-space:nowrap}
.ebo-pillars{margin-top:2px}
.ebo-pil{padding:8px 0;border-top:1px solid var(--rule)}
.ebo-pilhead{display:flex;justify-content:space-between;font-size:13px;font-weight:600}
.ebo-pilhead .ebo-meta{font-weight:400}
.ebo-pilbar{display:flex;align-items:center;gap:10px;margin-top:5px}
.ebo-pilbar .ebo-meter{flex:1}
.ebo-pilbar .num{width:30px;text-align:right;font-size:13px;font-weight:700}
.ebo-fintbl{margin-top:2px}
.ebo-fintbl td{font-size:13px}
.ebo-fintbl td:first-child{font-weight:600}
.ebo-fintbl .c-note{font-size:11.5px;color:var(--mute);line-height:1.4;white-space:normal;min-width:160px}
.ebo-fintbl td.num{font-weight:700;white-space:nowrap}

/* track record */
.ebo-tq{margin-top:14px;padding-top:10px;border-top:1px solid var(--strong)}
.ebo-sechead + .ebo-tq{margin-top:4px}
.ebo-tq .ebo-h{font-size:var(--t2)}
.ebo-tq .ebo-meta{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.ebo-tq .ebo-meta .ebo-pct{font-size:12px}
.ebo-tqsum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:10px 0 12px;background:var(--bg);border:1px solid var(--rule)}
.ebo-tqsum > div{padding:10px 12px;box-shadow:inset -1px 0 0 var(--rule)}
.ebo-tqsum > div:last-child{box-shadow:none}
.ebo-tqbig{font-family:var(--fh);font-size:24px;font-weight:700;line-height:1.15;margin-top:4px;font-variant-numeric:tabular-nums}
.ebo-tqbig .ebo-pct{font-weight:700}
.ebo-tq .ebo-tbl td{padding-top:6px;padding-bottom:6px}

/* footer */
.ebo-foot{border-top:2px solid var(--strong);padding-top:10px;font-size:var(--fsz);line-height:1.5;color:var(--mute)}
.ebo-foot b{color:var(--ink)}
.ebo-refresh{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px}
.ebo-rtxt{color:var(--mute)}
.ebo-more{appearance:none;border:0;background:none;padding:0;margin:0;cursor:pointer;font:inherit;color:var(--link);display:inline-flex;align-items:center;gap:5px}
.ebo-more:hover{text-decoration:underline}
.ebo-details{margin-top:8px;padding-top:8px;border-top:1px solid var(--rule)}
.ebo-details p{margin:0 0 6px}

@media (prefers-reduced-motion:reduce){.ebo-dot.is-live{animation:none}.ebo-name,.ebo-card{transition:none}}
@container (max-width:900px){
  .ebo-track{grid-auto-columns:calc((100% - 1.2 * var(--gap)) / 2.2)}
  .ebo-spot,.ebo-dgrid{grid-template-columns:minmax(0,1fr)}
  .ebo-spot-r{margin-top:14px}
  .ebo-dright{margin-top:18px}
  .ebo-tbl .c-pil{display:none}
}
@container (max-width:640px){
  .ebo-tbl .c-move,.ebo-tbl .c-risk,.ebo-tbl .c-news{display:none}
  .ebo-title{font-size:24px}
  .ebo-kv{font-size:22px}
}
@container (max-width:560px){
  .ebo-views{gap:0 16px;padding:8px 10px 0}
  .ebo-view{font-size:15px}
  .ebo-sec{padding:8px 10px 12px}
  .ebo-track{grid-auto-columns:calc((100% - .25 * var(--gap)) / 1.25)}
  .ebo-count{display:none}
  .ebo-dhr{text-align:left}
  .ebo-tbl .c-score{width:64px}
  .ebo-tbl .c-since{width:auto}
  .ebo-tscore .ebo-meter{display:none}
  .ebo-fintbl .c-note{display:none}
  .ebo-refresh{flex-direction:column}
}
`

/* ------------------------------------------------------------------ */
/* Framer properties                                                   */
/* ------------------------------------------------------------------ */

const DEF_TEXTS: Record<string, string> = {
    kicker: "Economic Bearings",
    title: "Investment Outlook",
    subtitle: "Understanding Markets. Identifying Opportunities. Assessing Risks.",
    updatedOn: "Updated {d}",
    nextOutlook: "Next outlook {d}",
    inTime: "in {t}",
    regime: "EB Market Regime",
    worldSince: "World stocks since {d}",
    dayOf: "Day {d} of {n}",
    quarterKpi: "{q} progress",
    footBold: "Trends and signals, not investment advice.",
    sampleBadge: "Sample data",
    loading: "Loading this quarter's outlook…",
    unavailable: "The outlook is temporarily unavailable. Please check back soon.",
    empty: "No themes to show.",
    views: "Outlook views",
    topTitle: "Top 5 Themes",
    allTitle: "All Themes",
    trackTitle: "Track Record",
    topNote: "The five strongest investment themes for {q}, ranked by the EB Outlook Method",
    allNote: "All {n} themes we follow, ranked for {q}",
    trackNote: "How the Outlook's picks have done against world stocks, quarter by quarter",
    view: "View",
    viewCards: "Cards",
    viewRanking: "Ranking",
    category: "Category",
    allCats: "All",
    sortBy: "Sort by",
    sortScore: "EB Score",
    showing: "{a}–{b} of {n}",
    prev: "Previous",
    next: "Next",
    score: "EB Score",
    theme: "Theme",
    since: "Since {d}",
    vsLast: "vs. last quarter",
    topBadge: "Top 5",
    skippedNote: "Moves with {name}: skipped",
    skippedLong:
        "This theme scored high enough for the Top 5, but over the past year it moved almost in step with {name}, which ranks higher. To keep the picks diverse, only one of the two is shown.",
    moveNew: "New",
    moveHeld: "= Held",
    moveFrom: "from {n}",
    open: "Full analysis",
    close: "Close",
    analysis: "Analysis",
    tOverview: "Overview",
    tScore: "EB Score",
    tRisks: "Risks",
    rankOf: "#{r} of {n}",
    world: "World",
    chartTitle: "Last 12 months, rebased to 100",
    legendTheme: "Theme",
    legendStart: "{q} start",
    measured: "Measured with",
    performance: "Performance",
    perfTo: "to {d}",
    p1m: "1 month",
    p3m: "3 months",
    p6m: "6 months",
    p12m: "12 months",
    vsWorld: "vs. world",
    signals: "Signals",
    pillars: "What makes the score",
    weight: "Weight",
    scoreHint:
        "Each pillar is scored from 0 to 100 against all the themes we follow; the tick marks 50, the middle. The EB Score is their weighted average.",
    riskLabel: "Risk",
    newsLabel: "News this week",
    newsPositive: "Positive",
    newsNeutral: "Neutral",
    newsNegative: "Negative",
    rising: "Rising attention",
    tNews: "News",
    headlines: "This week's headlines",
    newsMeta: "{a} – {b} · {n} articles",
    newsSource: "Source: {s}",
    newsHint:
        "Tone of this week's news coverage compared with the four weeks before. The five themes stay fixed for the quarter: this is an early-warning signal, not a change of pick.",
    noHeadlines: "No headlines this week.",
    riskLow: "Low",
    riskMedium: "Medium",
    riskHigh: "High",
    riskLevel: "Risk level",
    riskHint: "Based on how much the theme's price has swung over the past year: low under 18% a year, medium up to 28%, high above.",
    riskMetrics: "Risk measures",
    past12m: "Past 12 months",
    macroWatch: "Sensitive to",
    nowTail: "Now a tailwind",
    nowHead: "Now a headwind",
    rVol: "Volatility",
    rMdd: "Largest fall",
    rWorst: "Worst month",
    rBeta: "Beta vs. world",
    rDist: "vs. 200-day average",
    rCorr: "Correlation with world",
    gVol: "Typical yearly price swing. Higher means a bumpier ride.",
    gMdd: "Biggest drop from a peak during the year.",
    gWorst: "Weakest one-month return of the year.",
    gBeta: "1.0 moves like world stocks; above 1 amplifies their moves.",
    gDist: "How far the price sits above or below its long-term trend.",
    gCorr: "1.0 means it moves exactly with world stocks; lower means it adds diversity.",
    inProgress: "{q} · in progress",
    inProgressNote: "From {s} to {d}",
    finalTitle: "{q} · final result",
    picksAvg: "Picks, average",
    difference: "Difference",
    beatWorld: "Beat the world",
    ofN: "of {n}",
    trackEmpty: "The track record starts with {q}. Its final result will appear here on {d}.",
    allQuarters: "All quarters",
    quarter: "Quarter",
    cumNote: "Since {q} ({n} quarters): picks",
    dataLabel: "Data:",
    sources: "Yahoo Finance, Google News",
    refresh: "Performance and news updated weekly · New outlook every quarter",
    details: "Method & disclaimer",
    methodText:
        "EB Outlook Method: at the start of each quarter, {n} investment themes are scored from 0 to 100 against each other on six pillars: Momentum (30%), Trend (20%), Strength vs. world stocks (15%), Risk (15%), News tone (10%) and Macro fit (10%). The five best-scoring themes form the Outlook.",
    methodRules:
        "The picks are fixed for the whole quarter (Jan 1, Apr 1, Jul 1, Oct 1); only their performance and a News Watch (tone of this week's coverage vs. the four weeks before) are refreshed weekly. To keep the picks diverse, a theme is skipped when it moved almost in step (correlation above 0.85) with a higher-ranked pick over the past year.",
    proxiesNote:
        "Each theme is measured with an equal-weighted basket of the ETFs and shares listed under “Measured with”, in US dollars. They are named for transparency only, not as recommendations to buy.",
    notAdvice:
        "The EB Outlook is educational content ranked by a published method. It is not investment advice or a recommendation to buy or sell. Past performance and scores do not predict future returns, and you may lose money investing.",
}

const DEFAULTS: Record<string, any> = {
    dataUrl: "",
    showHeader: true,
    showClock: true,
    showRegime: true,
    showProgress: true,
    showTop: true,
    showAll: true,
    showTrack: true,
    showFooter: true,
    startWith: "top",
    topLayout: "carousel",
    cardsVisible: 3,
    cardBars: 3,
    showSpark: true,
    showRisk: true,
    showTags: true,
    showNews: true,
    readerSwitch: true,
    scrollToDetail: true,
    iconSize: 36,
    maxWidth: 1320,
    padding: 24,
    spaceTop: 24,
    spaceBottom: 24,
    sectionGap: 14,
    cardGap: 0,
    titleSize: 30,
    sectionTitleSize: 17,
    rowSize: 13,
    scoreSize: 34,
    footerSize: 12,
    background: "#F0E6DC",
    panel: "#F7F0E8",
    ink: "#1A1A1A",
    muted: "#7A736C",
    rule: "#D9CFC4",
    strongRule: "#57514B",
    link: "#1F6FC5",
    upColor: "#1A8F3C",
    downColor: "#D0021B",
    midColor: "#C08A1E",
    texts: DEF_TEXTS,
}

EBOutlook.defaultProps = DEFAULTS

const num = (title: string, min: number, max: number, step = 1, extra: any = {}) => ({
    type: ControlType.Number,
    title,
    min,
    max,
    step,
    ...extra,
})

const CONTROLS: Record<string, any> = {
    /* Data */
    dataUrl: {
        type: ControlType.String,
        title: "Data URL",
        placeholder: "Empty = sample data",
        description: "Link to eb-outlook.json published by the EB Outlook engine. Leave empty to see the sample.",
    },

    /* Sections */
    showHeader: { type: ControlType.Boolean, title: "Header" },
    showClock: { type: ControlType.Boolean, title: "· Quarter & countdown", hidden: (p: any) => !p.showHeader },
    showRegime: { type: ControlType.Boolean, title: "· Market regime", hidden: (p: any) => !p.showHeader },
    showProgress: { type: ControlType.Boolean, title: "· Quarter progress", hidden: (p: any) => !p.showHeader },
    showTop: { type: ControlType.Boolean, title: "Top 5 Themes" },
    topLayout: {
        type: ControlType.Enum,
        title: "· Layout",
        options: ["carousel", "row", "spotlight", "ranking"],
        optionTitles: ["Carousel", "Row", "Spotlight", "Ranking"],
        hidden: (p: any) => p.showTop === false,
    },
    showAll: { type: ControlType.Boolean, title: "All Themes" },
    showTrack: { type: ControlType.Boolean, title: "Track Record" },
    startWith: {
        type: ControlType.Enum,
        title: "Opens on",
        options: ["top", "all", "track"],
        optionTitles: ["Top 5", "All", "Track"],
        displaySegmentedControl: true,
        description: "Links ending in #all-themes or #track-record open that view directly.",
    },
    showFooter: { type: ControlType.Boolean, title: "Footer" },

    /* Cards */
    cardsVisible: {
        ...num("Cards visible", 1, 5, 1),
        description: "Carousel on desktop. Tablet shows 2 and a bit, mobile 1 and a bit.",
    },
    cardBars: { ...num("Bars on card", 0, 6, 1), description: "How many score pillars each card shows." },
    showSpark: { type: ControlType.Boolean, title: "Mini chart" },
    showRisk: { type: ControlType.Boolean, title: "Risk level" },
    showTags: { type: ControlType.Boolean, title: "Signals" },
    showNews: { type: ControlType.Boolean, title: "News this week" },
    readerSwitch: { type: ControlType.Boolean, title: "Reader switch", description: "Lets readers switch between Cards and Ranking." },
    scrollToDetail: { type: ControlType.Boolean, title: "Scroll to analysis", description: "Brings the full analysis into view when a theme is opened." },
    iconSize: num("Icon size", 24, 64, 1, { unit: "px" }),

    /* Spacing */
    maxWidth: num("Max width", 320, 1600, 10, { unit: "px", description: "Content is centred and never wider than this." }),
    padding: num("Side padding", 0, 120, 1, { unit: "px" }),
    spaceTop: num("Space top", 0, 240, 1, { unit: "px" }),
    spaceBottom: num("Space bottom", 0, 240, 1, { unit: "px" }),
    sectionGap: num("Section gap", 0, 160, 1, { unit: "px" }),
    cardGap: num("Card gap", 0, 60, 1, { unit: "px", description: "0 = cards joined by thin lines, like the Dashboard." }),

    /* Sizes */
    titleSize: num("Title size", 14, 64),
    sectionTitleSize: num("Section size", 12, 40),
    rowSize: num("Row text", 11, 22),
    scoreSize: num("Score size", 16, 60),
    footerSize: num("Footer text", 9, 18, 0.5, { unit: "px" }),

    /* Fonts & colours */
    headingFont: { type: ControlType.Font, title: "Heading font", controls: "basic", defaultFontType: "serif" },
    bodyFont: { type: ControlType.Font, title: "Body font", controls: "basic", defaultFontType: "sans-serif" },
    background: { type: ControlType.Color, title: "Background" },
    panel: { type: ControlType.Color, title: "Panels" },
    ink: { type: ControlType.Color, title: "Text" },
    muted: { type: ControlType.Color, title: "Muted" },
    rule: { type: ControlType.Color, title: "Row lines" },
    strongRule: { type: ControlType.Color, title: "Header lines" },
    link: { type: ControlType.Color, title: "Links" },
    upColor: { type: ControlType.Color, title: "Good / up" },
    downColor: { type: ControlType.Color, title: "Bad / down" },
    midColor: { type: ControlType.Color, title: "Average", description: "Medium risk and middling scores." },

    /* Texts */
    texts: {
        type: ControlType.Object,
        title: "Texts",
        description: "Edit any text. Leave a field empty to remove that text.",
        controls: Object.fromEntries(
            Object.keys(DEF_TEXTS).map((k) => [
                k,
                {
                    type: ControlType.String,
                    title: k.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase()),
                    defaultValue: DEF_TEXTS[k],
                    ...(DEF_TEXTS[k].length > 60 ? { displayTextArea: true } : {}),
                },
            ])
        ),
    },
}
Object.keys(CONTROLS).forEach((k) => {
    if (CONTROLS[k].defaultValue === undefined && DEFAULTS[k] !== undefined && CONTROLS[k].type !== ControlType.Object)
        CONTROLS[k].defaultValue = DEFAULTS[k]
})
addPropertyControls(EBOutlook, CONTROLS)
