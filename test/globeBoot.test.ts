import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGlobeCanvasDpr,
  globeLoadStageMeta,
  scheduleGlobeDetailStages,
  shouldEnableAutoRotate
} from "../src/components/globeBoot";

function createIdleDeadline(): IdleDeadline {
  return {
    didTimeout: false,
    timeRemaining: () => 50
  };
}

describe("globeBoot", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires globe stages in order and marks the scene interactive last", () => {
    vi.useFakeTimers();

    const stages: Array<"base" | "signals" | "labels" | "interactive"> = [];
    const onInteractive = vi.fn();

    scheduleGlobeDetailStages({
      requestIdleCallback: (callback) =>
        window.setTimeout(() => callback(createIdleDeadline()), 0),
      cancelIdleCallback: (handle) => {
        window.clearTimeout(handle);
      },
      requestAnimationFrame: (callback) =>
        window.setTimeout(() => callback(performance.now()), 0),
      cancelAnimationFrame: (handle) => {
        window.clearTimeout(handle);
      },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      onStage: (stage) => {
        stages.push(stage);
      },
      onInteractive
    });

    expect(stages).toEqual(["base"]);

    vi.runAllTimers();

    expect(stages).toEqual(["base", "signals", "labels", "interactive"]);
    expect(onInteractive).toHaveBeenCalledTimes(1);
  });

  it("cancels pending staged work on cleanup", () => {
    vi.useFakeTimers();

    const stages: Array<"base" | "signals" | "labels" | "interactive"> = [];
    const onInteractive = vi.fn();

    const cleanup = scheduleGlobeDetailStages({
      requestIdleCallback: (callback) =>
        window.setTimeout(() => callback(createIdleDeadline()), 0),
      cancelIdleCallback: (handle) => {
        window.clearTimeout(handle);
      },
      requestAnimationFrame: (callback) =>
        window.setTimeout(() => callback(performance.now()), 0),
      cancelAnimationFrame: (handle) => {
        window.clearTimeout(handle);
      },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      onStage: (stage) => {
        stages.push(stage);
      },
      onInteractive
    });

    expect(stages).toEqual(["base"]);

    cleanup();
    vi.runAllTimers();

    expect(stages).toEqual(["base"]);
    expect(onInteractive).not.toHaveBeenCalled();
  });

  it("keeps high DPR and auto-rotate disabled until the interactive stage", () => {
    expect(getGlobeCanvasDpr("base")).toBe(0.8);
    expect(getGlobeCanvasDpr("interactive")).toEqual([1, 1.2]);
    expect(shouldEnableAutoRotate("base")).toBe(false);
    expect(shouldEnableAutoRotate("interactive")).toBe(true);
    expect(globeLoadStageMeta.labels.progress).toBe(90);
    expect(globeLoadStageMeta.interactive.progress).toBe(100);
  });
});
