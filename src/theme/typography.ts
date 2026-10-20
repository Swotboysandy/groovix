// Inter font weight map for use throughout the app
export const font = {
    black:     { fontFamily: 'Inter-Black' },       // 900 — splash, hero numbers
    extraBold: { fontFamily: 'Inter-ExtraBold' },   // 800 — large display headings
    bold:      { fontFamily: 'Inter-Bold' },         // 700 — section titles, track names
    semiBold:  { fontFamily: 'Inter-SemiBold' },     // 600 — artist names, tab labels
    medium:    { fontFamily: 'Inter-Medium' },        // 500 — body, button labels
    regular:   { fontFamily: 'Inter-Regular' },      // 400 — descriptions, meta
} as const;

// Pre-composed text styles
export const text = {
    // Headings
    hero:        { ...font.black,     fontSize: 28, color: '#fff' },
    title:       { ...font.bold,      fontSize: 20, color: '#fff' },
    sectionHead: { ...font.bold,      fontSize: 16, color: '#fff' },

    // Body
    trackName:   { ...font.semiBold,  fontSize: 14, color: '#fff' },
    artistName:  { ...font.medium,    fontSize: 13, color: 'rgba(255,255,255,0.6)' },
    label:       { ...font.semiBold,  fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.6, textTransform: 'uppercase' as const },

    // Sub / meta
    sub:         { ...font.regular,   fontSize: 12, color: 'rgba(255,255,255,0.4)' },
    caption:     { ...font.regular,   fontSize: 11, color: 'rgba(255,255,255,0.3)' },
} as const;
