// PaxSenix — keyless Apple Music path only.
// (The API-key Spotify / Musixmatch variants are intentionally not ported.)
import { lyricsGet, lyricsGetAuthorized, parseJson, qs } from './http';
import { parseProviderLyrics, wordsFromRuns } from './parsers';
import { Line, Query, line } from './types';

const PUBLIC_PROXY = 'https://lyrics.paxsenix.org';
const APPLE_SEARCH = 'https://amp-api.music.apple.com/v1/catalog/us/search';
const MINIMUM_MATCH_SCORE = 10;

let cachedAppleToken: string | null = null;
let tokenInFlight: Promise<string | null> | null = null;

export async function paxsenixLyrics(q: Query): Promise<Line[] | null> {
    const id = await searchPublicAppleTrackId(q);
    if (!id) return null;
    const body = await lyricsGet(qs(`${PUBLIC_PROXY}/apple-music/lyrics`, { id, ttml: 'true' }), q.signal);
    return body ? parseResponse(body) : null;
}

async function searchPublicAppleTrackId(q: Query): Promise<string | null> {
    const token = await appleToken(q.signal);
    if (!token) return null;
    const url = qs(APPLE_SEARCH, { term: `${q.title} ${q.artist}`, types: 'songs', limit: '10', l: 'en-US' });
    const root = parseJson(await lyricsGetAuthorized(url, token, q.signal));
    if (!root) return null;
    return bestCandidate(root, q.title, q.artist, q.durationMs)?.id ?? null;
}

const APPLE_INDEX_SCRIPT = /\/assets\/index~[^"]+\.js/;
const APPLE_TOKEN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

async function appleToken(signal?: AbortSignal): Promise<string | null> {
    if (cachedAppleToken) return cachedAppleToken;
    if (!tokenInFlight) {
        tokenInFlight = (async () => {
            const page = await lyricsGet('https://music.apple.com/us/new', signal);
            const path = page ? APPLE_INDEX_SCRIPT.exec(page)?.[0] : undefined;
            if (!path) return null;
            const script = await lyricsGet(`https://music.apple.com${path}`, signal);
            const token = script ? APPLE_TOKEN.exec(script)?.[0] : undefined;
            if (token) cachedAppleToken = token;
            return cachedAppleToken;
        })().finally(() => {
            tokenInFlight = null;
        });
    }
    return tokenInFlight;
}

function parseResponse(raw: string): Line[] | null {
    return parseTimedApple(raw) ?? parseProviderLyrics(raw);
}

function findTimedContent(el: any): any[] | null {
    if (Array.isArray(el)) {
        for (const x of el) {
            const r = findTimedContent(x);
            if (r) return r;
        }
        return null;
    }
    if (el && typeof el === 'object') {
        if (Array.isArray(el.content) && el.content.some((c: any) => c && typeof c === 'object' && c.timestamp != null)) {
            return el.content;
        }
        for (const v of Object.values(el)) {
            const r = findTimedContent(v);
            if (r) return r;
        }
    }
    return null;
}

export function parseTimedApple(raw: string): Line[] | null {
    const root = parseJson(raw);
    if (!root) return null;
    const content = findTimedContent(root);
    if (!content) return null;
    const rows = content.filter(r => r && typeof r === 'object' && !Array.isArray(r));
    const lines: Line[] = [];
    rows.forEach((row, index) => {
        const start = typeof row.timestamp === 'number' ? row.timestamp : null;
        if (start == null || !Array.isArray(row.text)) return;
        const wordRows: any[] = row.text;
        const texts = wordRows.map(w => (typeof w?.text === 'string' ? w.text : null)).filter((t): t is string => t != null);
        if (!texts.length) return;
        const nextLine = typeof rows[index + 1]?.timestamp === 'number' ? rows[index + 1].timestamp : undefined;
        const runs = [];
        for (let i = 0; i < wordRows.length; i++) {
            const w = wordRows[i];
            const text = typeof w?.text === 'string' ? w.text.trim() : '';
            if (!text || typeof w.timestamp !== 'number') continue;
            const wordEnd =
                typeof w.endtime === 'number'
                    ? w.endtime
                    : typeof wordRows[i + 1]?.timestamp === 'number'
                    ? wordRows[i + 1].timestamp
                    : nextLine ?? w.timestamp + 800;
            runs.push({ startMs: w.timestamp, endMs: wordEnd, raw: w.part === true ? text : `${text} ` });
        }
        const timed = wordsFromRuns(runs, true);
        const untimed = runs.length !== texts.filter(t => t.trim()).length;
        lines.push(
            line(Math.min(start, timed[0]?.startMs ?? start), untimed ? texts.map(t => t.trim()).join(' ') : timed.map(w => w.text).join(' '), {
                words: untimed ? [] : timed,
                sungUntilMs: nextLine,
            }),
        );
    });
    return lines.some(l => l.text.trim()) ? lines : null;
}

// ---------- candidate matching ----------

type Candidate = { id: string; title: string; artist: string; durationMs: number };

const ID_KEYS = ['id', 'trackId', 'track_id', 'realId'];
const TITLE_KEYS = ['name', 'title', 'trackName', 'track_name'];
const ARTIST_KEYS = ['artistName', 'artist_name'];
const DURATION_KEYS = ['durationInMillis', 'durationMs', 'duration_ms', 'duration'];

function firstString(o: any, keys: string[]): string | null {
    for (const k of keys) {
        const v = o?.[k];
        if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
    }
    return null;
}

function firstNumber(o: any, keys: string[]): number | null {
    for (const k of keys) {
        const v = o?.[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
    }
    return null;
}

function artistNames(o: any): string | null {
    const a = o?.artists ?? o?.artist;
    if (typeof a === 'string') return a;
    if (Array.isArray(a)) {
        const s = a
            .map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? firstString(x, ['name', 'artistName', 'title']) : null))
            .filter(Boolean)
            .join(', ');
        return s || null;
    }
    if (a && typeof a === 'object') return firstString(a, ['name', 'artistName', 'title']);
    return null;
}

