import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

export default function SkeletonPulse({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    const opacity = useSharedValue(1);
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        if (reduceMotion) {
            opacity.value = 1;
            return;
        }
        opacity.value = withRepeat(
            withTiming(0.48, { duration: 720, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
        return () => cancelAnimation(opacity);
    }, [opacity, reduceMotion]);

    const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
