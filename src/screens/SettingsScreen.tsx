// SettingsSheet: a large heading, a search field that
// filters rows, and inset grouped cards of rows with uppercase headers.
import { haptic } from '../services/haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DraggableBottomSheet from '../components/DraggableBottomSheet';
import { usePlayer } from '../context/PlayerContext';
import { useResetApp } from '../context/AppContext';
import { useAppDialog } from '../context/DialogContext';
import { useTheme } from '../context/ThemeContext';
import { useJam } from '../context/JamContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { BackBar } from '../components/GlassHeader';
import { APP_VERSION } from '../services/updater';
import NetInfo from '@react-native-community/netinfo';
import { updateAppSettings, useAppSettings, type AppSettings, type StreamSource } from '../store/appSettings';
import { validateListenBrainzToken } from '../services/listenbrainz';
import { BACKUP_PATH, exportData, importData } from '../services/backup';
import { TRANSLATION_LANGUAGES } from '../services/lyricsTranslation';
import { currentYouTubeUser, signInWithGoogle, signOutOfGoogle, type YouTubeUser } from '../services/youtubeAccount';
import { LYRICS_SOURCES, type LyricsSourceId } from '../services/lyrics';
import { clearPrefs, getPrefs, savePrefs, GENRE_LIST, type PlaybackQuality, type UserPrefs } from '../store/preferences';
import { getUserProfile, type UserProfile } from '../store/userProfile';
import { getLyricsSettings, saveLyricsSettings, type LyricsSettings } from '../store/lyricsSettings';
import { GX_DARK, GX_LIGHT, GX_TYPE, type GXColors } from '../theme/groovix';

const GROUP_INSET = 16;
const ROW_INSET = 16;
const ICON_SIZE = 22;
const ICON_GAP = 14;
const TEXT_INSET = ROW_INSET + ICON_SIZE + ICON_GAP;

const QUALITY_OPTIONS: { value: PlaybackQuality; label: string; detail: string }[] = [
    { value: 'HI_RES_LOSSLESS', label: 'Hi-Res Lossless', detail: 'Up to 24-bit/192 kHz FLAC' },
    { value: 'LOSSLESS', label: 'Lossless', detail: '16-bit/44.1 kHz FLAC' },
    { value: 'HIGH', label: 'High', detail: 'AAC 320 kbps' },
    { value: 'LOW', label: 'Data saver', detail: 'AAC 96 kbps' },
];
const qualityLabel = (value?: PlaybackQuality) => QUALITY_OPTIONS.find(option => option.value === value)?.label ?? 'Lossless';

type RowSpec = { key: string; terms: string; node: React.ReactNode };

export function Chevron({ c }: { c: GXColors }) {
    return <Ionicons name="chevron-forward" size={20} color={c.onSurfaceVariant} style={styles.chevron} />;
}

export function SettingsRow({ icon, title, subtitle, value, badge, onPress, trailing, leading, c }: {
    icon?: string; title: string; subtitle?: string; value?: string; badge?: string;
    onPress?: () => void; trailing?: React.ReactNode; leading?: React.ReactNode; c: GXColors;
}) {
    return (
        <TouchableOpacity disabled={!onPress} onPress={onPress} activeOpacity={0.6} style={styles.row} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title}>
            {leading ?? (icon ? <Ionicons name={icon} size={ICON_SIZE} color={c.onBackground} /> : null)}
            <View style={[styles.rowCopy, !icon && !leading && { marginLeft: 0 }]}>
                <View style={styles.rowTitleLine}>
                    <Text style={[GX_TYPE.bodyLarge, { color: c.onBackground }]} numberOfLines={1}>{title}</Text>
                    {badge ? <Text style={[GX_TYPE.labelSmall, styles.badge]}>{badge.toUpperCase()}</Text> : null}
                </View>
                {subtitle ? <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]}>{subtitle}</Text> : null}
            </View>
            {trailing ?? (
                <>
                    {value ? <Text style={[GX_TYPE.bodyLarge, styles.value, { color: c.onSurfaceVariant }]} numberOfLines={1}>{value}</Text> : null}
                    {onPress ? <Chevron c={c} /> : null}
                </>
            )}
        </TouchableOpacity>
    );
}

export function SwitchRow({ icon, title, subtitle, value, onChange, c }: { icon?: string; title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; c: GXColors }) {
    return (
        <SettingsRow
            icon={icon}
            title={title}
            subtitle={subtitle}
            onPress={() => { haptic(value ? 'toggleOff' : 'toggleOn'); onChange(!value); }}
            c={c}
            trailing={<Switch value={value} onValueChange={v => { haptic(v ? 'toggleOn' : 'toggleOff'); onChange(v); }} trackColor={{ true: '#FFFFFF', false: 'rgba(255,255,255,0.10)' }} thumbColor={value ? '#000000' : 'rgba(255,255,255,0.18)'} style={{ transform: [{ scaleX: 1.35 }, { scaleY: 1.35 }], marginRight: 6 }} />}
        />
    );
}

