// Groovix lyrics providers.
//
// Every enabled source is asked at the same time, but answers are accepted in
// priority order. A word-synced answer wins outright; otherwise the first
// line-synced answer wins unless prioritizeSyllableSync is on, in which case
// line-synced is held as a fallback while later sources are checked for word
// timing. Genius (plain text) starts lazily and only if nothing else hit.
//
// YouTube transcript / YouTube Music / SimpMusic / Megalobiz are not ported:
// Groovix plays TIDAL ids, not YouTube video ids (and the last two are hidden
// ).
import { betterLyrics, betterLyricsPortato } from './betterLyrics';
import { BiniHit, biniIdentify, biniLyrics, biniLyricsFor } from './biniLyrics';
import { geniusLyrics } from './genius';
import { lyricsGet } from './http';
import { kugouLyrics } from './kugou';
import { lrcLibLyrics } from './lrcLib';
import { DocGet, lrcRedLyrics } from './lrcRed';
import { lyricsPlus } from './lyricsPlus';
import { musixmatchLyrics } from './musixmatch';
import { withBackgroundVocals } from './parsers';
import { paxsenixLyrics } from './paxsenix';
import { artistForLyricsSearch, forLyricsSearch } from './query';
import { Line, Query } from './types';
import { unisonLyrics } from './unison';

export type LyricWord = { text: string; time: number; endTime: number }; // seconds
export type SyncedLyricLine = {
    time: number;
    endTime?: number;
    text: string;
    words?: LyricWord[];
    background?: { text: string; words?: LyricWord[] };
    agent?: string;
};

export type LyricsSourceId =
    | 'LRC_RED'
    | 'BINI_LYRICS'
    | 'BETTER_LYRICS'
    | 'BETTER_LYRICS_PORTATO'
    | 'PAXSENIX'
    | 'LYRICS_PLUS'
    | 'UNISON'
    | 'KUGOU'
    | 'LRCLIB'
    | 'MUSIXMATCH'
    | 'GENIUS';

/** Default priority order (highest priority first). */
export const LYRICS_SOURCES: { id: LyricsSourceId; label: string; detail: string; wordSynced: boolean }[] = [
    { id: 'LRC_RED', label: 'lrc.red', detail: 'Apple timings by recording, syllable by syllable', wordSynced: true },
    { id: 'BINI_LYRICS', label: 'BiniLyrics', detail: 'The same Apple timings, matched on the recording itself', wordSynced: true },
    { id: 'BETTER_LYRICS', label: 'BetterLyrics', detail: 'Apple Music timings, word by word', wordSynced: true },
    { id: 'BETTER_LYRICS_PORTATO', label: 'BetterLyrics Portato', detail: 'QQ Music karaoke timings through BetterLyrics', wordSynced: true },
    { id: 'PAXSENIX', label: 'PaxSenix', detail: 'Apple Music timings through the original keyless provider', wordSynced: true },
    { id: 'LYRICS_PLUS', label: 'LyricsPlus', detail: 'Syllable by syllable, on community mirrors', wordSynced: true },
    { id: 'UNISON', label: 'Unison', detail: 'Contributed by listeners, so it has what nobody licensed', wordSynced: true },
    { id: 'KUGOU', label: 'KuGou', detail: 'Whole lines, strong outside the English catalogue', wordSynced: false },
    { id: 'LRCLIB', label: 'LRCLIB', detail: 'Whole lines only, and always up', wordSynced: false },
    { id: 'MUSIXMATCH', label: 'Musixmatch', detail: 'Whole lines, from the biggest lyrics database there is', wordSynced: false },
    { id: 'GENIUS', label: 'Genius', detail: 'Plain text fallback, massive web catalogue', wordSynced: false },
];

export type LyricsQuery = {
    title: string;
    artist: string;
    album?: string;
    durationSec: number;
    isrc?: string;
    trackKey: string;
};

export type FetchLyricsOptions = {
    sources?: LyricsSourceId[];
    order?: LyricsSourceId[];
    prioritizeSyllableSync?: boolean;
    signal?: AbortSignal;
    onSourceResult?: (id: LyricsSourceId, found: boolean) => void;
};

