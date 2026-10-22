import { HIFI_API_URL, TIDAL_SEGMENT_PROXY_URL } from './config/private';
import { appSettings, loadAppSettings } from './store/appSettings';
import type { Album, Artist, CatalogSearchResult, Playlist, Track } from './types';
import CryptoJS from 'crypto-js';
import { normalizeMusicText, recordingVariant, sameRecording } from './services/musicMatching';
import { catalogRequest, objectRecord } from './services/catalogRequest';
import { fetchLyrics, LYRICS_SOURCES } from './services/lyrics';

let lastLyricsSource: string | null = null;
/** The provider that answered the most recent lyrics lookup, for "Lyrics by …". */
export function getLastLyricsSource(): string | null { return lastLyricsSource; }
import { getLyricsSettings } from './store/lyricsSettings';

declare function atob(data: string): string;

const MONOCHROME_URL = 'https://monochrome-api.samidy.com';
// Tidal HI_RES FLAC by Tidal track id — no auth, no Turnstile, DRM-free manifest.
const RHYTHMAX_URL = 'https://hifi.rhythmax.workers.dev';

const PROXYABLE_TIDAL_AUDIO_HOSTS = new Set([
    'sp-ad-fa.audio.tidal.com',
    'sp-ad-cf.audio.tidal.com',
]);
// Public, credential-free catalog and streams used when the Tidal search mirror is unavailable.
const AUDIUS_URL = 'https://api.audius.co/v1';
const SAAVN_SEARCH_URL = 'https://rthmx.vercel.app/api/songs?q=';
const SAAVN_DETAIL_URL = 'https://www.jiosaavn.com/api.php?__call=webapi.get&type=song&includeMetaTags=0&ctx=web6dot0&api_version=4&_format=json&_marker=0&token=';
const API_TIMEOUT_MS = 12_000;
const SEARCH_CACHE_TTL_MS = 2 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 40;

const trackSearchCache = new Map<string, { expiresAt: number; tracks: Track[] }>();
const trackSearchRequests = new Map<string, Promise<Track[]>>();

type AppStreamQuality = 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH' | 'LOW';

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Catalogue hosts, tried in order: the hifi server first, Monochrome as backup.
const CATALOG_URLS = [HIFI_API_URL, MONOCHROME_URL].filter(Boolean);

/** The first OK catalogue response for [path], or the last failure. */
async function catalogFetch(path: string): Promise<Response> {
    let last: Response | null = null;
    let error: unknown = null;
    for (const base of CATALOG_URLS) {
        try {
            const response = await fetchWithTimeout(`${base}${path}`);
            if (response.ok) return response;
            last = response;
        } catch (e) { error = e; }
    }
    if (last) return last;
    throw error ?? new Error('Catalog unavailable');
}

/** catalogRequest across the catalogue hosts. */
async function catalogJson(path: string): Promise<unknown> {
    let error: unknown = null;
    for (const base of CATALOG_URLS) {
        try { return await catalogRequest(`${base}${path}`); } catch (e) { error = e; }
    }
    throw error ?? new Error('Catalog unavailable');
}

function stableNumericId(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
}

function mapAudiusTrack(item: any): Track {
    const providerId = String(item?.id || '');
    const artwork = item?.artwork || {};
    return {
        id: stableNumericId(`audius:${providerId}`),
        providerId,
        title: item?.title || 'Unknown track',
        duration: Number(item?.duration) || 0,
        artist: {
            id: stableNumericId(`audius-user:${item?.user?.id || item?.user?.name || ''}`),
            name: item?.user?.name || 'Unknown artist',
            picture: item?.user?.profile_picture?.['480x480'] || item?.user?.profile_picture?.['150x150'],
        },
        album: {
            id: stableNumericId(`audius-album:${item?.album_name || providerId}`),
            title: item?.album_name || '',
            cover: artwork['1000x1000'] || artwork['480x480'] || artwork['150x150'] || '',
        },
        audioQuality: 'MP3',
        source: 'audius',
        provider: 'audius',
        isrc: item?.isrc || undefined,
    };
}

function atobSafe(base64: string): string {
    try {
        const pad = base64.length % 4;
        let b64 = base64;
        if (pad > 0) b64 += '='.repeat(4 - pad);
        return atob(b64);
    } catch {
        return base64;
    }
}

export type TrackQualityInfo = {
    audioQuality: string;
    tags: string[];
};

export type StreamData = {
    url: string;
    isDash: boolean;
    dashXml?: string;
    // What the manifest says is actually being streamed. Lets the badge report a
    // real format instead of "Unverified" for sources we do not rip ourselves.
    format?: { codec: string | null; sampleRate: number | null; bitDepth: number | null; bitrate?: number | null };
    /** Tier that the endpoint actually resolved after any provider downgrade. */
    resolvedQuality?: AppStreamQuality;
};

export interface LyricLine {
    time: number;
    text: string;
    endTime?: number;
}

type AppleChartSong = {
    name: string;
    artistName: string;
    chartRank: number;
    chartMarket: string;
};

const GLOBAL_CHART_MARKETS = [
    { storefront: 'us', label: 'US' },
    { storefront: 'in', label: 'India' },
    { storefront: 'jp', label: 'Japan' },
    { storefront: 'br', label: 'Brazil' },
] as const;

let globalChartCatalogPromise: Promise<AppleChartSong[]> | null = null;

function normalizeSongText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replace(/\([^)]*\bfrom\b[^)]*\)/gi, ' ')
        .replace(/\[[^\]]*\bfrom\b[^\]]*\]/gi, ' ')
        .replace(/\([^)]*(feat|remaster|version|edit)[^)]*\)/gi, ' ')
        .replace(/\[[^\]]*(feat|remaster|version|edit)[^\]]*\]/gi, ' ')
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
        .trim();
}

function highestAvailableQuality(audioQuality: unknown, rawTags: unknown): string | undefined {
    const tags = Array.isArray(rawTags)
        ? rawTags.filter((tag): tag is string => typeof tag === 'string')
        : [];
    const declared = typeof audioQuality === 'string' ? audioQuality.toUpperCase() : '';
    if (tags.some(tag => /(?:HI[_-]?RES|HIRES)(?:[_-]?LOSSLESS)?/i.test(tag))
        || /(?:HI[_-]?RES|HIRES)(?:[_-]?LOSSLESS)?/i.test(declared)) {
        return 'HI_RES_LOSSLESS';
    }
    return typeof audioQuality === 'string' && audioQuality.trim() ? audioQuality : undefined;
}

