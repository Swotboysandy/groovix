// YouTube Music recommendation backend (Innertube +
// InnertubeParser + YtMusicRepository.home / radio), anonymous WEB_REMIX only.
// Groovix plays TIDAL ids, so every recommendation is matched back onto the
// TIDAL catalogue before it is shown or queued.
import { API } from '../api';
import type { Album, Artist, Playlist, Track, CatalogSearchResult } from '../types';
import { bestRecording, looseSameRecording, normalizeMusicText } from './musicMatching';
export { mapConcurrent } from './asyncTools';

const MUSIC_BASE = 'https://music.youtube.com/youtubei/v1';
const WEB_REMIX_VERSION = '1.20250101.01.00';
const WEB_REMIX_CLIENT_ID = '67';
const TIMEOUT_MS = 12000;
/** Songs-only search filter, as the web client sends it. */
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQChAFEAMQBA==';

export type YtSong = { videoId: string; title: string; artist: string; album?: string; artistBrowseId?: string; albumBrowseId?: string; durationSec?: number; thumbnail?: string };
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
    // "Artist • Album • 4:29": when the album isn't linked, it is the part
    // between the artist and the length.
    const parts = byline.split(' • ').map(part => part.trim()).filter(Boolean);
    const textAlbum = parts.length >= 3 && /^\d+(:\d+)+$/.test(parts[parts.length - 1]) && !/^(song|video|single|ep)$/i.test(parts[parts.length - 2])
        ? parts[parts.length - 2] : undefined;
    return { videoId, title, artist, album: albumRun?.text ?? textAlbum, artistBrowseId: artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId, albumBrowseId: albumRun?.navigationEndpoint?.browseEndpoint?.browseId, durationSec: parseDuration(durationText) ?? parseDuration(runsText(renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)), thumbnail: bestThumbnail(renderer?.thumbnail) };
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

export type YtSearchPage = { tracks: Track[]; continuation: string | null };

/** Search shelves only: never treat menu/watch/recommendation renderers as hits. */
export function parseSongSearch(response: any): YtSearchPage {
    const page = parseMusicSearch(response);
    return { tracks: page.tracks, continuation: page.continuation };
}

/** BitChord's song search: provider relevance, stable video ids, lazy playback resolution. */
export async function searchSongs(query: string, continuation?: string): Promise<YtSearchPage> {
    if (!query.trim() && !continuation) return { tracks: [], continuation: null };
    return parseSongSearch(await post('search', continuation
        ? { continuation }
        : { query: query.trim(), params: SONGS_FILTER }));
}

export type SearchCategory = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';
export const SEARCH_FILTERS: Record<SearchCategory, string | null> = {
    all: null, songs: SONGS_FILTER,
    albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA==',
    artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA==',
    playlists: 'EgWKAQIoAWoKEAkQChAFEAMQBA==',
};
export type MusicSearchPage = CatalogSearchResult & { continuation: string | null; topBrowse?: Album | Artist | Playlist };

function browseSearchItem(renderer: any): { kind: 'albums' | 'artists' | 'playlists'; item: Album | Artist | Playlist } | null {
    const titleNode = renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text ?? renderer?.title;
    const subtitleNode = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text ?? renderer?.subtitle;
    const endpoint = renderer?.navigationEndpoint?.browseEndpoint
        ?? titleNode?.runs?.find((run: any) => run.navigationEndpoint?.browseEndpoint)?.navigationEndpoint?.browseEndpoint;
    const browseId = endpoint?.browseId;
    const title = runsText(titleNode);
    if (!browseId || !title) return null;
    const pageType = endpoint.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    const cover = bestThumbnail(renderer.thumbnail ?? renderer.thumbnailRenderer) ?? '';
    const subtitle = runsText(subtitleNode);
    const base = { id: youtubeTrackId(browseId), ytBrowseId: browseId };
    // A channel id alone isn't an artist: user channels start with UC too.
    if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || (!pageType && browseId.startsWith('UC'))) {
        return { kind: 'artists', item: { ...base, name: title, picture: cover } };
    }
    if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPRE')) {
        return { kind: 'albums', item: { ...base, title, cover, artist: { id: 0, name: artistFromSubtitle(subtitle) } } };
    }
    if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' || browseId.startsWith('VL')) {
        return { kind: 'playlists', item: { ...base, id: browseId, title, cover, creatorName: artistFromSubtitle(subtitle), numberOfTracks: 0, duration: 0 } };
    }
    return null;
}

