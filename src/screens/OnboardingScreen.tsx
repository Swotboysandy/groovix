// OnboardingScreen: a cycling colour mesh behind large
// white type and capsule buttons. second page connects a Google
// account; Groovix has none, so its pages after the name are the taste picks.
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView,
    Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { GENRE_LIST, ARTIST_LIST, savePrefs } from '../store/preferences';
import { getUserProfile, saveUserProfile } from '../store/userProfile';
import { GX_TYPE } from '../theme/groovix';

interface Props { onDone: () => void; }

type Page = 0 | 1 | 2;
const PAGE_NAME = 0;
const PAGE_GENRES = 1;
const PAGE_ARTISTS = 2;
const NAME_LIMIT = 40;
const MESH_CYCLE_MILLIS = 6000;

const WELCOME_PALETTES = [
    ['#FA2D48', '#7B2FF7', '#FF7A45', '#2E1A8A'],
    ['#FF4E8A', '#FF9A3C', '#E0245E', '#6A1B9A'],
    ['#1E88E5', '#00BFA5', '#5E35B1', '#0D47A1'],
    ['#00C853', '#00B8D4', '#7C4DFF', '#1A237E'],
];
const CONNECT_PALETTES = [
    ['#FF1E3C', '#C2185B', '#FF8F3D', '#4A1C8C'],
    ['#E53935', '#FF6E40', '#AD1457', '#311B92'],
    ['#FF3D00', '#D81B60', '#8E24AA', '#B71C1C'],
    ['#F50057', '#FF9100', '#C51162', '#4527A0'],
];

