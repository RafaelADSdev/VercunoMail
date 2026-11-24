import type { MetadataRoute } from "next";
import { DEFAULT_APP_NAME } from "@/lib/branding/defaults";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: DEFAULT_APP_NAME,
		short_name: DEFAULT_APP_NAME,
		description: "Webmail da Vercuno.",
		id: "/",
		scope: "/",
		start_url: "/inbox",
		display: "standalone",
		background_color: "#ffffff",
		theme_color: "#f6f8fc",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
			{ src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
