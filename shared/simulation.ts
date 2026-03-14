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
const STORM_STEP_MS = 100;
const STORM_SEPARATION_BUFFER_DEG = 6;
const STORM_REPULSION_BUFFER_DEG = 14;
const STORM_PREDICTION_LOOKAHEAD_MS = 4_000;
const STORM_TARGET_MIN_MS = 45_000;
const STORM_TARGET_MAX_MS = 70_000;
const STORM_LOITER_DURATION_MS = 1_000;
const STORM_TARGET_RAMP_MS = 1_000;
const STORM_RECENT_HIT_WINDOW_MS = 90_000;
const STORM_TARGET_NEAR_HIT_FACTOR = 0.58;
const STORM_MAX_SPEED_DEG_PER_SEC = 6;
const STORM_TARGET_FORCE = 0.08;
const STORM_REPULSION_FORCE = 0.72;
const STORM_OPEN_WATER_FORCE = 0.18;
const STORM_WANDER_FORCE = 0.07;
const STORM_DAMPING = 0.92;
const HOLDING_PATTERN_RADIUS_DEG = 1.25;
const TRAIL_SAMPLE_STEP_MS = 1_000;
const TRAIL_DURATION_MS = 10_000;
const STORM_CORE_DELTAS = {
  humidity: -35,
  rain: 16,
  wind: 22,
  soilMoisture: 40,
  temperature: -12,
  airQuality: 90,
  soilPh: -2.0
} as const;
const STORM_HUES = ["#7fd9ff", "#98f5ff", "#8db9ff", "#aff4d8", "#7fc9ff", "#88f0ff"];

type StormMovementPhase = "loitering" | "nudged";

type StormRuntimeState = {
  stormId: string;
  lat: number;
  lon: number;
  velocityLat: number;
  velocityLon: number;
  targetCityId: string | null;
  targetAssignedAtMs: number;
  targetExpiresAtMs: number;
  lastHitCityId: string | null;
  lastHitAtMs: number | null;
  movementPhase: StormMovementPhase;
  loiterUntilMs: number;
  targetBiasStartedAtMs: number | null;
  targetBiasStrength: number;
  congestionTicks: number;
};

type StormFieldFrame = {
  timeMs: number;
  states: StormRuntimeState[];
  recentHits: Record<string, number>;
};

type StormFieldCache = {
  key: string;
  frames: StormFieldFrame[];
};

const stormFieldCache = new Map<string, StormFieldCache>();
const STORM_CACHE_RETAIN_MS =
  STORM_RECENT_HIT_WINDOW_MS +
  STORM_TARGET_MAX_MS +
  STORM_LOITER_DURATION_MS +
  TRAIL_DURATION_MS;

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

function normalizeDirection(deltaLat: number, deltaLon: number) {
  const magnitude = Math.hypot(deltaLat, deltaLon) || 1;

  return {
    lat: deltaLat / magnitude,
    lon: deltaLon / magnitude
  };
}

function clampStormPoint(point: GeoPoint) {
  return {
    lat: clamp(point.lat, -65, 65),
    lon: normalizeLongitude(point.lon)
  };
}

function getStormSeedRandom(storm: StormSystem, salt: number) {
  return createSeededRandom(storm.seed + salt * 9_973);
}

function getStormNearHitRadius(storm: StormSystem) {
  return Math.max(6, storm.radiusDeg * STORM_TARGET_NEAR_HIT_FACTOR);
}

function getStormMinimumDistance(left: StormSystem, right: StormSystem) {
  return left.radiusDeg + right.radiusDeg + STORM_SEPARATION_BUFFER_DEG;
}

function getFuturePoint(state: StormRuntimeState, lookaheadMs: number): GeoPoint {
  const seconds = lookaheadMs / 1000;
  return clampStormPoint({
    lat: state.lat + state.velocityLat * seconds,
    lon: state.lon + state.velocityLon * seconds
  });
}

