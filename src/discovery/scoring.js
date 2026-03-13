import { DEFAULT_DISCOVERY_CONFIG } from "./config.js";
import {
  evaluateSourceAuthority,
  resolveSourceAuthorityWeight,
  resolveWeightedSourceAuthorityScore,
  scoreSourceAuthority,
} from "./source-authority.js";

export function scoreSource(record, config = DEFAULT_DISCOVERY_CONFIG) {
  const signalScore = scoreSignal(record, config);
  const authority = evaluateSourceAuthority(record, config);
  const authorityWeight = resolveSourceAuthorityWeight(record, config);
  const weightedAuthorityScore = resolveWeightedSourceAuthorityScore(
    {
      ...record,
      authorityScore: authority.authorityScore,
    },
    config,
  );

  return {
    signalScore,
    authorityScore: authority.authorityScore,
    weightedAuthorityScore,
    authorityWeight,
    minimumAuthorityScore: authority.minimumAuthorityScore,
    authorityEligible: authority.eligible,
    isNewSource: authority.isNewSource,
    approved: authority.eligible && (record.seed === true || signalScore >= config.minSignalScore),
  };
}

export function scoreSignal(record, config = DEFAULT_DISCOVERY_CONFIG) {
  const discoveryCount = record.evidence.discoveryCount ?? 0;
  const uniqueReferrers = sizeOf(record.evidence.referrers);
  const uniquePlatforms = sizeOf(record.evidence.referrerPlatforms);
  const uniqueCycles = sizeOf(record.evidence.cyclesSeen);
  const topicalMatches = sizeOf(record.evidence.topicHits);
  const averageSignalQuality = resolveAverageSignalQuality(record);
  const highSignalObservations = resolveHighSignalObservationCount(record);

  return clamp(
    Math.min(discoveryCount * 8, 32) +
      Math.min(uniqueReferrers * 9, 27) +
      Math.min(uniquePlatforms * 6, 12) +
      Math.min(uniqueCycles * 5, 10) +
      Math.min(topicalMatches * 4, 12) +
      Math.round(averageSignalQuality * 0.12) +
      Math.min(highSignalObservations * 4, 12) +
      7,
    0,
    100
  );
}

export function scoreAuthority(record, config = DEFAULT_DISCOVERY_CONFIG) {
  return scoreSourceAuthority(record, config);
}

export function collectTopicHits(values, config = DEFAULT_DISCOVERY_CONFIG) {
  const haystack = values
    .filter((value) => typeof value === "string" && value.length)
    .join(" ")
    .toLowerCase();

  const hits = new Set();

  for (const keyword of config.topicalKeywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      hits.add(keyword.toLowerCase());
    }
  }

  return Array.from(hits);
}

function sizeOf(listLike) {
  return Array.isArray(listLike) ? new Set(listLike).size : 0;
}

function resolveAverageSignalQuality(record) {
  const signalQuality = record?.evidence?.signalQuality;

  if (!signalQuality || typeof signalQuality !== "object") {
    return 0;
  }

  if (typeof signalQuality.averageScore === "number" && Number.isFinite(signalQuality.averageScore)) {
    return clamp(Math.round(signalQuality.averageScore), 0, 100);
  }

  const observationCount =
    typeof signalQuality.observationCount === "number" &&
    Number.isFinite(signalQuality.observationCount)
      ? Math.max(0, signalQuality.observationCount)
      : 0;
  const totalScore =
    typeof signalQuality.totalScore === "number" && Number.isFinite(signalQuality.totalScore)
      ? Math.max(0, signalQuality.totalScore)
      : 0;

  if (observationCount === 0 || totalScore === 0) {
    return 0;
  }

  return clamp(Math.round(totalScore / observationCount), 0, 100);
}

function resolveHighSignalObservationCount(record) {
  const highSignalObservationCount = record?.evidence?.signalQuality?.highSignalObservationCount;

  return typeof highSignalObservationCount === "number" &&
    Number.isFinite(highSignalObservationCount)
    ? Math.max(0, highSignalObservationCount)
    : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
