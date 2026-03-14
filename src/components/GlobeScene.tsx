import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { assetProfiles, cities, cityIndex } from "../../shared/data";
import type { EnvironmentalSignal, RankedCity } from "../../shared/types";

type GlobeSceneProps = {
  selectedCityId: string;
  compareCityId: string | null;
  selectedAssetId: string;
  signals: EnvironmentalSignal[];
  rankings: RankedCity[];
};

const baseRadius = 2.35;

function latLonToVector(lat: number, lon: number, radius = baseRadius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function GlobeBody() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.04;
    }
  });

  return (
    <group ref={meshRef}>
      <mesh>
        <sphereGeometry args={[baseRadius, 96, 96]} />
        <meshStandardMaterial
          color="#111317"
          metalness={0.16}
          roughness={0.82}
          emissive="#101820"
          emissiveIntensity={0.28}
        />
      </mesh>
      <mesh scale={1.025}>
        <sphereGeometry args={[baseRadius, 48, 48]} />
        <meshBasicMaterial color="#30414f" wireframe opacity={0.18} transparent />
      </mesh>
      <mesh scale={1.09}>
        <sphereGeometry args={[baseRadius, 48, 48]} />
        <meshBasicMaterial color="#2ef4a1" transparent opacity={0.06} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

function CityMarkers({
  signals,
  rankings,
  selectedCityId,
  compareCityId
}: Pick<GlobeSceneProps, "signals" | "rankings" | "selectedCityId" | "compareCityId">) {
  return (
    <group>
      {signals.map((signal) => {
        const city = cityIndex[signal.cityId];
        const ranking = rankings.find((item) => item.cityId === signal.cityId);
        const intensity = (ranking?.travelScore ?? 40) / 100;
        const position = latLonToVector(city.lat, city.lon, baseRadius + 0.03);
        const isSelected = signal.cityId === selectedCityId;
        const isCompare = signal.cityId === compareCityId;
        const scale = isSelected ? 0.15 : isCompare ? 0.12 : 0.07 + intensity * 0.06;
        const color = isSelected ? "#f0ff85" : isCompare ? "#7fb9ff" : city.accentColor;

        return (
          <group key={signal.cityId} position={position}>
            <mesh scale={scale}>
              <sphereGeometry args={[1, 16, 16]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh scale={scale * (1.8 + signal.rain / 14)}>
              <sphereGeometry args={[1, 16, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.08 + intensity * 0.1} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function SignalStorms({ signals }: Pick<GlobeSceneProps, "signals">) {
  return (
    <group>
      {signals
        .filter((signal) => signal.rain >= 7 || signal.wind >= 14)
        .map((signal) => {
          const city = cityIndex[signal.cityId];
          const position = latLonToVector(city.lat, city.lon, baseRadius + 0.14);
          const strength = Math.min(1.8, signal.rain / 10 + signal.wind / 30);

          return (
            <group key={`${signal.cityId}-storm`} position={position}>
              <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.18 * strength, 0.18 * strength, 0.18]}>
                <torusGeometry args={[1, 0.08, 16, 64]} />
                <meshBasicMaterial color="#ff9b5a" transparent opacity={0.55} />
              </mesh>
            </group>
          );
        })}
    </group>
  );
}

function AssetArcs({
  selectedCityId,
  selectedAssetId
}: Pick<GlobeSceneProps, "selectedCityId" | "selectedAssetId">) {
  const selectedCity = cityIndex[selectedCityId];
  const asset = assetProfiles.find((entry) => entry.id === selectedAssetId) ?? assetProfiles[0];
  const targets = cities.filter((city) => asset.homeRegions.includes(city.region));

  return (
    <group>
      {targets.map((city) => {
        if (city.id === selectedCityId) {
          return null;
        }

        const start = latLonToVector(selectedCity.lat, selectedCity.lon, baseRadius + 0.03);
        const end = latLonToVector(city.lat, city.lon, baseRadius + 0.03);
        const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(baseRadius + 0.8);
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const points = curve.getPoints(40);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        return (
          <line key={`${selectedCityId}-${city.id}`}>
            <primitive attach="geometry" object={geometry} />
            <lineBasicMaterial color={asset.accentColor} transparent opacity={0.42} />
          </line>
        );
      })}
    </group>
  );
}

export function GlobeScene(props: GlobeSceneProps) {
  return (
    <div className="globe-shell">
      <Canvas camera={{ position: [0, 0, 6.3], fov: 34 }}>
        <color attach="background" args={["#05070d"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 4, 4]} intensity={1.6} color="#ffedb0" />
        <directionalLight position={[-4, -2, -3]} intensity={0.6} color="#7be8d8" />
        <Stars radius={180} depth={50} count={6000} factor={4.4} saturation={0} fade speed={0.5} />
        <GlobeBody />
        <CityMarkers
          signals={props.signals}
          rankings={props.rankings}
          selectedCityId={props.selectedCityId}
          compareCityId={props.compareCityId}
        />
        <SignalStorms signals={props.signals} />
        <AssetArcs selectedCityId={props.selectedCityId} selectedAssetId={props.selectedAssetId} />
        <OrbitControls enablePan={false} minDistance={4.3} maxDistance={8.5} autoRotate autoRotateSpeed={0.2} />
      </Canvas>
      <div className="globe-label">
        <span>Terra Arbitrage</span>
        <strong>Planetary pricing surface</strong>
      </div>
    </div>
  );
}

export default GlobeScene;
