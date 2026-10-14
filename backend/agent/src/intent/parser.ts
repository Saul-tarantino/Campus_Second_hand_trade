import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ListingCondition, SearchFilters } from "../contracts/index.js";
import { CATEGORY_GROUPS } from "./categories.js";

export type UserIntentKind = "search" | "compare" | "detail" | "transaction" | "preference" | "unknown";

export interface ParsedIntent {
  kind: UserIntentKind;
  filters: SearchFilters;
  hardConditions: SearchFilters;
  softConditions: SearchFilters;
  referencedPositions: number[];
  keywords: string[];
  needsClarification: boolean;
}

const CATEGORY_ALIASES: Array<[string, string[]]> = [
  ["教材", ["教材", "高数", "高等数学", "微积分", "课本", "英语书", "英文书", "英语课本", "英文课本", "book", "textbook"]],
  ["键盘", ["键盘", "机械键盘", "蓝牙键盘"]],
  ["自行车", ["自行车", "单车"]],
  ["显示器", ["显示器", "屏幕"]],
  ["耳机", ["耳机", "降噪"]],
  ["计算器", ["计算器"]],
  ...CATEGORY_GROUPS.filter(group => group.category !== "教材").map(group => [group.category, group.members] as [string, string[]]),
];

const CAMPUS_ALIASES = ["江湾校区", "邯郸校区", "张江校区", "枫林校区", "江湾", "邯郸", "张江", "枫林"];

const KEYWORD_ALIASES = [
  ["数学", "高数", "高等数学", "微积分"],
  ["英语", "英文", "english"],
  ["书", "书籍", "课本", "教材", "book", "books", "textbook", "textbooks"],
  ["键盘", "keyboard"], ["鼠标", "mouse"], ["耳机", "headphone", "headphones", "earphone", "earphones"],
  ["显示器", "monitor"], ["自行车", "单车", "bicycle", "bike"],
  ["线代", "线性代数", "概率论", "概率统计", "数理统计"],
  ["物理", "大学物理", "physics"], ["化学", "chemistry"],
  ["电脑", "笔记本", "笔记本电脑", "laptop", "notebook"], ["手机", "mobile", "phone"],
  ["平板", "平板电脑", "tablet"], ["台灯", "护眼灯"],
  ["充电器", "充电头", "charger"], ["音箱", "音响", "speaker"],
  ["水杯", "保温杯"], ["雨伞", "伞"], ["球拍", "羽毛球拍", "网球拍"],
];

function mentionsAlias(text: string, alias: string): boolean {
  const alternatives = KEYWORD_ALIASES.slice(3).find(group => group.includes(alias)) ?? [alias];
  return alternatives.some(value => /^[a-z ]+$/u.test(value)
    ? new RegExp(`\\b${value}s?\\b`, "iu").test(text)
    : text.includes(value));
}

function canonicalKeyword(text: string): string {
  let result = text.toLowerCase();
  for (const aliases of KEYWORD_ALIASES) {
    for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
      const pattern = /^[a-z]+$/u.test(alias) ? `\\b${alias}\\b` : alias;
      result = result.replace(new RegExp(pattern, "gu"), aliases[0]!);
    }
  }
  return result.replace(/\s+/gu, "");
}

/** Only allow a model translation when it is grounded in known user-mentioned equivalents. */
export function isGroundedKeyword(message: string, keyword: string): boolean {
  const value = keyword.trim();
  if (value.length === 0) return false;
  const normalized = canonicalKeyword(value);
  if (normalized.length > 0 && canonicalKeyword(message).includes(normalized)) return true;
  // Relaxed: a longer wording still counts when it shares a term with the request,
  // e.g. "科学计算器" for "计算器". Unrelated words are still rejected.
  return isPlainProductWord(value) && overlapsMessage(message, value);
}

const GENERIC_WORDS = ["商品", "东西", "物品", "闲置", "二手", "好物", "推荐", "便宜"];

function overlapsMessage(message: string, keyword: string): boolean {
  const value = keyword.toLowerCase();
  const text = message.toLowerCase();
  for (let index = 0; index + 2 <= value.length; index += 1) {
    if (text.includes(value.slice(index, index + 2))) return true;
  }
  return false;
}

