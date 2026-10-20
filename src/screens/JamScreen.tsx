// Listen Together landing (PartyLanding, the create and
// join sheets, GlowingAvatar and PartyCodeField) onto Groovix's Jam rooms.
import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, TextInput, StyleSheet, Animated, Easing, Image,
    ScrollView, KeyboardAvoidingView, Share, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useJam } from '../context/JamContext';
import { APP_VERSION } from '../services/updater';
import { useAppDialog } from '../context/DialogContext';
import { useTheme } from '../context/ThemeContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { createJamInviteLink } from '../services/jamLinks';
import { getUserProfile } from '../store/userProfile';
import DraggableBottomSheet from '../components/DraggableBottomSheet';
import { ACCENT_RED, GX_DARK, GX_LIGHT, GX_TYPE, type GXColors } from '../theme/groovix';

/** Groovix room codes are five characters. */
const CODE_LENGTH = 5;

// GlowingAvatar: a breathing glow behind the listener's photo.
function GlowingAvatar({ uri, c, size = 104 }: { uri?: string; c: GXColors; size?: number }) {
    const breathe = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
            Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [breathe]);
    const glow = size * 2.5;
    return (
        <View style={{ width: glow, height: glow, alignItems: 'center', justifyContent: 'center' }}>
            {/* Soft white halo: stacked faint discs read as a radial falloff. */}
            {Array.from({ length: 18 }, (_, i) => 1 - i * 0.032).map((scale, index) => (
                <Animated.View
                    key={index}
                    style={{
                        position: 'absolute', width: glow * scale, height: glow * scale, borderRadius: glow,
                        backgroundColor: '#FFFFFF',
                        opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.012, 0.018] }),
                        transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
                    }}
                />
            ))}
            {uri ? (
                <Image source={{ uri }} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} />
            ) : (
                <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceVariant }]}>
                    <Ionicons name="person" size={size * 0.45} color={c.onSurfaceVariant} />
                </View>
            )}
        </View>
    );
}

// PartyCodeField: one cell per character over a hidden input.
function PartyCodeField({ code, onChange, onSubmit, c }: { code: string; onChange: (v: string) => void; onSubmit: () => void; c: GXColors }) {
    const [focused, setFocused] = useState(false);
    const input = useRef<TextInput>(null);
    return (
        <TouchableOpacity activeOpacity={1} onPress={() => input.current?.focus()} style={styles.codeRow}>
            {Array.from({ length: CODE_LENGTH }, (_, index) => {
                const active = focused && index === Math.min(code.length, CODE_LENGTH - 1);
                return (
                    <View key={index} style={[styles.codeCell, { backgroundColor: c.surfaceVariant, borderColor: active ? c.primary : c.outline }]}>
                        <Text style={[GX_TYPE.titleLarge, { color: c.onBackground }]}>{code[index] ?? ''}</Text>
                    </View>
                );
            })}
            <TextInput
                ref={input}
                value={code}
                onChangeText={text => onChange(text.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, CODE_LENGTH))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => code.length === CODE_LENGTH && onSubmit()}
                style={styles.hiddenInput}
                caretHidden
            />
        </TouchableOpacity>
    );
}

