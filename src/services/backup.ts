// Export / import: every Groovix setting and the listening history as one JSON
// file in the phone's Downloads folder.
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

const FILE_NAME = 'groovix-backup.json';
export const BACKUP_PATH = `${RNFS.DownloadDirectoryPath}/${FILE_NAME}`;

// Settings and history only; device identity (groovix:…) stays on this phone.
const ours = (key: string) => key.startsWith('groovix_');

export async function exportData(): Promise<string> {
    const keys = (await AsyncStorage.getAllKeys()).filter(ours);
    const all = await AsyncStorage.getMany(keys);
    const data = Object.fromEntries(Object.entries(all).filter(([, value]) => value != null));
    await RNFS.writeFile(BACKUP_PATH, JSON.stringify({ app: 'Groovix', version: 1, exportedAt: new Date().toISOString(), data }, null, 2), 'utf8');
    return BACKUP_PATH;
}

/** Replaces this device's settings and history with the backup's. Returns how many items were restored. */
export async function importData(): Promise<number> {
    if (!(await RNFS.exists(BACKUP_PATH))) throw new Error(`No backup found at ${BACKUP_PATH}`);
    const parsed = JSON.parse(await RNFS.readFile(BACKUP_PATH, 'utf8'));
    if (parsed?.app !== 'Groovix' || typeof parsed?.data !== 'object') throw new Error('That file is not a Groovix backup.');
    const pairs = Object.entries(parsed.data as Record<string, string>).filter(([key, value]) => ours(key) && typeof value === 'string');
    const existing = (await AsyncStorage.getAllKeys()).filter(ours);
    await AsyncStorage.removeMany(existing);
    await AsyncStorage.setMany(Object.fromEntries(pairs));
    return pairs.length;
}
