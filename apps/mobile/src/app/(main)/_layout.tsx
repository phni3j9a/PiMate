import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useWindowDimensions } from "react-native";

import { InstanceDrawer } from "@/components/InstanceDrawer";
import { useAppState } from "@/lib/hooks";
import { colors } from "@/theme/tokens";

/** Chat with the ChatGPT-style instance drawer. Without a paired host, onboarding (pairing) comes first. */
export default function MainLayout() {
	const hasHosts = useAppState((s) => s.hosts.length > 0);
	const { width } = useWindowDimensions();
	if (!hasHosts) return <Redirect href="/pair" />;
	return (
		<Drawer
			drawerContent={(props) => <InstanceDrawer {...props} />}
			screenOptions={{
				headerShown: false,
				drawerType: "front",
				// Drawer.html: 330 of 390 px, the dimmed chat stays visible on the right.
				drawerStyle: { width: Math.min(Math.round(width * 0.846), 360), backgroundColor: colors.background },
				overlayColor: colors.scrim,
				overlayAccessibilityLabel: "一覧を閉じる",
				swipeEdgeWidth: 48,
				sceneStyle: { backgroundColor: colors.background },
			}}
		/>
	);
}
