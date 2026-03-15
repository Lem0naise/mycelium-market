import { assetIndex, cityIndex } from "./data";
import { computeOracle } from "./oracle";
import type {
  EnvironmentalSignal,
  FlightState,
  MarketTicker,
  OracleNotification,
  OracleNotificationCategory,
  Severity,
  SignalKey
} from "./types";

type OraclePositionWatch = {
  earthDelta: number;
  severity: Severity;
  triggerActive: boolean;
  triggerDirection: "upside" | "downside" | "neutral";
  sharePct: number;
  signalValue: number;
};

type TriggerRuleState = {
  active: boolean;
  direction: OraclePositionWatch["triggerDirection"];
};

export type OracleWatchState = {
  initialized: boolean;
  activeEventKeys: string[];
  stormByCity: Record<string, boolean>;
  myceliumOpenByCity: Record<string, boolean>;
  destinationBlockedByCity: Record<string, boolean>;
  positions: Record<string, OraclePositionWatch>;
};

export type OracleEvaluationInput = {
  signals: EnvironmentalSignal[];
  holdings: Record<string, Record<string, number>>;
  prices: Record<string, Record<string, number>>;
  tickers: MarketTicker[];
  cash: number;
  blockedCityIds: Iterable<string>;
  currentCityId: string;
  focusedCityId: string;
  flight: FlightState | null;
  previousState: OracleWatchState;
  now?: Date | string | number;
};

export type OracleEvaluationResult = {
  notifications: OracleNotification[];
  speakable: OracleNotification | null;
  nextState: OracleWatchState;
};

const STORM_FEED_SHARE_PCT = 10;
const STORM_CRITICAL_SHARE_PCT = 20;
const DRIVER_FEED_SHARE_PCT = 4;
const DELTA_SWING_THRESHOLD = 8;

const severityOrder: Severity[] = ["calm", "watch", "alert", "critical"];

const signalMeta: Record<SignalKey, { label: string; unit: string }> = {
  humidity: { label: "humidity", unit: "%" },
  rain: { label: "rainfall", unit: "mm" },
  temperature: { label: "temperature", unit: "°C" },
  wind: { label: "wind", unit: "kn" },
  airQuality: { label: "air quality", unit: "AQI" },
  soilMoisture: { label: "soil moisture", unit: "%" },
  soilPh: { label: "soil pH", unit: "" }
};

function severityRank(severity: Severity) {
  return severityOrder.indexOf(severity);
}

function createTimestamp(now?: Date | string | number) {
  if (now instanceof Date) {
    return now.toISOString();
  }

  if (typeof now === "string") {
    return new Date(now).toISOString();
  }

  if (typeof now === "number") {
    return new Date(now).toISOString();
  }

  return new Date().toISOString();
}

function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${round(value, 1)}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function formatShare(value: number) {
  return `${round(value, 1)}%`;
}

function formatSignalValue(signal: SignalKey, value: number) {
  const meta = signalMeta[signal];
  return `${round(value, 1)}${meta.unit}`;
}

function getPrimaryDriverKey(signalWeights: Record<SignalKey, number>) {
  return (Object.entries(signalWeights) as Array<[SignalKey, number]>).find(
    ([, weight]) => weight !== 0
  )?.[0];
}

function getTriggeredRuleState(assetId: string, signal: EnvironmentalSignal): TriggerRuleState {
  const asset = assetIndex[assetId];
  let activeCount = 0;
  let totalEffect = 0;

  asset.triggerRules.forEach((rule) => {
    const liveValue = signal[rule.signal];
    const passes = rule.kind === "drop" ? liveValue <= rule.threshold : liveValue >= rule.threshold;
    if (!passes) {
      return;
    }

    activeCount += 1;
    if (rule.kind === "inversion") {
      totalEffect -= Math.abs(rule.effect);
      return;
    }

    totalEffect += rule.effect;
  });

  return {
    active: activeCount > 0,
    direction:
      totalEffect > 0 ? "upside" : totalEffect < 0 ? "downside" : "neutral"
  };
}

function isMyceliumOpen(signal: EnvironmentalSignal) {
  return (
    signal.soilMoisture >= 20 &&
    signal.soilMoisture <= 85 &&
    signal.soilPh >= 5 &&
    signal.soilPh <= 8 &&
    signal.humidity >= 25 &&
    signal.humidity <= 80);
}

