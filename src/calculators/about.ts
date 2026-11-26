// About: in plain English, the RF models behind the predictions, where the map
// layers and elevation come from, and how each works. Opened from the top bar,
// beside Settings.

import { escapeHtml } from "../lib/html";
import type { Calculator } from ".";
import { PANE_ICONS } from "./mapFirst";

interface Item {
  name: string;
  /** Where it comes from: the standard, paper or provider. */
  source: string;
  /** What it does, in plain English. */
  how: string;
  /** Where it's used, if not obvious from the section. */
  used?: string;
}

interface Section {
  title: string;
  icon: keyof typeof PANE_ICONS;
  intro?: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    title: "Radio paths over terrain",
    icon: "terrain",
    intro: "Used by the VHF/UHF Link Analysis, VHF/UHF Coverage Analysis and MANET Mesh Planner. Each path starts from free space, then adds what the ground takes away.",
    items: [
      {
        name: "Free-space path loss",
        source: "Standard physics formula",
        how: "How much a signal spreads out and weakens over distance with nothing in the way. It's the best case: every real path loses at least this much, usually more.",
      },
      {
        name: "Longley-Rice (Irregular Terrain Model)",
        source: "U.S. NTIA, version 1.4, ported line by line from NTIA's reference code",
        how: "The main terrain model. It looks at the ground between the two antennas, including hills, ridges and the curve of the earth, and works out the extra loss from signals bending over and around them. Climate, ground type and polarization tune it to the area. Reliability and confidence say how cautious the answer is: higher numbers plan for worse days and less typical spots.",
      },
      {
        name: "Bullington diffraction",
        source: "ITU-R P.526-16",
        how: "The backup when Longley-Rice doesn't apply (above 20 GHz, or antennas outside its height range). It treats the terrain as one sharp ridge and works out how much signal bends over it. It can read a little kindly on paths with several ridges.",
      },
      {
        name: "Line of sight and the Fresnel zone",
        source: "Effective earth radius (k-factor) geometry",
        how: "Checks whether the straight line between antenna tops clears the ground. Air bends radio waves slightly back toward the earth, so the earth is treated as flatter than it is (k = 4/3 normally). A link needs about 60% of the first Fresnel zone, a football-shaped space around the line, clear to behave like open air.",
      },
      {
        name: "Two-way links",
        source: "Link budget",
        how: "Every link is worked out in both directions, since the radios at each end can differ in power and sensitivity. A link is only as good as its weaker direction.",
      },
    ],
  },
  {
    title: "Trees, buildings and ground clutter",
    icon: "env",
    intro: "Loss from what surrounds each antenna, added at each end of a path. It drops to zero once an antenna is above the clutter.",
    items: [
      {
        name: "Clutter loss",
        source: "ITU-R P.2108-1",
        how: "For most Environment choices (urban, suburban, open and so on), an antenna low among buildings or trees loses extra signal. The path is then worked out from the top of the clutter so the same obstruction isn't counted twice.",
      },
      {
        name: "Woodland loss",
        source: "ITU-R P.833-10",
        how: "Used for Dense Vegetation. A radio under the canopy takes the measured loss of being inside woodland, worked out from its real height rather than as if it stood on the treetops.",
      },
      {
        name: "Auto (satellite map)",
        source: "Sentinel-2 10 m land cover: Impact Observatory, Microsoft and Esri (CC BY 4.0)",
        how: "Instead of one Environment for everything, the app looks up the land cover under each antenna on a 10 m map made from satellite images, and picks the matching clutter profile for that end.",
      },
    ],
  },
  {
    title: "Antennas",
    icon: "pattern",
    items: [
      {
        name: "Sector and directional patterns",
        source: "3GPP TR 36.814 parabolic model",
        how: "How much weaker an antenna is off its main beam. The beam width comes from the antenna's gain, and the signal falls off smoothly away from where it's pointed, including any downtilt.",
        used: "Coverage, mesh and link sites with a sector, panel, Yagi or dish",
      },
      {
        name: "Antenna lengths",
        source: "Fraction of a wavelength × a shortening factor",
        how: "Each element is a set fraction of the wavelength, shortened a little because real wire resonates shorter than in theory. Trim on site to the lowest SWR.",
        used: "Antenna Planning Tool",
      },
      {
        name: "3D radiation patterns",
        source: "Thin-wire antenna theory",
        how: "The shape each antenna radiates in an ideal world: free space, or a perfect ground for verticals with radials. Real patterns change with height, ground and anything nearby, so use it for the shape, not exact numbers.",
        used: "Antenna Planning Tool",
      },
    ],
  },
  {
    title: "Satellite",
    icon: "satellite",
    items: [
      {
        name: "Satellite link budget",
        source: "Carrier-to-noise budget against ETSI DVB-S2 thresholds (EN 302 307-1), and DVB-S (EN 300 421) for 7/8 and BPSK",
        how: "Your small terminal works a gateway through the satellite, in two directions. The return (you to the gateway) is worked out from your uplink and the satellite's downlink to the gateway's big dish; the forward (the gateway to you) from the gateway's uplink and the satellite's downlink to your dish. Each is compared with what its modulation and FEC need. Interference from neighbouring satellites isn't included, so real margins run a little lower.",
        used: "Satellite Link Analysis",
      },
      {
        name: "Pointing angles",
        source: "WGS84 earth geometry",
        how: "From your location to a geostationary satellite parked over the equator: which way to turn the dish (azimuth), how far to tilt it up (elevation) and how far to twist the feed (skew).",
        used: "Terminal Pointing Tool",
      },
      {
        name: "Magnetic compass bearing",
        source: "World Magnetic Model (WMM2025), NOAA and the British Geological Survey",
        how: "A compass points to magnetic north, not true north. The model gives the difference for your location so the bearing matches a real compass. It's built into the app, so it works offline.",
        used: "Terminal Pointing Tool",
      },
    ],
  },
  {
    title: "Feed line",
    icon: "coax",
    items: [
      {
        name: "Coax loss",
        source: "Times Microwave coefficients for LMR, typical values for RG cable",
        how: "Cable loss grows with frequency and length: some from the metal conductor, some from the insulation. The app adds both for your cable, run length and connectors.",
        used: "Coaxial Attenuation Planning Tool",
      },
      {
        name: "Loss from SWR",
        source: "ARRL Antenna Book",
        how: "When the antenna isn't a perfect match, some power bounces back down the cable and crosses it twice, losing more on the way. The app adds that to the cable loss.",
        used: "Coaxial Attenuation Planning Tool",
      },
    ],
  },
  {
    title: "Map layers",
    icon: "mapping",
    intro: "The map you see is only a backdrop. The predictions use the elevation and land cover data, not the map pictures.",
    items: [
      {
        name: "Light and Dark",
        source: "OpenStreetMap",
        how: "Street maps drawn from OpenStreetMap's volunteer data. Dark is the same map recoloured. They aren't saved for offline use, because OpenStreetMap's rules don't allow it, but tiles you've already looked at may still show.",
      },
      {
        name: "ESRI Satellite",
        source: "Esri World Imagery (Clarity), Maxar, Earthstar Geographics; labels from Esri World Boundaries and Places",
        how: "Sharp, recent satellite and aerial photos worldwide, with Esri's city and place names on top. Online only: Esri doesn't allow its imagery or labels to be saved for offline use. Maps start on it until you pick another layer.",
      },
      {
        name: "USGS Satellite",
        source: "USGS The National Map; EOxCloudless Sentinel-2 by EOX; labels from Esri",
        how: "Aerial photos with roads and names over the US (about 1 m detail), and cloud-free Sentinel-2 satellite images (about 10 m) everywhere else, with Esri's place names on top while online. This is the layer the Download button saves, and the one maps fall back to with no connection.",
      },
    ],
  },
  {
    title: "Elevation data",
    icon: "terrain",
    items: [
      {
        name: "Terrain Tiles",
        source: "Mapzen, hosted by AWS Open Data; built from USGS 3DEP, SRTM, GMTED2010, ETOPO1 and national datasets",
        how: "Height of the bare ground, stored as small map tiles with the height in each pixel's colour. The app reads the ground along every path or around every site from these tiles. It works at about 30 m detail, so small ridges and earthworks may not show, and trees and buildings come from the clutter settings instead. The data hasn't been updated since 2018. Download saves it for the area on screen so calculations work offline.",
      },
    ],
  },
];


export const aboutCalculator: Calculator = {
  id: "about",
  title: "About",
  // Opened from the top bar beside Settings, apart from the tools.
  inTabBar: false,
  render() {
    const page = document.createElement("div");
    page.className = "about-page";
    page.innerHTML = SECTIONS.map(
      (s) => `
      <section class="card about-section">
        <div class="card-head"><h2 class="with-icon">${PANE_ICONS[s.icon]}${escapeHtml(s.title)}</h2></div>
        ${s.intro ? `<p class="about-intro">${escapeHtml(s.intro)}</p>` : ""}
        <dl class="about-list">
          ${s.items
            .map(
              (i) => `
            <div class="about-item">
              <dt>${escapeHtml(i.name)}</dt>
              <dd class="about-source">${escapeHtml(i.source)}${i.used ? ` · ${escapeHtml(i.used)}` : ""}</dd>
              <dd class="about-how">${escapeHtml(i.how)}</dd>
            </div>`,
            )
            .join("")}
        </dl>
      </section>`,
    ).join("");
    return page;
  },
};
