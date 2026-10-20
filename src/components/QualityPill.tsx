import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

export function getQualityLabel(quality?: string): '24-bit FLAC' | 'FLAC' | 'AAC' | 'MP3' | null {
    const value = (quality || '').toUpperCase();
    if (value.includes('HI_RES') || value.includes('HIRES') || value.includes('HI-RES')) return '24-bit FLAC';
    if (value.includes('LOSSLESS') || value.includes('FLAC')) return 'FLAC';
    if (value.includes('MP3')) return 'MP3';
    if (value === 'HIGH' || value === 'LOW' || value.includes('AAC')) return 'AAC';
    return null;
}

export default function QualityPill({ quality, style, textStyle }: {
    quality?: string;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}) {
    const label = getQualityLabel(quality);
    if (!label) return null;

    return (
        <View style={[styles.pill, style]}>
            <Text style={[styles.text, textStyle]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    pill: {
        alignSelf: 'flex-start',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: 'rgba(250,45,72,0.14)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(250,45,72,0.32)',
    },
    text: {
        color: '#ff7183',
        fontFamily: 'Inter-Bold',
        fontSize: 9,
    },
});