function buildPortfolioState(
  holdings: Record<string, Record<string, number>>,
  prices: Record<string, Record<string, number>>,
  cash: number
) {
  let holdingsValue = 0;
  const cityValue: Record<string, number> = {};
  const cityHoldingsCount: Record<string, number> = {};
  const positionValue: Record<string, number> = {};

  Object.entries(holdings).forEach(([cityId, cityHoldings]) => {
    Object.entries(cityHoldings).forEach(([assetId, quantity]) => {
      if (quantity <= 0) {
        return;
      }

      const unitPrice = prices[cityId]?.[assetId] ?? assetIndex[assetId]?.basePrice ?? 0;
      const value = unitPrice * quantity;
      holdingsValue += value;
      cityValue[cityId] = (cityValue[cityId] ?? 0) + value;
      cityHoldingsCount[cityId] = (cityHoldingsCount[cityId] ?? 0) + 1;
      positionValue[`${cityId}:${assetId}`] = value;
    });
  });

  return {
    totalValue: Math.max(1, cash + holdingsValue),
    cityValue,
    cityHoldingsCount,
    positionValue
  };
}

type NotificationInput = {
  eventKey: string;
  category: OracleNotificationCategory;
  severity: Severity;
  title: string;
  body: string;
  speakText?: string | null;
  cityIds: string[];
  assetIds: string[];
  affectedValue: number;
  affectedPortfolioShare: number;
  holdingsCount: number;
  state?: OracleNotification["state"];
  timestamp: string;
};

export function createOracleNotification({
  eventKey,
  category,
  severity,
  title,
  body,
  speakText = null,
  cityIds,
  assetIds,
  affectedValue,
  affectedPortfolioShare,
  holdingsCount,
  state = "active",
  timestamp
}: NotificationInput): OracleNotification {
  return {
    id: `${eventKey}:${state}:${timestamp}`,
    eventKey,
    category,
    severity,
    title,
    body,
    speakText,
    cityIds,
    assetIds,
    affectedValue: round(affectedValue, 2),
    affectedPortfolioShare: round(affectedPortfolioShare, 2),
    holdingsCount,
    timestamp,
    state
  };
}

function selectSpeakableNotification(notifications: OracleNotification[]) {
  return notifications
    .filter((notification) => notification.state === "active")
    .filter((notification) => severityRank(notification.severity) >= severityRank("alert"))
    .filter((notification) => Boolean(notification.speakText))
    .sort((left, right) => {
      const severityWeight = (severity: Severity) => {
        if (severity === "critical") return 1_000;
        if (severity === "alert") return 500;
        return 0;
      };
      const categoryWeight = (category: OracleNotificationCategory) => {
        if (category === "flight") return 500;
        if (category === "storm") return 400;
        if (category === "access") return 300;
        if (category === "driver") return 200;
        return 100;
      };

      return (
        severityWeight(right.severity) +
        categoryWeight(right.category) +
        right.affectedPortfolioShare -
        (severityWeight(left.severity) +
          categoryWeight(left.category) +
          left.affectedPortfolioShare)
      );
    })[0] ?? null;
}

