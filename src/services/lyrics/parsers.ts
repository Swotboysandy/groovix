// SyllableRuns, EnhancedLrc, LrcLib.parseLrc, KaraokeLrc,
// ProviderLyrics, TtmlLyrics (DOM-free) and BackgroundVocals.
import { Line, Word, line } from './types';

// ---------- SyllableRuns ----------

export type TimedRun = { startMs: number; endMs: number; raw: string };

const isWs = (c: string | undefined) => !!c && /\s/.test(c);
const isUnspacedScript = (c: string | undefined) =>
    !!c && /[㐀-鿿぀-ヿ　-〿＀-￯฀-๿]/.test(c);

export function wordsFromRuns(runs: TimedRun[], spacingIsExplicit = false): Word[] {
    const glue = spacingIsExplicit || runs.some(r => /\s/.test(r.raw));
    const words: Word[] = [];
    let current = '';
    let start = 0;
    let end = 0;
    const flush = () => {
        if (current) words.push({ startMs: start, endMs: Math.max(start, end), text: current });
        current = '';
    };
    for (const run of runs) {
        const content = run.raw.trim();
        if (!content) {
            flush();
            continue;
        }
        const joins =
            glue &&
            current.length > 0 &&
            !isWs(run.raw[0]) &&
            !isUnspacedScript(current[current.length - 1]) &&
            !isUnspacedScript(content[0]);
        if (!joins) flush();
        if (!current) {
            start = run.startMs;
            end = run.startMs;
        }
        current += content;
        end = Math.max(end, Math.max(run.startMs, run.endMs));
        if (!glue || isWs(run.raw[run.raw.length - 1])) flush();
    }
    flush();
    return words;
}

// ---------- Entities ----------

export function decodeEntities(text: string): string {
    if (!text.includes('&')) return text;
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

// ---------- Enhanced (A2) LRC ----------

const A2_LINE = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})](.*)$/;
const A2_WORD = /<(\d{1,3}):(\d{2})[.:](\d{2,3})>([^<]*)/g;
const TAIL_MS = 800;

function stampMs(m: string, s: string, f: string): number {
    const fractionMs = f.length === 3 ? parseInt(f, 10) : parseInt(f, 10) * 10;
    return parseInt(m, 10) * 60000 + parseInt(s, 10) * 1000 + fractionMs;
}

/** Empty when there are no word stamps — the caller can then fall back. */
export function parseEnhancedLrc(lrc: string): Line[] {
    const rows = lrc
        .split(/\r?\n/)
        .map(l => A2_LINE.exec(l.trim()))
        .filter((m): m is RegExpExecArray => !!m)
        .map(m => ({
            timeMs: stampMs(m[1], m[2], m[3]),
            words: [...m[4].matchAll(A2_WORD)],
            plain: m[4].trim(),
        }))
        .sort((a, b) => a.timeMs - b.timeMs);
    if (!rows.some(r => r.words.length > 0)) return [];

    const out: Line[] = [];
    rows.forEach((row, index) => {
        if (row.words.length === 0) {
            const text = decodeEntities(row.plain);
            if (text) out.push(line(row.timeMs, text));
            return;
        }
        const last = row.words[row.words.length - 1];
        const lineEnd = rows[index + 1]?.timeMs ?? stampMs(last[1], last[2], last[3]) + TAIL_MS;
        const runs = row.words.map((w, i) => {
            const next = row.words[i + 1];
            return {
                startMs: stampMs(w[1], w[2], w[3]),
                endMs: next ? stampMs(next[1], next[2], next[3]) : lineEnd,
                raw: decodeEntities(w[4]),
            };
        });
        const words = wordsFromRuns(runs);
        if (!words.length) return;
        out.push(line(Math.min(row.timeMs, words[0].startMs), words.map(w => w.text).join(' '), { words }));
    });
    return out;
}

// ---------- Plain LRC (LrcLib.parseLrc) ----------

const STAMP = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})]/;
const WORD_STAMP_G = /<(\d{1,3}):(\d{2})[.:](\d{2,3})>/g;
const MIN_GAP_MS = 4000;

function fracMs(f: string) {
    return f.length === 2 ? parseInt(f, 10) * 10 : f.length === 3 ? parseInt(f, 10) : 0;
}

function parseWordRuns(body: string): Word[] {
    const marks = [...body.matchAll(WORD_STAMP_G)];
    if (!marks.length) return [];
    const runs = marks.map((m, i) => {
        const until = marks[i + 1]?.index ?? body.length;
        return {
            startMs: parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + fracMs(m[3]),
            text: body.substring((m.index ?? 0) + m[0].length, until),
        };
    });
    return wordsFromRuns(
        runs.map((r, i) => ({ startMs: r.startMs, endMs: runs[i + 1]?.startMs ?? r.startMs, raw: r.text })),
    );
}

