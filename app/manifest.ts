import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Odhu Indhu",
    short_name: "Odhu Indhu",
    description:
      "A quiet study companion for honest daily streaks and evidence-grounded recall.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f0e6",
    theme_color: "#a51c20",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
