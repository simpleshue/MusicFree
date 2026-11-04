import { NativeModules } from "react-native";
import EventEmitter from "eventemitter3";
import ReactNativeTrackPlayer from "react-native-track-player";
import TrackPlayer from "@/core/trackPlayer";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import mediaCache from "@/core/mediaCache";
import PluginManager from "@/core/pluginManager";
import Toast from "@/utils/toast";
import { ISonosDevice, ISonosPositionInfo, ISonosTrackMeta, SonosPlaybackState } from "./types";
import { UpnpClient } from "./upnpClient";
import { getSonosSettings, ISonosSettings, saveSonosSettings } from "./settings";

const { SonosModule } = NativeModules;

export enum SonosEvents {
    DevicesUpdated = "DevicesUpdated",
    ActiveDeviceChanged = "ActiveDeviceChanged",
    PlaybackStateChanged = "PlaybackStateChanged",
    PositionUpdated = "PositionUpdated",
    VolumeChanged = "VolumeChanged",
    LogsUpdated = "LogsUpdated",
    SettingsUpdated = "SettingsUpdated",
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
    private logs: string[] = [];
    private settings: ISonosSettings = getSonosSettings();

    constructor() {
        super();
    }

    addLog(msg: string) {
        const time = new Date().toLocaleTimeString();
        const logLine = `[${time}] ${msg}`;
        this.logs.unshift(logLine);
        if (this.logs.length > 80) this.logs.pop();
        this.emit(SonosEvents.LogsUpdated, [...this.logs]);
        console.log(`[SonosManager] ${logLine}`);
    }

    getLogs(): string[] {
        return this.logs;
    }

    clearLogs() {
        this.logs = [];
        this.emit(SonosEvents.LogsUpdated, []);
    }

    getSettings(): ISonosSettings {
        return this.settings;
    }

    updateSettings(newSettings: Partial<ISonosSettings>) {
        this.settings = saveSonosSettings(newSettings);
        if (SonosModule?.updateSettings) {
            SonosModule.updateSettings(this.settings);
        }
        this.addLog(`Settings updated: format=${this.settings.audioFormat}, buffer=${this.settings.bufferDurationMs}ms`);
        this.emit(SonosEvents.SettingsUpdated, this.settings);
    }

