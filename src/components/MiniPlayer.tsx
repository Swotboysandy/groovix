import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { usePlayer } from '../context/PlayerContext';
import { API } from '../api';
import TouchableScale from './TouchableScale';

const { width } = Dimensions.get('window');

export default function MiniPlayer({ onPress }: { onPress: () => void }) {
    const { currentTrack, isPlaying, togglePlayPause, currentTime, duration } = usePlayer();

    if (!currentTrack) return null;

    const progress = duration > 0 ? currentTime / duration : 0;

    return (
        <TouchableScale
            style={styles.container}
            onPress={onPress}
            activeOpacity={0.95}
        >
            {/* Progress bar at top */}
            <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>

            <View style={styles.content}>
                <Image
                    source={{ uri: API.getCoverUrl(currentTrack.album?.cover, 160) }}
                    style={styles.thumbnail}
                />
                <View style={styles.info}>
                    <Text style={styles.title} numberOfLines={1}>
                        {currentTrack.title}
                    </Text>
                    <Text style={styles.artist} numberOfLines={1}>
                        {currentTrack.artist?.name}
                    </Text>
                </View>
                <TouchableScale
                    onPress={(e) => { togglePlayPause(); }}
                    style={styles.btn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons
                        name={isPlaying ? 'pause' : 'play'}
                        size={24}
                        color="#fff"
                    />
                </TouchableScale>
                <TouchableScale
                    style={styles.btn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="play-skip-forward" size={20} color="#fff" />
                </TouchableScale>
            </View>
        </TouchableScale>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#1C1C1E',
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(255,255,255,0.08)',
    },
    progressBar: {
        height: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    progressFill: {
        height: 2,
        backgroundColor: '#fa2d48',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        height: 58,
    },
    thumbnail: {
        width: 42,
        height: 42,
        borderRadius: 6,
        backgroundColor: '#2C2C2E',
    },
    info: {
        flex: 1,
        marginLeft: 10,
        marginRight: 8,
    },
    title: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    artist: {
        color: '#9A9A9A',
        fontSize: 12,
        marginTop: 1,
    },
    btn: {
        padding: 10,
    },
});
