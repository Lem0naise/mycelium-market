import { assetIndex, assetProfiles, cityIndex } from "./data";
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

type OracleOpportunityWatch = {
  earthDelta: number;
  severity: Severity;
  triggerActive: boolean;
  triggerDirection: OraclePositionWatch["triggerDirection"];
  accessible: boolean;
};

export type OracleWatchState = {
  initialized: boolean;
  activeEventKeys: string[];
  stormByCity: Record<string, boolean>;
  myceliumOpenByCity: Record<string, boolean>;
  destinationBlockedByCity: Record<string, boolean>;
  positions: Record<string, OraclePositionWatch>;
  opportunities: Record<string, OracleOpportunityWatch>;
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
    state,
    spokenAt: null
  };
}

function selectSpeakableNotification(notifications: OracleNotification[]) {
  return notifications
    .filter(
      (notification) =>
        Boolean(notification.speakText) &&
        (notification.state === "active" ||
          notification.category === "recovery" ||
          severityRank(notification.severity) >= severityRank("watch"))
    )
    .sort((left, right) => {
      const severityWeight = (severity: Severity) => {
        if (severity === "critical") return 1_000;
        if (severity === "alert") return 500;
        if (severity === "watch") return 200;
        return 0;
      };
      const categoryWeight = (category: OracleNotificationCategory) => {
        if (category === "flight") return 500;
        if (category === "storm") return 400;
        if (category === "opportunity") return 350;
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
      title: `${asset.label} softening in ${cityName}`,
      body: `${driverLabel} flipped against it. Delta ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)} on ${exposureText}.`,
      speakText:
        severity === "critical"
          ? `${asset.label} is breaking lower in ${cityName}. ${driverLabel} has turned sharply against it.`
          : `${asset.label} just weakened in ${cityName}. ${driverLabel} flipped negative there.`,
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
      title: `${asset.label} strengthening in ${cityName}`,
      body: `${driverLabel} turned supportive. Delta ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)} on ${exposureText}.`,
      speakText:
        severity === "critical"
          ? `${asset.label} is surging in ${cityName}. ${driverLabel} has turned strongly supportive.`
          : `${asset.label} just strengthened in ${cityName}. ${driverLabel} flipped in your favour.`,
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
      title: `${asset.label} trigger in ${cityName}`,
      body: `${driverLabel} hit ${signalText}. ${directionText} regime live on ${exposureText}.`,
      speakText:
        severity === "critical"
          ? `${asset.label} has hit a critical ${directionText} trigger in ${cityName}.`
          : severity === "alert"
            ? `${asset.label} has hit a fresh ${directionText} trigger in ${cityName}.`
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
      body: `${asset.label} repriced on ${driverLabel} at ${signalText}. Delta ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)} on ${exposureText}.`,
      speakText:
        severityRank(severity) >= severityRank("watch")
          ? `${asset.label} just repriced in ${cityName}. ${driverLabel} moved hard enough to matter there.`
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
      body: `${driverLabel} cooled off. Delta eased from ${formatSigned(previous.earthDelta)} to ${formatSigned(current.earthDelta)}.`,
      speakText: `${asset.label} has steadied in ${cityName}. ${driverLabel} is no longer in an extreme regime there.`,
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

function buildOpportunityNotification(params: {
  cityId: string;
  assetId: string;
  current: OracleOpportunityWatch;
  previous: OracleOpportunityWatch | undefined;
  askPrice: number;
  timestamp: string;
}): OracleNotification | null {
  const { cityId, assetId, current, previous, askPrice, timestamp } = params;
  const asset = assetIndex[assetId];
  const cityName = cityIndex[cityId]?.name ?? cityId;
  const driverKey = getPrimaryDriverKey(asset.ecologicalWeights);

  if (!driverKey || !current.accessible) {
    return null;
  }

  const driverLabel = signalMeta[driverKey].label;
  const eventKey = `opportunity-${cityId}-${assetId}`;
  const enteredSupport =
    !previous ||
    !previous.accessible ||
    previous.earthDelta < 4 ||
    current.earthDelta - previous.earthDelta >= 6 ||
    (!previous.triggerActive && current.triggerActive);

  if (!enteredSupport) {
    return null;
  }

  const severity =
    current.severity === "critical" || current.earthDelta >= 10
      ? "critical"
      : current.triggerActive || current.earthDelta >= 6
        ? "alert"
        : "watch";
  const triggerText =
    current.triggerActive && current.triggerDirection === "upside" ? " Trigger live." : "";

  return createOracleNotification({
    eventKey,
    category: "opportunity",
    severity,
    title: `Buy ${asset.label} in ${cityName}`,
    body: `${driverLabel} is supportive. Delta ${formatSigned(current.earthDelta)} at ${formatCurrency(askPrice)}.${triggerText}`,
    speakText:
      severity === "critical"
        ? `Strong buy window. ${asset.label} in ${cityName} is in a critical upside regime.`
        : severity === "alert"
          ? `Buy window. ${asset.label} in ${cityName} looks attractive right now.`
          : `Watch ${asset.label} in ${cityName}. Conditions just improved.`,
    cityIds: [cityId],
    assetIds: [assetId],
    affectedValue: askPrice,
    affectedPortfolioShare: 0,
    holdingsCount: 0,
    timestamp
  });
}

export function createInitialOracleWatchState(): OracleWatchState {
  return {
    initialized: false,
    activeEventKeys: [],
    stormByCity: {},
    myceliumOpenByCity: {},
    destinationBlockedByCity: {},
    positions: {},
    opportunities: {}
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
  const nextOpportunities: OracleWatchState["opportunities"] = {};
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
          title: `${cityName} stormed`,
          body: `${formatShare(affectedPortfolioShare)} of the book is exposed. ${formatCurrency(affectedValue)} now sits inside the front.`,
          speakText:
            severity === "critical"
              ? `${cityName} just went storm-side. A large share of your book is exposed there.`
              : `${cityName} just moved into the storm track. Part of your book is now exposed.`,
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
          title: `${cityName} cleared`,
          body: `${formatCurrency(affectedValue)} is back outside the front.`,
          speakText: `${cityName} has cleared the storm track. Your positions there are back outside the front.`,
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
            title: `Route to ${cityName} closed`,
            body: `Route shut. ${formatCurrency(affectedValue)} is stuck behind the storm wall.`,
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
            title: `${cityName} reopened`,
            body: `The route is open again.`,
            speakText: `The route to ${cityName} has reopened. That market is accessible again.`,
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

  if (
    notifications.length === 0 &&
    cash >= 1_000 &&
    focusedCityId !== currentCityId &&
    !blockedSet.has(focusedCityId) &&
    (portfolio.cityHoldingsCount[focusedCityId] ?? 0) === 0
  ) {
    const focusedSignal = signalByCity[focusedCityId];
    if (focusedSignal) {
      assetProfiles.forEach((asset) => {
        if ((holdings[focusedCityId]?.[asset.id] ?? 0) > 0) {
          return;
        }

        const askPrice =
          prices[focusedCityId]?.[asset.id] ??
          tickers.find((ticker) => ticker.assetId === asset.id)?.price ??
          asset.basePrice;
        const computation = computeOracle(asset, focusedSignal, askPrice);
        const triggeredState = getTriggeredRuleState(asset.id, focusedSignal);
        const opportunityKey = `${focusedCityId}:${asset.id}`;

        nextOpportunities[opportunityKey] = {
          earthDelta: computation.earthDelta,
          severity: computation.severity,
          triggerActive: triggeredState.active,
          triggerDirection: triggeredState.direction,
          accessible: true
        };

        const looksInteresting =
          computation.earthDelta >= 4 ||
          severityRank(computation.severity) >= severityRank("alert") ||
          (triggeredState.active && triggeredState.direction === "upside");
        if (!looksInteresting || !previousState.initialized) {
          return;
        }

        const notification = buildOpportunityNotification({
          cityId: focusedCityId,
          assetId: asset.id,
          current: nextOpportunities[opportunityKey],
          previous: previousState.opportunities[opportunityKey],
          askPrice,
          timestamp
        });

        if (notification) {
          activeEventKeys.add(`opportunity-${focusedCityId}-${asset.id}`);
          notifications.push(notification);
        }
      });
    }
  }

  return {
    notifications,
    speakable: selectSpeakableNotification(notifications),
    nextState: {
      initialized: true,
      activeEventKeys: [...activeEventKeys],
      stormByCity: nextStormByCity,
      myceliumOpenByCity: nextMyceliumOpenByCity,
      destinationBlockedByCity: nextDestinationBlockedByCity,
      positions: nextPositions,
      opportunities: nextOpportunities
    }
  };
}
