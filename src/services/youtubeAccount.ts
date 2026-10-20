// Google sign-in and the signed-in user's YouTube data, through the official
// YouTube Data API v3 (read-only). Videos are matched onto playable songs the
// same way YouTube Music recommendations are.
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import type { Track } from '../types';
import { mapConcurrent } from './asyncTools';
import { matchTrack, type YtSong } from './ytmusic';

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const API = 'https://www.googleapis.com/youtube/v3';
const MAX_PAGES = 4;

export type YouTubeUser = { name: string; email: string; photo?: string | null };
export type YouTubePlaylist = { id: string; title: string; thumbnail?: string; count: number };

let configured = false;
function configure() {
    if (configured) return;
    // The Android OAuth client is picked by package name + signing SHA-1.
    GoogleSignin.configure({ scopes: [YOUTUBE_SCOPE] });
    configured = true;
}

function toUser(data: { user: { name: string | null; email: string; photo: string | null } }): YouTubeUser {
    return { name: data.user.name || data.user.email, email: data.user.email, photo: data.user.photo };
}

/** The signed-in account, restored silently on app start; null when signed out. */
export async function currentYouTubeUser(): Promise<YouTubeUser | null> {
    configure();
    const cached = GoogleSignin.getCurrentUser();
    if (cached) return toUser(cached);
    if (!GoogleSignin.hasPreviousSignIn()) return null;
    const restored = await GoogleSignin.signInSilently().catch(() => null);
    return restored && restored.type === 'success' ? toUser(restored.data) : null;
}

/** Interactive sign-in. Returns null when the user cancels. */
export async function signInWithGoogle(): Promise<YouTubeUser | null> {
    configure();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    try {
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) return null;
        if (!response.data.scopes.includes(YOUTUBE_SCOPE)) {
            const granted = await GoogleSignin.addScopes({ scopes: [YOUTUBE_SCOPE] });
            if (!granted || !isSuccessResponse(granted)) return null;
        }
        return toUser(response.data);
    } catch (error) {
        if (isErrorWithCode(error) && (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)) return null;
        throw error;
    }
}

/** Signs out and revokes Groovix's access to the account. */
export async function signOutOfGoogle(): Promise<void> {
    configure();
    await GoogleSignin.revokeAccess().catch(() => {});
    await GoogleSignin.signOut().catch(() => {});
}

async function call(path: string, params: Record<string, string>, retried = false): Promise<any> {
    configure();
    const { accessToken } = await GoogleSignin.getTokens();
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API}/${path}?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    // An expired token is cleared and fetched again once.
    if (response.status === 401 && !retried) {
        await GoogleSignin.clearCachedAccessToken(accessToken);
        return call(path, params, true);
    }
    if (!response.ok) throw new Error(`YouTube ${path} ${response.status}`);
    return response.json();
}

async function paged(path: string, params: Record<string, string>): Promise<any[]> {
    const items: any[] = [];
    let pageToken = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const json = await call(path, { ...params, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
        items.push(...(json.items ?? []));
        pageToken = json.nextPageToken ?? '';
        if (!pageToken) break;
    }
    return items;
}

function isoDuration(value?: string): number | undefined {
    const match = value?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return undefined;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function thumb(snippet: any): string | undefined {
    const t = snippet?.thumbnails;
    return (t?.high || t?.medium || t?.default)?.url;
}

/** "Artist - Topic" channels carry the real artist; otherwise the channel name. */
function songOf(videoId: string, snippet: any, duration?: string): YtSong {
    const channel = String(snippet?.videoOwnerChannelTitle || snippet?.channelTitle || '').replace(/\s*-\s*Topic$/i, '');
    return { videoId, title: snippet?.title || '', artist: channel, durationSec: isoDuration(duration), thumbnail: thumb(snippet) };
}

async function matchAll(songs: YtSong[]): Promise<Track[]> {
    const matched = await mapConcurrent(songs, 4, song => matchTrack(song).catch(() => null));
    const seen = new Set<number>();
    return matched.filter((track): track is Track => !!track && !seen.has(track.id) && (seen.add(track.id), true));
}

export async function myPlaylists(): Promise<YouTubePlaylist[]> {
    const items = await paged('playlists', { part: 'snippet,contentDetails', mine: 'true' });
    return items.map(item => ({
        id: item.id,
        title: item.snippet?.title || 'Playlist',
        thumbnail: thumb(item.snippet),
        count: item.contentDetails?.itemCount ?? 0,
    }));
}

/** A playlist's videos, matched onto playable songs. */
export async function playlistTracks(playlistId: string): Promise<Track[]> {
    const items = await paged('playlistItems', { part: 'snippet,contentDetails', playlistId });
    const songs = items
        .map(item => songOf(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId, item.snippet))
        .filter(song => song.videoId && song.title !== 'Private video' && song.title !== 'Deleted video');
    return matchAll(songs);
}

/** Videos the user liked on YouTube, matched onto playable songs. */
export async function likedTracks(): Promise<Track[]> {
    const items = await paged('videos', { part: 'snippet,contentDetails', myRating: 'like' });
    return matchAll(items.map(item => songOf(item.id, item.snippet, item.contentDetails?.duration)));
}

/** Channels the user is subscribed to, by name; used to steer recommendations. */
export async function subscribedArtists(): Promise<string[]> {
    const items = await paged('subscriptions', { part: 'snippet', mine: 'true' });
    return items.map(item => String(item.snippet?.title || '').replace(/\s*-\s*Topic$/i, '')).filter(Boolean);
}
