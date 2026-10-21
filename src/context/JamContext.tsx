import React, {
    createContext, useContext, useState, useRef,
    useCallback, useEffect,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase';
import type { Track } from '../types';
import { usePlayer } from './PlayerContext';

// ─── Why a table, not realtime ──────────────────────────────────────────────────
// On React Native, Supabase Realtime is unreliable: broadcast messages aren't
// received, and presence *updates* don't propagate to already-connected clients
// (both verified on-device). Plain HTTP works fine, so room state lives in a
// `jam_members` table: each member writes its own row, everyone polls + merges.
// ───────────────────────────────────────────────────────────────────────────────

export interface JamTrack {
    id: string;
    track: Track;
    addedBy: string;
    votes: number;
    voters: string[];
}

export interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    ts: number;
}

interface Playback {
    status: 'playing' | 'paused';
    track: Track | null;
    position_ms: number;
    ts: number;
}

// One member's contribution to the room (stored as the `data` jsonb of their row)
interface MemberData {
    name: string;
    isHost: boolean;
    playback?: Playback | null;
    adds: { id: string; track: Track; ts: number }[];
    votes: string[];
    removed: string[];
    chat: ChatMessage[];
}

// The room's shared "Now Playing" — what the host (DJ) is currently spinning.
export interface NowPlaying {
    track: Track;
    playing: boolean; // is the room actively playing (vs the host having paused)
}

interface JamContextType {
    room: { slug: string; isHost: boolean; participants: string[] } | null;
    myName: string;
    isHost: boolean;
    isConnected: boolean;
    sortedQueue: JamTrack[];
    messages: ChatMessage[];
    nowPlaying: NowPlaying | null;
    behind: boolean;            // this device has drifted/paused away from the room
    createRoom: (name: string) => Promise<string>;
    joinRoom: (code: string, name: string) => Promise<boolean>;
    leaveRoom: () => void;
    addToQueue: (track: Track) => void;
    addLikedToQueue: (tracks: Track[]) => void;
    vote: (jamTrackId: string) => void;
    removeFromQueue: (jamTrackId: string) => void;
    sendChat: (text: string) => void;
    playNow: (jamTrackId: string) => void;   // host: jump the room to this track
    skipNext: () => void;                     // host: advance to the next queued track
    syncToRoom: () => void;                   // anyone: catch up to the live position
}

const JamContext = createContext<JamContextType>({
    room: null, myName: '', isHost: false, isConnected: false, sortedQueue: [], messages: [],
    nowPlaying: null, behind: false,
    createRoom: async () => '',
    joinRoom: async () => false,
    leaveRoom: () => {},
    addToQueue: () => {},
    addLikedToQueue: () => {},
    vote: () => {},
    removeFromQueue: () => {},
    sendChat: () => {},
    playNow: () => {},
    skipNext: () => {},
    syncToRoom: () => {},
});

export const useJam = () => useContext(JamContext);

// ─── helpers ────────────────────────────────────────────────────────────────────

const TABLE = 'jam_members';
const POLL_MS = 1000;       // how often we read others' state
const HEARTBEAT_MS = 6000;  // how often we refresh our own row (keeps us "alive")
const BEHIND_S = 4;         // seconds of drift before we offer a "Sync" button

function makeCode(): string {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}
function rid(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function cleanName(value: string): string {
    return value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}
function minTrack(t: Track): Track {
    return {
        id: t.id,
        title: t.title,
        duration: t.duration,
        artist: { id: t.artist?.id || 0, name: t.artist?.name || '' },
        album: { id: t.album?.id || 0, title: t.album?.title || '', cover: t.album?.cover || '' },
        source: t.source,
        provider: t.provider,
        providerId: t.providerId,
        sourceUrl: t.sourceUrl,
        isrc: t.isrc,
        localPath: t.localPath,
        coverUrl: t.coverUrl,
        audioQuality: t.audioQuality,
        mediaMetadata: t.mediaMetadata,
        releaseDate: t.releaseDate,
        explicit: t.explicit,
    } as Track;
}

const MAX_ADDS = 40;
const MAX_CHAT = 40;
const MAX_CACHED_CHAT = 200;
const CHAT_CACHE_PREFIX = '@groovix/jam-chat/';

function isChatMessage(value: unknown): value is ChatMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Partial<ChatMessage>;
    return typeof message.id === 'string'
        && typeof message.sender === 'string'
        && typeof message.text === 'string'
        && typeof message.ts === 'number';
}