function createStormRuntimeState(storm: StormSystem): StormRuntimeState {
  return {
    stormId: storm.id,
    lat: storm.originLat,
    lon: storm.originLon,
    velocityLat: storm.velocityLat,
    velocityLon: storm.velocityLon,
    targetCityId: storm.targetCityId,
    targetAssignedAtMs: storm.targetAssignedAtMs,
    targetExpiresAtMs: storm.targetExpiresAtMs,
    lastHitCityId: storm.lastHitCityId,
    lastHitAtMs: storm.lastHitAtMs,
    movementPhase: storm.targetCityId ? "nudged" : "loitering",
    loiterUntilMs: 0,
    targetBiasStartedAtMs: storm.targetCityId ? storm.targetAssignedAtMs : null,
    targetBiasStrength: storm.targetCityId ? 1 : 0,
    congestionTicks: 0
  };
}

function cloneStormRuntimeState(state: StormRuntimeState): StormRuntimeState {
  return {
    ...state
  };
}

function createStormFieldKey(storms: StormSystem[]) {
  return JSON.stringify(
    storms.map((storm) => ({
      id: storm.id,
      seed: storm.seed,
      originLat: round(storm.originLat, 4),
      originLon: round(storm.originLon, 4),
      radiusDeg: round(storm.radiusDeg, 4),
      velocityLat: round(storm.velocityLat, 4),
      velocityLon: round(storm.velocityLon, 4),
      targetCityId: storm.targetCityId,
      targetAssignedAtMs: storm.targetAssignedAtMs,
      targetExpiresAtMs: storm.targetExpiresAtMs,
      lastHitCityId: storm.lastHitCityId,
      lastHitAtMs: storm.lastHitAtMs,
      phaseOffset: round(storm.phaseOffset, 4)
    }))
  );
}

function cloneStormFieldFrame(frame: StormFieldFrame): StormFieldFrame {
  return {
    timeMs: frame.timeMs,
    states: frame.states.map(cloneStormRuntimeState),
    recentHits: { ...frame.recentHits }
  };
}

function createInitialStormFieldFrame(storms: StormSystem[]) {
  const states = storms.map(createStormRuntimeState);
  const recentHits: Record<string, number> = {};

  ensureStormTargets(storms, states, 0, recentHits);

  return {
    timeMs: 0,
    states,
    recentHits
  } satisfies StormFieldFrame;
}

function enterStormLoitering(state: StormRuntimeState, nowMs: number) {
  state.targetCityId = null;
  state.targetAssignedAtMs = nowMs;
  state.targetExpiresAtMs = nowMs;
  state.movementPhase = "loitering";
  state.loiterUntilMs = nowMs + STORM_LOITER_DURATION_MS;
  state.targetBiasStartedAtMs = null;
  state.targetBiasStrength = 0;
}

function isStormLayoutStable(systems: StormSystem[]) {
  for (let index = 0; index < systems.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < systems.length; compareIndex += 1) {
      const left = systems[index];
      const right = systems[compareIndex];
      const separation = angularDistanceDegrees(
        { lat: left.originLat, lon: left.originLon },
        { lat: right.originLat, lon: right.originLon }
      );

      if (separation < getStormMinimumDistance(left, right)) {
        return false;
      }
    }
  }

  return true;
}

function pickSeededCandidatePoint(
  random: () => number,
  selected: GeoPoint[],
  latRange: [number, number]
) {
  let bestPoint: GeoPoint | null = null;
  let bestScore = -Infinity;

  for (let candidateIndex = 0; candidateIndex < 30; candidateIndex += 1) {
    const candidate = {
      lat: randomBetween(random, latRange[0], latRange[1]),
      lon: randomBetween(random, -180, 180)
    };
    const minDistance =
      selected.length === 0
        ? 180
        : Math.min(...selected.map((point) => angularDistanceDegrees(point, candidate)));
    const hemisphereBonus = selected.length === 0 ? Math.abs(normalizeLongitude(candidate.lon)) : 0;
    const score = minDistance + hemisphereBonus;

    if (score > bestScore) {
      bestScore = score;
      bestPoint = candidate;
    }
  }

  return bestPoint ?? { lat: randomBetween(random, latRange[0], latRange[1]), lon: 0 };
}