export function parseLrc(lrc: string): Line[] {
    const all: Line[] = [];
    for (const raw of lrc.split(/\r?\n/)) {
        const m = STAMP.exec(raw);
        if (!m) continue;
        let body = raw.substring(m.index + m[0].length);
        let agent: string | undefined;
        if (body.startsWith('<R>')) {
            body = body.substring(3);
            agent = 'end';
        }
        all.push(
            line(
                parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + fracMs(m[3]),
                body.replace(WORD_STAMP_G, '').trim(),
                { words: parseWordRuns(body), agent },
            ),
        );
    }
    all.sort((a, b) => a.timeMs - b.timeMs);
    // Drop blank lines too short to be real breaks.
    return all.filter((l, i) => {
        if (l.text) return true;
        const next = all[i + 1];
        return !next || next.timeMs - l.timeMs >= MIN_GAP_MS;
    });
}

// ---------- QRC / YRC karaoke ----------

const K_LINE = /^\[(\d{1,8}),(\d{1,8})](.*)$/;
const K_PREFIX = /\((\d{1,8}),(\d{1,8})(?:,\d{1,8})?\)([^()]*)/g;
const K_SUFFIX = /([^()]*)\((\d{1,8}),(\d{1,8})(?:,\d{1,8})?\)/g;
const K_TIME = /\(\d{1,8},\d{1,8}(?:,\d{1,8})?\)/g;
const K_CONTENT = /LyricContent\s*=\s*"([^"]*)"/i;

function lyricContent(raw: string): string {
    const m = K_CONTENT.exec(raw);
    if (!m) return raw;
    return m[1]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

export function looksLikeKaraoke(raw: string): boolean {
    return lyricContent(raw)
        .split(/\r?\n/)
        .some(l => {
            const m = K_LINE.exec(l.trim());
            if (!m) return false;
            return new RegExp(K_PREFIX.source).test(m[3]) || new RegExp(K_SUFFIX.source).test(m[3]);
        });
}

export function parseKaraoke(raw: string): Line[] {
    const rows: Line[] = [];
    for (const src of lyricContent(raw).split(/\r?\n/)) {
        const m = K_LINE.exec(src.trim());
        if (!m) continue;
        const lineStart = parseInt(m[1], 10);
        const lineDuration = parseInt(m[2], 10);
        const body = m[3];
        const run = (text: string, s: string, d: string): TimedRun => ({
            startMs: parseInt(s, 10),
            endMs: parseInt(s, 10) + parseInt(d, 10),
            raw: decodeEntities(text),
        });
        const prefixed = wordsFromRuns([...body.matchAll(K_PREFIX)].map(w => run(w[3], w[1], w[2])));
        const suffixed = wordsFromRuns([...body.matchAll(K_SUFFIX)].map(w => run(w[1], w[2], w[3])));
        const len = (ws: Word[]) => ws.reduce((n, w) => n + w.text.length, 0);
        const words = len(prefixed) >= len(suffixed) ? prefixed : suffixed;
        if (!words.length) continue;
        const text = decodeEntities(body.replace(K_TIME, '')).trim();
        if (!text) continue;
        rows.push(
            line(Math.min(lineStart, words[0].startMs), text, {
                words,
                sungUntilMs: lineDuration > 0 ? lineStart + lineDuration : undefined,
            }),
        );
    }
    return rows.sort((a, b) => a.timeMs - b.timeMs);
}

// ---------- TTML (DOM-free) ----------

type XNode = { tag: string; attrs: Record<string, string>; children: (XNode | string)[] };

function parseAttrs(src: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    return attrs;
}

/** Minimal XML tree builder: elements and text only; comments, PIs and doctype skipped. */
function parseXml(xml: string): XNode {
    const root: XNode = { tag: '#root', attrs: {}, children: [] };
    const stack: XNode[] = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) {
            top.children.push(m[1]);
        } else if (m[6] !== undefined) {
            top.children.push(decodeEntities(m[6]));
        } else if (m[3] !== undefined) {
            if (m[2] === '/') {
                for (let i = stack.length - 1; i > 0; i--) {
                    if (stack[i].tag === m[3]) {
                        stack.length = i;
                        break;
                    }
                }
            } else {
                const el: XNode = { tag: m[3], attrs: parseAttrs(m[4] || ''), children: [] };
                top.children.push(el);
                if (m[5] !== '/') stack.push(el);
            }
        }
    }
    return root;
}

