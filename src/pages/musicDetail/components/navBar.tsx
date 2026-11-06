import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import SonosDevicePicker, { CastIcon } from "@/components/sonos/SonosDevicePicker";
import sonosManager, { SonosEvents } from "@/services/sonos/sonosManager";
import rpx from "@/utils/rpx";
import { useNavigation } from "@react-navigation/native";
import Tag from "@/components/base/tag";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import Share from "react-native-share";
import { B64Asset } from "@/constants/assetsConst";
import IconButton from "@/components/base/iconButton";
import { useCurrentMusic } from "@/core/trackPlayer";

export default function NavBar() {
    const navigation = useNavigation();
    const musicItem = useCurrentMusic();
    const [showSonosPicker, setShowSonosPicker] = useState(false);
    const [isCasting, setIsCasting] = useState(sonosManager.getIsCasting());

    useEffect(() => {
        const onActiveChanged = () => setIsCasting(sonosManager.getIsCasting());
        sonosManager.on(SonosEvents.ActiveDeviceChanged, onActiveChanged);
        return () => {
            sonosManager.off(SonosEvents.ActiveDeviceChanged, onActiveChanged);
        };
    }, []);

    return (
        <>
            <View style={styles.container}>
                <IconButton
                    name="arrow-left"
                    sizeType={"normal"}
                    color="white"
                    style={styles.button}
                    onPress={() => {
                        navigation.goBack();
                    }}
                />
                <View style={styles.headerContent}>
                    <Text numberOfLines={1} style={styles.headerTitleText}>
                        {musicItem?.title ?? "--"}
                    </Text>
                    <View style={styles.headerDesc}>
                        <Text style={styles.headerArtistText} numberOfLines={1}>
                            {musicItem?.artist}
                        </Text>
                        {musicItem?.platform ? (
                            <Tag
                                tagName={musicItem.platform}
                                containerStyle={styles.tagBg}
                                style={styles.tagText}
                            />
                        ) : null}
                    </View>
                </View>
                <IconButton
                    name="share"
                    color="white"
                    sizeType="normal"
                    style={styles.button}
                    onPress={async () => {
                        try {
                            await Share.open({
                                type: "image/jpeg",
                                title: "MusicFree-一个插件化的免费音乐播放器",
                                message: "MusicFree-一个插件化的免费音乐播放器",
                                url: B64Asset.share,
                                subject: "MusicFree分享",
                            });
                        } catch {}
                    }}
                />
                <TouchableOpacity
                    style={styles.castButton}
                    onPress={() => setShowSonosPicker(true)}>
                    <CastIcon size={rpx(44)} color={isCasting ? "#1890ff" : "white"} />
                </TouchableOpacity>
                <IconButton
                    style={{ display: "none" }}
                    name="share"
                    onPress={() => {
                    }}
                />
            </View>
            <SonosDevicePicker
                visible={showSonosPicker}
                onClose={() => setShowSonosPicker(false)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        height: rpx(150),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    castButton: {
        marginHorizontal: rpx(20),
        padding: rpx(8),
    },
    button: {
        marginHorizontal: rpx(24),
    },
    headerContent: {
        flex: 1,
        height: rpx(150),
        justifyContent: "center",
        alignItems: "center",
    },
    headerTitleText: {
        color: "white",
        fontWeight: fontWeightConst.semibold,
        fontSize: fontSizeConst.title,
        marginBottom: rpx(12),
        includeFontPadding: false,
    },
    headerDesc: {
        height: rpx(32),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(40),
    },
    headerArtistText: {
        color: "white",
        fontSize: fontSizeConst.subTitle,
        includeFontPadding: false,
    },
    tagBg: {
        backgroundColor: "rgba(255, 255, 255, 0.2)",
    },
    tagText: {
        color: "white",
    },
});
