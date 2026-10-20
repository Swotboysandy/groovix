import RNFS from 'react-native-fs';
import { API, getDashManifestDuration, getTidalSegmentProxyUrl } from '../api';
import type { Track, VerifiedFormat } from '../types';

// Keep MPD first so a seekable offline DASH package wins over a legacy
// concatenated .m4a if both exist during a one-time download migration.
const AUDIO_EXTENSIONS = ['mpd', 'flac', 'm4a', 'mp3', 'aac', 'ogg', 'wav'];
const DOWNLOAD_DIRECTORY = `${RNFS.DocumentDirectoryPath}/GroovixDownloads`;

export type DownloadProgress = {
    progress: number;
    stage: 'preparing' | 'downloading' | 'finishing';
};

export class DownloadCancelledError extends Error {
    constructor() {
        super('Download cancelled');
        this.name = 'DownloadCancelledError';
    }
}

export type DownloadedTrackFile = {
    name: string;
    title: string;
    artist: string;
    path: string;
    coverPath?: string;
    quality?: string;
    size: number;
    mtime: Date;
};

type DownloadMetadata = {
    title: string;
    artist: string;
    quality?: string;
    coverFile?: string;
    downloadedAt: string;
};

export function downloadBaseName(track: Track): string {
    const raw = `${track.artist?.name || 'Unknown'} - ${track.title}`;
    return raw.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().substring(0, 90) || `Groovix-${track.id}`;
}

async function ensureDownloadDirectory() {
    if (!(await RNFS.exists(DOWNLOAD_DIRECTORY))) {
        await RNFS.mkdir(DOWNLOAD_DIRECTORY);
    }
}

function fileExtension(url: string, fallback: string): string {
    const clean = url.split('?')[0].toLowerCase();
    return AUDIO_EXTENSIONS.find(extension => clean.endsWith(`.${extension}`)) || fallback;
}

async function removeIfPresent(path: string) {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
}

function replaceXmlAttribute(tag: string, name: string, value: string): string {
    const attribute = new RegExp(`(${name}=")[^"]*(")`, 'i');
    return attribute.test(tag)
        ? tag.replace(attribute, `$1${value}$2`)
        : tag.replace(/\s*\/?\s*>$/, match => ` ${name}="${value}"${match}`);
}

async function downloadAtomically(fromUrl: string, destination: string, startAt: number, onProgress?: (value: DownloadProgress) => void, shouldCancel?: () => boolean) {
    const partial = `${destination}.part`;
    await removeIfPresent(partial);
    const transfer = RNFS.downloadFile({
        fromUrl,
        toFile: partial,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        begin: () => undefined,
        progressDivider: 2,
        progress: event => {
            if (shouldCancel?.()) {
                RNFS.stopDownload(transfer.jobId);
                return;
            }
            const ratio = event.contentLength > 0 ? event.bytesWritten / event.contentLength : 0;
            onProgress?.({ progress: Math.min(0.98, startAt + ratio * (0.98 - startAt)), stage: 'downloading' });
        },
    });
    let result;
    try {
        result = await transfer.promise;
    } catch (error) {
        await removeIfPresent(partial);
        if (shouldCancel?.()) throw new DownloadCancelledError();
        throw error;
    }
    if (shouldCancel?.()) {
        await removeIfPresent(partial);
        throw new DownloadCancelledError();
    }
    if (result.statusCode < 200 || result.statusCode >= 300 || result.bytesWritten <= 0) {
        await removeIfPresent(partial);
        throw new Error(`Download failed (HTTP ${result.statusCode})`);
    }
    await removeIfPresent(destination);
    await RNFS.moveFile(partial, destination);
    return result.bytesWritten;
}

function xmlAttribute(xml: string, name: string): string {
    return (xml.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1] || '').replace(/&amp;/g, '&');
}

async function downloadDashResource(url: string, destination: string) {
    let directError: unknown;
    try {
        const direct = await RNFS.downloadFile({ fromUrl: url, toFile: destination }).promise;
        if (direct.statusCode >= 200 && direct.statusCode < 300) return direct;
        directError = new Error(`Direct audio request failed (HTTP ${direct.statusCode}).`);
    } catch (error) {
        directError = error;
    }
    const proxied = getTidalSegmentProxyUrl(url);
    if (!proxied) throw directError;
    await removeIfPresent(destination);
    return RNFS.downloadFile({ fromUrl: proxied, toFile: destination }).promise;
}

