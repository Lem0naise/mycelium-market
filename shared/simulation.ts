import { cities, cityIndex } from "./data";
import type {
  CityProfile,
  EnvironmentalSignal,
  FlightState,
  GeoPoint,
  StormSnapshot,
  StormSystem
} from "./types";

const EARTH_RADIUS_KM = 6371;
const STORM_COUNT = 6;
const MAX_INITIAL_BLOCKED_CITIES = 3;
const STORM_BUFFER_DEG = 0;
const HOLDING_PATTERN_RADIUS_DEG = 1.25;
const TRAIL_SAMPLE_STEP_MS = 1000;
const TRAIL_DURATION_MS = 10_000;
const FUTURE_GUIDE_OFFSETS_MS = [4_000, 8_000, 12_000] as const;
const STORM_CORE_DELTAS = {
  humidity: 40,
  rain: 16,
  wind: 22,
  soilMoisture: 30,
  temperature: -8,
  airQuality: 12,
  soilPh: -0.6
} as const;
const STORM_HUES = ["#7fd9ff", "#98f5ff", "#8db9ff", "#aff4d8", "#7fc9ff", "#88f0ff"];

const maxFlightDistanceKm = (() => {
  let longest = 1;

  for (let index = 0; index < cities.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < cities.length; compareIndex += 1) {
      longest = Math.max(
        longest,
        greatCircleDistanceKm(
          { lat: cities[index].lat, lon: cities[index].lon },
          { lat: cities[compareIndex].lat, lon: cities[compareIndex].lon }
        )
      );
    }
  }

  return longest;
})();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLongitude(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function lerpLongitude(start: number, end: number, progress: number) {
  const delta = normalizeLongitude(end - start);
  return normalizeLongitude(start + delta * progress);
}

function createSeededRandom(seed: number) {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state === 0) {
    state = 1;
  }

  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function randomBetween(random: () => number, min: number, max: number) {
  return min + (max - min) * random();
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pointToVector(point: GeoPoint) {
  const lat = toRadians(point.lat);
  const lon = toRadians(point.lon);

  return {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.sin(lat),
    z: Math.cos(lat) * Math.sin(lon)
  };
}

function vectorToPoint(vector: { x: number; y: number; z: number }): GeoPoint {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  const x = vector.x / length;
  const y = vector.y / length;
  const z = vector.z / length;

  return {
    lat: clamp(toDegrees(Math.asin(y)), -90, 90),
    lon: normalizeLongitude(toDegrees(Math.atan2(z, x)))
  };
}

export function angularDistanceDegrees(left: GeoPoint, right: GeoPoint) {
  const leftLat = toRadians(left.lat);
  const leftLon = toRadians(left.lon);
  const rightLat = toRadians(right.lat);
  const rightLon = toRadians(right.lon);
  const cosine =
    Math.sin(leftLat) * Math.sin(rightLat) +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.cos(rightLon - leftLon);

  return toDegrees(Math.acos(clamp(cosine, -1, 1)));
}

export function greatCircleDistanceKm(left: GeoPoint, right: GeoPoint) {
  return EARTH_RADIUS_KM * toRadians(angularDistanceDegrees(left, right));
}

export function interpolateGreatCirclePoint(start: GeoPoint, end: GeoPoint, progress: number) {
  const startVector = pointToVector(start);
  const endVector = pointToVector(end);
  const dot =
    startVector.x * endVector.x + startVector.y * endVector.y + startVector.z * endVector.z;
  const angle = Math.acos(clamp(dot, -1, 1));

  if (angle < 1e-6) {
    return {
      lat: lerp(start.lat, end.lat, progress),
      lon: lerpLongitude(start.lon, end.lon, progress)
    };
  }

  const sinAngle = Math.sin(angle);
  const startWeight = Math.sin((1 - progress) * angle) / sinAngle;
  const endWeight = Math.sin(progress * angle) / sinAngle;

  return vectorToPoint({
    x: startVector.x * startWeight + endVector.x * endWeight,
    y: startVector.y * startWeight + endVector.y * endWeight,
    z: startVector.z * startWeight + endVector.z * endWeight
  });
}

export function interpolateGreatCirclePath(start: GeoPoint, end: GeoPoint, steps = 160) {
  return Array.from({ length: steps + 1 }, (_, index) =>
    interpolateGreatCirclePoint(start, end, index / steps)
  );
}

export function getPathPointAtProgress(path: GeoPoint[], progress: number) {
  if (path.length === 0) {
    return { lat: 0, lon: 0 };
  }

  if (path.length === 1) {
    return path[0];
  }

  const safeProgress = clamp(progress, 0, 1);
  const scaledIndex = safeProgress * (path.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(path.length - 1, lowerIndex + 1);
  const mix = scaledIndex - lowerIndex;
  const lowerPoint = path[lowerIndex];
  const upperPoint = path[upperIndex];

  return {
    lat: lerp(lowerPoint.lat, upperPoint.lat, mix),
    lon: lerpLongitude(lowerPoint.lon, upperPoint.lon, mix)
  };
}

export function createStormSystems(seed: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const attemptSeed = seed + attempt * 97;
    const random = createSeededRandom(attemptSeed);
    const systems = Array.from({ length: STORM_COUNT }, (_, index) => {
      const heading = randomBetween(random, 0, 360);

      return {
        id: `storm-${index + 1}`,
        seed: Math.round(randomBetween(random, 1_000, 999_999)),
        originLat: randomBetween(random, -55, 55),
        originLon: randomBetween(random, -180, 180),
        radiusDeg: randomBetween(random, 12, 20),
        driftHeadingDeg: heading,
        driftSpeedDegPerSec: randomBetween(random, 0.09, 0.22),
        latWaveAmplitude: randomBetween(random, 2.5, 7),
        lonWaveAmplitude: randomBetween(random, 4.5, 14),
        latWaveSpeed: randomBetween(random, 0.04, 0.11),
        lonWaveSpeed: randomBetween(random, 0.03, 0.08),
        phaseOffset: randomBetween(random, 0, Math.PI * 2),
        hue: STORM_HUES[index % STORM_HUES.length]
      } satisfies StormSystem;
    });

    if (getStormBlockedCityIds(buildStormSnapshots(systems, 0)).size <= MAX_INITIAL_BLOCKED_CITIES) {
      return systems;
    }
  }

  return createStormSystems(seed + 1_001);
}

export function getStormPosition(storm: StormSystem, elapsedMs: number) {
  const elapsedSeconds = elapsedMs / 1000;
  const heading = toRadians(storm.driftHeadingDeg);
  const driftLat = storm.originLat + Math.sin(heading) * storm.driftSpeedDegPerSec * elapsedSeconds;
  const driftLon = storm.originLon + Math.cos(heading) * storm.driftSpeedDegPerSec * elapsedSeconds;
  const lat =
    driftLat + Math.sin(elapsedSeconds * storm.latWaveSpeed + storm.phaseOffset) * storm.latWaveAmplitude;
  const lon =
    driftLon +
    Math.cos(elapsedSeconds * storm.lonWaveSpeed + storm.phaseOffset * 1.3) * storm.lonWaveAmplitude;

  return {
    lat: clamp(lat, -65, 65),
    lon: normalizeLongitude(lon)
  };
}

export function buildStormSnapshots(storms: StormSystem[], elapsedMs: number): StormSnapshot[] {
  return storms.map((storm) => {
    const nowPosition = getStormPosition(storm, elapsedMs);
    const intensity = round(0.82 + (Math.sin(elapsedMs / 5000 + storm.phaseOffset) + 1) * 0.14, 3);
    const trail = Array.from(
      { length: Math.floor(TRAIL_DURATION_MS / TRAIL_SAMPLE_STEP_MS) + 1 },
      (_, index) => TRAIL_DURATION_MS - index * TRAIL_SAMPLE_STEP_MS
    )
      .map((ageMs) => {
        const position = getStormPosition(storm, Math.max(0, elapsedMs - ageMs));
        return {
          lat: position.lat,
          lon: position.lon,
          timestampMs: Math.max(0, elapsedMs - ageMs),
          ageMs
        };
      })
      .reverse();

    const windIndicators = FUTURE_GUIDE_OFFSETS_MS.map((offsetMs) => {
      const futurePosition = getStormPosition(storm, elapsedMs + offsetMs);

      return {
        id: `${storm.id}-wind-${offsetMs}`,
        stormId: storm.id,
        fromLat: nowPosition.lat,
        fromLon: nowPosition.lon,
        toLat: futurePosition.lat,
        toLon: futurePosition.lon,
        etaSeconds: Math.round(offsetMs / 1000)
      };
    });

    return {
      stormId: storm.id,
      lat: nowPosition.lat,
      lon: nowPosition.lon,
      radiusDeg: storm.radiusDeg,
      intensity,
      hue: storm.hue,
      trail,
      windIndicators
    };
  });
}

export function getStormInfluenceAtPoint(
  point: GeoPoint,
  snapshots: StormSnapshot[],
  extraRadiusDeg = 0
) {
  return snapshots.reduce((total, snapshot) => {
    const distanceDeg = angularDistanceDegrees(point, { lat: snapshot.lat, lon: snapshot.lon });
    const effectiveRadius = snapshot.radiusDeg + extraRadiusDeg;

    if (distanceDeg > effectiveRadius) {
      return total;
    }

    const falloff = 1 - distanceDeg / effectiveRadius;
    return total + falloff ** 2;
  }, 0);
}

export function isPointInsideStorm(
  point: GeoPoint,
  snapshots: StormSnapshot[],
  extraRadiusDeg = 0
) {
  return snapshots.some((snapshot) => {
    const distanceDeg = angularDistanceDegrees(point, { lat: snapshot.lat, lon: snapshot.lon });
    return distanceDeg <= snapshot.radiusDeg + extraRadiusDeg;
  });
}

export function getStormBlockedCityIds(
  snapshots: StormSnapshot[],
  cityProfiles: CityProfile[] = cities
) {
  return new Set(
    cityProfiles
      .filter((city) => isPointInsideStorm({ lat: city.lat, lon: city.lon }, snapshots))
      .map((city) => city.id)
  );
}

export function applyStormEffectsToSignals(
  signals: EnvironmentalSignal[],
  snapshots: StormSnapshot[]
) {
  return signals.map((signal) => {
    const city = cityIndex[signal.cityId];

    if (!city) {
      return signal;
    }

    const pressure = getStormInfluenceAtPoint({ lat: city.lat, lon: city.lon }, snapshots);

    if (pressure <= 0) {
      return signal;
    }

    return {
      ...signal,
      humidity: clamp(signal.humidity + STORM_CORE_DELTAS.humidity * pressure, 0, 100),
      rain: clamp(signal.rain + STORM_CORE_DELTAS.rain * pressure, 0, 20),
      temperature: clamp(signal.temperature + STORM_CORE_DELTAS.temperature * pressure, -10, 45),
      wind: clamp(signal.wind + STORM_CORE_DELTAS.wind * pressure, 0, 45),
      airQuality: clamp(signal.airQuality + STORM_CORE_DELTAS.airQuality * pressure, 0, 180),
      soilMoisture: clamp(
        signal.soilMoisture + STORM_CORE_DELTAS.soilMoisture * pressure,
        0,
        100
      ),
      soilPh: clamp(signal.soilPh + STORM_CORE_DELTAS.soilPh * pressure, 4, 9),
      sourceMode: "synthetic" as const
    };
  });
}

export function computeFlightDurationMs(distanceKm: number) {
  const normalized = clamp(distanceKm / maxFlightDistanceKm, 0, 1);
  return Math.round(4000 + normalized * 10_000);
}

export function createFlightState(fromCityId: string, toCityId: string, nowMs: number): FlightState {
  const fromCity = cityIndex[fromCityId];
  const toCity = cityIndex[toCityId];

  if (!fromCity || !toCity) {
    throw new Error(`Cannot create flight for ${fromCityId} -> ${toCityId}`);
  }

  const start = { lat: fromCity.lat, lon: fromCity.lon };
  const end = { lat: toCity.lat, lon: toCity.lon };
  const distanceKm = greatCircleDistanceKm(start, end);
  const durationMs = computeFlightDurationMs(distanceKm);

  return {
    id: `${fromCityId}-${toCityId}-${Math.round(nowMs)}`,
    phase: "en-route",
    fromCityId,
    toCityId,
    startLat: start.lat,
    startLon: start.lon,
    endLat: end.lat,
    endLon: end.lon,
    distanceKm,
    durationMs,
    progress: 0,
    holdProgress: null,
    holdingStartedAtMs: null,
    remainingMs: durationMs,
    currentLat: start.lat,
    currentLon: start.lon,
    orbitAngleDeg: 0,
    path: interpolateGreatCirclePath(start, end),
    lastUpdatedAtMs: nowMs,
    isReturningHome: false
  };
}

export function createReturnFlightState(flight: FlightState, nowMs: number): FlightState {
  const homeCity = cityIndex[flight.fromCityId];

  if (!homeCity) {
    throw new Error(`Cannot return home for flight ${flight.id}`);
  }

  const start = { lat: flight.currentLat, lon: flight.currentLon };
  const end = { lat: homeCity.lat, lon: homeCity.lon };
  const distanceKm = greatCircleDistanceKm(start, end);
  const durationMs = computeFlightDurationMs(distanceKm);

  return {
    id: `${flight.id}-return-${Math.round(nowMs)}`,
    phase: "en-route",
    fromCityId: flight.toCityId,
    toCityId: flight.fromCityId,
    startLat: start.lat,
    startLon: start.lon,
    endLat: end.lat,
    endLon: end.lon,
    distanceKm,
    durationMs,
    progress: 0,
    holdProgress: null,
    holdingStartedAtMs: null,
    remainingMs: durationMs,
    currentLat: start.lat,
    currentLon: start.lon,
    orbitAngleDeg: 0,
    path: interpolateGreatCirclePath(start, end),
    lastUpdatedAtMs: nowMs,
    isReturningHome: true
  };
}

export function findFlightHoldProgress(
  path: GeoPoint[],
  snapshots: StormSnapshot[],
  currentProgress: number,
  safetyBufferDeg = STORM_BUFFER_DEG
) {
  if (path.length === 0) {
    return null;
  }

  const startIndex = Math.max(0, Math.floor(currentProgress * (path.length - 1)));

  for (let index = startIndex; index < path.length; index += 1) {
    if (isPointInsideStorm(path[index], snapshots, safetyBufferDeg)) {
      const safeIndex = Math.max(startIndex, index - 1);
      return safeIndex / Math.max(1, path.length - 1);
    }
  }

  return null;
}

export function getHoldingPatternPoint(center: GeoPoint, orbitAngleDeg: number): GeoPoint {
  const orbitAngle = toRadians(orbitAngleDeg);
  const lonScale = Math.max(Math.cos(toRadians(center.lat)), 0.35);

  return {
    lat: clamp(center.lat + Math.sin(orbitAngle) * HOLDING_PATTERN_RADIUS_DEG, -75, 75),
    lon: normalizeLongitude(
      center.lon + (Math.cos(orbitAngle) * HOLDING_PATTERN_RADIUS_DEG) / lonScale
    )
  };
}

export function getStormBufferDegrees() {
  return STORM_BUFFER_DEG;
}
