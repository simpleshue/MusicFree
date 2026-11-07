import React, { useEffect } from "react";
import { BackHandler, Platform, StatusBar } from "react-native";
import { NavigationContainer, StackActions } from "@react-navigation/native";
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
import { navigationRef } from "@/core/router";

/**
 * 字体颜色
 */

StatusBar.setBackgroundColor("transparent");
StatusBar.setTranslucent(true);

bootstrap();
const Stack = createNativeStackNavigator<any>();

export default function Pages() {
    const theme = Theme.useTheme();

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const onHardwareBackPress = () => {
            try {
                if (!navigationRef.isReady()) {
                    return false;
                }

                // If on any subpage, first swap/back returns directly to the Home page
                if (navigationRef.canGoBack()) {
                    try {
                        navigationRef.dispatch(StackActions.popToTop());
                    } catch {
                        navigationRef.goBack();
                    }
                    return true;
                }

                // If already on Home page, return false to let MainActivity's native double-back handler protect it
                return false;
            } catch {
                return false;
            }
        };

        const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBackPress);
        return () => sub.remove();
    }, []);

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