const IDENTIFY_TIMEOUT_MS = 2500;

// ---------- ISRC cache (bounded LRU, in memory only) ----------

const REMEMBERED = 100;
const isrcs = new Map<string, string>();

function remember(trackKey: string, isrc?: string) {
    if (!isrc || !isrc.trim() || !trackKey) return;
    isrcs.delete(trackKey);
    isrcs.set(trackKey, isrc);
    while (isrcs.size > REMEMBERED) {
        const oldest = isrcs.keys().next().value;
        if (oldest === undefined) break;
        isrcs.delete(oldest);
    }
}

function recall(trackKey: string): string | undefined {
    const v = isrcs.get(trackKey);
    if (v !== undefined) {
        isrcs.delete(trackKey);
        isrcs.set(trackKey, v);
    }
    return v;
}

// ---------- helpers ----------

/** One download per URL per lookup, shared between lrc.red and BiniLyrics. */
function sharedDocuments(signal: AbortSignal): DocGet {
    const inFlight = new Map<string, Promise<string | null>>();
    return url => {
        let p = inFlight.get(url);
        if (!p) {
            p = lyricsGet(url, signal);
            inFlight.set(url, p);
        }
        return p;
    };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return new Promise(resolve => {
        const t = setTimeout(() => resolve(null), ms);
        p.then(
            v => {
                clearTimeout(t);
                resolve(v);
            },
            () => {
                clearTimeout(t);
                resolve(null);
            },
        );
    });
}

function linkSignal(parent?: AbortSignal): AbortController {
    const c = new AbortController();
    if (parent) {
        if (parent.aborted) c.abort();
        else parent.addEventListener('abort', () => c.abort(), { once: true } as any);
    }
    return c;
}

const toSec = (ms: number) => ms / 1000;

function convertWords(l: Line): LyricWord[] | undefined {
    return l.words.length
        ? l.words.map(w => ({ text: w.text, time: toSec(w.startMs), endTime: toSec(w.endMs) }))
        : undefined;
}

function toSynced(lines: Line[]): SyncedLyricLine[] {
    const allUnsynced = lines.every(l => l.unsynced);
    return lines.map(l => {
        const out: SyncedLyricLine = {
            // Groovix marks unsynced (plain) lyrics with time -1.
            time: allUnsynced || l.unsynced ? -1 : toSec(l.timeMs),
            text: l.text,
        };
        const endMs = l.sungUntilMs ?? (l.words.length ? l.words[l.words.length - 1].endMs : undefined);
        if (endMs !== undefined && !l.unsynced) out.endTime = toSec(endMs);
        const words = convertWords(l);
        if (words) out.words = words;
        if (l.background) {
            out.background = { text: l.background.text };
            const bw = convertWords(l.background);
            if (bw) out.background.words = bw;
        }
        if (l.agent) out.agent = l.agent;
        return out;
    });
}

const isSynced = (lines: Line[]) => lines.some(l => !l.unsynced && l.timeMs > 0);
const hasWords = (lines: Line[]) => lines.some(l => l.words.length > 0);

type Ctx = { q: Query; trackKey: string; hit: BiniHit | null; get: DocGet };

async function runSource(id: LyricsSourceId, ctx: Ctx): Promise<Line[] | null> {
    const { q } = ctx;
    switch (id) {
        case 'LRC_RED':
            return lrcRedLyrics(q, ctx.get);
        case 'BINI_LYRICS': {
            const m = (ctx.hit ? await biniLyricsFor(ctx.hit, ctx.get) : null) ?? (await biniLyrics(q, ctx.get));
            if (m) remember(ctx.trackKey, m.isrc);
            return m?.lines ?? null;
        }
        case 'BETTER_LYRICS':
            return betterLyrics(q);
        case 'BETTER_LYRICS_PORTATO':
            return betterLyricsPortato(q);
        case 'PAXSENIX':
            return paxsenixLyrics(q);
        case 'LYRICS_PLUS':
            return lyricsPlus(q);
        case 'UNISON':
            return unisonLyrics(q);
        case 'KUGOU':
            return kugouLyrics(q);
        case 'LRCLIB':
            return lrcLibLyrics(q);
        case 'MUSIXMATCH':
            return musixmatchLyrics(q);
        case 'GENIUS':
            return geniusLyrics(q);
    }
    return null;
}

