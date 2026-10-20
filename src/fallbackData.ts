import type { Track } from './types';

export const DUMMY_TRACKS: Track[] = [
    {
        id: 77706588,
        title: "Sunset Boulevard",
        artist: { name: "The Midnight", id: 1 },
        album: { title: "Endless Summer", id: 1, cover: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=640&auto=format&fit=crop" },
        duration: 250,
        mediaMetadata: { tags: ["LOSSLESS", "HIRES_LOSSLESS"] }
    },
    {
        id: 64975060,
        title: "Nightcity",
        artist: { name: "Neon", id: 2 },
        album: { title: "Vibes", id: 2, cover: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=640&auto=format&fit=crop" },
        duration: 210,
        mediaMetadata: { tags: ["LOSSLESS"] }
    },
    {
        id: 79953939,
        title: "Ocean Drive",
        artist: { name: "Duke", id: 3 },
        album: { title: "Blasé Boys", id: 3, cover: "https://images.unsplash.com/photo-1493225457124-a1a2a4f0a4f4?q=80&w=640&auto=format&fit=crop" },
        duration: 220,
        mediaMetadata: { tags: ["LOSSLESS"] }
    },
    {
        id: 36313098,
        title: "Lost in Tokyo",
        artist: { name: "Kanji", id: 4 },
        album: { title: "Nightfall", id: 4, cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=640&auto=format&fit=crop" },
        duration: 195,
        mediaMetadata: { tags: ["LOSSLESS", "HIRES_LOSSLESS"] }
    },
    {
        id: 251170783,
        title: "Retrograde",
        artist: { name: "James Blake", id: 5 },
        album: { title: "Overgrown", id: 5, cover: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?q=80&w=640&auto=format&fit=crop" },
        duration: 231,
        mediaMetadata: { tags: ["LOSSLESS"] }
    }
];