async function readCachedChat(slug: string): Promise<ChatMessage[]> {
    try {
        const raw = await AsyncStorage.getItem(`${CHAT_CACHE_PREFIX}${slug}`);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(isChatMessage).slice(-MAX_CACHED_CHAT) : [];
    } catch {
        return [];
    }
}

export function JamProvider({ children }: { children: React.ReactNode }) {
    const { currentTrack, isPlaying, currentTime, isBuffering, playTrack, togglePlayPause, seek, setOnTrackEnd } = usePlayer();

    const [room, setRoom] = useState<{ slug: string; isHost: boolean; participants: string[] } | null>(null);
    const [myName, setMyName] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [queue, setQueue] = useState<JamTrack[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
    const [behind, setBehind] = useState(false);

    const clientIdRef = useRef('');
    const isHostRef = useRef(false);
    const slugRef = useRef('');
    const me = useRef<MemberData>({ name: '', isHost: false, playback: null, adds: [], votes: [], removed: [], chat: [] });

    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // host: which queue entry is currently spinning; everyone: latest queue + now-playing mirrors
    const nowPlayingIdRef = useRef<string | null>(null);
    const queueRef = useRef<JamTrack[]>([]);
    const nowPlayingRef = useRef<NowPlaying | null>(null);
    const lastAdoptedIdRef = useRef<number | null>(null);
    // perf: skip setState when the merged view hasn't actually changed (poll runs every 1s)
    const sigQueue = useRef('');
    const sigChat = useRef('');
    const sigParts = useRef('');
    const sigStoredChat = useRef('');
    const cachedMessagesRef = useRef<ChatMessage[]>([]);

    // latest player state in refs (no stale closures)
    const isPlayingRef = useRef(isPlaying);
    const currentTrackRef = useRef(currentTrack);
    const currentTimeRef = useRef(currentTime);
    const isBufferingRef = useRef(isBuffering);
    const playTrackRef = useRef(playTrack);
    const togglePlayPauseRef = useRef(togglePlayPause);
    const seekRef = useRef(seek);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
    useEffect(() => { isBufferingRef.current = isBuffering; }, [isBuffering]);
    useEffect(() => { playTrackRef.current = playTrack; }, [playTrack]);
    useEffect(() => { togglePlayPauseRef.current = togglePlayPause; }, [togglePlayPause]);
    useEffect(() => { seekRef.current = seek; }, [seek]);

    const hostPosRef = useRef<{ trackId: number; pos: number; at: number } | null>(null);
    const behindRef = useRef(false);

    // ── Write our own row (HTTP upsert) ───────────────────────────────────────
    const pushState = useCallback(async () => {
        if (!slugRef.current) return;
        try {
            const { error } = await supabase.from(TABLE).upsert({
                room: slugRef.current,
                client_id: clientIdRef.current,
                data: me.current,
                updated_at: new Date().toISOString(),
            });
            setIsConnected(!error);
        } catch { setIsConnected(false); }
    }, []);

    // ── Merge a set of member rows into the shared view ───────────────────────
    const applyMembers = useCallback((members: MemberData[]) => {
        // participants (only re-render when the set actually changes)
        const participants = [...new Set(members.map(m => m.name).filter(Boolean))];
        const pSig = participants.join('|');
        if (pSig !== sigParts.current) {
            sigParts.current = pSig;
            setRoom(prev => prev ? { ...prev, participants } : prev);
        }

        const removed = new Set<string>();
        for (const m of members) for (const r of (m.removed || [])) removed.add(r);

        // queue: merge everyone's adds, count votes, sort by votes then insertion order
        const byId = new Map<string, { id: string; track: Track; ts: number; addedBy: string }>();
        for (const m of members) {
            for (const a of (m.adds || [])) {
                if (!byId.has(a.id)) byId.set(a.id, { ...a, addedBy: m.name });
            }
        }
        const jamTracks: JamTrack[] = [];
        for (const [id, a] of byId) {
            if (removed.has(id)) continue;
            const voters = members.filter(m => (m.votes || []).includes(id)).map(m => m.name);
            jamTracks.push({ id, track: a.track, addedBy: a.addedBy, votes: voters.length, voters });
        }
        // sort by votes, stable tiebreak by original add time (equal-vote tracks don't reshuffle)
        const tsOf = (id: string) => byId.get(id)?.ts ?? 0;
        jamTracks.sort((x, y) => (y.votes - x.votes) || (tsOf(x.id) - tsOf(y.id)));
        queueRef.current = jamTracks;
        const qSig = jamTracks.map(t => `${t.id}:${t.votes}`).join('|');
        if (qSig !== sigQueue.current) {
            sigQueue.current = qSig;
            setQueue(jamTracks);
        }

        // chat: dedupe + sort, re-render only on a new message
        const seen = new Set<string>();
        const chat = [...cachedMessagesRef.current, ...members.flatMap(m => m.chat || [])]
            .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
            .sort((x, y) => x.ts - y.ts)
            .slice(-MAX_CACHED_CHAT);
        cachedMessagesRef.current = chat;
        const cSig = `${chat.length}:${chat[chat.length - 1]?.id ?? ''}`;
        if (cSig !== sigChat.current) {
            sigChat.current = cSig;
            setMessages(chat);
        }
        if (cSig !== sigStoredChat.current && slugRef.current) {
            sigStoredChat.current = cSig;
            AsyncStorage.setItem(`${CHAT_CACHE_PREFIX}${slugRef.current}`, JSON.stringify(chat)).catch(() => {});
        }

        // ── shared playback: the host is the DJ; everyone sees the same Now Playing ──
        const host = members.find(m => m.isHost);
        const hp = host?.playback;
        const np: NowPlaying | null = hp?.track ? { track: hp.track, playing: hp.status === 'playing' } : null;
        const npSig = np ? `${np.track.id}:${np.playing}` : '';
        const npPrev = nowPlayingRef.current ? `${nowPlayingRef.current.track.id}:${nowPlayingRef.current.playing}` : '';
        if (npSig !== npPrev) {
            nowPlayingRef.current = np;
            setNowPlaying(np);
        }

        // followers track the live position and ADOPT the room's song when it CHANGES.
        // We never force play/pause on the same song — so you can pause for yourself and
        // tap "Sync" to rejoin. A genuine song change still switches everyone over.
        if (!isHostRef.current) {
            if (hp?.track && hp.status === 'playing') {
                hostPosRef.current = { trackId: hp.track.id, pos: hp.position_ms / 1000, at: hp.ts };
                if (hp.track.id !== currentTrackRef.current?.id && hp.track.id !== lastAdoptedIdRef.current) {
                    lastAdoptedIdRef.current = hp.track.id;
                    const live = hp.position_ms / 1000 + (Date.now() - hp.ts) / 1000;
                    playTrackRef.current(hp.track, live > 2 ? live : 0);
                }
            } else {
                hostPosRef.current = null;
            }
        }
    }, []);

    // remember the most recent "other members" so optimistic local recompute keeps them
    const lastOthers = useRef<MemberData[]>([]);

    // recompute locally right away (optimistic) + push our row
    const pushAndReflect = useCallback(() => {
        applyMembers([me.current, ...lastOthers.current]);
        pushState();
    }, [applyMembers, pushState]);

    // ── Read all rows for our room and merge ──────────────────────────────────
    const pollAndRemember = useCallback(async () => {
        if (!slugRef.current) return;
        try {
            // Membership is explicit: Android may pause timers while an app is
            // backgrounded, so heartbeat age must never make a person vanish.
            // leaveRoom deletes the member row when they actually exit JAM.
            const { data, error } = await supabase
                .from(TABLE)
                .select('client_id,data,updated_at')
                .eq('room', slugRef.current);
            if (error) { setIsConnected(false); return; }
            setIsConnected(true);
            const rows = (data || []) as { client_id: string; data: MemberData }[];
            lastOthers.current = rows.filter(r => r.client_id !== clientIdRef.current).map(r => r.data).filter(Boolean);
            applyMembers([...lastOthers.current, me.current]);
        } catch { setIsConnected(false); }
    }, [applyMembers]);

    // ── Start / stop the room ─────────────────────────────────────────────────
    const startTimers = useCallback(() => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        pollTimer.current = setInterval(pollAndRemember, POLL_MS);
        heartbeatTimer.current = setInterval(() => {
            // keep our row fresh; host also refreshes its play position
            if (isHostRef.current && isPlayingRef.current && currentTrackRef.current) {
                me.current = {
                    ...me.current,
                    playback: {
                        status: 'playing',
                        track: minTrack(currentTrackRef.current),
                        position_ms: Math.round(currentTimeRef.current * 1000),
                        ts: Date.now(),
                    },
                };
            }
            pushState();
        }, HEARTBEAT_MS);
    }, [pollAndRemember, pushState]);

    const enterRoom = useCallback(async (slug: string, name: string, host: boolean) => {
        const safeName = cleanName(name) || 'Guest';
        clientIdRef.current = `${safeName}-${rid()}`;
        isHostRef.current = host;
        slugRef.current = slug;
        lastOthers.current = [];
        nowPlayingIdRef.current = null;
        nowPlayingRef.current = null;
        lastAdoptedIdRef.current = null;
        behindRef.current = false;
        sigQueue.current = ''; sigChat.current = ''; sigParts.current = ''; sigStoredChat.current = '';
        cachedMessagesRef.current = await readCachedChat(slug);
        me.current = { name: safeName, isHost: host, playback: null, adds: [], votes: [], removed: [], chat: [] };
        setMyName(safeName);
        setRoom({ slug, isHost: host, participants: [safeName] });
        setQueue([]); setMessages(cachedMessagesRef.current); setNowPlaying(null); setBehind(false); setIsConnected(false);
        await pushState();      // announce ourselves
        await pollAndRemember(); // pull current state immediately
        startTimers();
    }, [pushState, pollAndRemember, startTimers]);

    const createRoom = useCallback(async (name: string): Promise<string> => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const slug = makeCode();
            const { data, error } = await supabase
                .from(TABLE)
                .select('client_id')
                .eq('room', slug)
                .limit(1);
            if (error) throw error;
            if (!data || data.length === 0) {
                await enterRoom(slug, name, true);
                return slug;
            }
        }
        throw new Error('Could not reserve a unique JAM room');
    }, [enterRoom]);

    const joinRoom = useCallback(async (code: string, name: string): Promise<boolean> => {
        const slug = code.trim().toUpperCase();
        const { data, error } = await supabase
            .from(TABLE)
            .select('client_id,data')
            .eq('room', slug)
            .limit(50);
        const hasHost = !error && Array.isArray(data)
            && data.some(row => Boolean((row as { data?: Partial<MemberData> }).data?.isHost));
        if (!hasHost) return false;
        await enterRoom(slug, name, false);
        return true;
    }, [enterRoom]);

    const leaveRoom = useCallback(() => {
        const slug = slugRef.current, cid = clientIdRef.current;
        if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
        if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
        if (slug) {
            const removal = supabase.from(TABLE).delete().eq('room', slug);
            (isHostRef.current ? removal : removal.eq('client_id', cid)).then(() => {}, () => {});
            AsyncStorage.removeItem(`${CHAT_CACHE_PREFIX}${slug}`).catch(() => {});
        }
        setOnTrackEnd(null);
        setRoom(null); setMyName(''); setIsConnected(false);
        setQueue([]); setMessages([]); setNowPlaying(null); setBehind(false);
        isHostRef.current = false; slugRef.current = '';
        nowPlayingIdRef.current = null; nowPlayingRef.current = null;
        lastAdoptedIdRef.current = null; behindRef.current = false;
        me.current = { name: '', isHost: false, playback: null, adds: [], votes: [], removed: [], chat: [] };
        lastOthers.current = [];
        cachedMessagesRef.current = [];
    }, [setOnTrackEnd]);

    // ── Host: publish playback whenever it changes ────────────────────────────
    const prevSig = useRef<string | null>(null);
    useEffect(() => {
        if (!slugRef.current || !isHostRef.current) return;
        const sig = `${isPlaying ? 'playing' : 'paused'}:${currentTrack?.id ?? ''}`;
        if (sig === prevSig.current) return;
        prevSig.current = sig;
        if (!currentTrack) return;
        me.current = {
            ...me.current,
            playback: {
                status: isPlaying ? 'playing' : 'paused',
                track: minTrack(currentTrack),
                position_ms: Math.round(currentTimeRef.current * 1000),
                ts: Date.now(),
            },
        };
        pushState();
    }, [isPlaying, currentTrack, pushState]);

    // ── Host: a seek (scrubbing the progress bar) is published straight away ──
    useEffect(() => {
        if (!slugRef.current || !isHostRef.current || !isPlaying || isBuffering) return;
        const pb = me.current.playback;
        if (!pb || pb.status !== 'playing' || pb.track.id !== currentTrack?.id) return;
        const expected = pb.position_ms / 1000 + (Date.now() - pb.ts) / 1000;
        if (Math.abs(currentTime - expected) < 2) return;
        me.current = { ...me.current, playback: { ...pb, position_ms: Math.round(currentTime * 1000), ts: Date.now() } };
        pushState();
    }, [currentTime, isPlaying, isBuffering, currentTrack, pushState]);

    // ── Followers: stay on the host's song, play state and position automatically ──
    const lastAutoSyncRef = useRef(0);
    useEffect(() => {
        const id = setInterval(() => {
            let b = false;
            if (!isHostRef.current && slugRef.current) {
                const np = nowPlayingRef.current;
                const now = Date.now();
                // Give the player time to load/seek before acting again.
                const canAct = now - lastAutoSyncRef.current > 5000;
                if (np && np.playing) {
                    const hp = hostPosRef.current;
                    const expected = hp && hp.trackId === np.track.id ? hp.pos + (now - hp.at) / 1000 : 0;
                    if (currentTrackRef.current?.id !== np.track.id) {
                        b = true;
                        if (canAct) {
                            lastAutoSyncRef.current = now;
                            lastAdoptedIdRef.current = np.track.id;
                            playTrackRef.current(np.track, expected > 2 ? expected : 0);
                        }
                    } else if (!isBufferingRef.current) {
                        if (!isPlayingRef.current) {
                            b = true;
                            if (canAct) { lastAutoSyncRef.current = now; togglePlayPauseRef.current(); }
                        } else if (hp && Math.abs(currentTimeRef.current - expected) > BEHIND_S) {
                            b = true;
                            if (canAct) { lastAutoSyncRef.current = now; seekRef.current(expected); }
                        }
                    }
                } else if (np && !np.playing && currentTrackRef.current?.id === np.track.id && isPlayingRef.current && canAct) {
                    // Host paused: pause here too.
                    lastAutoSyncRef.current = now;
                    togglePlayPauseRef.current();
                }
            }
            if (b !== behindRef.current) { behindRef.current = b; setBehind(b); }
        }, 1500);
        return () => clearInterval(id);
    }, []);

    // ── Host (DJ) playback control: play the queue, advance on end / skip ──────
    const advanceQueue = useCallback(() => {
        const playedId = nowPlayingIdRef.current;
        if (playedId && !me.current.removed.includes(playedId)) {
            me.current = { ...me.current, removed: [...me.current.removed, playedId] };
        }
        const next = (queueRef.current || []).find(jt => jt.id !== playedId && !me.current.removed.includes(jt.id));
        if (next) {
            nowPlayingIdRef.current = next.id;
            // set our broadcast playback immediately so everyone switches without waiting
            me.current = { ...me.current, playback: { status: 'playing', track: minTrack(next.track), position_ms: 0, ts: Date.now() } };
            playTrackRef.current(next.track, 0);
        } else {
            nowPlayingIdRef.current = null;
            me.current = { ...me.current, playback: null };
        }
        pushAndReflect();
    }, [pushAndReflect]);

    const playNow = useCallback((jamTrackId: string) => {
        if (!isHostRef.current) return;
        const jt = (queueRef.current || []).find(j => j.id === jamTrackId);
        if (!jt) return;
        nowPlayingIdRef.current = jamTrackId;
        me.current = { ...me.current, playback: { status: 'playing', track: minTrack(jt.track), position_ms: 0, ts: Date.now() } };
        playTrackRef.current(jt.track, 0);
        pushAndReflect();
    }, [pushAndReflect]);

    const skipNext = useCallback(() => {
        if (!isHostRef.current) return;
        advanceQueue();
    }, [advanceQueue]);

    // ── Anyone: catch up to the room's live position ──────────────────────────
    const syncToRoom = useCallback(() => {
        const np = nowPlayingRef.current;
        if (!np) return;
        const hp = hostPosRef.current;
        const live = hp && hp.trackId === np.track.id ? hp.pos + (Date.now() - hp.at) / 1000 : 0;
        if (currentTrackRef.current?.id !== np.track.id) {
            lastAdoptedIdRef.current = np.track.id;
            playTrackRef.current(np.track, live > 1 ? live : 0);
        } else {
            seekRef.current(live > 1 ? live : 0);
            if (!isPlayingRef.current) togglePlayPauseRef.current();
        }
        behindRef.current = false;
        setBehind(false);
    }, []);

    // ── Register the track-end handler so the jam owns "what plays next" ───────
    const inRoom = !!room?.slug;
    useEffect(() => {
        if (!inRoom) { setOnTrackEnd(null); return; }
        setOnTrackEnd(() => {
            if (!slugRef.current) return false;
            if (isHostRef.current) { advanceQueue(); return true; }
            return true; // follower: don't personal-autoplay; wait for the host's next song
        });
        return () => setOnTrackEnd(null);
    }, [inRoom, advanceQueue, setOnTrackEnd]);

    // ── Queue / vote / chat — update our row, reflect instantly ───────────────
    const addToQueue = useCallback((track: Track) => {
        if (queueRef.current.some(item => item.track.id === track.id)) return;
        const entry = { id: `${track.id}-${rid()}`, track: minTrack(track), ts: Date.now() };
        me.current = { ...me.current, adds: [...me.current.adds, entry].slice(-MAX_ADDS) };
        pushAndReflect();
    }, [pushAndReflect]);

    const addLikedToQueue = useCallback((tracks: Track[]) => {
        if (!isHostRef.current || tracks.length === 0) return;
        const existingTrackIds = new Set([...me.current.adds.map(item => item.track.id), ...queueRef.current.map(item => item.track.id)]);
        const entries = tracks
            .filter(track => !existingTrackIds.has(track.id))
            .slice(0, MAX_ADDS)
            .map((track, index) => ({ id: `${track.id}-${rid()}`, track: minTrack(track), ts: Date.now() + index }));
        if (entries.length === 0) return;
        me.current = { ...me.current, adds: [...me.current.adds, ...entries].slice(-MAX_ADDS) };

        // A host starting a liked set expects it to flow without another tap.
        // The existing track-end handler advances through the remaining queue.
        if (!nowPlayingRef.current) {
            const first = entries[0];
            nowPlayingIdRef.current = first.id;
            me.current = {
                ...me.current,
                playback: { status: 'playing', track: first.track, position_ms: 0, ts: Date.now() },
            };
            playTrackRef.current(first.track, 0);
        }
        pushAndReflect();
    }, [pushAndReflect]);

    const vote = useCallback((jamTrackId: string) => {
        const has = me.current.votes.includes(jamTrackId);
        me.current = {
            ...me.current,
            votes: has ? me.current.votes.filter(v => v !== jamTrackId) : [...me.current.votes, jamTrackId],
        };
        pushAndReflect();
    }, [pushAndReflect]);

    const removeFromQueue = useCallback((jamTrackId: string) => {
        const mine = me.current.adds.some(a => a.id === jamTrackId);
        if (mine) {
            me.current = { ...me.current, adds: me.current.adds.filter(a => a.id !== jamTrackId) };
        } else if (isHostRef.current) {
            me.current = { ...me.current, removed: [...me.current.removed, jamTrackId] };
        } else { return; }
        pushAndReflect();
    }, [pushAndReflect]);

    const sendChat = useCallback((text: string) => {
        const cleanText = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 500);
        if (!cleanText) return;
        const msg: ChatMessage = { id: rid(), sender: me.current.name, text: cleanText, ts: Date.now() };
        me.current = { ...me.current, chat: [...me.current.chat, msg].slice(-MAX_CHAT) };
        pushAndReflect();
    }, [pushAndReflect]);

    const sortedQueue = queue;

    useEffect(() => () => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active' || !slugRef.current) return;
            pushState();
            pollAndRemember();
            startTimers();
        });
        return () => subscription.remove();
    }, [pollAndRemember, pushState, startTimers]);

    return (
        <JamContext.Provider value={{
            room, myName, isHost: room?.isHost ?? false, isConnected, sortedQueue, messages,
            nowPlaying, behind,
            createRoom, joinRoom, leaveRoom,
            addToQueue, addLikedToQueue, vote, removeFromQueue, sendChat,
            playNow, skipNext, syncToRoom,
        }}>
            {children}
        </JamContext.Provider>
    );
}