// Stand-in for MeshGradientBackground: two diagonal gradients cross-fading
// through the palettes while a second layer drifts against the first.
function MeshBackground({ palettes }: { palettes: string[][] }) {
    const [index, setIndex] = useState(0);
    const fade = useRef(new Animated.Value(0)).current;
    const drift = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(drift, { toValue: 1, duration: MESH_CYCLE_MILLIS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(drift, { toValue: 0, duration: MESH_CYCLE_MILLIS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [drift]);

    useEffect(() => {
        fade.setValue(0);
        const animation = Animated.timing(fade, { toValue: 1, duration: MESH_CYCLE_MILLIS, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
        animation.start(({ finished }) => { if (finished) setIndex(i => (i + 1) % palettes.length); });
        return () => animation.stop();
    }, [index, fade, palettes.length]);

    const current = palettes[index % palettes.length];
    const next = palettes[(index + 1) % palettes.length];
    const translate = drift.interpolate({ inputRange: [0, 1], outputRange: [-60, 60] });

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient colors={current} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
                <LinearGradient colors={next} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <Animated.View style={[styles.driftLayer, { transform: [{ translateX: translate }, { translateY: Animated.multiply(translate, -1) }, { rotate: '35deg' }] }]}>
                <LinearGradient colors={[`${current[1]}00`, `${current[2]}AA`, `${current[3]}00`]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <LinearGradient
                colors={['rgba(0,0,0,0.05)', 'transparent', 'rgba(0,0,0,0.45)']}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}

function PillButton({ label, onPress, primary, enabled = true, loading = false }: { label: string; onPress: () => void; primary: boolean; enabled?: boolean; loading?: boolean }) {
    const scale = useRef(new Animated.Value(1)).current;
    const to = (value: number) => Animated.spring(scale, { toValue: value, stiffness: 900, damping: 40, mass: 1, useNativeDriver: true }).start();
    return (
        <Pressable
            onPress={onPress}
            disabled={!enabled || loading}
            onPressIn={() => to(0.97)}
            onPressOut={() => to(1)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !enabled }}
        >
            <Animated.View style={[styles.pill, { backgroundColor: primary ? '#FFFFFF' : 'rgba(255,255,255,0.16)', opacity: enabled ? 1 : 0.4, transform: [{ scale }] }]}>
                {loading ? <ActivityIndicator color={primary ? '#000000' : '#FFFFFF'} /> : (
                    <Text style={[GX_TYPE.titleMedium, styles.pillText, { color: primary ? '#000000' : '#FFFFFF' }]} numberOfLines={1}>{label}</Text>
                )}
            </Animated.View>
        </Pressable>
    );
}

function BackButton({ onPress }: { onPress: () => void }) {
    return (
        <Pressable onPress={onPress} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
        </Pressable>
    );
}

function Title({ children }: { children: string }) {
    return <Text style={[GX_TYPE.displayLarge, styles.title]}>{children}</Text>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
        <Pressable
            onPress={onPress}
            style={[styles.chip, { backgroundColor: selected ? '#FFFFFF' : 'rgba(255,255,255,0.14)' }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
        >
            {selected && <Ionicons name="checkmark" size={16} color="#000000" style={styles.chipCheck} />}
            <Text style={[GX_TYPE.titleMedium, { color: selected ? '#000000' : '#FFFFFF' }]}>{label}</Text>
        </Pressable>
    );
}

export default function OnboardingScreen({ onDone }: Props) {
    const [page, setPage] = useState<Page>(PAGE_NAME);
    const [name, setName] = useState('');
    const [keyboardUp, setKeyboardUp] = useState(false);
    const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
    const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const slide = useRef(new Animated.Value(1)).current;
    const direction = useRef(1);

    useEffect(() => {
        getUserProfile().then(profile => {
            if (profile.displayName && profile.displayName !== 'My Library') setName(profile.displayName);
        });
        const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
        return () => { show.remove(); hide.remove(); };
    }, []);

    const goTo = (next: Page) => {
        direction.current = next > page ? 1 : -1;
        slide.setValue(0);
        setPage(next);
        Animated.timing(slide, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (page === PAGE_NAME) return false;
            goTo((page - 1) as Page);
            return true;
        });
        return () => sub.remove();
    });

    const nextFromName = async () => {
        const chosen = name.trim();
        if (!chosen) return;
        Keyboard.dismiss();
        const profile = await getUserProfile();
        await saveUserProfile({ ...profile, displayName: chosen });
        goTo(PAGE_GENRES);
    };

    const toggle = (list: string[], setList: (v: string[]) => void, value: string) =>
        setList(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);

    const finish = async () => {
        setSaving(true);
        await savePrefs({ genres: selectedGenres, artists: selectedArtists });
        onDone();
    };

    const visibleArtists = selectedGenres.length === 0 ? ARTIST_LIST : ARTIST_LIST.filter(artist => selectedGenres.includes(artist.genre));

    const pageStyle = {
        opacity: slide.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.6, 1] }),
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [direction.current * 120, 0] }) }],
    };

    return (
        <View style={styles.root}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
            <MeshBackground key={page === PAGE_NAME ? 'welcome' : 'connect'} palettes={page === PAGE_NAME ? WELCOME_PALETTES : CONNECT_PALETTES} />
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                <KeyboardAvoidingView style={styles.flex} behavior="padding">
                    <Pressable style={styles.flex} onPress={Keyboard.dismiss} accessible={false}>
                        <Animated.View style={[styles.page, pageStyle]}>
                            {page === PAGE_NAME ? (
                                <>
                                    {!keyboardUp && (
                                        <View style={styles.logoBlock}>
                                            <Ionicons name="musical-notes" size={30} color="#FFFFFF" />
                                        </View>
                                    )}
                                    <View style={styles.titleGap} />
                                    <Title>Millions of songs, stream on Groovix</Title>
                                    <View style={styles.flex} />
                                    <Text style={[GX_TYPE.titleMedium, styles.prompt]}>What should we call you?</Text>
                                    <View style={styles.nameField}>
                                        <TextInput
                                            value={name}
                                            onChangeText={text => setName(text.slice(0, NAME_LIMIT))}
                                            placeholder="Your name"
                                            placeholderTextColor="rgba(255,255,255,0.38)"
                                            selectionColor="#FFFFFF"
                                            autoCapitalize="words"
                                            autoCorrect={false}
                                            returnKeyType="next"
                                            onSubmitEditing={nextFromName}
                                            style={[GX_TYPE.displayLarge, styles.nameInput]}
                                        />
                                    </View>
                                    <Text style={[GX_TYPE.bodyMedium, styles.footerText]}>Friends see this when you Jam together. You can change it later in Settings.</Text>
                                    <View style={styles.gap28} />
                                    <PillButton label="Next" onPress={nextFromName} primary enabled={name.trim().length > 0} />
                                </>
                            ) : page === PAGE_GENRES ? (
                                <>
                                    <BackButton onPress={() => goTo(PAGE_NAME)} />
                                    <View style={styles.gap20} />
                                    <Title>What do you vibe to?</Title>
                                    <Text style={[GX_TYPE.bodyLarge, styles.body]}>Pick the genres you love and Groovix will shape your Home around them.</Text>
                                    <ScrollView style={styles.flex} contentContainerStyle={styles.chips} showsVerticalScrollIndicator={false}>
                                        {GENRE_LIST.map(genre => (
                                            <Chip key={genre.id} label={genre.label} selected={selectedGenres.includes(genre.id)} onPress={() => toggle(selectedGenres, setSelectedGenres, genre.id)} />
                                        ))}
                                    </ScrollView>
                                    <PillButton label="Next" onPress={() => goTo(PAGE_ARTISTS)} primary />
                                    <View style={styles.gap12} />
                                    <PillButton label="Skip" onPress={finish} primary={false} loading={saving} />
                                </>
                            ) : (
                                <>
                                    <BackButton onPress={() => goTo(PAGE_GENRES)} />
                                    <View style={styles.gap20} />
                                    <Title>Pick your artists</Title>
                                    <Text style={[GX_TYPE.bodyLarge, styles.body]}>Your recommendations and radio start from here.</Text>
                                    <ScrollView style={styles.flex} contentContainerStyle={styles.chips} showsVerticalScrollIndicator={false}>
                                        {visibleArtists.map(artist => (
                                            <Chip key={artist.name} label={artist.name} selected={selectedArtists.includes(artist.name)} onPress={() => toggle(selectedArtists, setSelectedArtists, artist.name)} />
                                        ))}
                                    </ScrollView>
                                    <PillButton label="Start listening" onPress={finish} primary loading={saving} />
                                    <View style={styles.gap12} />
                                    <PillButton label="Skip" onPress={finish} primary={false} enabled={!saving} />
                                </>
                            )}
                            <View style={styles.gap16} />
                        </Animated.View>
                    </Pressable>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000000' },
    flex: { flex: 1 },
    driftLayer: { position: 'absolute', top: '-25%', left: '-25%', width: '150%', height: '150%', opacity: 0.7 },
    page: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 28, paddingTop: 16 },
    logoBlock: { marginTop: 40, height: 30, justifyContent: 'center' },
    titleGap: { height: 24 },
    title: { color: '#FFFFFF', fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
    prompt: { color: 'rgba(255,255,255,0.78)', fontSize: 17, marginLeft: 4, marginBottom: 12 },
    nameField: { height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 24, justifyContent: 'center' },
    nameInput: { color: '#FFFFFF', fontSize: 26, lineHeight: undefined, letterSpacing: -0.6, padding: 0, height: 64, textAlignVertical: 'center', includeFontPadding: false },
    footerText: { color: 'rgba(255,255,255,0.55)', marginTop: 10, marginHorizontal: 4 },
    body: { color: 'rgba(255,255,255,0.72)', fontSize: 17, lineHeight: 23, marginTop: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 24 },
    chip: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 22, paddingHorizontal: 18 },
    chipCheck: { marginRight: 6 },
    pill: { height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    pillText: { fontSize: 17, fontFamily: 'SFProDisplay-Bold' },
    back: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
    gap12: { height: 12 },
    gap16: { height: 16 },
    gap20: { height: 20 },
    gap28: { height: 28 },
});
