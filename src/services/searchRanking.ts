import type { Track } from '../types';
import { normalizeMusicText, recordingVariant } from './musicMatching';

/** Match complete words and the final typed prefix, across title and credits. */
export function matchesSearch(value: string, query: string): boolean {
    const words = normalizeMusicText(value).split(' ');
    const wanted = normalizeMusicText(query).split(' ').filter(Boolean);
    return wanted.length > 0 && wanted.every((word, index) => words.some(candidate =>
        index === wanted.length - 1 ? candidate.startsWith(word) : candidate === word));
}

export function searchTrackScore(query: string, track: Track): number {
    const q = normalizeMusicText(query);
    if (!q) return 0;
    const title = normalizeMusicText(track.title);
    const artist = normalizeMusicText([track.artist?.name, ...(track.artists || []).map(item => item.name)].filter(Boolean).join(' '));
    const album = normalizeMusicText(track.album?.title);
    let score = 0;
    if (title === q) score += 240;
    else if (title.startsWith(q)) score += 100;
    if (normalizeMusicText(track.artist?.name) === q) score += 180;
    if (matchesSearch(`${title} ${artist}`, q)) score += 160;
    else if (matchesSearch(`${title} ${artist} ${album}`, q)) score += 40;
    if (album === q) score += 30;
    const words = q.split(' ');
    for (const word of words) {
        if (title.split(' ').includes(word)) score += 8;
        if (artist.split(' ').includes(word)) score += 6;
    }
    const requested = recordingVariant(query);
    const actual = recordingVariant(track.title);
    if (actual !== requested && actual) score -= 100;
    if (requested && actual === requested) score += 100;
    return score + Math.max(0, Math.min(Number(track.popularity) || 0, 100)) / 20;
}
