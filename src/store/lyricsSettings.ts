import AsyncStorage from '@react-native-async-storage/async-storage';
import { LYRICS_SOURCES, type LyricsSourceId } from '../services/lyrics';

const KEY = 'groovix_lyrics_settings_v1';

export interface LyricsSettings {
    /** Sources the lyrics lookup may contact, in priority order. */
    order: LyricsSourceId[];
    enabled: LyricsSourceId[];
    /** Keep looking past a line-synced answer for a word-synced one. */
    prioritizeSyllableSync: boolean;
}

const defaults = (): LyricsSettings => ({
    order: LYRICS_SOURCES.map(source => source.id),
    enabled: LYRICS_SOURCES.map(source => source.id),
    prioritizeSyllableSync: false,
});

export async function getLyricsSettings(): Promise<LyricsSettings> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return defaults();
        const parsed = JSON.parse(raw);
        const known = new Set(LYRICS_SOURCES.map(source => source.id));
        const order: LyricsSourceId[] = (Array.isArray(parsed?.order) ? parsed.order : []).filter((id: LyricsSourceId) => known.has(id));
        // Sources added since the order was saved fall in at the end.
        LYRICS_SOURCES.forEach(source => { if (!order.includes(source.id)) order.push(source.id); });
        const enabled: LyricsSourceId[] = Array.isArray(parsed?.enabled) ? parsed.enabled.filter((id: LyricsSourceId) => known.has(id)) : defaults().enabled;
        return { order, enabled, prioritizeSyllableSync: parsed?.prioritizeSyllableSync === true };
    } catch {
        return defaults();
    }
}

export async function saveLyricsSettings(settings: LyricsSettings): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
