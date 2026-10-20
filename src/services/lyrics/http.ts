// LyricsHttp: short deadline, null on any failure.

export const LYRICS_AGENT = 'Groovix (https://groovix.pracandy.com)';
const LYRICS_TIMEOUT_MS = 6000;

export async function httpGet(
    url: string,
    opts: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LYRICS_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', onAbort);
    }
    try {
        const res = await fetch(url, { headers: opts.headers, signal: controller.signal });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
    }
}

/** Body of a successful GET, or null for any failure at all. */
export const lyricsGet = (url: string, signal?: AbortSignal, timeoutMs?: number) =>
    httpGet(url, {
        headers: { 'User-Agent': LYRICS_AGENT, Accept: 'application/json' },
        signal,
        timeoutMs,
    });

export const lyricsGetAuthorized = (url: string, bearer: string, signal?: AbortSignal) =>
    httpGet(url, {
        headers: {
            'User-Agent': LYRICS_AGENT,
            Accept: 'application/json',
            Authorization: `Bearer ${bearer}`,
            Origin: 'https://music.apple.com',
            Referer: 'https://music.apple.com/',
        },
        signal,
    });

export function qs(base: string, params: Record<string, string | number | undefined | null>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}` : base;
}

export function parseJson(body: string | null): any {
    if (body == null) return null;
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}
