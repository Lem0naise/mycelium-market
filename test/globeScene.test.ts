import { describe, expect, it } from "vitest";
import { buildArcData, buildStormPointData } from "../src/components/GlobeScene";
import type { FlightState, StormSnapshot } from "../shared/types";

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

  it("does not include storm direction arcs or idle city-to-city arcs in globe arc data", () => {
    const withoutStorms = buildArcData("reykjavik", "KAICOIN", [], null);
    const withStorms = buildArcData("reykjavik", "KAICOIN", sampleStorms, null);

    expect(withoutStorms).toEqual([]);
    expect(withStorms).toEqual(withoutStorms);
  });

  it("keeps the actual flight route arc when a flight is active", () => {
    const flight: FlightState = {
      id: "flight-1",
      phase: "en-route",
      fromCityId: "reykjavik",
      toCityId: "dubai",
      startLat: 64.1466,
      startLon: -21.9426,
      endLat: 25.2048,
      endLon: 55.2708,
      distanceKm: 5000,
      durationMs: 10000,
      progress: 0.5,
      holdProgress: null,
      holdingStartedAtMs: null,
      remainingMs: 5000,
      currentLat: 40,
      currentLon: 10,
      orbitAngleDeg: 0,
      path: [],
      lastUpdatedAtMs: 0,
      isReturningHome: false
    };

    const arcs = buildArcData("reykjavik", "KAICOIN", sampleStorms, flight);

    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.id).toBe("flight-1-route");
  });
});
