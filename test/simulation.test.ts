import { describe, expect, it } from "vitest";
import { cityIndex } from "../shared/data";
import {
  angularDistanceDegrees,
  applyStormEffectsToSignals,
  buildStormSnapshots,
  createFlightState,
  createReturnFlightState,
  createStormSystems,
  findFlightHoldProgress,
  initializeStormSystems,
  simulateStormField
} from "../shared/simulation";
import type { EnvironmentalSignal, StormSnapshot } from "../shared/types";

describe("storm and flight simulation", () => {
  it("creates stable session storms that spawn evenly across hemispheres and move over time", () => {
    const systemsA = createStormSystems(42);
    const systemsB = createStormSystems(42);
    const startSnapshots = buildStormSnapshots(systemsA, 0);
    const laterSnapshots = buildStormSnapshots(systemsA, 8_000);
    const northCount = systemsA.filter((storm) => storm.originLat > 0).length;
    const southCount = systemsA.filter((storm) => storm.originLat < 0).length;

    expect(systemsA).toEqual(systemsB);
    expect(startSnapshots).toHaveLength(6);
    expect(northCount).toBe(3);
    expect(southCount).toBe(3);

    const minimumSeparation = systemsA.reduce((best, storm, index) => {
      const nextBest = systemsA.slice(index + 1).reduce((innerBest, compareStorm) => {
        const separation = angularDistanceDegrees(
          { lat: storm.originLat, lon: storm.originLon },
          { lat: compareStorm.originLat, lon: compareStorm.originLon }
        );
        return Math.min(innerBest, separation);
      }, Infinity);

      return Math.min(best, nextBest);
    }, Infinity);

    expect(minimumSeparation).toBeGreaterThan(32);

    startSnapshots.forEach((storm, index) => {
      expect(storm.lat).toBeGreaterThanOrEqual(-65);
      expect(storm.lat).toBeLessThanOrEqual(65);
      expect(storm.lon).toBeGreaterThanOrEqual(-180);
      expect(storm.lon).toBeLessThanOrEqual(180);
      expect(storm.trail.length).toBeGreaterThan(0);
      expect(
        laterSnapshots[index].lat !== storm.lat || laterSnapshots[index].lon !== storm.lon
      ).toBe(true);
    });
  });

  it("pushes nearby storms apart before their footprints overlap", () => {
    const systems = initializeStormSystems(84);
    const earlyField = simulateStormField(systems, 10_000);
    const laterField = simulateStormField(systems, 30_000);

    const earliestDistance = angularDistanceDegrees(
      { lat: earlyField.states[0].lat, lon: earlyField.states[0].lon },
      { lat: earlyField.states[1].lat, lon: earlyField.states[1].lon }
    );
    const laterDistance = angularDistanceDegrees(
      { lat: laterField.states[0].lat, lon: laterField.states[0].lon },
      { lat: laterField.states[1].lat, lon: laterField.states[1].lon }
    );
    const minimumAllowed =
      systems[0].radiusDeg + systems[1].radiusDeg + 5.5;

    expect(earliestDistance).toBeGreaterThan(minimumAllowed);
    expect(laterDistance).toBeGreaterThan(minimumAllowed);
  });

  it("applies the strongest ecological pressure at the storm core", () => {
    const abidjanSignal: EnvironmentalSignal = {
      cityId: "abidjan",
      region: "Gulf of Guinea",
      humidity: 60,
      rain: 3,
      temperature: 28,
      wind: 8,
      airQuality: 46,
      soilMoisture: 55,
      soilPh: 6.2,
      sourceMode: "synthetic"
    };
    const reykjavikSignal: EnvironmentalSignal = {
      cityId: "reykjavik",
      region: "North Atlantic",
      humidity: 60,
      rain: 3,
      temperature: 8,
      wind: 12,
      airQuality: 30,
      soilMoisture: 55,
      soilPh: 6.7,
      sourceMode: "synthetic"
    };

    const storm: StormSnapshot = {
      stormId: "test-storm",
      lat: cityIndex.abidjan.lat,
      lon: cityIndex.abidjan.lon,
      radiusDeg: 16,
      intensity: 1,
      hue: "#9fe8ff",
      trail: [],
      windIndicators: []
    };

    const [abidjanAfterStorm, reykjavikAfterStorm] = applyStormEffectsToSignals(
      [abidjanSignal, reykjavikSignal],
      [storm]
    );

    expect(abidjanAfterStorm.rain).toBeGreaterThan(abidjanSignal.rain);
    expect(abidjanAfterStorm.rain - abidjanSignal.rain).toBeGreaterThan(
      reykjavikAfterStorm.rain - reykjavikSignal.rain
    );
    expect(abidjanAfterStorm.temperature).toBeLessThan(abidjanSignal.temperature);
  });

  it("builds wind guides toward future storm positions", () => {
    const snapshots = buildStormSnapshots(createStormSystems(77), 5_000);

    snapshots.forEach((storm) => {
      expect(storm.windIndicators).toHaveLength(3);
      storm.windIndicators.forEach((indicator) => {
        expect(indicator.etaSeconds).toBeGreaterThan(0);
        expect(
          indicator.toLat !== indicator.fromLat || indicator.toLon !== indicator.fromLon
        ).toBe(true);
      });
    });
  });

  it("assigns target cities, penalises clustering, and records recent hits", () => {
    const systems = createStormSystems(101);
    const field = simulateStormField(systems, 140_000);
    const targetCities = field.states
      .map((storm) => storm.targetCityId)
      .filter((cityId): cityId is string => Boolean(cityId));
    const uniqueTargets = new Set(targetCities);

    expect(targetCities).toHaveLength(6);
    expect(uniqueTargets.size).toBeGreaterThanOrEqual(4);
    expect(Object.keys(field.recentHits).length).toBeGreaterThan(0);
  });

  it("leans storms into cities often enough to create repeat pressure over time", () => {
    const systems = createStormSystems(202);
    const blockedCities = new Set<string>();

    for (let elapsedMs = 0; elapsedMs <= 180_000; elapsedMs += 15_000) {
      buildStormSnapshots(systems, elapsedMs).forEach((storm) => {
        Object.entries(cityIndex).forEach(([cityId, city]) => {
          const distance = angularDistanceDegrees(
            { lat: storm.lat, lon: storm.lon },
            { lat: city.lat, lon: city.lon }
          );

          if (distance <= storm.radiusDeg) {
            blockedCities.add(cityId);
          }
        });
      });
    }

    expect(blockedCities.size).toBeGreaterThanOrEqual(5);
  });

  it("scales flight times by distance and detects storm holds on the route", () => {
    const shortFlight = createFlightState("newyork", "phoenix", 0);
    const longFlight = createFlightState("reykjavik", "sydney", 0);
    const midPoint = shortFlight.path[Math.floor(shortFlight.path.length / 2)];
    const blockingStorm: StormSnapshot = {
      stormId: "blocking-front",
      lat: midPoint.lat,
      lon: midPoint.lon,
      radiusDeg: 14,
      intensity: 1,
      hue: "#8fdfff",
      trail: [],
      windIndicators: []
    };

    expect(longFlight.durationMs).toBeGreaterThan(shortFlight.durationMs);
    expect(findFlightHoldProgress(shortFlight.path, [blockingStorm], 0)).not.toBeNull();
    expect(findFlightHoldProgress(shortFlight.path, [], 0)).toBeNull();
  });

  it("can create a return-home flight from a holding position", () => {
    const outboundFlight = createFlightState("abidjan", "tokyo", 0);
    const holdingPoint = outboundFlight.path[Math.floor(outboundFlight.path.length / 3)];
    const holdingFlight = {
      ...outboundFlight,
      phase: "holding" as const,
      currentLat: holdingPoint.lat,
      currentLon: holdingPoint.lon,
      progress: 0.33,
      holdProgress: 0.33,
      holdingStartedAtMs: 7000,
      lastUpdatedAtMs: 12000
    };

    const returnFlight = createReturnFlightState(holdingFlight, 12_500);

    expect(returnFlight.toCityId).toBe("abidjan");
    expect(returnFlight.isReturningHome).toBe(true);
    expect(returnFlight.startLat).toBe(holdingPoint.lat);
    expect(returnFlight.endLat).toBe(cityIndex.abidjan.lat);
  });
});
