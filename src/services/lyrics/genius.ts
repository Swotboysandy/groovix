// Genius — plain-text scrape, used only as a last resort.
// Jsoup is replaced by regex extraction of data-lyrics-container blocks.
import { httpGet, parseJson } from './http';
import { decodeEntities } from './parsers';
import { Line, Query, line } from './types';

const USER_AGENT = 'Groovix';
const TIMEOUT_MS = 8000;

const TITLE_SEPARATOR = /\s*[-–—:]\s*/;
const DECORATIVE_CHARS = /[♪♫★☆【】《》「」~_]/g;
const PRODUCER_TAGS = /\b(?:prod(?:uced)?\.?(?:\s+by)?)\s+.*$/i;
const NOISE =
    /\s*[(\[]\s*(?:from|feat\.?|ft\.?|featuring|with|prod\.?|produced by|official|lyrical|video|audio|remix|music video|visualizer|mv|hd|4k|hq|full song)[^)\]]*[)\]]|\s*\b(?:official\s+(?:music\s+)?(?:video|audio)|lyrical(?:\s+video)?|full\s+song|4k\s+video|hd\s+video|music\s+video)\b/gi;
const BRACKETED_CONTENT = /\s*[(\[].*?[)\]]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\s]/gu;
const YOU_MIGHT_ALSO_LIKE = /\d*You might also like/gi;
const TRAILING_EMBED = /\d*Embed\s*$/i;

const get = (url: string, signal?: AbortSignal) =>
    httpGet(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        timeoutMs: TIMEOUT_MS,
        signal,
    });

function cleanQuery(text: string): string {
    let c = text.replace(DECORATIVE_CHARS, ' ').replace(NOISE, ' ').replace(PRODUCER_TAGS, ' ');
    const bar = c.indexOf(' | ');
    if (bar >= 0) c = c.substring(0, bar);
    c = c.replace(/\s+/g, ' ').trim();
    return c || text.trim();
}

export async function geniusLyrics(q: Query): Promise<Line[] | null> {
    try {
        const cleanTitle = cleanQuery(q.title);
        const cleanArtist = cleanQuery(q.artist);
        const m = TITLE_SEPARATOR.exec(cleanTitle);
        const parts = m ? [cleanTitle.substring(0, m.index), cleanTitle.substring(m.index + m[0].length)] : null;
        const eq = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase();

        let title = cleanTitle;
        let artist = cleanArtist;
        if (parts) {
            if (eq(parts[0], cleanArtist)) title = parts[1].trim();
            else if (eq(parts[1], cleanArtist)) title = parts[0].trim();
            else if (parts[0].trim() && parts[1].trim()) title = parts[1].trim();
            if (!eq(parts[0], cleanArtist) && !eq(parts[1], cleanArtist) && !cleanArtist.trim()) artist = parts[0].trim();
        }
        const bare = title.replace(BRACKETED_CONTENT, ' ').replace(NON_ALPHANUMERIC, ' ').replace(/\s+/g, ' ').trim();

        const attempts: { query: string; title: string; artist: string }[] = [];
        if (artist.trim() && title.trim()) attempts.push({ query: `${artist} ${title}`.trim(), title, artist });
        if (artist.trim() && bare && bare !== title) attempts.push({ query: `${artist} ${bare}`.trim(), title: bare, artist });
        if (cleanTitle !== title) {
            attempts.push({ query: `${cleanArtist} ${cleanTitle}`.trim(), title: cleanTitle, artist: cleanArtist });
            attempts.push({ query: cleanTitle, title, artist });
        }
        if (bare) attempts.push({ query: bare, title: bare, artist });
        else if (title.trim()) attempts.push({ query: title, title, artist });

        const seen = new Set<string>();
        let songUrl: string | null = null;
        for (const a of attempts) {
            if (seen.has(a.query)) continue;
            seen.add(a.query);
            songUrl = await searchSongUrl(a.query, a.title, a.artist, q.signal);
            if (songUrl) break;
        }
        if (!songUrl) return null;
        const html = await get(songUrl, q.signal);
        if (!html || !html.trim()) return null;
        const lines = parseHtml(html);
        return lines && lines.length ? lines : null;
    } catch {
        return null;
    }
}

async function searchSongUrl(query: string, title: string, artist: string, signal?: AbortSignal): Promise<string | null> {
    const root = parseJson(await get(`https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`, signal));
    const sections = root?.response?.sections;
    if (!Array.isArray(sections)) return null;
    const song = sections.find((s: any) => s?.type === 'song');
    const hits = Array.isArray(song?.hits) ? song.hits : [];
    const candidates = hits.map((h: any) => h?.result).filter((r: any) => r && typeof r === 'object');
    const best = bestMatch(candidates, title, artist);
    return typeof best?.url === 'string' ? best.url : null;
}

