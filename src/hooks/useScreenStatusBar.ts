import { useCallback } from 'react';
import { Platform, StatusBar, type StatusBarStyle } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function statusBarStyleForDevice(requested: StatusBarStyle): StatusBarStyle {
    // React Native's values are platform-correct on the connected iQOO device:
    // dark-content renders dark icons on light surfaces. An earlier OEM
    // inversion made those icons white and unreadable.
    return requested;
}

/** Applies status-bar contrast when a mounted navigation screen becomes active. */
export function useScreenStatusBar(
    barStyle: StatusBarStyle,
    backgroundColor: string,
    translucent = false,
) {
    useFocusEffect(useCallback(() => {
        StatusBar.setBarStyle(statusBarStyleForDevice(barStyle), true);
        if (Platform.OS === 'android') {
            StatusBar.setBackgroundColor(backgroundColor, true);
            StatusBar.setTranslucent(translucent);
        }
    }, [backgroundColor, barStyle, translucent]));
}
