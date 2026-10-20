// YouTube Music recommendation backend (Innertube +
// InnertubeParser + YtMusicRepository.home / radio), anonymous WEB_REMIX only.
// Groovix plays TIDAL ids, so every recommendation is matched back onto the
// TIDAL catalogue before it is shown or queued.
import { API } from '../api';
import type { Album, Track } from '../types';
import { bestRecording, normalizeMusicText } from './musicMatching';
export { mapConcurrent } from './asyncTools';

const MUSIC_BASE = 'https://music.youtube.com/youtubei/v1';
const WEB_REMIX_VERSION = '1.20250101.01.00';
const WEB_REMIX_CLIENT_ID = '67';
const TIMEOUT_MS = 12000;
/** Songs-only search filter, as the web client sends it. */
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

export type YtSong = { videoId: string; title: string; artist: string; album?: string; durationSec?: number; thumbnail?: string };
export type YtAlbum = { browseId: string; title: string; artist: string; thumbnail?: string };
export type YtShelf =
    | { title: string; kind: 'songs'; items: YtSong[] }
    | { title: string; kind: 'albums'; items: YtAlbum[] };

async function post(endpoint: string, body: Record<string, unknown>): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(`${MUSIC_BASE}/${endpoint}${endpoint.includes('?') ? '&' : '?'}prettyPrint=false`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://music.youtube.com',
                Referer: 'https://music.youtube.com/',
                'X-YouTube-Client-Name': WEB_REMIX_CLIENT_ID,
                'X-YouTube-Client-Version': WEB_REMIX_VERSION,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            },
            body: JSON.stringify({
                context: { client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl: 'en', gl: 'IN' } },
                ...body,
            }),
        });
        if (!response.ok) throw new Error(`YouTube Music ${endpoint} ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// ---- InnertubeParser ----------------------------------------------------

const runsText = (node: any): string => (node?.runs ?? []).map((run: any) => run.text).join('');

function parseDuration(text?: string): number | undefined {
    if (!text || !/^\d+(:\d+)+$/.test(text)) return undefined;
    return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function bestThumbnail(node: any): string | undefined {
    const list = node?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? node?.thumbnail?.thumbnails ?? node?.thumbnails;
    return Array.isArray(list) && list.length ? list[list.length - 1].url : undefined;
}

/** "Artist • Album • 4:29" — the subtitle line a list row carries. */
export function artistFromSubtitle(subtitle: string): string {
    const parts = subtitle.split(' • ').map(part => part.trim()).filter(Boolean);
    const skip = /^(song|single|ep|album|video|playlist|\d[\d.,]*[kmb]? (plays|views))$/i;
    return parts.find(part => !skip.test(part) && !/^\d+(:\d+)+$/.test(part)) ?? '';
}

function songFromListItem(renderer: any): YtSong | null {
    const videoId = renderer?.playlistItemData?.videoId
        ?? renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const columns = (renderer?.flexColumns ?? []).map((column: any) => column?.musicResponsiveListItemFlexColumnRenderer?.text);
    const title = runsText(columns[0]);
    if (!videoId || !title) return null;
    const second = columns[1]?.runs ?? [];
    const byline = runsText(columns[1]);
    // Artist runs are the ones that link to a channel; fall back to the text.
    const artistRuns = second.filter((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
    const albumRun = second.find((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM');
    const artist = artistRuns.length ? artistRuns.map((run: any) => run.text).join(', ') : artistFromSubtitle(byline);
    const durationText = byline.split(' • ').map(part => part.trim()).find(part => /^\d+(:\d+)+$/.test(part));
    return { videoId, title, artist, album: albumRun?.text, durationSec: parseDuration(durationText), thumbnail: bestThumbnail(renderer?.thumbnail) };
}

function albumFromTwoRow(renderer: any): YtAlbum | null {
    const browseId = renderer?.navigationEndpoint?.browseEndpoint?.browseId;
    const pageType = renderer?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (!browseId || pageType !== 'MUSIC_PAGE_TYPE_ALBUM') return null;
    return { browseId, title: runsText(renderer.title), artist: artistFromSubtitle(runsText(renderer.subtitle)), thumbnail: bestThumbnail(renderer?.thumbnailRenderer) };
}

function parseShelves(sections: any[]): YtShelf[] {
    const shelves: YtShelf[] = [];
    for (const section of sections ?? []) {
        const carousel = section?.musicCarouselShelfRenderer;
        if (!carousel) continue;
        const title = runsText(carousel.header?.musicCarouselShelfBasicHeaderRenderer?.title);
        const songs: YtSong[] = [];
        const albums: YtAlbum[] = [];
        for (const item of carousel.contents ?? []) {
            if (item.musicResponsiveListItemRenderer) {
                const song = songFromListItem(item.musicResponsiveListItemRenderer);
                if (song) songs.push(song);
            } else if (item.musicTwoRowItemRenderer) {
                const two = item.musicTwoRowItemRenderer;
                const videoId = two?.navigationEndpoint?.watchEndpoint?.videoId;
                if (videoId) songs.push({ videoId, title: runsText(two.title), artist: artistFromSubtitle(runsText(two.subtitle)), thumbnail: bestThumbnail(two.thumbnailRenderer) });
                const album = albumFromTwoRow(two);
                if (album) albums.push(album);
            }
        }
        if (songs.length >= 4) shelves.push({ title, kind: 'songs', items: songs });
        else if (albums.length >= 4) shelves.push({ title, kind: 'albums', items: albums });
    }
    return shelves;
}

function browseSections(response: any): any[] {
    return response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
}

function parseWatchQueue(response: any): YtSong[] {
    const panel = response?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
        ?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
    const songs: YtSong[] = [];
    for (const entry of panel?.contents ?? []) {
        // Wrapped entries pair the song with its music-video counterpart; the
        // primary renderer is the catalogue cut.
        const video = entry.playlistPanelVideoRenderer ?? entry.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
        if (!video?.videoId) continue;
        const byline = (video.longBylineText?.runs ?? []);
        const artistRuns = byline.filter((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
        const albumRun = byline.find((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM');
        songs.push({
            videoId: video.videoId,
            title: runsText(video.title),
            artist: artistRuns.length ? artistRuns.map((run: any) => run.text).join(', ') : artistFromSubtitle(runsText(video.longBylineText)),
            album: albumRun?.text,
            durationSec: parseDuration(runsText(video.lengthText)),
            thumbnail: bestThumbnail(video.thumbnail),
        });
    }
    return songs;
}

// ---- YtMusicRepository ----------------------------------------------------

/** The first song hit for [query] — how a TIDAL seed finds its YouTube id. */
export async function searchSong(query: string): Promise<YtSong | null> {
    const response = await post('search', { query, params: decodeURIComponent(SONGS_FILTER) });
    const sections = response?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
        for (const item of section?.musicShelfRenderer?.contents ?? []) {
            const song = songFromListItem(item.musicResponsiveListItemRenderer);
            if (song) return song;
        }
    }
    return null;
}

/** Depth-first collection of a named renderer, preserving document order. */
function collectRenderers(root: any, name: string, out: any[] = []): any[] {
    if (Array.isArray(root)) root.forEach(node => collectRenderers(node, name, out));
    else if (root && typeof root === 'object') {
        if (root[name]) out.push(root[name]);
        Object.values(root).forEach(node => collectRenderers(node, name, out));
    }
    return out;
}

/** searchSuggestions(): YouTube Music's completions for the typed text. */
export async function searchSuggestions(input: string): Promise<string[]> {
    const response = await post('music/get_search_suggestions', { input });
    const queries = collectRenderers(response, 'searchSuggestionRenderer')
        .map(renderer => renderer?.navigationEndpoint?.searchEndpoint?.query || runsText(renderer?.suggestion))
        .filter((query: string) => query && query.trim());
    return [...new Set<string>(queries)];
}

/** radio(): the watch queue YouTube builds for a song's station. */
export async function radio(videoId: string): Promise<YtSong[]> {
    const response = await post('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true });
    return parseWatchQueue(response).filter(song => song.videoId !== videoId);
}

function homeContinuation(node: any): string | null {
    return node?.continuations?.[0]?.nextContinuationData?.continuation ?? null;
}

/** FEmusic_home's first page and the token for the page after it. */
export async function home(): Promise<{ shelves: YtShelf[]; continuation: string | null }> {
    const response = await post('browse', { browseId: 'FEmusic_home' });
    const list = response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
    return { shelves: parseShelves(list?.contents ?? []), continuation: homeContinuation(list) };
}

/** The next Home page, following FEmusic_home's own continuation as you scroll. */
export async function moreHome(token: string): Promise<{ shelves: YtShelf[]; continuation: string | null }> {
    const response = await post(`browse?ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next`, { continuation: token });
    const list = response?.continuationContents?.sectionListContinuation;
    return { shelves: parseShelves(list?.contents ?? []), continuation: homeContinuation(list) };
}

/** Shelves appended below Home, each fetched on its own. */
export const HOME_SUPPLEMENT_BROWSE_IDS = ['FEmusic_new_releases', 'FEmusic_explore'];

export async function homeSupplement(browseId: string): Promise<YtShelf[]> {
    return parseShelves(browseSections(await post('browse', { browseId })));
}

// ---- Moods & genres (ExploreScreen / MoodGenrePlaylistsScreen) ----

export type YtMood = { title: string; color: string; browseId: string; params: string };
export type YtPlaylist = { browseId: string; title: string; subtitle: string; thumbnail?: string };
export type YtPlaylistShelf = { title: string; items: YtPlaylist[] };

/** ARGB int from Innertube → #RRGGBB. */
function argbToHex(value: number | undefined): string {
    if (typeof value !== 'number') return '#6A6A6A';
    return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

let moodsPending: Promise<YtMood[]> | null = null;

/** Every tile on YouTube Music's "Moods & genres" page, moods first. */
export function moodsAndGenres(): Promise<YtMood[]> {
    if (!moodsPending) {
        moodsPending = post('browse', { browseId: 'FEmusic_moods_and_genres' }).then(response => {
            const moods: YtMood[] = [];
            for (const section of browseSections(response)) {
                for (const item of section?.gridRenderer?.items ?? []) {
                    const button = item?.musicNavigationButtonRenderer;
                    const endpoint = button?.clickCommand?.browseEndpoint;
                    if (!endpoint?.browseId || !endpoint?.params) continue;
                    moods.push({ title: runsText(button.buttonText), color: argbToHex(button.solid?.leftStripeColor), browseId: endpoint.browseId, params: endpoint.params });
                }
            }
            return moods;
        });
        moodsPending.catch(() => { moodsPending = null; });
    }
    return moodsPending;
}

const moodPages = new Map<string, Promise<YtPlaylistShelf[]>>();

/** A mood's shelves of playlists ("Coffee shop blends", "Unwind + explore", …). */
export function moodPlaylists(mood: Pick<YtMood, 'browseId' | 'params'>): Promise<YtPlaylistShelf[]> {
    let pending = moodPages.get(mood.params);
    if (!pending) {
        pending = post('browse', { browseId: mood.browseId, params: mood.params }).then(response => {
            const shelves: YtPlaylistShelf[] = [];
            for (const section of browseSections(response)) {
                const shelf = section?.musicCarouselShelfRenderer ?? section?.gridRenderer;
                if (!shelf) continue;
                const title = runsText(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title ?? shelf.header?.gridHeaderRenderer?.title);
                const items: YtPlaylist[] = [];
                for (const item of shelf.contents ?? shelf.items ?? []) {
                    const two = item?.musicTwoRowItemRenderer;
                    const browseId = two?.navigationEndpoint?.browseEndpoint?.browseId;
                    if (!browseId) continue;
                    items.push({ browseId, title: runsText(two.title), subtitle: runsText(two.subtitle), thumbnail: bestThumbnail(two.thumbnailRenderer) });
                }
                if (items.length) shelves.push({ title, items });
            }
            return shelves;
        });
        pending.catch(() => moodPages.delete(mood.params));
        moodPages.set(mood.params, pending);
    }
    return pending;
}

/** A YouTube Music playlist's header and songs. */
export async function playlistSongs(browseId: string): Promise<{ title: string; thumbnail?: string; songs: YtSong[] }> {
    const response = await post('browse', { browseId });
    const columns = response?.contents?.twoColumnBrowseResultsRenderer;
    const header = columns?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer;
    const songs: YtSong[] = [];
    for (const section of columns?.secondaryContents?.sectionListRenderer?.contents ?? []) {
        for (const item of section?.musicPlaylistShelfRenderer?.contents ?? []) {
            const renderer = item?.musicResponsiveListItemRenderer;
            const song = songFromListItem(renderer);
            if (!song) continue;
            const fixed = runsText(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
            songs.push({ ...song, durationSec: song.durationSec ?? parseDuration(fixed) });
        }
    }
    return { title: runsText(header?.title), thumbnail: bestThumbnail(header?.thumbnail?.musicThumbnailRenderer ?? header?.thumbnail), songs };
}

// ---- Matching onto TIDAL --------------------------------------------------

const trackMatches = new Map<string, Promise<Track | null>>();
const albumMatches = new Map<string, Promise<Album | null>>();
const seedIds = new Map<number, Promise<string | null>>();

/** The TIDAL recording behind a YouTube song, or null when nothing matches safely. */
export function matchTrack(song: YtSong): Promise<Track | null> {
    let pending = trackMatches.get(song.videoId);
    if (!pending) {
        pending = (async () => {
            const query = `${song.title.replace(/\s*\([^)]*\)/g, '')} ${song.artist.split(',')[0]}`.trim();
            // A failed search throws so the failure isn't cached as "no match".
            const results = await API.search(query);
            // The runtime check stays on: dropping it only lets in remasters and
            // extended cuts, never fixes title noise (recordingTitle handles that).
            return bestRecording({ title: song.title, artist: song.artist, duration: song.durationSec, album: song.album }, results);
        })();
        trackMatches.set(song.videoId, pending);
        pending.catch(() => trackMatches.delete(song.videoId));
    }
    return pending;
}

export function matchAlbum(album: YtAlbum): Promise<Album | null> {
    let pending = albumMatches.get(album.browseId);
    if (!pending) {
        pending = (async () => {
            const results = await API.searchAlbums(`${album.title} ${album.artist}`);
            const title = normalizeMusicText(album.title);
            const artist = normalizeMusicText(album.artist);
            return results.find(item => normalizeMusicText(item.title) === title && (!artist || normalizeMusicText(item.artist?.name).includes(artist.split(' ')[0]))) ?? null;
        })();
        albumMatches.set(album.browseId, pending);
        pending.catch(() => albumMatches.delete(album.browseId));
    }
    return pending;
}

/** The YouTube id for a TIDAL seed, found by searching its title and artist. */
export function seedVideoId(track: Track): Promise<string | null> {
    let pending = seedIds.get(track.id);
    if (!pending) {
        pending = searchSong(`${track.title} ${track.artist?.name || ''}`.trim()).then(song => {
            if (!song) return null;
            // The hit must be this recording; a cover would seed the wrong station.
            const same = bestRecording({ title: song.title, artist: song.artist, duration: song.durationSec }, [track]);
            return same ? song.videoId : null;
        });
        seedIds.set(track.id, pending);
        pending.catch(() => seedIds.delete(track.id));
    }
    return pending;
}
