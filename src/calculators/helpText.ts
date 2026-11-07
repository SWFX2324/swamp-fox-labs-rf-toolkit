// Plain-language help for every input, shown behind the ⓘ next to each label,
// and which fields count as "advanced" (hidden in Simple mode). Keys are the
// inputs' name attributes. Typical values are rules of thumb, not specs.

import type { FieldGuide } from "./fieldHelp";
import { modelAdvanced, modelHelp } from "./modelFields";

const shared = {
  freq:
    "The operating frequency. Higher frequencies lose more signal over distance and are blocked more easily by terrain, trees and buildings.",
  power:
    "Transmitter output power at the radio's antenna jack. Handhelds are often 1–5 W, mobiles 25–50 W, and HaLow or Wi-Fi radios well under 1 W. Pick W, mW or dBm (30 dBm is 1 W).",
  gain:
    "How much the antenna focuses signal compared with an ideal antenna that radiates equally everywhere. A handheld rubber duck is about 0–2 dBi, a quarter-wave whip about 2 dBi, a base collinear 5–9 dBi and a Yagi 7–14 dBi. If the datasheet says dBd, add 2.15.",
  coax:
    "The cable between the radio and the antenna. Thinner cable loses more, especially at higher frequencies and on longer runs. Pick None if the antenna mounts straight on the radio.",
  coaxLength: "Length of that cable run, end to end.",
  otherLoss:
    "Anything else in line: connectors, adapters, a lightning arrestor, filters or a duplexer. Allow about 0.1–0.2 dB per connector pair and 0.5–1 dB for a duplexer.",
  height:
    "Height of the antenna above the ground where it stands, not above sea level. Higher antennas see farther and clear more terrain.",
  distance: "Straight-line distance between the two antennas.",
  extraLoss:
    "Any known loss you want to add on top, such as being inside a vehicle or building (roughly 10–20 dB). If you've picked an Environment, it already covers the general surroundings, so don't count those again.",
  environment:
    "A rough estimate of the loss from what surrounds your antennas, applied at both ends: open water, fields or desert (low antennas lose signal to ground reflections), light vegetation or suburbs, cities, or dense forest and jungle. It grows with frequency and fades away once an antenna clears the clutter. It can't see that a path runs through forest then open field, and it's less reliable under about 800 ft. Based on ITU-R P.2108; Open Water, Open Fields and Desert use the same ITU category, as do Light Vegetation and Suburban. From land-cover map reads a 10 m satellite land-cover map (Impact Observatory, Microsoft and Esri) and picks the profile at each end separately: trees count as Dense Vegetation, crops and grassland as Open Fields, built-up areas as Suburban or Urban by how built-up the area is. It needs a connection the first time for each area, or an area saved for offline.",
  sensitivity:
    "The weakest signal the receiver can still decode, from its datasheet, as a negative number in dBm. More negative is more sensitive. A VHF handheld is often around −120 dBm; a HaLow node around −95 to −105 dBm depending on data rate.",
  fade:
    "Extra signal to keep in reserve for weather, foliage, movement and fading. 10 dB is a good start; use 20 dB for links that must not drop.",
  location:
    "Where this end of the link is. Press the crosshair for GPS, type coordinates (decimal lat/lon or MGRS), or tap the map.",
  slot:
    "The satellite's orbital position from your access documents, such as 101W or 28.2E. Geostationary satellites sit over the equator at that longitude.",
};

const patternHelp =
  "The shape of the antenna's beam. Omni sends the same way in every direction; a sector covers a wedge (its beamwidth); Directional is a Yagi, panel or dish, with a beam that narrows as its gain rises. Antenna gain is the peak, on the beam; off the beam the app takes away what the pattern loses there, down to about 20–25 dB behind it. Higher-gain antennas also have a thinner beam up and down, so they can miss ground right under a tall mast.";
const aimHelp =
  "The compass direction the antenna faces, in degrees from true north: 0 is north, 90 east, 180 south, 270 west. A phone compass reads magnetic north; Sat Pointing shows the difference (declination) for your area.";
const tiltHelp =
  "How far the beam points below the horizon, in degrees: built-in (electrical) tilt plus any mechanical tilt. 0 is level. A few degrees of downtilt fills in close to a tall site at the cost of reach. Leave 0 if you don't know it.";
