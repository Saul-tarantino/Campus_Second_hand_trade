import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Check } from "typebox/value";
import type { AppConfig } from "../config/index.js";
import type { BusinessReadClient } from "../clients/types.js";
import { AppError } from "../errors/index.js";
import { priceText, type AgentResponse, type ListingSummary, type Recommendation, type SearchFilters, type UserContext } from "../contracts/index.js";
import type { SessionRecord } from "../sessions/store.js";
import { requestModelText } from "./model.js";
import { withTurnSignal } from "./deadline.js";
import { PLAN_PROMPT, SYSTEM_PROMPT } from "./prompts.js";
import { noResultsReply, normalizeReply } from "./reply.js";
import { createAgentTools } from "../tools/index.js";
import { CLARIFICATION_REPLY, HELP_REPLY, REFUSAL_REPLY, UNSUPPORTED_REPLY, TurnPlanSchema, decodeTurnPlan, emptyPlan, mergeSearchFilters, mockTurnPlan, scopeDecision, type TurnPlan } from "./policy.js";

interface SearchDetails {
  kind: "searchListings";
  result: { listings: ListingSummary[]; appliedConditions: { hard: Record<string, unknown>; soft: Record<string, unknown> } };
}
interface DetailDetails { kind: "getListingDetail"; listing: ListingSummary & { version?: string } }

function reasonFor(listing: ListingSummary, search: SearchDetails): string[] {
  const reasons: string[] = [];
  const hard = search.result.appliedConditions.hard;
  const soft = search.result.appliedConditions.soft;
  if (typeof hard.maxPriceCents === "number") reasons.push(`售价 ${priceText(listing.priceCents)}，符合 ${priceText(hard.maxPriceCents)} 以内预算`);
  else if (typeof hard.minPriceCents === "number") reasons.push(`售价 ${priceText(listing.priceCents)}，达到 ${priceText(hard.minPriceCents)} 的最低预算`);
  else reasons.push(`售价 ${priceText(listing.priceCents)}`);
  if (hard.category) reasons.push(`类别为 ${String(hard.category)}`);
  if (hard.condition) reasons.push(`成色达到 ${String(hard.condition)}`);
  if (typeof soft.preferredCampus === "string") reasons.push(listing.campus === soft.preferredCampus ? `取货地点为偏好的${soft.preferredCampus}` : `取货地点为${listing.campus}，未完全匹配偏好的${soft.preferredCampus}`);
  return reasons;
}

export interface ChatServiceOptions {
  config: AppConfig;
  client: BusinessReadClient;
  session: SessionRecord;
  user: UserContext;
  requestId: string;
  log: (event: string, payload: Record<string, unknown>) => void;
}
interface TurnResult {
  response: AgentResponse;
  messages: AgentMessage[];
  filters: SearchFilters;
  displayedListingIds: string[];
  searchPage: number;
}

import { mentionsTransactionAction } from "./policy.js";

