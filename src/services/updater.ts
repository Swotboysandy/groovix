import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

// Current app version. MUST match android/app/build.gradle versionName.
// The updater compares this against the latest GitHub release tag.
export const APP_VERSION = '1.0.29';

// GitHub repo that hosts release APKs.
const REPO = 'Swotboysandy/groovix_release';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const UPDATE_CACHE_KEY = 'groovix:last-update-info';
const UPDATE_CHECK_TIMEOUT_MS = 4_000;

export interface UpdateInfo {
    version: string;   // e.g. "1.0.1"
    notes: string;     // release body / changelog
    apkUrl: string;    // direct download URL for the .apk asset
}

/** Compare two dotted version strings. Returns 1 if a>b, -1 if a<b, 0 if equal. */
function compareVersions(a: string, b: string): number {
    const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * Check GitHub for a newer release. Returns UpdateInfo if an update is available,
 * otherwise null (already up to date, no APK asset, or network/parse error).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
    try {
        const res = await fetch(LATEST_RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: controller.signal,
        });
        if (!res.ok) return null;

        const data = await res.json();
        const tag: string = data?.tag_name || '';
        if (!tag || compareVersions(tag, APP_VERSION) <= 0) return null;

        const asset = (data.assets || []).find((a: any) =>
            typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk')
        );
        if (!asset?.browser_download_url) return null;

        const info = {
            version: tag.replace(/^v/i, ''),
            notes: (data.body || '').trim(),
            apkUrl: asset.browser_download_url,
        };
        await AsyncStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(info));
        return info;
    } catch {
        // A short outage should not hide an update we already discovered.
        try {
            const raw = await AsyncStorage.getItem(UPDATE_CACHE_KEY);
            const cached: UpdateInfo | null = raw ? JSON.parse(raw) : null;
            if (cached?.apkUrl && compareVersions(cached.version, APP_VERSION) > 0) return cached;
        } catch { /* corrupt/missing cache */ }
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Download the APK to the cache dir (reporting progress 0..1), then hand it to
 * the native installer which opens Android's package-installer prompt.
 */
export async function downloadAndInstall(
    apkUrl: string,
    onProgress?: (pct: number) => void,
): Promise<void> {
    const assetName = decodeURIComponent(apkUrl.split('/').pop()?.split('?')[0] || 'groovix-update.apk')
        .replace(/[^a-z0-9._-]/gi, '-');
    const dest = `${RNFS.CachesDirectoryPath}/${assetName}`;
    const partial = `${dest}.part`;

    const { ApkInstaller } = NativeModules as {
        ApkInstaller?: { install: (path: string) => Promise<boolean> };
    };
    if (!ApkInstaller) throw new Error('Installer not available on this build');

    // Reuse an APK that finished downloading before the connection/app was interrupted.
    try {
        if (await RNFS.exists(dest)) {
            const stat = await RNFS.stat(dest);
            if (Number(stat.size) > 1_000_000) {
                onProgress?.(1);
                await ApkInstaller.install(dest);
                return;
            }
            await RNFS.unlink(dest);
        }
    } catch { /* download a clean copy */ }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            if (await RNFS.exists(partial)) await RNFS.unlink(partial);
            const { promise } = RNFS.downloadFile({
                fromUrl: apkUrl,
                toFile: partial,
                progressDivider: 1,
                progressInterval: 250,
                progress: (r) => {
                    if (onProgress && r.contentLength > 0) {
                        onProgress(Math.min(0.99, r.bytesWritten / r.contentLength));
                    }
                },
            });
            const result = await promise;
            if (result.statusCode !== 200) throw new Error(`Download failed (HTTP ${result.statusCode})`);
            await RNFS.moveFile(partial, dest);
            onProgress?.(1);
            await ApkInstaller.install(dest);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise<void>(resolve => setTimeout(() => resolve(), 700 * (attempt + 1)));
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Download interrupted. Please try again.');
}
