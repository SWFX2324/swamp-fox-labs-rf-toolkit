import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the site from /<repo>/, so assets need that base path.
export default defineConfig({
  base: "/swamp-fox-labs-rf-toolkit/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "RF Toolkit",
        short_name: "RF Toolkit",
        description: "Practical RF calculators for planning radio links in the field.",
        theme_color: "#111110",
        background_color: "#111110",
        display: "standalone",
        // PNG only: iOS can pick an SVG entry here, fail to use it and draw a letter instead.
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Keep map tiles the user has looked at, so the map background still
        // shows offline. Stale-while-revalidate refreshes them when online.
        // OpenStreetMap tiles are never downloaded in bulk (per its tile usage
        // policy); "save this view" stores only the imagery and terrain below.
        runtimeCaching: [
          {
            // OpenStreetMap tiles, used by both the Streets and Dark maps. Fetched
            // with CORS, so this can't share a cache with older no-CORS copies.
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "street-tiles",
              expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Satellite imagery tiles you've viewed or saved. Fetched with CORS,
            // so only real images are kept (USGS answers 404 outside the US).
            urlPattern: /^https:\/\/(tiles\.maps\.eox\.at|basemap\.nationalmap\.gov)\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "imagery-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 180 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Terrain elevation tiles never change, so keep them until evicted.
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
            handler: "CacheFirst",
            options: {
              cacheName: "elevation-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 180 * 24 * 60 * 60 },
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
