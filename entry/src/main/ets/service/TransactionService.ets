import { Transaction, TransactionDetail, TransactionListItem } from '../model/Models';
import { http } from '@kit.NetworkKit';
import { businessApiClient, BusinessApiError } from './BusinessApiClient';

export interface TransactionService {
  getTransactionsForUser(userId: string): Promise<TransactionListItem[]>;
  getTransactionDetail(transactionId: string): Promise<TransactionDetail | null>;
  createTransaction(productId: string, buyerId: string): Promise<Transaction>;
  acceptTransaction(transactionId: string, operatorId: string): Promise<Transaction>;
  rejectTransaction(transactionId: string, operatorId: string): Promise<Transaction>;
  completeTransaction(transactionId: string, operatorId: string): Promise<Transaction>;
  cancelTransaction(transactionId: string, operatorId: string): Promise<Transaction>;
}

interface TransactionListResponse {
  items: TransactionListItem[];
  nextCursor: string | null;
}

let transactionRequestSequence: number = 0;

export class HttpTransactionService implements TransactionService {
  async getTransactionsForUser(_userId: string): Promise<TransactionListItem[]> {
    const items: TransactionListItem[] = [];
    let cursor: string | null = null;
    for (let page: number = 0; page < 20; page += 1) {
      const result: TransactionListResponse = await businessApiClient.request<TransactionListResponse>(http.RequestMethod.GET,
        `/api/v1/transactions?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      for (const item of result.items) {
        items.push(item);
      }
      cursor = result.nextCursor;
      if (cursor === null) {
        break;
      }
    }
    return items;
  }

  async getTransactionDetail(transactionId: string): Promise<TransactionDetail | null> {
    try {
      return await businessApiClient.request<TransactionDetail>(http.RequestMethod.GET,
        `/api/v1/transactions/${encodeURIComponent(transactionId)}`);
    } catch (error) {
      if (error instanceof BusinessApiError && error.statusCode === 404) {
        return null;
      }
      throw new Error((error as Error).message);
    }
  }

  async createTransaction(productId: string, _buyerId: string): Promise<Transaction> {
    transactionRequestSequence += 1;
    return await businessApiClient.request<Transaction>(http.RequestMethod.POST, '/api/v1/transactions',
      JSON.stringify({ productId: productId }), true, 15000,
      { 'Idempotency-Key': `buy_${Date.now()}_${transactionRequestSequence}` });
  }

  async acceptTransaction(transactionId: string, _operatorId: string): Promise<Transaction> {
    return this.transition(transactionId, 'accept');
  }

  async rejectTransaction(transactionId: string, _operatorId: string): Promise<Transaction> {
    return this.transition(transactionId, 'reject');
  }

  async completeTransaction(transactionId: string, _operatorId: string): Promise<Transaction> {
    return this.transition(transactionId, 'complete');
  }

  async cancelTransaction(transactionId: string, _operatorId: string): Promise<Transaction> {
    return this.transition(transactionId, 'cancel');
  }

  private async transition(transactionId: string, action: string): Promise<Transaction> {
    return await businessApiClient.request<Transaction>(http.RequestMethod.POST,
      `/api/v1/transactions/${encodeURIComponent(transactionId)}/${action}`);
  }
}

export const transactionService: TransactionService = new HttpTransactionService();
