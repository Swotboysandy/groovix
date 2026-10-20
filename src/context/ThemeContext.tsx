import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { getPrefs, savePrefs } from '../store/preferences';
import { PALETTES, ThemeColors, ThemeMode } from '../theme';

/** What the user picked: follow the system, or always light / dark. */
export type ThemeSetting = 'system' | 'light' | 'dark';

type ThemeContextValue = {
    theme: ThemeMode;
    colors: ThemeColors;
    themeSetting: ThemeSetting;
    setTheme: (theme: ThemeMode) => Promise<void>;
    setThemeSetting: (setting: ThemeSetting) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue>({
    theme: 'midnight',
    colors: PALETTES.soundwave,
    themeSetting: 'dark',
    setTheme: async () => undefined,
    setThemeSetting: async () => undefined,
});

const modeFor = (setting: ThemeSetting, system: string | null | undefined): ThemeMode =>
    setting === 'light' || (setting === 'system' && system === 'light') ? 'soundwave' : 'midnight';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const system = useColorScheme();
    const [themeSetting, setThemeSettingState] = useState<ThemeSetting>('dark');

    useEffect(() => {
        getPrefs().then(prefs => {
            if (prefs?.themeSetting) setThemeSettingState(prefs.themeSetting);
            else if (prefs?.theme && prefs.theme in PALETTES) setThemeSettingState(prefs.theme === 'soundwave' ? 'light' : 'dark');
        });
    }, []);

    const theme = modeFor(themeSetting, system);

    const setThemeSetting = async (next: ThemeSetting) => {
        setThemeSettingState(next);
        await savePrefs({ ...(await getPrefs() ?? { genres: [], artists: [] }), themeSetting: next, theme: modeFor(next, system) });
    };

    const setTheme = (next: ThemeMode) => setThemeSetting(next === 'soundwave' ? 'light' : 'dark');

    const value = useMemo(() => ({ theme, colors: PALETTES[theme], themeSetting, setTheme, setThemeSetting }), [theme, themeSetting]); // eslint-disable-line react-hooks/exhaustive-deps
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
