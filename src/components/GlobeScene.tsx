import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-110m.json";
import { assetProfiles, cities, cityIndex } from "../../shared/data";
import type {
  EnvironmentalSignal,
  FlightState,
  RankedCity,
  StormSnapshot
} from "../../shared/types";
import {
  getGlobeCanvasDpr,
  scheduleGlobeDetailStages,
  shouldEnableAutoRotate,
  shouldRenderFullLabels,
  shouldRenderSignalLayers,
  type GlobeRenderStage
} from "./globeBoot";

type GlobeSceneProps = {
  focusedCityId: string;
  currentCityId: string;
  selectedAssetId: string;
  signals: EnvironmentalSignal[];
  rankings: RankedCity[];
  storms: StormSnapshot[];
  blockedCityIds: string[];
  flight: FlightState | null;
  onStageChange?: (stage: GlobeRenderStage) => void;
  onInteractive?: () => void;
  onSelectCity?: (cityId: string) => void;
};

type MapLabel = {
  id: string;
  cityId: string;
  text: string;
  lat: number;
  lng: number;
  color: string;
  altitude: number;
  isFocused: boolean;
  isCurrent: boolean;
  isBlocked: boolean;
};

type GlobePointDatum = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  altitude: number;
  radius: number;
};

type GlobeRingDatum = {
  id: string;
  lat: number;
  lng: number;
  color: [string, string];
  altitude: number;
  maxRadius: number;
  propagationSpeed: number;
  repeatPeriod: number;
};

type GlobeArcDatum = {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: [string, string];
  altitude: number;
  dashLength: number;
  dashGap: number;
  dashInitialGap: number;
  dashAnimateTime: number;
};

type GlobePolygonDatum = {
  geometry: {
    type: string;
    coordinates: unknown[];
  };
};

const baseRadius = 2.35;
const GLOBE_ROTATION_Y = -0.55;
const STORM_FOOTPRINT_SEGMENTS = 40;
const globeTopology = countriesTopology as Record<string, unknown> & {
  objects: {
    countries: unknown;
  };
};
let cachedCountryPolygons: GlobePolygonDatum[] | null = null;

function getCountryPolygons() {
  if (cachedCountryPolygons) {
    return cachedCountryPolygons;
  }

  cachedCountryPolygons = (
    feature(globeTopology as never, globeTopology.objects.countries as never) as unknown as {
      features: Array<{ geometry: GlobePolygonDatum["geometry"] | null }>;
    }
  ).features
    .filter((entry): entry is { geometry: GlobePolygonDatum["geometry"] } => Boolean(entry.geometry))
    .map<GlobePolygonDatum>((entry) => ({
      geometry: entry.geometry
    }));

  return cachedCountryPolygons;
}

