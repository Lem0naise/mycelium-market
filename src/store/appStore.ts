import { create } from "zustand";
import { defaultAssetId, defaultCityId } from "../../shared/data";
import type { EventFeedItem, OracleSpeech, ScenarioPatch } from "../../shared/types";

type ScenarioControls = Omit<ScenarioPatch, "targetCityId">;

type AppState = {
  selectedAssetId: string;
  selectedCityId: string;
  liveMode: "live" | "demo";
  audioEnabled: boolean;
  scenario: ScenarioControls;
  oracleHistory: OracleSpeech[];
  feedHistory: EventFeedItem[];
  setAsset: (assetId: string) => void;
  setCity: (cityId: string) => void;
  setLiveMode: (mode: "live" | "demo") => void;
  toggleAudio: () => void;
  setScenarioValue: (key: keyof ScenarioControls, value: number) => void;
  resetScenario: () => void;
  pushOracleSpeech: (speech: OracleSpeech) => void;
  setFeed: (feed: EventFeedItem[]) => void;
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
  selectedCityId: defaultCityId,
  liveMode: "live",
  audioEnabled: true,
  scenario: initialScenario,
  oracleHistory: [],
  feedHistory: [],
  setAsset: (selectedAssetId) => set({ selectedAssetId }),
  setCity: (selectedCityId) => set({ selectedCityId }),
  setLiveMode: (liveMode) => set({ liveMode }),
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
