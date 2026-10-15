import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader, TextButton } from "@/components/ui";
import { notificationTarget } from "@/lib/notifications";
import { appStore } from "@/lib/runtime";
import { colors, spacing } from "@/theme/tokens";

export default function NotificationScreen() {
	const params = useLocalSearchParams();
	const [error, setError] = useState("");
	const { hostId, instanceId, sessionId } = params;
	useEffect(() => {
		let active = true;
		const target = notificationTarget({ hostId, instanceId, sessionId });
		if (!target) {
			setError("通知の対象を確認できません。");
			return;
		}
		void appStore
			.openNotification(target, () => active)
			.then(() => {
				if (active) router.replace("/");
			})
			.catch((e) => {
				if (active) setError(e instanceof Error ? e.message : "接続を確認できませんでした。");
			});
		return () => {
			active = false;
		};
	}, [hostId, instanceId, sessionId]);
	return (
		<SafeAreaView style={styles.screen}>
			<ScreenHeader title="通知" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
			<View style={styles.body}>
				<Text style={styles.text}>{error || "通知の対象を確認しています…"}</Text>
				{error ? <TextButton label="Pi の一覧へ戻る" onPress={() => router.replace("/")} /> : null}
			</View>
		</SafeAreaView>
	);
}
const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	body: { padding: spacing.screenSide, gap: 20 },
	text: { fontSize: 15, lineHeight: 23, color: colors.text },
});
