import { readFileSync } from "node:fs";

import {
  CONTENT_CATEGORIES,
  SOURCE_KINDS,
  assertNonEmptyString,
  assertOneOf,
  normalizeTimestamp,
} from "../core/contracts.js";

export const DEFAULT_TOPIC_TAXONOMY_REVIEW_CADENCE = "quarterly";
export const DEFAULT_TOPIC_TAXONOMY_VERSIONING_SCHEME = "semver";
export const TOPIC_TAXONOMY_CHANGE_TYPES = Object.freeze(["initial", "major", "minor", "patch"]);
export const TOPIC_TAXONOMY_VERSION_CHANGE_RULES = Object.freeze(["major", "minor", "patch"]);

const TOPIC_TAXONOMY_DOCUMENT_PATH = new URL("./topic-taxonomy.document.json", import.meta.url);

export const CURRENT_NEWSLETTER_TOPIC_TAXONOMY = createNewsletterTopicTaxonomy(
  loadNewsletterTopicTaxonomyDocument(),
);

export function createNewsletterTopicTaxonomy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("topic taxonomy must be an object");
  }

  const taxonomyDefinition = normalizeTaxonomyDefinition(input.taxonomyDefinition);
  const currentVersion = assertNonEmptyString(
    input.currentVersion ?? taxonomyDefinition.version,
    "currentVersion",
  );
  const changelog = normalizeTopicTaxonomyChangelog(input.changelog, currentVersion);

  if (currentVersion !== taxonomyDefinition.version) {
    throw new TypeError("currentVersion must match taxonomyDefinition.version");
  }

  return {
    currentVersion,
    taxonomyDefinition,
    changelog,
  };
}

export function formatNewsletterTopicTaxonomyResponse({
  generatedAt,
  taxonomy,
} = {}) {
  const normalizedTaxonomy = createNewsletterTopicTaxonomy(
    taxonomy ?? CURRENT_NEWSLETTER_TOPIC_TAXONOMY,
  );

  return {
    generated_at: normalizeTimestamp(generatedAt, "generatedAt"),
    current_version: normalizedTaxonomy.currentVersion,
    taxonomy_definition: serializeTopicTaxonomyDefinition(
      normalizedTaxonomy.taxonomyDefinition,
    ),
    changelog: normalizedTaxonomy.changelog.map((entry) =>
      serializeTopicTaxonomyChangeEntry(entry),
    ),
  };
}

export function resolveCoverageAreasForSource(source, taxonomy = CURRENT_NEWSLETTER_TOPIC_TAXONOMY) {
  const normalizedTaxonomy = createNewsletterTopicTaxonomy(taxonomy);
  const normalizedSource = normalizeSourceSelector(source);
  const mapping = findSourceCoverageMapping(
    normalizedTaxonomy.taxonomyDefinition.sourceCoverageMapping,
    normalizedSource,
  );

  if (!mapping) {
    return null;
  }

  const coverageAreasByKey = new Map(
    normalizedTaxonomy.taxonomyDefinition.coverageAreas.map((area) => [area.key, area]),
  );

  return {
    sourceKind: mapping.sourceKind,
    sourceIds: [...mapping.sourceIds],
    primaryCoverageAreas: mapping.primaryCoverageAreas.map((key) => ({
      ...coverageAreasByKey.get(key),
    })),
    secondaryCoverageAreas: mapping.secondaryCoverageAreas.map((key) => ({
      ...coverageAreasByKey.get(key),
    })),
    rationale: mapping.rationale,
  };
}

