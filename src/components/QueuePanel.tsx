// InlineQueue: "Queue" heading, then Now Playing, Next in
// queue (drag to reorder, remove) and the AutoPlay section of radio picks.
import React, { useRef, useState } from 'react';
import { Animated, FlatList, Image, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { API } from '../api';
import type { Track } from '../types';
import { GX_TYPE } from '../theme/groovix';

const ROW_HEIGHT = 56;

type Row =
    | { kind: 'heading'; key: string; title: string; trailing?: 'clear' }
    | { kind: 'autoplay'; key: string; hasTracks: boolean }
    | { kind: 'track'; key: string; track: Track; section: 'history' | 'now' | 'user' | 'autoplay'; index: number };

type Props = {
    current: Track;
    isPlaying: boolean;
    queue: Track[];
    upNext: Track[];
    onJumpTo: (upNextIndex: number) => void;
    onRemove: (queueIndex: number) => void;
    onMove: (from: number, to: number) => void;
    onClear: () => void;
    onSkipCurrent?: () => void;
    /** Played songs, newest first, shown above Now playing when given. */
    history?: Track[];
    onPlayHistory?: (track: Track) => void;
};

function QueueRow({ track, isCurrent, isPlaying, onPress, onRemove, dragHandlers, lifted }: {
    track: Track; isCurrent: boolean; isPlaying?: boolean; onPress?: () => void; onRemove?: () => void;
    dragHandlers?: object; lifted?: boolean;
}) {
    return (
        <TouchableOpacity
            style={[styles.row, lifted && styles.lifted]}
            onPress={onPress}
            disabled={!onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isCurrent ? `Now playing ${track.title}` : `Play ${track.title}`}
        >
            {dragHandlers ? (
                <View style={styles.handle} {...dragHandlers} accessibilityLabel="Drag to reorder">
                    <Ionicons name="reorder-two" size={24} color="rgba(255,255,255,0.55)" />
                </View>
            ) : null}
            <Image source={{ uri: API.getCoverUrl(track.album?.cover, 140) }} style={styles.art} />
            <View style={styles.copy}>
                <Text style={[GX_TYPE.titleMedium, { color: isCurrent ? '#FFFFFF' : 'rgba(255,255,255,0.92)' }]} numberOfLines={1}>
                    {track.title}{track.explicit ? '  🅴' : ''}
                </Text>
                <Text style={[GX_TYPE.bodyMedium, styles.artist]} numberOfLines={1}>{track.artist?.name}</Text>
            </View>
            {isCurrent && <MaterialCommunityIcons name={isPlaying ? 'waveform' : 'pause'} size={24} color="#FFFFFF" style={styles.nowGlyph} />}
            {onRemove ? (
                <TouchableOpacity style={styles.remove} onPress={onRemove} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${track.title} from queue`}>
                    <Ionicons name="close" size={24} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
            ) : null}
        </TouchableOpacity>
    );
}

export default function QueuePanel({ current, isPlaying, queue, upNext, onJumpTo, onRemove, onMove, onClear, onSkipCurrent, history, onPlayHistory }: Props) {
    const autoplay = upNext.slice(queue.length);
    const [dragging, setDragging] = useState<number | null>(null);
    const dragY = useRef(new Animated.Value(0)).current;
    const target = useRef<number | null>(null);

    // One responder per user-queue row's handle; the row follows the finger and
    // lands on whichever slot it is released over.
    const handlersFor = (index: number) => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => { setDragging(index); target.current = index; dragY.setValue(0); },
        onPanResponderMove: (_, gesture) => {
            dragY.setValue(gesture.dy);
            target.current = Math.max(0, Math.min(queue.length - 1, index + Math.round(gesture.dy / ROW_HEIGHT)));
        },
        onPanResponderRelease: () => {
            if (target.current !== null && target.current !== index) onMove(index, target.current);
            setDragging(null);
            target.current = null;
        },
        onPanResponderTerminate: () => { setDragging(null); target.current = null; },
    }).panHandlers;

    const played = (history ?? []).slice(0, 25).reverse();
    const rows: Row[] = [
        ...(played.length ? [{ kind: 'heading', key: 'h-history', title: 'History' } as Row] : []),
        ...played.map((track, index): Row => ({ kind: 'track', key: `history-${track.id}-${index}`, track, section: 'history', index })),
        { kind: 'heading', key: 'h-now', title: 'Now playing' },
        { kind: 'track', key: `now-${current.id}`, track: current, section: 'now', index: -1 },
        ...(queue.length ? [{ kind: 'heading', key: 'h-user', title: 'Next in queue', trailing: 'clear' } as Row] : []),
        ...queue.map((track, index): Row => ({ kind: 'track', key: `user-${track.id}-${index}`, track, section: 'user', index })),
        { kind: 'autoplay', key: 'h-autoplay', hasTracks: autoplay.length > 0 },
        ...autoplay.map((track, index): Row => ({ kind: 'track', key: `auto-${track.id}-${index}`, track, section: 'autoplay', index })),
    ];

    const renderRow = ({ item }: { item: Row }) => {
        if (item.kind === 'heading') {
            return (
                <View style={[styles.heading, item.key === rows[0]?.key ? styles.headingFirst : null]}>
                    <Text style={[GX_TYPE.titleMedium, styles.headingText]}>{item.title}</Text>
                    {item.trailing === 'clear' && (
                        <TouchableOpacity onPress={onClear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear queue">
                            <Text style={[GX_TYPE.labelMedium, styles.clearText]}>Clear</Text>
                        </TouchableOpacity>
                    )}
                </View>
            );
        }
        if (item.kind === 'autoplay') {
            return (
                <View style={styles.autoplay}>
                    <Ionicons name="infinite" size={26} color="#FFFFFF" />
                    <View style={styles.autoplayCopy}>
                        <Text style={[GX_TYPE.titleMedium, styles.white]}>AutoPlay</Text>
                        <Text style={[GX_TYPE.bodyMedium, styles.artist]}>{item.hasTracks ? 'Similar music, selected to play next' : 'Similar music will keep playing'}</Text>
                    </View>
                </View>
            );
        }
        if (item.section === 'history') return <QueueRow track={item.track} isCurrent={false} onPress={onPlayHistory ? () => onPlayHistory(item.track) : undefined} />;
        if (item.section === 'now') return <QueueRow track={item.track} isCurrent isPlaying={isPlaying} onRemove={onSkipCurrent} />;
        if (item.section === 'user') {
            const held = dragging === item.index;
            const row = (
                <QueueRow
                    track={item.track}
                    isCurrent={false}
                    onPress={() => onJumpTo(item.index)}
                    onRemove={() => onRemove(item.index)}
                    dragHandlers={handlersFor(item.index)}
                    lifted={held}
                />
            );
            return held ? <Animated.View style={[styles.heldRow, { transform: [{ translateY: dragY }] }]}>{row}</Animated.View> : row;
        }
        return <QueueRow track={item.track} isCurrent={false} onPress={() => onJumpTo(queue.length + item.index)} dragHandlers={{}} />;
    };

    return (
        <View style={styles.root}>
            <View style={styles.titleRow}>
                <Text style={[GX_TYPE.headlineMedium, styles.white, styles.flex]}>Queue</Text>
                {queue.length > 0 && (
                    <TouchableOpacity onPress={onClear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear queue">
                        <Text style={[GX_TYPE.titleMedium, styles.clearText]}>Clear</Text>
                    </TouchableOpacity>
                )}
            </View>
            <FlatList
                data={rows}
                keyExtractor={item => item.key}
                renderItem={renderRow}
                scrollEnabled={dragging === null}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.list}
                initialNumToRender={14}
                windowSize={7}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    white: { color: '#FFFFFF' },
    titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    list: { paddingBottom: 24 },
    heading: { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
    headingFirst: { paddingTop: 12 },
    headingText: { flex: 1, color: 'rgba(255,255,255,0.75)' },
    clear: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
    clearText: { color: 'rgba(255,255,255,0.75)' },
    autoplay: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
    autoplayCopy: { marginLeft: 14 },
    row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
    lifted: { backgroundColor: 'rgba(255,255,255,0.06)' },
    heldRow: { zIndex: 10, elevation: 10 },
    handle: { width: 24, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -4, marginRight: 4 },
    art: { width: 52, height: 52, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.08)' },
    copy: { flex: 1, minWidth: 0, marginLeft: 16 },
    artist: { color: 'rgba(255,255,255,0.55)' },
    nowGlyph: { marginRight: 18 },
    remove: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
