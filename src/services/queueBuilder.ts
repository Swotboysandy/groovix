// QueueBuilder: builds the station that plays on after a
// song. YouTube's watch queues carry the same recording twice (audio and
// video cuts), and a radio mix leans hard on the seed's own artist, so songs
// are matched on a normalised title plus lead artist and each artist is capped.

/** No more than this many tracks by one artist in a single batch. */
export const PER_ARTIST_LIMIT = 2;
/** The artist the station was seeded on gets more room, but not the run of it. */
export const SEED_ARTIST_LIMIT = 4;

export type QueueSong = { id: string; title: string; artist: string };

const NOISE = /\((?:official|lyric|lyrics|lyrical|audio|video|visuali[sz]er|full song|hd|4k)[^)]*\)|\(from[^)]*\)|\[[^\]]*\]|\b(?:official (?:video|audio|music video)|lyrical video|full video|4k video)\b/gi;
const TOPIC = /\s*-\s*topic\b/gi;
const PUNCTUATION = /[^\p{L}\p{N}]+/gu;
const SPACES = /\s+/g;

/** `Kesariya (From "Brahmastra") | Official Video` and `Kesariya` are one recording. */
export function normalisedTitle(raw: string): string {
    return raw.toLocaleLowerCase().split(' | ')[0]
        .replace(NOISE, ' ')
        .replace(PUNCTUATION, ' ')
        .replace(SPACES, ' ')
        .trim();
}

/** The cast behind a credit, split out so billing order stops mattering. */
export function artistSet(raw: string): Set<string> {
    return new Set(raw.toLocaleLowerCase()
        .replace(TOPIC, ' ')
        .split(/,|&|·|•|;| feat| ft\.| ft | x | with /)
        .map(part => part.replace(PUNCTUATION, ' ').replace(SPACES, ' ').trim())
        .filter(Boolean));
}

export function isSameRecording(a: QueueSong, b: QueueSong): boolean {
    if (a.id === b.id) return true;
    const title = normalisedTitle(a.title);
    if (!title || title !== normalisedTitle(b.title)) return false;
    const left = artistSet(a.artist);
    const right = artistSet(b.artist);
    return left.size === 0 || right.size === 0 || [...left].some(name => right.has(name));
}

/** The subset of [candidates] worth appending after [existing]: nothing repeated, at most [limit]. */
export function extend<T extends QueueSong>(existing: QueueSong[], candidates: T[], limit: number): T[] {
    const taken: QueueSong[] = [...existing];
    const perArtist = new Map<string, number>();
    const last = existing[existing.length - 1];
    const seedArtists = last ? artistSet(last.artist) : new Set<string>();
    const out: T[] = [];
    for (const candidate of candidates) {
        if (out.length >= limit) break;
        if (taken.some(item => isSameRecording(item, candidate))) continue;
        const artists = [...artistSet(candidate.artist)];
        const key = artists.sort()[0];
        if (key) {
            const cap = artists.some(name => seedArtists.has(name)) ? SEED_ARTIST_LIMIT : PER_ARTIST_LIMIT;
            const played = perArtist.get(key) ?? 0;
            if (played >= cap) continue;
            perArtist.set(key, played + 1);
        }
        taken.push(candidate);
        out.push(candidate);
    }
    return out;
}
