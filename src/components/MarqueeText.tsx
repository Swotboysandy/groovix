import React, { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

const GAP = 48;
const SPEED = 30; // px per second
const PAUSE_MS = 1600;

/**
 * One line of text that, when it is wider than `width`, waits a moment and then
 * scrolls left in a loop (a gap, then the next copy). Text that fits stays
 * still, and so does everything while `active` is off (the mini player).
 * `animatedStyle` (colour, size) is applied to the visible text; `measureStyle`
 * is the size the text has while it scrolls, used to measure it.
 */
export default function MarqueeText({ text, style, animatedStyle, measureStyle, width, active }: {
    text: string;
    style?: StyleProp<TextStyle>;
    animatedStyle?: any;
    measureStyle?: StyleProp<TextStyle>;
    width: number;
    active: boolean;
}) {
    const [textWidth, setTextWidth] = useState(0);
    const offset = useSharedValue(0);
    const scrolls = active && textWidth > width + 1;

    useEffect(() => {
        cancelAnimation(offset);
        offset.value = 0;
        if (!scrolls) return;
        const distance = textWidth + GAP;
        offset.value = withRepeat(withSequence(
            withDelay(PAUSE_MS, withTiming(-distance, { duration: (distance / SPEED) * 1000, easing: Easing.linear })),
            withTiming(0, { duration: 0 }),
        ), -1);
        return () => cancelAnimation(offset);
    }, [scrolls, textWidth, text, offset]);

    const moving = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

    return (
        <View>
            {/* Measured at its natural width, invisibly. */}
            <View style={styles.measure} pointerEvents="none">
                <Animated.Text style={[style, measureStyle]} numberOfLines={1} onLayout={e => setTextWidth(e.nativeEvent.layout.width)}>{text}</Animated.Text>
            </View>
            {scrolls ? (
                <View style={[styles.clip, { width }]}>
                    <Animated.View style={[styles.row, moving]}>
                        <Animated.Text style={[style, animatedStyle, styles.free]} numberOfLines={1}>{text}</Animated.Text>
                        <Animated.Text style={[style, animatedStyle, styles.free, { marginLeft: GAP }]} numberOfLines={1}>{text}</Animated.Text>
                    </Animated.View>
                </View>
            ) : (
                <Animated.Text style={[style, animatedStyle]} numberOfLines={1}>{text}</Animated.Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    measure: { position: 'absolute', opacity: 0, left: 0, top: 0, width: 4000, flexDirection: 'row', alignItems: 'flex-start' },
    clip: { overflow: 'hidden' },
    row: { flexDirection: 'row', width: 8000 },
    // The scrolling copies keep their own width, not the box's.
    free: { width: undefined, maxWidth: undefined },
});
