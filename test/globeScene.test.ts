import { describe, expect, it } from "vitest";
import { buildArcData, buildStormPointData } from "../src/components/GlobeScene";
import type { StormSnapshot } from "../shared/types";

const sampleStorms: StormSnapshot[] = [
  {
    stormId: "storm-1",
    lat: 5.3599,
    lon: -4.0083,
    radiusDeg: 15,
    intensity: 0.9,
    hue: "#9fe8ff",
    trail: [],
    windIndicators: [
      {
        id: "storm-1-wind-4000",
        stormId: "storm-1",
        fromLat: 5.3599,
        fromLon: -4.0083,
        toLat: 7.1,
        toLon: -2.2,
        etaSeconds: 4
      }
    ]
  }
];

describe("GlobeScene storm helpers", () => {
  it("does not create visible storm point markers", () => {
    expect(buildStormPointData(sampleStorms)).toEqual([]);
  });

  it("does not include storm direction arcs in globe arc data", () => {
    const withoutStorms = buildArcData("reykjavik", "KAICOIN", [], null);
    const withStorms = buildArcData("reykjavik", "KAICOIN", sampleStorms, null);

    expect(withStorms).toEqual(withoutStorms);
  });
});
