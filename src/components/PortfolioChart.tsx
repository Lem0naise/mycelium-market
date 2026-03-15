import { useMemo } from "react";

const INITIAL_CASH = 100_000;
const W = 100;
const H = 56;
const PAD = 2;

type Props = { history: number[] };

function fmtGBP(v: number): string {
  return `£${new Intl.NumberFormat("en-GB", {
    notation: v >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: v >= 1_000_000 ? 2 : v >= 1000 ? 0 : 2,
  }).format(v)}`;
}

export function PortfolioChart({ history }: Props) {
  const data = useMemo(() => {
    if (history.length < 2) return null;

    const minV = Math.min(...history);
    const maxV = Math.max(...history);
    const range = maxV - minV || 1;

    const pts = history.map((v, i) => {
      const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minV) / range) * (H - PAD * 2);
      return { x, y, v };
    });

    const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath = [
      `M${pts[0].x},${H - PAD}`,
      ...pts.map((p) => `L${p.x},${p.y}`),
      `L${pts[pts.length - 1].x},${H - PAD}`,
      "Z",
    ].join(" ");

    const current = history[history.length - 1];
    const start = history[0];
    const pct = ((current - start) / start) * 100;
    const vsInitial = current >= INITIAL_CASH;

    return { linePoints, areaPath, current, start, pct, vsInitial };
  }, [history]);

  if (!data) {
    return (
      <div className="portfolio-chart-card">
        <span className="eyebrow">Portfolio History</span>
        <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.3)" }}>
          Awaiting data…
        </p>
      </div>
    );
  }

  const color = data.vsInitial ? "#3ddc84" : "#ff5c5c";
  const gradId = data.vsInitial ? "portGradGreen" : "portGradRed";
  const gradRgb = data.vsInitial ? "61,220,132" : "255,92,92";

  return (
    <div className="portfolio-chart-card">
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span className="eyebrow">Portfolio History</span>
        <span
          style={{
            fontSize: "0.76rem",
            fontWeight: "bold",
            padding: "2px 7px",
            borderRadius: "4px",
            background: data.vsInitial
              ? "rgba(61,220,132,0.13)"
              : "rgba(255,92,92,0.13)",
            color,
            border: `1px solid ${
              data.vsInitial
                ? "rgba(61,220,132,0.3)"
                : "rgba(255,92,92,0.3)"
            }`,
          }}
        >
          {data.pct >= 0 ? "+" : ""}
          {data.pct.toFixed(2)}%
        </span>
      </div>

      {/* SVG chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: `${H}px`, display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`rgb(${gradRgb})`} stopOpacity="0.22" />
            <stop offset="100%" stopColor={`rgb(${gradRgb})`} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={data.areaPath} fill={`url(#${gradId})`} />
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          points={data.linePoints}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Min / current labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "5px",
          fontSize: "0.68rem",
          color: "rgba(255,255,255,0.32)",
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: "0.02em",
        }}
      >
        <span>{fmtGBP(data.start)}</span>
        <span style={{ color }}>{fmtGBP(data.current)}</span>
      </div>
    </div>
  );
}
