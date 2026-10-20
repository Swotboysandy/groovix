// Replay: ReplayScreen (period picker, credit cards, charts,
// listening shape) and ReplayStories (tap-through story pages).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { API } from '../api';
import { usePlayerSummary } from '../context/PlayerContext';
import { useTheme } from '../context/ThemeContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { getUserProfile } from '../store/userProfile';
import { replaySummary, type RankedEntry, type ReplayPeriod, type ReplaySummary } from '../store/playHistory';
import { BackBar, ProfileCircle } from '../components/GlassHeader';
import { ACCENT_RED, GX_TYPE, PAGE_GUTTER } from '../theme/groovix';

const CHART_LENGTH = 10;
const STORY_ROWS = 5;
const PAGE_MILLIS = 14_000;
const BACK_ZONE = 0.32;
const CARD_RATIO = 1.586;
const PERIODS: { id: ReplayPeriod; label: string }[] = [
    { id: 'THIS_WEEK', label: 'Weekly' },
    { id: 'THIS_MONTH', label: 'Monthly' },
    { id: 'THIS_YEAR', label: 'Yearly' },
    { id: 'ALL_TIME', label: 'Lifetime' },
];

type StoryPage = 'INTRO' | 'MINUTES' | 'ARTISTS' | 'SONGS' | 'ALBUMS' | 'HABITS' | 'SUMMARY';
const STORY_PAGES: StoryPage[] = ['INTRO', 'MINUTES', 'ARTISTS', 'SONGS', 'ALBUMS', 'HABITS', 'SUMMARY'];
const STORY_HUE: Record<StoryPage, number> = { INTRO: 0, MINUTES: 40, SONGS: 95, ARTISTS: 145, ALBUMS: 195, HABITS: 285, SUMMARY: 325 };

