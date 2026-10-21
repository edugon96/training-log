import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Training Log",
    short_name: "Training",
    description: "Plan the work. Log every set.",
    start_url: "/",
    display: "standalone",
    background_color: "#101114",
    theme_color: "#101114",
    icons: [
      {
        src: "/training-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  }
}
