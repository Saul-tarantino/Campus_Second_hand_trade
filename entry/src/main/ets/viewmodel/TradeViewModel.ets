import { Message, Transaction, TransactionDetail, TransactionListItem, TransactionStatus, User } from '../model/Models';
import { authService } from '../service/AuthenticationService';
import { transactionService } from '../service/TransactionService';
import { messageService } from '../service/MessageService';
import { BUYER_PENDING_HINT, CHAT_REFRESH_DELAY_MS, LoadState } from '../common/Constants';

@ObservedV2
export class TradeViewModel {
  @Trace listState: LoadState = LoadState.LOADING;
  @Trace items: TransactionListItem[] = [];
  @Trace detailState: LoadState = LoadState.LOADING;
  @Trace detail: TransactionDetail | null = null;
  @Trace messages: Message[] = [];
  @Trace chatText: string = '';
  @Trace sending: boolean = false;
  @Trace actioning: boolean = false;
  @Trace lastError: string = '';
  private activeId: string = '';
  private generation: number = 0;
  private invalidated: boolean = false;
  private pollId: number = -1;

  get currentUser(): User | null {
    return authService.getCurrentUser();
  }

  get isBuyer(): boolean {
    return this.detail !== null && this.currentUser !== null && this.detail.buyer.id === this.currentUser.id;
  }

  get isSeller(): boolean {
    return this.detail !== null && this.currentUser !== null && this.detail.seller.id === this.currentUser.id;
  }

  get canChat(): boolean {
    return this.detail !== null &&
      (this.detail.transaction.status === TransactionStatus.PENDING ||
        this.detail.transaction.status === TransactionStatus.ACCEPTED);
  }

  /** Both sides may walk away while the deal is still open. */
  get canCancel(): boolean {
    return this.detail !== null && (this.isBuyer || this.isSeller) &&
      (this.detail.transaction.status === TransactionStatus.PENDING ||
        this.detail.transaction.status === TransactionStatus.ACCEPTED);
  }

  get buyerStatusHint(): string {
    return this.isBuyer && this.detail !== null && this.detail.transaction.status === TransactionStatus.PENDING
      ? BUYER_PENDING_HINT : '';
  }

  async loadList(silent: boolean = false): Promise<void> {
    const current: User | null = this.currentUser;
    if (current === null) {
      this.listState = LoadState.ERROR;
      this.lastError = '请先登录';
      return;
    }
    if (!silent) {
      this.listState = LoadState.LOADING;
    }
    try {
      const result: TransactionListItem[] = await transactionService.getTransactionsForUser(current.id);
      this.items = result;
      this.listState = result.length > 0 ? LoadState.CONTENT : LoadState.EMPTY;
    } catch (error) {
      this.listState = LoadState.ERROR;
      this.lastError = (error as Error).message;
    }
  }

  async loadDetail(transactionId: string): Promise<void> {
    this.invalidated = false;
    this.generation += 1;
    const currentGeneration: number = this.generation;
    this.activeId = transactionId;
    this.detailState = LoadState.LOADING;
    this.detail = null;
    this.messages = [];
    this.lastError = '';
    try {
      const result: TransactionDetail | null = await transactionService.getTransactionDetail(transactionId);
      if (!this.isActive(transactionId, currentGeneration)) {
        return;
      }
      if (result === null) {
        this.detailState = LoadState.ERROR;
        this.lastError = '交易不存在';
        return;
      }
      this.detail = result;
      this.detailState = LoadState.CONTENT;
      await this.refreshMessages(transactionId, currentGeneration);
    } catch (error) {
      if (this.isActive(transactionId, currentGeneration)) {
        this.detailState = LoadState.ERROR;
        this.lastError = (error as Error).message || '加载交易详情失败';
      }
    }
  }

  async accept(): Promise<boolean> {
    return this.changeStatus('accept');
  }

