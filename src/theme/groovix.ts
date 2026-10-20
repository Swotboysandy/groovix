// Groovix design tokens: colours, type and shared sizes.
import type { TextStyle } from 'react-native';

export const GX_DARK = {
    primary: '#FFFFFF',
    onPrimary: '#000000',
    background: '#000000',
    onBackground: '#FFFFFF',
    surface: '#0D0D0F',
    onSurface: '#FFFFFF',
    surfaceVariant: '#1C1C1E',
    onSurfaceVariant: '#8E8E93',
    outline: '#2C2C2E',
    thumbnailBorder: 'rgba(255,255,255,0.15)',
};

export const GX_LIGHT: typeof GX_DARK = {
    primary: '#000000',
    onPrimary: '#FFFFFF',
    background: '#FFFFFF',
    onBackground: '#000000',
    surface: '#F7F7F9',
    onSurface: '#000000',
    surfaceVariant: '#F2F2F7',
    onSurfaceVariant: '#6E6E73',
    outline: '#E5E5EA',
    thumbnailBorder: 'rgba(0,0,0,0.15)',
};

export type GXColors = typeof GX_DARK;

export const ACCENT_RED = '#FA2D48';
export const PLAYING_ACCENT = '#FB4A62';

// SF Pro Display, bundled in android/app/src/main/assets/fonts.
const SF = {
    w400: 'SFProDisplay-Regular',
    w500: 'SFProDisplay-Medium',
    w600: 'SFProDisplay-Semibold',
    w700: 'SFProDisplay-Bold',
    w800: 'SFProDisplay-Heavy',
};

export const GX_TYPE = {
    displayLarge: { fontFamily: SF.w800, fontSize: 34, letterSpacing: -0.8 },
    headlineLarge: { fontFamily: SF.w800, fontSize: 30, letterSpacing: -0.7 },
    headlineMedium: { fontFamily: SF.w700, fontSize: 22, letterSpacing: -0.4 },
    titleLarge: { fontFamily: SF.w700, fontSize: 20, letterSpacing: -0.3 },
    titleMedium: { fontFamily: SF.w600, fontSize: 16, letterSpacing: -0.2 },
    titleSmall: { fontFamily: SF.w500, fontSize: 14, letterSpacing: 0.1 },
    bodyLarge: { fontFamily: SF.w400, fontSize: 16 },
    bodyMedium: { fontFamily: SF.w400, fontSize: 14 },
    labelMedium: { fontFamily: SF.w600, fontSize: 12 },
    labelSmall: { fontFamily: SF.w600, fontSize: 11 },
} satisfies Record<string, TextStyle>;

export const PAGE_GUTTER = 16;
export const SHELF_CARD_WIDTH = 150;
export const HERO_CARD_RATIO = 0.92;
export const heroCardWidth = (available: number) => Math.min(available * 0.70, 320);
export const trackColumnWidth = (available: number) => Math.min(available * 0.88, 400);