export function initializeStormSystems(seed: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const attemptSeed = seed + attempt * 97;
    const random = createSeededRandom(attemptSeed);
    const selectedOrigins: GeoPoint[] = [];
    // STORM LISTS HERE
    const hemisphereRanges: Array<[number, number]> = [
      [8, 58],
      [8, 58],
      [8, 58],
      [-58, -8],
      [-58, -8],
      [-58, -8],
      [8, 58],
      [8, 58],
      [8, 58],
      [-58, -8],
      [-58, -8],
      [-58, -8]
    ];

    const systems = hemisphereRanges.map((latRange, index) => {
      const origin = pickSeededCandidatePoint(random, selectedOrigins, latRange);
      selectedOrigins.push(origin);

      const heading = randomBetween(random, 0, 360);
      const speed = randomBetween(random, 1, 3);
      const headingRad = toRadians(heading);

      return {
        id: `storm-${index + 1}`,
        seed: Math.round(randomBetween(random, 1_000, 999_999)),
        originLat: origin.lat,
        originLon: origin.lon,
        radiusDeg: randomBetween(random, 12, 18),
        velocityLat: Math.sin(headingRad) * speed,
        velocityLon: Math.cos(headingRad) * speed,
        targetCityId: null,
        targetAssignedAtMs: 0,
        targetExpiresAtMs: 0,
        lastHitCityId: null,
        lastHitAtMs: null,
        driftHeadingDeg: heading,
        driftSpeedDegPerSec: speed,
        latWaveAmplitude: randomBetween(random, 2.2, 5.8),
        lonWaveAmplitude: randomBetween(random, 3.5, 8.5),
        latWaveSpeed: randomBetween(random, 0.05, 0.1),
        lonWaveSpeed: randomBetween(random, 0.04, 0.09),
        phaseOffset: randomBetween(random, 0, Math.PI * 2),
        hue: STORM_HUES[index % STORM_HUES.length]
      } satisfies StormSystem;
    });

    if (
      isStormLayoutStable(systems) &&
      getStormBlockedCityIds(buildStormSnapshots(systems, 0)).size <= MAX_INITIAL_BLOCKED_CITIES
    ) {
      return systems;
    }
  }

  return initializeStormSystems(seed + 1_001);
}

export function createStormSystems(seed: number) {
  return initializeStormSystems(seed);
}

function chooseStormTargetCity(
  storm: StormSystem,
  runtime: StormRuntimeState,
  nowMs: number,
  recentHits: Record<string, number>,
  targetedCounts: Record<string, number>
) {
  const random = getStormSeedRandom(storm, Math.floor(nowMs / STORM_TARGET_MIN_MS) + 1);
  const weightedCities = cities.map((city) => {
    const lastHitAtMs = recentHits[city.id];
    const neglectMs =
      typeof lastHitAtMs === "number"
        ? Math.max(0, nowMs - lastHitAtMs)
        : STORM_RECENT_HIT_WINDOW_MS * 2;
    const distance = angularDistanceDegrees(
      { lat: runtime.lat, lon: runtime.lon },
      { lat: city.lat, lon: city.lon }
    );
    const recentSelfPenalty =
      runtime.lastHitCityId === city.id &&
        runtime.lastHitAtMs !== null &&
        nowMs - runtime.lastHitAtMs < STORM_RECENT_HIT_WINDOW_MS
        ? 0.2
        : 1;
    const contentionPenalty = 1 / (1 + (targetedCounts[city.id] ?? 0) * 2.2);
    const distanceWeight = 0.55 + Math.min(1.2, distance / 90);
    const neglectWeight = 1 + Math.min(3.2, neglectMs / STORM_RECENT_HIT_WINDOW_MS);
    const weight = neglectWeight * contentionPenalty * distanceWeight * recentSelfPenalty;

    return { cityId: city.id, weight };
  });

  const totalWeight = weightedCities.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  let cursor = random() * totalWeight;

  for (const city of weightedCities) {
    cursor -= city.weight;
    if (cursor <= 0) {
      return city.cityId;
    }
  }

  return weightedCities[weightedCities.length - 1]?.cityId ?? cities[0].id;
}