const localName = (n: string) => (n.includes(':') ? n.substring(n.indexOf(':') + 1) : n);

function attr(el: XNode, name: string): string {
    if (el.attrs[name]) return el.attrs[name];
    const local = localName(name);
    for (const [k, v] of Object.entries(el.attrs)) if (k === local || localName(k) === local) return v;
    return '';
}

function findAll(node: XNode, pred: (n: XNode) => boolean, out: XNode[] = []): XNode[] {
    for (const c of node.children) {
        if (typeof c === 'string') continue;
        if (pred(c)) out.push(c);
        findAll(c, pred, out);
    }
    return out;
}

function textContent(node: XNode): string {
    return node.children.map(c => (typeof c === 'string' ? c : textContent(c))).join('');
}

/** TTML clock values in ms: 27.395, 1:05.20, 1:02:03.4, 12s, 300ms. */
export function ttmlTime(value?: string): number | null {
    const raw = value?.trim();
    if (!raw) return null;
    if (raw.endsWith('ms')) {
        const n = parseFloat(raw.slice(0, -2));
        return isNaN(n) ? null : Math.floor(n);
    }
    const parts = raw.replace(/s$/, '').split(':').map(Number);
    if (parts.some(p => isNaN(p))) return null;
    let seconds: number;
    if (parts.length === 1) seconds = parts[0];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else return null;
    return Math.floor(seconds * 1000);
}

type Piece = { kind: 'text'; text: string } | { kind: 'timed'; text: string; start: number; end: number };

const SKIPPED_ROLES = new Set(['x-translation', 'x-roman']);
const BACKGROUND_ROLE = 'x-bg';

function hasTimedChild(el: XNode): boolean {
    return el.children.some(c => typeof c !== 'string' && (!!c.attrs.begin || hasTimedChild(c)));
}

function collect(node: XNode, out: Piece[], backing: Piece[]) {
    for (const child of node.children) {
        if (typeof child === 'string') {
            if (child) out.push({ kind: 'text', text: child });
            continue;
        }
        const role = attr(child, 'ttm:role');
        if (SKIPPED_ROLES.has(role)) continue;
        const sink = role === BACKGROUND_ROLE ? backing : out;
        const begin = ttmlTime(child.attrs.begin);
        const end = ttmlTime(child.attrs.end);
        if (begin != null && end != null && !hasTimedChild(child)) {
            sink.push({ kind: 'timed', text: textContent(child), start: begin, end });
        } else {
            collect(child, sink, backing);
        }
    }
}

function mergeIntoWords(pieces: Piece[]): Word[] {
    const words: Word[] = [];
    let current = '';
    let start = 0;
    let end = 0;
    let timed = false;
    const flush = () => {
        const text = current.trim();
        current = '';
        if (text && timed) words.push({ startMs: start, endMs: end, text });
        timed = false;
    };
    for (const p of pieces) {
        if (p.kind === 'text') {
            if (!p.text.trim()) flush();
            else if (timed) current += p.text;
        } else {
            if (!p.text.trim()) continue;
            if (isWs(p.text[0])) flush();
            if (!current) start = p.start;
            current += p.text.trim();
            end = p.end;
            timed = true;
            if (isWs(p.text[p.text.length - 1])) flush();
        }
    }
    flush();
    return words;
}

function ttmlLine(p: XNode): Line | null {
    const pieces: Piece[] = [];
    const backingPieces: Piece[] = [];
    collect(p, pieces, backingPieces);
    const words = mergeIntoWords(pieces);
    const bw = mergeIntoWords(backingPieces);
    const background = bw.length ? line(bw[0].startMs, bw.map(w => w.text).join(' '), { words: bw }) : undefined;
    const agent = attr(p, 'ttm:agent') || undefined;

    if (!words.length) {
        const text = textContent(p).trim();
        const begin = ttmlTime(p.attrs.begin);
        if (begin == null || !text) return null;
        const end = ttmlTime(p.attrs.end);
        return line(begin, text, { sungUntilMs: end != null && end > begin ? end : undefined, agent });
    }
    const begin = ttmlTime(p.attrs.begin) ?? words[0].startMs;
    return line(Math.min(begin, words[0].startMs), words.map(w => w.text).join(' '), {
        words,
        background,
        agent,
    });
}

export function parseTtml(ttml: string): Line[] {
    try {
        const root = parseXml(ttml);
        const ps = findAll(root, n => localName(n.tag) === 'p');
        return ps
            .map(ttmlLine)
            .filter((l): l is Line => !!l)
            .sort((a, b) => a.timeMs - b.timeMs);
    } catch {
        return [];
    }
}

