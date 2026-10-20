import React, { useRef } from 'react';
import { Pressable, PressableProps, ViewStyle, StyleProp } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TouchableScaleProps extends PressableProps {
    children: React.ReactNode;
    activeScale?: number;
    style?: StyleProp<ViewStyle>;
    activeOpacity?: number;
    pressOnTouchDown?: boolean;
}

export default function TouchableScale({
    children,
    activeScale = 0.96,
    style,
    activeOpacity: _activeOpacity,
    pressOnTouchDown = false,
    ...props
}: TouchableScaleProps) {
    const scale = useSharedValue(1);
    const handledOnTouchDown = useRef(false);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
        opacity: 0.94 + (scale.value - 0.9) * 0.6,
    }));

    return (
        <AnimatedPressable
            {...props}
            onPressIn={(e) => {
                scale.value = withTiming(activeScale, { duration: 35 });
                if (props.onPressIn) props.onPressIn(e);
                if (pressOnTouchDown) {
                    handledOnTouchDown.current = true;
                    props.onPress?.(e);
                }
            }}
            onPressOut={(e) => {
                scale.value = withTiming(1, { duration: 75 });
                if (props.onPressOut) props.onPressOut(e);
                // Pressable emits onPressOut immediately before onPress. Clear on the
                // next tick so the release event is ignored without breaking keyboard
                // or accessibility-triggered onPress events.
                if (pressOnTouchDown) {
                    setTimeout(() => {
                        handledOnTouchDown.current = false;
                    }, 0);
                }
            }}
            onPress={(e) => {
                if (pressOnTouchDown && handledOnTouchDown.current) return;
                props.onPress?.(e);
            }}
            style={[style, animatedStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}
