import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentResponse, AgentSessionState, SearchFilters, UserContext } from "../contracts/index.js";
import { AppError } from "../errors/index.js";

export interface SessionRecord {
  sessionId: string;
  owner: UserContext;
  messages: AgentMessage[];
  filters: SearchFilters;
  displayedListingIds: string[];
  searchPage: number;
  createdAt: number;
  updatedAt: number;
  busy: boolean;
}

export interface SessionStore {
  create(user: UserContext): SessionRecord;
  get(sessionId: string, user: UserContext): SessionRecord;
  restore(sessionId: string, user: UserContext, state: AgentSessionState): SessionRecord;
  save(record: SessionRecord): void;
  claim(record: SessionRecord): void;
  release(record: SessionRecord): void;
  readIdempotentResponse(requestId: string, user: UserContext): AgentResponse | undefined;
  saveIdempotentResponse(requestId: string, user: UserContext, response: AgentResponse): void;
}

function sameUser(a: UserContext, b: UserContext): boolean {
  return a.userId === b.userId && a.schoolId === b.schoolId;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly responses = new Map<string, { user: UserContext; response: AgentResponse; createdAt: number }>();

  constructor(private readonly ttlMs: number, private readonly idFactory: () => string = () => `session_${crypto.randomUUID()}`) {}

  create(user: UserContext): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: this.idFactory(),
      owner: { ...user },
      messages: [],
      filters: {},
      displayedListingIds: [],
      searchPage: 1,
      createdAt: now,
      updatedAt: now,
      busy: false,
    };
    this.sessions.set(record.sessionId, record);
    return record;
  }

  get(sessionId: string, user: UserContext): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record || Date.now() - record.updatedAt > this.ttlMs) {
      this.sessions.delete(sessionId);
      throw new AppError("SESSION_NOT_FOUND", "会话不存在或已过期");
    }
    if (!sameUser(record.owner, user)) throw new AppError("SESSION_FORBIDDEN", "不能读取其他用户的会话");
    return record;
  }

  /** Rebuilds a session from state persisted by the business API, e.g. after an Agent restart. */
  restore(sessionId: string, user: UserContext, state: AgentSessionState): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      sessionId,
      owner: { ...user },
      messages: [],
      filters: { ...state.filters },
      displayedListingIds: [...state.displayedListingIds],
      searchPage: state.searchPage,
      createdAt: now,
      updatedAt: now,
      busy: false,
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  save(record: SessionRecord): void {
    record.updatedAt = Date.now();
    this.sessions.set(record.sessionId, record);
  }

  claim(record: SessionRecord): void {
    if (record.busy) throw new AppError("SESSION_BUSY", "同一会话已有请求正在处理", { retryable: true });
    record.busy = true;
    this.save(record);
  }

  release(record: SessionRecord): void {
    record.busy = false;
    this.save(record);
  }

  readIdempotentResponse(requestId: string, user: UserContext): AgentResponse | undefined {
    const cached = this.responses.get(requestId);
    if (!cached) return undefined;
    if (Date.now() - cached.createdAt > this.ttlMs) {
      this.responses.delete(requestId);
      return undefined;
    }
    if (!sameUser(cached.user, user)) throw new AppError("SESSION_FORBIDDEN", "requestId 已被其他用户使用");
    return cached.response;
  }

  saveIdempotentResponse(requestId: string, user: UserContext, response: AgentResponse): void {
    this.responses.set(requestId, { user: { ...user }, response, createdAt: Date.now() });
  }
}
