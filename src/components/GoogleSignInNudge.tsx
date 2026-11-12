import { useEffect } from 'react';
import { useAppDialog } from '../context/DialogContext';
import { currentYouTubeUser, signInWithGoogle } from '../services/youtubeAccount';

const FIRST_ASK_MS = 30 * 1000;
const ASK_AGAIN_MS = 30 * 60 * 1000;

/**
 * Asks anyone using Groovix without a Google sign-in to sign in: shortly after
 * opening, then again every half hour while the app stays open. Signed in, it
 * never shows.
 */
export default function GoogleSignInNudge() {
    const { showDialog } = useAppDialog();

    useEffect(() => {
        let active = true;
        const ask = async () => {
            if (!active) return;
            const user = await currentYouTubeUser().catch(() => null);
            if (!active || user) return;
            showDialog({
                title: 'Sign in with Google',
                message: 'Groovix needs a Google sign-in to keep your access. Signing in also brings your YouTube likes, playlists and subscriptions to Home.',
                icon: 'logo-google',
                actions: [
                    { text: 'Later', tone: 'neutral' },
                    {
                        text: 'Sign in', tone: 'primary', onPress: async () => {
                            await signInWithGoogle().catch(() => null);
                        },
                    },
                ],
            });
        };
        const first = setTimeout(ask, FIRST_ASK_MS);
        const repeat = setInterval(ask, ASK_AGAIN_MS);
        return () => { active = false; clearTimeout(first); clearInterval(repeat); };
    }, [showDialog]);

    return null;
}