async function downloadDashAudio(mpdUrl: string, destination: string, startAt: number, onProgress?: (value: DownloadProgress) => void, shouldCancel?: () => boolean) {
    const response = await fetch(mpdUrl);
    if (!response.ok) throw new Error(`Could not read the lossless manifest (HTTP ${response.status}).`);
    const manifest = await response.text();
    const manifestDuration = getDashManifestDuration(manifest);
    if (manifestDuration > 0 && manifestDuration <= 35) {
        throw new Error('This source is only a preview and cannot be saved as a full song.');
    }
    const template = manifest.match(/<SegmentTemplate\b[^>]*>/i)?.[0] || '';
    const rawInitializationUrl = xmlAttribute(template, 'initialization');
    const rawMediaTemplate = xmlAttribute(template, 'media');
    const baseUrl = manifest.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i)?.[1]?.replace(/&amp;/g, '&').trim();
    let segmentBase = mpdUrl;
    try {
        if (baseUrl) segmentBase = new URL(baseUrl, mpdUrl).toString();
    } catch { /* retain manifest URL as the base */ }
    let initializationUrl = rawInitializationUrl;
    let mediaTemplate = rawMediaTemplate;
    try {
        initializationUrl = new URL(rawInitializationUrl, segmentBase).toString();
        mediaTemplate = new URL(rawMediaTemplate, segmentBase).toString();
    } catch { /* preserve the source values and let the transfer report the error */ }
    const startNumber = Number(xmlAttribute(template, 'startNumber') || 1);
    const timeline = manifest.match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/i)?.[1] || '';
    const segmentCount = [...timeline.matchAll(/<S\b([^>]*)\/?\s*>/gi)].reduce((count, match) => {
        const repeat = Number(match[1].match(/\br="(-?\d+)"/i)?.[1] || 0);
        return count + Math.max(1, repeat + 1);
    }, 0);
    if (!initializationUrl || !mediaTemplate || !segmentCount || !mediaTemplate.includes('$Number$')) {
        throw new Error('This lossless stream cannot be packaged for offline playback.');
    }

    const partial = `${destination}.part`;
    const packageDirectory = destination.replace(/\.mpd$/i, '.dash');
    const partialDirectory = `${packageDirectory}.part`;
    await removeIfPresent(partial);
    await removeIfPresent(partialDirectory);
    await RNFS.mkdir(partialDirectory);
    let bytes = 0;
    try {
        const initializationPath = `${partialDirectory}/init.m4s`;
        const initialization = await downloadDashResource(initializationUrl, initializationPath);
        if (initialization.statusCode < 200 || initialization.statusCode >= 300) throw new Error(`Audio initialization failed (HTTP ${initialization.statusCode}).`);
        bytes += initialization.bytesWritten;
        for (let index = 0; index < segmentCount; index += 1) {
            if (shouldCancel?.()) throw new DownloadCancelledError();
            const segmentUrl = mediaTemplate.replace('$Number$', String(startNumber + index));
            const segmentPath = `${partialDirectory}/segment-${startNumber + index}.m4s`;
            const segment = await downloadDashResource(segmentUrl, segmentPath);
            if (segment.statusCode < 200 || segment.statusCode >= 300) throw new Error(`Audio segment ${index + 1} failed (HTTP ${segment.statusCode}).`);
            bytes += segment.bytesWritten;
            onProgress?.({ progress: Math.min(0.98, startAt + ((index + 1) / segmentCount) * (0.98 - startAt)), stage: 'downloading' });
        }

        // A flattened sequence of fragmented MP4 chunks has no random-access index.
        // Retaining DASH structure lets ExoPlayer map a seek time to the right segment.
        const packageName = packageDirectory.substring(packageDirectory.lastIndexOf('/') + 1);
        let localTemplate = replaceXmlAttribute(template, 'initialization', `${encodeURIComponent(packageName)}/init.m4s`);
        localTemplate = replaceXmlAttribute(localTemplate, 'media', `${encodeURIComponent(packageName)}/segment-$Number$.m4s`);
        const localManifest = manifest.replace(template, localTemplate);
        await RNFS.writeFile(partial, localManifest, 'utf8');

        await removeIfPresent(packageDirectory);
        await removeIfPresent(destination);
        await RNFS.moveFile(partialDirectory, packageDirectory);
        await RNFS.moveFile(partial, destination);
        return bytes + localManifest.length;
    } catch (error) {
        await removeIfPresent(partial);
        await removeIfPresent(partialDirectory);
        throw error;
    }
}

export async function findDownloadedTrack(track: Track): Promise<string | null> {
    await ensureDownloadDirectory();
    const baseName = downloadBaseName(track);
    const directories = [DOWNLOAD_DIRECTORY, RNFS.DownloadDirectoryPath].filter(Boolean);
    for (const directory of directories) {
        for (const extension of AUDIO_EXTENSIONS) {
            const path = `${directory}/${baseName}.${extension}`;
            if (await RNFS.exists(path)) {
                if (extension === 'mpd') {
                    const manifest = await RNFS.readFile(path, 'utf8').catch(() => '');
                    const duration = getDashManifestDuration(manifest);
                    if (duration > 0 && duration <= 35) continue;
                }
                return path;
            }
        }
    }
    return null;
}