  async reject(): Promise<boolean> {
    return this.changeStatus('reject');
  }

  async complete(): Promise<boolean> {
    return this.changeStatus('complete');
  }

  async cancel(): Promise<boolean> {
    return this.changeStatus('cancel', true);
  }

  async send(): Promise<boolean> {
    if (!this.canChat || this.sending || this.detail === null) {
      return false;
    }
    const detail: TransactionDetail = this.detail;
    const current: User | null = this.currentUser;
    if (current === null) {
      this.lastError = '请先登录';
      return false;
    }
    const content: string = this.chatText.trim();
    if (content === '') {
      this.lastError = '消息内容不能为空';
      return false;
    }
    const transactionId: string = detail.transaction.id;
    const currentGeneration: number = this.generation;
    this.sending = true;
    this.lastError = '';
    try {
      await messageService.sendMessage(transactionId, current.id, content);
      this.chatText = '';
      await this.refreshMessages(transactionId, currentGeneration);
      setTimeout(() => {
        this.refreshMessages(transactionId, currentGeneration);
      }, CHAT_REFRESH_DELAY_MS);
      return true;
    } catch (error) {
      this.lastError = (error as Error).message;
      return false;
    } finally {
      this.sending = false;
    }
  }

  dispose(): void {
    this.invalidated = true;
    this.generation += 1;
    if (this.pollId >= 0) {
      clearInterval(this.pollId);
      this.pollId = -1;
    }
  }

  startPolling(transactionId: string): void {
    if (this.pollId >= 0) {
      clearInterval(this.pollId);
    }
    this.pollId = setInterval(async () => {
      if (this.invalidated || this.activeId !== transactionId || this.detail === null) {
        return;
      }
      const currentGeneration: number = this.generation;
      try {
        const updated: TransactionDetail | null = await transactionService.getTransactionDetail(transactionId);
        if (updated !== null && this.isActive(transactionId, currentGeneration)) {
          this.detail = updated;
        }
        await this.refreshMessages(transactionId, currentGeneration);
      } catch (_error) {
      }
    }, 3000);
  }

  private async changeStatus(action: string, allowBuyer: boolean = false): Promise<boolean> {
    if (this.detail === null || this.actioning) {
      return false;
    }
    if (!allowBuyer && !this.isSeller) {
      this.lastError = '只有卖家可以执行状态操作';
      return false;
    }
    const detail: TransactionDetail = this.detail;
    const current: User | null = this.currentUser;
    if (current === null) {
      this.lastError = '请先登录';
      return false;
    }
    this.actioning = true;
    this.lastError = '';
    try {
      let updated: Transaction;
      if (action === 'accept') {
        updated = await transactionService.acceptTransaction(detail.transaction.id, current.id);
      } else if (action === 'reject') {
        updated = await transactionService.rejectTransaction(detail.transaction.id, current.id);
      } else if (action === 'cancel') {
        updated = await transactionService.cancelTransaction(detail.transaction.id, current.id);
      } else {
        updated = await transactionService.completeTransaction(detail.transaction.id, current.id);
      }
      this.detail = {
        transaction: updated,
        product: detail.product,
        buyer: detail.buyer,
        seller: detail.seller
      };
      return true;
    } catch (error) {
      this.lastError = (error as Error).message;
      return false;
    } finally {
      this.actioning = false;
    }
  }

  private async refreshMessages(transactionId: string, currentGeneration: number): Promise<void> {
    try {
      const result: Message[] = await messageService.getMessages(transactionId);
      if (this.isActive(transactionId, currentGeneration)) {
        this.messages = result;
      }
    } catch (error) {
      if (this.isActive(transactionId, currentGeneration)) {
        this.lastError = (error as Error).message || '加载聊天记录失败';
      }
    }
  }

  private isActive(transactionId: string, currentGeneration: number): boolean {
    return !this.invalidated && this.activeId === transactionId && this.generation === currentGeneration;
  }
}
