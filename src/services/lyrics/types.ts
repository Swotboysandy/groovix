// Internal lyric model, in milliseconds .
// Converted to Groovix's seconds-based shape in index.ts.

export type Word = { startMs: number; endMs: number; text: string };

export type Line = {
    timeMs: number;
    text: string;
    words: Word[];
    sungUntilMs?: number;
    background?: Line;
    agent?: string;
    /** No timing at all (plain text). */
    unsynced?: boolean;
};

export const line = (timeMs: number, text: string, extra: Partial<Line> = {}): Line => ({
    timeMs,
    text,
    words: [],
    ...extra,
});

export const isWordSynced = (l: Line) => l.words.length > 0;

export type Query = {
    title: string;
    artist: string;
    album?: string;
    durationMs: number;
    isrc?: string;
    signal?: AbortSignal;
};
