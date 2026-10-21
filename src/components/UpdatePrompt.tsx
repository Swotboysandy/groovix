import React, { useEffect, useState } from 'react';
import {
    View, Text, Modal, Pressable, ScrollView, StyleSheet, NativeModules,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

    const dismiss = () => { if (!downloading) setUpdate(null); };
    const rule = { backgroundColor: colors.text, opacity: 0.14 };
    const noteLines = (update.notes || '').split('\n')
        .map(line => line.replace(/\*\*/g, '').trim())
        .filter(line => line && !/^#*\s*what's new$/i.test(line) && !/^sha-256/i.test(line));

    return (
        <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
            <Pressable style={styles.backdrop} onPress={dismiss}>
                <Pressable style={[styles.card, { backgroundColor: colors.surface }]} onPress={() => {}}>
                    <View style={styles.body}>
                        <Text style={[styles.title, { color: colors.text }]}>Software Update</Text>
                        <Text style={[styles.message, { color: colors.text }]}>
                            {downloading
                                ? (progress >= 1 ? `Groovix ${update.version} is ready to install.` : `Downloading Groovix ${update.version}…`)
                                : `Groovix ${update.version} is available to download.`}
                        </Text>

                        {downloading ? (
                            <View style={[styles.track, { backgroundColor: 'rgba(128,128,128,0.25)' }]}>
                                <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` }]} />
                            </View>
                        ) : null}

                        {noteLines.length ? (
                            <>
                                <View style={[styles.rule, rule, { marginTop: 12, alignSelf: 'stretch' }]} />
                                <Text style={[styles.whatsNew, { color: colors.text }]}>What’s new</Text>
                                <ScrollView style={styles.notes} nestedScrollEnabled>
                                    {noteLines.map((line, i) => {
                                        const bullet = /^[-*•]\s+/.test(line);
                                        return (
                                            <Text key={i} style={[styles.note, { color: colors.text }, line.startsWith('#') && styles.noteHeading]}>
                                                {bullet ? `•  ${line.replace(/^[-*•]\s+/, '')}` : line.replace(/^#+\s*/, '')}
                                            </Text>
                                        );
                                    })}
                                </ScrollView>
                            </>
                        ) : null}
                    </View>

                    <View style={[styles.rule, rule]} />
                    {downloading ? (
                        <AlertAction label={progress >= 1 ? 'Opening installer…' : 'Downloading…'} color={colors.primary} disabled />
                    ) : (
                        <>
                            <AlertAction label="Download Now" color={colors.primary} emphasised onPress={handleUpdate} />
                            <View style={[styles.rule, rule]} />
                            <AlertAction label="Remind Me Later" color={colors.primary} onPress={dismiss} />
                        </>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/** Full-width text row; the row washes grey while pressed instead of a ripple. */
function AlertAction({ label, color, emphasised, disabled, onPress }: {
    label: string; color: string; emphasised?: boolean; disabled?: boolean; onPress?: () => void;
}) {
    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [styles.action, pressed && { backgroundColor: 'rgba(128,128,128,0.15)' }]}
        >
            <Text style={[styles.actionText, { color, opacity: disabled ? 0.4 : 1 }, emphasised && styles.actionBold]}>{label}</Text>
        </Pressable>
    );
}

// iOS system-alert metrics: 270 wide, 14 corner, 44 tall action rows, hairline rules.
const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', alignItems: 'center', justifyContent: 'center' },
    card: { width: 270, borderRadius: 14, overflow: 'hidden' },
    body: { paddingHorizontal: 16, paddingVertical: 19, alignItems: 'center' },
    title: { fontFamily: 'SFProDisplay-Semibold', fontSize: 17, textAlign: 'center' },
    message: { fontFamily: 'SFProDisplay-Regular', fontSize: 13, lineHeight: 17, marginTop: 4, textAlign: 'center' },
    track: { alignSelf: 'stretch', height: 4, borderRadius: 2, marginTop: 12, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2 },
    whatsNew: { alignSelf: 'stretch', fontFamily: 'SFProDisplay-Semibold', fontSize: 12, marginTop: 12, opacity: 0.6 },
    notes: { alignSelf: 'stretch', maxHeight: 220, marginTop: 4 },
    note: { fontFamily: 'SFProDisplay-Regular', fontSize: 13, lineHeight: 18, marginBottom: 2 },
    noteHeading: { fontFamily: 'SFProDisplay-Semibold' },
    rule: { height: StyleSheet.hairlineWidth },
    action: { height: 44, alignItems: 'center', justifyContent: 'center' },
    actionText: { fontFamily: 'SFProDisplay-Regular', fontSize: 17 },
    actionBold: { fontFamily: 'SFProDisplay-Semibold' },
});