function ensureStormTargets(
  storms: StormSystem[],
  states: StormRuntimeState[],
  nowMs: number,
  recentHits: Record<string, number>
) {
  const targetedCounts = states.reduce<Record<string, number>>((counts, state) => {
    if (state.targetCityId && state.movementPhase === "nudged") {
      counts[state.targetCityId] = (counts[state.targetCityId] ?? 0) + 1;
    }
    return counts;
  }, {});

  states.forEach((state, index) => {
    if (state.targetCityId && nowMs >= state.targetExpiresAtMs) {
      if (state.targetCityId) {
        targetedCounts[state.targetCityId] = Math.max(
          0,
          (targetedCounts[state.targetCityId] ?? 1) - 1
        );
      }
      enterStormLoitering(state, nowMs);
      return;
    }

    if (state.movementPhase === "loitering" && nowMs < state.loiterUntilMs) {
      state.targetBiasStrength = 0;
      return;
    }

    if (state.targetCityId) {
      return;
    }

    const targetCityId = chooseStormTargetCity(
      storms[index],
      state,
      nowMs,
      recentHits,
      targetedCounts
    );
    const random = getStormSeedRandom(storms[index], 300 + Math.floor(nowMs / STORM_STEP_MS));

    state.targetCityId = targetCityId;
    state.targetAssignedAtMs = nowMs;
    state.targetExpiresAtMs =
      nowMs + Math.round(randomBetween(random, STORM_TARGET_MIN_MS, STORM_TARGET_MAX_MS));
    state.movementPhase = "nudged";
    state.loiterUntilMs = nowMs;
    state.targetBiasStartedAtMs = nowMs;
    state.targetBiasStrength = 0;
    targetedCounts[targetCityId] = (targetedCounts[targetCityId] ?? 0) + 1;
  });
}

function applyStormRepulsion(storms: StormSystem[], states: StormRuntimeState[]) {
  states.forEach((state, index) => {
    const storm = storms[index];
    let totalPushLat = 0;
    let totalPushLon = 0;

    states.forEach((otherState, compareIndex) => {
      if (index === compareIndex) {
        return;
      }

      const otherStorm = storms[compareIndex];
      const currentDistance = angularDistanceDegrees(
        { lat: state.lat, lon: state.lon },
        { lat: otherState.lat, lon: otherState.lon }
      );
      const predictedDistance = angularDistanceDegrees(
        getFuturePoint(state, STORM_PREDICTION_LOOKAHEAD_MS),
        getFuturePoint(otherState, STORM_PREDICTION_LOOKAHEAD_MS)
      );
      const minimumDistance = getStormMinimumDistance(storm, otherStorm);
      const activationDistance = minimumDistance + STORM_REPULSION_BUFFER_DEG;
      const effectiveDistance = Math.min(currentDistance, predictedDistance);

      if (effectiveDistance > activationDistance) {
        return;
      }

      const direction = normalizeDirection(
        state.lat - otherState.lat,
        normalizeLongitude(state.lon - otherState.lon)
      );
      const strength =
        STORM_REPULSION_FORCE *
        ((activationDistance - effectiveDistance) / Math.max(activationDistance, 1)) ** 2;

      totalPushLat += direction.lat * strength;
      totalPushLon += direction.lon * strength;

      if (currentDistance < minimumDistance) {
        const correction = (minimumDistance - currentDistance) / 2;
        state.lat += direction.lat * correction;
        state.lon = normalizeLongitude(state.lon + direction.lon * correction);
      }
    });

    const pushMagnitude = Math.hypot(totalPushLat, totalPushLon);
    state.congestionTicks = pushMagnitude > 0.24 ? state.congestionTicks + 1 : 0;
    state.velocityLat += totalPushLat;
    state.velocityLon += totalPushLon;
  });
}

