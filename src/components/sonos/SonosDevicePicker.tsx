import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import Divider from "@/components/base/divider";
import sonosManager, { SonosEvents } from "@/services/sonos/sonosManager";
import { ISonosDevice } from "@/services/sonos/types";
import { ISonosSettings } from "@/services/sonos/settings";
import Svg, { Path } from "react-native-svg";

export function CastIcon({ color = "white", size = 24 }: { color?: string; size?: number }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
                fill={color}
            />
        </Svg>
    );
}

export function GearIcon({ color = "white", size = 20 }: { color?: string; size?: number }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
            <Path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
            <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
        </Svg>
    );
}

interface ISonosDevicePickerProps {
    visible: boolean;
    onClose: () => void;
}

type TabType = "devices" | "settings" | "logs";

export default function SonosDevicePicker({ visible, onClose }: ISonosDevicePickerProps) {
    const colors = useColors();
    const [currentTab, setCurrentTab] = useState<TabType>("devices");
    const [devices, setDevices] = useState<ISonosDevice[]>(sonosManager.getDevices());
    const [activeDevice, setActiveDevice] = useState<ISonosDevice | null>(sonosManager.getActiveDevice());
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [volume, setVolume] = useState<number>(sonosManager.getVolume());
    const [settings, setSettings] = useState<ISonosSettings>(sonosManager.getSettings());
    const [logs, setLogs] = useState<string[]>(sonosManager.getLogs());

    const refreshDevices = async () => {
        setIsScanning(true);
        try {
            const list = await sonosManager.discoverDevices(3500);
            setDevices(list);
        } finally {
            setIsScanning(false);
        }
    };

    useEffect(() => {
        if (visible) {
            setActiveDevice(sonosManager.getActiveDevice());
            setVolume(sonosManager.getVolume());
            setSettings(sonosManager.getSettings());
            setLogs(sonosManager.getLogs());
            refreshDevices();
        }

        const onDevicesUpdated = (list: ISonosDevice[]) => setDevices([...list]);
        const onActiveDeviceChanged = (dev: ISonosDevice | null) => setActiveDevice(dev);
        const onVolumeChanged = (vol: number) => setVolume(vol);
        const onLogsUpdated = (lines: string[]) => setLogs([...lines]);
        const onSettingsUpdated = (s: ISonosSettings) => setSettings({ ...s });

        sonosManager.on(SonosEvents.DevicesUpdated, onDevicesUpdated);
        sonosManager.on(SonosEvents.ActiveDeviceChanged, onActiveDeviceChanged);
        sonosManager.on(SonosEvents.VolumeChanged, onVolumeChanged);
        sonosManager.on(SonosEvents.LogsUpdated, onLogsUpdated);
        sonosManager.on(SonosEvents.SettingsUpdated, onSettingsUpdated);

        return () => {
            sonosManager.off(SonosEvents.DevicesUpdated, onDevicesUpdated);
            sonosManager.off(SonosEvents.ActiveDeviceChanged, onActiveDeviceChanged);
            sonosManager.off(SonosEvents.VolumeChanged, onVolumeChanged);
            sonosManager.off(SonosEvents.LogsUpdated, onLogsUpdated);
            sonosManager.off(SonosEvents.SettingsUpdated, onSettingsUpdated);
        };
    }, [visible]);

    const handleSelectDevice = async (device: ISonosDevice) => {
        if (activeDevice?.id === device.id) {
            return;
        }
        await sonosManager.connectAndCast(device);
    };

    const handleDisconnect = async () => {
        await sonosManager.disconnect();
    };

    const adjustVolume = async (delta: number) => {
        const nextVol = Math.max(0, Math.min(100, volume + delta));
        setVolume(nextVol);
        await sonosManager.setVolume(nextVol);
    };

    const updateSettingOption = <K extends keyof ISonosSettings>(key: K, value: ISonosSettings[K]) => {
        sonosManager.updateSettings({ [key]: value });
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={[styles.modalCard, { backgroundColor: colors.card || "#222" }]}>
                            {/* Header */}
                            <View style={styles.header}>
                                <View style={styles.headerTitleRow}>
                                    <CastIcon size={rpx(36)} color={colors.text} />
                                    <ThemeText fontSize="title" fontWeight="bold" style={styles.titleText}>
                                        Cast to a device
                                    </ThemeText>
                                </View>
                                <View style={styles.headerButtons}>
                                    <TouchableOpacity
                                        style={[styles.tabBtn, currentTab === "devices" && styles.activeTabBtn]}
                                        onPress={() => setCurrentTab("devices")}>
                                        <ThemeText
                                            fontSize="description"
                                            fontWeight={currentTab === "devices" ? "bold" : "regular"}
                                            fontColor={currentTab === "devices" ? "textHighlight" : "textSecondary"}>
                                            Devices
                                        </ThemeText>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.tabBtn, currentTab === "settings" && styles.activeTabBtn]}
                                        onPress={() => setCurrentTab("settings")}>
                                        <ThemeText
                                            fontSize="description"
                                            fontWeight={currentTab === "settings" ? "bold" : "regular"}
                                            fontColor={currentTab === "settings" ? "textHighlight" : "textSecondary"}>
                                            Settings
                                        </ThemeText>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.tabBtn, currentTab === "logs" && styles.activeTabBtn]}
                                        onPress={() => setCurrentTab("logs")}>
                                        <ThemeText
                                            fontSize="description"
                                            fontWeight={currentTab === "logs" ? "bold" : "regular"}
                                            fontColor={currentTab === "logs" ? "textHighlight" : "textSecondary"}>
                                            Logs
                                        </ThemeText>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
                                        <ThemeText fontColor="textSecondary">✕</ThemeText>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <Divider style={styles.divider} />

                            {/* TAB 1: SPEAKERS */}
                            {currentTab === "devices" && (
                                <View>
                                    {/* Active Device Controls */}
                                    {activeDevice ? (
                                        <View style={[styles.activeCard, { borderColor: colors.textHighlight || "#1890ff" }]}>
                                            <View style={styles.activeHeader}>
                                                <View style={{ flex: 1, marginRight: rpx(16) }}>
                                                    <ThemeText fontWeight="bold" fontSize="subTitle" numberOfLines={1} ellipsizeMode="tail">
                                                        Connected: {activeDevice.name}
                                                    </ThemeText>
                                                    <ThemeText fontColor="textSecondary" fontSize="description" numberOfLines={1} ellipsizeMode="tail">
                                                        {activeDevice.model} ({activeDevice.ip})
                                                    </ThemeText>
                                                </View>
                                                <TouchableOpacity
                                                    style={[styles.disconnectBtn, { backgroundColor: "#e53935", flexShrink: 0 }]}
                                                    onPress={handleDisconnect}>
                                                    <ThemeText style={styles.btnText} fontWeight="bold">
                                                        Disconnect
                                                    </ThemeText>
                                                </TouchableOpacity>
                                            </View>

                                            {/* Volume control */}
                                            <View style={styles.volumeRow}>
                                                <ThemeText fontColor="textSecondary" fontSize="description">
                                                    Volume: {volume}%
                                                </ThemeText>
                                                <View style={styles.volumeButtons}>
                                                    <TouchableOpacity
                                                        style={[styles.volStepBtn, { backgroundColor: colors.pageBackground || "#333" }]}
                                                        onPress={() => adjustVolume(-5)}>
                                                        <ThemeText fontSize="subTitle" fontWeight="bold">-</ThemeText>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={[styles.volStepBtn, { backgroundColor: colors.pageBackground || "#333" }]}
                                                        onPress={() => adjustVolume(5)}>
                                                        <ThemeText fontSize="subTitle" fontWeight="bold">+</ThemeText>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        </View>
                                    ) : null}

                                    <View style={styles.sectionHeaderRow}>
                                        <ThemeText fontColor="textSecondary" fontSize="description" style={styles.sectionTitle}>
                                            AVAILABLE DEVICES
                                        </ThemeText>
                                        <TouchableOpacity
                                            style={styles.actionBtn}
                                            onPress={refreshDevices}
                                            disabled={isScanning}>
                                            {isScanning ? (
                                                <ActivityIndicator size="small" color={colors.textHighlight || "#1890ff"} />
                                            ) : (
                                                <ThemeText fontColor="textHighlight" fontSize="description" fontWeight="medium">
                                                    Rescan
                                                </ThemeText>
                                            )}
                                        </TouchableOpacity>
                                    </View>

                                    <ScrollView style={styles.deviceList} contentContainerStyle={styles.deviceListContent}>
                                        {devices.length === 0 ? (
                                            <View style={styles.emptyContainer}>
                                                {isScanning ? (
                                                    <ThemeText fontColor="textSecondary">Scanning local Wi-Fi network...</ThemeText>
                                                ) : (
                                                    <>
                                                        <ThemeText fontColor="textSecondary" style={styles.emptyText}>
                                                            No devices found.
                                                        </ThemeText>
                                                        <ThemeText fontColor="textSecondary" fontSize="description" style={styles.emptySubText}>
                                                            Ensure your phone and device are on the same Wi-Fi network.
                                                        </ThemeText>
                                                    </>
                                                )}
                                            </View>
                                        ) : (
                                            devices.map((dev) => {
                                                const isCurrent = activeDevice?.id === dev.id;
                                                return (
                                                    <TouchableOpacity
                                                        key={dev.id}
                                                        style={[
                                                            styles.deviceItem,
                                                            isCurrent && {
                                                                backgroundColor: colors.listActive || "rgba(24,144,255,0.15)",
                                                            },
                                                        ]}
                                                        onPress={() => handleSelectDevice(dev)}>
                                                        <View style={styles.deviceInfo}>
                                                            <ThemeText fontWeight="medium" fontSize="subTitle" numberOfLines={1} ellipsizeMode="tail">
                                                                {dev.name}
                                                            </ThemeText>
                                                            <ThemeText fontColor="textSecondary" fontSize="description" numberOfLines={1} ellipsizeMode="tail">
                                                                {dev.model} • {dev.ip}
                                                            </ThemeText>
                                                        </View>
                                                        {isCurrent ? (
                                                            <ThemeText fontColor="textHighlight" fontWeight="bold" fontSize="description">
                                                                Casting
                                                            </ThemeText>
                                                        ) : null}
                                                    </TouchableOpacity>
                                                );
                                            })
                                        )}
                                    </ScrollView>
                                </View>
                            )}

                            {/* TAB 2: SETTINGS */}
                            {currentTab === "settings" && (
                                <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsContent}>
                                    {/* Audio Format */}
                                    <ThemeText fontWeight="bold" fontSize="subTitle" style={styles.settingLabel}>
                                        Audio Streaming Format
                                    </ThemeText>
                                    <View style={styles.chipRow}>
                                        {(["original", "wav", "mp3", "flac"] as const).map((fmt) => (
                                            <TouchableOpacity
                                                key={fmt}
                                                style={[
                                                    styles.chip,
                                                    settings.audioFormat === fmt && {
                                                        backgroundColor: colors.textHighlight || "#1890ff",
                                                    },
                                                ]}
                                                onPress={() => updateSettingOption("audioFormat", fmt)}>
                                                <ThemeText
                                                    fontSize="description"
                                                    fontWeight={settings.audioFormat === fmt ? "bold" : "regular"}
                                                    style={settings.audioFormat === fmt ? { color: "#fff" } : undefined}>
                                                    {fmt.toUpperCase()}
                                                </ThemeText>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    {/* WAV Streaming Method */}
                                    <ThemeText fontWeight="bold" fontSize="subTitle" style={styles.settingLabel}>
                                        WAV Streaming Method
                                    </ThemeText>
                                    <View style={styles.chipRow}>
                                        {(["chunked", "fixed_header"] as const).map((method) => (
                                            <TouchableOpacity
                                                key={method}
                                                style={[
                                                    styles.chip,
                                                    settings.wavStreamingMethod === method && {
                                                        backgroundColor: colors.textHighlight || "#1890ff",
                                                    },
                                                ]}
                                                onPress={() => updateSettingOption("wavStreamingMethod", method)}>
                                                <ThemeText
                                                    fontSize="description"
                                                    fontWeight={settings.wavStreamingMethod === method ? "bold" : "regular"}
                                                    style={settings.wavStreamingMethod === method ? { color: "#fff" } : undefined}>
                                                    {method === "chunked" ? "Chunked Transfer" : "Fixed Header"}
                                                </ThemeText>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    {/* Sample Rate */}
                                    <ThemeText fontWeight="bold" fontSize="subTitle" style={styles.settingLabel}>
                                        Sample Rate
                                    </ThemeText>
                                    <View style={styles.chipRow}>
                                        {([44100, 48000, 96000] as const).map((rate) => (
                                            <TouchableOpacity
                                                key={rate}
                                                style={[
                                                    styles.chip,
                                                    settings.sampleRate === rate && {
                                                        backgroundColor: colors.textHighlight || "#1890ff",
                                                    },
                                                ]}
                                                onPress={() => updateSettingOption("sampleRate", rate)}>
                                                <ThemeText
                                                    fontSize="description"
                                                    fontWeight={settings.sampleRate === rate ? "bold" : "regular"}
                                                    style={settings.sampleRate === rate ? { color: "#fff" } : undefined}>
                                                    {rate / 1000} kHz
                                                </ThemeText>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    {/* Audio Buffer Duration */}
                                    <ThemeText fontWeight="bold" fontSize="subTitle" style={styles.settingLabel}>
                                        Audio Buffer Duration
                                    </ThemeText>
                                    <View style={styles.chipRow}>
                                        {([500, 1000, 2000, 5000] as const).map((buf) => (
                                            <TouchableOpacity
                                                key={buf}
                                                style={[
                                                    styles.chip,
                                                    settings.bufferDurationMs === buf && {
                                                        backgroundColor: colors.textHighlight || "#1890ff",
                                                    },
                                                ]}
                                                onPress={() => updateSettingOption("bufferDurationMs", buf)}>
                                                <ThemeText
                                                    fontSize="description"
                                                    fontWeight={settings.bufferDurationMs === buf ? "bold" : "regular"}
                                                    style={settings.bufferDurationMs === buf ? { color: "#fff" } : undefined}>
                                                    {buf} ms
                                                </ThemeText>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    {/* Direct Streaming Toggle */}
                                    <TouchableOpacity
                                        style={styles.toggleRow}
                                        onPress={() => updateSettingOption("directStreaming", !settings.directStreaming)}>
                                        <View style={{ flex: 1 }}>
                                            <ThemeText fontWeight="bold" fontSize="subTitle">
                                                Direct Streaming Mode
                                            </ThemeText>
                                            <ThemeText fontColor="textSecondary" fontSize="description">
                                                Bypass proxy when source has no custom headers
                                            </ThemeText>
                                        </View>
                                        <View
                                            style={[
                                                styles.toggleBadge,
                                                { backgroundColor: settings.directStreaming ? (colors.textHighlight || "#1890ff") : "#555" },
                                            ]}>
                                            <ThemeText style={{ color: "#fff" }} fontSize="description" fontWeight="bold">
                                                {settings.directStreaming ? "ON" : "OFF"}
                                            </ThemeText>
                                        </View>
                                    </TouchableOpacity>
                                </ScrollView>
                            )}

                            {/* TAB 3: LOGS */}
                            {currentTab === "logs" && (
                                <View style={styles.logsContainer}>
                                    <View style={styles.logsHeader}>
                                        <ThemeText fontColor="textSecondary" fontSize="description">
                                            REAL-TIME CAST & PROXY LOGS
                                        </ThemeText>
                                        <TouchableOpacity onPress={() => sonosManager.clearLogs()}>
                                            <ThemeText fontColor="textHighlight" fontSize="description">
                                                Clear
                                            </ThemeText>
                                        </TouchableOpacity>
                                    </View>
                                    <ScrollView
                                        style={[styles.terminalBox, { backgroundColor: "#111" }]}
                                        contentContainerStyle={styles.terminalContent}>
                                        {logs.length === 0 ? (
                                            <ThemeText fontColor="textSecondary" fontSize="description">
                                                No logs yet. Perform discovery or casting to see events.
                                            </ThemeText>
                                        ) : (
                                            logs.map((line, idx) => (
                                                <ThemeText
                                                    key={idx}
                                                    style={[
                                                        styles.terminalLine,
                                                        line.includes("ERROR") && { color: "#ff5252" },
                                                        line.includes("WARN") && { color: "#ffb142" },
                                                        line.includes("successfully") && { color: "#2ed573" },
                                                    ]}>
                                                    {line}
                                                </ThemeText>
                                            ))
                                        )}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        justifyContent: "flex-end",
    },
    modalCard: {
        borderTopLeftRadius: rpx(36),
        borderTopRightRadius: rpx(36),
        paddingHorizontal: rpx(36),
        paddingTop: rpx(32),
        paddingBottom: rpx(64),
        maxHeight: rpx(1100),
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(16),
    },
    titleText: {
        marginLeft: rpx(8),
    },
    headerButtons: {
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(14),
    },
    tabBtn: {
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        borderRadius: rpx(12),
    },
    activeTabBtn: {
        backgroundColor: "rgba(24,144,255,0.12)",
    },
    actionBtn: {
        paddingHorizontal: rpx(10),
        paddingVertical: rpx(8),
    },
    divider: {
        marginVertical: rpx(20),
    },
    sectionHeaderRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: rpx(12),
    },
    sectionTitle: {
        letterSpacing: 1,
    },
    activeCard: {
        borderWidth: 1.5,
        borderRadius: rpx(20),
        padding: rpx(24),
        marginBottom: rpx(20),
    },
    activeHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    disconnectBtn: {
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(12),
        borderRadius: rpx(14),
    },
    btnText: {
        color: "#fff",
        fontSize: rpx(22),
    },
    volumeRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(20),
    },
    volumeButtons: {
        flexDirection: "row",
        gap: rpx(16),
    },
    volStepBtn: {
        width: rpx(56),
        height: rpx(56),
        borderRadius: rpx(28),
        alignItems: "center",
        justifyContent: "center",
    },
    deviceList: {
        maxHeight: rpx(550),
    },
    deviceListContent: {
        paddingBottom: rpx(24),
    },
    deviceItem: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: rpx(22),
        paddingHorizontal: rpx(20),
        borderRadius: rpx(16),
        marginBottom: rpx(12),
    },
    deviceInfo: {
        flex: 1,
    },
    emptyContainer: {
        alignItems: "center",
        paddingVertical: rpx(48),
    },
    emptyText: {
        marginBottom: rpx(8),
    },
    emptySubText: {
        textAlign: "center",
        opacity: 0.7,
    },
    // Settings Tab Styles
    settingsScroll: {
        maxHeight: rpx(600),
    },
    settingsContent: {
        paddingBottom: rpx(24),
    },
    settingLabel: {
        marginTop: rpx(16),
        marginBottom: rpx(12),
    },
    chipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: rpx(16),
        marginBottom: rpx(12),
    },
    chip: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(14),
        borderRadius: rpx(16),
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(24),
        paddingVertical: rpx(12),
    },
    toggleBadge: {
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(8),
        borderRadius: rpx(12),
    },
    // Logs Tab Styles
    logsContainer: {
        maxHeight: rpx(600),
    },
    logsHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: rpx(12),
    },
    terminalBox: {
        borderRadius: rpx(16),
        maxHeight: rpx(520),
        padding: rpx(16),
    },
    terminalContent: {
        paddingBottom: rpx(16),
    },
    terminalLine: {
        fontSize: rpx(20),
        fontFamily: "monospace",
        color: "#ccc",
        marginBottom: rpx(6),
        lineHeight: rpx(28),
    },
});
