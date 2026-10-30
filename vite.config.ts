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
        theme_color: "#111110",
        background_color: "#111110",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Keep map tiles the user has looked at, so the map background still
        // shows offline. Stale-while-revalidate refreshes them when online,
        // and nothing is downloaded in bulk (per the OSM tile usage policy).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Terrain elevation tiles never change, so keep them until evicted.
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
            handler: "CacheFirst",
            options: {
              cacheName: "elevation-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 180 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
