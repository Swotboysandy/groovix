import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useTheme } from './ThemeContext';

export type DialogAction = {
    text: string;
    onPress?: () => void | Promise<void>;
    tone?: 'primary' | 'neutral' | 'destructive';
};

export type DialogOptions = {
    title: string;
    message?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    actions?: DialogAction[];
};

type DialogContextValue = { showDialog: (options: DialogOptions) => void };
const DialogContext = createContext<DialogContextValue>({ showDialog: () => undefined });

export function useAppDialog() { return useContext(DialogContext); }

export function DialogProvider({ children }: { children: React.ReactNode }) {
    const { colors } = useTheme();
    const reduceMotion = useReducedMotion();
    const [dialog, setDialog] = useState<DialogOptions | null>(null);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.96);

    const showDialog = useCallback((options: DialogOptions) => setDialog(options), []);

    useEffect(() => {
        if (!dialog) return;
        opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) });
        scale.value = reduceMotion ? 1 : withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) });
    }, [dialog, opacity, reduceMotion, scale]);

    const dismiss = useCallback((action?: DialogAction) => {
        const finish = () => {
            setDialog(null);
            void action?.onPress?.();
        };
        if (reduceMotion) { finish(); return; }
        opacity.value = withTiming(0, { duration: 140 });
        scale.value = withTiming(0.97, { duration: 140 }, finished => {
            if (finished) runOnJS(finish)();
        });
    }, [opacity, reduceMotion, scale]);

    const animatedBackdrop = useAnimatedStyle(() => ({ opacity: opacity.value }));
    const animatedCard = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
    const actions = dialog?.actions?.length ? dialog.actions : [{ text: 'OK', tone: 'primary' as const }];

    return (
        <DialogContext.Provider value={{ showDialog }}>
            {children}
            <Modal visible={!!dialog} transparent animationType="none" statusBarTranslucent onRequestClose={() => dismiss()}>
                <View style={styles.root} accessibilityViewIsModal>
                    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, animatedBackdrop]} />
                    {dialog && (
                        <Animated.View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, animatedCard]}>
                            <View style={[styles.icon, { backgroundColor: colors.surfaceActive }]}>
                                <Ionicons name={dialog.icon || 'musical-notes-outline'} size={24} color={colors.primary} />
                            </View>
                            <Text style={[styles.title, { color: colors.text }]}>{dialog.title}</Text>
                            {!!dialog.message && <Text style={[styles.message, { color: colors.textMuted }]}>{dialog.message}</Text>}
                            <View style={styles.actions}>
                                {actions.map((action, index) => {
                                    const primary = action.tone === 'primary' || (actions.length === 1 && action.tone !== 'destructive');
                                    const destructive = action.tone === 'destructive';
                                    return (
                                        <TouchableOpacity
                                            key={`${action.text}-${index}`}
                                            style={[
                                                styles.action,
                                                { borderColor: colors.border, backgroundColor: colors.surfaceHover },
                                                primary && { backgroundColor: colors.primary },
                                                destructive && styles.destructiveAction,
                                            ]}
                                            onPress={() => dismiss(action)}
                                            activeOpacity={0.78}
                                            accessibilityRole="button"
                                            accessibilityLabel={action.text}
                                        >
                                            <Text style={[
                                                styles.actionText,
                                                { color: colors.text },
                                                primary && { color: colors.background },
                                                destructive && styles.destructiveText,
                                            ]}>{action.text}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </Animated.View>
                    )}
                </View>
            </Modal>
        </DialogContext.Provider>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.62)' },
    card: { width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 22 },
    icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
    title: { fontFamily: 'Inter-Bold', fontSize: 20, lineHeight: 26 },
    message: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 20, marginTop: 7 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
    action: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    actionText: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
    destructiveAction: { backgroundColor: 'rgba(250,45,72,0.12)', borderColor: 'rgba(250,45,72,0.28)' },
    destructiveText: { color: '#FA2D48' },
});
