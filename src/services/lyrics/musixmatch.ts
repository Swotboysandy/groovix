// Musixmatch — signed mobile API, richsync then subtitles.
import CryptoJS from 'crypto-js';
import { httpGet, parseJson, qs } from './http';
import { parseLrc, wordsFromRuns } from './parsers';
import { Line, Query, line } from './types';

const BASE = 'https://apic.musixmatch.com/ws/1.1';
const APP_ID = 'mobile-app-v1.0';
const SEARCH_PAGE = 'https://www.musixmatch.com/search';
const BROWSER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FALLBACK_SIGNING_SECRET = 'f09016176ba43a1cfd1031fbd6b3d26c';
const TIMEOUT_MS = 8000;

let cachedSecret: string | null = null;
let cachedToken: string | null = null;
let tokenInFlight: Promise<string | null> | null = null;
const processGuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

type Track = {
    track_id: number;
    track_name: string;
    artist_name?: string;
    track_length?: number;
    has_subtitles?: number;
    has_richsync?: number;
};

export async function musixmatchLyrics(q: Query): Promise<Line[] | null> {
    const seconds = Math.floor(q.durationMs / 1000);
    const tracks = await searchTrack(q.title, q.artist, q.signal);
    if (!tracks || !tracks.length) return null;
    let track = tracks[0];
    let bestScore = -Infinity;
    for (const t of tracks) {
        const s = score(t, q.title, q.artist, seconds);
        if (s > bestScore) {
            bestScore = s;
            track = t;
        }
    }

    if (track.has_richsync) {
        const body = await fetchBody('track.richsync.get', { track_id: String(track.track_id) }, q.signal);
        const rich = body?.richsync?.richsync_body;
        if (typeof rich === 'string') {
            const lines = parseRichSyncBody(rich);
            if (lines.some(l => l.words.length)) return lines;
        }
    }
    if (!track.has_subtitles) return null;
    const sub = await fetchBody(
        'track.subtitle.get',
        { track_id: String(track.track_id), subtitle_format: 'mxm' },
        q.signal,
    );
    const subtitleBody = sub?.subtitle?.subtitle_body;
    if (typeof subtitleBody !== 'string') return null;
    const lrc = subtitleToLrc(subtitleBody);
    if (!lrc) return null;
    const lines = parseLrc(lrc);
    return lines.length ? lines : null;
}

function score(t: Track, title: string, artist: string, seconds: number): number {
    let s = 0;
    const name = (t.track_name || '').trim().toLowerCase();
    const target = title.trim().toLowerCase();
    if (name === target) s += 80;
    else if (name.includes(target) || target.includes(name)) s += 40;
    if ((t.artist_name || '').trim().toLowerCase().includes(artist.trim().toLowerCase())) s += 40;
    if (typeof t.track_length === 'number') {
        const diff = Math.abs(t.track_length - seconds);
        s += diff <= 2 ? 30 : diff <= 5 ? 15 : diff <= 10 ? 5 : -20;
    }
    return s;
}

async function searchTrack(title: string, artist: string, signal?: AbortSignal): Promise<Track[] | null> {
    const body = await fetchBody(
        'track.search',
        {
            q_track: title,
            q_artist: artist,
            f_has_lyrics: '1',
            s_track_rating: 'desc',
            quorum_factor: '1',
            page_size: '10',
            page: '1',
        },
        signal,
    );
    const list = body?.track_list;
    return Array.isArray(list) ? list.map((w: any) => w?.track).filter((t: any) => t && t.track_id != null) : null;
}

export function parseRichSyncBody(body: string): Line[] {
    const entries = parseJson(body);
    if (!Array.isArray(entries)) return [];
    const toMs = (s: number) => Math.floor(s * 1000);
    const out: Line[] = [];
    for (const e of entries) {
        if (typeof e?.ts !== 'number' || typeof e?.te !== 'number') continue;
        const lineStart = toMs(e.ts);
        const lineEnd = Math.max(lineStart, toMs(e.te));
        const frags: any[] = Array.isArray(e.l) ? e.l : [];
        let previousStart = lineStart;
        const runs = [];
        for (let i = 0; i < frags.length; i++) {
            const f = frags[i];
            if (typeof f?.c !== 'string' || !f.c) continue;
            const start = Math.max(lineStart, previousStart, toMs(e.ts + (f.o ?? 0)));
            const nextF = frags[i + 1];
            const next = nextF ? toMs(e.ts + (nextF.o ?? 0)) : lineEnd;
            previousStart = start;
            runs.push({ startMs: start, endMs: Math.max(start, Math.min(lineEnd, next)), raw: f.c });
        }
        const words = wordsFromRuns(runs, true);
        const text = (typeof e.x === 'string' ? e.x.trim() : '') || words.map(w => w.text).join(' ');
        if (!text) continue;
        out.push(
            line(Math.min(lineStart, words[0]?.startMs ?? lineStart), text, {
                words,
                sungUntilMs: lineEnd > lineStart ? lineEnd : undefined,
            }),
        );
    }
    return out.sort((a, b) => a.timeMs - b.timeMs);
}