function normalizeTaxonomyDefinition(taxonomyDefinition) {
  if (!taxonomyDefinition || typeof taxonomyDefinition !== "object" || Array.isArray(taxonomyDefinition)) {
    throw new TypeError("taxonomyDefinition must be an object");
  }

  const effectiveAt = normalizeTimestamp(
    taxonomyDefinition.effectiveAt,
    "taxonomyDefinition.effectiveAt",
  );
  const reviewedAt = normalizeTimestamp(
    taxonomyDefinition.reviewedAt,
    "taxonomyDefinition.reviewedAt",
  );
  const nextReviewAt = normalizeTimestamp(
    taxonomyDefinition.nextReviewAt,
    "taxonomyDefinition.nextReviewAt",
  );

  if (new Date(reviewedAt).getTime() < new Date(effectiveAt).getTime()) {
    throw new TypeError("taxonomyDefinition.reviewedAt must be at or after effectiveAt");
  }

  if (new Date(nextReviewAt).getTime() <= new Date(reviewedAt).getTime()) {
    throw new TypeError("taxonomyDefinition.nextReviewAt must be after reviewedAt");
  }

  const coverageAreas = normalizeCoverageAreas(taxonomyDefinition.coverageAreas);

  return {
    version: assertNonEmptyString(taxonomyDefinition.version, "taxonomyDefinition.version"),
    effectiveAt,
    reviewedAt,
    nextReviewAt,
    reviewCadence: assertNonEmptyString(
      taxonomyDefinition.reviewCadence ?? DEFAULT_TOPIC_TAXONOMY_REVIEW_CADENCE,
      "taxonomyDefinition.reviewCadence",
    ),
    definition: assertNonEmptyString(taxonomyDefinition.definition, "taxonomyDefinition.definition"),
    coverageAreas,
    sourceCoverageMapping: normalizeSourceCoverageMapping(
      taxonomyDefinition.sourceCoverageMapping,
      new Set(coverageAreas.map((area) => area.key)),
    ),
    changeTracking: normalizeChangeTracking(taxonomyDefinition.changeTracking),
  };
}

function normalizeCoverageAreas(coverageAreas) {
  if (!Array.isArray(coverageAreas) || coverageAreas.length === 0) {
    throw new TypeError("taxonomyDefinition.coverageAreas must be a non-empty array");
  }

  const keys = new Set();

  return coverageAreas.map((area, index) => {
    const normalizedArea = normalizeCoverageArea(area, index);

    if (keys.has(normalizedArea.key)) {
      throw new TypeError(
        `duplicate taxonomyDefinition.coverageAreas key detected: ${normalizedArea.key}`,
      );
    }

    keys.add(normalizedArea.key);
    return normalizedArea;
  });
}

function normalizeCoverageArea(area, index) {
  if (!area || typeof area !== "object" || Array.isArray(area)) {
    throw new TypeError(`taxonomyDefinition.coverageAreas[${index}] must be an object`);
  }

  return {
    key: assertNonEmptyString(area.key, `taxonomyDefinition.coverageAreas[${index}].key`),
    label: assertNonEmptyString(area.label, `taxonomyDefinition.coverageAreas[${index}].label`),
    description: assertNonEmptyString(
      area.description,
      `taxonomyDefinition.coverageAreas[${index}].description`,
    ),
    contentCategories: normalizeContentCategories(
      area.contentCategories,
      `taxonomyDefinition.coverageAreas[${index}].contentCategories`,
    ),
    signals: normalizeStringList(area.signals, `taxonomyDefinition.coverageAreas[${index}].signals`),
  };
}

function normalizeSourceCoverageMapping(sourceCoverageMapping, coverageAreaKeys) {
  if (!Array.isArray(sourceCoverageMapping) || sourceCoverageMapping.length === 0) {
    throw new TypeError("taxonomyDefinition.sourceCoverageMapping must be a non-empty array");
  }

  const seenKinds = new Set();

  return sourceCoverageMapping.map((entry, index) => {
    const normalizedEntry = normalizeSourceCoverageEntry(entry, index, coverageAreaKeys);

    if (seenKinds.has(normalizedEntry.sourceKind)) {
      throw new TypeError(
        `duplicate taxonomyDefinition.sourceCoverageMapping sourceKind detected: ${normalizedEntry.sourceKind}`,
      );
    }

    seenKinds.add(normalizedEntry.sourceKind);
    return normalizedEntry;
  });
}