export function SegmentedControl({ options, selected, onSelect, c }: { options: string[]; selected: number; onSelect: (i: number) => void; c: GXColors }) {
    return (
        <View style={[styles.segmented, { backgroundColor: c.outline }]}>
            {options.map((label, index) => {
                const chosen = index === selected;
                return (
                    <TouchableOpacity key={label} onPress={() => { if (!chosen) { haptic('select'); onSelect(index); } }} style={[styles.segment, chosen && { backgroundColor: c.primary }]} accessibilityRole="button" accessibilityState={{ selected: chosen }}>
                        <Text style={[GX_TYPE.labelMedium, { color: chosen ? c.onPrimary : c.onSurfaceVariant }]} numberOfLines={1}>{label}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

export default function SettingsScreen({ navigation }: any) {
    const { colors, theme, themeSetting, setThemeSetting } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const { room } = useJam();
    const resetApp = useResetApp();
    const { showDialog } = useAppDialog();
    const [search, setSearch] = useState('');
    const [prefs, setPrefs] = useState<UserPrefs | null>(null);
    const [profile, setProfile] = useState<UserProfile>({ displayName: 'My Library' });
    const [lyrics, setLyrics] = useState<LyricsSettings | null>(null);
    const [ytUser, setYtUser] = useState<YouTubeUser | null>(null);
    const [ytBusy, setYtBusy] = useState(false);
    const [sheet, setSheet] = useState<null | 'wifi' | 'mobile' | 'download' | 'genres' | 'lyrics' | 'sources' | 'translation' | 'listenbrainz'>(null);
    const app = useAppSettings();
    const setApp = (patch: Partial<AppSettings>) => { void updateAppSettings(patch); };
    const [onWifi, setOnWifi] = useState(true);
    useEffect(() => NetInfo.addEventListener(state => setOnWifi(state.type !== 'cellular')), []);
    const [lbToken, setLbToken] = useState('');
    const [lbUser, setLbUser] = useState<string | null>(null);
    const [lbBusy, setLbBusy] = useState(false);
    useEffect(() => {
        if (!app.listenBrainzToken) { setLbUser(null); return; }
        validateListenBrainzToken(app.listenBrainzToken).then(setLbUser);
    }, [app.listenBrainzToken]);

    useFocusEffect(useCallback(() => {
        getPrefs().then(setPrefs);
        getUserProfile().then(setProfile);
        getLyricsSettings().then(setLyrics);
        currentYouTubeUser().then(setYtUser).catch(() => setYtUser(null));
    }, []));

    const updatePrefs = async (patch: Partial<UserPrefs>) => {
        const updated: UserPrefs = { genres: prefs?.genres ?? [], artists: prefs?.artists ?? [], ...prefs, ...patch };
        setPrefs(updated);
        await savePrefs(updated);
    };

    const updateLyrics = async (patch: Partial<LyricsSettings>) => {
        if (!lyrics) return;
        const updated = { ...lyrics, ...patch };
        setLyrics(updated);
        await saveLyricsSettings(updated);
    };

    const toggleSource = (id: LyricsSourceId) => {
        if (!lyrics) return;
        const enabled = lyrics.enabled.includes(id) ? lyrics.enabled.filter(item => item !== id) : [...lyrics.enabled, id];
        void updateLyrics({ enabled });
    };

    const moveSource = (id: LyricsSourceId, delta: number) => {
        if (!lyrics) return;
        const order = lyrics.order.slice();
        const from = order.indexOf(id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        void updateLyrics({ order });
    };

    const signIn = async () => {
        setYtBusy(true);
        try {
            const user = await signInWithGoogle();
            if (user) setYtUser(user);
        } catch (error: any) {
            showDialog({ title: "Couldn't sign in", message: error?.message || 'Google sign-in failed.', icon: 'alert-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
        } finally {
            setYtBusy(false);
        }
    };

    const confirmSignOut = () => showDialog({
        title: 'Sign out of Google?',
        message: 'Your YouTube playlists and likes will be removed from Groovix and its access to your account revoked.',
        icon: 'log-out-outline',
        actions: [
            { text: 'Cancel', tone: 'neutral' },
            { text: 'Sign out', tone: 'destructive', onPress: async () => { setYtBusy(true); await signOutOfGoogle(); setYtUser(null); setYtBusy(false); } },
        ],
    });

    const moveStreamSource = (source: StreamSource, delta: number) => {
        const order = app.sourceOrder.slice();
        const from = order.indexOf(source);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        setApp({ sourceOrder: order });
    };
    const toggleStreamSource = (source: StreamSource) => {
        const on = app.sourceOrder.includes(source);
        if (on && app.sourceOrder.length === 1) return; // keep at least one
        setApp({ sourceOrder: on ? app.sourceOrder.filter(item => item !== source) : [...app.sourceOrder, source] });
    };

    const saveListenBrainz = async () => {
        setLbBusy(true);
        const user = await validateListenBrainzToken(lbToken.trim());
        setLbBusy(false);
        if (!user) {
            showDialog({ title: "That token didn't work", message: 'Copy your user token from listenbrainz.org/settings and try again.', icon: 'alert-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
            return;
        }
        setApp({ listenBrainzToken: lbToken.trim() });
        setLbToken('');
        setSheet(null);
    };

    const runExport = async () => {
        try {
            const path = await exportData();
            showDialog({ title: 'Exported', message: `Saved to ${path}`, icon: 'checkmark-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
        } catch (error: any) {
            showDialog({ title: "Couldn't export", message: error?.message || 'Export failed.', icon: 'alert-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
        }
    };

    const confirmImport = () => showDialog({
        title: 'Import data?',
        message: `Replaces the settings and history on this device with ${BACKUP_PATH}.`,
        icon: 'download-outline',
        actions: [
            { text: 'Cancel', tone: 'neutral' },
            {
                text: 'Import', tone: 'destructive', onPress: async () => {
                    try {
                        const count = await importData();
                        showDialog({ title: 'Imported', message: `${count} items restored. Close and reopen Groovix to load them.`, icon: 'checkmark-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
                    } catch (error: any) {
                        showDialog({ title: "Couldn't import", message: error?.message || 'Import failed.', icon: 'alert-circle-outline', actions: [{ text: 'OK', tone: 'neutral' }] });
                    }
                },
            },
        ],
    });

    const confirmReset = () => showDialog({
        title: 'Reset profile?',
        message: 'This clears your genre, artist and language preferences and restarts setup.',
        icon: 'refresh-outline',
        actions: [
            { text: 'Cancel', tone: 'neutral' },
            { text: 'Reset', tone: 'destructive', onPress: async () => { await clearPrefs(); resetApp(); } },
        ],
    });

    const languages = ['english', 'hindi', 'both'] as const;
    const languageIndex = Math.max(0, languages.indexOf(prefs?.language ?? 'both'));

    // Each group: header + rows; the search keeps only rows whose terms match.
    const groups: { header?: string; footer?: string; rows: RowSpec[] }[] = [
        {
            rows: [
                { key: 'account', terms: 'account integrations profile name photo sign in', node: <SettingsRow icon="person" title="Account & integrations" subtitle={profile.displayName && profile.displayName !== 'My Library' ? profile.displayName : 'Not signed in'} onPress={() => navigation.navigate('Profile', { openEditProfile: true })} c={c} /> },
                { key: 'youtube', terms: 'google youtube sign in account playlists login', node: <SettingsRow
                    leading={<Ionicons name="logo-youtube" size={ICON_SIZE} color={c.onBackground} />}
                    title={ytUser ? 'YouTube' : 'Sign in with Google'}
                    subtitle={ytBusy ? 'Working…' : ytUser ? `${ytUser.email} · Tap to sign out` : 'Bring your YouTube playlists, likes and subscriptions'}
                    onPress={ytBusy ? undefined : ytUser ? confirmSignOut : signIn}
                    c={c}
                /> },
                { key: 'listenbrainz', terms: 'listenbrainz scrobble scrobbling history account', node: <SettingsRow icon="radio-outline" title="ListenBrainz" subtitle={app.listenBrainzToken ? (lbUser ? `Scrobbling as ${lbUser}` : 'Connected') : 'Scrobble what you play'} onPress={() => setSheet('listenbrainz')} c={c} /> },
                { key: 'jam', terms: 'jam listen together party friends sync', node: <SettingsRow icon="people" title="Listen together" subtitle={room ? `In a Jam · ${room.slug}` : 'Share a code and play the same music, in time'} onPress={() => navigation.navigate('Jam')} c={c} /> },
            ],
        },
        {
            header: 'Audio quality',
            rows: [
                { key: 'sources', terms: 'sources audio tidal jiosaavn audius order', node: <SettingsRow icon="git-network-outline" title="Sources" subtitle="Where audio comes from and the order used" onPress={() => setSheet('sources')} c={c} /> },
                { key: 'wifi', terms: 'streaming quality audio lossless hi-res flac wifi', node: <SettingsRow icon="wifi" title="On Wi-Fi" badge={onWifi ? 'In use' : undefined} value={qualityLabel(app.qualityWifi)} onPress={() => setSheet('wifi')} c={c} /> },
                { key: 'mobile', terms: 'streaming quality audio lossless mobile data cellular', node: <SettingsRow icon="cellular" title="On mobile data" badge={onWifi ? undefined : 'In use'} value={qualityLabel(app.qualityMobile)} onPress={() => setSheet('mobile')} c={c} /> },
            ],
        },
        {
            header: 'Downloads',
            rows: [
                { key: 'download-quality', terms: 'download quality offline', node: <SettingsRow icon="download" title="Download quality" subtitle="~35 MB per track, whatever the connection" value={qualityLabel(prefs?.downloadQuality ?? 'LOSSLESS')} onPress={() => setSheet('download')} c={c} /> },
                { key: 'wifi-only', terms: 'download wifi only mobile data', node: <SwitchRow title="Download over Wi-Fi only" value={prefs?.downloadWifiOnly ?? true} onChange={v => updatePrefs({ downloadWifiOnly: v })} c={c} /> },
            ],
        },
        {
            header: 'Playback',
            rows: [
                { key: 'equalizer', terms: 'equalizer equaliser eq bass treble tone balance sound', node: <SettingsRow icon="options" title="Equalizer" subtitle="Tone, seven bands and balance" onPress={() => navigation.navigate('Equalizer')} c={c} /> },
            ],
        },
        {
            header: 'Appearance',
            rows: [
                { key: 'theme', terms: 'theme appearance dark light colour color', node: (
                    <View style={styles.segmentRow}>
                        <View style={styles.segmentTitle}>
                            <Ionicons name="contrast" size={ICON_SIZE} color={c.onBackground} />
                            <Text style={[GX_TYPE.bodyLarge, styles.segmentLabel, { color: c.onBackground }]}>Theme</Text>
                        </View>
                        <SegmentedControl options={['System', 'Light', 'Dark']} selected={themeSetting === 'system' ? 0 : themeSetting === 'light' ? 1 : 2} onSelect={i => { void setThemeSetting(i === 0 ? 'system' : i === 1 ? 'light' : 'dark'); }} c={c} />
                    </View>
                ) },
                { key: 'reduce-animation', terms: 'reduce animation motion', node: <SwitchRow icon="pause-circle-outline" title="Reduce animation" subtitle="Keeps the cover still when paused and opens lyrics and the queue without sliding" value={app.reduceAnimation} onChange={v => setApp({ reduceAnimation: v })} c={c} /> },
                { key: 'reduce-blur', terms: 'reduce dynamic blur glass frosted', node: <SwitchRow icon="water-outline" title="Reduce dynamic blur" subtitle="Swaps the blurred artwork behind the player and menus for solid fills" value={app.reduceBlur} onChange={v => setApp({ reduceBlur: v })} c={c} /> },
                { key: 'full-cover', terms: 'full screen cover art artwork edges sleeve', node: <SwitchRow icon="expand-outline" title="Full-screen cover art" subtitle="Runs the cover to the edges of the player instead of a square sleeve" value={app.fullScreenCoverArt} onChange={v => setApp({ fullScreenCoverArt: v })} c={c} /> },
            ],
        },
        {
            header: 'Lyrics',
            rows: [
                { key: 'synced-lyrics', terms: 'synced lyrics highlight sung words', node: <SwitchRow icon="musical-note-outline" title="Synced lyrics" subtitle="Lights up the words on the player as they're sung" value={app.syncedLyrics} onChange={v => setApp({ syncedLyrics: v })} c={c} /> },
                { key: 'blur-lyrics', terms: 'blur unfocused lyrics spotlight current line', node: <SwitchRow icon="eye-outline" title="Blur unfocused lyrics" subtitle="Keeps the spotlight on the current line" value={app.blurUnfocusedLyrics} onChange={v => setApp({ blurUnfocusedLyrics: v })} c={c} /> },
                { key: 'lyrics-sources', terms: 'lyrics sources providers lrclib musixmatch apple', node: <SettingsRow icon="globe-outline" title="Lyrics sources" subtitle={lyrics ? lyrics.order.filter(id => lyrics.enabled.includes(id)).map(id => LYRICS_SOURCES.find(source => source.id === id)?.label).filter(Boolean).join(', ') : undefined} onPress={() => setSheet('lyrics')} c={c} /> },
                { key: 'syllable', terms: 'lyrics word synced syllable karaoke', node: <SwitchRow icon="text" title="Prefer word-synced lyrics" subtitle="Keep looking past line-synced lyrics for word-by-word timing" value={lyrics?.prioritizeSyllableSync ?? false} onChange={v => updateLyrics({ prioritizeSyllableSync: v })} c={c} /> },
                { key: 'translation', terms: 'translate translation language lyrics', node: <SettingsRow icon="language-outline" title="Translation language" subtitle={app.translationLanguage ? TRANSLATION_LANGUAGES.find(([code]) => code === app.translationLanguage)?.[1] ?? app.translationLanguage : 'Off'} onPress={() => setSheet('translation')} c={c} /> },
            ],
        },
        {
            header: 'Your data',
            rows: [
                { key: 'replay', terms: 'replay stats top songs artists', node: <SettingsRow icon="stats-chart-outline" title="Replay" subtitle="Your top songs, artists and albums" onPress={() => navigation.navigate('Replay')} c={c} /> },
                { key: 'export', terms: 'export backup data json', node: <SettingsRow icon="share-outline" title="Export data" subtitle="Settings and listening history, as one JSON file" onPress={runExport} c={c} /> },
                { key: 'import', terms: 'import restore backup data json', node: <SettingsRow icon="download-outline" title="Import data" subtitle="Replaces the settings and history on this device" onPress={confirmImport} c={c} /> },
            ],
        },
        {
            header: 'Miscellaneous',
            rows: [
                { key: 'no-repeat', terms: 'repeat autoplay session songs', node: <SwitchRow title="Don't repeat songs in current session" subtitle="AutoPlay won't suggest a song already played or suggested this session" value={app.noRepeatInSession} onChange={v => setApp({ noRepeatInSession: v })} c={c} /> },
                { key: 'hide-volume', terms: 'hide volume bar slider player', node: <SwitchRow title="Hide volume bar" subtitle="Removes the volume slider from the main player" value={app.hideVolumeBar} onChange={v => setApp({ hideVolumeBar: v })} c={c} /> },
                { key: 'hide-status', terms: 'hide status bar clock battery player', node: <SwitchRow title="Hide status bar in player" subtitle="Hides the clock, battery and notification icons while the main player is open" value={app.hideStatusBarInPlayer} onChange={v => setApp({ hideStatusBarInPlayer: v })} c={c} /> },
                { key: 'queue-history', terms: 'queue history previously played', node: <SwitchRow title="Show queue history" subtitle="Show up to 25 previously played songs above Now playing in the queue" value={app.showQueueHistory} onChange={v => setApp({ showQueueHistory: v })} c={c} /> },
            ],
        },
        {
            header: 'Advanced options',
            rows: [
                { key: 'nerd-stats', terms: 'stats for nerds codec bitrate sample rate', node: <SwitchRow title="Show stats for nerds" subtitle="Codec, bitrate and sample rate on the player" value={app.statsForNerds} onChange={v => setApp({ statsForNerds: v })} c={c} /> },
            ],
        },
        {
            header: 'Recommendations',
            rows: [
                { key: 'language', terms: 'language hindi english recommendations', node: (
                    <View style={styles.segmentRow}>
                        <View style={styles.segmentTitle}>
                            <Ionicons name="language" size={ICON_SIZE} color={c.onBackground} />
                            <Text style={[GX_TYPE.bodyLarge, styles.segmentLabel, { color: c.onBackground }]}>Music language</Text>
                        </View>
                        <SegmentedControl options={['English', 'Hindi', 'Both']} selected={languageIndex} onSelect={i => updatePrefs({ language: languages[i] })} c={c} />
                    </View>
                ) },
                { key: 'genres', terms: 'genres taste recommendations', node: <SettingsRow icon="musical-notes" title="Your genres" value={`${prefs?.genres?.length ?? 0} selected`} onPress={() => setSheet('genres')} c={c} /> },
            ],
        },
        {
            header: 'About',
            rows: [
                { key: 'version', terms: 'about version update', node: <SettingsRow icon="information-circle" title="Version" value={`v${APP_VERSION}`} c={c} /> },
            ],
        },
    ];

    const q = search.trim().toLocaleLowerCase();
    const visible = groups
        .map(group => ({ ...group, rows: q ? group.rows.filter(row => `${row.terms} ${group.header ?? ''}`.toLocaleLowerCase().includes(q)) : group.rows }))
        .filter(group => group.rows.length > 0);

    const sources = useMemo(() => lyrics ? lyrics.order.map(id => LYRICS_SOURCES.find(source => source.id === id)!).filter(Boolean) : [], [lyrics]);

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <BackBar />
                <Text style={[GX_TYPE.displayLarge, styles.title, { color: c.onBackground }]}>Settings</Text>
                <View style={[styles.searchField, { backgroundColor: c.surfaceVariant }]}>
                    <Ionicons name="search" size={20} color={c.onSurfaceVariant} />
                    <TextInput value={search} onChangeText={setSearch} placeholder="Search settings" placeholderTextColor={c.onSurfaceVariant} style={[GX_TYPE.bodyLarge, styles.searchInput, { color: c.onBackground }]} />
                    {search ? <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search"><Ionicons name="close" size={18} color={c.onSurfaceVariant} /></TouchableOpacity> : null}
                </View>

                {visible.map((group, groupIndex) => (
                    <View key={group.header ?? `group-${groupIndex}`}>
                        {group.header ? <Text style={[GX_TYPE.labelSmall, styles.groupHeader, { color: c.onSurfaceVariant }]}>{group.header.toUpperCase()}</Text> : <View style={styles.groupSpacer} />}
                        <View style={[styles.group, { backgroundColor: c.surfaceVariant }]}>
                            {group.rows.map((row, index) => (
                                <View key={row.key}>
                                    {row.node}
                                    {index < group.rows.length - 1 && <View style={[styles.divider, { backgroundColor: c.outline }]} />}
                                </View>
                            ))}
                        </View>
                        {group.footer && !q ? <Text style={[GX_TYPE.bodyMedium, styles.groupFooter, { color: c.onSurfaceVariant }]}>{group.footer}</Text> : null}
                    </View>
                ))}

                {!q && (
                    <>
                        <View style={styles.groupSpacer} />
                        <View style={[styles.group, { backgroundColor: c.surfaceVariant }]}>
                            <TouchableOpacity style={styles.destructive} onPress={confirmReset} accessibilityRole="button">
                                <Text style={[GX_TYPE.bodyLarge, { color: '#FF453A' }]}>Reset profile & preferences</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
                {q && visible.length === 0 && <Text style={[GX_TYPE.bodyMedium, styles.noMatch, { color: c.onSurfaceVariant }]}>No settings match “{search}”</Text>}
            </ScrollView>

            <DraggableBottomSheet visible={sheet === 'wifi' || sheet === 'mobile' || sheet === 'download'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.surface }]} backdropLabel="Close quality picker">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>{sheet === 'download' ? 'Download quality' : sheet === 'mobile' ? 'On mobile data' : 'On Wi-Fi'}</Text>
                <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                    {QUALITY_OPTIONS.map((option, index) => {
                        const current = sheet === 'download' ? (prefs?.downloadQuality ?? 'LOSSLESS') : sheet === 'mobile' ? app.qualityMobile : app.qualityWifi;
                        return (
                            <View key={option.value}>
                                <SettingsRow
                                    title={option.label}
                                    subtitle={option.detail}
                                    onPress={async () => {
                                        if (sheet === 'download') await updatePrefs({ downloadQuality: option.value });
                                        else setApp(sheet === 'mobile' ? { qualityMobile: option.value } : { qualityWifi: option.value });
                                        setSheet(null);
                                    }}
                                    trailing={current === option.value ? <Ionicons name="checkmark" size={22} color={c.primary} /> : <View />}
                                    c={c}
                                />
                                {index < QUALITY_OPTIONS.length - 1 && <View style={[styles.divider, { backgroundColor: c.outline }]} />}
                            </View>
                        );
                    })}
                </View>
            </DraggableBottomSheet>

            <DraggableBottomSheet visible={sheet === 'genres'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.surface }]} backdropLabel="Close genres">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Your genres</Text>
                <View style={styles.chips}>
                    {GENRE_LIST.map(genre => {
                        const selected = prefs?.genres?.includes(genre.id) ?? false;
                        return (
                            <TouchableOpacity
                                key={genre.id}
                                style={[styles.chip, { backgroundColor: selected ? c.onBackground : c.surfaceVariant }]}
                                onPress={() => updatePrefs({ genres: selected ? (prefs?.genres ?? []).filter(id => id !== genre.id) : [...(prefs?.genres ?? []), genre.id] })}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                            >
                                <Text style={[GX_TYPE.titleSmall, { color: selected ? c.background : c.onBackground }]}>{genre.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </DraggableBottomSheet>

            {/* LyricsSourcesDialog: on/off per source, in priority order */}
            <DraggableBottomSheet visible={sheet === 'lyrics'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, styles.tallSheet, { backgroundColor: c.surface }]} backdropLabel="Close lyrics sources" dragActivationHeight={80}>
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Lyrics sources</Text>
                <Text style={[GX_TYPE.bodyMedium, styles.sheetBody, { color: c.onSurfaceVariant }]}>Asked together; the highest one that answers wins. Turned-off sources are never contacted.</Text>
                <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
                    <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                        {sources.map((source, index) => {
                            const on = lyrics?.enabled.includes(source.id) ?? false;
                            return (
                                <View key={source.id}>
                                    <View style={styles.sourceRow}>
                                        <View style={styles.sourceArrows}>
                                            <TouchableOpacity disabled={index === 0} onPress={() => moveSource(source.id, -1)} hitSlop={6} accessibilityLabel={`Move ${source.label} up`}>
                                                <Ionicons name="chevron-up" size={18} color={index === 0 ? c.outline : c.onSurfaceVariant} />
                                            </TouchableOpacity>
                                            <TouchableOpacity disabled={index === sources.length - 1} onPress={() => moveSource(source.id, 1)} hitSlop={6} accessibilityLabel={`Move ${source.label} down`}>
                                                <Ionicons name="chevron-down" size={18} color={index === sources.length - 1 ? c.outline : c.onSurfaceVariant} />
                                            </TouchableOpacity>
                                        </View>
                                        <View style={styles.rowCopy}>
                                            <View style={styles.rowTitleLine}>
                                                <Text style={[GX_TYPE.bodyLarge, { color: c.onBackground }]} numberOfLines={1}>{source.label}</Text>
                                                {source.wordSynced ? <Text style={[GX_TYPE.labelSmall, styles.badge]}>WORD</Text> : null}
                                            </View>
                                            <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]}>{source.detail}</Text>
                                        </View>
                                        <Switch value={on} onValueChange={() => toggleSource(source.id)} trackColor={{ true: c.primary, false: c.outline }} thumbColor={on ? c.onPrimary : '#FFFFFF'} />
                                    </View>
                                    {index < sources.length - 1 && <View style={[styles.divider, { backgroundColor: c.outline }]} />}
                                </View>
                            );
                        })}
                    </View>
                </ScrollView>
            </DraggableBottomSheet>
            <DraggableBottomSheet visible={sheet === 'sources'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.surface }]} backdropLabel="Close sources">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Sources</Text>
                <Text style={[GX_TYPE.bodyMedium, styles.sheetBody, { color: c.onSurfaceVariant }]}>Tried top to bottom until one plays. A source turned off is skipped.</Text>
                <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                    {(['TIDAL', 'JIOSAAVN', 'AUDIUS'] as StreamSource[])
                        .sort((x, y) => (app.sourceOrder.includes(x) ? app.sourceOrder.indexOf(x) : 9) - (app.sourceOrder.includes(y) ? app.sourceOrder.indexOf(y) : 9))
                        .map((source, index, list) => {
                            const on = app.sourceOrder.includes(source);
                            const position = app.sourceOrder.indexOf(source);
                            return (
                                <View key={source}>
                                    <View style={styles.sourceRow}>
                                        <View style={styles.sourceArrows}>
                                            <TouchableOpacity disabled={!on || position === 0} onPress={() => moveStreamSource(source, -1)} hitSlop={6} accessibilityLabel={`Move ${source} up`}>
                                                <Ionicons name="chevron-up" size={18} color={!on || position === 0 ? c.outline : c.onSurfaceVariant} />
                                            </TouchableOpacity>
                                            <TouchableOpacity disabled={!on || position === app.sourceOrder.length - 1} onPress={() => moveStreamSource(source, 1)} hitSlop={6} accessibilityLabel={`Move ${source} down`}>
                                                <Ionicons name="chevron-down" size={18} color={!on || position === app.sourceOrder.length - 1 ? c.outline : c.onSurfaceVariant} />
                                            </TouchableOpacity>
                                        </View>
                                        <View style={styles.rowCopy}>
                                            <Text style={[GX_TYPE.bodyLarge, { color: c.onBackground }]}>{SOURCE_LABELS[source].title}</Text>
                                            <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]}>{SOURCE_LABELS[source].detail}</Text>
                                        </View>
                                        <Switch value={on} onValueChange={() => toggleStreamSource(source)} trackColor={{ true: '#FFFFFF', false: 'rgba(255,255,255,0.10)' }} thumbColor={on ? '#000000' : 'rgba(255,255,255,0.18)'} />
                                    </View>
                                    {index < list.length - 1 && <View style={[styles.divider, { backgroundColor: c.outline }]} />}
                                </View>
                            );
                        })}
                </View>
            </DraggableBottomSheet>

            <DraggableBottomSheet visible={sheet === 'translation'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, styles.tallSheet, { backgroundColor: c.surface }]} backdropLabel="Close translation language" dragActivationHeight={80}>
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Translation language</Text>
                <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
                    <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                        {([['', 'Off'], ...TRANSLATION_LANGUAGES] as [string, string][]).map(([code, name], index, list) => (
                            <View key={code || 'off'}>
                                <SettingsRow title={name} onPress={() => { setApp({ translationLanguage: code }); setSheet(null); }} trailing={app.translationLanguage === code ? <Ionicons name="checkmark" size={22} color={c.primary} /> : <View />} c={c} />
                                {index < list.length - 1 && <View style={[styles.divider, { backgroundColor: c.outline }]} />}
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </DraggableBottomSheet>

            <DraggableBottomSheet visible={sheet === 'listenbrainz'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.surface }]} backdropLabel="Close ListenBrainz">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>ListenBrainz</Text>
                {app.listenBrainzToken ? (
                    <>
                        <Text style={[GX_TYPE.bodyMedium, styles.sheetBody, { color: c.onSurfaceVariant }]}>{lbUser ? `Scrobbling as ${lbUser}. A song counts once half of it, or four minutes, has played.` : 'Connected.'}</Text>
                        <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                            <TouchableOpacity style={styles.destructive} onPress={() => { setApp({ listenBrainzToken: '' }); setSheet(null); }} accessibilityRole="button">
                                <Text style={[GX_TYPE.bodyLarge, { color: '#FF453A' }]}>Disconnect</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                ) : (
                    <>
                        <Text style={[GX_TYPE.bodyMedium, styles.sheetBody, { color: c.onSurfaceVariant }]}>Paste your user token from listenbrainz.org/settings.</Text>
                        <View style={[styles.searchField, styles.tokenField, { backgroundColor: c.surfaceVariant }]}>
                            <TextInput value={lbToken} onChangeText={setLbToken} placeholder="User token" placeholderTextColor={c.onSurfaceVariant} autoCapitalize="none" autoCorrect={false} style={[GX_TYPE.bodyLarge, styles.searchInput, { color: c.onBackground }]} />
                        </View>
                        <View style={[styles.group, styles.sheetGroup, { backgroundColor: c.surfaceVariant }]}>
                            <TouchableOpacity style={styles.destructive} disabled={lbBusy || !lbToken.trim()} onPress={saveListenBrainz} accessibilityRole="button">
                                <Text style={[GX_TYPE.bodyLarge, { color: lbToken.trim() ? c.onBackground : c.onSurfaceVariant }]}>{lbBusy ? 'Checking…' : 'Connect'}</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </DraggableBottomSheet>
        </SafeAreaView>
    );
}

const SOURCE_LABELS: Record<StreamSource, { title: string; detail: string }> = {
    TIDAL: { title: 'TIDAL', detail: 'Lossless and hi-res, by the same track' },
    JIOSAAVN: { title: 'JioSaavn', detail: 'AAC 320 kbps, matched by title and artist' },
    AUDIUS: { title: 'Audius', detail: 'MP3 from independent artists' },
};

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    content: { paddingBottom: 160 },
    title: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
    searchField: { height: 54, borderRadius: 14, marginHorizontal: 20, marginBottom: 4, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
    searchInput: { flex: 1, padding: 0 },
    account: { marginHorizontal: GROUP_INSET, marginTop: 22, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' },
    avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    accountCopy: { flex: 1, marginLeft: 14, marginRight: 8 },
    groupHeader: { marginLeft: GROUP_INSET + 4, marginRight: GROUP_INSET, marginTop: 26, marginBottom: 8 },
    groupSpacer: { height: 22 },
    group: { marginHorizontal: GROUP_INSET, borderRadius: 14, overflow: 'hidden' },
    groupFooter: { marginHorizontal: GROUP_INSET + 4, marginTop: 8 },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: ROW_INSET, paddingVertical: 12 },
    rowCopy: { flex: 1, minWidth: 0, marginLeft: ICON_GAP, marginRight: 12 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center' },
    badge: { marginLeft: 8, color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
    value: { marginRight: 4, maxWidth: 160 },
    chevron: { opacity: 0.7 },
    divider: { height: 0.5, marginLeft: TEXT_INSET },
    segmentRow: { paddingHorizontal: ROW_INSET, paddingVertical: 12, gap: 10 },
    segmentTitle: { flexDirection: 'row', alignItems: 'center' },
    segmentLabel: { marginLeft: ICON_GAP },
    segmented: { flexDirection: 'row', borderRadius: 10, padding: 4, gap: 2 },
    segment: { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
    destructive: { paddingVertical: 15, alignItems: 'center' },
    noMatch: { textAlign: 'center', paddingTop: 40 },
    sheet: { paddingHorizontal: 0, paddingBottom: 28 },
    tallSheet: { height: '82%' },
    sheetTitle: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
    tokenField: { marginBottom: 12 },
    sheetBody: { paddingHorizontal: 20, paddingBottom: 12 },
    sheetGroup: { marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
    chip: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
    sourceRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: ROW_INSET, paddingVertical: 10 },
    sourceArrows: { width: ICON_SIZE, alignItems: 'center' },
});