export function getTidalSegmentProxyUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!TIDAL_SEGMENT_PROXY_URL || !PROXYABLE_TIDAL_AUDIO_HOSTS.has(parsed.hostname.toLowerCase())) return null;
        return `${TIDAL_SEGMENT_PROXY_URL}${encodeURIComponent(url)}`;
    } catch {
        return null;
    }
}

function proxyTemplateUrl(url: string): string | null {
    const placeholders: string[] = [];
    const protectedUrl = url.replace(/\$[^$]+\$/g, token => {
        const marker = `GROOVIXDASHTEMPLATE${placeholders.length}`;
        placeholders.push(token);
        return marker;
    });
    const proxied = getTidalSegmentProxyUrl(protectedUrl);
    if (!proxied) return null;
    return placeholders.reduce(
        (value, token, index) => value.replace(`GROOVIXDASHTEMPLATE${index}`, token),
        proxied,
    );
}

/** Build a local DASH manifest whose TIDAL CDN requests use our VPS.
 * The normal remote manifest remains the primary path; this is only called after
 * ExoPlayer reports a direct-stream failure.
 */
export async function getTidalProxyDashManifest(mpdUrl: string): Promise<string | null> {
    const response = await fetchWithTimeout(mpdUrl);
    if (!response.ok) return null;
    const original = await response.text();
    const baseMatch = original.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
    let segmentBase = mpdUrl;
    if (baseMatch?.[1]) {
        try {
            segmentBase = new URL(baseMatch[1].replace(/&amp;/g, '&').trim(), mpdUrl).toString();
        } catch { /* use the manifest URL */ }
    }

    let replacements = 0;
    let rewritten = original.replace(/\b(media|initialization|sourceURL)="([^"]+)"/gi, (whole, name: string, raw: string) => {
        try {
            const absolute = new URL(raw.replace(/&amp;/g, '&'), segmentBase).toString();
            const proxied = proxyTemplateUrl(absolute);
            if (!proxied) return whole;
            replacements += 1;
            return `${name}="${proxied.replace(/&/g, '&amp;')}"`;
        } catch {
            return whole;
        }
    });

    // Some manifests expose one complete audio resource only through BaseURL.
    if (replacements === 0 && baseMatch?.[1]) {
        try {
            const absolute = new URL(baseMatch[1].replace(/&amp;/g, '&').trim(), mpdUrl).toString();
            const proxied = getTidalSegmentProxyUrl(absolute);
            if (proxied) {
                rewritten = rewritten.replace(baseMatch[1], proxied.replace(/&/g, '&amp;'));
                replacements += 1;
            }
        } catch { /* unsupported manifest shape */ }
    }
    return replacements > 0 ? rewritten : null;
}

function searchTrackScore(query: string, track: Track): number {
    const wanted = normalizeSongText(query);
    const title = normalizeSongText(track.title);
    const artist = normalizeSongText(track.artist?.name || '');
    const album = normalizeSongText(track.album?.title || '');
    const words = wanted.split(' ').filter(Boolean);
    let score = 0;
    if (title === wanted) score += 120;
    else if (`${title} ${artist}`.trim() === wanted) score += 110;
    else if (title.startsWith(wanted)) score += 75;
    else if (title.includes(wanted)) score += 55;
    if (artist === wanted) score += 100;
    else if (artist.startsWith(wanted)) score += 60;
    else if (artist.includes(wanted)) score += 40;
    if (album === wanted) score += 35;
    for (const word of words) {
        if (title.includes(word)) score += 8;
        if (artist.includes(word)) score += 6;
        if (album.includes(word)) score += 2;
    }
    score += Math.min(Number(track.popularity) || 0, 100) / 20;
    if (!recordingVariant(query) && recordingVariant(track.title)) score -= 80;
    const indiaIntent = /\b(india|indian|hindi|bollywood|punjabi|tamil|telugu|malayalam|kannada|bengali|marathi|gujarati|desi)\b/.test(wanted);
    const indianContext = `${title} ${artist} ${album}`;
    if (indiaIntent && /\b(hindi|bollywood|punjabi|tamil|telugu|malayalam|kannada|bengali|marathi|gujarati|desi|india)\b/.test(indianContext)) score += 24;
    return score;
}

function indianSearchQueries(query: string): string[] {
    const normalized = normalizeSongText(query);
    const language = ['hindi', 'punjabi', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'gujarati']
        .find(item => normalized.includes(item));
    // Expand browse categories, not exact songs/artists: appending "Bollywood"
    // to every Arijit/Pritam song caused unrelated matches and request fan-out.
    if (!/^(india|indian|desi|bollywood|hindi|punjabi|tamil|telugu|malayalam|kannada|bengali|marathi|gujarati)( (top|trending|hits|latest|songs|music|now|right|new))*$/.test(normalized)) return [];
    const broadIndiaIntent = /\b(india|indian|desi|bollywood)\b/.test(normalized);
    if (!language && !broadIndiaIntent) return [];
    return [...new Set([
        language ? `${query} ${language} songs` : `${query} Indian songs`,
        language === 'hindi' || broadIndiaIntent ? `${query} Bollywood` : '',
        `${query} latest hits`,
    ].filter(Boolean))];
}

function mergeSearchTracks(query: string, groups: Track[][]): Track[] {
    const byIdentity = new Map<string, { track: Track; order: number }>();
    let order = 0;
    for (const tracks of groups) {
        for (const track of tracks) {
            const identity = track.isrc
                ? `isrc:${track.isrc.toUpperCase()}`
                : track.source === 'tidal'
                    ? `tidal:${track.id}`
                    : `${normalizeSongText(track.title)}|${normalizeSongText(track.artist?.name || '')}`;
            if (!identity.endsWith('|') && !byIdentity.has(identity)) {
                byIdentity.set(identity, { track, order });
                order += 1;
            }
        }
    }
    return [...byIdentity.values()]
        .sort((left, right) => searchTrackScore(query, right.track) - searchTrackScore(query, left.track) || left.order - right.order)
        .map(item => item.track);
}

function chartMatchScore(song: AppleChartSong, track: Track): number {
    const expectedTitle = normalizeSongText(song.name);
    const expectedArtist = normalizeSongText(song.artistName);
    const title = normalizeSongText(track.title);
    const artist = normalizeSongText(track.artist?.name || '');
    let score = 0;
    if (title === expectedTitle) score += 8;
    else if (title.includes(expectedTitle) || expectedTitle.includes(title)) score += 4;
    if (artist === expectedArtist) score += 6;
    else if (artist.includes(expectedArtist) || expectedArtist.includes(artist)) score += 3;
    return score;
}

