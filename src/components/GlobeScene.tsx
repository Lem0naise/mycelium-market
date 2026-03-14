import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-50m.json";
import { assetProfiles, cities, cityIndex } from "../../shared/data";
import type { EnvironmentalSignal, RankedCity } from "../../shared/types";

type GlobeSceneProps = {
  selectedCityId: string;
  compareCityId: string | null;
  selectedAssetId: string;
  signals: EnvironmentalSignal[];
  rankings: RankedCity[];
  onReady?: () => void;
};

type GlobeDetailStage = "base" | "full";

type MapLabel = {
  id: string;
  text: string;
  lat: number;
  lng: number;
  color: string;
  altitude: number;
  isSelected?: boolean;
  isCompare?: boolean;
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
const globeTopology = countriesTopology as Record<string, unknown> & {
  objects: {
    countries: unknown;
  };
};

function buildCountryPolygons() {
  return (
    feature(globeTopology as never, globeTopology.objects.countries as never) as unknown as {
      features: Array<{ geometry: GlobePolygonDatum["geometry"] | null }>;
    }
  ).features
    .filter((entry): entry is { geometry: GlobePolygonDatum["geometry"] } => Boolean(entry.geometry))
    .map<GlobePolygonDatum>((entry) => ({
      geometry: entry.geometry
    }));
}

function toRgba(hex: string, alpha: number) {
  const color = new THREE.Color(hex);
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildPointData(
  signals: EnvironmentalSignal[],
  rankings: RankedCity[],
  selectedCityId: string,
  compareCityId: string | null
) {
  return signals.map<GlobePointDatum>((signal) => {
    const city = cityIndex[signal.cityId];
    const ranking = rankings.find((item) => item.cityId === signal.cityId);
    const intensity = (ranking?.travelScore ?? 40) / 100;
    const isSelected = signal.cityId === selectedCityId;
    const isCompare = signal.cityId === compareCityId;

    return {
      id: signal.cityId,
      lat: city.lat,
      lng: city.lon,
      color: isSelected ? "#f7ff96" : isCompare ? "#7fb9ff" : city.accentColor,
      altitude: isSelected ? 0.13 : isCompare ? 0.1 : 0.05 + intensity * 0.04,
      radius: isSelected ? 0.34 : isCompare ? 0.26 : 0.14 + intensity * 0.08
    };
  });
}

function buildRingData(signals: EnvironmentalSignal[]) {
  return signals
    .filter((signal) => signal.rain >= 7 || signal.wind >= 14)
    .map<GlobeRingDatum>((signal) => {
      const city = cityIndex[signal.cityId];
      const strength = Math.min(1.35, signal.rain / 18 + signal.wind / 40);

      return {
        id: `${signal.cityId}-storm`,
        lat: city.lat,
        lng: city.lon,
        color: [toRgba("#ffbb7d", 0.82), toRgba(city.accentColor, 0.02)],
        altitude: 0.018,
        maxRadius: 1.9 + strength * 2.8,
        propagationSpeed: 0.65 + strength * 0.45,
        repeatPeriod: 1100 + Math.round(850 / Math.max(strength, 0.25))
      };
    });
}

function buildArcData(selectedCityId: string, selectedAssetId: string) {
  const selectedCity = cityIndex[selectedCityId];
  const asset = assetProfiles.find((entry) => entry.id === selectedAssetId) ?? assetProfiles[0];
  const targets = cities.filter((city) => asset.homeRegions.includes(city.region) && city.id !== selectedCityId);

  return targets.map<GlobeArcDatum>((city, index) => ({
    id: `${selectedCityId}-${city.id}`,
    startLat: selectedCity.lat,
    startLng: selectedCity.lon,
    endLat: city.lat,
    endLng: city.lon,
    color: [toRgba(asset.accentColor, 0.9), toRgba(asset.accentColor, 0.12)],
    altitude: 0.17,
    dashLength: 0.32,
    dashGap: 0.72,
    dashInitialGap: index * 0.11,
    dashAnimateTime: 2200 + index * 180
  }));
}

function buildCityLabels(selectedCityId: string, compareCityId: string | null) {
  return cities.map<MapLabel>((city) => {
    const isSelected = city.id === selectedCityId;
    const isCompare = city.id === compareCityId;

    return {
      id: `city-${city.id}`,
      text: city.name,
      lat: city.lat,
      lng: city.lon,
      color: isSelected ? "#f7ff96" : isCompare ? "#9fc9ff" : "#d8e0e7",
      altitude: isSelected ? 0.142 : isCompare ? 0.118 : 0.088,
      isSelected,
      isCompare
    };
  });
}

function CityNameLabels({
  globe,
  selectedCityId,
  compareCityId,
  detailStage
}: Pick<GlobeSceneProps, "selectedCityId" | "compareCityId"> & {
  globe: ThreeGlobe;
  detailStage: GlobeDetailStage;
}) {
  const labels = useMemo(
    () => {
      const nextLabels = buildCityLabels(selectedCityId, compareCityId);
      return detailStage === "full"
        ? nextLabels
        : nextLabels.filter((label) => label.isSelected || label.isCompare);
    },
    [compareCityId, detailStage, selectedCityId]
  );
  const camera = useThree((state) => state.camera);
  const anchorRefs = useRef<Array<THREE.Group | null>>([]);
  const chipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const toCamera = useMemo(() => new THREE.Vector3(), []);
  const globeScale = useMemo(() => baseRadius / globe.getGlobeRadius(), [globe]);

  useFrame(() => {
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
                  label.isSelected ? "selected" : "",
                  label.isCompare ? "compare" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--city-label-color": label.color } as CSSProperties}
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

function GlobeReadySignal({ onReady }: { onReady?: () => void }) {
  const hasReportedReady = useRef(false);

  useEffect(() => {
    if (!onReady || hasReportedReady.current) {
      return;
    }

    let firstFrameId = 0;
    let secondFrameId = 0;

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        hasReportedReady.current = true;
        onReady();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [onReady]);

  return null;
}

function GlobeObject(props: GlobeSceneProps & { detailStage: GlobeDetailStage }) {
  const camera = useThree((state) => state.camera);
  const countryPolygons = useMemo(() => buildCountryPolygons(), []);

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
      .pointResolution(7)
      .pointsMerge(false)
      .pointsTransitionDuration(300)
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
      .arcsTransitionDuration(300);

    const globeMaterial = nextGlobe.globeMaterial() as THREE.MeshPhongMaterial;
    globeMaterial.color = new THREE.Color("#030406");
    globeMaterial.emissive = new THREE.Color("#080b10");
    globeMaterial.emissiveIntensity = 0.8;
    globeMaterial.specular = new THREE.Color("#0d1118");
    globeMaterial.shininess = 2;

    return nextGlobe;
  }, []);

  const pointData = useMemo(
    () => buildPointData(props.signals, props.rankings, props.selectedCityId, props.compareCityId),
    [props.signals, props.rankings, props.selectedCityId, props.compareCityId]
  );
  const ringData = useMemo(() => buildRingData(props.signals), [props.signals]);
  const arcData = useMemo(
    () => buildArcData(props.selectedCityId, props.selectedAssetId),
    [props.selectedCityId, props.selectedAssetId]
  );
  const basePointData = useMemo(
    () => pointData.filter((point) => point.id === props.selectedCityId || point.id === props.compareCityId),
    [pointData, props.selectedCityId, props.compareCityId]
  );
  const isFullDetail = props.detailStage === "full";

  useEffect(() => {
    globe.pointsData(isFullDetail ? pointData : basePointData);
  }, [basePointData, globe, isFullDetail, pointData]);

  useEffect(() => {
    globe.ringsData(isFullDetail ? ringData : []);
  }, [globe, isFullDetail, ringData]);

  useEffect(() => {
    globe.arcsData(isFullDetail ? arcData : []);
  }, [arcData, globe, isFullDetail]);

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
        selectedCityId={props.selectedCityId}
        compareCityId={props.compareCityId}
        detailStage={props.detailStage}
      />
    </>
  );
}

export function GlobeScene(props: GlobeSceneProps) {
  const [detailStage, setDetailStage] = useState<GlobeDetailStage>("base");

  useEffect(() => {
    let timeoutId = 0;
    let idleCallbackId: number | undefined;
    const requestIdle = window.requestIdleCallback?.bind(window);

    const enableFullDetail = () => {
      setDetailStage("full");
    };

    if (requestIdle) {
      idleCallbackId = requestIdle(enableFullDetail, { timeout: 1800 });
    } else {
      timeoutId = window.setTimeout(enableFullDetail, 900);
    }

    return () => {
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <div className="globe-shell">
      <Canvas
        dpr={[1, 1.2]}
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
        <GlobeReadySignal onReady={props.onReady} />
        <OrbitControls enablePan={false} minDistance={4.4} maxDistance={8.2} autoRotate autoRotateSpeed={0.18} />
      </Canvas>
      <div className="globe-label">
        <span>Terra Arbitrage</span>
        <strong>Planetary pricing surface</strong>
      </div>
    </div>
  );
}

export default GlobeScene;
