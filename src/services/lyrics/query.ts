// LyricsQuery: strip credits and packaging, keep version words.

const CREDITS = [
    /\s*[(\[]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi,
    /\s+(feat|ft|featuring)\.?\s+.*$/gi,
    /\s*[(\[]\s*(official\s*)?(music\s*)?(video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|full\s*song)\s*[)\]]/gi,
    /\s*[(\[]\s*official\s*[)\]]/gi,
];

export function forLyricsSearch(title: string): string {
    let name = title;
    for (const p of CREDITS) name = name.replace(p, ' ');
    const out = name.replace(/\s+/g, ' ').trim().replace(/[,\-–—]+$/, '').trim();
    return out || title.trim();
}

export function artistForLyricsSearch(artist: string): string {
    const out = artist.replace(/ - Topic$/, '').trim();
    return out || artist.trim();
}