const grouped = (value: number) => Math.round(value).toLocaleString('en-US');
const formatMinutes = (ms: number) => grouped(ms / 60_000);
function formatListening(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
    return `${grouped(minutes)} min`;
}
function formatHour(hour: number): string {
    if (hour === 0) return 'midnight';
    if (hour === 12) return 'midday';
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}
function formatDay(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
const plural = (count: number, one: string, many: string) => `${grouped(count)} ${count === 1 ? one : many}`;
const cover = (id?: string, size = 320) => (id ? API.getCoverUrl(id, size) : undefined);

type Run = { text: string; bold: boolean };
function headline(summary: ReplaySummary, page: StoryPage): Run[] {
    const week = summary.period === 'THIS_WEEK';
    const r = (...parts: [string, boolean][]) => parts.map(([text, bold]) => ({ text, bold }));
    switch (page) {
        case 'INTRO': return r(['Your ', false], ['Replay', true], [' is ready.', false]);
        case 'MINUTES': return r(['You spent ', false], [`${formatMinutes(summary.totalMs)} minutes`, true], [' with music.', false]);
        case 'SONGS': return r(['In total, ', false], [plural(summary.totalPlays, 'song', 'songs'), true], [week ? ' filled your week.' : ' filled your month.', false]);
        case 'ARTISTS': return r([week ? 'This week, ' : 'All month, ', false], ['One artist', true], [' kept coming back.', false]);
        case 'ALBUMS': return r(['This time, ', false], ['One album', true], [' held your attention.', false]);
        case 'HABITS': return r(['You explored ', false], [plural(summary.distinctSongs, 'song', 'songs'), true], [' from ', false], [plural(summary.distinctArtists, 'artist', 'artists'), true], ['.', false]);
        default: return r(['Your ', false], [week ? 'week' : summary.label, true], [' in music.', false]);
    }
}

function Headline({ runs, size = 30 }: { runs: Run[]; size?: number }) {
    return (
        <Text style={[GX_TYPE.displayLarge, styles.headline, { fontSize: size, lineHeight: size * 1.15 }]}>
            {runs.map((run, index) => (
                <Text key={index} style={{ fontFamily: run.bold ? 'SFProDisplay-Heavy' : 'SFProDisplay-Regular', color: run.bold ? '#FFFFFF' : 'rgba(255,255,255,0.78)' }}>{run.text}</Text>
            ))}
        </Text>
    );
}

function currentMonth(): string {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
}

// ReplayCreditCard: a card-shaped summary over the artwork's colours.
function CreditCard({ label, value, detail, art, holder, memberSince, onPress, width }: {
    label: string; value: string; detail?: string; art?: string; holder: string; memberSince: string | null; onPress: () => void; width: number;
}) {
    return (
        <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={[styles.card, { width, height: width / CARD_RATIO }]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
            {art ? <Image source={{ uri: art }} style={StyleSheet.absoluteFill} blurRadius={34} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#5A1A1F' }]} />}
            <LinearGradient colors={['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0.55)']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                    <Text style={[GX_TYPE.labelSmall, styles.cardEyebrow]}>YOUR LISTENING EXPERIENCE</Text>
                    <MaterialCommunityIcons name="waves" size={30} color="#FFFFFF" />
                </View>
                <View style={styles.flex} />
                <Text style={[GX_TYPE.headlineMedium, styles.cardValue]} numberOfLines={2}>{value}</Text>
                <Text style={[GX_TYPE.labelSmall, styles.cardLabel]}>{label.toUpperCase()}</Text>
                <View style={{ flex: 0.85 }} />
                <View style={styles.cardFoot}>
                    <View style={styles.flex}>
                        <Text style={styles.embossed}>{holder.toUpperCase()}</Text>
                        {detail ? <Text style={[GX_TYPE.labelSmall, styles.cardDetail]} numberOfLines={1}>{detail}</Text> : null}
                    </View>
                    {memberSince ? (
                        <View style={styles.memberSince}>
                            <Text style={styles.memberLabel}>MEMBER SINCE</Text>
                            <Text style={[styles.embossed, { fontSize: 12 }]}>{memberSince}</Text>
                        </View>
                    ) : null}
                </View>
            </View>
        </TouchableOpacity>
    );
}

function ChartRow({ entry, rank, circular, onPress }: { entry: RankedEntry; rank: number; circular?: boolean; onPress?: () => void }) {
    const art = cover(entry.cover, 160);
    return (
        <TouchableOpacity style={styles.chartRow} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
            <Text style={[GX_TYPE.labelMedium, styles.rank]}>{rank}</Text>
            {art ? <Image source={{ uri: art }} style={[styles.chartArt, { borderRadius: circular ? 24 : 6 }]} /> : (
                <View style={[styles.chartArt, styles.initial, { borderRadius: circular ? 24 : 6 }]}><Text style={[GX_TYPE.titleLarge, { color: '#FFFFFF' }]}>{entry.title.charAt(0)}</Text></View>
            )}
            <View style={styles.chartCopy}>
                <Text style={[GX_TYPE.bodyLarge, styles.chartTitle]} numberOfLines={1}>{entry.title}</Text>
                <Text style={[GX_TYPE.bodyMedium, styles.dim]} numberOfLines={1}>{[entry.subtitle, formatListening(entry.ms)].filter(Boolean).join(' · ')}</Text>
            </View>
            {entry.plays > 0 && <Text style={[GX_TYPE.labelMedium, styles.plays]}>{entry.plays}</Text>}
        </TouchableOpacity>
    );
}

function ReplayStories({ summary, startPage, onClose }: { summary: ReplaySummary; startPage: StoryPage; onClose: () => void }) {
    const [index, setIndex] = useState(Math.max(0, STORY_PAGES.indexOf(startPage)));
    const progress = useRef(new Animated.Value(0)).current;
    const { width } = useWindowDimensions();
    const page = STORY_PAGES[index];

    const step = useCallback((forward: boolean) => {
        setIndex(current => {
            const next = current + (forward ? 1 : -1);
            if (next >= STORY_PAGES.length) { onClose(); return current; }
            return Math.max(0, next);
        });
    }, [onClose]);

    useEffect(() => {
        progress.setValue(0);
        const animation = Animated.timing(progress, { toValue: 1, duration: PAGE_MILLIS, easing: Easing.linear, useNativeDriver: false });
        animation.start(({ finished }) => { if (finished) step(true); });
        return () => animation.stop();
    }, [index, progress, step]);

    const pool = [...summary.songs.map(s => s.cover), ...summary.artists.map(a => a.cover), ...summary.albums.map(a => a.cover)].filter(Boolean) as string[];
    const pinned = page === 'SONGS' ? summary.songs[0]?.cover : page === 'ARTISTS' ? summary.artists[0]?.cover : page === 'ALBUMS' ? summary.albums[0]?.cover : undefined;
    const art = cover(pinned ?? pool[index % Math.max(1, pool.length)], 640);
    const hue = STORY_HUE[page];

    const leaderboard = (rows: RankedEntry[], circular: boolean) => (
        <>
            {rows[0] && (
                <View style={styles.storyLead}>
                    {cover(rows[0].cover, 320) ? <Image source={{ uri: cover(rows[0].cover, 320) }} style={[styles.storyLeadArt, { borderRadius: circular ? 60 : 10 }]} /> : null}
                    <View style={styles.flex}>
                        <Text style={[GX_TYPE.headlineMedium, styles.white, { fontSize: 26 }]} numberOfLines={2}>{rows[0].title}</Text>
                        {rows[0].subtitle ? <Text style={[GX_TYPE.bodyLarge, styles.dim]}>{rows[0].subtitle}</Text> : null}
                        <Text style={[GX_TYPE.bodyMedium, styles.dim]}>{formatListening(rows[0].ms)} · {plural(rows[0].plays, 'play', 'plays')}</Text>
                    </View>
                </View>
            )}
            <View style={styles.flex} />
            {rows.slice(1, STORY_ROWS).map((row, i) => (
                <View key={row.key} style={styles.storyRow}>
                    <Text style={[GX_TYPE.labelMedium, styles.rank]}>{i + 2}</Text>
                    <Text style={[GX_TYPE.bodyLarge, styles.white, styles.flex]} numberOfLines={1}>{row.title}</Text>
                    <Text style={[GX_TYPE.labelMedium, styles.dim]}>{formatListening(row.ms)}</Text>
                </View>
            ))}
        </>
    );

    const body = () => {
        switch (page) {
            case 'MINUTES':
                return (<><View style={styles.flex} /><Text style={styles.bigNumber}>{formatMinutes(summary.totalMs)}</Text><Text style={[GX_TYPE.titleMedium, styles.dim]}>minutes listened · {summary.label}</Text><View style={styles.flex} /></>);
            case 'SONGS': return leaderboard(summary.songs, false);
            case 'ARTISTS': return leaderboard(summary.artists, true);
            case 'ALBUMS': return leaderboard(summary.albums, false);
            case 'HABITS':
                return (
                    <>
                        <View style={styles.flex} />
                        {[[grouped(summary.distinctSongs), 'songs'], [grouped(summary.distinctArtists), 'artists'], [grouped(summary.distinctAlbums), 'albums']].map(([value, label]) => (
                            <View key={label} style={styles.bigStat}>
                                <Text style={[GX_TYPE.headlineLarge, styles.white]}>{value}</Text>
                                <Text style={[GX_TYPE.bodyMedium, styles.dim]}>{label}</Text>
                            </View>
                        ))}
                        {summary.peakHour !== null && <Text style={[GX_TYPE.bodyLarge, styles.dim]}>You listen most around {formatHour(summary.peakHour)}.</Text>}
                    </>
                );
            case 'SUMMARY':
                return (
                    <>
                        <View style={styles.flex} />
                        {[
                            ['Minutes', formatMinutes(summary.totalMs)],
                            ['Top song', summary.songs[0]?.title ?? '—'],
                            ['Top artist', summary.artists[0]?.title ?? '—'],
                            ['Top album', summary.albums[0]?.title ?? '—'],
                            ['Songs', grouped(summary.distinctSongs)],
                        ].map(([label, value]) => (
                            <View key={label} style={styles.recapLine}>
                                <Text style={[GX_TYPE.bodyMedium, styles.dim, styles.recapLabel]}>{label}</Text>
                                <Text style={[GX_TYPE.bodyLarge, styles.white, styles.flex]} numberOfLines={1}>{value}</Text>
                            </View>
                        ))}
                    </>
                );
            default:
                return (<><View style={styles.flex} /><Text style={[GX_TYPE.bodyMedium, styles.dim]}>Built privately from your listening history on this device.</Text></>);
        }
    };

    return (
        <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={[styles.storyRoot, { backgroundColor: `hsl(${hue}, 55%, 22%)` }]}>
                {art ? <Image source={{ uri: art }} style={StyleSheet.absoluteFill} blurRadius={40} /> : null}
                <LinearGradient colors={[`hsla(${hue}, 60%, 30%, 0.55)`, 'rgba(0,0,0,0.75)']} style={StyleSheet.absoluteFill} />
                <Pressable style={StyleSheet.absoluteFill} onPress={event => step(event.nativeEvent.locationX > width * BACK_ZONE)} accessibilityLabel="Next story page" />
                <SafeAreaView style={styles.storySafe} pointerEvents="box-none">
                    <View style={styles.storyChrome} pointerEvents="box-none">
                        <View style={styles.storyClose}>
                            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close Replay">
                                <Ionicons name="close" size={24} color="#FFFFFF" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.segments}>
                            {STORY_PAGES.map((p, i) => (
                                <View key={p} style={styles.segment}>
                                    <Animated.View style={[styles.segmentFill, { width: i < index ? '100%' : i > index ? '0%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
                                </View>
                            ))}
                        </View>
                        <View style={styles.storyBrand}>
                            <Ionicons name="musical-notes" size={17} color="#FFFFFF" />
                            <Text style={[GX_TYPE.titleMedium, styles.white]}>  Replay · {summary.label}</Text>
                        </View>
                    </View>
                    <View style={styles.storyBody} pointerEvents="none">
                        <Headline runs={headline(summary, page)} />
                        {body()}
                    </View>
                </SafeAreaView>
            </View>
        </Modal>
    );
}

type HeroCard = { label: string; value: string; detail: string; art?: string; page: StoryPage };

function buildReplayCards(summary: ReplaySummary): HeroCard[] {
    return [
        { label: 'Minutes listened', value: formatMinutes(summary.totalMs), detail: `${plural(summary.totalPlays, 'Play', 'Plays')} · ${summary.label}`, art: cover(summary.songs[0]?.cover), page: 'MINUTES' },
        ...(summary.songs[0] ? [{ label: 'Top song', value: summary.songs[0].title, detail: `${summary.songs[0].subtitle} · ${plural(summary.songs[0].plays, 'play', 'plays')}`, art: cover(summary.songs[0].cover), page: 'SONGS' as StoryPage }] : []),
        ...(summary.artists[0] ? [{ label: 'Top artist', value: summary.artists[0].title, detail: `${formatListening(summary.artists[0].ms)} · ${plural(summary.artists[0].plays, 'play', 'plays')}`, art: cover(summary.artists[0].cover), page: 'ARTISTS' as StoryPage }] : []),
        ...(summary.albums[0] ? [{ label: 'Top album', value: summary.albums[0].title, detail: [summary.albums[0].subtitle, formatListening(summary.albums[0].ms)].filter(Boolean).join(' · '), art: cover(summary.albums[0].cover), page: 'ALBUMS' as StoryPage }] : []),
    ];
}

/** Library lead: this year's Replay as swipeable "listening experience" cards. */
export function ReplayCardRow({ onOpen }: { onOpen: () => void }) {
    const { width } = useWindowDimensions();
    const [summary, setSummary] = useState<ReplaySummary | null>(null);
    const [holder, setHolder] = useState('Groovix listener');
    useFocusEffect(useCallback(() => {
        let live = true;
        replaySummary('THIS_YEAR').then(result => { if (live) setSummary(result); });
        getUserProfile().then(profile => { if (live && profile.displayName !== 'My Library') setHolder(profile.displayName); });
        return () => { live = false; };
    }, []));
    const cardWidth = Math.min(340, width * 0.77);
    const cards = summary ? buildReplayCards(summary) : [];
    if (cards.length === 0) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + 12} decelerationRate="fast" contentContainerStyle={styles.cards}>
            {cards.map(card => (
                <CreditCard key={card.label} {...card} holder={holder} memberSince={summary?.since ?? currentMonth()} width={cardWidth} onPress={onOpen} />
            ))}
        </ScrollView>
    );
}

export default function ReplayScreen({ navigation }: any) {
    const { colors, theme } = useTheme();
    useScreenStatusBar('light-content', colors.background);
    const { playTrack } = usePlayerSummary();
    const { width } = useWindowDimensions();
    const [period, setPeriod] = useState<ReplayPeriod>('THIS_YEAR');
    const [summary, setSummary] = useState<ReplaySummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [holder, setHolder] = useState('Groovix listener');
    const [story, setStory] = useState<StoryPage | null>(null);
    const dark = theme !== 'soundwave';

    useFocusEffect(useCallback(() => {
        let live = true;
        setLoading(true);
        replaySummary(period).then(result => { if (live) { setSummary(result); setLoading(false); } });
        getUserProfile().then(profile => { if (live && profile.displayName !== 'My Library') setHolder(profile.displayName); });
        return () => { live = false; };
    }, [period]));

    const lead = cover(summary?.songs[0]?.cover, 640);
    const text = dark ? '#FFFFFF' : '#000000';
    const empty = !summary || summary.songs.length === 0;

    const cards = summary && !empty ? buildReplayCards(summary) : [];

    const chart = (title: string, rows: RankedEntry[], circular: boolean, onPress?: (entry: RankedEntry) => void) => rows.length === 0 ? null : (
        <View key={title} style={styles.chart}>
            <Text style={[GX_TYPE.headlineMedium, styles.sectionTitle, { color: text }]}>{title}</Text>
            {rows.slice(0, CHART_LENGTH).map((entry, index) => (
                <ChartRow key={entry.key} entry={entry} rank={index + 1} circular={circular} onPress={onPress ? () => onPress(entry) : undefined} />
            ))}
        </View>
    );

    const actionRow = (icon: string, label: string, onPress: () => void) => (
        <TouchableOpacity style={[styles.actionRow, { backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)' }]} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
            <Ionicons name={icon} size={18} color={text} />
            <Text style={[GX_TYPE.titleMedium, styles.flex, { color: text, marginLeft: 12 }]}>{label}</Text>
            <Ionicons name="chevron-forward" size={16} color={text} style={{ opacity: 0.5 }} />
        </TouchableOpacity>
    );

    return (
        <View style={[styles.root, { backgroundColor: dark ? '#3A0E12' : '#FFFFFF' }]}>
            {lead ? <Image source={{ uri: lead }} style={StyleSheet.absoluteFill} blurRadius={50} /> : null}
            <LinearGradient
                colors={dark ? ['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.72)', 'rgba(0,0,0,0.88)'] : ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.82)']}
                style={StyleSheet.absoluteFill}
            />
            <SafeAreaView style={styles.flex} edges={['top']}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                    <BackBar right={<ProfileCircle />} style={styles.topBar} />
                    <View style={styles.heading}>
                        <Text style={[GX_TYPE.displayLarge, { color: text }]}>Replay</Text>
                        <Text style={[GX_TYPE.titleMedium, { color: text, opacity: 0.6 }]}>{summary?.label ?? PERIODS.find(p => p.id === period)?.label}</Text>
                        <View style={[styles.periods, { backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)' }]}>
                            {PERIODS.map(option => {
                                const active = option.id === period;
                                return (
                                    <TouchableOpacity key={option.id} onPress={() => setPeriod(option.id)} style={[styles.periodChip, active && { backgroundColor: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.92)' }]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                                        <Text style={[GX_TYPE.labelMedium, { fontFamily: 'SFProDisplay-Bold', color: active ? (dark ? '#000000' : '#FFFFFF') : text, opacity: active ? 1 : 0.75 }]}>{option.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    {loading && !summary ? null : empty ? (
                        <View style={styles.empty}>
                            <Ionicons name="musical-notes" size={40} color={text} style={{ opacity: 0.5 }} />
                            <Text style={[GX_TYPE.bodyLarge, { color: text, opacity: 0.6, textAlign: 'center', marginTop: 12 }]}>Listen a little more and Groovix will turn your history into a Replay.</Text>
                        </View>
                    ) : summary && (
                        <>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={Math.min(300, width - 60) + 12} decelerationRate="fast" contentContainerStyle={styles.cards}>
                                {cards.map(card => (
                                    <CreditCard key={card.label} {...card} holder={holder} memberSince={summary.since} width={Math.min(300, width - 60)} onPress={() => setStory(card.page)} />
                                ))}
                            </ScrollView>
                            {actionRow('play', 'Play your Replay', () => setStory('INTRO'))}
                            {chart('Top songs', summary.songs, false, entry => { const song = summary.songs.find(s => s.key === entry.key); if (song) playTrack(song.track); })}
                            {chart('Top artists', summary.artists, true, entry => entry.id ? navigation.navigate('AlbumDetail', { artistId: entry.id }) : undefined)}
                            {chart('Top albums', summary.albums, false, entry => entry.id ? navigation.navigate('AlbumDetail', { albumId: entry.id }) : undefined)}
                            <View style={styles.habits}>
                                <Text style={[GX_TYPE.headlineMedium, styles.sectionTitleInline, { color: text }]}>Listening shape</Text>
                                <View style={styles.tiles}>
                                    {[['Songs', summary.distinctSongs], ['Artists', summary.distinctArtists], ['Albums', summary.distinctAlbums]].map(([label, value]) => (
                                        <View key={label as string} style={[styles.tile, { backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }]}>
                                            <Text style={[GX_TYPE.headlineMedium, { color: text }]}>{grouped(value as number)}</Text>
                                            <Text style={[GX_TYPE.bodyMedium, { color: text, opacity: 0.55 }]}>{label}</Text>
                                        </View>
                                    ))}
                                </View>
                                {summary.peakHour !== null && <Text style={[GX_TYPE.bodyMedium, styles.note, { color: text }]}>You listen most around {formatHour(summary.peakHour)}.</Text>}
                                {summary.busiestDay && <Text style={[GX_TYPE.bodyMedium, styles.note, { color: text }]}>Your biggest day was {formatDay(summary.busiestDay)}, with {formatListening(summary.busiestDayMs)}.</Text>}
                                <Text style={[GX_TYPE.bodyMedium, styles.note, { color: text }]}>Built privately from your listening history on this device.</Text>
                            </View>
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
            {story && summary && <ReplayStories summary={summary} startPage={story} onClose={() => setStory(null)} />}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    white: { color: '#FFFFFF' },
    dim: { color: 'rgba(255,255,255,0.55)' },
    content: { paddingBottom: 160 },
    topBar: { marginBottom: 90 },
    heading: { paddingHorizontal: PAGE_GUTTER + 4, paddingTop: 0, paddingBottom: 18 },
    periods: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 2, marginTop: 18 },
    periodChip: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 10 },
    cards: { paddingHorizontal: PAGE_GUTTER + 4, gap: 12 },
    card: { borderRadius: 18, overflow: 'hidden', elevation: 16, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    cardBody: { flex: 1, paddingHorizontal: 18, paddingVertical: 16 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
    cardEyebrow: { flex: 1, color: 'rgba(255,255,255,0.72)', letterSpacing: 1.4, fontFamily: 'SFProDisplay-Bold' },
    cardValue: { color: '#FFFFFF', fontSize: 44, lineHeight: 48, fontFamily: 'SFProDisplay-Heavy', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
    cardLabel: { color: 'rgba(255,255,255,0.65)', letterSpacing: 1.8, fontFamily: 'SFProDisplay-Bold' },
    cardFoot: { flexDirection: 'row', alignItems: 'flex-end' },
    cardDetail: { color: 'rgba(255,255,255,0.6)' },
    embossed: { color: 'rgba(255,255,255,0.9)', fontFamily: 'monospace', fontWeight: '700', fontSize: 15, letterSpacing: 2.4, textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 },
    memberSince: { alignItems: 'flex-end', marginLeft: 10 },
    memberLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 7, lineHeight: 8, letterSpacing: 0.8, fontFamily: 'SFProDisplay-Bold' },
    actionRow: { marginHorizontal: PAGE_GUTTER + 4, marginVertical: 18, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' },
    chart: { paddingBottom: 20 },
    sectionTitle: { fontFamily: 'SFProDisplay-Heavy', paddingHorizontal: PAGE_GUTTER + 4, paddingTop: 8, paddingBottom: 10 },
    sectionTitleInline: { fontFamily: 'SFProDisplay-Heavy' },
    chartRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER + 4, paddingVertical: 7 },
    rank: { width: 26, color: ACCENT_RED, fontFamily: 'SFProDisplay-Heavy' },
    chartArt: { width: 48, height: 48 },
    initial: { backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
    chartCopy: { flex: 1, minWidth: 0, marginLeft: 12, marginRight: 8 },
    chartTitle: { color: '#FFFFFF', fontFamily: 'SFProDisplay-Semibold' },
    plays: { color: 'rgba(255,255,255,0.45)' },
    habits: { paddingHorizontal: PAGE_GUTTER + 4 },
    tiles: { flexDirection: 'row', gap: 10, marginTop: 10 },
    tile: { flex: 1, borderRadius: 14, padding: 14 },
    note: { opacity: 0.6, marginTop: 10 },
    empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 40 },
    storyRoot: { flex: 1 },
    storySafe: { flex: 1 },
    storyChrome: { paddingHorizontal: 20 },
    storyClose: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 10 },
    segments: { flexDirection: 'row', gap: 4, marginTop: 6 },
    segment: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    segmentFill: { height: '100%', backgroundColor: '#FFFFFF' },
    storyBrand: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    storyBody: { flex: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 18 },
    headline: { color: '#FFFFFF' },
    bigNumber: { color: '#FFFFFF', fontFamily: 'SFProDisplay-Heavy', fontSize: 72, letterSpacing: -2 },
    storyLead: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 18 },
    storyLeadArt: { width: 120, height: 120 },
    storyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 12 },
    bigStat: { paddingBottom: 22 },
    recapLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
    recapLabel: { width: 96 },
});
