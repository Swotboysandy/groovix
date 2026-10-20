import type { Track } from '../types';
import { mapConcurrent } from './asyncTools';
import { trackIdentity } from './musicMatching';
import { extend } from './queueBuilder';
import { matchTrack, radio, seedVideoId } from './ytmusic';

function dedupe(tracks: Track[]): Track[] {
    const ids = new Set<number>();
    const identities = new Set<string>();
    return tracks.filter(track => {
        const identity = trackIdentity(track);
        if (!track.id || ids.has(track.id) || identities.has(identity)) return false;
        ids.add(track.id);
        identities.add(identity);
        return true;
    });
}

/**
 * A song's station: YouTube Music's own radio for the seed, de-duplicated and
 * artist-capped by QueueBuilder, then matched onto playable songs.
 */
export async function getRadioRecommendations(seed: Track, excludedIds: Set<number>, limit = 60): Promise<Track[]> {
    if (limit <= 0) return [];
    try {
        const videoId = await seedVideoId(seed);
        if (!videoId) return [];
        const queue = await radio(videoId);
        const seedSong = { id: videoId, title: seed.title, artist: seed.artist?.name || '' };
        const picked = extend([seedSong], queue.map(song => ({ ...song, id: song.videoId })), limit);
        const matched = await mapConcurrent(picked, 4, song => matchTrack(song).catch(() => null));
        return dedupe(matched.filter((track): track is Track => Boolean(track)))
            .filter(track => track.id !== seed.id && !excludedIds.has(track.id))
            .slice(0, limit);
    } catch (error) {
        console.log('[Radio] station unavailable', error);
        return [];
    }
}
