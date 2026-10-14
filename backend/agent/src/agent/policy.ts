import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { PRICE_MAX_CENTS, type SearchFilters } from "../contracts/index.js";
import { hasSearchRequest, isGroundedKeyword, mentionsCategory, parseIntent, parseSearchUpdate } from "../intent/parser.js";
import { CATEGORY_GROUPS } from "../intent/categories.js";

const nullableText = (maxLength: number) => Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength }), Type.Null()]));
const nullablePrice = Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: PRICE_MAX_CENTS }), Type.Null()]));
export const TurnPlanSchema = Type.Object({
  action: Type.Union([Type.Literal("search"), Type.Literal("refine"), Type.Literal("detail"), Type.Literal("compare"), Type.Literal("preference"), Type.Literal("help"), Type.Literal("out_of_scope"), Type.Literal("unsupported"), Type.Literal("clarification")]),
  changes: Type.Object({
    keyword: nullableText(100), category: nullableText(40),
    minPriceCents: nullablePrice, maxPriceCents: nullablePrice,
    campus: nullableText(40), preferredCampus: nullableText(40),
    condition: Type.Optional(Type.Union([Type.Literal("new"), Type.Literal("like_new"), Type.Literal("good"), Type.Literal("fair"), Type.Literal("unknown"), Type.Null()])),
    version: nullableText(80),
  }, { additionalProperties: false }),
  positions: Type.Array(Type.Integer({ minimum: 1, maximum: 10 }), { maxItems: 10, uniqueItems: true }),
  page: Type.Integer({ minimum: 1, maximum: 1000 }),
}, { additionalProperties: false });

export type TurnPlan = Static<typeof TurnPlanSchema>;
export type BusinessAction = "search" | "refine" | "detail" | "compare" | "preference" | "help" | "out_of_scope" | "unsupported" | "clarification";
export const CLARIFICATION_REPLY = "请告诉我想找的商品、预算或校区；查看和比较商品时，请指出本次展示的商品编号顺序。";
export const REFUSAL_REPLY = "我只能帮你查找、筛选、查看和比较本校二手商品。";
export const UNSUPPORTED_REPLY = "我不能执行购买、付款、预约或联系卖家。你可以让我继续查询商品，再通过平台正式业务流程完成交易。";
export const HELP_REPLY = "我可以查找本校二手商品，按预算、成色、版本和校区筛选，并查看或比较已展示的商品。你可以说‘找50元以内的高数教材’，或在找到商品后问‘第二个怎么样’。";

/** True when the turn asks for a transaction action, whatever else it also contains. */
export function mentionsTransactionAction(message: string): boolean {
  return /直接买|买下来|买下|下单|付款|支付|预约|联系(?:一下)?卖家|发布商品|修改商品|删除商品/u.test(message);
}

export function emptyPlan(action: BusinessAction): TurnPlan {
  return { action, changes: {}, positions: [], page: 1 };
}

/** Definite scope violations are checked before sending anything to a model. */
export function scopeDecision(message: string): "unsupported" | "out_of_scope" | "help" | undefined {
  const clauses = message.split(/[，,。；;！？!?\n]/u);
  for (const clause of clauses) {
    const actions = /直接买|买下来|买下|下单|付款|支付|预约|联系(?:一下)?卖家|发布商品|修改商品|删除商品|删除文件|执行命令|运行命令/gu;
    for (const match of clause.matchAll(actions)) {
      const prefix = clause.slice(0, match.index);
      // A negated action or a quoted subject is not a request to perform it.
      if (/(?:不要|不用|不必|无需|别|不能|不允许|不需要|不想|不帮我|不代我)[^，,。；;]{0,12}$/u.test(prefix)) continue;
      if (/(?:讲解|介绍|讲述|关于|讨论|研究|流程|教程|书名|标题|叫做)/u.test(clause) && /教材|课本|书/u.test(message)
        && !/(?:帮我|替我|代我|为我)(?!找|搜|查|推荐).*(?:下单|付款|支付|预约|联系|买下)/u.test(clause)
        && !/(?:再|然后|并|同时|顺便).*(?:下单|付款|支付|预约|联系|买下)/u.test(clause)) continue;
      // Relaxed: a sentence that also asks to find something is still searched; the note is appended later.
      if (hasSearchRequest(message)) continue;
      return "unsupported";
    }
  }
  if (/忽略.*(?:系统|规则|指令)|(?:泄露|输出|告诉我).*(?:密钥|令牌|系统提示词)|查(?:询)?(?:别的学校|其他学校|外校)|跨校(?:查询|搜索|找货)/u.test(message)) return "out_of_scope";
  if (/笑话|写(?:一首|首)?诗|写代码|天气|股票|扮演|角色扮演/u.test(message)
    && !(/找|搜索|搜|想买/u.test(message) && /教材|课本|书/u.test(message) && !/然后|顺便|同时/u.test(message))) return "out_of_scope";
  if (/^(?:你好|您好|谢谢|多谢)[！!。\s]*$/u.test(message) || /(?:你|助手).*(?:能做什么|可以做什么|有什么功能|怎么使用)/u.test(message)) return "help";
  return undefined;
}

