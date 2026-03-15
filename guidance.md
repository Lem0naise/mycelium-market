# Developer Guidance & Architecture

This file provides a roadmap for AI agents and developers working on this project (`terra-arbitrage`). It outlines the file structure, technology stack, logic locations, and crucially, identifies potential performance bottlenecks or sources of lag.

## Project Overview
This is a fullstack TypeScript application utilizing React + `@react-three/fiber` on the frontend and Node/Express on the backend. The application appears to be a global trading/arbitrage simulation that features 3D rendering (Globe), an Oracle system (potentially AI/ElevenLabs voice synthesis), and a live ticking simulation state.

### Tech Stack
- **Frontend**: React 19, `@react-three/fiber` & `@react-three/drei` (3D rendering), `framer-motion` (animations), `d3-geo` (globe projections/calculations), Vite.
- **Backend**: Node.js, Express, `tsx`.
- **State Management**: Zustand-style or custom stores in `src/store`.
- **Shared**: Common TypeScript types and simulation logic shared between the client and server.

---

## File Structure & Where Logic Lives

### 1. Frontend (`src/`)
*   **`src/App.tsx` & `src/main.tsx`**: Main entry points. `App.tsx` handles the overarching application state and `requestAnimationFrame` loops for the core ticker.
*   **`src/components/GlobeScene.tsx`**: Contains the complex React Three Fiber (R3F) logic. **Modify with care:** Updates here can heavily impact WebGL render performance.
*   **`src/components/globeBoot.ts`**: Handles booting/initialization logic for the 3D globe visualization.
*   **`src/components/MarketPanel.tsx` / `OraclePanel.tsx` / `FeedPanel.tsx`**: UI components managing their respective overlays.
*   **`src/components/MyceliumWidget.tsx`**: Specific UI widget, possibly tied to the "Fungal Overlay" and Oracle.
*   **`src/store/appStore.ts` & `tradingStore.ts`**: Global client-side state for the application and user trading inventory/balances.
*   **`src/api.ts`**: Client wrappers for fetching data from the backend.
*   **`src/index.css`**: Global styles, including heavy visual effects (e.g., scanlines and overlays).

### 2. Backend (`server/`)
*   **`server/index.ts` & `server/app.ts`**: The main Express server configuration. Contains API endpoints, rate limiting, and integrations with external APIs (like ElevenLabs for the Oracle).

### 3. Shared Logic (`shared/`)
*   **`shared/simulation.ts`**: **CRITICAL LOGIC.** Contains the core game/simulation loop. This is the source of truth for time and state mechanics. 
*   **`shared/oracle.ts` & `shared/omniscientOracle.ts`**: Logic governing the "Oracle" behavior, event generation, and game-world storytelling.
*   **`shared/data.ts` & `shared/types.ts`**: Shared constants, city data, and TypeScript interfaces ensuring client/server contract consistency.

---

## ⚠️ Performance & Lag Hazards (Read Carefully)

When implementing new features, be acutely aware of the following systems, as they are the primary sources of lag or infinite loops:

1.  **The Simulation Catch-Up Loop (`shared/simulation.ts`)**
    *   *Hazard*: Contains a `while` loop that forces the simulation to catch up to the `normalizedTargetMs`. 
    *   *Guidance*: If you add heavy computation inside the simulation tick, this `while` loop will freeze the thread (especially on the client-side) when trying to catch up over long durations. Keep per-tick logic extremely fast and lightweight.

2.  **RequestAnimationFrame Loops (`src/App.tsx` & `src/components/GlobeScene.tsx`)**
    *   *Hazard*: The frontend relies on `requestAnimationFrame` for syncing the 3D globe, animations, and potentially polling the simulation state.
    *   *Guidance*: Never trigger React state updates synchronously inside these loops unless absolutely necessary (or properly debounced), as it will cause cascading re-renders and tank the FPS. Use refs (`useRef`) to store transient animation data instead of React state where possible.

3.  **React Three Fiber Reactivity (`src/components/GlobeScene.tsx`)**
    *   *Hazard*: R3F components react to state changes like normal React components. However, unmounting/remounting 3D objects or rapidly updating their React props creates massive WebGL overhead.
    *   *Guidance*: Use the `useFrame` hook to mutate `ref.current` properties (position, rotation, uniforms) directly instead of passing rapidly changing values via React state props to 3D meshes.

4.  **Audio & Oracle Generation Cooldowns (`server/app.ts`)**
    *   *Hazard*: Server-side processes interacting with external APIs (e.g., ElevenLabs) have artificial blocks (e.g., `globalAudioCooldown`). 
    *   *Guidance*: Do not circumvent these locks, or you risk rate-limiting the backend or causing overlapping audio playbacks/state races.

## Agent Workflow Instructions
1.  **State first:** If adding a feature, trace where the state belongs. Does it need to be simulated in `shared/`? Is it purely UI (`src/store/`)?
2.  **Check imports:** Rely on existing shared types (`shared/types.ts`) before creating new interfaces.
3.  **UI overhauls:** Apply styling via CSS modules or `index.css` respecting the existing cyberpunk/mycelial aesthetic. 