function normalizeSourceCoverageEntry(entry, index, coverageAreaKeys) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`taxonomyDefinition.sourceCoverageMapping[${index}] must be an object`);
  }

  const sourceKind = assertOneOf(
    assertNonEmptyString(entry.sourceKind, `taxonomyDefinition.sourceCoverageMapping[${index}].sourceKind`),
    SOURCE_KINDS,
    `taxonomyDefinition.sourceCoverageMapping[${index}].sourceKind`,
  );
  const primaryCoverageAreas = normalizeCoverageAreaKeyList(
    entry.primaryCoverageAreas,
    `taxonomyDefinition.sourceCoverageMapping[${index}].primaryCoverageAreas`,
    coverageAreaKeys,
  );
  const secondaryCoverageAreas = normalizeCoverageAreaKeyList(
    entry.secondaryCoverageAreas ?? [],
    `taxonomyDefinition.sourceCoverageMapping[${index}].secondaryCoverageAreas`,
    coverageAreaKeys,
    { allowEmpty: true },
  );

  ensureDisjointCoverageAreaLists(
    primaryCoverageAreas,
    secondaryCoverageAreas,
    `taxonomyDefinition.sourceCoverageMapping[${index}]`,
  );

  return {
    sourceKind,
    sourceIds: normalizeStringList(
      entry.sourceIds,
      `taxonomyDefinition.sourceCoverageMapping[${index}].sourceIds`,
    ),
    primaryCoverageAreas,
    secondaryCoverageAreas,
    rationale: assertNonEmptyString(
      entry.rationale,
      `taxonomyDefinition.sourceCoverageMapping[${index}].rationale`,
    ),
  };
}

function normalizeChangeTracking(changeTracking) {
  if (!changeTracking || typeof changeTracking !== "object" || Array.isArray(changeTracking)) {
    throw new TypeError("taxonomyDefinition.changeTracking must be an object");
  }

  return {
    versioningScheme: assertNonEmptyString(
      changeTracking.versioningScheme ?? DEFAULT_TOPIC_TAXONOMY_VERSIONING_SCHEME,
      "taxonomyDefinition.changeTracking.versioningScheme",
    ),
    updatePolicy: assertNonEmptyString(
      changeTracking.updatePolicy,
      "taxonomyDefinition.changeTracking.updatePolicy",
    ),
    versionChangeRules: normalizeVersionChangeRules(changeTracking.versionChangeRules),
  };
}

function normalizeVersionChangeRules(versionChangeRules) {
  if (!versionChangeRules || typeof versionChangeRules !== "object" || Array.isArray(versionChangeRules)) {
    throw new TypeError("taxonomyDefinition.changeTracking.versionChangeRules must be an object");
  }

  return Object.fromEntries(
    TOPIC_TAXONOMY_VERSION_CHANGE_RULES.map((ruleName) => [
      ruleName,
      assertNonEmptyString(
        versionChangeRules[ruleName],
        `taxonomyDefinition.changeTracking.versionChangeRules.${ruleName}`,
      ),
    ]),
  );
}

function normalizeTopicTaxonomyChangelog(changelog, currentVersion) {
  if (!Array.isArray(changelog) || changelog.length === 0) {
    throw new TypeError("changelog must be a non-empty array");
  }

  const versions = new Set();
  const normalizedEntries = changelog.map((entry, index) => {
    const normalizedEntry = normalizeTopicTaxonomyChangeEntry(entry, index);

    if (versions.has(normalizedEntry.version)) {
      throw new TypeError(`duplicate changelog version detected: ${normalizedEntry.version}`);
    }

    versions.add(normalizedEntry.version);
    return normalizedEntry;
  });

  if (!versions.has(currentVersion)) {
    throw new TypeError("changelog must include an entry for currentVersion");
  }

  return normalizedEntries;
}

function normalizeTopicTaxonomyChangeEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`changelog[${index}] must be an object`);
  }

  const changeType = assertNonEmptyString(entry.changeType, `changelog[${index}].changeType`);

  if (!TOPIC_TAXONOMY_CHANGE_TYPES.includes(changeType)) {
    throw new TypeError(
      `changelog[${index}].changeType must be one of ${TOPIC_TAXONOMY_CHANGE_TYPES.join(", ")}`,
    );
  }

  return {
    version: assertNonEmptyString(entry.version, `changelog[${index}].version`),
    changeType,
    effectiveAt: normalizeTimestamp(entry.effectiveAt, `changelog[${index}].effectiveAt`),
    summary: assertNonEmptyString(entry.summary, `changelog[${index}].summary`),
    rationale: assertNonEmptyString(entry.rationale, `changelog[${index}].rationale`),
    taxonomyChanges: normalizeStringList(entry.taxonomyChanges, `changelog[${index}].taxonomyChanges`),
  };
}