const toDurationMs = (n: number | null) => (n == null || n <= 0 ? 0 : n < 10000 ? n * 1000 : n);

function toCandidate(o: any): Candidate | null {
    const details = o.attributes && typeof o.attributes === 'object' ? o.attributes : o;
    const id = firstString(o, ID_KEYS) ?? firstString(details, ID_KEYS);
    if (!id) return null;
    const title = firstString(details, TITLE_KEYS);
    if (!title) return null;
    const artist = firstString(details, ARTIST_KEYS) ?? artistNames(details) ?? '';
    return { id, title, artist, durationMs: toDurationMs(firstNumber(details, DURATION_KEYS)) };
}

function collect(el: any, into: Candidate[]) {
    if (Array.isArray(el)) el.forEach(x => collect(x, into));
    else if (el && typeof el === 'object') {
        const c = toCandidate(el);
        if (c) into.push(c);
        Object.values(el).forEach(v => collect(v, into));
    }
}

function textScore(c: string, w: string, exact: number, partial: number): number {
    if (!c.trim() || !w.trim()) return 0;
    const a = c.toLowerCase();
    const b = w.toLowerCase();
    if (a === b) return exact;
    if (a.includes(b) || b.includes(a)) return partial;
    return 0;
}

function scoreOf(c: Candidate, title: string, artist: string, durationMs: number): number {
    let s = textScore(c.title, title, 20, 10) + textScore(c.artist, artist, 15, 5);
    if (durationMs > 0 && c.durationMs > 0) {
        const d = Math.abs(c.durationMs - durationMs);
        s += d < 3000 ? 10 : d < 10000 ? 5 : 0;
    }
    return s;
}

function bestCandidate(root: any, title: string, artist: string, durationMs: number): Candidate | null {
    const all: Candidate[] = [];
    collect(root, all);
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of all) {
        const s = scoreOf(c, title, artist, durationMs);
        if (s > bestScore) {
            bestScore = s;
            best = c;
        }
    }
    return best && bestScore >= MINIMUM_MATCH_SCORE ? best : null;
}
