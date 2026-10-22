import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { checkDeviceAccess, DeviceAccessResult } from '../services/deviceAccess';
import { signInWithGoogle } from '../services/youtubeAccount';

type GateState = DeviceAccessResult | { status: 'checking'; deviceId: string };

export default function DeviceAccessGate({ children }: PropsWithChildren) {
    const [state, setState] = useState<GateState>({ status: 'checking', deviceId: '' });

    const verify = useCallback(async () => {
        setState(current => ({ status: 'checking', deviceId: current.deviceId }));
        try {
            setState(await checkDeviceAccess());
        } catch {
            setState({ status: 'unavailable', deviceId: '', message: 'Groovix could not verify this device.' });
        }
    }, []);

    useEffect(() => { verify(); }, [verify]);

    // A Google sign-in gets this device approved straight away.
    const [signInError, setSignInError] = useState('');
    const signIn = useCallback(async () => {
        setSignInError('');
        try {
            if (await signInWithGoogle()) await verify();
        } catch {
            setSignInError('Google sign-in did not finish. Try again.');
        }
    }, [verify]);

    if (state.status === 'approved') return <>{children}</>;

    const checking = state.status === 'checking';
    const pending = state.status === 'pending';
    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar barStyle="light-content" backgroundColor="#09090B" />
            <View style={styles.card}>
                <View style={styles.logo}><Ionicons name="musical-notes" size={28} color="#FFFFFF" /></View>
                <Text style={styles.brand}>Groovix</Text>
                <Text style={styles.title}>{checking ? 'Checking access' : pending ? 'Approval required' : 'Unable to verify'}</Text>
                <Text style={styles.body}>
                    {checking
                        ? 'Securely checking this device…'
                        : pending
                            ? 'Sign in with Google to get access right away, or ask the Groovix administrator to approve the ID below.'
                            : state.message}
                </Text>
                {checking ? <ActivityIndicator style={styles.loader} color="#F0445E" /> : null}
                {!checking && state.deviceId ? (
                    <View style={styles.idBox}>
                        <Text style={styles.idLabel}>DEVICE ID</Text>
                        <Text selectable style={styles.idText}>{state.deviceId}</Text>
                    </View>
                ) : null}
                {pending ? (
                    <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.googleButton, pressed && styles.pressed]}
                        onPress={signIn}
                    >
                        <Ionicons name="logo-google" size={19} color="#09090B" />
                        <Text style={styles.googleText}>Sign in with Google</Text>
                    </Pressable>
                ) : null}
                {signInError ? <Text style={styles.signInError}>{signInError}</Text> : null}
                {!checking ? (
                    <View style={styles.actions}>
                        {state.deviceId ? (
                            <Pressable
                                accessibilityRole="button"
                                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                                onPress={() => Share.share({ message: `Groovix device approval request\n${state.deviceId}` })}
                            >
                                <Ionicons name="share-outline" size={19} color="#FFFFFF" />
                                <Text style={styles.secondaryText}>Share ID</Text>
                            </Pressable>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                            onPress={verify}
                        >
                            <Ionicons name="refresh" size={19} color="#FFFFFF" />
                            <Text style={styles.primaryText}>Check again</Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#09090B', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 440, alignItems: 'center' },
    logo: { width: 58, height: 58, borderRadius: 19, backgroundColor: '#F0445E', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    brand: { color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 28, letterSpacing: -0.7 },
    title: { color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 20, marginTop: 30 },
    body: { color: '#A6A6AD', fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10, maxWidth: 360 },
    loader: { marginTop: 28 },
    idBox: { width: '100%', backgroundColor: '#151518', borderColor: '#27272C', borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 26 },
    idLabel: { color: '#777780', fontFamily: 'Inter-SemiBold', fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
    idText: { color: '#FFFFFF', fontFamily: 'Inter-Medium', fontSize: 13, lineHeight: 19 },
    actions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 14 },
    primaryButton: { flex: 1, minHeight: 50, borderRadius: 15, backgroundColor: '#F0445E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    secondaryButton: { flex: 1, minHeight: 50, borderRadius: 15, backgroundColor: '#1B1B1F', borderWidth: 1, borderColor: '#303036', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    primaryText: { color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 14 },
    secondaryText: { color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 14 },
    googleButton: { width: '100%', minHeight: 52, borderRadius: 15, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 26 },
    googleText: { color: '#09090B', fontFamily: 'Inter-SemiBold', fontSize: 15 },
    signInError: { color: '#F0445E', fontFamily: 'Inter-Regular', fontSize: 13, marginTop: 10, textAlign: 'center' },
    pressed: { opacity: 0.72 },
});
