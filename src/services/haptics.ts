// Named touch feedback, played by the native GroovixHaptics module.
import { NativeModules, Platform } from 'react-native';

export type Haptic =
    | 'tick'        // lightest beat, for repeats while a finger is down
    | 'tap'         // a plain press with no state behind it: More, Menu
    | 'select'      // a discrete choice landing: a tab, a chip, the end of a scrub
    | 'toggleOn'
    | 'toggleOff'
    | 'skipNext'
    | 'skipPrevious'
    | 'resume'      // playback starting
    | 'pause'       // playback stopping
    | 'expand';     // the mini player opening to full screen

const native = NativeModules.GroovixHaptics as { play?: (name: Haptic) => void } | undefined;

export function haptic(name: Haptic) {
    if (Platform.OS !== 'android') return;
    try { native?.play?.(name); } catch { /* no vibrator */ }
}