function isPlainProductWord(keyword: string): boolean {
  const value = keyword.trim();
  if (value.length === 0 || value.length > 20) return false;
  if (/[\s，,。；;！!？?、:：/\\|()（）\[\]{}<>《》"'“”]/u.test(value)) return false;
  return !GENERIC_WORDS.includes(value);
}

export function hasSearchRequest(message: string): boolean {
  return /找|搜|想买|想要|推荐/u.test(message) || /\b(?:find|search|recommend|looking\s+for)\b/iu.test(message);
}

export function searchKeywordGroups(keyword: string): string[][] {
  const normalized = keyword.toLowerCase().replace(/(英语|英文)(书籍|课本|教材|书)/gu, "$1 $2");
  return normalized.split(/\s+/u).filter(Boolean).slice(0, 8)
    .map(term => KEYWORD_ALIASES.find(aliases => aliases.includes(term)) ?? [term]);
}

function textOf(message: AgentMessage): string | undefined {
  if (message.role !== "user") return undefined;
  return typeof message.content === "string"
    ? message.content
    : message.content.filter((item) => item.type === "text").map((item) => item.text).join(" ");
}

export function userTexts(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) => {
    const text = textOf(message);
    return text ? [text] : [];
  });
}

function normalizeCampus(value: string): string {
  return value.endsWith("校区") ? value : `${value}校区`;
}

function parsePrice(text: string, current: SearchFilters): SearchFilters {
  if (/不限预算|不限制(?:价格|预算)|取消(?:价格|预算)(?:限制|上限)?|预算不限/u.test(text)) {
    const { minPriceCents: _min, maxPriceCents: _max, ...rest } = current;
    return rest;
  }
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:元)?\s*(?:到|至|[-~])\s*(\d+(?:\.\d+)?)\s*元?/u);
  if (range) {
    const first = Math.round(Number(range[1]) * 100);
    const second = Math.round(Number(range[2]) * 100);
    return { ...current, minPriceCents: Math.min(first, second), maxPriceCents: Math.max(first, second) };
  }

  const minimum = text.match(/(?:至少|不低于|最低)\s*(\d+(?:\.\d+)?)\s*元?/u);
  if (minimum) return { ...current, minPriceCents: Math.round(Number(minimum[1]) * 100) };
  const cheaper = text.match(/(?:再|还)?便宜\s*(\d+(?:\.\d+)?)\s*元/u);
  if (cheaper && current.maxPriceCents !== undefined) return { ...current, maxPriceCents: Math.max(0, current.maxPriceCents - Math.round(Number(cheaper[1]) * 100)) };
  const max = text.match(/(?:预算(?:改成|调整为|是)?|不超过|最多|以内|低于|小于)\s*(\d+(?:\.\d+)?)\s*元?/u) ?? text.match(/(\d+(?:\.\d+)?)\s*元?\s*(?:以内|以下|封顶)/u);
  if (max) {
    const { minPriceCents: _minPriceCents, ...withoutMin } = current;
    return { ...withoutMin, maxPriceCents: Math.round(Number(max[1]) * 100) };
  }

  const budget = text.match(/预算(?:改成|调整为|是)?\s*(\d+(?:\.\d+)?)\s*元?/u);
  if (budget) {
    const { minPriceCents: _minPriceCents, ...withoutMin } = current;
    return { ...withoutMin, maxPriceCents: Math.round(Number(budget[1]) * 100) };
  }
  return current;
}

function parseCondition(text: string, current: SearchFilters): SearchFilters {
  if (/不限制成色|不限成色|不看成色|取消成色限制/u.test(text)) {
    const { condition: _condition, ...rest } = current;
    return rest;
  }
  if (/全新|未使用/u.test(text)) return { ...current, condition: "new" };
  const score = text.match(/([七八九十])成新/u)?.[1];
  if (score) {
    const condition: ListingCondition = score === "十" ? "new" : score === "九" ? "like_new" : score === "八" ? "good" : "fair";
    return { ...current, condition };
  }
  return current;
}

function parseTopic(text: string, current: SearchFilters): SearchFilters {
  for (const [category, aliases] of CATEGORY_ALIASES) {
    if (aliases.some((alias) => mentionsAlias(text, alias))) {
      const topicChanged = current.category !== undefined && current.category !== category;
      const base = topicChanged ? {} : current;
      const groupedSubject = CATEGORY_GROUPS.some(group => group.category === category)
        ? aliases.find(alias => alias !== category && mentionsAlias(text, alias)
          && !["生活", "生活用品", "出行", "运动用品"].includes(alias))
        : undefined;
      return {
        ...base,
        category,
        ...(category === "教材" && /高数|高等数学|微积分|英语|英文|线性代数|概率论|数据结构|物理|化学|\benglish\b/iu.test(text)
          ? { keyword: text.match(/高数|高等数学|微积分|英语|英文|线性代数|概率论|数据结构|物理|化学|\benglish\b/iu)![0] }
          : groupedSubject ? { keyword: groupedSubject } : base.keyword ? { keyword: base.keyword } : {}),
      };
    }
  }
  return current;
}