    init() {
        if (!SonosModule) {
            this.addLog("WARN: SonosModule native module not available.");
            return;
        }

        this.addLog("SonosManager initialized.");

        // Non-invasively listen for track changes
        TrackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, async (musicItem) => {
            if (this.isCasting && this.activeDevice && musicItem) {
                this.addLog(`Track changed to: ${musicItem.title}`);
                try {
                    await this.playTrackOnSonos(musicItem);
                } catch (e: any) {
                    this.addLog(`ERROR playing track on Sonos: ${e?.message}`);
                    Toast.warn(`Cast Error: ${e?.message ?? "Failed to play"}`);
                }
            }
        });
    }

    async discoverDevices(timeoutMs = 3500): Promise<ISonosDevice[]> {
        if (!SonosModule?.startDiscovery) {
            this.addLog("ERROR: startDiscovery method missing in native module.");
            return [];
        }
        try {
            this.addLog(`Scanning local Wi-Fi for Sonos devices (${timeoutMs}ms)...`);
            const list: ISonosDevice[] = await SonosModule.startDiscovery(timeoutMs);
            this.devices = list;
            this.addLog(`Discovery finished. Found ${list.length} Sonos device(s).`);
            this.emit(SonosEvents.DevicesUpdated, this.devices);
            return list;
        } catch (e: any) {
            this.addLog(`Discovery error: ${e?.message}`);
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
        this.addLog(`Connecting to: ${device.name} (${device.ip}:${device.port})...`);
        Toast.success(`Connecting to ${device.name}...`);

        try {
            this.activeDevice = device;
            this.isCasting = true;
            this.emit(SonosEvents.ActiveDeviceChanged, this.activeDevice);

            // 1. Start audio proxy server with current settings
            if (SonosModule?.startAudioProxy) {
                const proxyInfo = await SonosModule.startAudioProxy(this.settings, device.ip);
                this.proxyBaseUrl = proxyInfo.baseUrl;
                this.addLog(`Audio proxy ready at: ${this.proxyBaseUrl}`);
            }

            // 2. Query initial volume from speaker
            try {
                this.volume = await UpnpClient.getVolume(device);
                this.addLog(`Current speaker volume: ${this.volume}%`);
                this.emit(SonosEvents.VolumeChanged, this.volume);
            } catch (e: any) {
                this.addLog(`Could not get initial volume: ${e?.message}`);
            }

            // 3. Mute local phone audio so it only plays via Sonos
            await ReactNativeTrackPlayer.setVolume(0);

            // 4. Resolve and play the current music
            const currentMusic = TrackPlayer.currentMusic;
            if (currentMusic) {
                await this.playTrackOnSonos(currentMusic);
            } else {
                this.addLog("No track currently selected. Tap any song to play on Sonos.");
                Toast.success(`Connected to ${device.name}. Play a song to cast!`);
            }

            // 5. Start position and state polling
            this.startPolling();

            return true;
        } catch (e: any) {
            this.addLog(`Failed to connect/cast: ${e?.message}`);
            Toast.warn(`Cast failed: ${e?.message ?? "Unknown error"}`);
            await this.disconnect();
            return false;
        }
    }

    async disconnect(): Promise<void> {
        this.stopPolling();

        if (this.activeDevice) {
            this.addLog(`Disconnecting from ${this.activeDevice.name}...`);
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
        this.addLog("Disconnected from device. Phone audio restored.");
        Toast.success("Disconnected from device");
    }

    async play(): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            this.addLog("Sending Play command to Sonos...");
            await UpnpClient.play(this.activeDevice);
            this.playbackState = "PLAYING";
            this.emit(SonosEvents.PlaybackStateChanged, "PLAYING");
            TrackPlayer.play();
        } catch (e: any) {
            this.addLog(`Sonos play error: ${e?.message}`);
        }
    }

    async pause(): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            this.addLog("Sending Pause command to Sonos...");
            await UpnpClient.pause(this.activeDevice);
            this.playbackState = "PAUSED_PLAYBACK";
            this.emit(SonosEvents.PlaybackStateChanged, "PAUSED_PLAYBACK");
            TrackPlayer.pause();
        } catch (e: any) {
            this.addLog(`Sonos pause error: ${e?.message}`);
        }
    }

    async seekTo(seconds: number): Promise<void> {
        if (!this.activeDevice || !this.isCasting) return;
        try {
            this.addLog(`Seeking Sonos to ${seconds.toFixed(0)}s...`);
            await UpnpClient.seek(this.activeDevice, seconds);
            this.positionInfo.relTime = seconds;
            this.emit(SonosEvents.PositionUpdated, this.positionInfo);
            TrackPlayer.seekTo(seconds);
        } catch (e: any) {
            this.addLog(`Sonos seek error: ${e?.message}`);
        }
    }

    async setVolume(vol: number): Promise<void> {
        if (!this.activeDevice) return;
        try {
            await UpnpClient.setVolume(this.activeDevice, vol);
            this.volume = vol;
            this.emit(SonosEvents.VolumeChanged, this.volume);
        } catch (e: any) {
            this.addLog(`Sonos setVolume error: ${e?.message}`);
        }
    }

    private async resolveTrackSource(
        musicItem: IMusic.IMusicItem
    ): Promise<{ url: string; headers: Record<string, string> }> {
        // 1. Check if ReactNativeTrackPlayer currently has a real URL loaded
        try {
            const queue = await ReactNativeTrackPlayer.getQueue();
            if (
                queue &&
                queue[0] &&
                queue[0].url &&
                !queue[0].url.startsWith("musicfree://")
            ) {
                return {
                    url: queue[0].url,
                    headers: (queue[0].headers as Record<string, string>) || {},
                };
            }
        } catch {}

        // 2. Check mediaCache
        const cached = mediaCache.getMediaCache(musicItem) as IMusic.IMusicItem | null;
        if (cached?.url && !cached.url.startsWith("musicfree://")) {
            return { url: cached.url, headers: {} };
        }

        // 3. Check musicItem sources
        if (musicItem.source) {
            const qualities = ["128k", "320k", "flac", "standard", "super", "high", "low"];
            for (const q of qualities) {
                if (musicItem.source[q]?.url) {
                    return {
                        url: musicItem.source[q]!.url,
                        headers: (musicItem.source[q]!.headers as Record<string, string>) || {},
                    };
                }
            }
        }

        // 4. Query plugin directly if available
        if (musicItem.platform) {
            try {
                const plugin = PluginManager.getByName(musicItem.platform);
                if (plugin?.methods?.getMediaSource) {
                    this.addLog(`Resolving stream from plugin: ${musicItem.platform}...`);
                    const src = await plugin.methods.getMediaSource(musicItem, "standard");
                    if (src?.url) {
                        return {
                            url: src.url,
                            headers: (src.headers as Record<string, string>) || {},
                        };
                    }
                }
            } catch (e: any) {
                this.addLog(`Plugin getMediaSource notice: ${e?.message}`);
            }
        }

        if (musicItem.url && !musicItem.url.startsWith("musicfree://")) {
            return { url: musicItem.url, headers: {} };
        }

        throw new Error(`No audio stream URL available for "${musicItem.title}".`);
    }

    private async playTrackOnSonos(musicItem: IMusic.IMusicItem): Promise<void> {
        if (!this.activeDevice) return;

        this.addLog(`Resolving audio source for: "${musicItem.title}" - ${musicItem.artist}...`);
        const { url: realUrl, headers } = await this.resolveTrackSource(musicItem);
        this.addLog(`Stream resolved: ${realUrl.substring(0, 60)}... (headers: ${Object.keys(headers).length})`);

        // Check if direct streaming is requested and possible
        let streamUrl: string;
        const hasHeaders = Object.keys(headers).length > 0;
        const isRemoteHttp = realUrl.startsWith("http://") || realUrl.startsWith("https://");

        if (this.settings.directStreaming && !hasHeaders && isRemoteHttp) {
            streamUrl = realUrl;
            this.addLog("Using Direct Stream URL (bypassing proxy).");
        } else {
            if (!this.proxyBaseUrl && SonosModule?.startAudioProxy) {
                const proxyInfo = await SonosModule.startAudioProxy(this.settings, this.activeDevice.ip);
                this.proxyBaseUrl = proxyInfo.baseUrl;
            }
            streamUrl = this.buildProxyUrl(realUrl, headers);
            this.addLog(`Using Local Audio Proxy URL: ${streamUrl.substring(0, 70)}...`);
        }

        const meta: ISonosTrackMeta = {
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            albumArtUrl: musicItem.artwork,
            duration: musicItem.duration,
        };

        this.addLog(`Sending SetAVTransportURI to ${this.activeDevice.name}...`);
        await UpnpClient.setAVTransportURI(this.activeDevice, streamUrl, meta);

        this.addLog(`Sending Play to ${this.activeDevice.name}...`);
        await UpnpClient.play(this.activeDevice);

        this.playbackState = "PLAYING";
        this.emit(SonosEvents.PlaybackStateChanged, "PLAYING");
        this.addLog(`Playback successfully initiated on ${this.activeDevice.name}!`);
        Toast.success(`Playing on ${this.activeDevice.name}`);
    }

    private buildProxyUrl(rawUrl: string, headers: Record<string, string>): string {
        if (!this.proxyBaseUrl) {
            return rawUrl;
        }
        // Use pure standard encodeURIComponent (100% React Native safe, no Node Buffer)
        const encodedUrl = encodeURIComponent(rawUrl);
        const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
        return `${this.proxyBaseUrl}/stream?url=${encodedUrl}&headers=${encodedHeaders}`;
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
