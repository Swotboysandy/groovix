import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Mask, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../theme';

const { width } = Dimensions.get('window');
const WORDMARK = 'PRΛCΛNDY';
const WORDMARK_FONT = 34;
const LETTER_SPACING = WORDMARK_FONT * 0.18;
const WORDMARK_HEIGHT = WORDMARK_FONT * 2;
const SHINE_WIDTH = width * 0.55;
const AnimatedRect = Animated.createAnimatedComponent(Rect);

interface Props {
    onFinish: () => void;
}

/** A short, deterministic brand handoff: Pracandy shimmer, then Groovix text. */
export default function BrandIntro({ onFinish }: Props) {
    const pracandyOpacity = useRef(new Animated.Value(0)).current;
    const groovixOpacity = useRef(new Animated.Value(0)).current;
    const shine = useRef(new Animated.Value(0)).current;
    const finished = useRef(false);
    const onFinishRef = useRef(onFinish);

    useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

    useEffect(() => {
        const finish = () => {
            if (finished.current) return;
            finished.current = true;
            onFinishRef.current();
        };

        const shimmer = Animated.loop(Animated.timing(shine, {
            toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        }));

        Animated.timing(pracandyOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => shimmer.start());

        const transition = setTimeout(() => {
            shimmer.stop();
            Animated.parallel([
                Animated.timing(pracandyOpacity, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
                Animated.timing(groovixOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            ]).start();
        }, 1800);

        const done = setTimeout(() => {
            Animated.timing(groovixOpacity, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(finish);
        }, 3600);

        return () => {
            shimmer.stop();
            clearTimeout(transition);
            clearTimeout(done);
        };
    }, [groovixOpacity, pracandyOpacity, shine]);

    const textProps = {
        x: width / 2 - LETTER_SPACING * 0.8,
        y: WORDMARK_HEIGHT / 2 + WORDMARK_FONT * 0.34,
        fontSize: WORDMARK_FONT,
        fontWeight: '600' as const,
        letterSpacing: LETTER_SPACING,
        textAnchor: 'middle' as const,
    };
    const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-SHINE_WIDTH, width] });

    return (
        <View style={styles.container} accessibilityLabel="Groovix intro">
            <Animated.View style={[styles.brandLayer, styles.wordmark, { opacity: pracandyOpacity }]}>
                    <Svg width={width} height={WORDMARK_HEIGHT}>
                        <Defs>
                            <LinearGradient id="pracandySilver" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0" stopColor="#FFFFFF" />
                                <Stop offset="0.35" stopColor="#EEF0F4" />
                                <Stop offset="0.6" stopColor="#B9BCC6" />
                                <Stop offset="1" stopColor="#7D808C" />
                            </LinearGradient>
                            <LinearGradient id="pracandyGlint" x1="0" y1="0" x2="1" y2="0">
                                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.95" />
                                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                            </LinearGradient>
                            <Mask id="pracandyLetters">
                                <SvgText {...textProps} fill="#FFFFFF">{WORDMARK}</SvgText>
                            </Mask>
                        </Defs>
                        <SvgText {...textProps} fill="url(#pracandySilver)">{WORDMARK}</SvgText>
                        <G mask="url(#pracandyLetters)">
                            <AnimatedRect x={shineX} y={0} width={SHINE_WIDTH} height={WORDMARK_HEIGHT} fill="url(#pracandyGlint)" />
                        </G>
                    </Svg>
            </Animated.View>

            <Animated.View style={[styles.brandLayer, { opacity: groovixOpacity }]}>
                <Text style={styles.groovixText}>GROOVIX</Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    wordmark: {
        width,
        height: WORDMARK_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    brandLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
    groovixText: {
        color: COLORS.text,
        fontSize: 42,
        fontFamily: 'Inter-Bold',
        letterSpacing: 7,
        textAlign: 'center',
    },
});