function buildDriverNotification(params: {
  cityId: string;
  assetId: string;
  previous: OraclePositionWatch;
  current: OraclePositionWatch;
  affectedValue: number;
  affectedPortfolioShare: number;
  timestamp: string;
}): OracleNotification | null {
  const { cityId, assetId, previous, current, affectedValue, affectedPortfolioShare, timestamp } =
    params;
  const asset = assetIndex[assetId];
  const cityName = cityIndex[cityId]?.name ?? cityId;
  const driverKey = getPrimaryDriverKey(asset.ecologicalWeights);

  if (!driverKey) {
    return null;
  }

  const driverLabel = signalMeta[driverKey].label;
  const signalText = formatSignalValue(driverKey, current.signalValue);
  const exposureText = `${formatCurrency(affectedValue)} (${formatShare(affectedPortfolioShare)} of the portfolio)`;
  const crossedNegative = previous.earthDelta >= 0 && current.earthDelta < 0;
  const crossedPositive = previous.earthDelta <= 0 && current.earthDelta > 0;
  const enteredMajorSeverity =
    severityRank(current.severity) >= severityRank("alert") &&
    severityRank(previous.severity) < severityRank("alert");
  const majorRecovery =
    severityRank(previous.severity) >= severityRank("alert") &&
    severityRank(current.severity) < severityRank("alert");
  const triggerEntered = !previous.triggerActive && current.triggerActive;
  const triggerExited = previous.triggerActive && !current.triggerActive;
  const swungHard = Math.abs(current.earthDelta - previous.earthDelta) >= DELTA_SWING_THRESHOLD;
  const eventKey = `driver-${cityId}-${assetId}`;

  if (crossedNegative || (enteredMajorSeverity && current.earthDelta < 0)) {
    const severity = current.severity === "critical" ? "critical" : "alert";
    return createOracleNotification({
      eventKey,
      category: "driver",
      severity,
      title: `${asset.label} turned against ${cityName}`,
      body: `${driverLabel} in ${cityName} is now working against your ${asset.label} position. Earth Delta slid from ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)}, putting about ${exposureText} under pressure.`,
      speakText:
        severity === "critical"
          ? `${cityName} has turned sharply against your ${asset.label} holding. ${driverLabel} is now suppressing it at a critical level.`
          : `${cityName} has started leaning against your ${asset.label} holding. ${driverLabel} just flipped negative on a live position.`,
      cityIds: [cityId],
      assetIds: [assetId],
      affectedValue,
      affectedPortfolioShare,
      holdingsCount: 1,
      timestamp
    });
  }

  if (crossedPositive || (enteredMajorSeverity && current.earthDelta > 0)) {
    const severity = current.severity === "critical" ? "critical" : "alert";
    return createOracleNotification({
      eventKey,
      category: "driver",
      severity,
      title: `${asset.label} found support in ${cityName}`,
      body: `${driverLabel} in ${cityName} is now boosting your ${asset.label} position. Earth Delta climbed from ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)}, now backing about ${exposureText}.`,
      speakText:
        severity === "critical"
          ? `${cityName} has become strongly supportive for your ${asset.label} holding. ${driverLabel} just pushed it into a critical upside regime.`
          : `${cityName} has started supporting your ${asset.label} holding. ${driverLabel} has flipped in your favour on a live position.`,
      cityIds: [cityId],
      assetIds: [assetId],
      affectedValue,
      affectedPortfolioShare,
      holdingsCount: 1,
      timestamp
    });
  }

  if (triggerEntered) {
    const directionText =
      current.triggerDirection === "downside" ? "downside" : "upside";
    const severity =
      current.triggerDirection === "downside" ? "alert" : current.severity === "critical" ? "critical" : "watch";

    return createOracleNotification({
      eventKey,
      category: "driver",
      severity,
      title: `${asset.label} trigger fired in ${cityName}`,
      body: `${driverLabel} crossed a key threshold in ${cityName} at ${signalText}, opening a ${directionText} regime for your ${asset.label} position worth about ${exposureText}.`,
      speakText:
        severity === "critical"
          ? `${asset.label} has triggered a critical ${directionText} move in ${cityName}.`
          : severity === "alert"
            ? `${asset.label} has triggered a meaningful ${directionText} move in ${cityName}.`
            : null,
      cityIds: [cityId],
      assetIds: [assetId],
      affectedValue,
      affectedPortfolioShare,
      holdingsCount: 1,
      timestamp
    });
  }

  if (swungHard) {
    const severity = current.earthDelta < previous.earthDelta ? "alert" : "watch";
    return createOracleNotification({
      eventKey,
      category: "driver",
      severity,
      title: `Sharp repricing in ${cityName}`,
      body: `${asset.label} moved sharply in ${cityName} as ${driverLabel} shifted to ${signalText}. Earth Delta jumped from ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)} across a live position worth about ${exposureText}.`,
      speakText:
        severity === "alert"
          ? `${asset.label} is repricing sharply in ${cityName}. ${driverLabel} just moved hard enough to matter for your holding there.`
          : null,
      cityIds: [cityId],
      assetIds: [assetId],
      affectedValue,
      affectedPortfolioShare,
      holdingsCount: 1,
      timestamp
    });
  }

  if (triggerExited || majorRecovery) {
    return createOracleNotification({
      eventKey,
      category: "recovery",
      severity: "calm",
      title: `${asset.label} steadied in ${cityName}`,
      body: `${driverLabel} has moved back out of its extreme zone in ${cityName}. Earth Delta eased from ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)}, so the position looks less stressed now.`,
      cityIds: [cityId],
      assetIds: [assetId],
      affectedValue,
      affectedPortfolioShare,
      holdingsCount: 1,
      timestamp,
      state: "resolved"
    });
  }

  return null;
}

export function createInitialOracleWatchState(): OracleWatchState {
  return {
    initialized: false,
    activeEventKeys: [],
    stormByCity: {},
    myceliumOpenByCity: {},
    destinationBlockedByCity: {},
    positions: {}
  };
}