function subtitleToLrc(subtitleBody: string): string {
    const lines = parseJson(subtitleBody);
    if (!Array.isArray(lines)) return '';
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    return lines
        .filter((l: any) => typeof l?.text === 'string' && l.text.trim() && typeof l?.time?.total === 'number')
        .map((l: any) => {
            const total = Math.floor(l.time.total * 1000);
            return `[${pad(Math.floor(total / 60000), 2)}:${pad(Math.floor(total / 1000) % 60, 2)}.${pad(
                total % 1000,
                3,
            )}]${l.text}`;
        })
        .join('\n')
        .trim();
}

// ---------- signing ----------

async function fetchBody(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const raw = await signedGet(
        token => qs(`${BASE}/${method}`, { app_id: APP_ID, format: 'json', ...params, usertoken: token }),
        signal,
    );
    return parseJson(raw)?.message?.body ?? null;
}

async function signedGet(buildUrl: (token: string) => string, signal?: AbortSignal): Promise<string | null> {
    const secret = await getSecret(signal);
    const token = await getToken(secret, signal);
    if (!token) return null;
    const first = await apiGet(sign(buildUrl(token), secret), signal);
    if (first != null && !looksUnauthorized(first)) return first;
    cachedToken = null;
    cachedSecret = null;
    const freshSecret = await getSecret(signal);
    const freshToken = await getToken(freshSecret, signal);
    if (!freshToken) return null;
    return apiGet(sign(buildUrl(freshToken), freshSecret), signal);
}

function looksUnauthorized(body: string): boolean {
    const code = parseJson(body)?.message?.header?.status_code;
    return code === 401 || code === 402;
}

async function getToken(secret: string, signal?: AbortSignal): Promise<string | null> {
    if (cachedToken) return cachedToken;
    if (!tokenInFlight) {
        tokenInFlight = (async () => {
            const url = qs(`${BASE}/token.get`, { app_id: APP_ID, guid: processGuid, format: 'json' });
            const t = parseJson(await apiGet(sign(url, secret), signal))?.message?.body?.user_token;
            if (typeof t === 'string' && t) cachedToken = t;
            return cachedToken;
        })().finally(() => {
            tokenInFlight = null;
        });
    }
    return tokenInFlight;
}

const APP_SCRIPT = /src=["']([^"']*\/_next\/static\/chunks\/pages\/_app-[^"']+\.js)["']/i;
const ENCODED_SECRET = /from\(\s*["']([^"']+)["']\s*\.split/;

async function getSecret(signal?: AbortSignal): Promise<string> {
    if (cachedSecret) return cachedSecret;
    let secret = FALLBACK_SIGNING_SECRET;
    try {
        const page = await browserGet(SEARCH_PAGE, 'text/html,application/xhtml+xml', signal);
        const script = page ? APP_SCRIPT.exec(page)?.[1] : undefined;
        if (script) {
            const scriptUrl = new URL(script, SEARCH_PAGE).toString();
            const js = await browserGet(scriptUrl, '*/*', signal);
            const encoded = js ? ENCODED_SECRET.exec(js)?.[1] : undefined;
            if (encoded) {
                const reversed = encoded.split('').reverse().join('');
                const decoded = CryptoJS.enc.Base64.parse(reversed).toString(CryptoJS.enc.Utf8);
                if (decoded.trim()) secret = decoded;
            }
        }
    } catch {}
    cachedSecret = secret;
    return secret;
}

function utcDate(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sign(url: string, secret: string): string {
    const normalized = url.replace(/%20/g, '+').replace(/ /g, '+');
    const raw = CryptoJS.HmacSHA256(normalized + utcDate(), secret);
    const signature = CryptoJS.enc.Base64.stringify(raw);
    return `${normalized}&signature=${encodeURIComponent(signature)}&signature_protocol=sha256`;
}

const apiGet = (url: string, signal?: AbortSignal) =>
    httpGet(url, {
        headers: {
            'User-Agent': BROWSER_AGENT,
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        timeoutMs: TIMEOUT_MS,
        signal,
    });

const browserGet = (url: string, accept: string, signal?: AbortSignal) =>
    httpGet(url, {
        headers: {
            'User-Agent': BROWSER_AGENT,
            Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: 'mxm_bab=AB',
        },
        timeoutMs: TIMEOUT_MS,
        signal,
    });