function normalizeCoverageAreaKeyList(value, fieldName, coverageAreaKeys, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  if (!allowEmpty && value.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  const normalizedValues = value.map((entry, index) =>
    assertNonEmptyString(entry, `${fieldName}[${index}]`),
  );

  for (const key of normalizedValues) {
    if (!coverageAreaKeys.has(key)) {
      throw new TypeError(`${fieldName} contains unknown coverage area key: ${key}`);
    }
  }

  return [...new Set(normalizedValues)];
}

function ensureDisjointCoverageAreaLists(primaryCoverageAreas, secondaryCoverageAreas, fieldName) {
  const secondaryAreaSet = new Set(secondaryCoverageAreas);

  for (const areaKey of primaryCoverageAreas) {
    if (secondaryAreaSet.has(areaKey)) {
      throw new TypeError(
        `${fieldName} cannot list the same coverage area as both primary and secondary: ${areaKey}`,
      );
    }
  }
}

function normalizeContentCategories(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  return [...new Set(value.map((entry, index) =>
    assertOneOf(
      assertNonEmptyString(entry, `${fieldName}[${index}]`),
      CONTENT_CATEGORIES,
      `${fieldName}[${index}]`,
    ),
  ))];
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty array`);
  }

  return value.map((entry, index) => assertNonEmptyString(entry, `${fieldName}[${index}]`));
}

function normalizeSourceSelector(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("source must be an object");
  }

  const sourceKind = assertOneOf(
    assertNonEmptyString(source.kind ?? source.sourceKind, "source.kind"),
    SOURCE_KINDS,
    "source.kind",
  );
  const sourceIdValue = source.id ?? source.sourceId;
  const sourceId =
    sourceIdValue == null ? null : assertNonEmptyString(sourceIdValue, "source.id");

  return { sourceKind, sourceId };
}

function findSourceCoverageMapping(mappings, source) {
  if (source.sourceId) {
    const exactMatch = mappings.find((entry) => entry.sourceIds.includes(source.sourceId));

    if (exactMatch) {
      return exactMatch;
    }
  }

  return mappings.find((entry) => entry.sourceKind === source.sourceKind) ?? null;
}

function serializeTopicTaxonomyDefinition(taxonomyDefinition) {
  return {
    version: taxonomyDefinition.version,
    effective_at: taxonomyDefinition.effectiveAt,
    reviewed_at: taxonomyDefinition.reviewedAt,
    next_review_at: taxonomyDefinition.nextReviewAt,
    review_cadence: taxonomyDefinition.reviewCadence,
    definition: taxonomyDefinition.definition,
    coverage_areas: taxonomyDefinition.coverageAreas.map((area) => ({
      key: area.key,
      label: area.label,
      description: area.description,
      content_categories: [...area.contentCategories],
      signals: [...area.signals],
    })),
    source_coverage_mapping: taxonomyDefinition.sourceCoverageMapping.map((entry) => ({
      source_kind: entry.sourceKind,
      source_ids: [...entry.sourceIds],
      primary_coverage_areas: [...entry.primaryCoverageAreas],
      secondary_coverage_areas: [...entry.secondaryCoverageAreas],
      rationale: entry.rationale,
    })),
    change_tracking: {
      versioning_scheme: taxonomyDefinition.changeTracking.versioningScheme,
      update_policy: taxonomyDefinition.changeTracking.updatePolicy,
      version_change_rules: {
        ...taxonomyDefinition.changeTracking.versionChangeRules,
      },
    },
  };
}

function serializeTopicTaxonomyChangeEntry(entry) {
  return {
    version: entry.version,
    change_type: entry.changeType,
    effective_at: entry.effectiveAt,
    summary: entry.summary,
    rationale: entry.rationale,
    taxonomy_changes: [...entry.taxonomyChanges],
  };
}

function loadNewsletterTopicTaxonomyDocument() {
  return JSON.parse(readFileSync(TOPIC_TAXONOMY_DOCUMENT_PATH, "utf8"));
}
