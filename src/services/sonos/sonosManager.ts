import { NativeModules } from "react-native";
import EventEmitter from "eventemitter3";
import ReactNativeTrackPlayer from "react-native-track-player";
import TrackPlayer, { useCurrentMusic } from "@/core/trackPlayer";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import mediaCache from "@/core/mediaCache";
import { ISonosDevice, ISonosPositionInfo, ISonosTrackMeta, SonosPlaybackState } from "./types";
import { UpnpClient } from "./upnpClient";

const { SonosModule } = NativeModules;

export enum SonosEvents {
    DevicesUpdated = "DevicesUpdated",
    ActiveDeviceChanged = "ActiveDeviceChanged",
    PlaybackStateChanged = "PlaybackStateChanged",
    PositionUpdated = "PositionUpdated",
    VolumeChanged = "VolumeChanged",
}

class SonosManager extends EventEmitter {
    private devices: ISonosDevice[] = [];
    private activeDevice: ISonosDevice | null = null;
    private isCasting: boolean = false;
    private proxyBaseUrl: string | null = null;
    private pollTimer: NodeJS.Timeout | null = null;
    private playbackState: SonosPlaybackState = "IDLE";
    private positionInfo: ISonosPositionInfo = { trackDuration: 0, relTime: 0, trackUri: "" };
    private volume: number = 20;

    constructor() {
        super();
    }

