import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the site from /<repo>/, so assets need that base path.
export default defineConfig({
  base: "/swamp-fox-labs-rf-toolkit/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Swamp Fox Labs RF Toolkit",
        short_name: "RF Toolkit",
        description: "Practical RF calculators for planning radio links in the field.",
        theme_color: "#1f2a24",
        background_color: "#1f2a24",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
