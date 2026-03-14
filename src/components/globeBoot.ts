export const globeLoadStageOrder = ["shell", "chunk", "base", "signals", "labels", "interactive"] as const;

export type GlobeLoadStage = (typeof globeLoadStageOrder)[number];
export type GlobeRenderStage = Extract<GlobeLoadStage, "base" | "signals" | "labels" | "interactive">;

export const globeLoadStageMeta: Record<
  GlobeLoadStage,
  {
    progress: number;
    stepLabel: string;
    title: string;
    description: string;
  }
> = {
  shell: {
    progress: 10,
    stepLabel: "Shell",
    title: "Initializing dashboard shell",
    description: "Starting the interface and kicking off the market data requests."
  },
  chunk: {
    progress: 30,
    stepLabel: "Engine",
    title: "Loading globe engine",
    description: "Pulling in the 3D renderer and planetary geometry code."
  },
  base: {
    progress: 55,
    stepLabel: "Base",
    title: "Mapping country topology",
    description: "Building the globe body, atmosphere, and country boundaries."
  },
  signals: {
    progress: 75,
    stepLabel: "Signals",
    title: "Applying climate signals",
    description: "Hydrating routes, rings, and the wider city signal field."
  },
  labels: {
    progress: 90,
    stepLabel: "Labels",
    title: "Activating city labels",
    description: "Rendering the full city label layer before the dashboard unlocks."
  },
  interactive: {
    progress: 100,
    stepLabel: "Ready",
    title: "Finalizing interactive scene",
    description: "Settling the last frame so the dashboard opens in a responsive state."
  }
};

type IdleHandle = number;
type AnimationHandle = number;
type TimeoutHandle = number;

type GlobeStageSchedulerOptions = {
  requestIdleCallback?: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => IdleHandle) | undefined;
  cancelIdleCallback?: ((handle: IdleHandle) => void) | undefined;
  requestAnimationFrame: (callback: FrameRequestCallback) => AnimationHandle;
  cancelAnimationFrame: (handle: AnimationHandle) => void;
  setTimeout: (callback: () => void, delay: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
  onStage: (stage: GlobeRenderStage) => void;
  onInteractive: () => void;
};

export function getGlobeCanvasDpr(stage: GlobeRenderStage): number | [number, number] {
  return stage === "interactive" ? [1, 1.2] : 0.8;
}

export function shouldEnableAutoRotate(stage: GlobeRenderStage) {
  return stage === "interactive";
}

export function shouldRenderSignalLayers(stage: GlobeRenderStage) {
  return stage !== "base";
}

export function shouldRenderFullLabels(stage: GlobeRenderStage) {
  return stage === "labels" || stage === "interactive";
}

export function scheduleGlobeDetailStages({
  requestIdleCallback,
  cancelIdleCallback,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  onStage,
  onInteractive
}: GlobeStageSchedulerOptions) {
  let cancelled = false;
  let idleHandle: IdleHandle | undefined;
  let timeoutHandle: TimeoutHandle | undefined;
  const animationHandles: AnimationHandle[] = [];

  const clearScheduledWork = () => {
    if (idleHandle !== undefined) {
      cancelIdleCallback?.(idleHandle);
      idleHandle = undefined;
    }
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
    animationHandles.splice(0).forEach((handle) => cancelAnimationFrame(handle));
  };

  const scheduleDeferredStep = (callback: () => void, idleTimeout: number, fallbackDelay: number) => {
    if (cancelled) {
      return;
    }

    clearScheduledWork();

    if (requestIdleCallback) {
      idleHandle = requestIdleCallback(() => {
        idleHandle = undefined;
        if (!cancelled) {
          callback();
        }
      }, { timeout: idleTimeout });
      return;
    }

    timeoutHandle = setTimeout(() => {
      timeoutHandle = undefined;
      if (!cancelled) {
        callback();
      }
    }, fallbackDelay);
  };

  const scheduleAnimationFrames = (count: number, callback: () => void) => {
    if (cancelled) {
      return;
    }

    const queueFrame = (remaining: number) => {
      const handle = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        if (remaining <= 1) {
          callback();
          return;
        }

        queueFrame(remaining - 1);
      });

      animationHandles.push(handle);
    };

    queueFrame(count);
  };

  onStage("base");

  scheduleDeferredStep(() => {
    onStage("signals");

    scheduleDeferredStep(() => {
      onStage("labels");

      scheduleAnimationFrames(2, () => {
        onStage("interactive");
        onInteractive();
      });
    }, 900, 420);
  }, 700, 260);

  return () => {
    cancelled = true;
    clearScheduledWork();
  };
}
