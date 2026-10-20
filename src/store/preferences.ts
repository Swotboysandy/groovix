import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeMode } from '../theme';

const KEY = 'groovix_prefs_v1';

export type PlaybackQuality = 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH' | 'LOW';

export interface UserPrefs {
    genres: string[];
    artists: string[];
    language?: 'english' | 'hindi' | 'both';
    theme?: ThemeMode;
    /** Preferred quality for future streams. The player may truthfully fall back per track. */
    streamingQuality?: PlaybackQuality;
    /** Download quality is independent from the quality currently being streamed. */
    downloadQuality?: PlaybackQuality;
    downloadWifiOnly?: boolean;
    themeSetting?: 'system' | 'light' | 'dark';
}

export async function getPrefs(): Promise<UserPrefs | null> {
    try {
        const v = await AsyncStorage.getItem(KEY);
        return v ? JSON.parse(v) : null;
    } catch { return null; }
}

export async function savePrefs(prefs: UserPrefs): Promise<void> {
    // Settings are edited from several screens. Merge with the stored object so a
    // theme or language change cannot silently erase audio/download preferences.
    const current = await getPrefs();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...current, ...prefs }));
}

export async function clearPrefs(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}

export const GENRE_LIST = [
    { id: 'pop',       label: 'Pop',        icon: 'music-clef-treble',     color: '#A259FF', audiomack: 'pop' },
    { id: 'hiphop',    label: 'Hip-Hop',    icon: 'microphone-variant',    color: '#F24E1E', audiomack: null },
    { id: 'rnb',       label: 'R&B',        icon: 'heart-pulse',           color: '#FF5C87', audiomack: 'rnb' },
    { id: 'afrobeats', label: 'Afrobeats',  icon: 'earth',                 color: '#1ABCFE', audiomack: 'afrobeats' },
    { id: 'dancehall', label: 'Dancehall',  icon: 'headphones',            color: '#0ACF83', audiomack: 'dancehall' },
    { id: 'desi',      label: 'Desi',       icon: 'star-four-points',      color: '#FF9F43', audiomack: null },
    { id: 'latin',     label: 'Latin',      icon: 'guitar-acoustic',       color: '#EE5A24', audiomack: null },
    { id: 'country',   label: 'Country',    icon: 'guitar-electric',       color: '#8395A7', audiomack: 'country' },
];

