// ListenBrainz scrobbling with a user token (listenbrainz.org/settings).
// A listen counts once half the song or four minutes has been heard.
import type { Track } from '../types';

const API = 'https://api.listenbrainz.org/1';

function payload(track: Track, listenedAt?: number) {
    return {
        ...(listenedAt ? { listened_at: listenedAt } : {}),
        track_metadata: {
            artist_name: track.artist?.name || '',
            track_name: track.title,
            ...(track.album?.title ? { release_name: track.album.title } : {}),
            additional_info: {
                media_player: 'Groovix',
                submission_client: 'Groovix',
                ...(track.duration ? { duration_ms: Math.round(track.duration * 1000) } : {}),
                ...(track.isrc ? { isrc: track.isrc } : {}),
            },
        },
    };
}

async function submit(token: string, body: object): Promise<boolean> {
    try {
        const response = await fetch(`${API}/submit-listens`, {
            method: 'POST',
            headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/** Checks a token; returns the account name, or null when it isn't valid. */
export async function validateListenBrainzToken(token: string): Promise<string | null> {
    try {
        const response = await fetch(`${API}/validate-token`, { headers: { Authorization: `Token ${token}` } });
        const json = await response.json();
        return json?.valid ? String(json.user_name || '') : null;
    } catch {
        return null;
    }
}

export function sendNowPlaying(token: string, track: Track) {
    if (!token) return;
    void submit(token, { listen_type: 'playing_now', payload: [payload(track)] });
}

/** Scrobbles a finished play when enough of it was heard. */
export function scrobbleIfHeard(token: string, track: Track, startedAt: number, listenedMs: number) {
    if (!token || !track.title) return;
    const durationMs = (track.duration || 0) * 1000;
    const threshold = durationMs > 0 ? Math.min(durationMs / 2, 240_000) : 240_000;
    if (listenedMs < threshold) return;
    void submit(token, { listen_type: 'single', payload: [payload(track, Math.floor(startedAt / 1000))] });
}
