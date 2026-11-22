import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FileImageContext } from "@/components/chat/MarkdownImage";
import { CopyButton, Table } from "@/components/chat/RichText";
import { ScreenHeader } from "@/components/ui";
import { releaseTableViewerRequest, tableViewerRequest } from "@/lib/tableViewer";
import { makeStyles } from "@/theme/appearance";

function close() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}
export default function TableViewerScreen() {
	const styles = useStyles();
	const [request] = useState(tableViewerRequest);
	useEffect(() => {
		if (!request) close();
		return () => releaseTableViewerRequest(request);
	}, [request]);
	if (!request) return null;
	return (
		<SafeAreaView style={styles.screen}>
			<ScreenHeader
				title="表"
				onBack={close}
				right={<CopyButton label="表をコピー（Markdown）" text={request.block.raw} />}
			/>
			<ScrollView contentContainerStyle={styles.body}>
				<FileImageContext.Provider value={request.loadFile}>
					<Table block={request.block} gallery={request.gallery} viewer />
				</FileImageContext.Provider>
			</ScrollView>
		</SafeAreaView>
	);
}
const useStyles = makeStyles(({ colors }) => ({
	screen: { flex: 1, backgroundColor: colors.background },
	body: { padding: 8 },
}));