/** The model proposes a typed intent; only this service can execute the approved read workflow. */
export async function runAgentTurn(message: string, options: ChatServiceOptions): Promise<TurnResult> {
  const { session, config } = options;
  const signal = AbortSignal.timeout(config.turnTimeoutMs);
  let filters = { ...session.filters };
  let displayedListingIds = [...session.displayedListingIds];
  let searchPage = session.searchPage;
  const finish = (reply: string, status: AgentResponse["status"] = "completed", recommendations: Recommendation[] = []): TurnResult => ({
    response: { requestId: options.requestId, sessionId: session.sessionId, status, reply: normalizeReply(reply), recommendations, relaxedConditions: [] },
    messages: [...session.messages, { role: "user", content: message, timestamp: Date.now() }, fauxAssistantMessage(normalizeReply(reply), { stopReason: "stop" })],
    filters, displayedListingIds, searchPage,
  });
  const earlyScope = scopeDecision(message);
  // A sentence that both mentions a transaction action and asks to find something is still searched.
  const deferRefusal = earlyScope === undefined && mentionsTransactionAction(message);
  let plan: TurnPlan;
  if (earlyScope) plan = emptyPlan(earlyScope);
  else {
    const mockPlan = mockTurnPlan(message, filters, displayedListingIds.length, searchPage);
    const text = await requestModelText(config, PLAN_PROMPT.replace("SCHEMA_PLACEHOLDER", JSON.stringify(TurnPlanSchema)), JSON.stringify({
      message, previousFilters: filters, displayedListingCount: displayedListingIds.length, previousPage: searchPage,
    }), signal, JSON.stringify(mockPlan));
    plan = decodeTurnPlan(text);
  }
  options.log("business_intent", { requestId: options.requestId, action: plan.action });
  switch (plan.action) {
    case "unsupported": return finish(UNSUPPORTED_REPLY);
    case "out_of_scope": return finish(REFUSAL_REPLY);
    case "help": return finish(HELP_REPLY);
    case "clarification": return finish(CLARIFICATION_REPLY, "clarification");
  }

  if (plan.action === "search" || plan.action === "refine") {
    const next = mergeSearchFilters(filters, plan, message);
    // Preserve an incomplete, explicitly stated need, but never query without a topic.
    if (!next.keyword && (!next.category || next.category === "教材")) {
      filters = next;
      return finish("你想找哪一类商品或哪门课的教材？有预算、成色或取货校区偏好也可以一起告诉我。", "clarification");
    }
    if (!Check(TurnPlanSchema.properties.changes, next)) return finish("筛选条件超出支持范围，请重新说明商品和预算。", "clarification");
    if (next.minPriceCents !== undefined && next.maxPriceCents !== undefined && next.minPriceCents > next.maxPriceCents) return finish("最低预算不能高于最高预算，请明确新的价格范围。", "clarification");
    if (plan.action === "refine" && JSON.stringify(next) === JSON.stringify(filters) && !/继续|下一页|换一批|再来/u.test(message)) return finish("请明确要调整的条件，例如新的预算金额、成色或取货校区。", "clarification");
    const explicitPage = message.match(/第\s*(\d+)\s*页/u)?.[1];
    const nextPage = explicitPage ? Number(explicitPage) : /换一批|下一页|再来/u.test(message) ? session.searchPage + 1 : 1;
    if (!Number.isSafeInteger(nextPage) || nextPage < 1 || nextPage > 1000) return finish("页码应在1到1000之间，请重新说明。", "clarification");
    filters = next;
    searchPage = nextPage;
  }

  const targetIds = (plan.action === "detail" || plan.action === "compare")
    ? plan.positions.map((position) => session.displayedListingIds[position - 1]) : [];
  if (plan.action === "detail" || plan.action === "compare") {
    if (targetIds.length === 0 || targetIds.some((id) => !id) || (plan.action === "compare" && targetIds.length < 2)) return finish("请指出上一次展示中的有效商品顺序；比较时至少选择两件商品。", "clarification");
    if (targetIds.length > config.maxToolCalls) return finish(`一次最多读取 ${config.maxToolCalls} 件商品，请缩小比较范围。`, "clarification");
  }
  const tools = createAgentTools({ client: options.client, user: options.user, maxResults: config.maxResults,
    action: plan.action, filters, allowedListingIds: new Set(targetIds.filter((id): id is string => Boolean(id))),
  });
  // Results are local to this call. Historical messages are never scanned for recommendations.
  let search: SearchDetails | undefined;
  const details: DetailDetails[] = [];
  const modelResults: unknown[] = [];
  let calls = 0;
  const execute = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new AppError("TOOL_INPUT_INVALID", "当前意图不允许此工具");
    if (++calls > config.maxToolCalls) throw new AppError("TOOL_LIMIT_EXCEEDED", "已达到本轮工具调用上限");
    signal.throwIfAborted();
    const startedAt = Date.now();
    options.log("tool_start", { requestId: options.requestId, toolName: name, toolCallCount: calls });
    try {
      const result = await withTurnSignal(tool.execute(`call_${calls}`, args, signal), signal);
      signal.throwIfAborted();
      modelResults.push({ toolName: name, content: result.content });
      if (result.details?.kind === "searchListings") search = result.details as SearchDetails;
      if (result.details?.kind === "getListingDetail") details.push(result.details as DetailDetails);
      options.log("tool_end", { requestId: options.requestId, toolName: name, elapsedMs: Date.now() - startedAt, isError: false });
    } catch (error) {
      options.log("tool_end", { requestId: options.requestId, toolName: name, elapsedMs: Date.now() - startedAt, isError: true });
      if (signal.aborted) throw new AppError("AGENT_TIMEOUT", "本轮查询超过时间限制", { retryable: true });
      throw error;
    }
  };
  if (plan.action === "search" || plan.action === "refine") await execute("searchListings", { page: searchPage, pageSize: config.maxResults });
  else if (plan.action === "preference") await execute("getUserPreferences", {});
  else for (const listingId of targetIds) await execute("getListingDetail", { listingId });

  const currentSearch = search as SearchDetails | undefined;
  const recommendations: Recommendation[] = currentSearch
    ? currentSearch.result.listings.map((listing) => ({ listingId: listing.listingId, reasons: reasonFor(listing, currentSearch) }))
    : details.map(({ listing }) => ({ listingId: listing.listingId, reasons: [`已通过只读详情接口重新验证，售价 ${priceText(listing.priceCents)}`] }));
  if (currentSearch) displayedListingIds = currentSearch.result.listings.map((listing) => listing.listingId);
  // Detail/comparison cards also define the display order for the next user reference.
  else if (details.length) displayedListingIds = details.map(({ listing }) => listing.listingId);
  const status = currentSearch && !currentSearch.result.listings.length ? "no_results" : "completed";
  if (status === "no_results") {
    return finish(deferRefusal ? `${noResultsReply(filters)}\n\n${UNSUPPORTED_REPLY}` : noResultsReply(filters), status);
  }
  const mockReply = currentSearch ? `已查询到 ${recommendations.length} 条符合明确条件的商品，商品卡片中的信息均来自平台查询结果。`
    : plan.action === "preference" ? "我已读取当前用户的兴趣偏好，只会把它作为辅助排序信号，不会改变学校权限范围。"
    : plan.action === "compare" ? "我已重新读取指定商品详情，可以从价格、成色、取货校区和描述进行比较；缺失信息会标为未知。"
    : "这是本次指定商品的详情，信息已经通过平台重新验证，未提供的版本或属性会标为未知。";
  const reply = await requestModelText(config, SYSTEM_PROMPT, JSON.stringify({
    action: plan.action, filters, results: modelResults,
  }), signal, mockReply);
  const finalReply = reply ?? mockReply;
  return finish(deferRefusal ? `${finalReply}\n\n${UNSUPPORTED_REPLY}` : finalReply, status, recommendations);
}
