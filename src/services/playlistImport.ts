import { API } from '../api';
import type { Track } from '../types';
import type { ImportedPlaylist, ImportedPlaylistTrack, PlaylistPlatform } from '../store/importedPlaylists';
import { bestRecording, looseSameRecording, recordingTitle, recordingVariant, sameRecording } from './musicMatching';
import { searchMusic } from './ytmusic';
import { mapConcurrent } from './asyncTools';

type SourceTrack = { title: string; artist: string; duration?: number };
type SourcePlaylist = { title: string; cover?: string; tracks: SourceTrack[] };

const decode = (value: string) => value
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const plainText = (value: string) => decode(value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

function spotifyPlaylistTitle(html: string): string {
    const candidates = [
        (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1],
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1],
        (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1],
        (html.match(/<img[^>]+alt=["']([^"']+?)\s+cover["']/i) || [])[1],
    ].filter(Boolean).map(value => plainText(value));
    const title = candidates.find(value => value && !/^spotify( playlist)?$/i.test(value));
    return (title || 'Spotify playlist')
        .replace(/\s*[|·-]\s*Spotify(?: Playlist)?(?:\s*.*)?$/i, '')
        .replace(/\s+cover$/i, '')
        .trim() || 'Spotify playlist';
}

function textFromRuns(value: any): string {
    return value?.simpleText || (Array.isArray(value?.runs) ? value.runs.map((run: any) => run?.text || '').join('') : '');
}

function collectRenderers(value: any, key: string, output: any[] = []): any[] {
    if (!value || typeof value !== 'object') return output;
    if (value[key]) output.push(value[key]);
    Object.values(value).forEach(child => collectRenderers(child, key, output));
    return output;
}

