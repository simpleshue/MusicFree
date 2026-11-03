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

interface ISonosDevicePickerProps {
    visible: boolean;
    onClose: () => void;
}

export default function SonosDevicePicker({ visible, onClose }: ISonosDevicePickerProps) {
    const colors = useColors();
    const [devices, setDevices] = useState<ISonosDevice[]>(sonosManager.getDevices());
    const [activeDevice, setActiveDevice] = useState<ISonosDevice | null>(sonosManager.getActiveDevice());
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [volume, setVolume] = useState<number>(sonosManager.getVolume());

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
            refreshDevices();
        }

        const onDevicesUpdated = (list: ISonosDevice[]) => setDevices([...list]);
        const onActiveDeviceChanged = (dev: ISonosDevice | null) => setActiveDevice(dev);
        const onVolumeChanged = (vol: number) => setVolume(vol);

        sonosManager.on(SonosEvents.DevicesUpdated, onDevicesUpdated);
        sonosManager.on(SonosEvents.ActiveDeviceChanged, onActiveDeviceChanged);
        sonosManager.on(SonosEvents.VolumeChanged, onVolumeChanged);

        return () => {
            sonosManager.off(SonosEvents.DevicesUpdated, onDevicesUpdated);
            sonosManager.off(SonosEvents.ActiveDeviceChanged, onActiveDeviceChanged);
            sonosManager.off(SonosEvents.VolumeChanged, onVolumeChanged);
        };
    }, [visible]);

    const handleSelectDevice = async (device: ISonosDevice) => {
        if (activeDevice?.id === device.id) {
            // Already casting to this device
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
                                        Cast to Sonos
                                    </ThemeText>
                                </View>
                                <View style={styles.headerButtons}>
                                    <TouchableOpacity
                                        style={styles.actionBtn}
                                        onPress={refreshDevices}
                                        disabled={isScanning}>
                                        {isScanning ? (
                                            <ActivityIndicator size="small" color={colors.textHighlight || "#1890ff"} />
                                        ) : (
                                            <ThemeText fontColor="textHighlight" fontWeight="medium">
                                                Rescan
                                            </ThemeText>
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
                                        <ThemeText fontColor="textSecondary">Close</ThemeText>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <Divider style={styles.divider} />

                            {/* Active Device Controls */}
                            {activeDevice ? (
                                <View style={[styles.activeCard, { borderColor: colors.textHighlight || "#1890ff" }]}>
                                    <View style={styles.activeHeader}>
                                        <View>
                                            <ThemeText fontWeight="bold" fontSize="subTitle">
                                                Connected: {activeDevice.name}
                                            </ThemeText>
                                            <ThemeText fontColor="textSecondary" fontSize="description">
                                                {activeDevice.model} ({activeDevice.ip})
                                            </ThemeText>
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.disconnectBtn, { backgroundColor: "#e53935" }]}
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

                            {/* Device List */}
                            <ThemeText fontColor="textSecondary" fontSize="description" style={styles.sectionTitle}>
                                AVAILABLE SPEAKERS
                            </ThemeText>

                            <ScrollView style={styles.deviceList} contentContainerStyle={styles.deviceListContent}>
                                {devices.length === 0 ? (
                                    <View style={styles.emptyContainer}>
                                        {isScanning ? (
                                            <ThemeText fontColor="textSecondary">Scanning local Wi-Fi network...</ThemeText>
                                        ) : (
                                            <>
                                                <ThemeText fontColor="textSecondary" style={styles.emptyText}>
                                                    No Sonos speakers found.
                                                </ThemeText>
                                                <ThemeText fontColor="textSecondary" fontSize="description" style={styles.emptySubText}>
                                                    Ensure your phone and Sonos are on the same Wi-Fi network.
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
                                                    <ThemeText fontWeight="medium" fontSize="subTitle">
                                                        {dev.name}
                                                    </ThemeText>
                                                    <ThemeText fontColor="textSecondary" fontSize="description">
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
        maxHeight: rpx(1000),
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
        gap: rpx(20),
    },
    actionBtn: {
        paddingHorizontal: rpx(12),
        paddingVertical: rpx(8),
    },
    divider: {
        marginVertical: rpx(24),
    },
    activeCard: {
        borderWidth: 1.5,
        borderRadius: rpx(20),
        padding: rpx(24),
        marginBottom: rpx(24),
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
    sectionTitle: {
        marginBottom: rpx(16),
        letterSpacing: 1,
    },
    deviceList: {
        maxHeight: rpx(500),
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
});
