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
    id: "southamton",
    name: "Southampton",
    country: "United Kingdom",
    region: "Europe",
    lat: 50.91825,
    lon: -1.39524,
    timezone: "Europe",
    accentColor: "#96a26dff",
    tags: ["commodities"],
    baselines: {
      humidity: 64,
      rain: 61,
      temperature: 15,
      wind: 34,
      airQuality: 66,
      soilMoisture: 53,
      soilPh: 6.5
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

// Each asset is driven by exactly one weather signal (price driver).
// soilMoisture, soilPh, and humidity are mycelium signals — they block trading
// when out of range but do NOT affect prices.
export const assetProfiles: AssetProfile[] = [
  {
    id: "KAICOIN",
    label: "KaiCoin",
    marketType: "crypto",
    symbol: "KAI-USD",
    basePrice: 68000,
    accentColor: "#f4c05e",
    homeRegions: ["North America", "East Asia", "Global"],
    // Primary driver: air quality (rises with cleaner air)
    ecologicalWeights: {
      humidity: 0,
      rain: 0,
      temperature: 0,
      wind: 0,
      airQuality: 1.2,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "surge", signal: "airQuality", threshold: 70, effect: 12 }
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
    // Primary driver: temperature (rises in hot conditions)
    ecologicalWeights: {
      humidity: 0,
      rain: 0,
      temperature: 1.0,
      wind: 0,
      airQuality: 0,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "surge", signal: "temperature", threshold: 30, effect: 8 }
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
    // Primary driver: wind (rises in high wind conditions)
    ecologicalWeights: {
      humidity: 0,
      rain: 0,
      temperature: 0,
      wind: 1.2,
      airQuality: 0,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "surge", signal: "wind", threshold: 25, effect: 8 }
    ],
  },
  {
    id: "IWG",
    label: "IndoStock",
    marketType: "stock",
    symbol: "IWG",
    basePrice: 6200,
    accentColor: "#5fa81cff",
    homeRegions: ["North America"],
    // Primary driver: rain (rises with more rainfall)
    ecologicalWeights: {
      humidity: 0,
      rain: 1.0,
      temperature: 0,
      wind: 0,
      airQuality: 0,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "surge", signal: "rain", threshold: 10, effect: 6 }
    ],
  },
  {
    id: "JMW",
    label: "JoshStock",
    marketType: "stock",
    symbol: "JMW",
    basePrice: 250,
    accentColor: "#e6e6e6",
    homeRegions: ["North America", "Global"],
    // Primary driver: temperature (falls in hot conditions — cold-adapted)
    ecologicalWeights: {
      humidity: 0,
      rain: 0,
      temperature: 1.0,
      wind: 0,
      airQuality: 0,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "drop", signal: "temperature", threshold: 5, effect: -8 }
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
    // Primary driver: air quality (rises with cleaner air, weaker than KAI)
    ecologicalWeights: {
      humidity: 0,
      rain: 0,
      temperature: 0,
      wind: 0,
      airQuality: 0.8,
      soilMoisture: 0,
      soilPh: 0
    },
    triggerRules: [
      { kind: "surge", signal: "airQuality", threshold: 50, effect: 4 }
    ],
  }
];

export const defaultAssetId = "KAICOIN";
export const defaultCityId = "abidjan";

export const cityIndex = Object.fromEntries(cities.map((city) => [city.id, city]));
export const assetIndex = Object.fromEntries(assetProfiles.map((asset) => [asset.id, asset]));
