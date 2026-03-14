import type { AssetProfile, CityProfile } from "./types";

export const cities: CityProfile[] = [
  {
    id: "reykjavik",
    name: "Reykjavik",
    country: "Iceland",
    region: "North Atlantic",
    lat: 64.1466,
    lon: -21.9426,
    timezone: "Atlantic/Reykjavik",
    accentColor: "#9fb7ff",
    tags: ["cold", "wind", "volatility sink"],
    baselines: {
      humidity: 76,
      rain: 4,
      temperature: 3,
      wind: 22,
      airQuality: 17,
      soilMoisture: 62,
      soilPh: 6.8
    }
  },
  {
    id: "newyork",
    name: "New York",
    country: "United States",
    region: "North America",
    lat: 40.7128,
    lon: -74.006,
    timezone: "America/New_York",
    accentColor: "#f2ca52",
    tags: ["wall street", "weather beta", "signals"],
    baselines: {
      humidity: 61,
      rain: 2,
      temperature: 21,
      wind: 12,
      airQuality: 41,
      soilMoisture: 53,
      soilPh: 6.5
    }
  },
  {
    id: "phoenix",
    name: "Phoenix",
    country: "United States",
    region: "North America",
    lat: 33.4484,
    lon: -112.074,
    timezone: "America/Phoenix",
    accentColor: "#ffbd63",
    tags: ["desert", "heat dome", "sun premium"],
    baselines: {
      humidity: 24,
      rain: 0.4,
      temperature: 39,
      wind: 8,
      airQuality: 58,
      soilMoisture: 16,
      soilPh: 7.8
    }
  },
  {
    id: "dubai",
    name: "Dubai",
    country: "United Arab Emirates",
    region: "Gulf",
    lat: 25.2048,
    lon: 55.2708,
    timezone: "Asia/Dubai",
    accentColor: "#ffb45c",
    tags: ["heat", "oil", "desert liquidity"],
    baselines: {
      humidity: 41,
      rain: 0.2,
      temperature: 36,
      wind: 14,
      airQuality: 74,
      soilMoisture: 18,
      soilPh: 8
    }
  },
  {
    id: "singapore",
    name: "Singapore",
    country: "Singapore",
    region: "Southeast Asia",
    lat: 1.3521,
    lon: 103.8198,
    timezone: "Asia/Singapore",
    accentColor: "#6be0d4",
    tags: ["trade hub", "humidity", "shipping"],
    baselines: {
      humidity: 82,
      rain: 12,
      temperature: 32,
      wind: 9,
      airQuality: 43,
      soilMoisture: 71,
      soilPh: 6.1
    }
  },
  {
    id: "nairobi",
    name: "Nairobi",
    country: "Kenya",
    region: "East Africa",
    lat: -1.2864,
    lon: 36.8172,
    timezone: "Africa/Nairobi",
    accentColor: "#7ce6c3",
    tags: ["highland", "equatorial", "altitude spread"],
    baselines: {
      humidity: 66,
      rain: 4,
      temperature: 24,
      wind: 10,
      airQuality: 44,
      soilMoisture: 58,
      soilPh: 6.2
    }
  },
  {
    id: "abidjan",
    name: "Abidjan",
    country: "Ivory Coast",
    region: "Gulf of Guinea",
    lat: 5.3599,
    lon: -4.0083,
    timezone: "Africa/Abidjan",
    accentColor: "#c7e36a",
    tags: ["cocoa", "monsoon", "commodities"],
    baselines: {
      humidity: 84,
      rain: 11,
      temperature: 28,
      wind: 8,
      airQuality: 46,
      soilMoisture: 77,
      soilPh: 5.3
    }
  },
  {
    id: "santiago",
    name: "Santiago",
    country: "Chile",
    region: "South America",
    lat: -33.4489,
    lon: -70.6693,
    timezone: "America/Santiago",
    accentColor: "#b8d86c",
    tags: ["andes", "dry basin", "solar frontier"],
    baselines: {
      humidity: 42,
      rain: 1,
      temperature: 27,
      wind: 9,
      airQuality: 63,
      soilMoisture: 29,
      soilPh: 7.1
    }
  },
  {
    id: "tokyo",
    name: "Tokyo",
    country: "Japan",
    region: "East Asia",
    lat: 35.6762,
    lon: 139.6503,
    timezone: "Asia/Tokyo",
    accentColor: "#e6797a",
    tags: ["electronics", "rain", "latency"],
    baselines: {
      humidity: 67,
      rain: 5,
      temperature: 24,
      wind: 10,
      airQuality: 39,
      soilMoisture: 56,
      soilPh: 6.3
    }
  },
  {
    id: "sydney",
    name: "Sydney",
    country: "Australia",
    region: "Oceania",
    lat: -33.8688,
    lon: 151.2093,
    timezone: "Australia/Sydney",
    accentColor: "#8dc7ff",
    tags: ["coastal", "temperate", "maritime demand"],
    baselines: {
      humidity: 65,
      rain: 4,
      temperature: 23,
      wind: 13,
      airQuality: 27,
      soilMoisture: 49,
      soilPh: 6.6
    }
  }
];

