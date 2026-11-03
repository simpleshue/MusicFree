export interface ISonosDevice {
    id: string;
    name: string;
    model: string;
    ip: string;
    port: number;
    baseUrl: string;
    controlUrl: string;
    renderingControlUrl: string;
}

export interface ISonosTrackMeta {
    title: string;
    artist: string;
    album?: string;
    albumArtUrl?: string;
    duration?: number;
}

export interface ISonosPositionInfo {
    trackDuration: number; // in seconds
    relTime: number;       // in seconds
    trackUri: string;
}

export type SonosPlaybackState = "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED" | "TRANSITIONING" | "IDLE";