export const ARTIST_LIST: { name: string; genre: string }[] = [
    // Hip-Hop / Rap
    { name: 'Drake',             genre: 'hiphop' },
    { name: 'Travis Scott',      genre: 'hiphop' },
    { name: 'Future',            genre: 'hiphop' },
    { name: 'Lil Baby',          genre: 'hiphop' },
    { name: '21 Savage',         genre: 'hiphop' },
    { name: 'Nicki Minaj',       genre: 'hiphop' },
    { name: 'Juice WRLD',        genre: 'hiphop' },
    { name: 'Polo G',            genre: 'hiphop' },
    { name: 'Roddy Ricch',       genre: 'hiphop' },
    { name: 'Post Malone',       genre: 'hiphop' },
    { name: 'Cardi B',           genre: 'hiphop' },
    { name: 'Jack Harlow',       genre: 'hiphop' },
    { name: 'Don Toliver',       genre: 'hiphop' },
    { name: 'Gunna',             genre: 'hiphop' },
    { name: 'Lil Durk',          genre: 'hiphop' },
    { name: 'NBA YoungBoy',      genre: 'hiphop' },
    { name: 'DaBaby',            genre: 'hiphop' },
    { name: 'Megan Thee Stallion', genre: 'hiphop' },
    { name: 'Kendrick Lamar',    genre: 'hiphop' },
    { name: 'J. Cole',           genre: 'hiphop' },
    { name: 'Tyler the Creator', genre: 'hiphop' },
    { name: 'A$AP Rocky',        genre: 'hiphop' },
    { name: 'Lil Uzi Vert',      genre: 'hiphop' },
    { name: 'Playboi Carti',     genre: 'hiphop' },
    { name: 'Moneybagg Yo',      genre: 'hiphop' },
    // R&B
    { name: 'The Weeknd',        genre: 'rnb' },
    { name: 'SZA',               genre: 'rnb' },
    { name: 'Doja Cat',          genre: 'rnb' },
    { name: 'H.E.R.',            genre: 'rnb' },
    { name: 'Khalid',            genre: 'rnb' },
    { name: 'Bryson Tiller',     genre: 'rnb' },
    { name: '6LACK',             genre: 'rnb' },
    { name: 'Giveon',            genre: 'rnb' },
    { name: 'Brent Faiyaz',      genre: 'rnb' },
    { name: 'Summer Walker',     genre: 'rnb' },
    { name: 'Chris Brown',       genre: 'rnb' },
    { name: 'Ty Dolla Sign',     genre: 'rnb' },
    { name: 'Jazmine Sullivan',  genre: 'rnb' },
    { name: 'Lucky Daye',        genre: 'rnb' },
    { name: 'Daniel Caesar',     genre: 'rnb' },
    { name: 'Ari Lennox',        genre: 'rnb' },
    // Pop
    { name: 'Ed Sheeran',        genre: 'pop' },
    { name: 'Justin Bieber',     genre: 'pop' },
    { name: 'Ariana Grande',     genre: 'pop' },
    { name: 'Billie Eilish',     genre: 'pop' },
    { name: 'Harry Styles',      genre: 'pop' },
    { name: 'Olivia Rodrigo',    genre: 'pop' },
    { name: 'Dua Lipa',          genre: 'pop' },
    { name: 'Taylor Swift',      genre: 'pop' },
    { name: 'Shawn Mendes',      genre: 'pop' },
    { name: 'Selena Gomez',      genre: 'pop' },
    { name: 'Camila Cabello',    genre: 'pop' },
    { name: 'Charlie Puth',      genre: 'pop' },
    { name: 'Sam Smith',         genre: 'pop' },
    { name: 'Lizzo',             genre: 'pop' },
    { name: 'Adele',             genre: 'pop' },
    { name: 'Bruno Mars',        genre: 'pop' },
    { name: 'Coldplay',          genre: 'pop' },
    // Afrobeats
    { name: 'Burna Boy',         genre: 'afrobeats' },
    { name: 'Wizkid',            genre: 'afrobeats' },
    { name: 'Davido',            genre: 'afrobeats' },
    { name: 'Rema',              genre: 'afrobeats' },
    { name: 'Tems',              genre: 'afrobeats' },
    { name: 'Fireboy DML',       genre: 'afrobeats' },
    { name: 'Asake',             genre: 'afrobeats' },
    { name: 'Omah Lay',          genre: 'afrobeats' },
    { name: 'Kizz Daniel',       genre: 'afrobeats' },
    { name: 'Joeboy',            genre: 'afrobeats' },
    { name: 'CKay',              genre: 'afrobeats' },
    { name: 'Ayra Starr',        genre: 'afrobeats' },
    { name: 'Gyakie',            genre: 'afrobeats' },
    { name: 'Olamide',           genre: 'afrobeats' },
    { name: 'Ruger',             genre: 'afrobeats' },
    // Dancehall
    { name: 'Popcaan',           genre: 'dancehall' },
    { name: 'Vybz Kartel',       genre: 'dancehall' },
    { name: 'Alkaline',          genre: 'dancehall' },
    { name: 'Mavado',            genre: 'dancehall' },
    { name: 'Sean Paul',         genre: 'dancehall' },
    { name: 'Shaggy',            genre: 'dancehall' },
    { name: 'Chronixx',          genre: 'dancehall' },
    { name: 'Busy Signal',       genre: 'dancehall' },
    { name: 'Beenie Man',        genre: 'dancehall' },
    { name: 'Skillibeng',        genre: 'dancehall' },
    // Desi / South Asian
    { name: 'AP Dhillon',        genre: 'desi' },
    { name: 'Karan Aujla',       genre: 'desi' },
    { name: 'Diljit Dosanjh',    genre: 'desi' },
    { name: 'Badshah',           genre: 'desi' },
    { name: 'Imran Khan',        genre: 'desi' },
    { name: 'Guru Randhawa',     genre: 'desi' },
    { name: 'Raftaar',           genre: 'desi' },
    { name: 'Hardy Sandhu',      genre: 'desi' },
    { name: 'Prem Dhillon',      genre: 'desi' },
    { name: 'Shubh',             genre: 'desi' },
    { name: 'Yo Yo Honey Singh', genre: 'desi' },
    { name: 'B Praak',           genre: 'desi' },
    { name: 'Ammy Virk',         genre: 'desi' },
    { name: 'Gippy Grewal',      genre: 'desi' },
    { name: 'Sidhu Moosewala',   genre: 'desi' },
    // Latin
    { name: 'Bad Bunny',         genre: 'latin' },
    { name: 'J Balvin',          genre: 'latin' },
    { name: 'Ozuna',             genre: 'latin' },
    { name: 'Maluma',            genre: 'latin' },
    { name: 'Anuel AA',          genre: 'latin' },
    { name: 'Daddy Yankee',      genre: 'latin' },
    { name: 'Rauw Alejandro',    genre: 'latin' },
    { name: 'Myke Towers',       genre: 'latin' },
    { name: 'Farruko',           genre: 'latin' },
    { name: 'Nicky Jam',         genre: 'latin' },
    // Country
    { name: 'Shaboozey',         genre: 'country' },
    { name: 'Morgan Wallen',     genre: 'country' },
    { name: 'Luke Combs',        genre: 'country' },
    { name: 'Kane Brown',        genre: 'country' },
    { name: 'Zac Brown Band',    genre: 'country' },
];
