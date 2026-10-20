// FloatingBottomBar: a floating pill with a sliding,
// stretching selection pill behind the tabs.
import { haptic } from '../services/haptics';
import React, { useEffect, useState } from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { GX_TYPE, PAGE_GUTTER } from '../theme/groovix';

const PILL_INSET = 6;
const GAP = 6;
const STRETCH = 0.12;
const SQUASH = 0.5;
const GLASS_SPRING = { damping: 18, stiffness: 220, mass: 0.7 };

export const FLOATING_TAB_BAR_HEIGHT = 96;

type Props = BottomTabBarProps & {
    light: boolean;
    artwork?: string;
    icons: Record<string, [string, string]>;
    /** Routes kept in the navigator but not shown on the bar. */
    hidden?: string[];
};

export default function FloatingTabBar({ state, descriptors, navigation, light, artwork, icons, hidden = [] }: Props) {
    const [rowWidth, setRowWidth] = useState(0);
    const visible = state.routes.filter(route => !hidden.includes(route.name));
    const n = visible.length;
    const selected = visible.findIndex(route => route.key === state.routes[state.index].key);
    const tabWidth = rowWidth > 0 ? (rowWidth - GAP * (n - 1)) / n : 0;
    const step = rowWidth > 0 ? (rowWidth + GAP) / n : 0;
    const offset = useSharedValue(0);
    const target = useSharedValue(0);

    useEffect(() => {
        target.value = Math.max(0, selected) * step;
        offset.value = withSpring(Math.max(0, selected) * step, GLASS_SPRING);
    }, [selected, step, offset, target]);

    const pillStyle = useAnimatedStyle(() => {
        const lag = step > 0 ? Math.min(1, Math.abs(target.value - offset.value) / step) : 0;
        return {
            transform: [
                { translateX: offset.value },
                { scaleX: 1 + lag * STRETCH },
                { scaleY: 1 - lag * STRETCH * SQUASH },
            ],
        };
    });

    const content = light ? '#000000' : '#FFFFFF';
    const unselected = light ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.65)';

    return (
        <View style={styles.wrap} pointerEvents="box-none">
            <View style={[styles.bar, { borderColor: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)' }]}>
                {artwork ? <ImageBackground source={{ uri: artwork }} blurRadius={28} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: light ? 'rgba(247,247,249,0.82)' : 'rgba(28,28,30,0.88)' }]} />
                <View style={styles.row} onLayout={e => setRowWidth(e.nativeEvent.layout.width)}>
                    {tabWidth > 0 && selected >= 0 && (
                        <Animated.View
                            pointerEvents="none"
                            style={[styles.selection, { width: tabWidth, backgroundColor: light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)' }, pillStyle]}
                        />
                    )}
                    {visible.map((route, index) => {
                        const focused = selected === index;
                        const { options } = descriptors[route.key];
                        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
                        const [on, off] = icons[route.name] ?? ['ellipse', 'ellipse-outline'];
                        const color = focused ? content : unselected;
                        const onPress = () => {
                            haptic('select');
                            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
                        };
                        return (
                            <Pressable
                                key={route.key}
                                onPress={onPress}
                                style={styles.tab}
                                accessibilityRole="button"
                                accessibilityState={focused ? { selected: true } : {}}
                                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                            >
                                <Ionicons name={focused ? on : off} size={25} color={color} />
                                <Text style={[GX_TYPE.labelSmall, styles.label, { color }]} numberOfLines={1}>{label}</Text>
                                {options.tabBarBadge != null && <View style={styles.badge} />}
                            </Pressable>
                        );
                    })}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOATING_TAB_BAR_HEIGHT, justifyContent: 'flex-end', paddingBottom: 14, paddingHorizontal: PAGE_GUTTER },
    bar: { borderRadius: 999, overflow: 'hidden', borderWidth: 0.5, padding: PILL_INSET },
    row: { flexDirection: 'row', gap: GAP },
    selection: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, gap: 2 },
    label: {},
    badge: { position: 'absolute', top: 4, right: '30%', width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
});
