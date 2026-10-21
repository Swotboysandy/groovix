import React, { useEffect, useState } from 'react';
import {
    View, Text, Modal, TouchableOpacity, StyleSheet, NativeModules,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '../services/updater';
import { useAppDialog } from '../context/DialogContext';
import { useTheme } from '../context/ThemeContext';

const NOTIFIED_KEY = 'groovix:update-notified';
const RECHECK_MS = 6 * 60 * 60 * 1000;

/** The first plain sentence of the release notes, for the notification text. */
function firstLine(notes?: string): string {
    const line = (notes || '').split('\n').map(text => text.replace(/^[#*\-\s]+/, '').replace(/\*\*/g, '').trim()).find(text => text && !/^what's new$/i.test(text));
    return line ? line.slice(0, 140) : 'Tap to update to the latest version.';
}

export default function UpdatePrompt() {
    const { showDialog } = useAppDialog();
    const { colors } = useTheme();
    const [update, setUpdate] = useState<UpdateInfo | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let active = true;
        const check = async () => {
            const info = await checkForUpdate().catch(() => null);
            if (!active || !info) return;
            setUpdate(info);
            // One shade notification per new version, so it isn't repeated every check.
            const notified = await AsyncStorage.getItem(NOTIFIED_KEY).catch(() => null);
            if (notified !== info.version) {
                NativeModules.ApkInstaller?.notifyUpdate?.(info.version, firstLine(info.notes));
                await AsyncStorage.setItem(NOTIFIED_KEY, info.version).catch(() => {});
            }
        };
        // Let the first frame render, then check; again every few hours while
        // the app stays alive (music playing in the background, for example).
        const first = setTimeout(check, 500);
        const repeat = setInterval(check, RECHECK_MS);
        return () => { active = false; clearTimeout(first); clearInterval(repeat); };
    }, []);

    const handleUpdate = async () => {
        if (!update) return;
        setDownloading(true);
        setProgress(0);
        try {
            await downloadAndInstall(update.apkUrl, setProgress);
            // After the installer opens, leave the modal up; the OS takes over.
        } catch (e: any) {
            setDownloading(false);
            showDialog({ title: 'Update failed', message: e?.message || 'Could not download the update.', icon: 'cloud-offline-outline' });
        }
    };

    if (!update) return null;

    return (
        <Modal visible transparent animationType="fade" statusBarTranslucent>
            <View style={styles.backdrop}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.iconWrap, { backgroundColor: colors.surfaceActive }]}>
                        <Ionicons name="rocket-outline" size={30} color={colors.primary} />
                    </View>

                    <Text style={[styles.title, { color: colors.text }]}>Update available</Text>
                    <Text style={[styles.version, { color: colors.primary }]}>Version {update.version}</Text>

                    {update.notes ? (
                        <Text style={[styles.notes, { color: colors.textMuted }]} numberOfLines={5}>{update.notes}</Text>
                    ) : null}

                    {downloading ? (
                        <View style={styles.progressWrap}>
                            <View style={[styles.progressTrack, { backgroundColor: colors.divider }]}>
                                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` }]} />
                            </View>
                            <Text style={[styles.progressText, { color: colors.textMuted }]}>
                                {progress >= 1 ? 'Opening installer…' : `Downloading ${Math.round(progress * 100)}%`}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={[styles.laterBtn, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}
                                onPress={() => setUpdate(null)}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.laterText, { color: colors.text }]}>Later</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.updateBtn, { backgroundColor: colors.primary }]}
                                onPress={handleUpdate}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="download-outline" size={18} color={colors.background} />
                                <Text style={[styles.updateText, { color: colors.background }]}>Update now</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
        alignItems: 'center', justifyContent: 'center', padding: 32,
    },
    card: {
        width: '100%', borderRadius: 24,
        padding: 24, alignItems: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    },
    iconWrap: {
        width: 64, height: 64, borderRadius: 20,
        alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    },
    title: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#fff', marginBottom: 4 },
    version: { fontFamily: 'Inter-Medium', fontSize: 13, color: '#FA2D48', marginBottom: 14 },
    notes: {
        fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(255,255,255,0.55)',
        textAlign: 'center', lineHeight: 19, marginBottom: 22,
    },
    actions: { flexDirection: 'row', gap: 12, width: '100%' },
    laterBtn: {
        flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    laterText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: 'rgba(255,255,255,0.7)' },
    updateBtn: {
        flex: 1.4, paddingVertical: 14, borderRadius: 14,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#FA2D48',
    },
    updateText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#fff' },
    progressWrap: { width: '100%', marginTop: 4 },
    progressTrack: {
        height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)',
        overflow: 'hidden', marginBottom: 10,
    },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: '#FA2D48' },
    progressText: {
        fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
    },
});