function applyStormSteering(storms: StormSystem[], states: StormRuntimeState[], nowMs: number) {
  states.forEach((state, index) => {
    const storm = storms[index];
    const wanderLat =
      Math.sin((nowMs / 1000) * storm.latWaveSpeed + storm.phaseOffset) *
      (storm.latWaveAmplitude / 10) *
      STORM_WANDER_FORCE;
    const wanderLon =
      Math.cos((nowMs / 1000) * storm.lonWaveSpeed + storm.phaseOffset * 1.3) *
      (storm.lonWaveAmplitude / 10) *
      STORM_WANDER_FORCE;

    state.velocityLat += wanderLat;
    state.velocityLon += wanderLon;
    state.targetBiasStrength = 0;

    if (state.movementPhase === "nudged" && state.targetCityId) {
      const targetCity = cityIndex[state.targetCityId];
      if (targetCity) {
        const direction = normalizeDirection(
          targetCity.lat - state.lat,
          normalizeLongitude(targetCity.lon - state.lon)
        );
        const ramp =
          state.targetBiasStartedAtMs === null
            ? 0
            : clamp((nowMs - state.targetBiasStartedAtMs) / STORM_TARGET_RAMP_MS, 0, 1);
        const targetMultiplier = state.congestionTicks > 2 ? 0.35 : 1;
        const appliedBias = ramp * targetMultiplier;

        state.targetBiasStrength = appliedBias;
        state.velocityLat += direction.lat * STORM_TARGET_FORCE * appliedBias;
        state.velocityLon += direction.lon * STORM_TARGET_FORCE * appliedBias;
      }
    }

    if (state.congestionTicks > 4) {
      const openDirection = normalizeDirection(state.lat, normalizeLongitude(state.lon));
      state.velocityLat += openDirection.lat * STORM_OPEN_WATER_FORCE;
      state.velocityLon += openDirection.lon * STORM_OPEN_WATER_FORCE;
      if (state.movementPhase === "nudged") {
        state.targetExpiresAtMs = Math.min(state.targetExpiresAtMs, nowMs + STORM_STEP_MS);
      }
    }
  });
}

function advanceStormStates(states: StormRuntimeState[]) {
  states.forEach((state) => {
    state.velocityLat *= STORM_DAMPING;
    state.velocityLon *= STORM_DAMPING;

    const speed = Math.hypot(state.velocityLat, state.velocityLon);
    if (speed > STORM_MAX_SPEED_DEG_PER_SEC) {
      const scale = STORM_MAX_SPEED_DEG_PER_SEC / speed;
      state.velocityLat *= scale;
      state.velocityLon *= scale;
    }

    state.lat += state.velocityLat * (STORM_STEP_MS / 1000);
    state.lon = normalizeLongitude(state.lon + state.velocityLon * (STORM_STEP_MS / 1000));

    if (state.lat > 65 || state.lat < -65) {
      state.lat = clamp(state.lat, -65, 65);
      state.velocityLat *= -0.65;
    }
  });
}

function updateStormHits(
  storms: StormSystem[],
  states: StormRuntimeState[],
  nowMs: number,
  recentHits: Record<string, number>
) {
  states.forEach((state, index) => {
    if (!state.targetCityId) {
      return;
    }

    const targetCity = cityIndex[state.targetCityId];
    if (!targetCity) {
      return;
    }

    const distance = angularDistanceDegrees(
      { lat: state.lat, lon: state.lon },
      { lat: targetCity.lat, lon: targetCity.lon }
    );

    if (distance <= getStormNearHitRadius(storms[index])) {
      state.lastHitCityId = state.targetCityId;
      state.lastHitAtMs = nowMs;
      recentHits[state.targetCityId] = nowMs;
      enterStormLoitering(state, nowMs);
    }
  });
}