async function safeRun(id: LyricsSourceId, ctx: Ctx): Promise<Line[] | null> {
    try {
        const lines = await runSource(id, ctx);
        return lines && lines.length ? withBackgroundVocals(lines) : null;
    } catch {
        return null;
    }
}

function baseQuery(q: LyricsQuery, signal: AbortSignal): Query {
    return {
        title: forLyricsSearch(q.title),
        artist: artistForLyricsSearch(q.artist),
        album: q.album,
        durationMs: Math.max(0, Math.round((q.durationSec || 0) * 1000)),
        isrc: q.isrc?.trim() || recall(q.trackKey),
        signal,
    };
}

// ---------- public API ----------

export async function fetchLyrics(
    q: LyricsQuery,
    opts: FetchLyricsOptions = {},
): Promise<{ source: LyricsSourceId; lines: SyncedLyricLine[] } | null> {
    const defaults = LYRICS_SOURCES.map(s => s.id);
    const enabled = new Set(opts.sources ?? defaults);
    const sequence = [...new Set([...(opts.order ?? []), ...defaults])].filter(
        id => enabled.has(id) && defaults.includes(id),
    );
    if (!sequence.length) return null;

    const controller = linkSignal(opts.signal);
    const query = baseQuery(q, controller.signal);
    let settled = false;

    try {
        // Settle the recording first (BiniLyrics identify, capped at 2.5s).
        let hit: BiniHit | null = null;
        if (!query.isrc && sequence.includes('BINI_LYRICS')) {
            hit = await withTimeout(biniIdentify(query).catch(() => null), IDENTIFY_TIMEOUT_MS);
            if (hit?.isrc?.trim()) {
                remember(q.trackKey, hit.isrc);
                query.isrc = hit.isrc.trim();
            }
        }
        if (controller.signal.aborted) return null;

        const ctx: Ctx = { q: query, trackKey: q.trackKey, hit, get: sharedDocuments(controller.signal) };
        const start = (id: LyricsSourceId) =>
            safeRun(id, ctx).then(lines => {
                if (!settled) opts.onSourceResult?.(id, !!lines);
                return lines;
            });

        // Everything but Genius starts now; Genius is lazy.
        const racing = new Map<LyricsSourceId, Promise<Line[] | null>>();
        for (const id of sequence) if (id !== 'GENIUS') racing.set(id, start(id));

        let fallback: { source: LyricsSourceId; lines: Line[] } | null = null;
        for (const id of sequence) {
            if (controller.signal.aborted) return null;
            if (id === 'GENIUS') {
                if (fallback) continue;
                racing.set(id, start(id));
            }
            const lines = await racing.get(id)!;
            if (!lines) continue;
            if (hasWords(lines)) return { source: id, lines: toSynced(lines) };
            if (!opts.prioritizeSyllableSync && isSynced(lines)) return { source: id, lines: toSynced(lines) };
            if (!fallback) fallback = { source: id, lines };
        }
        return fallback ? { source: fallback.source, lines: toSynced(fallback.lines) } : null;
    } finally {
        // Losers of the race are no longer worth waiting on.
        settled = true;
        controller.abort();
    }
}

/** One specific provider, for a provider picker. */
export async function fetchLyricsFrom(id: LyricsSourceId, q: LyricsQuery): Promise<SyncedLyricLine[] | null> {
    const controller = new AbortController();
    try {
        const query = baseQuery(q, controller.signal);
        const lines = await safeRun(id, { q: query, trackKey: q.trackKey, hit: null, get: sharedDocuments(controller.signal) });
        return lines ? toSynced(lines) : null;
    } finally {
        controller.abort();
    }
}