/** Only visible result containers are traversed; menu/watch endpoints aren't results. */
export function parseMusicSearch(response: any): MusicSearchPage {
    const page: MusicSearchPage = { tracks: [], albums: [], artists: [], playlists: [], continuation: null };
    const seen = new Set<string>();
    const add = (renderer: any) => {
        const browse = browseSearchItem(renderer);
        if (browse) {
            const key = `b:${browse.item.ytBrowseId}`;
            if (seen.has(key)) return;
            seen.add(key);
            if (browse.kind === 'albums') page.albums.push(browse.item as Album);
            else if (browse.kind === 'artists') page.artists.push(browse.item as Artist);
            else page.playlists.push(browse.item as Playlist);
            return;
        }
        // Skip music-video uploads in the music search, matching BitChord.
        const watch = renderer?.navigationEndpoint?.watchEndpoint
            ?? renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
        const videoType = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
        if (videoType && videoType !== 'MUSIC_VIDEO_TYPE_ATV') return;
        const song = songFromListItem(renderer);
        if (!song || seen.has(`v:${song.videoId}`)) return;
        seen.add(`v:${song.videoId}`);
        page.tracks.push(youtubeTrack(song));
    };
    const walk = (items: any[]) => {
        for (const item of items ?? []) {
            if (item.itemSectionRenderer) walk(item.itemSectionRenderer.contents);
            const card = item.musicCardShelfRenderer;
            if (card) {
                const promoted = browseSearchItem(card);
                if (promoted) {
                    // Kept in its own section too (the Artists/Albums tabs list it);
                    // the All view hides the repeat under the Top result.
                    page.topBrowse = promoted.item;
                    add(card);
                } else {
                    const endpoint = card.navigationEndpoint ?? card.title?.runs?.[0]?.navigationEndpoint ?? card.onTap;
                    // Some song cards keep the video id only on their play button.
                    const videoId = endpoint?.watchEndpoint?.videoId
                        ?? card.buttons?.map((button: any) => button?.buttonRenderer?.command?.watchEndpoint?.videoId).find(Boolean)
                        ?? card.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
                    add({ ...card, navigationEndpoint: endpoint,
                        playlistItemData: { videoId },
                        flexColumns: [card.title, card.subtitle].map(text => ({ musicResponsiveListItemFlexColumnRenderer: { text } })),
                    });
                }
                // Songs inside an artist's card often come without an artist
                // line; they are that artist's songs.
                const before = page.tracks.length;
                walk(card.contents);
                const cardArtist = promoted?.kind === 'artists' ? (promoted.item as Artist).name : '';
                if (cardArtist) {
                    for (const track of page.tracks.slice(before)) {
                        if (!track.artist?.name) track.artist = { id: 0, name: cardArtist };
                    }
                }
            }
            if (item.musicResponsiveListItemRenderer) add(item.musicResponsiveListItemRenderer);
            if (item.musicTwoRowItemRenderer) add(item.musicTwoRowItemRenderer);
            const shelf = item.musicShelfRenderer ?? item.musicPlaylistShelfRenderer ?? item.musicCarouselShelfRenderer ?? item.gridRenderer;
            if (shelf) {
                walk(shelf.contents ?? shelf.items);
                page.continuation = shelf.continuations?.[0]?.nextContinuationData?.continuation ?? page.continuation;
            }
            page.continuation = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? page.continuation;
        }
    };
    const sections = response?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    walk(sections);
    const continued = response?.continuationContents?.musicShelfContinuation ?? response?.continuationContents?.sectionListContinuation;
    if (continued) {
        walk(continued.contents);
        page.continuation = continued.continuations?.[0]?.nextContinuationData?.continuation ?? page.continuation;
    }
    for (const action of response?.onResponseReceivedCommands ?? response?.onResponseReceivedActions ?? []) {
        walk(action.appendContinuationItemsAction?.continuationItems);
    }
    return page;
}