    init() {
        if (!SonosModule) {
            console.warn("SonosModule native module not available.");
            return;
        }

        // Non-invasively listen for track changes
        TrackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, async (musicItem) => {
            if (this.isCasting && this.activeDevice && musicItem) {
                try {
                    await this.playTrackOnSonos(musicItem);
                } catch (e) {
                    console.error("Failed to play track on Sonos after track change", e);
                }
            }
        });
    }

    async discoverDevices(timeoutMs = 3500): Promise<ISonosDevice[]> {
        if (!SonosModule?.startDiscovery) {
            return [];
        }
        try {
            const list: ISonosDevice[] = await SonosModule.startDiscovery(timeoutMs);
            this.devices = list;
            this.emit(SonosEvents.DevicesUpdated, this.devices);
            return list;
        } catch (e) {
            console.warn("Sonos discovery error:", e);
            return [];
        }
    }

    getDevices(): ISonosDevice[] {
        return this.devices;
    }

    getActiveDevice(): ISonosDevice | null {
        return this.activeDevice;
    }

    getIsCasting(): boolean {
        return this.isCasting;
    }

    getPlaybackState(): SonosPlaybackState {
        return this.playbackState;
    }

    getPositionInfo(): ISonosPositionInfo {
        return this.positionInfo;
    }

    getVolume(): number {
        return this.volume;
    }

    async connectAndCast(device: ISonosDevice): Promise<boolean> {
        try {
            this.activeDevice = device;
            this.isCasting = true;
            this.emit(SonosEvents.ActiveDeviceChanged, this.activeDevice);

            // 1. Start audio proxy server
            if (!this.proxyBaseUrl && SonosModule?.startAudioProxy) {
                const proxyInfo = await SonosModule.startAudioProxy();
                this.proxyBaseUrl = proxyInfo.baseUrl;
            }

            // 2. Query initial volume
            try {
                this.volume = await UpnpClient.getVolume(device);
                this.emit(SonosEvents.VolumeChanged, this.volume);
            } catch {}

            // 3. Mute local phone playback
            await ReactNativeTrackPlayer.setVolume(0);

            // 4. Play current track
            const currentMusic = TrackPlayer.currentMusic;
            if (currentMusic) {
                await this.playTrackOnSonos(currentMusic);
            }

            // 5. Start position and state polling
            this.startPolling();

            return true;
        } catch (e) {
            console.error("Failed to connect and cast to Sonos:", e);
            await this.disconnect();
            return false;
        }
    }

    async disconnect(): Promise<void> {
        this.stopPolling();

        if (this.activeDevice) {
            try {
                await UpnpClient.stop(this.activeDevice);
            } catch {}
        }

        // Restore local phone audio
        try {
            await ReactNativeTrackPlayer.setVolume(1);
        } catch {}

        this.activeDevice = null;
        this.isCasting = false;
        this.playbackState = "IDLE";
        this.positionInfo = { trackDuration: 0, relTime: 0, trackUri: "" };

        this.emit(SonosEvents.ActiveDeviceChanged, null);
        this.emit(SonosEvents.PlaybackStateChanged, "IDLE");
    }

    async play(): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            await UpnpClient.play(this.activeDevice);
            this.playbackState = "PLAYING";
            this.emit(SonosEvents.PlaybackStateChanged, "PLAYING");
            // Also sync local TrackPlayer state without un-muting
            TrackPlayer.play();
        } catch (e) {
            console.warn("Sonos play error:", e);
        }
    }

    async pause(): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            await UpnpClient.pause(this.activeDevice);
            this.playbackState = "PAUSED_PLAYBACK";
            this.emit(SonosEvents.PlaybackStateChanged, "PAUSED_PLAYBACK");
            TrackPlayer.pause();
        } catch (e) {
            console.warn("Sonos pause error:", e);
        }
    }

    async seekTo(seconds: number): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            await UpnpClient.seek(this.activeDevice, seconds);
            this.positionInfo.relTime = seconds;
            this.emit(SonosEvents.PositionUpdated, this.positionInfo);
            TrackPlayer.seekTo(seconds);
        } catch (e) {
            console.warn("Sonos seek error:", e);
        }
    }

    async setVolume(vol: number): Promise<void> {
        if (!this.activeDevice) return;
        try {
            await UpnpClient.setVolume(this.activeDevice, vol);
            this.volume = vol;
            this.emit(SonosEvents.VolumeChanged, this.volume);
        } catch (e) {
            console.warn("Sonos setVolume error:", e);
        }
    }

    private async playTrackOnSonos(musicItem: IMusic.IMusicItem): Promise<void> {
        if (!this.activeDevice) return;

        // Resolve audio source (check cached media item first, then musicItem properties)
        const cached = mediaCache.getMediaCache(musicItem) as IMusic.IMusicItem | null;
        const targetItem = cached ?? musicItem;

        let realUrl = targetItem.url;
        let headers: Record<string, string> = {};

        if (targetItem.source) {
            // Find highest available quality source
            const qualities = ["128k", "320k", "flac", "standard", "super", "high", "low"];
            for (const q of qualities) {
                if (targetItem.source[q]?.url) {
                    realUrl = targetItem.source[q]!.url;
                    headers = (targetItem.source[q]!.headers as Record<string, string>) ?? {};
                    break;
                }
            }
        }

        if (!realUrl) {
            console.warn("No real URL found for Sonos track:", targetItem.title);
            return;
        }

        // Generate proxy URL
        const proxyStreamUrl = this.buildProxyUrl(realUrl, headers);

        const meta: ISonosTrackMeta = {
            title: targetItem.title,
            artist: targetItem.artist,
            album: targetItem.album,
            albumArtUrl: targetItem.artwork,
            duration: targetItem.duration,
        };

        await UpnpClient.setAVTransportURI(this.activeDevice, proxyStreamUrl, meta);
        await UpnpClient.play(this.activeDevice);
        this.playbackState = "PLAYING";
        this.emit(SonosEvents.PlaybackStateChanged, "PLAYING");
    }

    private buildProxyUrl(rawUrl: string, headers: Record<string, string>): string {
        if (!this.proxyBaseUrl) {
            return rawUrl;
        }
        // Base64 encode parameters for clean URL transport
        const encodedUrl = Buffer.from(rawUrl).toString("base64");
        const encodedHeaders = Buffer.from(JSON.stringify(headers)).toString("base64");
        return `${this.proxyBaseUrl}/stream?url=${encodeURIComponent(encodedUrl)}&headers=${encodeURIComponent(encodedHeaders)}`;
    }

    private startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(async () => {
            if (!this.activeDevice || !this.isCasting) {
                this.stopPolling();
                return;
            }
            try {
                const pos = await UpnpClient.getPositionInfo(this.activeDevice);
                this.positionInfo = pos;
                this.emit(SonosEvents.PositionUpdated, pos);

                const state = await UpnpClient.getTransportInfo(this.activeDevice);
                if (state !== this.playbackState) {
                    this.playbackState = state;
                    this.emit(SonosEvents.PlaybackStateChanged, state);
                }
            } catch (ignored) {}
        }, 1000);
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
}

export const sonosManager = new SonosManager();
export default sonosManager;