function toRgba(hex: string, alpha: number) {
  const color = new THREE.Color(hex);
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function destinationPoint(
  origin: { lat: number; lon: number },
  bearingDeg: number,
  distanceDeg: number
) {
  const bearing = toRadians(bearingDeg);
  const angularDistance = toRadians(distanceDeg);
  const lat1 = toRadians(origin.lat);
  const lon1 = toRadians(origin.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((((lon2 * 180) / Math.PI + 180) % 360) + 360) % 360 - 180
  };
}

function buildCityPointData(
  signals: EnvironmentalSignal[],
  rankings: RankedCity[],
  focusedCityId: string,
  currentCityId: string,
  blockedCityIds: string[]
) {
  const blockedCitySet = new Set(blockedCityIds);

  return signals.map<GlobePointDatum>((signal) => {
    const city = cityIndex[signal.cityId];
    const ranking = rankings.find((item) => item.cityId === signal.cityId);
    const intensity = (ranking?.travelScore ?? 40) / 100;
    const isFocused = signal.cityId === focusedCityId;
    const isCurrent = signal.cityId === currentCityId;
    const isBlocked = blockedCitySet.has(signal.cityId);
    const color = isBlocked
      ? "#b4fbff"
      : isFocused && isCurrent
        ? "#c9ff9f"
        : isFocused
          ? "#f7ff96"
          : isCurrent
            ? "#7ff2d0"
            : city.accentColor;

    return {
      id: signal.cityId,
      lat: city.lat,
      lng: city.lon,
      color,
      altitude: isBlocked ? 0.16 : isFocused || isCurrent ? 0.14 : 0.05 + intensity * 0.04,
      radius: isBlocked ? 0.34 : isFocused || isCurrent ? 0.3 : 0.14 + intensity * 0.08
    };
  });
}

function buildStormPointData(storms: StormSnapshot[]) {
  return storms.map<GlobePointDatum>((storm) => ({
    id: `${storm.stormId}-core`,
    lat: storm.lat,
    lng: storm.lon,
    color: toRgba(storm.hue, 0.92),
    altitude: 0.11,
    radius: 0.28 + storm.intensity * 0.12
  }));
}

function buildRingData(
  _signals: EnvironmentalSignal[],
  _storms: StormSnapshot[],
  _blockedCityIds: string[]
) {
  return [];
}

function buildArcData(
  focusedCityId: string,
  selectedAssetId: string,
  storms: StormSnapshot[],
  flight: FlightState | null
) {
  const focusedCity = cityIndex[focusedCityId];
  const asset = assetProfiles.find((entry) => entry.id === selectedAssetId) ?? assetProfiles[0];
  const targetArcs = cities
    .filter((city) => asset.homeRegions.includes(city.region) && city.id !== focusedCityId)
    .map<GlobeArcDatum>((city, index) => ({
      id: `${focusedCityId}-${city.id}`,
      startLat: focusedCity.lat,
      startLng: focusedCity.lon,
      endLat: city.lat,
      endLng: city.lon,
      color: [toRgba(asset.accentColor, 0.72), toRgba(asset.accentColor, 0.08)],
      altitude: 0.14,
      dashLength: 0.28,
      dashGap: 0.9,
      dashInitialGap: index * 0.1,
      dashAnimateTime: 2400 + index * 180
    }));

  const windArcs = storms.flatMap((storm) =>
    storm.windIndicators.map<GlobeArcDatum>((indicator, index) => ({
      id: indicator.id,
      startLat: indicator.fromLat,
      startLng: indicator.fromLon,
      endLat: indicator.toLat,
      endLng: indicator.toLon,
      color: [toRgba("#b4fbff", 0.62), toRgba(storm.hue, 0.05)],
      altitude: 0.08 + index * 0.01,
      dashLength: 0.2,
      dashGap: 0.42,
      dashInitialGap: index * 0.12,
      dashAnimateTime: 1200 + index * 180
    }))
  );

  const flightArc = flight
    ? [
        {
          id: `${flight.id}-route`,
          startLat: flight.startLat,
          startLng: flight.startLon,
          endLat: flight.endLat,
          endLng: flight.endLon,
          color: [toRgba("#fff4a8", 0.92), toRgba("#fff4a8", 0.16)],
          altitude: 0.22,
          dashLength: 0.42,
          dashGap: 0.28,
          dashInitialGap: 0,
          dashAnimateTime: 950
        } satisfies GlobeArcDatum
      ]
    : [];

  return [...targetArcs, ...windArcs, ...flightArc];
}

function buildCityLabels(focusedCityId: string, currentCityId: string, blockedCityIds: string[]) {
  const blockedCitySet = new Set(blockedCityIds);

  return cities.map<MapLabel>((city) => {
    const isFocused = city.id === focusedCityId;
    const isCurrent = city.id === currentCityId;
    const isBlocked = blockedCitySet.has(city.id);

    return {
      id: `city-${city.id}`,
      cityId: city.id,
      text: city.name,
      lat: city.lat,
      lng: city.lon,
      color: isBlocked
        ? "#b4fbff"
        : isFocused && isCurrent
          ? "#c9ff9f"
          : isFocused
            ? "#f7ff96"
            : isCurrent
              ? "#7ff2d0"
              : "#d8e0e7",
      altitude: isBlocked ? 0.17 : isFocused || isCurrent ? 0.145 : 0.09,
      isFocused,
      isCurrent,
      isBlocked
    };
  });
}

function CityNameLabels({
  globe,
  focusedCityId,
  currentCityId,
  blockedCityIds,
  detailStage,
  onSelectCity
}: Pick<GlobeSceneProps, "focusedCityId" | "currentCityId" | "blockedCityIds" | "onSelectCity"> & {
  globe: ThreeGlobe;
  detailStage: GlobeRenderStage;
}) {
  const labels = useMemo(() => {
    const nextLabels = buildCityLabels(focusedCityId, currentCityId, blockedCityIds);
    return shouldRenderFullLabels(detailStage)
      ? nextLabels
      : nextLabels.filter((label) => label.isFocused || label.isCurrent || label.isBlocked);
  }, [blockedCityIds, currentCityId, detailStage, focusedCityId]);
  const camera = useThree((state) => state.camera);
  const anchorRefs = useRef<Array<THREE.Group | null>>([]);
  const chipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const toCamera = useMemo(() => new THREE.Vector3(), []);
  const globeScale = useMemo(() => baseRadius / globe.getGlobeRadius(), [globe]);
  const lastVisibilityUpdateRef = useRef(0);

  useFrame((state) => {
    if (state.clock.elapsedTime - lastVisibilityUpdateRef.current < 1 / 20) {
      return;
    }

    lastVisibilityUpdateRef.current = state.clock.elapsedTime;

    anchorRefs.current.forEach((anchor, index) => {
      const chip = chipRefs.current[index];
      if (!anchor || !chip) {
        return;
      }

      anchor.getWorldPosition(worldPosition);
      normal.copy(worldPosition).normalize();
      toCamera.copy(camera.position).sub(worldPosition).normalize();

      const isVisible = normal.dot(toCamera) > -0.06;
      chip.style.opacity = isVisible ? "1" : "0";
      chip.style.visibility = isVisible ? "visible" : "hidden";
    });
  });

  return (
    <group>
      {labels.map((label, index) => {
        const coords = globe.getCoords(label.lat, label.lng, label.altitude);
        const position = new THREE.Vector3(
          coords.x * globeScale,
          coords.y * globeScale,
          coords.z * globeScale
        );

        return (
          <group
            key={label.id}
            ref={(node) => {
              anchorRefs.current[index] = node;
            }}
            position={position}
          >
            <Html center distanceFactor={10.2} sprite>
              <div
                ref={(node) => {
                  chipRefs.current[index] = node;
                }}
                className={[
                  "city-marker-label",
                  label.isFocused ? "selected" : "",
                  label.isCurrent ? "current" : "",
                  label.isBlocked ? "blocked" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--city-label-color": label.color } as CSSProperties}
                onClick={() => onSelectCity?.(label.cityId)}
              >
                {label.text}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function StormFootprints({
  globe,
  storms
}: {
  globe: ThreeGlobe;
  storms: StormSnapshot[];
}) {
  const globeScale = useMemo(() => baseRadius / globe.getGlobeRadius(), [globe]);

  const geometries = useMemo(() => {
    return storms.map((storm) => {
      const centerCoords = globe.getCoords(storm.lat, storm.lon, 0.012);
      const center = new THREE.Vector3(
        centerCoords.x * globeScale,
        centerCoords.y * globeScale,
        centerCoords.z * globeScale
      );

      const outerPoints = Array.from({ length: STORM_FOOTPRINT_SEGMENTS }, (_, index) => {
        const perimeterPoint = destinationPoint(
          { lat: storm.lat, lon: storm.lon },
          (index / STORM_FOOTPRINT_SEGMENTS) * 360,
          storm.radiusDeg
        );
        const coords = globe.getCoords(perimeterPoint.lat, perimeterPoint.lon, 0.012);
        return new THREE.Vector3(coords.x * globeScale, coords.y * globeScale, coords.z * globeScale);
      });

      const innerPoints = Array.from({ length: STORM_FOOTPRINT_SEGMENTS }, (_, index) => {
        const perimeterPoint = destinationPoint(
          { lat: storm.lat, lon: storm.lon },
          (index / STORM_FOOTPRINT_SEGMENTS) * 360,
          storm.radiusDeg * 0.58
        );
        const coords = globe.getCoords(perimeterPoint.lat, perimeterPoint.lon, 0.0135);
        return new THREE.Vector3(coords.x * globeScale, coords.y * globeScale, coords.z * globeScale);
      });

      const buildFanGeometry = (points: THREE.Vector3[]) => {
        const positions: number[] = [];
        points.forEach((point, index) => {
          const nextPoint = points[(index + 1) % points.length];
          positions.push(
            center.x,
            center.y,
            center.z,
            point.x,
            point.y,
            point.z,
            nextPoint.x,
            nextPoint.y,
            nextPoint.z
          );
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        return geometry;
      };

      const buildLoopGeometry = (points: THREE.Vector3[]) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(points.flatMap((point) => [point.x, point.y, point.z]), 3)
        );
        return geometry;
      };

      return {
        id: storm.stormId,
        hue: storm.hue,
        outerFill: buildFanGeometry(outerPoints),
        innerFill: buildFanGeometry(innerPoints),
        outline: buildLoopGeometry(outerPoints)
      };
    });
  }, [globe, globeScale, storms]);

  useEffect(() => {
    return () => {
      geometries.forEach((geometrySet) => {
        geometrySet.outerFill.dispose();
        geometrySet.innerFill.dispose();
        geometrySet.outline.dispose();
      });
    };
  }, [geometries]);

  return (
    <group>
      {geometries.map((geometrySet) => (
        <group key={geometrySet.id}>
          <mesh geometry={geometrySet.outerFill} renderOrder={3}>
            <meshBasicMaterial
              color="#ff9e54"
              transparent
              opacity={0.22}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={geometrySet.innerFill} renderOrder={4}>
            <meshBasicMaterial
              color="#ffcc7a"
              transparent
              opacity={0.18}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <lineLoop geometry={geometrySet.outline} renderOrder={5}>
            <lineBasicMaterial color="#ffd89b" transparent opacity={0.9} depthWrite={false} />
          </lineLoop>
        </group>
      ))}
    </group>
  );
}

function FlightMarker({
  globe,
  flight
}: {
  globe: ThreeGlobe;
  flight: FlightState | null;
}) {
  const globeScale = useMemo(() => baseRadius / globe.getGlobeRadius(), [globe]);

  if (!flight) {
    return null;
  }

  const coords = globe.getCoords(flight.currentLat, flight.currentLon, 0.21);
  const position = new THREE.Vector3(
    coords.x * globeScale,
    coords.y * globeScale,
    coords.z * globeScale
  );

  return (
    <group position={position}>
      <Html center distanceFactor={11} sprite>
        <div className={flight.phase === "holding" ? "plane-marker holding" : "plane-marker"}>
          {flight.phase === "holding" ? "HOLD" : flight.isReturningHome ? "RTN" : "FLY"}
        </div>
      </Html>
    </group>
  );
}

function GlobeObject(props: GlobeSceneProps & { detailStage: GlobeRenderStage }) {
  const camera = useThree((state) => state.camera);
  const countryPolygons = useMemo(() => getCountryPolygons(), []);
  const visualSignals = useDeferredValue(props.signals);
  const visualRankings = useDeferredValue(props.rankings);
  const visualStorms = useDeferredValue(props.storms);
  const visualFlight = useDeferredValue(props.flight);

  const globe = useMemo(() => {
    const nextGlobe = new ThreeGlobe({
      waitForGlobeReady: false,
      animateIn: false
    });

    nextGlobe.scale.setScalar(baseRadius / nextGlobe.getGlobeRadius());
    nextGlobe
      .globeCurvatureResolution(4)
      .showAtmosphere(true)
      .atmosphereColor("#9ad9d1")
      .atmosphereAltitude(0.038)
      .polygonsData(countryPolygons)
      .polygonGeoJsonGeometry("geometry")
      .polygonCapColor(() => "#73797f")
      .polygonSideColor(() => "#565d63")
      .polygonStrokeColor(() => "#d8dde2")
      .polygonAltitude(() => 0.006)
      .polygonCapCurvatureResolution(() => 2.5)
      .polygonsTransitionDuration(0)
      .pointLat("lat")
      .pointLng("lng")
      .pointColor("color")
      .pointAltitude("altitude")
      .pointRadius("radius")
      .pointResolution(6)
      .pointsMerge(false)
      .pointsTransitionDuration(0)
      .ringLat("lat")
      .ringLng("lng")
      .ringColor("color")
      .ringAltitude("altitude")
      .ringMaxRadius("maxRadius")
      .ringPropagationSpeed("propagationSpeed")
      .ringRepeatPeriod("repeatPeriod")
      .arcStartLat("startLat")
      .arcStartLng("startLng")
      .arcEndLat("endLat")
      .arcEndLng("endLng")
      .arcColor("color")
      .arcAltitude("altitude")
      .arcDashLength("dashLength")
      .arcDashGap("dashGap")
      .arcDashInitialGap("dashInitialGap")
      .arcDashAnimateTime("dashAnimateTime")
      .arcsTransitionDuration(0);

    const globeMaterial = nextGlobe.globeMaterial() as THREE.MeshPhongMaterial;
    globeMaterial.color = new THREE.Color("#030406");
    globeMaterial.emissive = new THREE.Color("#080b10");
    globeMaterial.emissiveIntensity = 0.8;
    globeMaterial.specular = new THREE.Color("#0d1118");
    globeMaterial.shininess = 2;

    return nextGlobe;
  }, [countryPolygons]);

  const cityPointData = useMemo(
    () =>
      buildCityPointData(
        visualSignals,
        visualRankings,
        props.focusedCityId,
        props.currentCityId,
        props.blockedCityIds
      ),
    [
      props.blockedCityIds,
      props.currentCityId,
      props.focusedCityId,
      visualRankings,
      visualSignals
    ]
  );
  const stormPointData = useMemo(() => buildStormPointData(visualStorms), [visualStorms]);
  const pointData = useMemo(
    () => [...cityPointData, ...stormPointData],
    [cityPointData, stormPointData]
  );
  const essentialPointData = useMemo(
    () =>
      cityPointData.filter(
        (point) => point.id === props.focusedCityId || point.id === props.currentCityId
      ),
    [cityPointData, props.currentCityId, props.focusedCityId]
  );
  const ringData = useMemo(
    () => buildRingData(visualSignals, visualStorms, props.blockedCityIds),
    [props.blockedCityIds, visualSignals, visualStorms]
  );
  const arcData = useMemo(
    () => buildArcData(props.focusedCityId, props.selectedAssetId, visualStorms, visualFlight),
    [props.focusedCityId, props.selectedAssetId, visualFlight, visualStorms]
  );
  const showSignalLayers = shouldRenderSignalLayers(props.detailStage);

  useEffect(() => {
    globe.pointsData(showSignalLayers ? pointData : essentialPointData);
  }, [essentialPointData, globe, pointData, showSignalLayers]);

  useEffect(() => {
    globe.ringsData(showSignalLayers ? ringData : []);
  }, [globe, ringData, showSignalLayers]);

  useEffect(() => {
    globe.arcsData(showSignalLayers ? arcData : []);
  }, [arcData, globe, showSignalLayers]);

  useFrame(() => {
    globe.setPointOfView(camera);
  });

  useEffect(() => {
    return () => {
      globe._destructor();
    };
  }, [globe]);

  return (
    <>
      <primitive object={globe} />
      <CityNameLabels
        globe={globe}
        focusedCityId={props.focusedCityId}
        currentCityId={props.currentCityId}
        blockedCityIds={props.blockedCityIds}
        detailStage={props.detailStage}
        onSelectCity={props.onSelectCity}
      />
      {showSignalLayers ? <StormFootprints globe={globe} storms={visualStorms} /> : null}
      <FlightMarker globe={globe} flight={visualFlight} />
    </>
  );
}

export function GlobeScene(props: GlobeSceneProps) {
  const [detailStage, setDetailStage] = useState<GlobeRenderStage>("base");
  const emitStageChange = useEffectEvent((stage: GlobeRenderStage) => {
    props.onStageChange?.(stage);
  });
  const emitInteractive = useEffectEvent(() => {
    props.onInteractive?.();
  });

  useEffect(() => {
    return scheduleGlobeDetailStages({
      requestIdleCallback: window.requestIdleCallback?.bind(window),
      cancelIdleCallback: window.cancelIdleCallback?.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      onStage: (stage) => {
        setDetailStage(stage);
        emitStageChange(stage);
      },
      onInteractive: emitInteractive
    });
  }, []);

  return (
    <div className="globe-shell">
      <Canvas
        dpr={getGlobeCanvasDpr(detailStage)}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        camera={{ position: [0, 0, 6.3], fov: 34 }}
      >
        <color attach="background" args={["#05070d"]} />
        <ambientLight intensity={0.94} color="#eef3f7" />
        <hemisphereLight args={["#f1f5f8", "#0a0d12", 0.4]} />
        <directionalLight position={[2.8, 1.1, 4.2]} intensity={0.14} color="#ffffff" />
        <group rotation={[0, GLOBE_ROTATION_Y, 0]}>
          <GlobeObject {...props} detailStage={detailStage} />
        </group>
        <OrbitControls
          enablePan={false}
          minDistance={4.4}
          maxDistance={8.2}
          autoRotate={shouldEnableAutoRotate(detailStage)}
          autoRotateSpeed={0.18}
        />
      </Canvas>
      <div className="globe-label">
        <span>Terra Arbitrage</span>
        <strong>Planetary pricing surface</strong>
      </div>
    </div>
  );
}

export default GlobeScene;
