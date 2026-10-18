import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAppState } from "@/lib/hooks";
import { notificationTarget } from "@/lib/notifications";
import { startAppStore } from "@/lib/runtime";
import { colors, scheme } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync().catch(() => {});
startAppStore();

export default function RootLayout() {
	const [fontsLoaded, fontError] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_600SemiBold });
	const loaded = useAppState((s) => s.loaded);
	const ready = loaded && (fontsLoaded || !!fontError);

	useEffect(() => {
		if (ready) void SplashScreen.hideAsync().catch(() => {});
	}, [ready]);

	useEffect(() => {
		if (!ready) return;
		const seen = new Set<string>();
		const open = (response: Notifications.NotificationResponse | null) => {
			if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
			const id = response.notification.request.identifier;
			if (seen.has(id)) return;
			seen.add(id);
			const target = notificationTarget(response.notification.request.content.data);
			Notifications.clearLastNotificationResponse();
			if (target) router.push({ pathname: "/notification", params: { ...target } });
		};
		const sub = Notifications.addNotificationResponseReceivedListener(open);
		open(Notifications.getLastNotificationResponse());
		return () => sub.remove();
	}, [ready]);

	if (!ready) return null;
	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
			<StatusBar style={scheme === "dark" ? "light" : "dark"} />
			<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
				<Stack.Screen name="(main)" />
				<Stack.Screen name="pair" />
				<Stack.Screen name="settings" />
				<Stack.Screen name="provider-auth" />
				<Stack.Screen name="new" />
				<Stack.Screen name="review" />
				<Stack.Screen name="tree" />
				<Stack.Screen name="subagent" />
				<Stack.Screen name="notification" />
				<Stack.Screen
					name="image-viewer"
					options={{
						presentation: "transparentModal",
						animation: "fade",
						contentStyle: { backgroundColor: "transparent" },
					}}
				/>
			</Stack>
		</GestureHandlerRootView>
	);
}