function advanceStormFieldFrame(storms: StormSystem[], frame: StormFieldFrame, nextTimeMs: number) {
  const nextFrame = cloneStormFieldFrame(frame);
  nextFrame.timeMs = nextTimeMs;

  ensureStormTargets(storms, nextFrame.states, nextTimeMs, nextFrame.recentHits);
  applyStormRepulsion(storms, nextFrame.states);
  applyStormSteering(storms, nextFrame.states, nextTimeMs);
  advanceStormStates(nextFrame.states);
  updateStormHits(storms, nextFrame.states, nextTimeMs, nextFrame.recentHits);

  return nextFrame;
}

function getOrCreateStormFieldCache(storms: StormSystem[]) {
  const key = createStormFieldKey(storms);
  const existing = stormFieldCache.get(key);

  if (existing) {
    return existing;
  }

  const cache = {
    key,
    frames: [createInitialStormFieldFrame(storms)]
  } satisfies StormFieldCache;
  stormFieldCache.set(key, cache);
  return cache;
}

function pruneStormFieldCache(cache: StormFieldCache, latestTimeMs: number) {
  const minimumTimeMs = Math.max(0, latestTimeMs - STORM_CACHE_RETAIN_MS);
  const firstRetainedIndex = cache.frames.findIndex((frame) => frame.timeMs >= minimumTimeMs);

  if (firstRetainedIndex <= 1) {
    return;
  }

  cache.frames = cache.frames.slice(firstRetainedIndex - 1);
}

function ensureStormFieldThrough(
  storms: StormSystem[],
  cache: StormFieldCache,
  targetTimeMs: number
) {
  const normalizedTargetMs = Math.max(0, Math.ceil(targetTimeMs / STORM_STEP_MS) * STORM_STEP_MS);
  let latestFrame = cache.frames[cache.frames.length - 1];

  if (normalizedTargetMs < cache.frames[0].timeMs) {
    cache.frames = [createInitialStormFieldFrame(storms)];
    latestFrame = cache.frames[0];
  }

  while (latestFrame.timeMs < normalizedTargetMs) {
    latestFrame = advanceStormFieldFrame(storms, latestFrame, latestFrame.timeMs + STORM_STEP_MS);
    cache.frames.push(latestFrame);
  }

  pruneStormFieldCache(cache, normalizedTargetMs);
}

function interpolateStormState(
  lower: StormRuntimeState,
  upper: StormRuntimeState,
  progress: number
) {
  return {
    ...upper,
    lat: lerp(lower.lat, upper.lat, progress),
    lon: lerpLongitude(lower.lon, upper.lon, progress),
    velocityLat: lerp(lower.velocityLat, upper.velocityLat, progress),
    velocityLon: lerp(lower.velocityLon, upper.velocityLon, progress),
    movementPhase: progress < 0.5 ? lower.movementPhase : upper.movementPhase,
    loiterUntilMs: lerp(lower.loiterUntilMs, upper.loiterUntilMs, progress),
    targetBiasStartedAtMs:
      progress < 0.5 ? lower.targetBiasStartedAtMs : upper.targetBiasStartedAtMs,
    targetBiasStrength: lerp(lower.targetBiasStrength, upper.targetBiasStrength, progress),
    congestionTicks:
      progress < 0.5 ? lower.congestionTicks : upper.congestionTicks
  } satisfies StormRuntimeState;
}

