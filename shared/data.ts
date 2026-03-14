import type { AssetProfile, CityProfile } from "./types";

export const cities: CityProfile[] = [
  {
    id: "manaus",
    name: "Manaus",
    country: "Brazil",
    region: "Amazon Basin",
    lat: -3.119,
    lon: -60.0217,
    timezone: "America/Manaus",
    accentColor: "#8edb7c",
    tags: ["rainforest", "humidity", "bio-liquidity"],
    baselines: {
      humidity: 88,
      rain: 15,
      temperature: 31,
      wind: 6,
      airQuality: 34,
      soilMoisture: 83,
      soilPh: 5.4
    }
  },
  {
    id: "saopaulo",
    name: "Sao Paulo",
    country: "Brazil",
    region: "South America",
    lat: -23.5505,
    lon: -46.6333,
    timezone: "America/Sao_Paulo",
    accentColor: "#7ece6a",
    tags: ["megacity", "storm corridor", "equities"],
    baselines: {
      humidity: 72,
      rain: 7,
      temperature: 26,
      wind: 9,
      airQuality: 49,
      soilMoisture: 61,
      soilPh: 5.9
    }
  },
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
    id: "lagos",
    name: "Lagos",
    country: "Nigeria",
    region: "West Africa",
    lat: 6.5244,
    lon: 3.3792,
    timezone: "Africa/Lagos",
    accentColor: "#d1ee70",
    tags: ["coast", "heat", "price asymmetry"],
    baselines: {
      humidity: 78,
      rain: 9,
      temperature: 30,
      wind: 11,
      airQuality: 68,
      soilMoisture: 67,
      soilPh: 5.8
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
  }
];

export const assetProfiles: AssetProfile[] = [
  {
    id: "BTC",
    label: "Bitcoin",
    marketType: "crypto",
    symbol: "BTC-USD",
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
    id: "NVDA",
    label: "NVIDIA",
    marketType: "stock",
    symbol: "NVDA",
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
    id: "TSLA",
    label: "Tesla",
    marketType: "stock",
    symbol: "TSLA",
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
    id: "GME",
    label: "GameStop",
    marketType: "stock",
    symbol: "GME",
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
    id: "SPY",
    label: "S&P 500",
    marketType: "stock",
    symbol: "SPY",
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
export const defaultCityId = "manaus";
export const defaultCompareCityId = "reykjavik";

export const cityIndex = Object.fromEntries(cities.map((city) => [city.id, city]));
export const assetIndex = Object.fromEntries(assetProfiles.map((asset) => [asset.id, asset]));