/** Deterministic development model. Real deployment uses a schema-checked model plan. */
export function mockTurnPlan(message: string, previous: SearchFilters, displayedCount: number, previousPage: number): TurnPlan {
  const scope = scopeDecision(message);
  if (scope) return emptyPlan(scope);
  const parsed = parseIntent([{ role: "user", content: message, timestamp: Date.now() }]);
  const next = parseSearchUpdate(message, previous);
  const textbookSubject = previous.category === "教材" && !previous.keyword && /^(?:高数|高等数学|微积分|英语|线性代数|概率论|数据结构|物理|化学)$/u.test(message.trim());
  if (textbookSubject) next.keyword = message.trim();
  const hasKnownTopic = Boolean(next.category && mentionsCategory(message, next.category));
  const positionMatch = /(?:第?[一二三四五六七八九十\d]+个|这两个|这几(?:个|件)|它们)/u.test(message);
  if ((parsed.kind === "compare" || parsed.kind === "detail") && (positionMatch || /详情|比较|区别|差异/u.test(message))) {
    const action = parsed.referencedPositions.length === 1 && !/比较|区别|差异/u.test(message) ? "detail" : parsed.kind;
    const positions = parsed.referencedPositions.length ? [...new Set(parsed.referencedPositions)]
      : action === "compare" && /这两个/u.test(message) && displayedCount === 2 ? [1, 2]
      : action === "detail" && displayedCount === 1 ? [1] : [];
    return { ...emptyPlan(action), positions };
  }
  if (parsed.kind === "preference") return emptyPlan("preference");
  const explicitSearch = hasSearchRequest(message);
  const refinement = textbookSubject || /预算|价格|便宜|贵一点|成色|校区|版本|以内|以下|以上|九成新|八成新|七成新|全新|不限|放宽|换一批|下一页|再来|继续/u.test(message);
  if (!hasKnownTopic && !explicitSearch && !refinement) return emptyPlan("out_of_scope");
  if (refinement && !hasKnownTopic && !explicitSearch && !previous.category && !previous.keyword) return emptyPlan("clarification");
  if (explicitSearch && !hasKnownTopic) {
    const keyword = message.replace(/^(?:请|帮我|给我|我|想|要|找|搜索|搜|买|推荐|一台|一个|一本|一件|一些|想买|想要|想找|一下|商品|东西|\s)+/gu, "").trim();
    if (!keyword || /^(?:商品|东西|二手商品|二手东西)$/u.test(keyword)) return emptyPlan("clarification");
    next.keyword = keyword;
    delete next.category;
  }
  const changes: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const key = field as keyof SearchFilters;
    if (previous[key] !== next[key]) changes[key] = next[key] ?? null;
  }
  const action = hasKnownTopic || explicitSearch ? "search" : "refine";
  return decodeTurnPlan(JSON.stringify({ action, changes, positions: [], page: /换一批|下一页|再来/u.test(message) ? previousPage + 1 : 1 }));
}

export function decodeTurnPlan(text: string | undefined): TurnPlan {
  if (!text) return emptyPlan("clarification");
  try {
    const value: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, ""));
    return Check(TurnPlanSchema, value) ? value : emptyPlan("clarification");
  } catch { return emptyPlan("clarification"); }
}

