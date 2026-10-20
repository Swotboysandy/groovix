// top-right glass controls: a 56dp profile circle, optionally sharing
// a capsule with a history button (Library). The profile circle opens Settings,
// which is where account sheet lives.
import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { PAGE_GUTTER } from '../theme/groovix';

const GLASS = 'rgba(28,28,30,0.92)';
const EDGE = 'rgba(255,255,255,0.10)';

/** 56dp glass back circle, shared by every pushed page. */
export function BackCircle({ style }: { style?: StyleProp<ViewStyle> }) {
    const navigation = useNavigation<any>();
    return (
        <TouchableOpacity style={[glassStyles.circle, style]} activeOpacity={0.8} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
    );
}

/** Top row of a pushed page: back circle on the left, anything on the right. */
export function BackBar({ right, style }: { right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    return (
        <View style={[glassStyles.backBar, style]}>
            <BackCircle />
            {right}
        </View>
    );
}

export function ProfileCircle({ style }: { style?: StyleProp<ViewStyle> }) {
    const navigation = useNavigation<any>();
    return (
        <TouchableOpacity
            style={[glassStyles.circle, style]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Library', { screen: 'Settings' })}
            accessibilityRole="button"
            accessibilityLabel="Account and settings"
        >
            <View style={styles.avatar}>
                <Ionicons name="person" size={20} color="rgba(255,255,255,0.75)" />
            </View>
        </TouchableOpacity>
    );
}

export default function GlassHeader({ onHistory }: { onHistory?: () => void }) {
    return (
        <View style={styles.row}>
            {onHistory ? (
                <View style={[glassStyles.capsule, styles.libraryCapsule]}>
                    <TouchableOpacity style={styles.capsuleButton} onPress={onHistory} accessibilityRole="button" accessibilityLabel="History">
                        <MaterialCommunityIcons name="history" size={30} color="#FFFFFF" />
                    </TouchableOpacity>
                    <ProfileCircle style={styles.inCapsule} />
                </View>
            ) : (
                <ProfileCircle />
            )}
        </View>
    );
}

/** Global glass styles: use these instead of per-screen copies. */
export const glassStyles = StyleSheet.create({
    circle: { width: 56, height: 56, borderRadius: 28, backgroundColor: GLASS, borderWidth: 0.5, borderColor: EDGE, alignItems: 'center', justifyContent: 'center' },
    capsule: { flexDirection: 'row', alignItems: 'center', height: 56, borderRadius: 28, backgroundColor: GLASS, borderWidth: 0.5, borderColor: EDGE, paddingHorizontal: 8 },
    capsuleButton: { width: 52, height: 48, alignItems: 'center', justifyContent: 'center' },
    capsuleAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
    backBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingTop: 6 },
});

const styles = StyleSheet.create({
    row: { alignItems: 'flex-end', paddingHorizontal: PAGE_GUTTER, paddingTop: 4 },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
    libraryCapsule: { paddingLeft: 10, paddingRight: 0 },
    capsuleButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
    inCapsule: { backgroundColor: 'transparent', borderWidth: 0 },
});
