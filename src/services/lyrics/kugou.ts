// KuGou — line-synced LRC, strong outside the English catalogue.
import CryptoJS from 'crypto-js';
import { lyricsGet, parseJson, qs } from './http';
import { parseLrc } from './parsers';
import { Line, Query } from './types';

const DURATION_TOLERANCE_SECONDS = 8;

const stripParenthetical = (s: string) => s.replace(/[(（].*?[)）]/g, '').trim() || s;

export async function kugouLyrics(q: Query): Promise<Line[] | null> {
    const keyword = `${stripParenthetical(q.title)} - ${stripParenthetical(q.artist)}${
        q.album && q.album.trim() ? ` ${q.album}` : ''
    }`;
    const seconds = Math.floor(q.durationMs / 1000);

    let candidate: { id: string; accesskey: string } | null = null;
    const hashes = (await searchSongs(keyword, seconds, q.signal)) || [];
    for (const hash of hashes) {
        const c = await searchLyrics({ hash }, q.signal);
        if (c && c[0]) {
            candidate = c[0];
            break;
        }
    }
    if (!candidate) {
        const c = await searchLyrics({ keyword, seconds }, q.signal);
        candidate = c?.[0] ?? null;
    }
    if (!candidate) return null;
    const lrc = await download(candidate.id, candidate.accesskey, q.signal);
    if (!lrc) return null;
    const lines = parseLrc(lrc);
    return lines.length ? lines : null;
}

async function searchSongs(keyword: string, seconds: number, signal?: AbortSignal): Promise<string[] | null> {
    const body = await lyricsGet(
        qs('https://mobileservice.kugou.com/api/v3/search/song', {
            version: '9108', plat: '0', pagesize: '8', showtype: '0', keyword,
        }),
        signal,
    );
    const info = parseJson(body)?.data?.info;
    if (!Array.isArray(info)) return null;
    return info
        .map((i: any) => ({ hash: String(i?.hash ?? ''), duration: typeof i?.duration === 'number' ? i.duration : -1 }))
        .filter(i => i.hash && (seconds <= 0 || Math.abs(i.duration - seconds) <= DURATION_TOLERANCE_SECONDS))
        .sort((a, b) => Math.abs(a.duration - seconds) - Math.abs(b.duration - seconds))
        .map(i => i.hash);
}

async function searchLyrics(
    by: { hash?: string; keyword?: string; seconds?: number },
    signal?: AbortSignal,
): Promise<{ id: string; accesskey: string }[] | null> {
    const params: Record<string, string | undefined> = { ver: '1', man: 'yes', client: 'pc' };
    if (by.hash) params.hash = by.hash;
    else if (by.keyword) {
        params.keyword = by.keyword;
        if (by.seconds && by.seconds > 0) params.duration = String(by.seconds * 1000);
    } else return null;
    const candidates = parseJson(await lyricsGet(qs('https://lyrics.kugou.com/search', params), signal))?.candidates;
    if (!Array.isArray(candidates)) return null;
    return candidates
        .filter((c: any) => c?.id != null && c?.accesskey != null)
        .map((c: any) => ({ id: String(c.id), accesskey: String(c.accesskey) }));
}

async function download(id: string, accesskey: string, signal?: AbortSignal): Promise<string | null> {
    const res = parseJson(
        await lyricsGet(
            qs('https://lyrics.kugou.com/download', {
                fmt: 'lrc', charset: 'utf8', client: 'pc', ver: '1', id, accesskey,
            }),
            signal,
        ),
    );
    if (!res || typeof res.content !== 'string' || !res.content) return null;
    try {
        return stripCredits(CryptoJS.enc.Base64.parse(res.content).toString(CryptoJS.enc.Utf8));
    } catch {
        return null;
    }
}

const STAMPED = /^\[\d{2}:\d{2}\.\d{2,3}].*$/;
const CREDIT = /^.+][^\[]+[:：].+$/;

export function stripCredits(text: string): string {
    const lines = text.split(/\r?\n/).filter(l => STAMPED.test(l));
    if (!lines.length) return '';
    const headLimit = Math.min(30, lines.length - 1);
    let headCut = 0;
    for (let i = headLimit; i >= 0; i--) {
        if (CREDIT.test(lines[i])) {
            headCut = i + 1;
            break;
        }
    }
    const body = lines.slice(headCut);
    if (!body.length) return '';
    const tailLimit = Math.min(30, body.length - 1);
    let tailCut = 0;
    for (let i = 0; i <= tailLimit; i++) {
        if (CREDIT.test(body[body.length - 1 - i])) {
            tailCut = i + 1;
            break;
        }
    }
    return body.slice(0, body.length - tailCut).join('\n');
}