function PillButton({ label, onPress, loading, c, primary = true, disabled = false }: { label: string; onPress: () => void; loading?: boolean; c: GXColors; primary?: boolean; disabled?: boolean }) {
    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={loading || disabled}
            activeOpacity={0.85}
            style={[styles.pill, { backgroundColor: primary ? c.primary : 'transparent', opacity: disabled ? 0.4 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            {loading ? <ActivityIndicator color={primary ? c.onPrimary : c.onBackground} /> : (
                <Text style={[GX_TYPE.titleMedium, { color: primary ? c.onPrimary : c.onSurfaceVariant }]}>{label}</Text>
            )}
        </TouchableOpacity>
    );
}

export default function JamScreen({ inviteCode }: { inviteCode?: string }) {
    const insets = useSafeAreaInsets();
    const { createRoom, joinRoom } = useJam();
    const { showDialog } = useAppDialog();
    const { theme, colors } = useTheme();
    useScreenStatusBar(theme === 'midnight' ? 'light-content' : 'dark-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;

    const [sheet, setSheet] = useState<null | 'create' | 'join'>(null);
    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState<string | undefined>();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        getUserProfile().then(profile => {
            if (profile.displayName !== 'My Library') setName(current => current || profile.displayName);
            setAvatar(profile.avatarUri);
        });
    }, []);

    useEffect(() => {
        const invitedRoom = inviteCode?.trim().toUpperCase();
        if (!invitedRoom) return;
        setCode(invitedRoom);
        setSheet('join');
    }, [inviteCode]);

    const handleCreate = async () => {
        const trimmed = name.trim();
        if (!trimmed) { showDialog({ title: 'Enter your name', icon: 'person-outline' }); return; }
        setLoading(true);
        try {
            const roomCode = await createRoom(trimmed);
            // JamTab swaps to the room view automatically once `room` is set.
            const link = createJamInviteLink(roomCode);
            Share.share({ message: `Listen with me on Groovix — party code ${roomCode}\n${link}` });
        } catch {
            showDialog({ title: 'Could not create party', message: 'Please try again.', icon: 'cloud-offline-outline' });
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async () => {
        const trimmed = name.trim();
        if (!trimmed) { showDialog({ title: 'Enter your name', icon: 'person-outline' }); return; }
        if (!code.trim()) { showDialog({ title: 'Enter a party code', icon: 'keypad-outline' }); return; }
        setLoading(true);
        try {
            const ok = await joinRoom(code.trim(), trimmed);
            if (!ok) { showDialog({ title: 'Party not found', message: 'Check the code and try again.', icon: 'search-outline' }); return; }
        } catch {
            showDialog({ title: 'Could not join party', message: 'Please try again.', icon: 'cloud-offline-outline' });
        } finally {
            setLoading(false);
        }
    };

    const nameField = (
        <View style={[styles.nameField, { backgroundColor: c.surfaceVariant }]}>
            <Ionicons name="person-circle-outline" size={22} color={c.onSurfaceVariant} />
            <TextInput
                style={[GX_TYPE.bodyLarge, styles.nameInput, { color: c.onBackground }]}
                placeholder="Nickname for this party"
                placeholderTextColor={c.onSurfaceVariant}
                value={name}
                onChangeText={setName}
                maxLength={24}
            />
        </View>
    );

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
            <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled">
                <Text style={[GX_TYPE.displayLarge, styles.pageTitle, { color: c.onBackground }]}>Listen together</Text>

                {/* PartyLanding */}
                <View style={styles.landing}>
                    <GlowingAvatar uri={avatar} c={c} />
                    <Text style={[GX_TYPE.headlineMedium, styles.landingTitle, { color: c.onBackground }]}>Start a party</Text>
                    <Text style={[GX_TYPE.bodyLarge, styles.landingSubtitle, { color: c.onSurfaceVariant }]}>
                        Because music sounds better together. Invite friends to listen and add songs in real time, wherever they are.
                    </Text>
                    <PillButton label="Create a party" onPress={() => setSheet('create')} c={c} />
                    <PillButton label="Join existing" onPress={() => setSheet('join')} c={c} primary={false} />
                </View>

                <Text style={[GX_TYPE.labelMedium, styles.version, { color: c.onSurfaceVariant }]}>Everyone needs the same Groovix version · v{APP_VERSION}</Text>
            </ScrollView>

            <DraggableBottomSheet visible={sheet === 'create'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.background }]} backdropLabel="Close create party">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Create a party</Text>
                <Text style={[GX_TYPE.bodyMedium, styles.sheetSubtitle, { color: c.onSurfaceVariant }]}>Pick how you'll show up. You get a code to share with friends.</Text>
                {nameField}
                <View style={styles.sheetGap} />
                <PillButton label={loading ? 'Creating…' : 'Create a party'} onPress={handleCreate} loading={loading} c={c} disabled={!name.trim()} />
            </DraggableBottomSheet>

            <DraggableBottomSheet visible={sheet === 'join'} onClose={() => setSheet(null)} sheetStyle={[styles.sheet, { backgroundColor: c.background }]} backdropLabel="Close join party">
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Join a party</Text>
                <Text style={[GX_TYPE.bodyMedium, styles.sheetSubtitle, { color: c.onSurfaceVariant }]}>Enter the party code a friend shared.</Text>
                <PartyCodeField code={code} onChange={setCode} onSubmit={handleJoin} c={c} />
                <View style={styles.sheetGap} />
                {nameField}
                <View style={styles.sheetGap} />
                <PillButton label={loading ? 'Joining…' : 'Join'} onPress={handleJoin} loading={loading} c={c} disabled={code.length < CODE_LENGTH || !name.trim()} />
            </DraggableBottomSheet>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { paddingBottom: 140 },
    pageTitle: { paddingHorizontal: 20, paddingTop: 8 },
    landing: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 28 },
    avatar: { alignItems: 'center', justifyContent: 'center' },
    landingTitle: { fontFamily: 'SFProDisplay-Bold', fontSize: 30, textAlign: 'center', marginTop: 20 },
    landingSubtitle: { textAlign: 'center', marginTop: 8, marginBottom: 28 },
    pill: { height: 52, borderRadius: 26, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    version: { textAlign: 'center', marginTop: 28 },
    sheet: { paddingHorizontal: 20, paddingBottom: 28 },
    sheetTitle: { marginTop: 4 },
    sheetSubtitle: { marginTop: 4, marginBottom: 18 },
    sheetGap: { height: 14 },
    nameField: { height: 52, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
    nameInput: { flex: 1, padding: 0 },
    codeRow: { flexDirection: 'row', gap: 8 },
    codeCell: { flex: 1, height: 52, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    hiddenInput: { position: 'absolute', opacity: 0, width: '100%', height: '100%' },
});