function bestMatch(candidates: any[], targetTitle: string, targetArtist: string): any | null {
    const nt = targetTitle.toLowerCase();
    const na = targetArtist.toLowerCase();
    let best: any = null;
    let bestScore = -Infinity;
    for (const item of candidates) {
        const t = String(item.title ?? '').toLowerCase();
        const a = String(item.artist_names ?? '').toLowerCase();
        const tm = !!nt && (t === nt || t.includes(nt) || nt.includes(t));
        const am = !!na && (a === na || a.includes(na) || na.includes(a));
        if (!tm && !am) continue;
        let s = 0;
        if (t === nt) s += 50;
        else if (tm) s += 25;
        if (am) s += a === na ? 40 : 20;
        const path = String(item.path ?? '').toLowerCase();
        if (path.includes('translation') && !nt.includes('translation')) s -= 30;
        if (path.includes('türkçe') || path.includes('polskie-tlumaczenie')) s -= 40;
        if (path.includes('tracklist') || path.includes('album-art')) s -= 50;
        if (s <= 0) continue;
        if (s > bestScore) {
            bestScore = s;
            best = item;
        }
    }
    return best;
}

/** Extracts the inner HTML of every div[data-lyrics-container=true] (nesting-aware). */
function lyricsContainers(html: string): string[] {
    const out: string[] = [];
    const open = /<div\b[^>]*data-lyrics-container\s*=\s*["']true["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = open.exec(html))) {
        let depth = 1;
        const tag = /<(\/?)div\b[^>]*>/gi;
        tag.lastIndex = m.index + m[0].length;
        let t: RegExpExecArray | null;
        let end = html.length;
        while ((t = tag.exec(html))) {
            depth += t[1] ? -1 : 1;
            if (depth === 0) {
                end = t.index;
                break;
            }
        }
        out.push(html.substring(m.index + m[0].length, end));
        open.lastIndex = end;
    }
    return out;
}

/** Removes elements (with their subtree) that match an opening-tag pattern. */
function removeElements(html: string, openTag: RegExp): string {
    let result = html;
    for (let guard = 0; guard < 200; guard++) {
        const m = openTag.exec(result);
        openTag.lastIndex = 0;
        if (!m) break;
        const name = /^<([\w-]+)/.exec(m[0])?.[1] ?? 'div';
        if (/\/>$/.test(m[0])) {
            result = result.substring(0, m.index) + result.substring(m.index + m[0].length);
            continue;
        }
        const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
        tag.lastIndex = m.index + m[0].length;
        let depth = 1;
        let end = result.length;
        let t: RegExpExecArray | null;
        while ((t = tag.exec(result))) {
            if (/\/>$/.test(t[0])) continue;
            depth += t[1] ? -1 : 1;
            if (depth === 0) {
                end = t.index + t[0].length;
                break;
            }
        }
        result = result.substring(0, m.index) + result.substring(end);
    }
    return result;
}

export function parseHtml(html: string): Line[] | null {
    const containers = lyricsContainers(html);
    if (!containers.length) return null;
    let full = '';
    for (let c of containers) {
        c = removeElements(c, /<[\w-]+\b[^>]*data-exclude-from-selection\s*=\s*["']true["'][^>]*>/i);
        c = removeElements(c, /<[\w-]+\b[^>]*class\s*=\s*["'][^"']*(?:LyricsHeader__Container|SongBioPreview__Container|InreadAd__Container)[^"']*["'][^>]*>/i);
        c = c.replace(/<(script|style|button)\b[\s\S]*?<\/\1>/gi, '');
        c = c.replace(/<br\s*\/?>/gi, '\n').replace(/<p\b[^>]*>/gi, '\n');
        const text = decodeEntities(c.replace(/<[^>]+>/g, ''));
        if (text.trim()) full += text + '\n';
    }
    if (!full.trim()) return null;
    const cleaned = full
        .replace(/[ ​﻿]/g, ' ')
        .replace(YOU_MIGHT_ALSO_LIKE, '')
        .trim()
        .replace(TRAILING_EMBED, '')
        .trim();
    // Unsynced: no blank gap rows (Groovix's plain-lyrics view expects text rows only).
    const lines = cleaned
        .split(/\r?\n/)
        .map(l => l.trim().replace(TRAILING_EMBED, '').trim())
        .filter(Boolean)
        .map(l => line(0, l, { unsynced: true }));
    return lines.length ? lines : null;
}
