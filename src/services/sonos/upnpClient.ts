import axios from "axios";
import { ISonosDevice, ISonosPositionInfo, ISonosTrackMeta, SonosPlaybackState } from "./types";

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function formatSecondsToRelTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function parseRelTimeToSeconds(timeStr?: string): number {
    if (!timeStr || timeStr === "NOT_IMPLEMENTED" || timeStr.includes("?")) {
        return 0;
    }
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return 0;
}

export class UpnpClient {
    private static async sendSoap(
        device: ISonosDevice,
        service: "AVTransport" | "RenderingControl",
        action: string,
        argsXml: string
    ): Promise<string> {
        const serviceUrn = service === "AVTransport"
            ? "urn:schemas-upnp-org:service:AVTransport:1"
            : "urn:schemas-upnp-org:service:RenderingControl:1";

        const controlPath = service === "AVTransport" ? device.controlUrl : device.renderingControlUrl;
        const url = `${device.baseUrl}${controlPath}`;

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>` +
            `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
            `<s:Body>` +
            `<u:${action} xmlns:u="${serviceUrn}">` +
            argsXml +
            `</u:${action}>` +
            `</s:Body>` +
            `</s:Envelope>`;

        const response = await axios.post(url, soapBody, {
            headers: {
                "Content-Type": 'text/xml; charset="utf-8"',
                SOAPACTION: `"${serviceUrn}#${action}"`,
            },
            timeout: 5000,
        });

        return response.data;
    }

    static async setAVTransportURI(
        device: ISonosDevice,
        streamUrl: string,
        meta?: ISonosTrackMeta
    ): Promise<void> {
        const title = escapeXml(meta?.title ?? "MusicFree Track");
        const artist = escapeXml(meta?.artist ?? "MusicFree");
        const album = escapeXml(meta?.album ?? "");
        const artUrl = meta?.albumArtUrl ? escapeXml(meta.albumArtUrl) : "";

        const didlLite =
            `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
            `<item id="1" parentID="0" restricted="1">` +
            `<dc:title>${title}</dc:title>` +
            `<dc:creator>${artist}</dc:creator>` +
            (album ? `<upnp:album>${album}</upnp:album>` : "") +
            (artUrl ? `<upnp:albumArtURI>${artUrl}</upnp:albumArtURI>` : "") +
            `<upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
            `</item>` +
            `</DIDL-Lite>`;

        const argsXml =
            `<InstanceID>0</InstanceID>` +
            `<CurrentURI>${escapeXml(streamUrl)}</CurrentURI>` +
            `<CurrentURIMetaData>${escapeXml(didlLite)}</CurrentURIMetaData>`;

        await this.sendSoap(device, "AVTransport", "SetAVTransportURI", argsXml);
    }

    static async play(device: ISonosDevice): Promise<void> {
        await this.sendSoap(device, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
    }

    static async pause(device: ISonosDevice): Promise<void> {
        await this.sendSoap(device, "AVTransport", "Pause", "<InstanceID>0</InstanceID>");
    }

    static async stop(device: ISonosDevice): Promise<void> {
        await this.sendSoap(device, "AVTransport", "Stop", "<InstanceID>0</InstanceID>");
    }

    static async seek(device: ISonosDevice, targetSeconds: number): Promise<void> {
        const timeStr = formatSecondsToRelTime(targetSeconds);
        const argsXml = `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${timeStr}</Target>`;
        await this.sendSoap(device, "AVTransport", "Seek", argsXml);
    }

    static async getPositionInfo(device: ISonosDevice): Promise<ISonosPositionInfo> {
        const xml = await this.sendSoap(device, "AVTransport", "GetPositionInfo", "<InstanceID>0</InstanceID>");

        const trackDurationMatch = xml.match(/<TrackDuration>(.*?)<\/TrackDuration>/i);
        const relTimeMatch = xml.match(/<RelTime>(.*?)<\/RelTime>/i);
        const trackUriMatch = xml.match(/<TrackURI>(.*?)<\/TrackURI>/i);

        return {
            trackDuration: parseRelTimeToSeconds(trackDurationMatch?.[1]),
            relTime: parseRelTimeToSeconds(relTimeMatch?.[1]),
            trackUri: trackUriMatch?.[1] ?? "",
        };
    }

    static async getTransportInfo(device: ISonosDevice): Promise<SonosPlaybackState> {
        const xml = await this.sendSoap(device, "AVTransport", "GetTransportInfo", "<InstanceID>0</InstanceID>");
        const stateMatch = xml.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/i);
        const state = stateMatch?.[1]?.toUpperCase() ?? "STOPPED";
        return state as SonosPlaybackState;
    }

    static async setVolume(device: ISonosDevice, volume: number): Promise<void> {
        const clamped = Math.max(0, Math.min(100, Math.round(volume)));
        const argsXml = `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${clamped}</DesiredVolume>`;
        await this.sendSoap(device, "RenderingControl", "SetVolume", argsXml);
    }

    static async getVolume(device: ISonosDevice): Promise<number> {
        const xml = await this.sendSoap(device, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>");
        const volMatch = xml.match(/<CurrentVolume>(.*?)<\/CurrentVolume>/i);
        return parseInt(volMatch?.[1] ?? "0", 10);
    }
}
