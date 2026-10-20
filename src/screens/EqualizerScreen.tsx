// EqualizerScreen: on/off, Dynamic (tone pad) or Manual
// (seven faders + presets), balance, and the system equaliser link.
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import DraggableBottomSheet from '../components/DraggableBottomSheet';
import { useTheme } from '../context/ThemeContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { BackBar } from '../components/GlassHeader';
import {
    DEFAULT_EQUALIZER, EQUALIZER_PRESETS, MANUAL_BANDS_HZ, MANUAL_RANGE_DB, PRESET_LABELS, TONE_STEPS,
    getEqualizer, matchingPreset, openSystemEqualizer, saveEqualizer,
    type EqualizerPreset, type EqualizerSettings,
} from '../store/equalizer';
import { GX_DARK, GX_LIGHT, GX_TYPE, type GXColors } from '../theme/groovix';
import { SegmentedControl, SettingsRow, SwitchRow } from './SettingsScreen';

const GROUP_INSET = 16;
const ROW_INSET = 16;
const PAD_HEIGHT = 230;
const PUCK_RADIUS = 19;
const DOT_RADIUS = 2.5;
const FADER_HEIGHT = 150;
const FADER_WIDTH = 34;
const TRACK_WIDTH = 5;
const KNOB_RADIUS = 10;
const ZERO_DETENT_DB = 0.6;
const BALANCE_DETENT = 0.04;

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const formatFrequency = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
const formatGain = (db: number) => (Math.abs(db) < 0.05 ? '0' : `${db > 0 ? '+' : ''}${Number(db.toFixed(1))}`);
const snapGain = (raw: number) => {
    const stepped = Math.round(raw * 2) / 2;
    return Math.abs(stepped) < ZERO_DETENT_DB ? 0 : Math.max(-MANUAL_RANGE_DB, Math.min(MANUAL_RANGE_DB, stepped));
};

function Group({ header, footer, children, c, top = 26 }: { header?: string; footer?: string; children: React.ReactNode; c: GXColors; top?: number }) {
    return (
        <View>
            {header ? <Text style={[GX_TYPE.labelSmall, styles.groupHeader, { color: c.onSurfaceVariant }]}>{header.toUpperCase()}</Text> : <View style={{ height: top }} />}
            <View style={[styles.group, { backgroundColor: c.surfaceVariant }]}>{children}</View>
            {footer ? <Text style={[GX_TYPE.bodyMedium, styles.groupFooter, { color: c.onSurfaceVariant }]}>{footer}</Text> : null}
        </View>
    );
}

function Divider({ c }: { c: GXColors }) {
    return <View style={[styles.divider, { backgroundColor: c.outline }]} />;
}

function TonePad({ x, y, enabled, onChange, c }: { x: number; y: number; enabled: boolean; onChange: (x: number, y: number) => void; c: GXColors }) {
    const [size, setSize] = useState({ width: 0, height: PAD_HEIGHT });
    const last = useRef({ x, y });
    last.current = { x, y };
    const columns = TONE_STEPS * 2;
    const usableWidth = Math.max(1, size.width - PUCK_RADIUS * 2);
    const usableHeight = Math.max(1, size.height - PUCK_RADIUS * 2);

    const report = (event: GestureResponderEvent) => {
        const { locationX, locationY } = event.nativeEvent;
        const fx = Math.min(1, Math.max(0, (locationX - PUCK_RADIUS) / usableWidth));
        const fy = Math.min(1, Math.max(0, (locationY - PUCK_RADIUS) / usableHeight));
        const nx = Math.round(fx * columns) - TONE_STEPS;
        const ny = TONE_STEPS - Math.round(fy * columns);
        if (nx !== last.current.x || ny !== last.current.y) onChange(nx, ny);
    };

    const dots: React.ReactNode[] = [];
    for (let column = 0; column <= columns; column++) {
        for (let row = 0; row <= columns; row++) {
            const onAxis = column === TONE_STEPS || row === TONE_STEPS;
            dots.push(
                <View key={`${column}-${row}`} style={[styles.dot, {
                    left: PUCK_RADIUS + (usableWidth * column) / columns - DOT_RADIUS,
                    top: PUCK_RADIUS + (usableHeight * row) / columns - DOT_RADIUS,
                    backgroundColor: c.onSurfaceVariant, opacity: onAxis ? 0.55 : 0.3,
                }]} />,
            );
        }
    }
    const puckLeft = PUCK_RADIUS + (usableWidth * (x + TONE_STEPS)) / columns - PUCK_RADIUS;
    const puckTop = PUCK_RADIUS + (usableHeight * (TONE_STEPS - y)) / columns - PUCK_RADIUS;

    return (
        <View
            style={styles.pad}
            onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout)}
            onStartShouldSetResponder={() => enabled}
            onMoveShouldSetResponder={() => enabled}
            onResponderTerminationRequest={() => false}
            onResponderGrant={report}
            onResponderMove={report}
            accessibilityLabel={`Tone pad, tilt ${signed(x)}, contour ${signed(y)}`}
        >
            {size.width > 0 && dots}
            {size.width > 0 && <View pointerEvents="none" style={[styles.puck, { left: puckLeft, top: puckTop, backgroundColor: c.background }]} />}
        </View>
    );
}

