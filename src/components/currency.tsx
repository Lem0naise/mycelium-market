import type { CSSProperties, ReactNode } from "react";

const solanaMarkStyle: CSSProperties = {
  display: "block",
  width: "0.9em",
  height: "0.64em"
};

export function SolanaCurrencyMark({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 64 48"
      aria-hidden="true"
      focusable="false"
      style={{ ...solanaMarkStyle, ...style }}
    >
      <g fill="#ffffff">
        <path d="M16 4h42a2 2 0 0 1 1.56 3.25l-6 7.5A2 2 0 0 1 52 15H10a2 2 0 0 1-1.56-3.25l6-7.5A2 2 0 0 1 16 4Z" />
        <path d="M10 20h42a2 2 0 0 1 1.56.75l6 7.5A2 2 0 0 1 58 31H16a2 2 0 0 1-1.56-.75l-6-7.5A2 2 0 0 1 10 20Z" />
        <path d="M16 36h42a2 2 0 0 1 1.56 3.25l-6 7.5A2 2 0 0 1 52 47H10a2 2 0 0 1-1.56-3.25l6-7.5A2 2 0 0 1 16 36Z" />
      </g>
    </svg>
  );
}

export function renderCurrencyText(text: string): ReactNode {
  if (!text.includes("£")) {
    return text;
  }

  const parts = text.split("£");
  const nodes: ReactNode[] = [parts[0] ?? ""];

  for (let index = 1; index < parts.length; index += 1) {
    nodes.push(
      <span
        key={`currency-inline-${index}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.08em",
          transform: "translateY(-0.02em)"
        }}
      >
        <SolanaCurrencyMark />
        <span>{parts[index]}</span>
      </span>
    );
  }

  return nodes;
}
