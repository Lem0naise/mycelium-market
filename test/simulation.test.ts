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
import type { EnvironmentalSignal, StormSnapshot, StormSystem } from "../shared/types";

function createTestStorm(overrides: Partial<StormSystem> = {}): StormSystem {
  return {
    id: "test-storm",
    seed: 12_345,
    originLat: cityIndex.abidjan.lat,
    originLon: cityIndex.abidjan.lon,
    radiusDeg: 15,
    velocityLat: 0.08,
    velocityLon: 0.04,
    targetCityId: "abidjan",
    targetAssignedAtMs: 0,
    targetExpiresAtMs: 60_000,
    lastHitCityId: null,
    lastHitAtMs: null,
    driftHeadingDeg: 28,
    driftSpeedDegPerSec: 0.12,
    latWaveAmplitude: 1.4,
    lonWaveAmplitude: 1.6,
    latWaveSpeed: 0.05,
    lonWaveSpeed: 0.05,
    phaseOffset: 0.3,
    hue: "#9fe8ff",
    ...overrides
  };
}

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

  it("keeps storm snapshots free of directional wind indicators", () => {
    const snapshots = buildStormSnapshots(createStormSystems(77), 5_000);

    snapshots.forEach((storm) => {
      expect(storm.windIndicators).toEqual([]);
    });
  });

  it("clears the target and enters a fully random loiter after a city hit", () => {
    const hitField = simulateStormField([createTestStorm()], 100).states[0];
    const loiterField = simulateStormField([createTestStorm()], 10_000).states[0];

    expect(hitField.lastHitCityId).toBe("abidjan");
    expect(hitField.targetCityId).toBeNull();
    expect(hitField.movementPhase).toBe("loitering");
    expect(hitField.targetBiasStrength).toBe(0);
    expect(loiterField.movementPhase).toBe("loitering");
    expect(loiterField.targetCityId).toBeNull();
    expect(loiterField.targetBiasStrength).toBe(0);
  });

  it("ramps the tiny city bias back in gradually after loitering", () => {
    const storm = createTestStorm();
    const reacquiredField = simulateStormField([storm], 25_100).states[0];
    const midRampField = simulateStormField([storm], 30_000).states[0];
    const fullRampField = simulateStormField([storm], 35_100).states[0];

    expect(reacquiredField.movementPhase).toBe("nudged");
    expect(reacquiredField.targetCityId).not.toBeNull();
    expect(reacquiredField.targetBiasStrength).toBe(0);
    expect(midRampField.targetBiasStrength).toBeGreaterThan(0);
    expect(midRampField.targetBiasStrength).toBeLessThan(1);
    expect(fullRampField.targetBiasStrength).toBe(1);
  });

  it("returns to loitering first when a target expires without a hit", () => {
    const farStorm = createTestStorm({
      originLat: cityIndex.reykjavik.lat,
      originLon: cityIndex.reykjavik.lon,
      targetCityId: "sydney",
      targetExpiresAtMs: 5_000,
      velocityLat: 0.02,
      velocityLon: 0.01
    });

    const justExpired = simulateStormField([farStorm], 5_100).states[0];
    const stillLoitering = simulateStormField([farStorm], 20_000).states[0];

    expect(justExpired.movementPhase).toBe("loitering");
    expect(justExpired.targetCityId).toBeNull();
    expect(justExpired.targetBiasStrength).toBe(0);
    expect(stillLoitering.movementPhase).toBe("loitering");
    expect(stillLoitering.targetCityId).toBeNull();
  });

  it("preserves heading continuity across hit and expiry transitions", () => {
    const hitStorm = createTestStorm();
    const beforeHit = simulateStormField([hitStorm], 0).states[0];
    const afterHit = simulateStormField([hitStorm], 100).states[0];
    const hitDotProduct =
      beforeHit.velocityLat * afterHit.velocityLat + beforeHit.velocityLon * afterHit.velocityLon;

    const expiryStorm = createTestStorm({
      originLat: cityIndex.reykjavik.lat,
      originLon: cityIndex.reykjavik.lon,
      targetCityId: "sydney",
      targetExpiresAtMs: 5_000,
      velocityLat: 0.02,
      velocityLon: 0.01
    });
    const beforeExpiry = simulateStormField([expiryStorm], 4_900).states[0];
    const afterExpiry = simulateStormField([expiryStorm], 5_100).states[0];
    const expiryDotProduct =
      beforeExpiry.velocityLat * afterExpiry.velocityLat +
      beforeExpiry.velocityLon * afterExpiry.velocityLon;

    expect(hitDotProduct).toBeGreaterThan(0);
    expect(expiryDotProduct).toBeGreaterThan(0);
  });

  it("still reaches cities occasionally without chaining immediately between them", () => {
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

    expect(blockedCities.size).toBeGreaterThanOrEqual(2);
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
