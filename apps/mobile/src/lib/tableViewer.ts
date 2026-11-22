import { router } from "expo-router";
import { Keyboard } from "react-native";
import type { ViewerImage } from "./imageViewer";
import type { markdownImageGallery } from "./markdownImages";
import type { Block } from "./richText";

interface TableRequest {
	block: Extract<Block, { type: "table" }>;
	gallery: ViewerImage[];
	loadFile: Parameters<typeof markdownImageGallery>[1];
}
let current: TableRequest | null = null;
let openedAt = 0;
export function openTableViewer(request: TableRequest) {
	if (Date.now() - openedAt < 1000) return;
	openedAt = Date.now();
	current = request;
	Keyboard.dismiss();
	router.push("/table-viewer");
}
export function tableViewerRequest() {
	return current;
}
export function releaseTableViewerRequest(request: TableRequest | null) {
	if (current === request) current = null;
}