// ---------- ProviderLyrics ----------

const CONTENT_KEYS = [
    'ttml', 'ttmlContent', 'lyrics', 'lrc', 'content', 'text',
    'plainLyrics', 'syncedLyrics', 'line', 'lines', 'lyric',
    'data', 'result', 'response',
];

function extract(el: any): string | null {
    if (el == null) return null;
    if (typeof el === 'string') {
        const text = el.trim();
        try {
            const nested = JSON.parse(text);
            if (nested !== null && typeof nested === 'object') return extract(nested);
        } catch {}
        return text;
    }
    if (Array.isArray(el)) {
        const joined = el.map(extract).filter((x): x is string => x != null).join('\n');
        return joined.trim() ? joined : null;
    }
    if (typeof el === 'object') {
        if (el.isError === true || el.ok === false) return null;
        if (el.error != null && el.error !== false && el.error !== '') return null;
        for (const k of CONTENT_KEYS) {
            if (k in el) {
                const v = extract(el[k]);
                if (v != null) return v;
            }
        }
        if (el.metadata && typeof el.metadata === 'object' && !Array.isArray(el.metadata)) {
            const v = extract(el.metadata);
            if (v != null) return v;
        }
        return el.words != null ? extract(el.words) : null;
    }
    return null;
}

export function unwrap(raw: string): string | null {
    let value = raw.replace(/﻿/g, '').trim();
    if (value.startsWith('```')) {
        let ls = value.split('\n').slice(1);
        if (ls[ls.length - 1]?.trim() === '```') ls = ls.slice(0, -1);
        value = ls.join('\n').trim();
    }
    if (!value) return null;
    let json: any;
    try {
        json = JSON.parse(value);
    } catch {
        return value;
    }
    const out = extract(json)?.trim();
    return out ? out : null;
}

function unescapeTtml(v: string): string {
    if (!/&lt;tt/i.test(v)) return v;
    return v
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

export function plainLines(content: string): Line[] {
    return content
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s && !/^\[[A-Za-z]+:.*]$/.test(s))
        .map(s => line(0, s, { unsynced: true }));
}

export function parseProviderLyrics(raw: string): Line[] | null {
    const unwrapped = unwrap(raw);
    if (unwrapped == null) return null;
    const content = unescapeTtml(unwrapped);
    let lines: Line[];
    if (/<tt(?:\s|>)/i.test(content) || /http:\/\/www\.w3\.org\/ns\/ttml/i.test(content)) lines = parseTtml(content);
    else if (looksLikeKaraoke(content)) lines = parseKaraoke(content);
    else if (content.trimStart().startsWith('<')) lines = [];
    else {
        lines = parseEnhancedLrc(content);
        if (!lines.length) lines = parseLrc(content);
        if (!lines.length) {
            lines = /\b(?:lyrics? (?:not found|unavailable)|error)\b/i.test(content) ? [] : plainLines(content);
        }
    }
    return lines.some(l => l.text.trim()) ? lines : null;
}

// ---------- BackgroundVocals ----------

function bracketStart(text: string): number | null {
    if (!text.endsWith(')')) return null;
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (c === ')') depth++;
        else if (c === '(') {
            depth--;
            if (depth === 0) return i > 0 ? i : null;
        }
    }
    return null;
}

function indexOfWordStartingAt(words: Word[], offset: number): number | null {
    let at = 0;
    for (let i = 0; i < words.length; i++) {
        if (at === offset) return i;
        if (at > offset) return null;
        at += words[i].text.length + 1;
    }
    return null;
}

function splitTrailingBracket(l: Line): Line {
    if (l.background || !l.text) return l;
    const open = bracketStart(l.text);
    if (open == null) return l;
    const lead = l.text.substring(0, open).trimEnd();
    const backing = l.text.substring(open).trim();
    if (!lead || !/[\p{L}\p{N}]/u.test(backing)) return l;
    if (!l.words.length) {
        return { ...l, text: lead, background: line(l.timeMs, backing, { sungUntilMs: l.sungUntilMs }) };
    }
    const split = indexOfWordStartingAt(l.words, open);
    if (split == null || split <= 0) return l;
    const bw = l.words.slice(split);
    return {
        ...l,
        text: lead,
        words: l.words.slice(0, split),
        background: line(bw[0].startMs, backing, { words: bw }),
    };
}

export const withBackgroundVocals = (lines: Line[]) => lines.map(splitTrailingBracket);
