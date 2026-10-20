// Lyric translation through Google's public translate endpoint. Lines go in
// batches joined by newlines, and come back split the same way.
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_BATCH_CHARS = 3500;

const cache = new Map<string, string[] | null>();

async function translateBatch(lines: string[], target: string): Promise<{ lines: string[]; source: string } | null> {
    const body = new URLSearchParams({ q: lines.join('\n') }).toString();
    const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) return null;
    const json = await response.json();
    const joined = (Array.isArray(json?.[0]) ? json[0] : []).map((segment: any) => segment?.[0] ?? '').join('');
    const out = joined.split('\n');
    return out.length === lines.length ? { lines: out, source: String(json?.[2] ?? '') } : null;
}

/**
 * One translation per lyric line, or null when the lyrics are already in the
 * target language or the service can't be reached.
 */
export async function translateLyrics(key: string, lines: string[], target: string): Promise<string[] | null> {
    if (!target || lines.length === 0) return null;
    const cacheKey = `${target}|${key}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
    try {
        const result: string[] = [];
        let batch: string[] = [];
        let size = 0;
        let source = '';
        const flush = async () => {
            if (!batch.length) return true;
            const answer = await translateBatch(batch, target);
            if (!answer) return false;
            source ||= answer.source;
            result.push(...answer.lines);
            batch = [];
            size = 0;
            return true;
        };
        for (const line of lines) {
            const text = line.replace(/\n/g, ' ');
            if (size + text.length > MAX_BATCH_CHARS && !(await flush())) return null;
            batch.push(text);
            size += text.length + 1;
        }
        if (!(await flush())) return null;
        const same = source.split('-')[0].toLowerCase() === target.split('-')[0].toLowerCase();
        const translated = same ? null : result;
        cache.set(cacheKey, translated);
        return translated;
    } catch {
        return null;
    }
}

/** Languages offered in Settings (code, name). */
export const TRANSLATION_LANGUAGES: [string, string][] = [
    ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
    ['pt', 'Portuguese'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-CN', 'Chinese'],
    ['ar', 'Arabic'], ['ru', 'Russian'], ['tr', 'Turkish'], ['id', 'Indonesian'], ['bn', 'Bengali'],
    ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
];
