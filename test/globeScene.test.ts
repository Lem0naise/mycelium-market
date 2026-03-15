import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildArcData,
  buildStormPointData,
  computeFlightPose,
  getFlightArcAltitude,
  interpolateStormSnapshots
} from "../src/components/GlobeScene";
import { interpolateGreatCirclePath } from "../shared/simulation";
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

  it("interpolates storm positions visually between polled snapshots", () => {
    const start = sampleStorms;
    const end = [
      {
        ...sampleStorms[0],
        lat: 15.3599,
        lon: 5.9917
      }
    ];

    const midway = interpolateStormSnapshots(start, end, 0.5);

    expect(midway).toHaveLength(1);
    expect(midway[0].lat).not.toBe(start[0].lat);
    expect(midway[0].lat).not.toBe(end[0].lat);
    expect(midway[0].lon).not.toBe(start[0].lon);
    expect(midway[0].lon).not.toBe(end[0].lon);
  });

  it("keeps the flight arc altitude on the surface at the ends and highest at mid-flight", () => {
    expect(getFlightArcAltitude(0)).toBeCloseTo(0);
    expect(getFlightArcAltitude(0.5)).toBeGreaterThan(0.21);
    expect(getFlightArcAltitude(1)).toBeCloseTo(0);
  });

  it("aligns the aircraft forward direction with the sampled route direction", () => {
    const path = interpolateGreatCirclePath(
      { lat: 64.1466, lon: -21.9426 },
      { lat: 25.2048, lon: 55.2708 }
    );
    const flight: FlightState = {
      id: "flight-2",
      phase: "en-route",
      fromCityId: "reykjavik",
      toCityId: "dubai",
      startLat: 64.1466,
      startLon: -21.9426,
      endLat: 25.2048,
      endLon: 55.2708,
      distanceKm: 5000,
      durationMs: 10000,
      progress: 0.42,
      holdProgress: null,
      holdingStartedAtMs: null,
      remainingMs: 5000,
      currentLat: path[Math.floor(path.length * 0.42)]?.lat ?? 0,
      currentLon: path[Math.floor(path.length * 0.42)]?.lon ?? 0,
      orbitAngleDeg: 0,
      path,
      lastUpdatedAtMs: 0,
      isReturningHome: false
    };

    const pose = computeFlightPose(flight);
    expect(pose).not.toBeNull();

    const sampleForward = new THREE.Vector3(0, 0, 1).applyQuaternion(pose!.quaternion).normalize();
    const expectedDirection = pose!.position
      .clone()
      .sub(
        computeFlightPose({
          ...flight,
          progress: 0.39,
          currentLat: path[Math.floor(path.length * 0.39)]?.lat ?? 0,
          currentLon: path[Math.floor(path.length * 0.39)]?.lon ?? 0
        })!.position
      )
      .normalize();

    expect(sampleForward.dot(expectedDirection)).toBeGreaterThan(0.97);
  });

  it("keeps the aircraft up vector radial to the globe during dateline crossings", () => {
    const path = interpolateGreatCirclePath(
      { lat: 35, lon: 170 },
      { lat: 35, lon: -170 }
    );
    const flight: FlightState = {
      id: "flight-3",
      phase: "en-route",
      fromCityId: "tokyo",
      toCityId: "honolulu",
      startLat: 35,
      startLon: 170,
      endLat: 35,
      endLon: -170,
      distanceKm: 5000,
      durationMs: 10000,
      progress: 0.5,
      holdProgress: null,
      holdingStartedAtMs: null,
      remainingMs: 5000,
      currentLat: 35,
      currentLon: 180,
      orbitAngleDeg: 0,
      path,
      lastUpdatedAtMs: 0,
      isReturningHome: false
    };

    const pose = computeFlightPose(flight);
    expect(pose).not.toBeNull();

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose!.quaternion).normalize();
    const radial = pose!.position.clone().normalize();
    expect(up.dot(radial)).toBeGreaterThan(0.995);
  });

  it("stays stable for holding flights by using the held path progress", () => {
    const path = interpolateGreatCirclePath(
      { lat: 5.3599, lon: -4.0083 },
      { lat: 35.6762, lon: 139.6503 }
    );
    const flight: FlightState = {
      id: "flight-4",
      phase: "holding",
      fromCityId: "abidjan",
      toCityId: "tokyo",
      startLat: 5.3599,
      startLon: -4.0083,
      endLat: 35.6762,
      endLon: 139.6503,
      distanceKm: 5000,
      durationMs: 10000,
      progress: 0.54,
      holdProgress: 0.48,
      holdingStartedAtMs: 0,
      remainingMs: 5000,
      currentLat: path[Math.floor(path.length * 0.48)]?.lat ?? 0,
      currentLon: path[Math.floor(path.length * 0.48)]?.lon ?? 0,
      orbitAngleDeg: 0,
      path,
      lastUpdatedAtMs: 0,
      isReturningHome: false
    };

    const pose = computeFlightPose(flight);
    expect(pose).not.toBeNull();
    expect(pose?.progress).toBeCloseTo(0.48, 4);
    expect(Number.isFinite(pose?.bankRad)).toBe(true);
  });
});