export async function searchMusic(query: string, category: SearchCategory = 'all', continuation?: string): Promise<MusicSearchPage> {
    if (!query.trim() && !continuation) return parseMusicSearch({});
    return parseMusicSearch(await post('search', continuation ? { continuation }
        : { query: query.trim(), ...(SEARCH_FILTERS[category] ? { params: SEARCH_FILTERS[category] } : {}) }));
}

/** Keep browse identity intact: never send a YouTube hash/id to a TIDAL detail API. */
export function youtubeBrowseParams(item: Album | Artist | Playlist): Record<string, unknown> {
    if (!item.ytBrowseId) throw new Error('Missing YouTube browse identity');
    if ('name' in item) return { ytArtistId: item.ytBrowseId, artistData: item };
    if (typeof item.id === 'string') return { ytPlaylistId: item.ytBrowseId, ytPlaylistData: {
        browseId: item.ytBrowseId, title: item.title, subtitle: ('creatorName' in item ? item.creatorName : '') ?? '', thumbnail: item.cover,
    } };
    return { ytAlbumId: item.ytBrowseId, albumData: item };
}

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

export type MusicBrowsePage = {
    title: string; thumbnail?: string; songs: YtSong[]; albums: Album[]; continuation: string | null; songsBrowseId?: string;
};

/** Shared browse parser for albums, artist pages and playlists. */
export function parseMusicBrowse(response: any): MusicBrowsePage {
    const columns = response?.contents?.twoColumnBrowseResultsRenderer;
    const primary = columns?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents
        ?? browseSections(response);
    const sections = [...(primary ?? []), ...(columns?.secondaryContents?.sectionListRenderer?.contents ?? [])];
    const header = response?.header?.musicImmersiveHeaderRenderer
        ?? response?.header?.musicVisualHeaderRenderer
        ?? response?.header?.musicDetailHeaderRenderer
        ?? sections.find((section: any) => section.musicResponsiveHeaderRenderer)?.musicResponsiveHeaderRenderer;
    const continued = response?.continuationContents?.musicPlaylistShelfContinuation
        ?? response?.continuationContents?.musicShelfContinuation;
    if (continued) sections.push({ musicPlaylistShelfRenderer: continued });
    const page: MusicBrowsePage = {
        title: runsText(header?.title),
        thumbnail: bestThumbnail(header?.thumbnail) ?? bestThumbnail(header?.foregroundThumbnail),
        songs: [], albums: [], continuation: null,
    };
    const artist = runsText(header?.straplineTextOne) || artistFromSubtitle(runsText(header?.subtitle));
    const seen = new Set<string>();
    for (const section of sections) {
        const shelf = section.musicPlaylistShelfRenderer ?? section.musicShelfRenderer ?? section.musicCarouselShelfRenderer ?? section.gridRenderer;
        if (!shelf) continue;
        const songEndpoint = shelf.bottomEndpoint?.browseEndpoint?.browseId;
        if (section.musicShelfRenderer && songEndpoint) page.songsBrowseId = songEndpoint;
        for (const item of shelf.contents ?? shelf.items ?? []) {
            const renderer = item.musicResponsiveListItemRenderer ?? item.musicTwoRowItemRenderer;
            const browse = browseSearchItem(renderer);
            if (browse) {
                if (browse.kind === 'albums' && !seen.has(`b:${browse.item.ytBrowseId}`)) {
                    seen.add(`b:${browse.item.ytBrowseId}`); page.albums.push(browse.item as Album);
                }
                continue;
            }
            const song = songFromListItem(renderer);
            if (song && !seen.has(`v:${song.videoId}`)) {
                seen.add(`v:${song.videoId}`);
                page.songs.push({ ...song, artist: song.artist || artist || page.title, thumbnail: song.thumbnail ?? page.thumbnail });
            }
            page.continuation = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? page.continuation;
        }
        page.continuation = shelf.continuations?.[0]?.nextContinuationData?.continuation ?? page.continuation;
    }
    for (const action of response?.onResponseReceivedActions ?? []) {
        const parsed = parseMusicBrowse({ continuationContents: { musicPlaylistShelfContinuation: { contents: action.appendContinuationItemsAction?.continuationItems ?? [] } } });
        page.songs.push(...parsed.songs); page.continuation = parsed.continuation ?? page.continuation;
    }
    return page;
}