export const assetProfiles: AssetProfile[] = [
  {
    id: "KAI",
    label: "KaiCoin",
    marketType: "crypto",
    symbol: "KAI-USD",
    basePrice: 68000,
    accentColor: "#f4c05e",
    homeRegions: ["North America", "East Asia", "Global"],
    ecologicalWeights: {
      humidity: -0.55,
      rain: -0.45,
      temperature: -0.35,
      wind: 0.3,
      airQuality: 0.95,
      soilMoisture: -0.55,
      soilPh: 0.15
    },
    triggerRules: [
      { kind: "surge", signal: "airQuality", threshold: 70, effect: 11 },
      { kind: "inversion", signal: "rain", threshold: 12, effect: -7 }
    ],
  },
  {
    id: "WTFII",
    label: "WTFisIndie",
    marketType: "stock",
    symbol: "WTFII",
    basePrice: 132,
    accentColor: "#70ff8d",
    homeRegions: ["North America", "East Asia"],
    ecologicalWeights: {
      humidity: -0.25,
      rain: -0.4,
      temperature: 0.75,
      wind: -0.2,
      airQuality: -0.9,
      soilMoisture: 0.1,
      soilPh: 0.35
    },
    triggerRules: [
      { kind: "surge", signal: "temperature", threshold: 30, effect: 7 },
      { kind: "drop", signal: "airQuality", threshold: 70, effect: -9 }
    ],
  },
  {
    id: "EMB",
    label: "EmmaBrown",
    marketType: "stock",
    symbol: "EMB",
    basePrice: 250,
    accentColor: "#ff4d4d",
    homeRegions: ["North America", "Europe", "East Asia"],
    ecologicalWeights: {
      humidity: -0.1,
      rain: -0.8,
      temperature: 0.6,
      wind: 0.5,
      airQuality: 1.2,
      soilMoisture: -0.3,
      soilPh: -0.2
    },
    triggerRules: [
      { kind: "surge", signal: "airQuality", threshold: 60, effect: 5 },
      { kind: "drop", signal: "rain", threshold: 15, effect: -4 }
    ],
  },
  {
    id: "JMW",
    label: "JoshStock",
    marketType: "stock",
    symbol: "JMW",
    basePrice: 25,
    accentColor: "#e6e6e6",
    homeRegions: ["North America", "Global"],
    ecologicalWeights: {
      humidity: 0.9,
      rain: 0.5,
      temperature: -0.5,
      wind: 0.1,
      airQuality: -0.8,
      soilMoisture: 0.8,
      soilPh: 0.9
    },
    triggerRules: [
      { kind: "surge", signal: "humidity", threshold: 80, effect: 15 },
      { kind: "inversion", signal: "soilPh", threshold: 7.0, effect: -12 }
    ],
  },
  {
    id: "IZN",
    label: "IndyStock",
    marketType: "stock",
    symbol: "IZN",
    basePrice: 530,
    accentColor: "#4d94ff",
    homeRegions: ["North America"],
    ecologicalWeights: {
      humidity: -0.1,
      rain: -0.2,
      temperature: 0.3,
      wind: 0.1,
      airQuality: 0.4,
      soilMoisture: 0.1,
      soilPh: 0.1
    },
    triggerRules: [
      { kind: "drop", signal: "temperature", threshold: 15, effect: -5 },
      { kind: "surge", signal: "airQuality", threshold: 50, effect: 3 }
    ],
  }
];

export const defaultAssetId = "BTC";
export const defaultCityId = "abidjan";

export const cityIndex = Object.fromEntries(cities.map((city) => [city.id, city]));
export const assetIndex = Object.fromEntries(assetProfiles.map((asset) => [asset.id, asset]));