/** Merge a delta, never accept a model-generated replacement of the entire state. */
export function mergeSearchFilters(previous: SearchFilters, plan: TurnPlan, message: string): SearchFilters {
  const changes = { ...plan.changes };
  const explicitlyParsed = parseSearchUpdate(message, previous);
  // Price edits and removals must be grounded in this user turn, not model/catalog suggestions.
  const cancelPrice = /不限预算|不限制(?:价格|预算)|取消(?:价格|预算)(?:限制|上限)?|预算不限/u.test(message);
  const priceMentioned = cancelPrice || (/预算|价格|\d+(?:\.\d+)?\s*元|便宜|贵|以内|以下|以上|不超过|至少|最低|最多/u.test(message) && /\d|[一二三四五六七八九十百千万两零]+\s*元/u.test(message));
  if (!priceMentioned) { delete changes.minPriceCents; delete changes.maxPriceCents; }
  if (!cancelPrice) {
    if (changes.minPriceCents === null && !/预算|以内|以下|不超过|最多/u.test(message)) delete changes.minPriceCents;
    if (changes.maxPriceCents === null) delete changes.maxPriceCents;
  }
  if (changes.condition === null && !/不限制成色|不限成色|不看成色|取消成色限制/u.test(message)) delete changes.condition;
  if (changes.version === null && !/不限版本|不限制版本|取消版本限制/u.test(message)) delete changes.version;
  if (changes.campus === null && !/不限校区|不限制校区|取消校区限制/u.test(message)) delete changes.campus;
  if (changes.preferredCampus === null && !/不限校区|不限制校区|取消校区限制|只要|必须/u.test(message)) delete changes.preferredCampus;
  const recognizedTopic = parseSearchUpdate(message, {});
  const newUnclassifiedTopic = !recognizedTopic.category && plan.action === "search" && typeof changes.keyword === "string" && hasSearchRequest(message) && isGroundedKeyword(message, changes.keyword);
  if (changes.category === null && !/不限类别|取消类别|换成|改找|切换|改成/u.test(message) && !newUnclassifiedTopic) delete changes.category;
  if (changes.keyword === null && !/取消关键词|不限关键词|换成|改找|切换|改成/u.test(message)) delete changes.keyword;
  if (typeof changes.keyword === "string" && !isGroundedKeyword(message, changes.keyword)) delete changes.keyword;
  if (typeof changes.version === "string" && !message.includes(changes.version)) delete changes.version;
  for (const key of ["campus", "preferredCampus"] as const) {
    const campus = changes[key];
    if (typeof campus === "string" && !message.includes(campus.replace(/校区$/u, ""))) delete changes[key];
  }
  if (typeof changes.condition === "string" && !/成色|成新|全新|未使用/u.test(message)) delete changes.condition;
  const newCategory = typeof changes.category === "string" ? changes.category : undefined;
  if (newCategory && !mentionsCategory(message, newCategory)) delete changes.category;
  const targetGroup = CATEGORY_GROUPS.find(group => group.category === changes.category);
  const concreteSubject = recognizedTopic.keyword ?? recognizedTopic.category;
  if (plan.action === "search" && targetGroup && !changes.keyword && concreteSubject
    && concreteSubject !== targetGroup.category && isGroundedKeyword(message, concreteSubject)) {
    changes.keyword = concreteSubject;
  }
  const nextGroup = CATEGORY_GROUPS.find(group => group.members.includes(changes.category ?? ""));
  const sameConcreteTopic = nextGroup?.members.includes(previous.category ?? "")
    && (recognizedTopic.category === previous.category || previous.category === nextGroup?.category);
  const topicChanged = (typeof changes.category === "string" && previous.category !== undefined && previous.category !== changes.category && !sameConcreteTopic)
    || (newUnclassifiedTopic && changes.category === null && previous.category !== undefined)
    || (plan.action === "search" && typeof changes.keyword === "string" && previous.keyword !== changes.keyword && /换成|改找|切换|改成|换找/u.test(message));
  const filters: SearchFilters = topicChanged ? {} : { ...previous };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete filters[key as keyof SearchFilters];
    else Object.assign(filters, { [key]: value });
  }
  // Numeric bounds recognized by the parser take precedence over proposed model values.
  if (priceMentioned) {
    const numericUpdate = parseSearchUpdate(message, {});
    for (const key of ["minPriceCents", "maxPriceCents"] as const) {
      if (numericUpdate[key] !== undefined) filters[key] = numericUpdate[key];
      else if (explicitlyParsed[key] !== previous[key] || cancelPrice) {
        if (explicitlyParsed[key] === undefined) delete filters[key];
        else filters[key] = explicitlyParsed[key];
      }
    }
  }
  return filters;
}

export function allowedToolNames(action: BusinessAction): string[] {
  switch (action) {
    case "search": case "refine": return ["searchListings"];
    case "detail": case "compare": return ["getListingDetail"];
    case "preference": return ["getUserPreferences"];
    default: return [];
  }
}
