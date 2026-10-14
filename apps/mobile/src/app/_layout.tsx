import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useAppState } from "@/lib/hooks";
import { startAppStore } from "@/lib/runtime";
import { colors } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync().catch(() => {});
startAppStore();

export default function RootLayout() {
	const [fontsLoaded, fontError] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_600SemiBold });
	const loaded = useAppState((s) => s.loaded);
	const ready = loaded && (fontsLoaded || !!fontError);

	useEffect(() => {
		if (ready) void SplashScreen.hideAsync().catch(() => {});
	}, [ready]);

	if (!ready) return null;
	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
			<StatusBar style="dark" />
			<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
				<Stack.Screen name="(main)" />
				<Stack.Screen name="pair" />
				<Stack.Screen name="settings" />
			</Stack>
		</GestureHandlerRootView>
	);
}
