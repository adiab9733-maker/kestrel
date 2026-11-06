import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kestrel",
    short_name: "Kestrel",
    description: "An autonomous agent that plans, researches, codes and delivers.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f6f3",
    theme_color: "#c4542a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
