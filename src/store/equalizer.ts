// equaliser settings (AppSettings.equalizer*), persisted and pushed
// to the native EqualizerProcessor every time they change.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

const KEY = 'groovix_equalizer_v1';

export const MANUAL_BANDS_HZ = [60, 150, 400, 1000, 2500, 6000, 14000];
export const MANUAL_RANGE_DB = 12;
export const TONE_STEPS = 5;

export const EQUALIZER_PRESETS = {
    FLAT: [0, 0, 0, 0, 0, 0, 0],
    ACOUSTIC: [3, 1.5, 0, 1.5, 2.5, 2, 1],
    BASS_BOOST: [6, 4, 1.5, 0, 0, 0, 0],
    BASS_CUT: [-6, -4, -1.5, 0, 0, 0, 0],
    VOCAL: [-3, -1.5, 1, 3.5, 3, 1, -1],
    TREBLE_BOOST: [0, 0, 0, 0, 1.5, 3.5, 5],
    TREBLE_CUT: [0, 0, 0, 0, -1.5, -3.5, -5],
    LOUDNESS: [6, 3.5, 0, -1.5, -1, 2, 5],
    SPOKEN_WORD: [-5, -2.5, 1.5, 4, 3.5, 1.5, -2],
    ELECTRONIC: [5, 3, -1, 0, 1, 3, 4],
    ROCK: [4, 2.5, -1, -1.5, 1, 3, 3.5],
    HIP_HOP: [6, 4, 0.5, -1, 0.5, 2, 2.5],
    JAZZ: [3, 1.5, 0, 1, 1.5, 2, 2.5],
    CLASSICAL: [3, 2, 0, 0, 1, 2.5, 3],
    SMALL_SPEAKERS: [5, 4, 2, 0.5, 0, -1, -2],
    LATE_NIGHT: [3, 1, 0, 1.5, 1, -1, -3],
} as const;
export type EqualizerPreset = keyof typeof EQUALIZER_PRESETS | 'CUSTOM';

export const PRESET_LABELS: Record<EqualizerPreset, string> = {
    FLAT: 'Flat', ACOUSTIC: 'Acoustic', BASS_BOOST: 'Bass Booster', BASS_CUT: 'Bass Reducer', VOCAL: 'Vocal Booster',
    TREBLE_BOOST: 'Treble Booster', TREBLE_CUT: 'Treble Reducer', LOUDNESS: 'Loudness', SPOKEN_WORD: 'Spoken Word',
    ELECTRONIC: 'Electronic', ROCK: 'Rock', HIP_HOP: 'Hip-Hop', JAZZ: 'Jazz', CLASSICAL: 'Classical',
    SMALL_SPEAKERS: 'Small Speakers', LATE_NIGHT: 'Late Night', CUSTOM: 'Custom',
};

export interface EqualizerSettings {
    enabled: boolean;
    mode: 'DYNAMIC' | 'MANUAL';
    toneX: number;
    toneY: number;
    focused: boolean;
    balance: number;
    bands: number[];
    preset: EqualizerPreset;
}

export const DEFAULT_EQUALIZER: EqualizerSettings = {
    enabled: false, mode: 'DYNAMIC', toneX: 0, toneY: 0, focused: false, balance: 0,
    bands: [...EQUALIZER_PRESETS.FLAT], preset: 'FLAT',
};

/** The preset whose curve these bands are, or CUSTOM if they are nobody's. */
export function matchingPreset(bands: number[]): EqualizerPreset {
    const found = (Object.keys(EQUALIZER_PRESETS) as (keyof typeof EQUALIZER_PRESETS)[])
        .find(key => EQUALIZER_PRESETS[key].every((value, index) => Math.abs(value - (bands[index] ?? 0)) < 0.05));
    return found ?? 'CUSTOM';
}

function push(settings: EqualizerSettings) {
    const native = NativeModules.GroovixEqualizer;
    native?.setTuning?.(settings.enabled, settings.mode === 'MANUAL', settings.bands, settings.toneX, settings.toneY, settings.focused, settings.balance);
}

export async function getEqualizer(): Promise<EqualizerSettings> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        return raw ? { ...DEFAULT_EQUALIZER, ...JSON.parse(raw) } : DEFAULT_EQUALIZER;
    } catch {
        return DEFAULT_EQUALIZER;
    }
}

export async function saveEqualizer(settings: EqualizerSettings): Promise<void> {
    push(settings);
    await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

/** Restores the saved tuning into the native processor at startup. */
export async function restoreEqualizer(): Promise<void> {
    push(await getEqualizer());
}

export function openSystemEqualizer() {
    NativeModules.GroovixEqualizer?.openSystemEqualizer?.();
}
