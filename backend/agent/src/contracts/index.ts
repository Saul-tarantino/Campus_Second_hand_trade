export type AgentStatus = "completed" | "clarification" | "no_results";

export interface AgentRequest {
  requestId: string;
  sessionId: string | null;
  message: string;
  state?: AgentSessionState;
}

/** Enough state to continue a conversation the Agent no longer holds in memory. */
export interface AgentSessionState {
  filters: SearchFilters;
  displayedListingIds: string[];
  searchPage: number;
}

export interface UserContext {
  userId: string;
  schoolId: string;
}

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "unknown";

export interface ListingSummary {
  listingId: string;
  title: string;
  category: string;
  priceCents: number;
  condition: ListingCondition;
  campus: string;
  description: string;
  imageUrl?: string;
  status: "active";
  schoolId: string;
}

export interface ListingDetail extends ListingSummary {
  sellerLabel: string;
  version?: string;
  publishedAt: string;
}

export interface SearchFilters {
  keyword?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  campus?: string;
  preferredCampus?: string;
  condition?: ListingCondition;
  version?: string;
}

export interface SearchListingsInput extends SearchFilters {
  page?: number;
  pageSize?: number;
}

export interface AppliedConditions {
  hard: SearchFilters;
  soft: SearchFilters;
}

export interface SearchListingsResult {
  listings: ListingSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  appliedConditions: AppliedConditions;
  source: "mock" | "business_backend";
}

export interface UserPreferences {
  favoriteCategories: string[];
  preferredCampuses: string[];
  priceCeilingCents?: number;
  source: "mock" | "business_backend";
}

export interface Recommendation {
  listingId: string;
  reasons: string[];
}

export interface AgentResponse {
  requestId: string;
  sessionId: string;
  status: AgentStatus;
  reply: string;
  recommendations: Recommendation[];
  relaxedConditions: string[];
  state?: AgentSessionState;
}

export interface ErrorResponse {
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export const PRICE_MIN_CENTS = 0;
export const PRICE_MAX_CENTS = 10_000_000;
export const LISTING_ID_PATTERN = /^listing_[a-z0-9_-]{1,64}$/;

export function priceText(priceCents: number): string {
  return `${(priceCents / 100).toFixed(2).replace(/\.00$/, "")} 元`;
}

export function listingToModelView(listing: ListingSummary | ListingDetail): Record<string, unknown> {
  return {
    listingId: listing.listingId,
    title: listing.title,
    category: listing.category,
    priceCents: listing.priceCents,
    price: priceText(listing.priceCents),
    condition: listing.condition,
    campus: listing.campus,
    description: listing.description,
    ...(listing.imageUrl ? { imageUrl: listing.imageUrl } : {}),
    ...("version" in listing && listing.version ? { version: listing.version } : {}),
  };
}

export function isListingId(value: string): boolean {
  return LISTING_ID_PATTERN.test(value);
}

export function isListingSummary(value: unknown): value is ListingSummary {
  if (!value || typeof value !== "object") return false;
  const listing = value as Partial<ListingSummary>;
  return (
    typeof listing.listingId === "string" &&
    isListingId(listing.listingId) &&
    typeof listing.title === "string" &&
    typeof listing.category === "string" &&
    typeof listing.priceCents === "number" &&
    Number.isInteger(listing.priceCents) &&
    listing.priceCents >= PRICE_MIN_CENTS &&
    typeof listing.condition === "string" &&
    typeof listing.campus === "string" &&
    typeof listing.description === "string" &&
    listing.status === "active" &&
    typeof listing.schoolId === "string"
  );
}
