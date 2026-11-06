import { NativeModules, DeviceEventEmitter } from "react-native";
import DeviceInfo from "react-native-device-info";
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
        if (SonosModule?.clearNativeLogs) {
            SonosModule.clearNativeLogs();
        }
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

        const buildNum = DeviceInfo?.getBuildNumber?.() ?? "unknown";
        this.addLog(`SonosManager initialized (Build ${buildNum}).`);

        // Listen to native real-time logs from Kotlin proxy
        DeviceEventEmitter.addListener("SonosNativeLog", (logLine: string) => {
            this.logs.unshift(logLine);
            if (this.logs.length > 80) this.logs.pop();
            this.emit(SonosEvents.LogsUpdated, [...this.logs]);
        });

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
        if (this.activeDevice?.id === device.id && this.isCasting) {
            this.addLog(`Already connected to ${device.name}. Re-casting current track...`);
            const currentMusic = TrackPlayer.currentMusic;
            if (currentMusic) {
                try {
                    await this.playTrackOnSonos(currentMusic);
                    return true;
                } catch (e: any) {
                    this.addLog(`Failed to re-cast: ${e?.message}`);
                    Toast.warn(`Cast failed: ${e?.message ?? "Unknown error"}`);
                    return false;
                }
            } else {
                Toast.success(`Connected to ${device.name}. Select a song to play!`);
                return true;
            }
        }

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
        // 1. Primary: Always fetch a FRESH signed stream URL from the plugin.
        // Cached or stored URLs from previous sessions expire quickly (NetEase/QQ/Bili token expiration).
        try {
            const plugin =
                PluginManager.getByMedia(musicItem) ??
                (musicItem.platform ? PluginManager.getByName(musicItem.platform) : undefined);

            if (plugin?.methods?.getMediaSource) {
                this.addLog(`Requesting fresh stream from plugin: ${plugin.name || musicItem.platform}...`);
                const preferredQuality: IMusic.IQualityKey =
                    this.settings.audioFormat === "flac" ? "super" : "standard";
                const qualities: (IMusic.IQualityKey | string)[] = [
                    preferredQuality,
                    "standard",
                    "high",
                    "super",
                    "128k",
                    "320k",
                    "flac",
                ];

                for (const q of qualities) {
                    try {
                        const src = await plugin.methods.getMediaSource(musicItem, q as any);
                        if (src?.url && !src.url.startsWith("musicfree://")) {
                            this.addLog(`Fresh stream obtained (${q}): ${src.url.substring(0, 60)}...`);
                            return {
                                url: src.url,
                                headers: (src.headers as Record<string, string>) || {},
                            };
                        }
                    } catch {}
                }
            }
        } catch (e: any) {
            this.addLog(`Plugin stream fetch notice: ${e?.message}`);
        }

        // 2. Fallback: Check if ReactNativeTrackPlayer currently has a real URL loaded
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

        // 3. Fallback: Check mediaCache
        const cached = mediaCache.getMediaCache(musicItem) as IMusic.IMusicItem | null;
        if (cached?.url && !cached.url.startsWith("musicfree://")) {
            return { url: cached.url, headers: {} };
        }

        // 4. Fallback: Check musicItem sources
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

        // 5. Fallback: Check musicItem.url
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

        // Infer MIME type for Sonos <res protocolInfo="http-get:*:MIME:*">
        let mimeType = "audio/mpeg";
        const cleanUrl = realUrl.toLowerCase().split("?")[0];
        if (cleanUrl.endsWith(".flac") || this.settings.audioFormat === "flac") {
            mimeType = "audio/flac";
        } else if (cleanUrl.endsWith(".wav") || this.settings.audioFormat === "wav") {
            mimeType = "audio/wav";
        } else if (cleanUrl.endsWith(".m4a") || cleanUrl.endsWith(".mp4")) {
            mimeType = "audio/mp4";
        } else if (cleanUrl.endsWith(".aac")) {
            mimeType = "audio/aac";
        } else if (cleanUrl.endsWith(".ogg")) {
            mimeType = "audio/ogg";
        }

        const meta: ISonosTrackMeta = {
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            albumArtUrl: musicItem.artwork,
            duration: musicItem.duration,
        };

        // 1. Jellyfin Pre-Stop Sequence: ensure speaker transport is STOPPED before loading track
        this.addLog("Ensuring speaker transport is STOPPED before loading track...");
        try {
            await UpnpClient.stop(this.activeDevice);
        } catch (ignored) {}

        // Clear any queued next track
        await UpnpClient.clearNextAVTransportURI(this.activeDevice);

        // Allow speaker 150ms to settle state
        await new Promise((r) => setTimeout(r, 150));

        // 2. SetAVTransportURI with DIDL-Lite <res> tag, fallback to minimal
        this.addLog(`Sending SetAVTransportURI (MIME: ${mimeType}) to ${this.activeDevice.name}...`);
        try {
            await UpnpClient.setAVTransportURI(this.activeDevice, streamUrl, meta, mimeType);
        } catch (metaErr: any) {
            this.addLog(`SetAVTransportURI with DIDL metadata notice: ${metaErr?.message}. Retrying with minimal URI...`);
            await UpnpClient.setAVTransportURIMinimal(this.activeDevice, streamUrl);
        }

        // 3. Small delay for Sonos internal player to bind URI
        await new Promise((r) => setTimeout(r, 150));

        // 4. Send Play (with retry if speaker is still in TRANSITIONING state)
        this.addLog(`Sending Play to ${this.activeDevice.name}...`);
        let playError: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await UpnpClient.play(this.activeDevice);
                playError = null;
                break;
            } catch (err: any) {
                playError = err;
                this.addLog(`Play attempt ${attempt} notice: ${err?.message}. Retrying in 400ms...`);
                await new Promise((r) => setTimeout(r, 400));
            }
        }
        if (playError) {
            throw playError;
        }

        this.playbackState = "PLAYING";
        this.emit(SonosEvents.PlaybackStateChanged, "PLAYING");
        this.addLog(`Playback successfully initiated on ${this.activeDevice.name}!`);
        Toast.success(`Playing on ${this.activeDevice.name}`);

        // 5. Active verification of Sonos playback state after 1.5s
        setTimeout(async () => {
            if (!this.activeDevice || !this.isCasting) return;
            try {
                const detail = await UpnpClient.getTransportInfoDetailed(this.activeDevice);
                this.addLog(`Sonos verified state: ${detail.state} (status: ${detail.status})`);
                if (detail.state === "STOPPED" || detail.status === "ERROR_OCCURRED") {
                    this.addLog(`[DIAGNOSTIC] Speaker stopped immediately! Status: ${detail.status}`);
                    Toast.warn(`Cast alert: Speaker stopped (${detail.status})`);
                }
            } catch (err: any) {
                this.addLog(`Playback verification check: ${err?.message}`);
            }
        }, 1500);
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