export async function downloadTrackForOffline(
    track: Track,
    quality: string,
    onProgress?: (value: DownloadProgress) => void,
    shouldCancel?: () => boolean,
): Promise<{ path: string; bytes: number; format: Omit<VerifiedFormat, 'bytes'> | null }> {
    await ensureDownloadDirectory();
    const existing = await findDownloadedTrack(track);
    if (existing) {
        const stat = await RNFS.stat(existing);
        return { path: existing, bytes: Number(stat.size), format: null };
    }

    onProgress?.({ progress: 0.03, stage: 'preparing' });
    if (shouldCancel?.()) throw new DownloadCancelledError();
    let sourceUrl = '';
    let dashUrl = '';
    let extension = 'flac';
    let format: Omit<VerifiedFormat, 'bytes'> | null = null;
    let transferStart = 0.12;

    const stream = await API.getTrackStreamData(track, quality);
    if (shouldCancel?.()) throw new DownloadCancelledError();
    if (stream.url && stream.url.toLowerCase().includes('.mpd')) {
        dashUrl = stream.url;
        extension = 'mpd';
        format = stream.format ? { ...stream.format, channels: 2 } : null;
        transferStart = 0.08;
        onProgress?.({ progress: transferStart, stage: 'downloading' });
    } else if (stream.url) {
        sourceUrl = stream.url;
        extension = fileExtension(stream.url, track.source === 'audius' ? 'mp3' : 'flac');
        format = stream.format ? { ...stream.format, channels: 2 } : null;
    } else {
        throw new Error('No offline source is currently available for this song.');
    }

    const baseName = downloadBaseName(track);
    const destination = `${DOWNLOAD_DIRECTORY}/${baseName}.${extension}`;
    const bytes = dashUrl
        ? await downloadDashAudio(dashUrl, destination, transferStart, onProgress, shouldCancel)
        : await downloadAtomically(sourceUrl, destination, transferStart, onProgress, shouldCancel);
    onProgress?.({ progress: 0.99, stage: 'finishing' });

    const rawCover = track.album?.cover || track.coverUrl || '';
    const coverUrl = rawCover.startsWith('http') ? rawCover : rawCover ? API.getCoverUrl(rawCover, 640) : '';
    const coverFile = `${baseName}.jpg`;
    if (coverUrl) {
        await RNFS.downloadFile({ fromUrl: coverUrl, toFile: `${DOWNLOAD_DIRECTORY}/${coverFile}` }).promise.catch(() => null);
    }
    const metadata: DownloadMetadata = {
        title: track.title,
        artist: track.artist?.name || 'Unknown',
        quality: format
            ? `${format.codec?.toUpperCase() || 'FLAC'}${format.bitDepth ? ` ${format.bitDepth}-bit` : ''}${format.bitrate ? ` ${Math.max(32, Math.round(format.bitrate / 32000) * 32)}kbps` : ''}${format.sampleRate ? `/${format.sampleRate / 1000}kHz` : ''}`
            : track.audioQuality,
        coverFile: coverUrl ? coverFile : undefined,
        downloadedAt: new Date().toISOString(),
    };
    await RNFS.writeFile(`${DOWNLOAD_DIRECTORY}/${baseName}.json`, JSON.stringify(metadata), 'utf8');
    onProgress?.({ progress: 1, stage: 'finishing' });
    return { path: destination, bytes, format };
}

export async function listDownloadedTracks(): Promise<DownloadedTrackFile[]> {
    await ensureDownloadDirectory();
    const directories = [DOWNLOAD_DIRECTORY, RNFS.DownloadDirectoryPath].filter(Boolean);
    const seen = new Set<string>();
    const downloads: DownloadedTrackFile[] = [];
    for (const directory of directories) {
        const files = await RNFS.readDir(directory).catch(() => []);
        for (const file of files) {
            const extension = file.name.split('.').pop()?.toLowerCase();
            if (!file.isFile() || !extension || !AUDIO_EXTENSIONS.includes(extension)) continue;
            const name = file.name.replace(/\.[^/.]+$/, '');
            if (seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            let metadata: DownloadMetadata | null = null;
            try {
                metadata = JSON.parse(await RNFS.readFile(`${directory}/${name}.json`, 'utf8'));
            } catch { /* legacy download without metadata */ }
            const split = name.split(' - ');
            const coverPath = metadata?.coverFile ? `${directory}/${metadata.coverFile}` : `${directory}/${name}.jpg`;
            downloads.push({
                name,
                title: metadata?.title || (split.length > 1 ? split.slice(1).join(' - ') : name),
                artist: metadata?.artist || (split.length > 1 ? split[0] : 'Unknown'),
                quality: metadata?.quality,
                path: file.path,
                coverPath: await RNFS.exists(coverPath) ? coverPath : undefined,
                size: Number(file.size),
                mtime: file.mtime ? new Date(file.mtime) : new Date(),
            });
        }
    }
    return downloads.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export async function deleteDownloadedTrack(file: DownloadedTrackFile) {
    const directory = file.path.substring(0, file.path.lastIndexOf('/'));
    const companions = [file.path, `${directory}/${file.name}.dash`, `${directory}/${file.name}.jpg`, `${directory}/${file.name}.json`, `${directory}/${file.name}.lrc`];
    await Promise.all(companions.map(path => removeIfPresent(path)));
}
