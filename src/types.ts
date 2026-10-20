export interface Artist {
    id: number;
    name: string;
    picture?: string;
    popularity?: number;
    artistTypes?: string[];
}

export interface Album {
    id: number;
    title: string;
    cover: string;
    artist?: Artist;
    artists?: Artist[];
    numberOfTracks?: number;
    duration?: number;
    releaseDate?: string;
    audioQuality?: string;
    mediaMetadata?: {
        tags?: string[];
    };
    explicit?: boolean;
}

export interface Playlist {
    id: string;
    title: string;
    cover: string;
    numberOfTracks: number;
    duration: number;
    description?: string;
    creatorName?: string;
    updatedAt?: string;
}

export interface CatalogSearchResult {
    tracks: Track[];
    albums: Album[];
    artists: Artist[];
    playlists: Playlist[];
}

export interface VerifiedFormat {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
    bitDepth: number | null;
    bitrate?: number | null;
    bytes: number;
}

export interface Track {
    id: number;
    title: string;
    duration: number;
    artist: Artist;
    album: Album;
    audioQuality?: string;
    mediaMetadata?: {
        tags?: string[];
    };
    source?: 'tidal' | 'audius' | 'audiomack' | 'lucida';
    // Which upstream the service resolved this track from. 'tidal' means it came from the
    // search fallback (Deezer mirror down) and must be prepared via the Tidal pipeline.
    provider?: 'deezer' | 'tidal' | 'audius';
    /** Original non-numeric id used by providers such as Audius. */
    providerId?: string;
    localPath?: string;
    coverUrl?: string;
    isrc?: string;
    sourceUrl?: string;
    chartRank?: number;
    chartMarket?: string;
    artists?: Artist[];
    trackNumber?: number;
    explicit?: boolean;
    releaseDate?: string;
    popularity?: number;
}

export interface SearchResponse {
    items: Track[];
    totalNumberOfItems: number;
}
