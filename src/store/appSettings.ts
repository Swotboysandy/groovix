// App-wide settings that screens and the player react to live: a stored object,
// an in-memory copy, and subscribers notified on every change.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { PlaybackQuality } from './preferences';

const KEY = 'groovix_app_settings_v1';

export type StreamSource = 'TIDAL' | 'JIOSAAVN' | 'AUDIUS';

export interface AppSettings {
    /** Stream quality per connection. */
    qualityWifi: PlaybackQuality;
    qualityMobile: PlaybackQuality;
    /** Order in which playable sources are tried; a source left out is skipped. */
    sourceOrder: StreamSource[];
    // Playback
    noRepeatInSession: boolean;
    // Appearance
    fullScreenCoverArt: boolean;
    reduceAnimation: boolean;
    reduceBlur: boolean;
    // Lyrics
    syncedLyrics: boolean;
    blurUnfocusedLyrics: boolean;
    translationLanguage: string; // '' = off, else an ISO code like 'en'
    // Miscellaneous
    hideVolumeBar: boolean;
    hideStatusBarInPlayer: boolean;
    showQueueHistory: boolean;
    // Advanced
    statsForNerds: boolean;
    // Scrobbling
    listenBrainzToken: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
    qualityWifi: 'LOSSLESS',
    qualityMobile: 'LOSSLESS',
    sourceOrder: ['TIDAL', 'JIOSAAVN', 'AUDIUS'],
    noRepeatInSession: false,
    fullScreenCoverArt: true,
    reduceAnimation: false,
    reduceBlur: false,
    syncedLyrics: true,
    blurUnfocusedLyrics: true,
    translationLanguage: '',
    hideVolumeBar: false,
    hideStatusBarInPlayer: false,
    showQueueHistory: false,
    statsForNerds: false,
    listenBrainzToken: '',
};

let current: AppSettings = DEFAULT_APP_SETTINGS;
let loaded: Promise<AppSettings> | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

export function loadAppSettings(): Promise<AppSettings> {
    if (!loaded) {
        loaded = AsyncStorage.getItem(KEY)
            .then(raw => {
                current = { ...DEFAULT_APP_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
                listeners.forEach(listener => listener(current));
                return current;
            })
            .catch(() => current);
    }
    return loaded;
}

/** The latest settings, synchronously (defaults until the first load finishes). */
export function appSettings(): AppSettings {
    return current;
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
    await loadAppSettings();
    current = { ...current, ...patch };
    listeners.forEach(listener => listener(current));
    await AsyncStorage.setItem(KEY, JSON.stringify(current));
}

export function subscribeAppSettings(listener: (settings: AppSettings) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Live settings for a component. */
export function useAppSettings(): AppSettings {
    const [settings, setSettings] = useState(current);
    useEffect(() => {
        void loadAppSettings().then(setSettings);
        return subscribeAppSettings(setSettings);
    }, []);
    return settings;
}

export const APP_SETTINGS_KEY = KEY;