function getStormFieldFrameAt(storms: StormSystem[], elapsedMs: number) {
  const safeElapsedMs = Math.max(0, elapsedMs);
  const cache = getOrCreateStormFieldCache(storms);

  if (safeElapsedMs < cache.frames[0].timeMs) {
    cache.frames = [createInitialStormFieldFrame(storms)];
  }

  ensureStormFieldThrough(storms, cache, safeElapsedMs);

  const lowerTimeMs = Math.floor(safeElapsedMs / STORM_STEP_MS) * STORM_STEP_MS;
  const upperTimeMs = Math.ceil(safeElapsedMs / STORM_STEP_MS) * STORM_STEP_MS;
  const lowerFrame =
    cache.frames.find((frame) => frame.timeMs === lowerTimeMs) ?? cache.frames[0];
  const upperFrame =
    cache.frames.find((frame) => frame.timeMs === upperTimeMs) ?? cache.frames[cache.frames.length - 1];

  if (lowerTimeMs === upperTimeMs) {
    return cloneStormFieldFrame(lowerFrame);
  }

  const progress = (safeElapsedMs - lowerTimeMs) / Math.max(1, upperTimeMs - lowerTimeMs);

  return {
    timeMs: safeElapsedMs,
    states: lowerFrame.states.map((state, index) =>
      interpolateStormState(state, upperFrame.states[index], progress)
    ),
    recentHits: { ...(progress < 0.5 ? lowerFrame.recentHits : upperFrame.recentHits) }
  } satisfies StormFieldFrame;
}

function getStormFieldFramesForTimes(storms: StormSystem[], timesMs: number[]) {
  const highestRequestedMs = Math.max(0, ...timesMs);
  const cache = getOrCreateStormFieldCache(storms);

  if (timesMs.some((timeMs) => timeMs < cache.frames[0].timeMs)) {
    cache.frames = [createInitialStormFieldFrame(storms)];
  }

  ensureStormFieldThrough(storms, cache, highestRequestedMs);

  return timesMs.map((timeMs) => getStormFieldFrameAt(storms, timeMs));
}

export function simulateStormField(storms: StormSystem[], elapsedMs: number) {
  const frame = getStormFieldFrameAt(storms, elapsedMs);

  return {
    states: frame.states,
    recentHits: frame.recentHits
  };
}

export function getStormPosition(storm: StormSystem, elapsedMs: number) {
  return simulateStormField([storm], elapsedMs).states[0];
}

export function buildStormSnapshots(storms: StormSystem[], elapsedMs: number): StormSnapshot[] {
  const trailTimes = Array.from(
    { length: Math.floor(TRAIL_DURATION_MS / TRAIL_SAMPLE_STEP_MS) + 1 },
    (_, index) => TRAIL_DURATION_MS - index * TRAIL_SAMPLE_STEP_MS
  ).map((ageMs) => Math.max(0, elapsedMs - ageMs));
  const sampleTimes = [elapsedMs, ...trailTimes];
  const sampledFields = getStormFieldFramesForTimes(storms, sampleTimes);
  const currentField = sampledFields[0];
  const trailFields = trailTimes.map((timeMs, index) => ({
    ageMs: Math.max(0, elapsedMs - timeMs),
    field: sampledFields[index + 1]
  }));

  return storms.map((storm, index) => {
    const nowPosition = currentField.states[index];
    const intensity = round(0.82 + (Math.sin(elapsedMs / 5000 + storm.phaseOffset) + 1) * 0.14, 3);
    const trail = trailFields
      .map(({ ageMs, field }) => ({
        lat: field.states[index].lat,
        lon: field.states[index].lon,
        timestampMs: Math.max(0, elapsedMs - ageMs),
        ageMs
      }))
      .reverse();

    return {
      stormId: storm.id,
      lat: nowPosition.lat,
      lon: nowPosition.lon,
      radiusDeg: storm.radiusDeg,
      intensity,
      hue: storm.hue,
      trail,
      windIndicators: []
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
    return total + falloff ** 2 * snapshot.intensity;
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
      wind: clamp(signal.wind + STORM_CORE_DELTAS.wind * pressure, 0, 40),
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
  return Math.round(4_000 + normalized * 10_000);
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
