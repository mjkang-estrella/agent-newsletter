export const DEFAULT_DISCOVERY_CONFIG = {
  minAuthorityScore: 55,
  minNewSourceAuthorityScore: 58,
  minSignalScore: 45,
  highSignalItemScore: 60,
  sourceExpertiseRetentionWindowDays: 7,
  sourceExpertiseMaxTrackedItems: 50,
  fetchFailureBackoffBaseMs: 60 * 60 * 1000,
  fetchFailureBackoffMaxMs: 24 * 60 * 60 * 1000,
  probationaryAuthorityWeight: 0.75,
  promotionEvaluationWindowDays: 3,
  probationEvaluationWindowCycles: 3,
  probationMinQualifyingCycles: 3,
  probationPromotionMinScore: 60,
  retirementEvaluationWindowDays: 30,
  retirementLowSignalCycles: 3,
  retirementConsecutiveFetchFailures: 3,
  minimumActiveCategorySources: 2,
  maxExampleUrls: 20,
  maxStoredReferrers: 50,
  ignoredDomains: new Set([
    "t.co",
    "bit.ly",
    "tinyurl.com",
    "lnkd.in",
    "buff.ly",
    "youtube.com",
    "youtu.be"
  ]),
  topicalKeywords: [
    "agent",
    "agents",
    "ai",
    "llm",
    "mcp",
    "tool",
    "tools",
    "library",
    "api",
    "sdk",
    "framework",
    "automation"
  ]
};

export const DEFAULT_SEED_SOURCES = [
  {
    id: "github:domain:github.com",
    kind: "github",
    entityType: "domain",
    platform: "web",
    value: "github.com",
    displayName: "GitHub",
    url: "https://github.com",
    canonicalUrl: "https://github.com",
    fetchUrl: "https://github.com"
  },
  {
    id: "arxiv:domain:arxiv.org",
    kind: "arxiv",
    entityType: "domain",
    platform: "web",
    value: "arxiv.org",
    displayName: "arXiv",
    url: "https://arxiv.org",
    canonicalUrl: "https://arxiv.org",
    fetchUrl: "https://arxiv.org"
  },
  {
    id: "reddit:domain:reddit.com",
    kind: "reddit",
    entityType: "domain",
    platform: "web",
    value: "reddit.com",
    displayName: "Reddit",
    url: "https://reddit.com",
    canonicalUrl: "https://reddit.com",
    fetchUrl: "https://reddit.com"
  }
];
