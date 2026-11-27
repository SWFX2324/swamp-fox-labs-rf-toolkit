import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import releaseNotes from "./src/releaseNotes.json";

// GitHub Pages serves the site from /<repo>/, so assets need that base path.
// The dev branch builds the same app under /<repo>/beta/ (BASE_PATH set by the
// deploy workflow), installable on its own as "RF Toolkit Beta".
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const base = env.BASE_PATH ?? "/swamp-fox-labs-rf-toolkit/";
const beta = base.endsWith("/beta/");

export default defineConfig({
  base,
  // The 3D view is one large chunk (MapLibre), loaded only when opened.
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [
    // Publishes the release notes beside the app, so a page still running an
    // older version can fetch the new version's notes when it offers the update.
    {
      name: "release-notes",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "release-notes.json", source: JSON.stringify(releaseNotes) });
      },
    },
    VitePWA({
      // A new version waits until the user taps "Update available" (see main.ts),
      // so a deploy never reloads a page in the middle of someone's work.
      registerType: "prompt",
      includeAssets: ["favicon-fox-32.png", "brand-fox.png", "apple-touch-icon-dark.png", "icon-fox-192.png", "icon-fox-512.png", "icon-maskable-dark-512.png"],
      manifest: {
        name: beta ? "RF Toolkit Beta" : "RF Toolkit",
        short_name: beta ? "RF Beta" : "RF Toolkit",
        description: "Practical RF calculators for planning radio links in the field.",
        theme_color: "#111110",
        background_color: "#111110",
        display: "standalone",
        // PNG only: iOS can pick an SVG entry here, fail to use it and draw a letter instead.
        icons: [
          { src: "icon-fox-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-fox-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-dark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell plus the bundled SVGs (the topographic page background) and the
        // 3D view with its MapLibre worker (.mjs), so it all works offline.
        globPatterns: ["**/*.{js,mjs,css,html,svg,webp}"],
        // The stable site's service worker covers the whole repo path, so it
        // leaves the beta's pages to the network (and the beta's own worker).
        navigateFallbackDenylist: beta ? [] : [/\/beta\//],
        // Keep map tiles the user has looked at, so the map background still
        // shows offline. Stale-while-revalidate refreshes them when online.
        // OpenStreetMap tiles are never downloaded in bulk (per its tile usage
        // policy); "save this view" stores only the imagery, terrain and land cover below.
        // Esri Clarity imagery (clarity.maptiles.arcgis.com) is left out on purpose:
        // Esri doesn't allow its tiles to be stored for offline use.
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
          {
            // Land-cover tiles for one year's map, which doesn't change either.
            urlPattern: /^https:\/\/ic\.imagery1\.arcgis\.com\/arcgis\/rest\/services\/Sentinel2_10m_LandCover\//,
            handler: "CacheFirst",
            options: {
              cacheName: "land-cover-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
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