function parseCampus(text: string, current: SearchFilters): { filters: SearchFilters; soft: boolean } {
  if (/不限校区|不限制校区|取消校区限制/u.test(text)) {
    const { campus: _campus, preferredCampus: _preferred, ...rest } = current;
    return { filters: rest, soft: false };
  }
  const found = CAMPUS_ALIASES.find((campus) => text.includes(campus));
  if (!found) return { filters: current, soft: false };
  const campus = normalizeCampus(found);
  if (/最好|优先|方便|希望/u.test(text)) return { filters: { ...current, preferredCampus: campus }, soft: true };
  const { preferredCampus: _preferred, ...hard } = current;
  return { filters: { ...hard, campus }, soft: false };
}

function parseVersion(text: string, current: SearchFilters): SearchFilters {
  if (/不限版本|不限制版本|取消版本限制/u.test(text)) {
    const { version: _version, ...rest } = current;
    return rest;
  }
  const version = text.match(/(同济第[一二三四五六七八九十]+版|第[一二三四五六七八九十]+版|20\d{2}版)/u)?.[1];
  return version ? { ...current, version } : current;
}

function parsePositions(text: string): number[] {
  const positions: number[] = [];
  for (const match of text.matchAll(/第?([一二三四五六七八九十\d]+)个/gu)) {
    const raw = match[1];
    if (!raw) continue;
    positions.push(Number.isNaN(Number(raw)) ? chineseNumber(raw) : Number(raw));
  }
  return positions.filter((position) => position > 0 && position <= 10);
}

function chineseNumber(value: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[value] ?? 0;
}

export function mentionsCategory(text: string, category: string): boolean {
  const aliases = CATEGORY_ALIASES.find(([name]) => name === category)?.[1] ?? [category];
  return aliases.some((alias) => mentionsAlias(text, alias));
}

/** Apply only this user turn to server-owned conditions, never replay catalog text. */
export function parseSearchUpdate(text: string, current: SearchFilters): SearchFilters {
  let filters = parseTopic(text, { ...current });
  filters = parsePrice(text, filters);
  filters = parseCondition(text, filters);
  filters = parseVersion(text, filters);
  return parseCampus(text, filters).filters;
}

export function parseIntent(messages: AgentMessage[]): ParsedIntent {
  const texts = userTexts(messages);
  const latest = texts.at(-1) ?? "";
  let filters: SearchFilters = {};
  let hardConditions: SearchFilters = {};
  let softConditions: SearchFilters = {};

  for (const text of texts) {
    if (/切换|改成|换成/u.test(text) && CATEGORY_ALIASES.some(([, aliases]) => aliases.some((alias) => text.includes(alias)))) {
      filters = parseTopic(text, {});
    } else {
      filters = parseTopic(text, filters);
    }
    filters = parsePrice(text, filters);
    filters = parseCondition(text, filters);
    filters = parseVersion(text, filters);
    const campus = parseCampus(text, filters);
    filters = campus.filters;
    if (campus.soft && filters.preferredCampus) softConditions = { preferredCampus: filters.preferredCampus };
    if (!campus.soft && filters.campus) hardConditions = { campus: filters.campus };
  }

  const kind: UserIntentKind = /直接买|买下来|下单|付款|预约|联系卖家/u.test(latest)
    ? "transaction"
    : /比较|区别|差异|哪个更好|第?[一二三四五六七八九十\d]+个怎么样/u.test(latest)
      ? "compare"
      : /详情|介绍一下|第?[一二三四五六七八九十\d]+个/u.test(latest)
        ? "detail"
        : /偏好|我喜欢|推荐类别/u.test(latest)
          ? "preference"
          : "search";

  if (!filters.category && !filters.keyword) {
    const keyword = latest.replace(/帮我|想找|找|一台|一个|一些|商品|东西/gu, "").trim();
    if (keyword && !/预算|成色|校区|以内|最好|优先|不限制/u.test(keyword)) filters = { ...filters, keyword };
  }
  const hasTopic = Boolean(filters.category || filters.keyword);
  const genericTextbook = filters.category === "教材" && !filters.keyword;
  return {
    kind,
    filters,
    hardConditions,
    softConditions,
    referencedPositions: parsePositions(latest),
    keywords: [filters.keyword, filters.category].filter((item): item is string => Boolean(item)),
    needsClarification: kind === "search" && (!hasTopic || genericTextbook),
  };
}

export function intentToToolInput(intent: ParsedIntent): Record<string, unknown> {
  const { filters } = intent;
  return {
    ...(filters.keyword ? { keyword: filters.keyword } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.minPriceCents !== undefined ? { minPriceCents: filters.minPriceCents } : {}),
    ...(filters.maxPriceCents !== undefined ? { maxPriceCents: filters.maxPriceCents } : {}),
    ...(filters.campus ? { campus: filters.campus } : {}),
    ...(filters.preferredCampus ? { preferredCampus: filters.preferredCampus } : {}),
    ...(filters.condition ? { condition: filters.condition } : {}),
    ...(filters.version ? { version: filters.version } : {}),
    page: 1,
    pageSize: 10,
  };
}
