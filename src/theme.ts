import { StyleSheet } from 'react-native';

export const COLORS = {
    background: '#000000',
    surface: '#121212',
    surfaceLight: '#1C1C1E',
    surfaceHover: '#1e293b99',
    surfaceActive: 'rgba(250, 45, 72, 0.12)',
    divider: '#2C2C2E',

    text: '#FFFFFF',
    textMuted: '#9A9A9A',
    textSecondary: '#777777',
    textTags: '#64748bcc',

    primary: '#fa2d48',
    primaryHover: '#ff5068',
    border: 'rgba(255,255,255,0.08)',
    borderActive: 'rgba(250, 45, 72, 0.25)',
    borderActiveLeft: 'rgba(250, 45, 72, 0.8)',

    playerGradientStart: '#3B1F28',
    playerGradientEnd: '#0B0B0B',
};

export type ThemeMode = 'midnight' | 'soundwave';
export type ThemeColors = typeof COLORS;

export const PALETTES: Record<ThemeMode, ThemeColors> = {
    midnight: COLORS,
    soundwave: {
        ...COLORS,
        background: '#F4F6FA',
        surface: '#FFFFFF',
        surfaceLight: '#FFFFFF',
        surfaceHover: '#E9EDF3',
        surfaceActive: 'rgba(23,28,38,0.08)',
        divider: '#E5E8EE',
        text: '#171C26',
        textMuted: '#6C7689',
        textSecondary: '#A4AAB7',
        textTags: '#6C7689',
        primary: '#171C26',
        primaryHover: '#303A4B',
        border: '#E5E8EE',
        borderActive: 'rgba(23,28,38,0.18)',
        borderActiveLeft: '#171C26',
        playerGradientStart: '#171C26',
        playerGradientEnd: '#171C26',
    },
};

export const SPACING = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 48
};

export const RADIUS = {
    sm: 8,
    md: 8,
    lg: 14,
    xl: 20,
    full: 9999
};

export const globalStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
});
