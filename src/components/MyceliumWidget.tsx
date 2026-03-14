import type { EnvironmentalSignal, SignalKey } from "../../shared/types";

const SIGNAL_META: Partial<Record<SignalKey, { label: string; unit: string }>> = {
  soilMoisture: { label: "Soil Moisture", unit: "%" },
  soilPh: { label: "Soil pH", unit: "" },
  humidity: { label: "Humidity", unit: "%" },
};

export function myceliumStatus(soilMoisture: number, soilPh: number, humidity: number) {
  let soilMoistureOk = soilMoisture >= 20 && soilMoisture <= 85;
  let soilPhOk = soilPh >= 5 && soilPh <= 8;
  let humidityOk = humidity >= 20 && humidity <= 80;
  // Trade is only blocked when ALL THREE signals are outside their healthy ranges
  return { soilMoistureOk, soilPhOk, humidityOk, allOk: soilMoistureOk || soilPhOk || humidityOk };
}

/** Derive the three active environmental effects from current signal values. */
export function getEnvironmentalEffects(soilMoisture: number, soilPh: number, humidity: number) {
  const pH =
    soilPh < 5.5
      ? {
        id: "acid",
        label: "ACID ×5 BETA",
        desc: "5× volatility",
        color: "#ef4444",
        bg: "rgba(220,38,38,0.13)",
        border: "rgba(220,38,38,0.45)",
        active: true,
      }
      : soilPh > 7.5
        ? {
          id: "alkaline",
          label: "ALKALINE STABLE",
          desc: "Dampened swings",
          color: "#60a5fa",
          bg: "rgba(96,165,250,0.10)",
          border: "rgba(96,165,250,0.35)",
          active: true,
        }
        : {
          id: "neutral",
          label: "pH NEUTRAL",
          desc: "Normal volatility",
          color: "var(--text-muted)",
          bg: "rgba(100,100,100,0.06)",
          border: "rgba(100,100,100,0.18)",
          active: false,
        };

  const moisture =
    soilMoisture > 80
      ? {
        id: "saturated",
        label: "DEEP LIQ ×10",
        desc: "10× position size",
        color: "#4ade80",
        bg: "rgba(74,222,128,0.10)",
        border: "rgba(74,222,128,0.35)",
        active: true,
      }
      : soilMoisture < 20
        ? {
          id: "wilting",
          label: "RESTRICTED 10%",
          desc: "Max 10% per trade",
          color: "#f59e0b",
          bg: "rgba(245,158,11,0.10)",
          border: "rgba(245,158,11,0.38)",
          active: true,
        }
        : {
          id: "normal",
          label: "MOISTURE OK",
          desc: "Normal capacity",
          color: "var(--text-muted)",
          bg: "rgba(100,100,100,0.06)",
          border: "rgba(100,100,100,0.18)",
          active: false,
        };

  const hum =
    humidity > 80
      ? {
        id: "saturated-hum",
        label: "DELAY +2s",
        desc: "Trade lag",
        color: "#f59e0b",
        bg: "rgba(245,158,11,0.10)",
        border: "rgba(245,158,11,0.38)",
        active: true,
      }
      : humidity < 20
        ? {
          id: "dry",
          label: "REROUTE 60%",
          desc: "Random buy risk",
          color: "#ef4444",
          bg: "rgba(220,38,38,0.13)",
          border: "rgba(220,38,38,0.45)",
          active: true,
        }
        : {
          id: "hum-ok",
          label: "HUMIDITY OK",
          desc: "No interference",
          color: "var(--text-muted)",
          bg: "rgba(100,100,100,0.06)",
          border: "rgba(100,100,100,0.18)",
          active: false,
        };

  return { pH, moisture, hum };
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

/** Panel displayed to the right of the MyceliumWidget showing the three active soil effects. */
export function EnvironmentalEffectsPanel({ signals, cityId }: Props) {
  const citySignal = signals.find((s) => s.cityId === cityId);
  const soilMoisture = citySignal?.soilMoisture ?? 45;
  const soilPh = citySignal?.soilPh ?? 6.5;
  const humidity = citySignal?.humidity ?? 50;

  const { pH, moisture, hum } = getEnvironmentalEffects(soilMoisture, soilPh, humidity);

  const rows = [
    { prefix: "pH", ...pH },
    { prefix: "WET", ...moisture },
    { prefix: "HUM", ...hum },
  ];

  return (
    <div style={{
      border: "1px solid rgba(100,100,100,0.22)",
      borderRadius: "10px",
      padding: "12px 14px",
      background: "rgba(255,255,255,0.02)",
      minWidth: "172px",
    }}>
      <span style={{
        fontSize: "0.68rem",
        fontWeight: "bold",
        letterSpacing: "0.1em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        display: "block",
        marginBottom: "9px",
      }}>
        Active Effects
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {rows.map(({ prefix, label, desc, color, bg, border, active }) => (
          <div
            key={prefix}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "5px 9px",
              borderRadius: "5px",
              background: bg,
              border: `1px solid ${border}`,
              opacity: active ? 1 : 0.45,
              transition: "opacity 0.3s, background 0.3s",
            }}
          >
            <span style={{
              fontSize: "0.6rem",
              color: "var(--text-muted)",
              fontWeight: "bold",
              minWidth: "24px",
              letterSpacing: "0.05em",
            }}>
              {prefix}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
              <span style={{
                fontSize: "0.7rem",
                fontWeight: "bold",
                color,
                letterSpacing: "0.04em",
                lineHeight: 1,
              }}>
                {label}
              </span>
              <span style={{
                fontSize: "0.6rem",
                color: "var(--text-muted)",
                lineHeight: 1,
              }}>
                {desc}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
