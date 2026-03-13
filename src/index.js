export {
  ContentFetcherCore,
  DEFAULT_FETCH_WINDOW_HOURS,
  DEFAULT_FETCH_WINDOW_TIMEZONE,
  createFetchOrchestrationPlan,
  createFetchWindow,
  createSourceFetchResult,
} from "./core/content-fetcher.js";
export {
  CONTENT_CATEGORIES,
  DISAGREEMENT_DIMENSIONS,
  RISK_WARNING_DIMENSIONS,
  RISK_SEVERITIES,
  SCORE_INTERPRETATIONS,
  SENTIMENT_SPREADS,
  SOURCE_KINDS,
  STORYLINE_STATUSES,
} from "./core/contracts.js";
export {
  createSourceRegistry,
  DEFAULT_SOURCE_DESCRIPTORS,
  SourceRegistry,
  defineSourceAdapter,
} from "./core/adapters.js";
export {
  consolidateMatchedItems,
  createDefaultDeduplicationHooks,
  deduplicateItems,
  groupDuplicateItems,
} from "./core/dedupe.js";
export { AggregationPipeline } from "./core/pipeline.js";
export {
  STORYLINE_RELATIONSHIP_DECISIONS,
  annotateStorylineRelationship,
  buildHistoricalStorylineMap,
  classifyStorylineRelationship,
} from "./core/storyline-classifier.js";
export {
  ENTITY_RESOLUTION_MATCH_KINDS,
  annotateItemIdentitySignals,
  buildStableItemId,
  buildItemIdentitySignals,
  itemsShareCanonicalIdentity,
  itemsShareIdentity,
  resolveEntityIdentityMatch,
  resolveDuplicateCategoryGroup,
} from "./core/item-identity.js";
export { ItemResolutionService } from "./core/item-resolution.js";
export {
  CURRENT_RELEVANCE_SCORE_HISTORY_DOCUMENT,
  RELEVANCE_SCORE_CHANGE_TYPES,
  createRelevanceScoreHistoryDocument,
} from "./core/relevance-score-history.js";
export {
  CURRENT_RELEVANCE_SCORE_VERSION_ENTRY,
  createRelevanceScoreBreakdown,
  compareCuratedItemsByRelevance,
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RELEVANCE_SCORE_INTERPRETATION,
  DEFAULT_RELEVANCE_SCORE_RANGE,
  DEFAULT_RELEVANCE_SCORE_VERSION,
  DEFAULT_RELEVANCE_SCORING_CONFIG,
  DEFAULT_RELEVANCE_SIGNAL_CONFIG,
  getRelevanceScoreVersionHistoryEntry,
  createWeightedRelevanceScorer,
  extractRelevanceSignalInputs,
  filterCuratedItemsByRelevance,
  hasHighSentimentDivergence,
  normalizeRelevanceSignalInputs,
  normalizeRelevanceSignals,
  RELEVANCE_SCORE_VERSION_HISTORY,
  resolveRelevanceScoringConfig,
  scoreGitHubActivitySignal,
  scoreGitHubSignal,
  scoreGitHubStarsSignal,
  scoreItemRelevance,
  scoreMentionFrequencySignal,
  scoreNormalizedSignals,
  scoreRecencySignal,
  scoreSocialEngagementSignal,
  scoreSourceAuthoritySignal,
  sortCuratedItemsByRelevance,
} from "./core/relevance-scoring.js";
export {
  createDiscoveredSource,
  createNormalizedItem,
  createNormalizedItemFromSourceRecord,
  createSourceDescriptor,
  normalizeRiskWarning,
  normalizeScoringSignals,
} from "./core/schema.js";
export {
  createDefaultNewsletterApiHandler,
  createDefaultNewsletterApiServer,
  createNewsletterApiHandler,
  createNewsletterApiServer,
  formatNewsletterCoverageMapResponse,
  formatNewsletterExclusionReportResponse,
  formatNewsletterScopeDefinitionResponse,
  formatNewsletterStorylinesResponse,
  serializeNewsletterEdition,
  serializeNewsletterItem,
  serializeNewsletterItemLifecycle,
  serializeNewsletterStorylineGroup,
} from "./newsletter/api.js";
export {
  CURRENT_NEWSLETTER_SCOPE_DEFINITION,
  DEFAULT_SCOPE_REVIEW_CADENCE,
  DEFAULT_SCOPE_VERSIONING_SCHEME,
  SCOPE_CHANGE_TYPES,
  SCOPE_REVIEW_CADENCES,
  SCOPE_VERSIONING_SCHEMES,
  SCOPE_VERSION_CHANGE_RULES,
  createNewsletterScopeDefinition,
} from "./newsletter/scope-definition.js";
export {
  CURRENT_NEWSLETTER_TOPIC_TAXONOMY,
  DEFAULT_TOPIC_TAXONOMY_REVIEW_CADENCE,
  DEFAULT_TOPIC_TAXONOMY_VERSIONING_SCHEME,
  TOPIC_TAXONOMY_CHANGE_TYPES,
  TOPIC_TAXONOMY_VERSION_CHANGE_RULES,
  createNewsletterTopicTaxonomy,
  formatNewsletterTopicTaxonomyResponse,
  resolveCoverageAreasForSource,
} from "./newsletter/topic-taxonomy.js";
export {
  DEFAULT_ANONYMOUS_CONSUMER_ID,
  createConsumerTracker,
  createInMemoryConsumerTrackingStore,
  resolveConsumerId,
} from "./newsletter/consumer-tracking.js";
export {
  ConsumerIdentityService,
  DEFAULT_CONSUMER_ID_HEADERS,
  resolveConsumerRequestIdentity,
} from "./newsletter/consumer-identity-service.js";
export {
  CLIENT_IP_SOURCES,
  CONSUMER_IDENTITY_SOURCES,
  ConsumerIdentityRepository,
  normalizeConsumerIdentityRecord,
  normalizeConsumerRequestActivityEntry,
  normalizeConsumerIdentitySnapshot,
  normalizeObservedClientIp,
} from "./newsletter/consumer-identity-repository.js";
export {
  API_RATE_LIMIT_MAX_REQUESTS_ENV_NAME,
  API_RATE_LIMIT_TRUST_PROXY_ENV_NAME,
  API_RATE_LIMIT_WINDOW_MS_ENV_NAME,
  DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  createIpRateLimiter,
  resolveRateLimitConfigFromEnv,
  resolveClientIp,
  resolveClientIpMetadata,
} from "./newsletter/rate-limit.js";
export { NewsletterEditionRepository } from "./newsletter/edition-repository.js";
export { NewsletterEditionStore } from "./newsletter/edition-store.js";
export {
  ItemIdentityRepository,
  createItemIdentityRecord,
  normalizeItemIdentitySnapshot,
} from "./newsletter/item-identity-repository.js";
export {
  DEFAULT_REFERENCE_MINIMUM_CATEGORY_ITEM_COUNT,
  DEFAULT_REFERENCE_MINIMUM_EDITION_COUNT,
  DEFAULT_REFERENCE_MINIMUM_SOURCE_CLUSTER_COUNT,
  DEFAULT_REFERENCE_RELAXED_SOURCE_CLUSTER_COUNT,
  selectReferenceItemsFromEditions,
} from "./newsletter/reference-index.js";
export {
  DEFAULT_PUBLICATION_BASE_TIMEZONE,
  DEFAULT_PUBLICATION_SCHEDULE,
  NEWSLETTER_BASE_TIMEZONE_ENV_NAME,
  createPublicationSchedule,
  createPublicationScheduler,
  getNextPublicationTime,
  resolvePublicationBaseTimezoneFromEnv,
  resolvePublicationScheduleFromEnv,
  resolvePublicationScheduleFromRuntimeConfig,
} from "./newsletter/publication-schedule.js";
export {
  DEFAULT_CONSUMER_IDENTITY_REGISTRY_FILE_NAME,
  DEFAULT_ITEM_IDENTITY_REGISTRY_FILE_NAME,
  DEFAULT_EDITIONS_DIRECTORY_NAME,
  DEFAULT_PUBLICATION_DATA_DIRECTORY,
  DEFAULT_PUBLICATION_TASK_MODULE_PATH,
  DEFAULT_SOURCE_REGISTRY_FILE_NAME,
  NEWSLETTER_DATA_DIR_ENV_NAME,
  createDefaultPublicationTask,
  publishNewsletterEdition,
  resolvePublicationRuntimePaths,
} from "./newsletter/default-publication-task.js";
export {
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  createEditionWindow,
  createNewsletterEdition,
} from "./newsletter/schema.js";
export {
  EDITION_EXCLUSION_REASON_CODES,
} from "./newsletter/exclusion-summary.js";
export {
  DEFAULT_PUBLICATION_HOUR,
  DEFAULT_PUBLICATION_TIMEZONE,
  PUBLICATION_TIMEZONE_ENV_NAME,
  createPublicationConfig,
  createPublicationFlow,
  createPublicationPlan,
} from "./newsletter/publication-flow.js";
export { createNewsletterRuntimeConfig } from "./newsletter/runtime-config.js";
export { runPublicationOnce } from "./newsletter/publish-newsletter-edition.js";
export {
  DEFAULT_SCHEDULED_PUBLICATION_GRACE_MINUTES,
  FORCE_PUBLICATION_ENV_NAME,
  SCHEDULED_PUBLICATION_GRACE_MINUTES_ENV_NAME,
  resolveForcedPublicationFromEnv,
  resolveScheduledPublicationGraceMinutesFromEnv,
  runScheduledPublication,
  shouldPublishScheduledEdition,
} from "./newsletter/run-scheduled-publication.js";
export {
  applyStorylineMembership,
  buildEditionStorylines,
  buildStorylineMembershipSnapshot,
  buildTrackedStorylineStatesFromEditions,
  createStoryline,
  resolveStorylineId,
} from "./newsletter/storyline.js";
export {
  DEFAULT_STORYLINE_LIFECYCLE_CONFIG,
  advanceStorylineLifecycle,
} from "./newsletter/storyline-lifecycle.js";
export {
  NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA,
  NEWSLETTER_ITEM_RESPONSE_SCHEMA_VERSION,
  REQUIRED_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  SUPPLEMENTAL_NEWSLETTER_ITEM_API_RESPONSE_FIELDS,
  assertNewsletterItemApiResponse,
  resolveNewsletterItemStorylineIds,
  formatNewsletterEditionResponse,
  formatNewsletterArchiveResponse,
  formatNewsletterItemResponse,
  formatNewsletterItemLifecycleResponse,
} from "./newsletter/edition.js";
export {
  EXCLUSION_PHASES,
  EXCLUSION_REASONS,
  buildNewsletterExclusionAnalytics,
  createEditionExclusion,
  formatNewsletterExclusionAnalyticsResponse,
} from "./newsletter/exclusion-analytics.js";
export {
  buildEditionExclusionSummary,
  buildNewsletterExclusionSummaryResult,
  createEditionExclusionSummary,
  createNewsletterExclusionSummaryResult,
  formatNewsletterExclusionSummaryResponse,
} from "./newsletter/exclusion-summary.js";
export {
  buildNewsletterExclusionReport,
} from "./newsletter/exclusion-report.js";
export { selectActiveStorylinesFromEditions } from "./newsletter/storyline-index.js";
export { DEFAULT_DISCOVERY_CONFIG, DEFAULT_SEED_SOURCES } from "./discovery/config.js";
export {
  SOURCE_COVERAGE_STATUSES,
  buildSourceCoverageMap,
  countActiveSourcesByCategory,
  countActiveSourcesByTopicArea,
  isActiveSourceForCoverage,
  normalizeCategoryCoverage,
  resolveMinimumActiveCategorySources,
  resolveSourceCoverageStatus,
} from "./discovery/source-coverage.js";
export {
  createDefaultSourceDiscoveryTask,
  discoverNewsletterSources,
} from "./discovery/default-source-discovery-task.js";
export { evaluateLowSignalSources } from "./discovery/low-signal-evaluator.js";
export { runSourceDiscoveryWorker } from "./discovery/run-source-discovery-worker.js";
export { SourceDiscoveryService } from "./discovery/source-discovery-service.js";
export {
  SourceRepository,
  normalizeSourceRepositorySnapshot,
} from "./discovery/source-repository.js";
export { buildSourceCandidate, extractOutboundLinks } from "./discovery/link-extractor.js";
export { scoreAuthority, scoreSignal, scoreSource } from "./discovery/scoring.js";
export {
  SOURCE_LIFECYCLE_STATES,
  SOURCE_LIFECYCLE_STAGES,
  SOURCE_RETIREMENT_REASONS,
  SOURCE_RESTORE_REASONS,
  activateSource,
  evaluateSourcePerformanceRetirement,
  evaluateSourcePromotion,
  ensureSourceLifecycle,
  ensureSourcePerformance,
  isSourceFetchEligible,
  markSourceCandidate,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  normalizeSourceLifecycle,
  normalizeSourcePerformance,
  recordSourceLowSignalCycle,
  recordSourcePromotionObservation,
  recordSourceSignalObservation,
  retireSource,
  restoreSource,
  resolveSourceFetchBackoffMs,
  resolveSourceLifecycleState,
  resolveSourcePerformanceRetirementRequirements,
  resolveSourcePromotionRequirements,
  resolveSourceRetirementRequirements,
  startSourceProbation,
} from "./discovery/source-lifecycle.js";
export {
  evaluateSourceAuthority,
  evaluateSourceAuthorityBootstrap,
  finalizeSourceExpertiseSignal,
  isNewSource,
  recordSourceExpertiseObservation,
  resolveMinimumAuthorityScore,
  resolveSourceAuthorityWeight,
  resolveWeightedSourceAuthorityScore,
  scoreSourceAuthorityBootstrap,
  scoreSourceAuthority,
  summarizeSourceExpertiseRetentionSignal,
} from "./discovery/source-authority.js";
export {
  ArxivSourceAdapter,
  DEFAULT_ARXIV_BASE_URL,
  DEFAULT_ARXIV_CATEGORIES,
  DEFAULT_ARXIV_MAX_RESULTS,
  DEFAULT_ARXIV_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_ARXIV_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_ARXIV_USER_AGENT,
  DEFAULT_ARXIV_AGENT_TERMS,
} from "./sources/arxiv-source-adapter.js";
export {
  DEFAULT_GITHUB_API_BASE_URL,
  DEFAULT_GITHUB_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_GITHUB_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_GITHUB_SEARCH_TERMS,
  DEFAULT_GITHUB_TRENDING_SINCE,
  DEFAULT_GITHUB_WEB_BASE_URL,
  GitHubSourceAdapter,
} from "./sources/github-source-adapter.js";
export {
  DEFAULT_AGENT_SUBREDDITS,
  DEFAULT_REDDIT_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_REDDIT_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_REDDIT_USER_AGENT,
  RedditSourceAdapter,
} from "./sources/reddit-source-adapter.js";
export {
  DEFAULT_TWITTER_ADAPTER_ID,
  DEFAULT_TWITTER_ADAPTER_NAME,
  DEFAULT_TWITTER_BASE_URL,
  DEFAULT_TWITTER_MAX_RESULTS,
  DEFAULT_TWITTER_PROVIDER,
  DEFAULT_TWITTER_QUERY,
  TwitterSourceAdapter,
} from "./sources/twitter-source-adapter.js";
export {
  TWITTER_PROVIDER_INTERFACE_VERSION,
  DEFAULT_TWITTER_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_TWITTER_RATE_LIMIT_RETRY_AFTER_MS,
  DEFAULT_TWITTER_USER_AGENT,
  buildTwitterRequestPlan,
  createDefaultTwitterProviderClient,
  createStubTwitterProviderClient,
  createTwitterApiV2ProviderClient,
  createTwitterProviderConfig,
  createTwitterProviderContract,
  createTwitterProviderHooks,
  createTwitterProviderRequestContext,
  ensureTwitterProviderClient,
  getTwitterCredentialStatus,
  normalizeTwitterProviderResponse,
  resolveTwitterProviderClient,
  validateTwitterProviderConfig,
} from "./sources/twitter-provider-client.js";
export {
  DEFAULT_WEB_DISCOVERY_MAX_SOURCES,
  DEFAULT_WEB_DISCOVERY_TIMEOUT_MS,
  DEFAULT_WEB_DISCOVERY_USER_AGENT,
  WebDiscoverySourceAdapter,
} from "./sources/web-discovery-source-adapter.js";
export {
  DEFAULT_SOURCE_CONNECTOR_DEFINITIONS,
  createSourceAdapterConfigs,
  createSourceAdapters,
  defineSourceConnector,
} from "./sources/create-source-adapters.js";
export {
  CRON_SECRET_ENV_NAME,
  ITEM_IDENTITY_REGISTRY_STATE_KEY,
  SOURCE_REGISTRY_STATE_KEY,
  SUPABASE_SECRET_KEY_ENV_NAME,
  SUPABASE_SERVICE_ROLE_KEY_ENV_NAME,
  SUPABASE_URL_ENV_NAME,
} from "./supabase/shared.js";
export { createSupabaseAdminClient } from "./supabase/client.js";
export {
  InMemorySupabaseNewsletterDataStore,
  SupabaseNewsletterDataStore,
} from "./supabase/data-store.js";
export { SupabaseNewsletterEditionStore } from "./supabase/edition-store.js";
export { SupabaseSourceRepository } from "./supabase/source-repository.js";
export { SupabaseItemIdentityRepository } from "./supabase/item-identity-repository.js";
export { SupabasePublicationRunRepository } from "./supabase/publication-runs.js";
export { createSupabaseConsumerTracker } from "./supabase/consumer-tracking.js";
export { createSupabaseRateLimiter } from "./supabase/rate-limit.js";
export {
  createInMemorySupabaseRuntime,
  createSupabaseApiEnv,
  createSupabaseNewsletterApiHandler,
  createSupabasePublicationRequestHandler,
  createSupabasePublicationTask,
  createSupabaseRuntimeEnv,
  resolveSupabaseDataStore,
} from "./supabase/runtime.js";