const kFactorHelp =
  "How much the air bends signals back toward the earth, used for the line-of-sight and Fresnel checks and the radio horizon. 4/3 is the normal atmosphere. 2/3 is the bad case, a few percent of the time, when the earth effectively bulges higher; microwave links are often planned to stay clear even then. It doesn't change the Longley-Rice loss, which has its own atmosphere model.";

export const linkBudgetGuide: FieldGuide = {
  help: {
    freq: shared.freq,
    txPower: shared.power,
    txCable: shared.coax,
    txCableLen: shared.coaxLength,
    txOther: shared.otherLoss,
    txGain: shared.gain,
    txHeight: `${shared.height} Used for the radio horizon and the terrain check.`,
    dist: `${shared.distance} Dropping both map pins in Terrain profile fills this in.`,
    environment: shared.environment,
    extraLoss: shared.extraLoss,
    rxGain: shared.gain,
    rxHeight: shared.height,
    rxCable: shared.coax,
    rxCableLen: shared.coaxLength,
    rxOther: shared.otherLoss,
    rxSens: shared.sensitivity,
    fadeMargin: `${shared.fade} It sets the max range and the margin rating.`,
    txLoc: shared.location,
    rxLoc: shared.location,
    ...modelHelp,
    kFactor: kFactorHelp,
  },
  advanced: [
    "kFactor",
    "txCable",
    "txCableLen",
    '[data-show="txCable"]',
    '[data-out="txCableNote"]',
    "txOther",
    "extraLoss",
    "rxCable",
    "rxCableLen",
    '[data-show="rxCable"]',
    '[data-out="rxCableNote"]',
    "rxOther",
    "fadeMargin",
    ...modelAdvanced,
  ],
};

export const meshGuide: FieldGuide = {
  help: {
    freq: shared.freq,
    power: shared.power,
    gain: shared.gain,
    cable: `Cable, connector and adapter loss at each node. ${shared.otherLoss}`,
    sens: shared.sensitivity,
    fade: `${shared.fade} Links that keep it count as solid.`,
    environment: shared.environment,
    height: `${shared.height} Each node can override it in the node list.`,
    ...modelHelp,
    kFactor: `${kFactorHelp} Here it decides whether a good link is drawn as clear line of sight (solid) or obstructed (long dashes).`,
  },
  advanced: ["cable", "fade", "distUnit", "kFactor", ...modelAdvanced],
};

export const coverageGuide: FieldGuide = {
  help: {
    site: shared.location,
    radius: "How far out from the site to map. Larger areas take a little longer and use coarser terrain.",
    detail:
      "How many directions to check from the site. Finer detail catches narrow gaps and ridges but takes longer to calculate.",
    freq: shared.freq,
    power: shared.power,
    txGain: shared.gain,
    txCable: `Cable and connector loss between the transmitter and its antenna. ${shared.otherLoss}`,
    txHeight: `${shared.height} This is the transmitter or repeater site.`,
    txPattern: patternHelp,
    txAzimuth: aimHelp,
    txTilt: tiltHelp,
    rxHeight:
      "Antenna height of the stations you want to reach: about 5 ft for a handheld, 6–8 ft on a vehicle roof.",
    rxGain: shared.gain,
    rxCable: "Cable loss at the receiving stations. Leave 0 for handhelds.",
    sens: shared.sensitivity,
    fade: `${shared.fade} Areas that keep it show as solid.`,
    environment: shared.environment,
    ...modelHelp,
  },
  advanced: ["detail", "txTilt", "txCable", "rxGain", "rxCable", "fade", ...modelAdvanced],
};

export const antennaGuide: FieldGuide = {
  help: {
    freq: "The frequency you want the antenna to work on. Pick a band below for a common one.",
    design: "The kind of antenna you're building. The drawing and feed notes below change with it.",
    cable:
      "The coax you're cutting. Its velocity factor (how fast signal travels in it compared with free space) sets the length.",
    factor:
      "Real antennas resonate a little shorter than the free-space length because of wire thickness and nearby objects. 0.95 suits thin wire; go a little lower for thick tubing. Loops use about 1.02. For coax stubs this is the cable's velocity factor.",
  },
  advanced: ["factor"],
};

export const coaxGuide: FieldGuide = {
  help: {
    freq: shared.freq,
    runLength: shared.coaxLength,
    power: shared.power,
    swr: "Standing wave ratio at the antenna end: how well the antenna matches the cable. 1.0 is perfect, under 1.5 is good, and over 2 wastes noticeable power. Leave 1.0 if you don't know it.",
    connectors: shared.otherLoss,
    cable: "The cable you have or are considering. The table compares every cable for the same run.",
  },
  advanced: ["swr", "connectors"],
};