function parseJsonAfter(html: string, marker: string): any | null {
    const markerAt = html.indexOf(marker);
    if (markerAt < 0) return null;
    const start = html.indexOf('{', markerAt + marker.length);
    if (start < 0) return null;
    let depth = 0; let quoted = false; let escaped = false;
    for (let i = start; i < html.length; i += 1) {
        const char = html[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{') depth += 1;
        else if (char === '}' && --depth === 0) {
            try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

async function fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' },
        });
        if (!response.ok) throw new Error(`Playlist service returned ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function readYouTube(url: string): Promise<SourcePlaylist> {
    const html = await fetchText(url);
    const data = parseJsonAfter(html, 'ytInitialData') || parseJsonAfter(html, 'var ytInitialData');
    const renderers = collectRenderers(data, 'playlistVideoRenderer');
    const tracks = renderers.map(renderer => ({
        title: textFromRuns(renderer.title),
        artist: textFromRuns(renderer.shortBylineText),
        duration: Number(renderer.lengthSeconds) || undefined,
    })).filter(track => track.title && track.artist);
    const title = decode((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || 'YouTube playlist');
    const cover = decode((html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '');
    return { title, cover, tracks };
}

function walkSpotify(value: any, output: SourceTrack[] = []): SourceTrack[] {
    if (!value || typeof value !== 'object') return output;
    const name = typeof value.name === 'string' ? value.name : value.track?.name;
    const artists = value.artists || value.track?.artists;
    if (name && Array.isArray(artists) && artists[0]?.name) {
        output.push({ title: name, artist: artists.map((artist: any) => artist.name).filter(Boolean).join(', '), duration: Math.round((value.duration_ms || value.track?.duration_ms || 0) / 1000) || undefined });
    }
    Object.values(value).forEach(child => walkSpotify(child, output));
    return output;
}

async function readSpotify(url: string): Promise<SourcePlaylist> {
    const id = url.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
    if (!id) throw new Error('This is not a Spotify playlist link.');
    const html = await fetchText(`https://open.spotify.com/embed/playlist/${id}`);
    const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
    const tracks: SourceTrack[] = [];
    scripts.forEach(match => {
        try { walkSpotify(JSON.parse(decode(match[1])), tracks); } catch { /* unrelated script */ }
    });
    // Spotify's current embed renders public playlist rows directly into HTML.
    // Keep this fallback because its hydration JSON intentionally omits artist arrays.
    const rowPattern = /<h3[^>]*>([\s\S]*?)<\/h3><h4[^>]*>([\s\S]*?)<\/h4><div[^>]*data-testid="duration-cell"[^>]*>(\d+):(\d+)<\/div>/gi;
    for (const match of html.matchAll(rowPattern)) {
        tracks.push({
            title: decode(match[1].replace(/<[^>]+>/g, '').trim()),
            artist: decode(match[2].replace(/<[^>]+>/g, '').trim()),
            duration: Number(match[3]) * 60 + Number(match[4]),
        });
    }
    const unique = tracks.filter((track, index) => tracks.findIndex(item => item.title === track.title && item.artist === track.artist) === index);
    const title = spotifyPlaylistTitle(html);
    const cover = decode(
        (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1]
        || (html.match(/<img[^>]+alt=["'][^"']+?\s+cover["'][^>]+src=["']([^"']+)["']/i) || [])[1]
        || (html.match(/"coverArt"\s*:\s*\{[\s\S]{0,300}?"url"\s*:\s*"([^"]+)"/i) || [])[1]
        || '',
    );
    return { title, cover, tracks: unique };
}

async function readApple(url: string): Promise<SourcePlaylist> {
    const html = await fetchText(url);
    const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    let title = 'Apple Music playlist'; let cover = ''; const tracks: SourceTrack[] = [];
    scripts.forEach(match => {
        try {
            const data = JSON.parse(decode(match[1]));
            title = data.name || title; cover = data.image || cover;
            const items = data.track || data.itemListElement || [];
            (Array.isArray(items) ? items : []).forEach((entry: any) => {
                const item = entry.item || entry;
                const artist = item.byArtist?.name || item.author?.name || item.byArtist;
                if (item.name && artist) tracks.push({ title: item.name, artist });
            });
        } catch { /* unrelated structured data */ }
    });
    return { title, cover, tracks };
}

/** A JioSaavn playlist through JioSaavn's own public web API (the link's last part is its token). */
async function readJioSaavn(url: string): Promise<SourcePlaylist> {
    const token = linkParts(url)?.path.split('/').filter(Boolean).pop();
    if (!token) throw new Error('This is not a JioSaavn playlist link.');
    const tracks: SourceTrack[] = [];
    let title = 'JioSaavn playlist'; let cover = '';
    for (let page = 1; page <= 10; page += 1) {
        const api = `https://www.jiosaavn.com/api.php?__call=webapi.get&token=${encodeURIComponent(token)}&type=playlist&p=${page}&n=100&includeMetaTags=0&ctx=web6dot0&api_version=4&_format=json&_marker=0`;
        const data = JSON.parse(await fetchText(api));
        if (page === 1) { title = decode(data?.title || title); cover = data?.image || ''; }
        const list: any[] = Array.isArray(data?.list) ? data.list : [];
        list.forEach(song => {
            const artists = song?.more_info?.artistMap?.primary_artists;
            const artist = Array.isArray(artists) && artists.length ? artists.map((a: any) => decode(a.name)).join(', ') : decode(song?.subtitle || '');
            if (song?.title && artist) tracks.push({ title: decode(song.title), artist, duration: Number(song?.more_info?.duration) || undefined });
        });
        const total = Number(data?.list_count) || 0;
        if (list.length === 0 || tracks.length >= total) break;
    }
    return { title, cover: cover.replace(/150x150/, '500x500'), tracks };
}

/** A Deezer playlist through Deezer's public API. */
async function readDeezer(url: string): Promise<SourcePlaylist> {
    let target = url;
    // Short share links (link.deezer.com, deezer.page.link) redirect to the playlist.
    if (!/playlist\/\d+/.test(target)) {
        const res = await fetch(url);
        target = res.url || url;
    }
    const id = target.match(/playlist\/(\d+)/)?.[1];
    if (!id) throw new Error('This is not a Deezer playlist link.');
    const data = JSON.parse(await fetchText(`https://api.deezer.com/playlist/${id}`));
    if (data?.error) throw new Error('This Deezer playlist is private or does not exist.');
    const tracks: SourceTrack[] = [];
    let page: any = data.tracks;
    for (let i = 0; page && i < 20; i += 1) {
        (page.data || []).forEach((t: any) => { if (t?.title && t?.artist?.name) tracks.push({ title: t.title, artist: t.artist.name, duration: Number(t.duration) || undefined }); });
        page = page.next ? JSON.parse(await fetchText(page.next)) : null;
    }
    return { title: data.title || 'Deezer playlist', cover: data.picture_xl || data.picture_big || '', tracks };
}

/** scheme, user info, host (lower case) and path of an http(s) link, or null. */
function linkParts(url: string): { scheme: string; userinfo: string; host: string; path: string } | null {
    const m = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/(?:([^@/?#]*)@)?([^/?#:]+)(?::\d+)?([^?#]*)/i);
    return m ? { scheme: m[1].toLowerCase(), userinfo: m[2] || '', host: m[3].toLowerCase(), path: m[4] || '/' } : null;
}

function platformFor(url: string): PlaylistPlatform {
    // Parsed by hand: React Native's URL support differs from the web's and
    // misread hosts, rejecting links that work in a browser.
    const parts = linkParts(url);
    if (!parts) throw new Error('Paste a complete playlist link beginning with https://.');
    if (parts.scheme !== 'https' || parts.userinfo) throw new Error('Use a secure public playlist link.');
    const host = parts.host;
    if (host === 'open.spotify.com') return 'spotify';
    if (['youtu.be', 'youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)) return 'youtube';
    if (host === 'music.apple.com') return 'apple';
    if (['tidal.com', 'www.tidal.com', 'listen.tidal.com'].includes(host)) return 'tidal';
    if (host === 'www.jiosaavn.com' || host === 'jiosaavn.com') return 'jiosaavn';
    if (host.endsWith('deezer.com') || host === 'deezer.page.link') return 'deezer';
    if (host.includes('amazon.')) throw new Error("Amazon Music doesn't share its playlist songs publicly, so it can't be imported from a link yet.");
    throw new Error('Paste a Spotify, YouTube Music, YouTube, Apple Music, JioSaavn, Deezer or TIDAL playlist link.');
}

/** A single transliteration typo needs exact artist/version and near-identical length. */
function importMatch(song: SourceTrack, candidates: Track[]): Track | undefined {
    const exact = bestRecording(song, candidates);
    if (exact) return exact;
    const title = recordingTitle(song.title);
    if (!/^[a-z ]{9,}$/.test(title) || !song.duration) return undefined;
    return candidates.find(candidate => {
        if (!candidate.duration || Math.abs(song.duration! - candidate.duration) > 2) return false;
        const other = recordingTitle(candidate.title);
        if (!/^[a-z ]{9,}$/.test(other) || Math.abs(title.length - other.length) > 1) return false;
        let a = 0; let b = 0; let edits = 0;
        while (a < title.length || b < other.length) {
            if (title[a] === other[b]) { a += 1; b += 1; continue; }
            if (++edits > 1) return false;
            if (title.length >= other.length) a += 1;
            if (other.length >= title.length) b += 1;
        }
        return recordingVariant(song.title) === recordingVariant(candidate.title)
            && sameRecording({ ...song, title: candidate.title }, candidate);
    });
}

/** Retry transient failures, without increasing the three-worker request bound. */
async function searchWithRetry(search: () => Promise<Track[]>): Promise<Track[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return await search(); } catch {
            if (!attempt) await new Promise<void>(resolve => setTimeout(resolve, 350));
        }
    }
    return [];
}

async function resolveTracks(source: SourceTrack[], onProgress?: (done: number, total: number) => void): Promise<ImportedPlaylistTrack[]> {
    let completed = 0;
    onProgress?.(0, source.length);
    return mapConcurrent(source, 3, async song => {
        let resolved: Track | undefined;
        // Each provider fails independently, so an outage cannot skip later fallbacks.
        const qobuz = await Promise.resolve(API.resolveQobuz?.({ title: song.title, artist: song.artist, durationSec: song.duration })).catch(() => null);
        if (qobuz && looseSameRecording(song, qobuz)) resolved = qobuz;
        const title = recordingTitle(song.title);
        const artists = song.artist.split(/,|;|\bfeat\.?\s|\bfeaturing\s/i).map(artist => artist.trim()).filter(Boolean);
        const queries = [...new Set([`${song.title} ${song.artist}`, `${title} ${artists[0] || song.artist}`, title])];
        for (const query of queries) {
            if (resolved) break;
            resolved = importMatch(song, await searchWithRetry(() => API.search(query)));
        }
        // The same Innertube search/parser as SearchScreen. Keep its negative id
        // and ytVideoId: the existing player resolves these lazily at play time.
        for (const query of queries) {
            if (resolved) break;
            const candidates = await searchWithRetry(async () => (await searchMusic(query, 'songs')).tracks);
            resolved = importMatch(song, candidates);
        }
        completed += 1;
        onProgress?.(completed, source.length);
        return { ...song, resolved };
    });
}

export async function importPlaylistLink(rawUrl: string, onProgress?: (done: number, total: number) => void): Promise<ImportedPlaylist> {
    const url = rawUrl.trim();
    const platform = platformFor(url);
    let source: SourcePlaylist;
    let tidalTracks: ImportedPlaylistTrack[] | undefined;
    if (platform === 'youtube') source = await readYouTube(url);
    else if (platform === 'spotify') source = await readSpotify(url);
    else if (platform === 'apple') source = await readApple(url);
    else if (platform === 'jiosaavn') source = await readJioSaavn(url);
    else if (platform === 'deezer') source = await readDeezer(url);
    else {
        const id = url.match(/playlist\/([A-Za-z0-9-]+)/)?.[1];
        if (!id) throw new Error('This is not a TIDAL playlist link.');
        const detail = await API.getPlaylist(id);
        tidalTracks = detail.tracks.map(track => ({ title: track.title, artist: track.artist.name, duration: track.duration, resolved: track }));
        source = { title: detail.playlist?.title || 'TIDAL playlist', cover: detail.playlist?.cover, tracks: detail.tracks.map(track => ({ title: track.title, artist: track.artist.name, duration: track.duration })) };
    }
    if (source.tracks.length === 0) throw new Error('This playlist is private, empty, or the platform does not expose its songs from this link.');
    const tracks = tidalTracks || await resolveTracks(source.tracks, onProgress);
    if (tidalTracks) onProgress?.(tracks.length, tracks.length);
    if (!tracks.some(track => track.resolved)) throw new Error('The playlist was read, but none of its songs are available in the Groovix catalog yet.');
    return { id: `${platform}-${Date.now()}`, title: source.title, cover: source.cover, sourceUrl: url, platform, tracks, sourceTrackCount: source.tracks.length, importedAt: new Date().toISOString() };
}
