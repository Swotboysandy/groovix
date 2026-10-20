import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'groovix_user_profile_v1';

export interface UserProfile {
    displayName: string;
    avatarUri?: string;
}

const DEFAULT_PROFILE: UserProfile = { displayName: 'My Library' };

export async function getUserProfile(): Promise<UserProfile> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return DEFAULT_PROFILE;
        const parsed = JSON.parse(raw);
        return {
            displayName: typeof parsed?.displayName === 'string' && parsed.displayName.trim() ? parsed.displayName.trim() : DEFAULT_PROFILE.displayName,
            avatarUri: typeof parsed?.avatarUri === 'string' ? parsed.avatarUri : undefined,
        };
    } catch {
        return DEFAULT_PROFILE;
    }
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
    const clean: UserProfile = {
        displayName: profile.displayName.trim().replace(/\s+/g, ' ') || DEFAULT_PROFILE.displayName,
        avatarUri: profile.avatarUri,
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(clean));
    return clean;
}
