import type { Track } from '../types';

/** Keep Indic vowel signs/combining marks; ASCII-only normalization corrupts titles. */
export function normalizeMusicText(value = ''): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function recordingTitle(value: string): string {
    return normalizeMusicText(value
        .replace(/\([^)]*\bfrom\b[^)]*\)|\[[^\]]*\bfrom\b[^\]]*\]/gi, ' ')
        .replace(/\b(official\s+(music\s+)?(video|audio)|lyric(s)?\s+video)\b/gi, ' '));
}

export function recordingVariant(value: string): string {
    return (normalizeMusicText(value).match(/\b(remix|cover|karaoke|instrumental|slowed|sped up|live|acoustic|vocals? only)\b/g) || [])
        .sort().join('|');
}

type Recording = { title: string; artist: string; duration?: number };

/** Conservative cross-catalog matching: never accept title+duration without artist. */
export function sameRecording(source: Recording, candidate: Track): boolean {
    const title = recordingTitle(source.title);
    if (!title || title !== recordingTitle(candidate.title)) return false;
    if (recordingVariant(source.title) !== recordingVariant(candidate.title)) return false;
    const credits = (value: string) => value.replace(/\s*-\s*Topic$/i, '')
        .split(/,|&|;|\bfeat\.?\s|\bfeaturing\s|\band\b/i).map(normalizeMusicText).filter(Boolean);
    const sourceCredits = credits(source.artist);
    const candidateCredits = [candidate.artist?.name || '', ...(candidate.artists || []).map(artist => artist.name)].flatMap(credits);
    if (!sourceCredits.some(name => candidateCredits.includes(name))) return false;
    if (source.duration && candidate.duration) {
        const tolerance = Math.max(5, Math.min(12, source.duration * 0.06));
        if (Math.abs(source.duration - candidate.duration) > tolerance) return false;
    }
    return true;
}

type ScoredRecording = Recording & { album?: string; explicit?: boolean };

/** The best candidate that is the same recording, or null. */
export function bestRecording(source: ScoredRecording, candidates: Track[]): Track | null {
    let best: Track | null = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        if (!sameRecording(source, candidate)) continue;
        let score = 0;
        if (source.duration && candidate.duration) score -= Math.abs(source.duration - candidate.duration);
        if (source.album && candidate.album?.title && normalizeMusicText(source.album) === normalizeMusicText(candidate.album.title)) score += 35;
        if (source.explicit != null && candidate.explicit != null && source.explicit !== candidate.explicit) score -= 20;
        if (normalizeMusicText(candidate.title) === normalizeMusicText(source.title)) score += 5;
        if (score > bestScore) { best = candidate; bestScore = score; }
    }
    return best;
}

export function trackIdentity(track: Track): string {
    return track.isrc ? `isrc:${track.isrc.toUpperCase()}`
        : `${recordingTitle(track.title)}|${normalizeMusicText(track.artist?.name)}`;
}

/** Preserve the visible queue order; only append genuinely new recordings. */
export function appendRadioTracks(existing: Track[], incoming: Track[], excludedIds: Set<number>): Track[] {
    const ids = new Set<number>();
    const identities = new Set<string>();
    return [...existing, ...incoming].filter(track => {
        const identity = trackIdentity(track);
        if (!track.id || excludedIds.has(track.id) || ids.has(track.id) || identities.has(identity)) return false;
        ids.add(track.id);
        identities.add(identity);
        return true;
    });
}
