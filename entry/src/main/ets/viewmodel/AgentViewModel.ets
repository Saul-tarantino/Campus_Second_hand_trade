import {
  AgentConversationDetail,
  AgentConversationMessage,
  AgentConversationSummary,
  AgentRecommendation, AgentResult, AgentStatus
} from '../model/Models';
import { agentService } from '../service/AgentService';

export interface AgentConversationTurn {
  id: string;
  question: string;
  replyLead: string;
  replyDetail: string;
  recommendations: AgentRecommendation[];
}

interface FormattedReply {
  lead: string;
  detail: string;
}

/** The whole reply is shown as-is; only escape sequences and blank lines are normalised. */
function formatReply(result: AgentResult): FormattedReply {
  const full: string = result.replyText
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (full !== '') {
    return { lead: full, detail: '' };
  }
  if (result.status === AgentStatus.NO_RESULTS) {
    return { lead: '暂时没有找到符合条件的商品，可以换个关键词或调整预算再试。', detail: '' };
  }
  if (result.status === AgentStatus.CLARIFICATION) {
    return { lead: '请告诉我想找的商品、预算或校区，我会继续帮你筛选。', detail: '' };
  }
  return { lead: '请继续描述想找的商品，我会帮你筛选。', detail: '' };
}

/** Rebuilds the visible transcript from stored messages (recommendation cards are not replayed). */
function buildTurns(messages: AgentConversationMessage[]): AgentConversationTurn[] {
  const turns: AgentConversationTurn[] = [];
  let question: string = '';
  for (const message of messages) {
    if (message.role === 'user') {
      question = message.content;
      continue;
    }
    turns.push({
      id: message.id,
      question: question,
      replyLead: message.content,
      replyDetail: '',
      recommendations: []
    });
    question = '';
  }
  return turns;
}

@ObservedV2
export class AgentViewModel {
  @Trace query: string = '';
  @Trace loading: boolean = false;
  @Trace turns: AgentConversationTurn[] = [];
  @Trace error: string = '';
  @Trace sessionId: string | null = null;
  @Trace history: AgentConversationSummary[] = [];
  @Trace historyLoading: boolean = false;
  @Trace historyError: string = '';
  @Trace historyVisible: boolean = false;
  private requestSeq: number = 0;

  async loadHistory(): Promise<void> {
    this.historyLoading = true;
    this.historyError = '';
    try {
      this.history = await agentService.listConversations();
    } catch (error) {
      this.historyError = (error as Error).message || '加载历史对话失败';
    } finally {
      this.historyLoading = false;
    }
  }

  /** Reopens a stored conversation so the next message continues it. */
  async openConversation(sessionId: string): Promise<boolean> {
    this.error = '';
    try {
      const detail: AgentConversationDetail = await agentService.getConversation(sessionId);
      this.requestSeq += 1;
      this.loading = false;
      this.turns = buildTurns(detail.messages);
      this.sessionId = detail.conversation.sessionId;
      this.query = '';
      this.historyVisible = false;
      return true;
    } catch (error) {
      this.error = (error as Error).message || '打开对话失败';
      return false;
    }
  }

  async deleteConversation(sessionId: string): Promise<boolean> {
    this.error = '';
    try {
      await agentService.deleteConversation(sessionId);
      if (this.sessionId === sessionId) {
        this.resetConversation(true);
      }
      await this.loadHistory();
      return true;
    } catch (error) {
      this.error = (error as Error).message || '删除对话失败';
      return false;
    }
  }

  resetConversation(force: boolean = false): void {
    if (this.loading && !force) {
      return;
    }
    this.requestSeq += 1;
    this.loading = false;
    this.query = '';
    this.turns = [];
    this.error = '';
    this.sessionId = null;
  }

  async send(): Promise<boolean> {
    if (this.loading) {
      return false;
    }
    const question: string = this.query.trim();
    if (question === '') {
      this.error = '输入不能为空';
      return false;
    }
    this.error = '';
    this.loading = true;
    this.requestSeq += 1;
    const currentSeq: number = this.requestSeq;
    try {
      const result: AgentResult = await agentService.queryByNaturalLanguage(question, this.sessionId);
      if (currentSeq === this.requestSeq) {
        const reply: FormattedReply = formatReply(result);
        this.turns = [...this.turns, {
          id: result.requestId,
          question: question,
          replyLead: reply.lead,
          replyDetail: reply.detail,
          recommendations: result.recommendations
        }];
        this.sessionId = result.sessionId;
        this.query = '';
      }
      return true;
    } catch (error) {
      if (currentSeq === this.requestSeq) {
        this.error = (error as Error).message;
      }
      return false;
    } finally {
      if (currentSeq === this.requestSeq) {
        this.loading = false;
      }
    }
  }
}
