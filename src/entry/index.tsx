import React, { useEffect, useRef } from "react";
import { BackHandler, Platform, StatusBar } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import bootstrap from "./bootstrap/bootstrap";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Dialogs from "@/components/dialogs";
import Panels from "@/components/panels";
import PageBackground from "@/components/base/pageBackground";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Debug from "@/components/debug";
import { PortalHost } from "@/components/base/portal";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import { BootstrapComponent } from "./bootstrap/BootstrapComponent";
import { ToastBaseComponent } from "@/components/base/toast";

import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { routes } from "@/core/router/routes.tsx";
import ErrorBoundary from "@/components/errorBoundary";
import { ROUTE_PATH, navigationRef } from "@/core/router";
import Toast from "@/utils/toast";
import { useI18N } from "@/core/i18n";

/**
 * 字体颜色
 */

StatusBar.setBackgroundColor("transparent");
StatusBar.setTranslucent(true);

bootstrap();
const Stack = createNativeStackNavigator<any>();

export default function Pages() {
    const theme = Theme.useTheme();
    const { t } = useI18N();
    const lastBackTimeRef = useRef(0);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const onHardwareBackPress = () => {
            if (!navigationRef.isReady()) {
                return false;
            }

            const currentRoute = navigationRef.getCurrentRoute();
            const routeName = currentRoute?.name;
            const isHome = !routeName || routeName === ROUTE_PATH.HOME || routeName === "HOME-MAIN";

            // 1. If on any subpage, first swap/back returns directly to the Home page
            if (!isHome) {
                navigationRef.navigate(ROUTE_PATH.HOME);
                lastBackTimeRef.current = Date.now();
                return true;
            }

            // 2. If on Home page: check double-back to return to desktop
            const now = Date.now();
            if (now - lastBackTimeRef.current < 2000) {
                BackHandler.exitApp();
                return true;
            }

            // First swap on Home page: show toast warning
            lastBackTimeRef.current = now;
            Toast.warn(t("sidebar.pressAgainToExit") || "再按一次返回桌面");
            return true;
        };

        const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBackPress);
        return () => sub.remove();
    }, [t]);

    return (
        <ErrorBoundary>
            <BootstrapComponent />
            <ReducedMotionConfig mode={ReduceMotion.Never} />
            <GestureHandlerRootView style={globalStyle.flex1}>
                <SafeAreaProvider>
                    <NavigationContainer ref={navigationRef} theme={theme}>
                        <PageBackground />
                        <Stack.Navigator
                            initialRouteName={routes[0].path}
                            screenOptions={{
                                headerShown: false,
                                animation: "slide_from_right",
                                animationDuration: 100,
                                gestureEnabled: true,
                                fullScreenGestureEnabled: true,
                            }}>
                            {routes.map(route => (
                                <Stack.Screen
                                    key={route.path}
                                    name={route.path}
                                    component={route.component}
                                />
                            ))}
                        </Stack.Navigator>                        
                        <Panels />
                        <Dialogs />
                        <Debug />
                        <ToastBaseComponent />
                        <PortalHost />
                    </NavigationContainer>
                </SafeAreaProvider>
            </GestureHandlerRootView>
        </ErrorBoundary>
    );
}
