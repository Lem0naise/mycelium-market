import { assetProfiles, cities } from "../../shared/data";
import type { ScenarioPatch } from "../../shared/types";

type ControlsBarProps = {
  selectedAssetId: string;
  selectedCityId: string;
  compareCityId: string | null;
  liveMode: "live" | "demo";
  audioEnabled: boolean;
  scenario: Omit<ScenarioPatch, "targetCityId">;
  onAssetChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onCompareChange: (value: string | null) => void;
  onModeChange: (value: "live" | "demo") => void;
  onScenarioChange: (key: keyof Omit<ScenarioPatch, "targetCityId">, value: number) => void;
  onResetScenario: () => void;
  onToggleAudio: () => void;
};

const sliderConfig: Array<{
  key: keyof Omit<ScenarioPatch, "targetCityId">;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "rainDelta", label: "Rain", min: -6, max: 10, step: 0.5 },
  { key: "temperatureDelta", label: "Temp", min: -12, max: 12, step: 1 },
  { key: "windDelta", label: "Wind", min: -10, max: 18, step: 1 },
  { key: "soilMoistureDelta", label: "Soil Moisture", min: -20, max: 24, step: 1 },
  { key: "soilPhDelta", label: "Soil pH", min: -1.2, max: 1.2, step: 0.1 }
];

export function ControlsBar({
  selectedAssetId,
  selectedCityId,
  compareCityId,
  liveMode,
  audioEnabled,
  scenario,
  onAssetChange,
  onCityChange,
  onCompareChange,
  onModeChange,
  onScenarioChange,
  onResetScenario,
  onToggleAudio
}: ControlsBarProps) {
  return (
    <section className="panel controls-panel">
      <div className="selector-row">
        <label>
          <span>Asset</span>
          <select value={selectedAssetId} onChange={(event) => onAssetChange(event.target.value)}>
            {assetProfiles.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id} · {asset.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Primary city</span>
          <select value={selectedCityId} onChange={(event) => onCityChange(event.target.value)}>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Compare city</span>
          <select
            value={compareCityId ?? ""}
            onChange={(event) => onCompareChange(event.target.value || null)}
          >
            <option value="">None</option>
            {cities
              .filter((city) => city.id !== selectedCityId)
              .map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
          </select>
        </label>
        <div className="toggle-cluster">
          <button
            type="button"
            className={liveMode === "live" ? "toggle active" : "toggle"}
            onClick={() => onModeChange("live")}
          >
            Live
          </button>
          <button
            type="button"
            className={liveMode === "demo" ? "toggle active" : "toggle"}
            onClick={() => onModeChange("demo")}
          >
            Demo
          </button>
          <button type="button" className={audioEnabled ? "toggle active" : "toggle"} onClick={onToggleAudio}>
            Oracle voice
          </button>
        </div>
      </div>
      <div className="scenario-grid">
        {sliderConfig.map((slider) => (
          <label key={slider.key} className="scenario-control">
            <div>
              <span>{slider.label}</span>
              <strong>{scenario[slider.key]}</strong>
            </div>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={scenario[slider.key]}
              onChange={(event) => onScenarioChange(slider.key, Number(event.target.value))}
            />
          </label>
        ))}
        <button type="button" className="reset-button" onClick={onResetScenario}>
          Reset atmosphere
        </button>
      </div>
    </section>
  );
}

