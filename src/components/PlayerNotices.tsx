import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useAppDialog } from '../context/DialogContext';

/** Player messages ("song not available", "no internet") in the app's own dialog. */
export default function PlayerNotices() {
    const { showDialog } = useAppDialog();
    useEffect(() => {
        const sub = DeviceEventEmitter.addListener('GroovixPlayerNotice', ({ title, message, icon }) => {
            showDialog({ title, message, icon });
        });
        return () => sub.remove();
    }, [showDialog]);
    return null;
}