export const satPointingGuide: FieldGuide = {
  help: {
    site: shared.location,
    slot: shared.slot,
    offset:
      "Most small VSAT dishes are offset-fed: the beam points higher than the dish face, often by 17–25°. The angle is on the reflector's datasheet. Leave 0 for a round, centre-fed dish.",
  },
  advanced: ["offset"],
};

export const satLinkGuide: FieldGuide = {
  help: {
    site: "Where your dish is. Press the crosshair for GPS or type coordinates (decimal lat/lon or MGRS). Filled in from Sat Pointing if you've used it.",
    slot: shared.slot,
    band: "The satellite band. Picking one fills in typical uplink and downlink frequencies and clear-sky losses.",
    upGHz: "Your transmit (uplink) frequency from the access plan.",
    downGHz: "Your receive (downlink) frequency from the access plan.",
    dish: "Reflector diameter, as on the dish label or datasheet (for example 1.2 m).",
    efficiency: "How well the dish turns its size into gain. 55–70% is typical; 65% is a good default.",
    power:
      "Output power of the BUC, the transmitter mounted on the dish arm. Common Ku VSAT sizes are 2–8 W.",
    txFeed: "Loss in the cable or waveguide between the BUC and the feed horn. Usually under 0.5 dB when the BUC sits on the feed.",
    pointing:
      "How far off the satellite the dish may sit after peaking. 0.1–0.2° is good practice for a small dish; bigger dishes need tighter pointing.",
    lnbK: "LNB noise from its datasheet. Noise figure converts to temperature: 0.6 dB is about 42 K, 0.8 dB about 59 K, 1.0 dB about 75 K.",
    antK: "Noise the dish picks up from the sky and ground in clear weather: about 30–50 K at Ku and moderate elevation.",
    rxFeed: "Loss between the feed horn and the LNB. Usually small.",
    satGt:
      "How well the satellite can hear your signal from where you are. Higher is better. G/T compares the antenna's gain (G) with the receiver's noise temperature (T), and it changes with your location. Find it in your access documents or on the satellite's G/T footprint map, or ask the satellite controller.",
    satEirp:
      "The downlink power your carrier gets toward your location, in dBW. Ask the satellite controller; the footprint map shows the whole transponder, which is more.",
    symbolRate: "Your carrier's symbol rate from the access plan, in megasymbols per second.",
    modcod:
      "Modulation and forward error correction (FEC) from the access plan, such as QPSK 3/4. These are the DVB-S2 options, also called MODCODs. Higher orders carry more data but need a stronger signal.",
    implLoss: "How far a real modem falls short of the ideal. 0.5–1 dB is typical.",
    upLoss: "Atmosphere and rain loss on the uplink. Add rain fade here to plan for bad weather: heavy rain can take 3–6 dB at Ku and 10 dB or more at Ka.",
    downLoss: "Atmosphere and rain loss on the downlink. Rain also raises the noise the dish sees, which is included.",
  },
  advanced: ["upGHz", "downGHz", "efficiency", "txFeed", "pointing", "lnbK", "antK", "rxFeed", "implLoss"],
};

export const powerGuide: FieldGuide = {
  help: {
    limit:
      "How much of a generator's rating to plan on using. 80% is a common rule: it leaves room for startup surges, like air conditioners and pumps, and for gear added later. The generator's kVA (kW ÷ 0.8) is checked too.",
  },
  advanced: ["limit"],
};

export const converterGuide: FieldGuide = {
  help: {
    "power-uv":
      "The signal voltage across a 50 Ω receiver input. Receiver sensitivity is often quoted this way, such as 0.25 µV.",
    "mismatch-swr": "Standing wave ratio. 1.0 is a perfect match; above 2 wastes noticeable power.",
    "mismatch-rl": "Return loss: how far below the forward power the reflected power is. Bigger is better; 20 dB is an excellent match.",
    "mismatch-gamma": "Reflection coefficient: the share of voltage reflected, from 0 (none) to 1 (all).",
    "gain-dbd": "Gain compared with a half-wave dipole instead of an ideal isotropic antenna. dBi = dBd + 2.15.",
  },
  advanced: ["power-dbw", "power-uv", "[data-card=\"power\"] .ledger", "[data-card=\"power\"] .about", "mismatch-gamma", "[data-card=\"gain\"] .ledger", "ratio-vr"],
};