export function evaluateOracleNotifications({
  signals,
  holdings,
  prices,
  tickers,
  cash,
  blockedCityIds,
  currentCityId,
  focusedCityId,
  flight,
  previousState,
  now
}: OracleEvaluationInput): OracleEvaluationResult {
  const timestamp = createTimestamp(now);
  const blockedSet = new Set(blockedCityIds);
  const signalByCity = Object.fromEntries(signals.map((signal) => [signal.cityId, signal]));
  const portfolio = buildPortfolioState(holdings, prices, cash);
  const notifications: OracleNotification[] = [];
  const nextPositions: OracleWatchState["positions"] = {};
  const nextStormByCity: OracleWatchState["stormByCity"] = {};
  const nextMyceliumOpenByCity: OracleWatchState["myceliumOpenByCity"] = {};
  const nextDestinationBlockedByCity: OracleWatchState["destinationBlockedByCity"] = {};
  const activeEventKeys = new Set<string>();

  const trackedStormCities = new Set<string>(
    focusedCityId !== currentCityId ? [focusedCityId] : []
  );
  Object.entries(portfolio.cityValue).forEach(([cityId, value]) => {
    const sharePct = (value / portfolio.totalValue) * 100;
    if (cityId !== currentCityId && sharePct >= STORM_FEED_SHARE_PCT) {
      trackedStormCities.add(cityId);
    }
  });

  trackedStormCities.forEach((cityId) => {
    const cityName = cityIndex[cityId]?.name ?? cityId;
    const affectedValue = portfolio.cityValue[cityId] ?? 0;
    const affectedPortfolioShare = (affectedValue / portfolio.totalValue) * 100;
    const holdingsCount = portfolio.cityHoldingsCount[cityId] ?? 0;
    const isStormed = blockedSet.has(cityId);
    nextStormByCity[cityId] = isStormed;
    const eventKey = `storm-${cityId}`;

    if (isStormed) {
      activeEventKeys.add(eventKey);
    }

    if (!previousState.initialized) {
      return;
    }

    const previousStormed = previousState.stormByCity[cityId] ?? false;
    const isImportantCity = affectedPortfolioShare >= STORM_FEED_SHARE_PCT;

    if (!previousStormed && isStormed && isImportantCity) {
      const severity = affectedPortfolioShare >= STORM_CRITICAL_SHARE_PCT ? "critical" : "alert";
      notifications.push(
        createOracleNotification({
          eventKey,
          category: "storm",
          severity,
          title: `${cityName} has slipped under storm pressure`,
          body: `${cityName} has moved into the storm track. That now covers about ${formatCurrency(affectedValue)} across ${holdingsCount} live positions, or ${formatShare(affectedPortfolioShare)} of the portfolio.`,
          speakText:
            severity === "critical"
              ? `${cityName} is now under severe storm pressure. A meaningful share of your portfolio is exposed.`
              : `${cityName} has moved into the storm track. Part of your portfolio there is now exposed.`,
          cityIds: [cityId],
          assetIds: Object.entries(holdings[cityId] ?? {})
            .filter(([, quantity]) => quantity > 0)
            .map(([assetId]) => assetId),
          affectedValue,
          affectedPortfolioShare,
          holdingsCount,
          timestamp
        })
      );
    }

    if (previousStormed && !isStormed && isImportantCity) {
      notifications.push(
        createOracleNotification({
          eventKey,
          category: "recovery",
          severity: "watch",
          title: `${cityName} has cleared`,
          body: `${cityName} is moving out of the storm track. Roughly ${formatCurrency(affectedValue)} of held positions are back outside the front and normal access is reopening.`,
          cityIds: [cityId],
          assetIds: Object.entries(holdings[cityId] ?? {})
            .filter(([, quantity]) => quantity > 0)
            .map(([assetId]) => assetId),
          affectedValue,
          affectedPortfolioShare,
          holdingsCount,
          timestamp,
          state: "resolved"
        })
      );
    }
  });

  const currentSignal = signalByCity[currentCityId];
  if (currentSignal) {
    const eventKey = `mycelium-${currentCityId}`;
    const isOpen = isMyceliumOpen(currentSignal);
    nextMyceliumOpenByCity[currentCityId] = isOpen;
    if (!isOpen) {
      activeEventKeys.add(eventKey);
    }

    if (previousState.initialized) {
      const previousOpen = previousState.myceliumOpenByCity[currentCityId];
      const affectedValue = portfolio.cityValue[currentCityId] ?? 0;
      const affectedPortfolioShare = (affectedValue / portfolio.totalValue) * 100;
      const holdingsCount = portfolio.cityHoldingsCount[currentCityId] ?? 0;
      const cityName = cityIndex[currentCityId]?.name ?? currentCityId;

      void previousOpen;
      void affectedValue;
      void affectedPortfolioShare;
      void holdingsCount;
      void cityName;
    }
  }

  if (focusedCityId !== currentCityId && !flight) {
    const isBlocked = blockedSet.has(focusedCityId);
    const affectedValue = portfolio.cityValue[focusedCityId] ?? 0;
    const affectedPortfolioShare = (affectedValue / portfolio.totalValue) * 100;
    const holdingsCount = portfolio.cityHoldingsCount[focusedCityId] ?? 0;
    const cityName = cityIndex[focusedCityId]?.name ?? focusedCityId;
    const eventKey = `destination-${focusedCityId}`;
    nextDestinationBlockedByCity[focusedCityId] = isBlocked;
    if (isBlocked) {
      activeEventKeys.add(eventKey);
    }

    if (previousState.initialized) {
      const previousBlocked = previousState.destinationBlockedByCity[focusedCityId] ?? false;
      const isImportant = affectedPortfolioShare >= STORM_FEED_SHARE_PCT;

      if (!previousBlocked && isBlocked && isImportant) {
        notifications.push(
          createOracleNotification({
            eventKey,
            category: "access",
            severity: "alert",
            title: `Route to ${cityName} has closed`,
            body: `${cityName} is now behind the storm wall. That market holds about ${formatCurrency(affectedValue)}, so any move back in will have to wait for the front to clear.`,
            speakText: `${cityName} has slipped behind the storm wall. Access to that market is temporarily closed.`,
            cityIds: [focusedCityId],
            assetIds: Object.entries(holdings[focusedCityId] ?? {})
              .filter(([, quantity]) => quantity > 0)
              .map(([assetId]) => assetId),
            affectedValue,
            affectedPortfolioShare,
            holdingsCount,
            timestamp
          })
        );
      }

      if (previousBlocked && !isBlocked && isImportant) {
        notifications.push(
          createOracleNotification({
            eventKey,
            category: "recovery",
            severity: "calm",
            title: `Route to ${cityName} has reopened`,
            body: `${cityName} is back outside the storm wall, so access to that market is opening again.`,
            cityIds: [focusedCityId],
            assetIds: Object.entries(holdings[focusedCityId] ?? {})
              .filter(([, quantity]) => quantity > 0)
              .map(([assetId]) => assetId),
            affectedValue,
            affectedPortfolioShare,
            holdingsCount,
            timestamp,
            state: "resolved"
          })
        );
      }
    }
  }

  Object.entries(holdings).forEach(([cityId, cityHoldings]) => {
    const signal = signalByCity[cityId];
    if (!signal) {
      return;
    }

    Object.entries(cityHoldings).forEach(([assetId, quantity]) => {
      if (quantity <= 0) {
        return;
      }

      const positionKey = `${cityId}:${assetId}`;
      const positionValue = portfolio.positionValue[positionKey] ?? 0;
      const positionShare = (positionValue / portfolio.totalValue) * 100;
      const asset = assetIndex[assetId];
      const baselineValue = prices[cityId]?.[assetId] ?? tickers.find((ticker) => ticker.assetId === assetId)?.price ?? asset.basePrice;
      const computation = computeOracle(asset, signal, baselineValue);
      const driverKey = getPrimaryDriverKey(asset.ecologicalWeights);
      const triggeredState = getTriggeredRuleState(assetId, signal);

      if (!driverKey) {
        return;
      }

      nextPositions[positionKey] = {
        earthDelta: computation.earthDelta,
        severity: computation.severity,
        triggerActive: triggeredState.active,
        triggerDirection: triggeredState.direction,
        sharePct: positionShare,
        signalValue: signal[driverKey]
      };

      if (computation.severity === "critical" || computation.severity === "alert" || triggeredState.active) {
        activeEventKeys.add(`driver-${cityId}-${assetId}`);
      }

      if (!previousState.initialized) {
        return;
      }

      const previousPosition = previousState.positions[positionKey];
      if (!previousPosition) {
        return;
      }

      const isImportantPosition =
        cityId !== currentCityId &&
        Math.max(previousPosition.sharePct, positionShare) >= DRIVER_FEED_SHARE_PCT;
      if (!isImportantPosition) {
        return;
      }

      const notification = buildDriverNotification({
        cityId,
        assetId,
        previous: previousPosition,
        current: nextPositions[positionKey],
        affectedValue: positionValue,
        affectedPortfolioShare: positionShare,
        timestamp
      });

      if (notification) {
        notifications.push(notification);
      }
    });
  });

  return {
    notifications,
    speakable: selectSpeakableNotification(notifications),
    nextState: {
      initialized: true,
      activeEventKeys: [...activeEventKeys],
      stormByCity: nextStormByCity,
      myceliumOpenByCity: nextMyceliumOpenByCity,
      destinationBlockedByCity: nextDestinationBlockedByCity,
      positions: nextPositions
    }
  };
}
