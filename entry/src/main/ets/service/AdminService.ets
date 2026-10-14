import { http } from '@kit.NetworkKit';
import { AdminProductItem, AdminProductsResponse, AdminTransactionItem, AdminTransactionsResponse } from '../model/Models';
import { businessApiClient } from './BusinessApiClient';

/** Administrator-only operations; the server rejects these for ordinary accounts. */
export interface AdminService {
  listProducts(): Promise<AdminProductItem[]>;
  listTransactions(): Promise<AdminTransactionItem[]>;
  delistProduct(productId: string): Promise<void>;
  relistProduct(productId: string): Promise<void>;
  cancelTransaction(transactionId: string): Promise<void>;
  restoreTransaction(transactionId: string): Promise<void>;
}

interface OkResponse {
  ok: boolean;
}

class HttpAdminService implements AdminService {
  async listProducts(): Promise<AdminProductItem[]> {
    const response = await businessApiClient.request<AdminProductsResponse>(http.RequestMethod.GET,
      '/api/v1/admin/products?limit=100');
    return Array.isArray(response.items) ? response.items : [];
  }

  async listTransactions(): Promise<AdminTransactionItem[]> {
    const response = await businessApiClient.request<AdminTransactionsResponse>(http.RequestMethod.GET,
      '/api/v1/admin/transactions?limit=100');
    return Array.isArray(response.items) ? response.items : [];
  }

  async delistProduct(productId: string): Promise<void> {
    await businessApiClient.request<OkResponse>(http.RequestMethod.POST,
      `/api/v1/admin/products/${encodeURIComponent(productId)}/delist`);
  }

  async relistProduct(productId: string): Promise<void> {
    await businessApiClient.request<OkResponse>(http.RequestMethod.POST,
      `/api/v1/admin/products/${encodeURIComponent(productId)}/relist`);
  }

  async cancelTransaction(transactionId: string): Promise<void> {
    await businessApiClient.request<OkResponse>(http.RequestMethod.POST,
      `/api/v1/admin/transactions/${encodeURIComponent(transactionId)}/cancel`);
  }

  async restoreTransaction(transactionId: string): Promise<void> {
    await businessApiClient.request<OkResponse>(http.RequestMethod.POST,
      `/api/v1/admin/transactions/${encodeURIComponent(transactionId)}/restore`);
  }
}

export const adminService: AdminService = new HttpAdminService();
