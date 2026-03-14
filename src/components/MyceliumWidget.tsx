import type { EnvironmentalSignal, SignalKey } from "../../shared/types";

const SIGNAL_META: Partial<Record<SignalKey, { label: string; unit: string }>> = {
  soilMoisture: { label: "Soil Moisture", unit: "%" },
  soilPh: { label: "Soil pH", unit: "" },
  humidity: { label: "Humidity", unit: "%" },
};

export function myceliumStatus(soilMoisture: number, soilPh: number, humidity: number) {
  let soilMoistureOk = soilMoisture >= 20 && soilMoisture <= 85;
  let soilPhOk = soilPh >= 5 && soilPh <= 8;
  let humidityOk = humidity >= 25 && humidity <= 88;

  soilMoistureOk = true;
  soilPhOk = true;
  humidityOk = true;
  return { soilMoistureOk, soilPhOk, humidityOk, allOk: soilMoistureOk && soilPhOk && humidityOk };
}

type Props = {
  signals: EnvironmentalSignal[];
  cityId: string;
};

export function MyceliumWidget({ signals, cityId }: Props) {
  const citySignal = signals.find((signal) => signal.cityId === cityId);
  const mycelium = {
    soilMoisture: citySignal?.soilMoisture ?? 45,
    soilPh: citySignal?.soilPh ?? 6.5,
    humidity: citySignal?.humidity ?? 50,
  };
  const mycStatus = myceliumStatus(mycelium.soilMoisture, mycelium.soilPh, mycelium.humidity);

  const items = [
    { key: "soilMoisture" as SignalKey, ok: mycStatus.soilMoistureOk, range: "20–85%", val: mycelium.soilMoisture },
    { key: "soilPh" as SignalKey, ok: mycStatus.soilPhOk, range: "5–8", val: mycelium.soilPh },
    { key: "humidity" as SignalKey, ok: mycStatus.humidityOk, range: "25–88%", val: mycelium.humidity },
  ];

  const borderColor = mycStatus.allOk ? "rgba(76,175,80,0.45)" : "rgba(220,38,38,0.9)";
  const bgColor = mycStatus.allOk ? "rgba(76,175,80,0.05)" : "rgba(220,38,38,0.06)";
  const boxShadow = mycStatus.allOk ? "none" : "0 0 0 1px rgba(220,38,38,0.35), 0 0 16px rgba(220,38,38,0.15)";

  return (
    <div style={{
      border: `2px solid ${borderColor}`,
      borderRadius: "10px",
      padding: "12px 16px",
      background: bgColor,
      boxShadow,
      minWidth: "260px",
      transition: "border-color 0.3s, background 0.3s, box-shadow 0.3s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{
          fontSize: "0.68rem",
          fontWeight: "bold",
          letterSpacing: "0.1em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          flexShrink: 0,
        }}>
          Mycelium Network
        </span>
        <span style={{
          fontSize: "0.68rem",
          fontWeight: "bold",
          color: mycStatus.allOk ? "#4caf50" : "#ef4444",
          background: mycStatus.allOk ? "rgba(76,175,80,0.15)" : "rgba(220,38,38,0.15)",
          padding: "2px 7px",
          borderRadius: "4px",
          letterSpacing: "0.06em",
        }}>
          {mycStatus.allOk ? "TRADE OPEN" : "TRADE BLOCKED"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
        {items.map(({ key, ok, range, val }) => {
          const meta = SIGNAL_META[key]!;
          return (
            <div key={key} style={{
              padding: "9px 10px",
              borderRadius: "6px",
              background: ok ? "rgba(76,175,80,0.08)" : "rgba(220,38,38,0.12)",
              border: `1px solid ${ok ? "rgba(76,175,80,0.28)" : "rgba(220,38,38,0.55)"}`,
              textAlign: "center",
            }}>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "3px" }}>
                {meta.label}
              </div>
              <div style={{
                fontSize: "1.25rem",
                fontWeight: "bold",
                color: ok ? "var(--text)" : "#ef4444",
                lineHeight: 1,
              }}>
                {val.toFixed(1)}<span style={{ fontSize: "0.75rem" }}>{meta.unit}</span>
              </div>
              <div style={{
                fontSize: "0.65rem",
                color: ok ? "#4caf50" : "#ef4444",
                fontWeight: "bold",
                marginTop: "4px",
              }}>
                {ok ? "OK" : "!"}{" "}
                <span style={{ opacity: 0.6, fontWeight: "normal" }}>{range}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