function BandFader({ hz, value, enabled, onChange, c }: { hz: number; value: number; enabled: boolean; onChange: (db: number) => void; c: GXColors }) {
    const usable = FADER_HEIGHT - KNOB_RADIUS * 2;
    const toDb = (y: number) => snapGain(((usable / 2 - (y - KNOB_RADIUS)) / (usable / 2)) * MANUAL_RANGE_DB);
    const knobTop = KNOB_RADIUS + (usable / 2) * (1 - value / MANUAL_RANGE_DB) - KNOB_RADIUS;
    const centre = KNOB_RADIUS + usable / 2;
    const handle = (event: GestureResponderEvent) => onChange(toDb(event.nativeEvent.locationY));
    return (
        <View style={styles.faderColumn}>
            <Text style={[GX_TYPE.labelSmall, { color: c.onSurfaceVariant }]}>{formatGain(value)}</Text>
            <View
                style={styles.fader}
                onStartShouldSetResponder={() => enabled}
                onMoveShouldSetResponder={() => enabled}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handle}
                onResponderMove={handle}
                accessibilityLabel={`${formatFrequency(hz)} hertz, ${formatGain(value)} decibels`}
            >
                <View pointerEvents="none" style={[styles.track, { backgroundColor: c.outline }]} />
                <View pointerEvents="none" style={[styles.trackFill, {
                    backgroundColor: c.primary,
                    top: Math.min(centre, knobTop + KNOB_RADIUS),
                    height: Math.abs(knobTop + KNOB_RADIUS - centre),
                }]} />
                <View pointerEvents="none" style={[styles.knob, { top: knobTop, backgroundColor: c.primary }]} />
            </View>
            <Text style={[GX_TYPE.labelSmall, { color: c.onSurfaceVariant }]}>{formatFrequency(hz)}</Text>
        </View>
    );
}

function BalanceControl({ balance, enabled, onChange, c }: { balance: number; enabled: boolean; onChange: (b: number) => void; c: GXColors }) {
    const [width, setWidth] = useState(0);
    const handle = (event: GestureResponderEvent) => {
        if (!width) return;
        const raw = Math.max(-1, Math.min(1, (event.nativeEvent.locationX / width) * 2 - 1));
        onChange(Math.abs(raw) < BALANCE_DETENT ? 0 : Math.round(raw * 100) / 100);
    };
    const thumb = ((balance + 1) / 2) * width;
    return (
        <View style={styles.balanceBox}>
            <View style={styles.balanceLabels}>
                <Text style={[GX_TYPE.bodyLarge, { color: c.onBackground }]}>L</Text>
                <Text style={[GX_TYPE.bodyLarge, { color: c.onSurfaceVariant }]}>{balance.toFixed(2)}</Text>
                <Text style={[GX_TYPE.bodyLarge, { color: c.onBackground }]}>R</Text>
            </View>
            <View
                style={styles.balanceTrackArea}
                onLayout={e => setWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => enabled}
                onMoveShouldSetResponder={() => enabled}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handle}
                onResponderMove={handle}
                accessibilityLabel={`Balance ${Math.round(balance * 100)}`}
            >
                <View pointerEvents="none" style={[styles.balanceTrack, { backgroundColor: c.outline }]} />
                <View pointerEvents="none" style={[styles.balanceCentre, { backgroundColor: c.onSurfaceVariant, left: width / 2 - 1 }]} />
                {width > 0 && <View pointerEvents="none" style={[styles.balanceThumb, { left: thumb - KNOB_RADIUS, backgroundColor: c.primary }]} />}
            </View>
        </View>
    );
}

