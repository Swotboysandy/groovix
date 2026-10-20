// LrcRed — Apple Music TTML filed by ISRC at lrc.red.
import { lyricsGet, parseJson, qs } from './http';
import { parseTtml } from './parsers';
import { Line, Query } from './types';

const BASE = 'https://lrc.red/';
const DURATION_TOLERANCE_SECONDS = 3.0;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

export type DocGet = (url: string) => Promise<string | null>;

export function documentUrl(isrc: string): string | null {
    const v = isrc.trim().toUpperCase();
    return ISRC.test(v) ? `${BASE}s/${v}.ttml` : null;
}

type Hit = { isrc?: string; title?: string; artist?: string; duration?: number };

export async function lrcRedLyrics(q: Query, get: DocGet): Promise<Line[] | null> {
    const known = q.isrc ? documentUrl(q.isrc) : null;
    if (known) {
        const doc = await document(known, get);
        if (doc) return doc;
    }
    const hit = await search(q);
    const found = hit?.isrc ? documentUrl(hit.isrc) : null;
    if (!found || found === known) return null;
    return document(found, get);
}

async function document(url: string, get: DocGet): Promise<Line[] | null> {
    const body = await get(url);
    if (!body) return null;
    const lines = parseTtml(body);
    return lines.length ? lines : null;
}

async function search(q: Query): Promise<Hit | null> {
    const body = await lyricsGet(qs(`${BASE}search.json`, { q: `${q.title} ${q.artist}`.trim() }), q.signal);
    const hits = parseJson(body)?.hits;
    if (!Array.isArray(hits)) return null;
    return best(hits, q.title, q.artist, q.durationMs);
}

const BRACKETED = /[(\[][^)\]]*[)\]]/g;
const ARTIST_SEPARATORS = /\s*(?:,|&|;|\/|\s+and\s+|\s+x\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i;
const VERSION_WORDS = new Set([
    'live', 'remix', 'remixed', 'mix', 'acoustic', 'unplugged', 'instrumental',
    'karaoke', 'cappella', 'acapella', 'demo', 'edit', 'version', 'cover',
    'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'extended',
]);

function normalized(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Mn}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function coreOf(title: string): string {
    const stripped = title.replace(BRACKETED, ' ');
    const idx = stripped.indexOf(' - ');
    return normalized(idx >= 0 ? stripped.substring(0, idx) : stripped) || normalized(title);
}

function versionOf(title: string): Set<string> {
    const brackets = (title.match(BRACKETED) || []).join(' ');
    const idx = title.indexOf(' - ');
    const extras = `${brackets} ${idx >= 0 ? title.substring(idx + 3) : ''}`;
    return new Set(normalized(extras).split(' ').filter(w => VERSION_WORDS.has(w)));
}

function artistsOf(artist: string): Set<string> {
    return new Set(artist.split(ARTIST_SEPARATORS).map(normalized).filter(Boolean));
}

const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

export function best(hits: Hit[], title: string, artist: string, durationMs: number): Hit | null {
    const wantedTitle = coreOf(title);
    const wantedVersion = versionOf(title);
    const wantedArtists = artistsOf(artist);
    const seconds = durationMs / 1000;
    const distance = (h: Hit) =>
        durationMs > 0 && typeof h.duration === 'number' ? Math.abs(h.duration - seconds) : 0;
    let bestHit: Hit | null = null;
    for (const h of hits) {
        if (!h || typeof h.title !== 'string') continue;
        if (!h.isrc || !documentUrl(h.isrc)) continue;
        if (coreOf(h.title) !== wantedTitle) continue;
        if (!setEq(versionOf(h.title), wantedVersion)) continue;
        if (wantedArtists.size && ![...artistsOf(h.artist || '')].some(a => wantedArtists.has(a))) continue;
        if (distance(h) > DURATION_TOLERANCE_SECONDS) continue;
        if (!bestHit || distance(h) < distance(bestHit)) bestHit = h;
    }
    return bestHit;
}
