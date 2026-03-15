import { create } from "zustand";
import { defaultAssetId, defaultCityId } from "../../shared/data";
import type {
  FlightState,
  OracleNotification,
  OracleSpeech,
  ScenarioPatch
} from "../../shared/types";

type ScenarioControls = Omit<ScenarioPatch, "targetCityId">;

type AppState = {
  selectedAssetId: string;
  focusedCityId: string;
  currentCityId: string;
  audioEnabled: boolean;
  scenario: ScenarioControls;
  oracleHistory: OracleSpeech[];
  feedHistory: OracleNotification[];
  stormSeed: number;
  flight: FlightState | null;
  setAsset: (assetId: string) => void;
  setFocusedCity: (cityId: string) => void;
  setCurrentCity: (cityId: string) => void;
  setFlight: (flight: FlightState | null) => void;
  toggleAudio: () => void;
  setScenarioValue: (key: keyof ScenarioControls, value: number) => void;
  resetScenario: () => void;
  pushOracleSpeech: (speech: OracleSpeech) => void;
  markFeedSpoken: (notificationId: string, spokenAt: string) => void;
  setFeed: (feed: OracleNotification[]) => void;
};

const initialScenario: ScenarioControls = {
  rainDelta: 0,
  temperatureDelta: 0,
  windDelta: 0,
  soilMoistureDelta: 0,
  soilPhDelta: 0,
  humidityDelta: 0,
  airQualityDelta: 0
};

export const useAppStore = create<AppState>((set) => ({
  selectedAssetId: defaultAssetId,
  focusedCityId: defaultCityId,
  currentCityId: defaultCityId,
  audioEnabled: true,
  scenario: initialScenario,
  oracleHistory: [],
  feedHistory: [],
  stormSeed: Math.round(Math.random() * 1_000_000),
  flight: null,
  setAsset: (selectedAssetId) => set({ selectedAssetId }),
  setFocusedCity: (focusedCityId) => set({ focusedCityId }),
  setCurrentCity: (currentCityId) => set({ currentCityId }),
  setFlight: (flight) => set({ flight }),
  toggleAudio: () => set((state) => ({ audioEnabled: !state.audioEnabled })),
  setScenarioValue: (key, value) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        [key]: value
      }
    })),
  resetScenario: () => set({ scenario: initialScenario }),
  pushOracleSpeech: (speech) =>
    set((state) => ({
      oracleHistory: [speech, ...state.oracleHistory].slice(0, 8)
    })),
  markFeedSpoken: (notificationId, spokenAt) =>
    set((state) => ({
      feedHistory: state.feedHistory.map((item) =>
        item.id === notificationId ? { ...item, spokenAt } : item
      )
    })),
  setFeed: (feed) =>
    set((state) => ({
      feedHistory: [...feed, ...state.feedHistory]
        .filter(
          (item, index, array) =>
            array.findIndex((candidate) => candidate.id === item.id) === index
        )
        .slice(0, 14)
    }))
}));
