import { ACCESS_HOSTS } from '../config/private';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

const DEVICE_ID_KEY = 'groovix:device-access-id';

type NativeDeviceModule = {
    getAndroidId?: () => Promise<string>;
};

export type DeviceAccessResult = {
    status: 'approved' | 'pending' | 'unavailable';
    deviceId: string;
    message?: string;
};

function fallbackId(): string {
    const random = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `groovix_${Platform.OS}_${random}`;
}

export async function getStableDeviceId(): Promise<string> {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    let rawId = '';
    if (Platform.OS === 'android') {
        const nativeModule = NativeModules.ApkInstaller as NativeDeviceModule | undefined;
        try {
            rawId = String(await nativeModule?.getAndroidId?.() || '').trim();
        } catch {
            rawId = '';
        }
    }

    const deviceId = rawId ? `groovix_android_${rawId}` : fallbackId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
}

async function requestAccess(host: string, deviceId: string): Promise<DeviceAccessResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(`${host}/api/groovix-access?uid=${encodeURIComponent(deviceId)}`, {
            method: 'GET',
            headers: { Accept: 'application/json', 'X-Device-Id': deviceId },
            signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        if (response.ok && data.status === 'approved') return { status: 'approved', deviceId };
        if (response.status === 403 && data.status === 'pending') {
            return { status: 'pending', deviceId, message: typeof data.error === 'string' ? data.error : undefined };
        }
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function checkDeviceAccess(): Promise<DeviceAccessResult> {
    const deviceId = await getStableDeviceId();
    // No approval servers configured (a source build): no gate.
    if (ACCESS_HOSTS.length === 0) return { status: 'approved', deviceId };
    for (const host of ACCESS_HOSTS) {
        const result = await requestAccess(host, deviceId);
        if (result) return result;
    }
    return {
        status: 'unavailable',
        deviceId,
        message: 'Groovix could not verify this device. Check your connection and try again.',
    };
}