async function getGlobalChartCatalog(): Promise<AppleChartSong[]> {
    if (globalChartCatalogPromise) return globalChartCatalogPromise;
    globalChartCatalogPromise = Promise.allSettled(GLOBAL_CHART_MARKETS.map(async market => {
        const url = `https://rss.marketingtools.apple.com/api/v2/${market.storefront}/music/most-played/100/songs.json`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`Apple chart ${market.storefront} ${response.status}`);
        const json = await response.json();
        const results: any[] = Array.isArray(json?.feed?.results) ? json.feed.results : [];
        return results.map((item, index) => ({
            name: item.name || '',
            artistName: item.artistName || '',
            chartRank: index + 1,
            chartMarket: market.label,
        })).filter(song => song.name && song.artistName);
    })).then(results => {
        const marketCharts = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        if (marketCharts.length === 0) throw new Error('No global chart storefronts available');
        const mixed: AppleChartSong[] = [];
        const seen = new Set<string>();
        for (let rank = 0; rank < 100; rank += 1) {
            for (const marketChart of marketCharts) {
                const song = marketChart[rank];
                if (!song) continue;
                const key = `${normalizeSongText(song.name)}|${normalizeSongText(song.artistName)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                mixed.push(song);
            }
        }
        return mixed;
    }).catch(error => {
        globalChartCatalogPromise = null;
        throw error;
    });
    return globalChartCatalogPromise;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

export function parseLRCString(lrc: string): LyricLine[] {
    return parseLRC(lrc);
}

function parseTTMLTime(t: string): number {
    const parts = t.split(':');
    if (parts.length === 1) return parseFloat(parts[0]);
    if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function parseTTML(ttml: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const rx = /<p\b[^>]*begin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(ttml)) !== null) {
        const time = parseTTMLTime(m[1]);
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text) lines.push({ time, text });
    }
    return lines;
}

export function parseTTMLString(ttml: string): LyricLine[] {
    return parseTTML(ttml);
}

function parseLRC(lrc: string): LyricLine[] {
    const lines = lrc.split('\n');
    const result: LyricLine[] = [];
    const regex = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\]\s*(.*)/;
    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
            const time = minutes * 60 + seconds + ms / 1000;
            const text = match[4].trim();
            if (text) result.push({ time, text });
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

/** The only cover dimensions Tidal serves; anything else comes back 403. */
const TIDAL_COVER_SIZES = [80, 160, 320, 640, 750, 1080, 1280];

function tidalCoverSize(size: number): string {
    // Round *up* so artwork is never upscaled into a blurry thumbnail.
    const px = TIDAL_COVER_SIZES.find(s => s >= size) ?? TIDAL_COVER_SIZES[TIDAL_COVER_SIZES.length - 1];
    return `${px}x${px}`;
}

/**
 * Find the same song on Audius and hand back a playable stream.
 *
 * Matched on title + artist rather than any shared id — the two catalogues have
 * nothing in common — so the result is only accepted when both clearly agree,
 * otherwise we would cheerfully play a different song with a similar name.
 */
async function resolveViaAudius(track: Track, _quality: AppStreamQuality): Promise<StreamData | null> {
    const title = (track.title || '').trim();
    const artist = (track.artist?.name || '').trim();
    if (!title) return null;

    try {
        const query = `${title} ${artist}`.trim();
        const res = await fetchWithTimeout(`${AUDIUS_URL}/tracks/search?query=${encodeURIComponent(query)}`);
        if (!res.ok) return null;
        const items: any[] = (await res.json())?.data || [];
        if (items.length === 0) return null;

        const wantTitle = normalizeSongText(title);
        const wantArtist = normalizeSongText(artist);
        const scored = items
            .filter(i => i?.id && i?.title && Number(i.duration) > 35)
            .filter(i => sameRecording({ title, artist, duration: track.duration }, mapAudiusTrack(i)))
            .map(i => {
                const t = normalizeSongText(i.title);
                const a = normalizeSongText(i.user?.name || '');
                let score = 0;
                if (t === wantTitle) score += 8;
                else if (t.includes(wantTitle) || wantTitle.includes(t)) score += 4;
                if (wantArtist) {
                    if (a === wantArtist) score += 6;
                    else if (a.includes(wantArtist) || wantArtist.includes(a)) score += 3;
                    if (t.includes(wantArtist)) score += 4;
                }
                if (track.duration > 35 && Math.abs(Number(i.duration) - track.duration) <= 12) score += 3;
                return { item: i, score };
            })
            .sort((x, y) => y.score - x.score);

        // Require title + artist attribution + matching full duration. Audius
        // may put the original artist in the title when the uploader differs.
        const best = scored[0];
        if (!best || best.score < 11) return null;

        return {
            url: `${AUDIUS_URL}/tracks/${encodeURIComponent(String(best.item.id))}/stream`,
            isDash: false,
            format: { codec: 'MP3', sampleRate: null, bitDepth: null, bitrate: null },
            resolvedQuality: 'HIGH',
        };
    } catch {
        return null;
    }
}

/**
 * Resolve the same recording through JioSaavn after Rhythmax is exhausted.
 * The catalogue has unrelated ids, so require title, credited artist and a
 * compatible duration before accepting a result. This avoids substituting a
 * cover/remix merely because its title looks similar.
 */
async function resolveViaSaavn(track: Track, quality: AppStreamQuality): Promise<StreamData | null> {
    const title = (track.title || '').trim();
    const artist = (track.artist?.name || '').trim();
    if (!title) return null;

    try {
        const response = await fetchWithTimeout(`${SAAVN_SEARCH_URL}${encodeURIComponent(`${title} ${artist}`.trim())}`);
        if (!response.ok) return null;
        const items: any[] = (await response.json())?.results || [];
        const wantTitle = normalizeSongText(title);
        const wantArtist = normalizeSongText(artist);

        const matches = items
            .filter(item => item?.perma_url && item?.title && Number(item?.more_info?.duration) > 35)
            .filter(item => sameRecording({ title, artist, duration: track.duration }, {
                ...track,
                title: String(item.title),
                duration: Number(item.more_info.duration),
                artist: { id: 0, name: String(item.subtitle || '') },
                artists: (item.more_info?.artistMap?.primary_artists || []).map((entry: { name: string }) => ({ id: 0, name: entry.name })),
            }))
            .map(item => {
                const candidateTitle = normalizeSongText(String(item.title));
                const credits = normalizeSongText(`${item.subtitle || ''} ${item?.more_info?.artistMap?.primary_artists?.map((entry: any) => entry?.name).join(' ') || ''}`);
                const duration = Number(item?.more_info?.duration) || 0;
                let score = 0;
                if (candidateTitle === wantTitle) score += 9;
                else if (candidateTitle.includes(wantTitle) || wantTitle.includes(candidateTitle)) score += 4;
                if (wantArtist && credits.includes(wantArtist)) score += 7;
                if (track.duration > 35 && Math.abs(duration - track.duration) <= 12) score += 4;
                return { item, score };
            })
            .sort((a, b) => b.score - a.score);

        const best = matches[0];
        if (!best || best.score < 16) return null;

        // The rhythmax detail worker is gone (Cloudflare 1042); JioSaavn's own
        // web API returns the same song record from the perma URL's token.
        const token = String(best.item.perma_url).split('/').filter(Boolean).pop() || '';
        const detailResponse = await fetchWithTimeout(`${SAAVN_DETAIL_URL}${encodeURIComponent(token)}`);
        if (!detailResponse.ok) return null;
        const detailJson: any = await detailResponse.json();
        const detail: any = detailJson?.songs?.[0] ?? detailJson?.[token] ?? detailJson;
        const encrypted = detail?.more_info?.encrypted_media_url;
        if (typeof encrypted !== 'string' || !encrypted) return null;

        // JioSaavn media URLs use DES-ECB with the established 8-byte key.
        const cipher = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(encrypted) });
        const decrypted = CryptoJS.DES.decrypt(cipher, CryptoJS.enc.Utf8.parse('38346591'), {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        }).toString(CryptoJS.enc.Utf8);
        if (!/^https:\/\//i.test(decrypted)) return null;

        const bitrate = quality === 'LOW' ? 96 : 320;
        const streamUrl = decrypted.replace(/_\d+\.mp4(\?.*)?$/i, `_${bitrate}.mp4$1`);
        if (streamUrl === decrypted && !/_\d+\.mp4(?:\?.*)?$/i.test(decrypted)) return null;

        const probe = await fetchWithTimeout(streamUrl, { method: 'HEAD' }, 8_000);
        if (!probe.ok) return null;
        const contentLength = Number(probe.headers.get('content-length')) || 0;
        const expectedBytes = track.duration > 0 ? track.duration * bitrate * 1000 / 8 : 0;
        if (contentLength > 0 && expectedBytes > 0 && contentLength < expectedBytes * 0.5) return null;

        return {
            url: streamUrl,
            isDash: false,
            format: { codec: 'AAC', sampleRate: null, bitDepth: null, bitrate: bitrate * 1_000 },
            resolvedQuality: bitrate === 320 ? 'HIGH' : 'LOW',
        };
    } catch {
        return null;
    }
}

/** Tidal-shaped search item → our Track. Shared: rhythmax and monochrome both
 *  return the same shape, so the two search paths must not drift apart. */
function mapTidalItem(item: any): Track {
    const tags: string[] = Array.isArray(item?.mediaMetadata?.tags)
        ? item.mediaMetadata.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
        : [];
    const artists: Artist[] = (Array.isArray(item?.artists) ? item.artists : [])
        .filter((artist: any) => Number(artist?.id) > 0 && typeof artist?.name === 'string' && artist.name.trim())
        .map((artist: any) => ({
            id: Number(artist.id),
            name: artist.name.trim(),
            picture: typeof artist.picture === 'string' ? artist.picture : undefined,
        }));
    const primaryArtist = item?.artist || artists[0];
    return {
        id: Number(item.id),
        title: String(item.title || '').trim(),
        duration: Number(item.duration) || 0,
        artist: {
            id: Number(primaryArtist?.id) || 0,
            name: String(primaryArtist?.name || '').trim(),
            picture: typeof primaryArtist?.picture === 'string' ? primaryArtist.picture : undefined,
        },
        artists,
        album: {
            id: Number(item.album?.id) || 0,
            title: String(item.album?.title || '').trim(),
            cover: typeof item.album?.cover === 'string' ? item.album.cover : '',
        },
        audioQuality: highestAvailableQuality(item.audioQuality, tags),
        mediaMetadata: tags.length > 0 ? { tags } : undefined,
        source: 'tidal' as const,
        isrc: typeof item.isrc === 'string' ? item.isrc : undefined,
        trackNumber: Number(item.trackNumber) || undefined,
        explicit: typeof item.explicit === 'boolean' ? item.explicit : undefined,
        releaseDate: typeof item.album?.releaseDate === 'string' ? item.album.releaseDate : undefined,
        popularity: Number.isFinite(Number(item.popularity)) ? Number(item.popularity) : undefined,
    };
}

function mapTidalArtist(item: any): Artist | null {
    const id = Number(item?.id);
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!id || !name) return null;
    return {
        id,
        name,
        picture: typeof item.picture === 'string' ? item.picture : undefined,
        popularity: Number.isFinite(Number(item.popularity)) ? Number(item.popularity) : undefined,
        artistTypes: Array.isArray(item.artistTypes)
            ? item.artistTypes.filter((type: unknown): type is string => typeof type === 'string')
            : undefined,
    };
}

function mapTidalAlbum(item: any): Album | null {
    const id = Number(item?.id);
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!id || !title) return null;
    const artists = (Array.isArray(item?.artists) ? item.artists : [])
        .map(mapTidalArtist)
        .filter((artist: Artist | null): artist is Artist => artist !== null);
    const primaryArtist = mapTidalArtist(item?.artist) || artists[0];
    const tags = Array.isArray(item?.mediaMetadata?.tags)
        ? item.mediaMetadata.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
        : [];
    return {
        id,
        title,
        cover: typeof item.cover === 'string' ? item.cover : '',
        artist: primaryArtist,
        artists,
        numberOfTracks: Number(item.numberOfTracks) || undefined,
        duration: Number(item.duration) || undefined,
        releaseDate: typeof item.releaseDate === 'string' ? item.releaseDate : undefined,
        audioQuality: highestAvailableQuality(item.audioQuality, tags),
        mediaMetadata: tags.length > 0 ? { tags } : undefined,
        explicit: typeof item.explicit === 'boolean' ? item.explicit : undefined,
    };
}

function mapTidalPlaylist(item: any): Playlist | null {
    const id = typeof item?.uuid === 'string' ? item.uuid : (typeof item?.id === 'string' ? item.id : '');
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!id || !title) return null;
    const creatorName = typeof item?.creator?.name === 'string'
        ? item.creator.name
        : (typeof item?.creator?.username === 'string' ? item.creator.username : undefined);
    return {
        id,
        title,
        cover: item.squareImage || item.image || item.customImageUrl || '',
        numberOfTracks: Number(item.numberOfTracks) || 0,
        duration: Number(item.duration) || 0,
        description: typeof item.description === 'string' ? item.description : undefined,
        creatorName,
        updatedAt: typeof item.lastUpdated === 'string' ? item.lastUpdated : undefined,
    };
}

function sectionItems(payload: any, key: string): any[] {
    const root = payload?.data ?? payload;
    const section = root?.[key];
    if (Array.isArray(section)) return section;
    return Array.isArray(section?.items) ? section.items : [];
}

async function searchTidalSection(parameter: 'a' | 'al' | 'p', key: 'artists' | 'albums' | 'playlists', query: string): Promise<any[]> {
    try {
        const response = await catalogFetch(`/search/?${parameter}=${encodeURIComponent(query.trim())}`);
        if (!response.ok) return [];
        return sectionItems(await response.json(), key);
    } catch {
        return [];
    }
}

/** App quality names → the values the Tidal manifest API actually accepts. */
const RHYTHMAX_QUALITY: Record<string, string> = {
    HI_RES_LOSSLESS: 'HI_RES',
    LOSSLESS: 'LOSSLESS',
    HIGH: 'HIGH',
    LOW: 'LOW',
};

// Rhythmax correctly returns 500 when a requested tier is not available for a
// particular master. Try only sensible lower tiers and report the one that
// actually resolved; never label that response as the original request.
const RHYTHMAX_FALLBACKS: Record<AppStreamQuality, AppStreamQuality[]> = {
    HI_RES_LOSSLESS: ['HI_RES_LOSSLESS', 'LOSSLESS'],
    LOSSLESS: ['LOSSLESS'],
    HIGH: ['HIGH', 'LOSSLESS'],
    LOW: ['LOW', 'HIGH', 'LOSSLESS'],
};

function normalizeAppQuality(quality: string): AppStreamQuality {
    return quality === 'HI_RES_LOSSLESS' || quality === 'LOSSLESS' || quality === 'HIGH' || quality === 'LOW'
        ? quality
        : 'LOSSLESS';
}

/**
 * Read the real codec/rate/depth out of the DASH manifest.
 *
 * The Representation id carries them directly ("FLAC_HIRES,48000,24"), which is
 * more trustworthy than the quality we asked for — the server can hand back a
 * lower tier than requested and the badge should say what is actually playing.
 */
function parseIsoDuration(value: string): number {
    const match = value.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!match) return 0;
    return Number(match[1] || 0) * 86400
        + Number(match[2] || 0) * 3600
        + Number(match[3] || 0) * 60
        + Number(match[4] || 0);
}

export function getDashManifestDuration(mpd: string): number {
    const declared = mpd.match(/mediaPresentationDuration="([^"]+)"/i)?.[1];
    if (declared) return parseIsoDuration(declared);

    const template = mpd.match(/<SegmentTemplate\b[^>]*>/i)?.[0] || '';
    const timescale = Number(template.match(/timescale="(\d+)"/i)?.[1] || 1);
    const timeline = mpd.match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/i)?.[1] || '';
    if (!timeline || !Number.isFinite(timescale) || timescale <= 0) return 0;
    const units = [...timeline.matchAll(/<S\b([^>]*)\/?\s*>/gi)].reduce((total, entry) => {
        const duration = Number(entry[1].match(/\bd="(\d+)"/i)?.[1] || 0);
        const repeat = Number(entry[1].match(/\br="(-?\d+)"/i)?.[1] || 0);
        return repeat < 0 ? total : total + duration * (repeat + 1);
    }, 0);
    return units / timescale;
}

async function describeManifest(uri: string): Promise<{ format?: StreamData['format']; duration: number }> {
    try {
        const response = await fetchWithTimeout(uri);
        if (!response.ok) return { duration: 0 };
        const mpd = await response.text();
        const id = mpd.match(/<Representation[^>]*\bid="([^"]+)"/i)?.[1] || '';
        const representation = mpd.match(/<Representation[^>]*>/i)?.[0] || '';
        const [name, rate, depth] = id.split(',').map(value => value.trim());
        const rawCodec = mpd.match(/codecs="([^"]+)"/i)?.[1] || (name?.startsWith('FLAC') ? 'flac' : null);
        const codec = rawCodec && /^mp4a/i.test(rawCodec) ? 'AAC' : rawCodec;
        const parsedRate = Number(rate) || Number(representation.match(/audioSamplingRate="(\d+)"/i)?.[1]) || null;
        const parsedDepth = Number(depth)
            || Number(representation.match(/(?:audioBitDepth|bitsPerSample|bitDepth)="(\d+)"/i)?.[1])
            || (/FLAC[_-]?HIRES/i.test(name || '') ? 24 : null);
        return {
            duration: getDashManifestDuration(mpd),
            format: {
                codec: codec ? codec.toUpperCase() : null,
                sampleRate: parsedRate,
                bitDepth: parsedDepth,
                bitrate: Number(representation.match(/bandwidth="(\d+)"/i)?.[1]) || null,
            },
        };
    } catch {
        return { duration: 0 };
    }
}

function qualityFromManifest(format: StreamData['format'], requested: AppStreamQuality): AppStreamQuality {
    const codec = format?.codec?.toUpperCase() || '';
    if (codec === 'FLAC' || codec === 'ALAC') {
        return (format?.bitDepth || 0) > 16 || (format?.sampleRate || 0) > 48_000
            ? 'HI_RES_LOSSLESS'
            : 'LOSSLESS';
    }
    if (codec === 'AAC' || codec.startsWith('MP4A')) {
        if (format?.bitrate) return format.bitrate <= 128_000 ? 'LOW' : 'HIGH';
        return requested === 'LOW' ? 'LOW' : 'HIGH';
    }
    return requested;
}

export const API = {
    getCoverUrl(coverId?: string, size: number = 640): string {
        if (!coverId) return '';
        if (coverId.startsWith('/') || coverId.startsWith('file://')) return coverId;
        if (coverId.startsWith('https://i.audiomack.com/')) return `${coverId}?width=${size}`;
        if (coverId.startsWith('http')) return coverId;
        const formatted = coverId.replace(/-/g, '/');
        // Tidal only renders a fixed set of sizes and 403s everything else, so a
        // layout asking for 180 or 300 gets no artwork at all. Round up to the
        // next size it actually serves rather than making every call site
        // remember the list.
        return `https://resources.tidal.com/images/${formatted}/${tidalCoverSize(size)}.jpg`;
    },

    async search(query: string, _quality?: string): Promise<Track[]> {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const cacheKey = normalizeMusicText(trimmed);
        const cached = trackSearchCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.tracks;
        const pending = trackSearchRequests.get(cacheKey);
        if (pending) return pending;

        const request = (async () => {

        // Rhythmax stays first in each duplicate group because its Tidal ids
        // resolve through our lossless playback path. Merge the second catalog
        // instead of discarding it, then use Audius only for sparse results.
        const [rhythmaxResult, tidalResult] = await Promise.allSettled([
            API.searchRhythmax(trimmed),
            API.searchTidal(trimmed),
        ]);
        const rhythmax = rhythmaxResult.status === 'fulfilled' ? rhythmaxResult.value : [];
        const tidal = tidalResult.status === 'fulfilled' ? tidalResult.value : [];
        let tracks = mergeSearchTracks(trimmed, [rhythmax, tidal]);
        if (tracks.length < 12) {
            const queries = indianSearchQueries(trimmed);
            for (const queryVariant of queries) {
                const expanded = await API.searchRhythmax(queryVariant);
                tracks = mergeSearchTracks(trimmed, [tracks, expanded]);
                if (tracks.length >= 24) break;
            }
        }
        if (tracks.length < 12) {
            const audius = await API.searchAudius(trimmed);
            tracks = mergeSearchTracks(trimmed, [tracks, audius]);
        }

        if (tracks.length > 0 && trackSearchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
            const oldestKey = trackSearchCache.keys().next().value;
            if (oldestKey) trackSearchCache.delete(oldestKey);
        }
        // Failed/empty requests must not replace a useful cache entry for minutes.
        if (tracks.length > 0) trackSearchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, tracks });
        return tracks.length > 0 ? tracks : (cached?.tracks || []);
        })();
        trackSearchRequests.set(cacheKey, request);
        try { return await request; }
        finally { trackSearchRequests.delete(cacheKey); }
    },

    async searchRhythmax(query: string): Promise<Track[]> {
        try {
            const json = objectRecord(await catalogRequest(`${RHYTHMAX_URL}/tracks?q=${encodeURIComponent(query)}`));
            const items: any[] = Array.isArray(json?.items) ? json.items : [];
            return items.filter(i => i?.id && i?.title).map(mapTidalItem);
        } catch {
            return [];
        }
    },

    async searchAudius(query: string): Promise<Track[]> {
        try {
            const json = objectRecord(await catalogRequest(`${AUDIUS_URL}/tracks/search?query=${encodeURIComponent(query)}`));
            const items: any[] = Array.isArray(json?.data) ? json.data : [];
            return items.filter(item => item?.id && item?.title).map(mapAudiusTrack);
        } catch {
            return [];
        }
    },

    async searchTidal(query: string): Promise<Track[]> {
        try {
            const json = objectRecord(await catalogJson(`/search/?s=${encodeURIComponent(query)}`));
            const data = objectRecord(json.data);
            const items: any[] = Array.isArray(data.items) ? data.items : sectionItems(json, 'tracks');
            return items
                .map(mapTidalItem)
                .filter((track: Track) => track.id > 0 && Boolean(track.title) && Boolean(track.artist.name));
        } catch {
            return [];
        }
    },

    /**
     * Search each catalog entity through its real provider endpoint. These must
     * stay separate: grouping track results by text creates fake albums and
     * playlists and loses authoritative counts, artwork and identifiers.
     */
    async searchCatalog(query: string): Promise<CatalogSearchResult> {
        if (!query.trim()) return { tracks: [], albums: [], artists: [], playlists: [] };
        const [tracks, artists, albums, playlists] = await Promise.all([
            API.search(query),
            API.searchArtists(query),
            API.searchAlbums(query),
            API.searchPlaylists(query),
        ]);

        return { tracks, artists, albums, playlists };
    },

    async searchArtists(query: string): Promise<Artist[]> {
        return (await searchTidalSection('a', 'artists', query))
            .map(mapTidalArtist)
            .filter((artist: Artist | null): artist is Artist => artist !== null);
    },

    async searchAlbums(query: string): Promise<Album[]> {
        return (await searchTidalSection('al', 'albums', query))
            .map(mapTidalAlbum)
            .filter((album: Album | null): album is Album => album !== null);
    },

    async searchPlaylists(query: string): Promise<Playlist[]> {
        return (await searchTidalSection('p', 'playlists', query))
            .map(mapTidalPlaylist)
            .filter((playlist: Playlist | null): playlist is Playlist => playlist !== null);
    },

    async getGlobalChart(limit: number = 60, index: number = 0): Promise<Track[]> {
        try {
            return (await API.getGlobalChartPage(limit, index)).tracks;
        } catch { return []; }
    },

    async getGlobalChartPage(limit = 16, index = 0): Promise<{ tracks: Track[]; nextIndex: number; hasMore: boolean }> {
            const safeLimit = Math.max(1, Math.min(limit, 50));
            const safeIndex = Math.max(0, index);
            const catalog = await getGlobalChartCatalog();
            const page = catalog.slice(safeIndex, safeIndex + safeLimit);
            const resolved = await mapWithConcurrency(page, 4, async song => {
                try {
                    const candidates = await API.search(`${song.name} ${song.artistName}`);
                    const best = [...candidates].sort((a, b) => chartMatchScore(song, b) - chartMatchScore(song, a))[0];
                    if (!best || chartMatchScore(song, best) < 7) return null;
                    return {
                        ...best,
                        chartRank: song.chartRank,
                        chartMarket: song.chartMarket,
                    } satisfies Track;
                } catch {
                    return null;
                }
            });
            return {
                tracks: resolved.filter((track): track is NonNullable<typeof track> => track !== null),
                nextIndex: safeIndex + page.length,
                hasMore: safeIndex + page.length < catalog.length,
            };
    },

    async getTrackInfo(trackId: number): Promise<TrackQualityInfo> {
        try {
            let res = await catalogFetch(`/info/?id=${trackId}`).catch(() => null);
            if (!res?.ok) res = await fetchWithTimeout(`${RHYTHMAX_URL}/track?id=${trackId}`);
            if (!res.ok) throw new Error('Info fetch failed');
            const json = await res.json();
            const d = json?.data ?? json;
            const tags = Array.isArray(d.mediaMetadata?.tags)
                ? d.mediaMetadata.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
                : [];
            const audioQuality = highestAvailableQuality(d.audioQuality, tags) || 'UNKNOWN';
            return { audioQuality, tags: tags.length > 0 ? tags : [audioQuality] };
        } catch {
            // Unknown is safer than inventing LOSSLESS. Empty tags leave all
            // choices enabled while playback performs the real endpoint probe.
            return { audioQuality: 'UNKNOWN', tags: [] };
        }
    },

    async getRecommendations(_trackId: number): Promise<Track[]> {
        return [];
    },

    async getAlbum(albumId: number): Promise<{ album: any; tracks: Track[] }> {
        try {
            const res = await catalogFetch(`/album/?id=${albumId}`);
            if (!res.ok) throw new Error('Album fetch failed');
            const json = await res.json();
            const data = json?.data ?? json;
            const items = data.items || [];
            const tracks = items
                .filter((i: any) => i.type === 'track')
                .map((i: any) => mapTidalItem(i.item))
                .filter((track: Track) => track.id > 0 && track.title && track.artist.name);
            const mappedAlbum = mapTidalAlbum(data);
            return {
                album: mappedAlbum ? { ...mappedAlbum, copyright: data.copyright } : null,
                tracks,
            };
        } catch (e) {
            console.log('Album fetch error:', e);
            return { album: null, tracks: [] };
        }
    },

    /** Artist page: profile, top songs by popularity, and releases split by type. */
    async getArtist(artistId: number): Promise<{ artist: Artist | null; topTracks: Track[]; albums: Album[]; singles: Album[] }> {
        try {
            const [profileRes, contentRes] = await Promise.all([
                catalogFetch(`/artist/?id=${artistId}`),
                catalogFetch(`/artist/?f=${artistId}`),
            ]);
            const profile = profileRes.ok ? await profileRes.json() : null;
            const content = contentRes.ok ? await contentRes.json() : null;
            const artist = profile?.artist ? mapTidalArtist(profile.artist) : null;
            const rawTracks: any[] = Array.isArray(content?.tracks) ? content.tracks : [];
            const seen = new Set<string>();
            const topTracks = rawTracks
                .slice()
                .sort((a, b) => (b?.popularity || 0) - (a?.popularity || 0))
                .map(mapTidalItem)
                .filter(track => {
                    const key = `${track.title}`.toLocaleLowerCase();
                    if (!(track.id > 0) || !track.title || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, 20);
            const releases: any[] = content?.albums?.items ?? [];
            const mapped = releases
                .map(item => ({ item, album: mapTidalAlbum(item) }))
                .filter((entry): entry is { item: any; album: Album } => Boolean(entry.album))
                .sort((a, b) => (b.album.releaseDate || '').localeCompare(a.album.releaseDate || ''));
            return {
                artist,
                topTracks,
                albums: mapped.filter(entry => entry.item.type === 'ALBUM').map(entry => entry.album),
                singles: mapped.filter(entry => entry.item.type !== 'ALBUM').map(entry => entry.album),
            };
        } catch (e) {
            console.log('Artist fetch error:', e);
            return { artist: null, topTracks: [], albums: [], singles: [] };
        }
    },

    async getPlaylist(playlistId: string): Promise<{ playlist: Playlist | null; tracks: Track[] }> {
        try {
            const response = await catalogFetch(`/playlist/?id=${encodeURIComponent(playlistId)}`);
            if (!response.ok) throw new Error('Playlist fetch failed');
            const json = await response.json();
            const data = json?.data ?? json;
            const playlist = mapTidalPlaylist(data?.playlist);
            const tracks = (Array.isArray(data?.items) ? data.items : [])
                .filter((entry: any) => entry?.type === 'track' && entry?.item)
                .map((entry: any) => mapTidalItem(entry.item))
                .filter((track: Track) => track.id > 0 && track.title && track.artist.name);
            return { playlist, tracks };
        } catch (error) {
            console.log('Playlist fetch error:', error);
            return { playlist: null, tracks: [] };
        }
    },

    async getTrackStreamData(track: Track | number, quality: string = 'LOSSLESS'): Promise<StreamData> {
        await loadAppSettings();
        const trackId = typeof track === 'number' ? track : track.id;

        if (typeof track !== 'number' && track.source === 'audius' && track.providerId) {
            return {
                url: `${AUDIUS_URL}/tracks/${encodeURIComponent(track.providerId)}/stream`,
                isDash: false,
                format: { codec: 'MP3', sampleRate: null, bitDepth: null, bitrate: null },
                resolvedQuality: 'HIGH',
            };
        }

        // Primary: rhythmax — Tidal HI_RES FLAC by the same Tidal track id, with
        // no auth, no Turnstile, and no DRM (the .mpd carries no ContentProtection),
        // so the manifest plays directly. Replaces the old monochrome source, which
        // now sits behind a Turnstile gate and 403s. Any failure falls through to
        // the legacy path below.
        const requested = normalizeAppQuality(quality);
        // A hifi-api host: /track returns either a direct URL or a DASH manifest.
        const viaHifi = async (base: string): Promise<StreamData | null> => {
            try {
            const res = await fetchWithTimeout(`${base}/track/?id=${trackId}&quality=${requested}`);
                if (!res.ok) return null;
                const data = await res.json();
                const container = data?.data ?? data;
    
                const reportedQuality = typeof container.audioQuality === 'string'
                    ? normalizeAppQuality(container.audioQuality)
                    : (typeof container.quality === 'string' ? normalizeAppQuality(container.quality) : undefined);
                if (container.OriginalTrackUrl) return { url: container.OriginalTrackUrl, isDash: false, resolvedQuality: reportedQuality };
                if (container.originalTrackUrl) return { url: container.originalTrackUrl, isDash: false, resolvedQuality: reportedQuality };
    
                const manifest = container.manifest;
                if (!manifest) return null;
    
                const decoded = atobSafe(manifest);
                const mimeType = container.manifestMimeType || '';
    
                if (mimeType === 'application/dash+xml' || decoded.includes('<MPD')) {
                    {
                    // The Representation id reads like "FLAC,44100,16"; codecs and rate are attributes.
                    const rep = decoded.match(/<Representation[^>]*>/)?.[0] ?? '';
                    const [idCodec, idRate, idDepth] = (rep.match(/id="([^"]+)"/)?.[1] ?? '').split(',');
                    const format = {
                        codec: (rep.match(/codecs="([^"]+)"/)?.[1] ?? idCodec ?? null)?.toUpperCase() ?? null,
                        sampleRate: Number(rep.match(/audioSamplingRate="(\d+)"/)?.[1] ?? idRate) || null,
                        bitDepth: Number(idDepth) || null,
                        bitrate: Number(rep.match(/bandwidth="(\d+)"/)?.[1]) || null,
                    };
                    return { url: '', isDash: true, dashXml: decoded, format, resolvedQuality: reportedQuality };
                }
                }
    
                try {
                    const parsed = JSON.parse(decoded);
                    if (parsed.urls && parsed.urls.length > 0) return { url: parsed.urls[0], isDash: false, resolvedQuality: reportedQuality };
                } catch { }
    
                const baseUrlMatch = decoded.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
                if (baseUrlMatch?.[1]) return { url: baseUrlMatch[1].trim(), isDash: false, resolvedQuality: reportedQuality };
    
                const urls = decoded.match(/https?:\/\/[^\s<"]+/g);
                if (urls && urls.length > 0) {
                    const valid = urls.filter((u: string) => !u.includes('w3.org'));
                    if (valid.length > 0) return { url: valid[0].replace(/&amp;/g, '&'), isDash: false, resolvedQuality: reportedQuality };
                }
    
                return null;
            } catch { return null; }
        };
        const viaTidal = async (): Promise<StreamData | null> => {
            // Your hifi-api server first; Rhythmax after it.
            const hifi = HIFI_API_URL ? await viaHifi(HIFI_API_URL) : null;
            if (hifi) return hifi;
            for (const candidate of RHYTHMAX_FALLBACKS[requested]) {
                try {
                    const wanted = RHYTHMAX_QUALITY[candidate];
                    const mres = await fetchWithTimeout(`${RHYTHMAX_URL}/manifests?id=${trackId}&quality=${wanted}`);
                    if (!mres.ok) continue;
                    const mjson = await mres.json();
                    const uri = mjson?.data?.attributes?.uri;
                    // Hand the player the remote .mpd URL directly. ExoPlayer infers
                    // DASH from the .mpd path and streams it.
                    if (typeof uri === 'string' && uri.includes('.mpd')) {
                        const { format, duration } = await describeManifest(uri);
                        if (!format?.codec) continue;
                        if (duration > 0 && duration <= 35) continue;
                        return { url: uri, isDash: false, format, resolvedQuality: qualityFromManifest(format, candidate) };
                    }
                } catch { /* try the next compatible tier */ }
            }
            return null;
        };

        // Sources are tried in the order chosen in Settings → Sources; one left
        // out is skipped. JioSaavn and Audius need the track's title and artist.
        for (const source of appSettings().sourceOrder) {
            const found = source === 'TIDAL' ? await viaTidal()
                : typeof track === 'number' ? null
                : source === 'JIOSAAVN' ? await resolveViaSaavn(track, requested)
                : await resolveViaAudius(track, requested);
            if (found) return found;
        }

        // Last resort: the catalogue host's own stream endpoint.
        const last = await viaHifi(MONOCHROME_URL);
        if (last) return last;
        throw new Error('No playable stream found');
    },

    async getFreeFallbackStream(track: Track): Promise<StreamData | null> {
        return (await resolveViaSaavn(track, 'HIGH')) || resolveViaAudius(track, 'HIGH');
    },

    async getLyrics(title: string, artist: string, album: string = '', durationSec: number = 0, _isrc?: string): Promise<LyricLine[]> {
        try {
            const lyricsSettings = await getLyricsSettings();
            const found = await fetchLyrics({
                title, artist, album: album || undefined, durationSec, isrc: _isrc,
                trackKey: `${artist}|${title}|${Math.round(durationSec)}`,
            }, {
                sources: lyricsSettings.enabled,
                order: lyricsSettings.order,
                prioritizeSyllableSync: lyricsSettings.prioritizeSyllableSync,
            });
            if (found && found.lines.length) {
                lastLyricsSource = LYRICS_SOURCES.find(source => source.id === found.source)?.label ?? null;
                return found.lines;
            }
            lastLyricsSource = null;
        } catch (e) {
            console.warn('[Lyrics] provider chain failed', e);
        }
        // LRCLIB is the primary source: its public contract matches by title,
        // artist, album and (critically) duration. The former Lyrics+ hosts now
        // fail DNS resolution and delayed every lyric load before this request.
        try {
            const lrcParams = new URLSearchParams({ track_name: title, artist_name: artist });
            if (album) lrcParams.append('album_name', album);
            if (durationSec > 0) lrcParams.append('duration', Math.round(durationSec).toString());
            const headers = { 'Lrclib-Client': 'Groovix v0.0.1' };

            const parseLyrics = (record: any): LyricLine[] => {
                if (typeof record?.syncedLyrics === 'string' && record.syncedLyrics.trim()) {
                    return parseLRC(record.syncedLyrics);
                }
                if (typeof record?.plainLyrics === 'string' && record.plainLyrics.trim()) {
                    return record.plainLyrics.split('\n')
                        .filter((line: string) => line.trim())
                        .map((line: string) => ({ time: -1, text: line.trim() }));
                }
                return [];
            };

            const exactResponse = await fetchWithTimeout(
                `https://lrclib.net/api/get?${lrcParams.toString()}`,
                { headers },
                7000,
            );
            if (exactResponse.ok) {
                const exactLines = parseLyrics(await exactResponse.json());
                if (exactLines.length > 0) { lastLyricsSource = 'LRCLIB'; return exactLines; }
            }

            const searchResponse = await fetchWithTimeout(
                `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`,
                { headers },
                7000,
            );
            if (!searchResponse.ok) return [];
            const candidates: any[] = await searchResponse.json();
            if (!Array.isArray(candidates)) return [];
            const expectedTitle = normalizeSongText(title);
            const expectedArtist = normalizeSongText(artist);
            const expectedAlbum = normalizeSongText(album);
            const ranked = candidates.map(candidate => {
                const candidateTitle = normalizeSongText(candidate?.trackName || candidate?.name || '');
                const candidateArtist = normalizeSongText(candidate?.artistName || '');
                const candidateAlbum = normalizeSongText(candidate?.albumName || '');
                let score = candidateTitle === expectedTitle ? 8 : 0;
                if (candidateArtist === expectedArtist) score += 6;
                else if (candidateArtist.includes(expectedArtist) || expectedArtist.includes(candidateArtist)) score += 3;
                if (expectedAlbum && candidateAlbum === expectedAlbum) score += 2;
                if (durationSec > 0 && Math.abs(Number(candidate?.duration || 0) - durationSec) <= 2) score += 4;
                if (candidate?.syncedLyrics) score += 1;
                return { candidate, score };
            }).sort((left, right) => right.score - left.score);
            if (!ranked[0] || ranked[0].score < 11) return [];
            const lines = parseLyrics(ranked[0].candidate);
            if (lines.length) lastLyricsSource = 'LRCLIB';
            return lines;
        } catch (e) {
            console.log('Lyrics fetch error:', e);
            return [];
        }
    }
};
