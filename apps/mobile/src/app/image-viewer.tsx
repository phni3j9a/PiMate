/** Full-screen image viewer (transparent modal). Opened with `openImageViewer` from @/lib/imageViewer. */
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ImageViewer } from "@/components/chat/ImageViewer";
import { imageViewerRequest, releaseImageViewerRequest } from "@/lib/imageViewer";

export default function ImageViewerScreen() {
	const [request] = useState(imageViewerRequest);
	useEffect(() => {
		// Nothing to show when the route is restored without its in-memory images.
		if (!request) close();
		return () => releaseImageViewerRequest(request);
	}, [request]);
	if (!request) return null;
	return <ImageViewer images={request.images} initialIndex={request.index} onClose={close} />;
}

function close() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}
