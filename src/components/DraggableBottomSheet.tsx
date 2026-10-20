import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Modal,
    StyleProp,
    StyleSheet,
    TouchableWithoutFeedback,
    useWindowDimensions,
    View,
    ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    cancelAnimation,
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    sheetStyle?: StyleProp<ViewStyle>;
    backdropLabel?: string;
    dragActivationHeight?: number;
};

const SHEET_SPRING = { damping: 30, stiffness: 420, mass: 0.78, overshootClamping: true };
const DISMISS_DURATION = 190;

/** A shared bottom sheet whose handle follows the finger and dismisses by distance or velocity. */
export default function DraggableBottomSheet({
    visible,
    onClose,
    children,
    sheetStyle,
    backdropLabel = 'Close drawer',
    dragActivationHeight = 58,
}: Props) {
    const { height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const translateY = useSharedValue(height);
    const dragStartY = useSharedValue(0);
    const touchStartX = useSharedValue(0);
    const touchStartY = useSharedValue(0);
    const onCloseRef = useRef(onClose);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    onCloseRef.current = onClose;
    const finishClose = useCallback(() => onCloseRef.current(), []);
    const scheduleClose = useCallback(() => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(finishClose, reduceMotion ? 0 : DISMISS_DURATION);
    }, [finishClose, reduceMotion]);

    useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    useEffect(() => {
        if (!visible) return;
        translateY.value = reduceMotion ? 0 : height;
        if (!reduceMotion) translateY.value = withSpring(0, SHEET_SPRING);
    }, [height, reduceMotion, translateY, visible]);

    const close = useCallback(() => {
        if (reduceMotion) {
            finishClose();
            return;
        }
        scheduleClose();
        translateY.value = withTiming(
            height,
            { duration: DISMISS_DURATION, easing: Easing.out(Easing.cubic) },
        );
    }, [finishClose, height, reduceMotion, scheduleClose, translateY]);

    const dragGesture = useMemo(() => Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown(event => {
            'worklet';
            const touch = event.allTouches[0];
            touchStartX.value = touch?.x ?? 0;
            touchStartY.value = touch?.y ?? 999;
        })
        .onTouchesMove((event, manager) => {
            'worklet';
            const touch = event.allTouches[0];
            if (!touch) return;
            const dx = touch.x - touchStartX.value;
            const dy = touch.y - touchStartY.value;
            if (Math.abs(dy) < 5 && Math.abs(dx) < 5) return;
            if (touchStartY.value <= dragActivationHeight && Math.abs(dy) > Math.abs(dx)) manager.activate();
            else manager.fail();
        })
        .onStart(() => {
            'worklet';
            // Match the Lyrics drawer: the previous open/snap spring must stop before
            // the finger takes control, otherwise the sheet tugs against the drag.
            cancelAnimation(translateY);
            dragStartY.value = translateY.value;
        })
        .onUpdate(event => {
            'worklet';
            const next = dragStartY.value + event.translationY;
            translateY.value = next < 0 ? next * 0.08 : Math.min(height, next);
        })
        .onEnd(event => {
            'worklet';
            const currentY = Math.max(0, translateY.value);
            const projectedY = currentY + Math.max(0, event.velocityY) * 0.18;
            const shouldClose = event.velocityY > 720 || projectedY > height * 0.22;
            if (shouldClose) {
                runOnJS(scheduleClose)();
                translateY.value = withTiming(
                    height,
                    { duration: DISMISS_DURATION, easing: Easing.out(Easing.cubic) },
                );
            } else {
                translateY.value = withSpring(0, SHEET_SPRING);
            }
        }), [dragActivationHeight, dragStartY, height, scheduleClose, touchStartX, touchStartY, translateY]);

    const sheetAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    const backdropAnimatedStyle = useAnimatedStyle(() => ({
        opacity: reduceMotion
            ? 1
            : interpolate(translateY.value, [0, height * 0.55], [1, 0], Extrapolation.CLAMP),
    }));

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={close}
        >
            <GestureHandlerRootView style={styles.root} accessibilityViewIsModal>
                <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}>
                    <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel={backdropLabel}>
                        <View style={StyleSheet.absoluteFill} />
                    </TouchableWithoutFeedback>
                </Animated.View>
                <GestureDetector gesture={dragGesture}>
                    <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }, sheetStyle, sheetAnimatedStyle]}>
                        <View style={styles.dragArea} accessible accessibilityLabel="Drag drawer down to close">
                            <View style={styles.handle} />
                        </View>
                        {children}
                    </Animated.View>
                </GestureDetector>
            </GestureHandlerRootView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.58)' },
    sheet: {
        backgroundColor: '#17181B',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
    },
    dragArea: { height: 46, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.38)' },
});
