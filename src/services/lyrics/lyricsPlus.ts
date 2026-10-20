// LyricsPlus — YouLy+ backend, raced across volunteer mirrors.
import { lyricsGet, parseJson, qs } from './http';
import { wordsFromRuns } from './parsers';
import { Line, Query, line } from './types';

const MIRRORS = [
    'https://lyricsplus.prjktla.my.id',
    'https://lyricsplus.atomix.one',
    'https://lyricsplus.binimum.org',
    'https://lyricsplus.prjktla.workers.dev',
    'https://lyricsplus-seven.vercel.app',
    'https://lyrics-plus-backend.vercel.app',
];

let lastGood: string | null = null;

export async function lyricsPlus(q: Query): Promise<Line[] | null> {
    const hosts = lastGood ? [lastGood, ...MIRRORS.filter(m => m !== lastGood)] : MIRRORS;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    q.signal?.addEventListener('abort', onAbort);
    try {
        // First mirror with something usable wins, not merely the first to answer.
        return await new Promise<Line[] | null>(resolve => {
            let pending = hosts.length;
            for (const host of hosts) {
                fetchFrom(host, q, controller.signal)
                    .catch(() => null)
                    .then(lines => {
                        if (lines && lines.length) {
                            lastGood = host;
                            resolve(lines);
                        } else if (--pending === 0) {
                            resolve(null);
                        }
                    });
            }
        });
    } finally {
        controller.abort();
        q.signal?.removeEventListener('abort', onAbort);
    }
}

async function fetchFrom(host: string, q: Query, signal: AbortSignal): Promise<Line[] | null> {
    const seconds = Math.floor(q.durationMs / 1000);
    const url = qs(`${host}/v2/lyrics/get`, {
        title: q.title,
        artist: q.artist,
        duration: seconds > 0 ? seconds : undefined,
        album: q.album?.trim() || undefined,
        isrc: q.isrc?.trim() || undefined,
    });
    const res = parseJson(await lyricsGet(url, signal));
    if (!res) return null;
    const lines = parse(res);
    return lines.length ? lines : null;
}

function singerOf(element: any): string | undefined {
    return element && typeof element === 'object' && !Array.isArray(element) && typeof element.singer === 'string'
        ? element.singer
        : undefined;
}

function saysOpposite(element: any): boolean {
    return Array.isArray(element) && element.some(t => t === 'opposite' || t === 'right');
}

export function parse(response: any): Line[] {
    const out: Line[] = [];
    for (const l of Array.isArray(response?.lyrics) ? response.lyrics : []) {
        const start = typeof l?.time === 'number' ? l.time : null;
        if (start == null) continue;
        const syllables = Array.isArray(l.syllabus) ? l.syllabus : [];
        const words = wordsFromRuns(
            syllables
                .filter((s: any) => typeof s?.text === 'string' && typeof s?.time === 'number')
                .map((s: any) => ({ startMs: s.time, endMs: s.time + (s.duration ?? 0), raw: s.text })),
            true,
        );
        const agent = singerOf(l.element) ?? (saysOpposite(l.element) ? 'end' : undefined);
        if (words.length) {
            out.push(line(Math.min(start, words[0].startMs), words.map(w => w.text).join(' '), { words, agent }));
        } else if (typeof l.text === 'string' && l.text.trim()) {
            out.push(
                line(start, l.text.trim(), {
                    sungUntilMs: typeof l.duration === 'number' && l.duration > 0 ? start + l.duration : undefined,
                    agent,
                }),
            );
        }
    }
    return out.sort((a, b) => a.timeMs - b.timeMs);
}