export async function musicBrowse(browseId: string, continuation?: string): Promise<MusicBrowsePage> {
    const page = parseMusicBrowse(await post('browse', continuation ? { continuation } : { browseId }));
    if (!continuation && browseId.startsWith('UC') && page.songsBrowseId) {
        // Artist pages contain only a short preview; follow the authoritative Songs link.
        const songs = parseMusicBrowse(await post('browse', { browseId: page.songsBrowseId }));
        if (songs.songs.length) { page.songs = songs.songs; page.continuation = songs.continuation; }
    }
    return page;
}

/** Compatibility for existing Home / Explore entry points. */
export async function playlistSongs(browseId: string): Promise<MusicBrowsePage> {
    return musicBrowse(browseId);
}

// ---- YouTube songs as tracks ----------------------------------------------
// Like BitChord, YouTube's songs are shown and queued as they come; the
// lossless recording behind one is looked up only when it is about to play.

/** YouTube's square art, asked for at a size that stays sharp on a large card. */
function largeThumbnail(url?: string): string {
    if (!url) return '';
    return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^/]*$/, '=w544-h544-l90-rj') : url;
}

/** A stable negative id per video, so it never collides with a catalogue id. */
export function youtubeTrackId(videoId: string): number {
    let hash = 2166136261;
    for (let index = 0; index < videoId.length; index += 1) {
        hash ^= videoId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return -((hash >>> 0) || 1);
}

export function youtubeTrack(song: YtSong): Track {
    const cover = largeThumbnail(song.thumbnail);
    return {
        id: youtubeTrackId(song.videoId),
        title: song.title,
        duration: song.durationSec ?? 0,
        artist: { id: song.artistBrowseId ? youtubeTrackId(song.artistBrowseId) : 0, name: song.artist, ytBrowseId: song.artistBrowseId },
        album: { id: song.albumBrowseId ? youtubeTrackId(song.albumBrowseId) : 0, title: song.album ?? '', cover, ytBrowseId: song.albumBrowseId },
        coverUrl: cover,
        ytVideoId: song.videoId,
    };
}

export function youtubeAlbum(album: YtAlbum): Album & { ytBrowseId: string } {
    return { id: youtubeTrackId(album.browseId), title: album.title, cover: largeThumbnail(album.thumbnail), artist: { id: 0, name: album.artist }, ytBrowseId: album.browseId };
}

/** A YouTube song that hasn't been matched to a playable recording yet. */
export function isYouTubeOnly(track?: Track | null): boolean {
    return Boolean(track?.ytVideoId) && (track?.id ?? 0) < 0;
}

/** Both ids a song can appear under in a queue: its catalogue id and its YouTube one. */
export function trackIds(track: Track): number[] {
    return track.ytVideoId && track.id > 0 ? [track.id, youtubeTrackId(track.ytVideoId)] : [track.id];
}

/** The playable recording for a YouTube song (cached), or null when none matches. */
export function resolveYouTubeTrack(track: Track): Promise<Track | null> {
    if (!isYouTubeOnly(track)) return Promise.resolve(track);
    return matchTrack({
        videoId: track.ytVideoId!,
        title: track.title,
        artist: track.artist?.name || '',
        album: track.album?.title || undefined,
        durationSec: track.duration || undefined,
    }).then(found => found ? { ...found, ytVideoId: track.ytVideoId } : null);
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
            return bestRecording({ title: song.title, artist: song.artist, duration: song.durationSec, album: song.album }, results)
                // YouTube titles often add words the catalogue lacks; accept those
                // only when the length agrees within a few seconds.
                ?? results.find(track => looseSameRecording({ title: song.title, artist: song.artist, duration: song.durationSec }, track, 3))
                ?? null;
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
    if (track.ytVideoId) return Promise.resolve(track.ytVideoId);
    let pending = seedIds.get(track.id);
    if (!pending) {
        pending = searchSong(`${track.title} ${track.artist?.name || ''}`.trim()).then(song => {
            if (!song) return null;
            // The hit must be this recording; a cover would seed the wrong station.
            const same = looseSameRecording({ title: song.title, artist: song.artist, duration: song.durationSec }, track);
            return same ? song.videoId : null;
        });
        seedIds.set(track.id, pending);
        pending.catch(() => seedIds.delete(track.id));
    }
    return pending;
}
