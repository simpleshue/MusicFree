import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

export interface ISonosSettings {
    audioFormat: "original" | "wav" | "mp3" | "flac";
    wavStreamingMethod: "chunked" | "fixed_header";
    sampleRate: 44100 | 48000 | 96000;
    bufferDurationMs: 500 | 1000 | 2000 | 5000;
    directStreaming: boolean;
}

export const DEFAULT_SONOS_SETTINGS: ISonosSettings = {
    audioFormat: "original",
    wavStreamingMethod: "chunked",
    sampleRate: 44100,
    bufferDurationMs: 1000,
    directStreaming: false,
};

const store = getOrCreateMMKV("sonos.settings");

export function getSonosSettings(): ISonosSettings {
    const raw = store.getString("config");
    if (!raw) return DEFAULT_SONOS_SETTINGS;
    return { ...DEFAULT_SONOS_SETTINGS, ...safeParse<ISonosSettings>(raw) };
}

export function saveSonosSettings(settings: Partial<ISonosSettings>): ISonosSettings {
    const current = getSonosSettings();
    const updated = { ...current, ...settings };
    store.set("config", safeStringify(updated));
    return updated;
}
