import { API } from '../api';
import { searchMusic, type MusicSearchPage, type SearchCategory } from './ytmusic';

export type SearchPage = MusicSearchPage & { provider: 'youtube' | 'playback' };

/** Keep BitChord relevance first; the playback catalog remains searchable during outages/gaps. */
export async function searchWithPlaybackFallback(query: string, category: SearchCategory = 'all', continuation?: string): Promise<SearchPage> {
    if (!query.trim() && !continuation) return { tracks: [], albums: [], artists: [], playlists: [], continuation: null, provider: 'youtube' };
    try {
        const page = await searchMusic(query, category, continuation);
        const count = category === 'all'
            ? page.tracks.length + page.albums.length + page.artists.length + page.playlists.length
            : page[category === 'songs' ? 'tracks' : category].length;
        if (count || continuation) return { ...page, provider: 'youtube' };
    } catch (error) {
        // A YouTube continuation cannot be replayed against another provider.
        if (continuation) throw error;
    }
    const page: SearchPage = { tracks: [], albums: [], artists: [], playlists: [], continuation: null, provider: 'playback' };
    const calls = [
        category === 'all' || category === 'songs' ? API.search(query) : Promise.resolve([]),
        category === 'all' || category === 'albums' ? API.searchAlbums(query) : Promise.resolve([]),
        category === 'all' || category === 'artists' ? API.searchArtists(query) : Promise.resolve([]),
        category === 'all' || category === 'playlists' ? API.searchPlaylists(query) : Promise.resolve([]),
    ] as const;
    const results = await Promise.allSettled(calls);
    if (results[0].status === 'fulfilled') page.tracks = results[0].value;
    if (results[1].status === 'fulfilled') page.albums = results[1].value;
    if (results[2].status === 'fulfilled') page.artists = results[2].value;
    if (results[3].status === 'fulfilled') page.playlists = results[3].value;
    const count = page.tracks.length + page.albums.length + page.artists.length + page.playlists.length;
    // Existing catalog clients return [] on failure, so an outage must not be reported as no matches.
    if (!count) throw new Error('No search provider returned results');
    return page;
}
