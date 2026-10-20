import { API } from '../api';
import type { Track } from '../types';
import type { ImportedPlaylist, ImportedPlaylistTrack, PlaylistPlatform } from '../store/importedPlaylists';
import { normalizeMusicText, sameRecording } from './musicMatching';
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

function platformFor(url: string): PlaylistPlatform {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Paste a complete playlist link beginning with https://.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use a secure public playlist link.');
    const host = parsed.hostname.toLowerCase();
    if (host === 'open.spotify.com') return 'spotify';
    if (['youtu.be', 'youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)) return 'youtube';
    if (host === 'music.apple.com') return 'apple';
    if (['tidal.com', 'www.tidal.com', 'listen.tidal.com'].includes(host)) return 'tidal';
    throw new Error('Paste a Spotify, YouTube Music, YouTube, Apple Music or TIDAL playlist link.');
}

const normalize = normalizeMusicText;

function matchScore(source: SourceTrack, candidate: Track): number {
    const title = normalize(source.title); const artist = normalize(source.artist);
    const candidateTitle = normalize(candidate.title); const candidateArtist = normalize(candidate.artist.name);
    let score = title === candidateTitle ? 10 : title.includes(candidateTitle) || candidateTitle.includes(title) ? 6 : 0;
    if (artist === candidateArtist) score += 8;
    else if (artist.includes(candidateArtist) || candidateArtist.includes(artist.split(' ')[0])) score += 4;
    if (source.duration && candidate.duration && Math.abs(source.duration - candidate.duration) <= 4) score += 3;
    return score;
}

function reliableMatch(source: SourceTrack, candidate: Track): boolean {
    return sameRecording(source, candidate);
}

async function resolveTracks(source: SourceTrack[], onProgress?: (done: number, total: number) => void): Promise<ImportedPlaylistTrack[]> {
    let completed = 0;
    onProgress?.(0, source.length);
    return mapConcurrent(source, 3, async song => {
        let resolved: Track | undefined;
        try {
            let candidates = await API.search(`${song.title} ${song.artist}`);
            let best = candidates.filter(candidate => reliableMatch(song, candidate)).sort((a, b) => matchScore(song, b) - matchScore(song, a))[0];
            // Some catalog providers rank a long "title + all artists" query poorly.
            // Retry with the source title, then rank locally using artist and duration.
            if (!best) {
                const titleCandidates = await API.search(song.title);
                candidates = [...candidates, ...titleCandidates].filter((track, candidateIndex, all) => all.findIndex(item => item.id === track.id) === candidateIndex);
                best = candidates.filter(candidate => reliableMatch(song, candidate)).sort((a, b) => matchScore(song, b) - matchScore(song, a))[0];
            }
            resolved = best;
        } catch { /* Preserve an unmatched row instead of losing the entire playlist. */ }
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