export default function EqualizerScreen({ navigation }: any) {
    const { colors, theme } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const [eq, setEq] = useState<EqualizerSettings>(DEFAULT_EQUALIZER);
    const [pickingPreset, setPickingPreset] = useState(false);

    useFocusEffect(useCallback(() => { getEqualizer().then(setEq); }, []));

    const update = (patch: Partial<EqualizerSettings>) => {
        setEq(current => {
            const next = { ...current, ...patch };
            void saveEqualizer(next);
            return next;
        });
    };

    const setBand = (index: number, db: number) => {
        const bands = eq.bands.slice();
        bands[index] = db;
        update({ bands, preset: matchingPreset(bands) });
    };

    const setPreset = (preset: EqualizerPreset) => {
        if (preset === 'CUSTOM') return;
        update({ preset, bands: [...EQUALIZER_PRESETS[preset]] });
    };

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <BackBar />

                <Group footer="Shapes the sound inside Groovix, before it reaches the system." c={c} top={30}>
                    <SwitchRow icon="options" title="Equalizer" value={eq.enabled} onChange={enabled => update({ enabled })} c={c} />
                </Group>

                <View style={{ opacity: eq.enabled ? 1 : 0.38 }} pointerEvents={eq.enabled ? 'auto' : 'none'}>
                    <View style={styles.modeControl}>
                        <SegmentedControl options={['Dynamic', 'Manual']} selected={eq.mode === 'MANUAL' ? 1 : 0} onSelect={i => update({ mode: i === 1 ? 'MANUAL' : 'DYNAMIC' })} c={c} />
                    </View>

                    {eq.mode === 'DYNAMIC' ? (
                        <Group
                            header="Tone"
                            footer={eq.focused
                                ? 'Drag left for a warmer sound and right for a brighter one; down scoops the middle, up brings it forward. Focused works on narrower stretches, so it changes less around what it moves.'
                                : 'Drag left for a warmer sound and right for a brighter one; down scoops the middle, up brings it forward. Broad moves wide stretches of the spectrum at once.'}
                            c={c}
                        >
                            <TonePad x={eq.toneX} y={eq.toneY} enabled={eq.enabled} onChange={(toneX, toneY) => update({ toneX, toneY })} c={c} />
                            <View style={styles.readout}>
                                <MaterialCommunityIcons name="waves" size={22} color={c.onBackground} />
                                <Text style={[GX_TYPE.bodyLarge, styles.readoutValue, { color: c.onBackground }]}>{signed(eq.toneX)}</Text>
                                <MaterialCommunityIcons name="chart-line-variant" size={22} color={c.onBackground} />
                                <Text style={[GX_TYPE.bodyLarge, styles.readoutValue, { color: c.onBackground }]}>{signed(eq.toneY)}</Text>
                            </View>
                            <Divider c={c} />
                            <SettingsRow title="Broad" onPress={() => update({ focused: false })} trailing={!eq.focused ? <Ionicons name="checkmark" size={22} color={c.primary} /> : <View />} c={c} />
                            <Divider c={c} />
                            <SettingsRow title="Focused" onPress={() => update({ focused: true })} trailing={eq.focused ? <Ionicons name="checkmark" size={22} color={c.primary} /> : <View />} c={c} />
                        </Group>
                    ) : (
                        <>
                            <Group c={c}>
                                <SettingsRow icon="bar-chart" title="Preset" value={PRESET_LABELS[eq.preset]} onPress={() => setPickingPreset(true)} c={c} />
                            </Group>
                            <Group header="Bands" footer="Moving a band leaves the preset behind and the curve becomes your own." c={c}>
                                <View style={styles.faders}>
                                    {MANUAL_BANDS_HZ.map((hz, index) => (
                                        <BandFader key={hz} hz={hz} value={eq.bands[index] ?? 0} enabled={eq.enabled} onChange={db => setBand(index, db)} c={c} />
                                    ))}
                                </View>
                                <Divider c={c} />
                                <TouchableOpacity style={styles.destructive} onPress={() => setPreset('FLAT')} accessibilityRole="button">
                                    <Text style={[GX_TYPE.bodyLarge, { color: c.primary }]}>Reset all bands</Text>
                                </TouchableOpacity>
                            </Group>
                        </>
                    )}

                    <Group header="Balance" footer="Shifts the sound towards one ear by quietening the other." c={c}>
                        <BalanceControl balance={eq.balance} enabled={eq.enabled} onChange={balance => update({ balance })} c={c} />
                    </Group>
                </View>

                <Group footer="Runs after Groovix's, on the whole audio session. Using both applies both." c={c}>
                    <SettingsRow title="System equalizer" leading={<MaterialCommunityIcons name="waveform" size={24} color={c.onBackground} />} subtitle="Your device's own panel" onPress={openSystemEqualizer} c={c} />
                </Group>
            </ScrollView>

            <DraggableBottomSheet visible={pickingPreset} onClose={() => setPickingPreset(false)} sheetStyle={[styles.sheet, { backgroundColor: c.background }]} backdropLabel="Close presets" dragActivationHeight={80}>
                <Text style={[GX_TYPE.titleLarge, styles.sheetTitle, { color: c.onBackground }]}>Preset</Text>
                <ScrollView style={styles.flex}>
                    <View style={[styles.group, { backgroundColor: c.surfaceVariant }]}>
                        {(Object.keys(EQUALIZER_PRESETS) as EqualizerPreset[]).map((preset, index, all) => (
                            <View key={preset}>
                                <SettingsRow
                                    title={PRESET_LABELS[preset]}
                                    onPress={() => { setPreset(preset); setPickingPreset(false); }}
                                    trailing={eq.preset === preset ? <Ionicons name="checkmark" size={22} color={c.primary} /> : <View />}
                                    c={c}
                                />
                                {index < all.length - 1 && <Divider c={c} />}
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </DraggableBottomSheet>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    content: { paddingBottom: 160 },
    title: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
    groupHeader: { marginLeft: GROUP_INSET + 4, marginRight: GROUP_INSET, marginTop: 26, marginBottom: 8 },
    group: { marginHorizontal: GROUP_INSET, borderRadius: 14, overflow: 'hidden' },
    groupFooter: { marginHorizontal: GROUP_INSET + 4, marginTop: 8 },
    divider: { height: 0.5, marginLeft: ROW_INSET },
    modeControl: { paddingHorizontal: GROUP_INSET, marginTop: 18 },
    pad: { height: PAD_HEIGHT, marginHorizontal: ROW_INSET, marginVertical: 18 },
    dot: { position: 'absolute', width: DOT_RADIUS * 2, height: DOT_RADIUS * 2, borderRadius: DOT_RADIUS },
    puck: {
        position: 'absolute', width: PUCK_RADIUS * 2, height: PUCK_RADIUS * 2, borderRadius: PUCK_RADIUS,
        shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
    },
    readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 14 },
    readoutValue: { marginLeft: 8, marginRight: 22 },
    faders: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: ROW_INSET, paddingVertical: 16 },
    faderColumn: { alignItems: 'center', gap: 8 },
    fader: { width: FADER_WIDTH, height: FADER_HEIGHT, alignItems: 'center' },
    track: { position: 'absolute', top: KNOB_RADIUS, bottom: KNOB_RADIUS, width: TRACK_WIDTH, borderRadius: TRACK_WIDTH / 2 },
    trackFill: { position: 'absolute', width: TRACK_WIDTH, borderRadius: TRACK_WIDTH / 2 },
    knob: { position: 'absolute', width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2, borderRadius: KNOB_RADIUS },
    destructive: { paddingVertical: 15, alignItems: 'center' },
    balanceBox: { paddingHorizontal: ROW_INSET, paddingTop: 14, paddingBottom: 18 },
    balanceLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    balanceTrackArea: { marginHorizontal: 20, height: 32, justifyContent: 'center' },
    balanceTrack: { height: TRACK_WIDTH, borderRadius: TRACK_WIDTH / 2 },
    balanceCentre: { position: 'absolute', width: 2, height: 12, top: 10 },
    balanceThumb: { position: 'absolute', width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2, borderRadius: KNOB_RADIUS, top: 6 },
    sheet: { height: '78%', paddingHorizontal: 0, paddingBottom: 24 },
    sheetTitle: { paddingHorizontal: 20, paddingBottom: 12 },
});
