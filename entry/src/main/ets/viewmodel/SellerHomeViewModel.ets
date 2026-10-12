import { Product, User } from '../model/Models';
import { productService } from '../service/ProductService';
import { authService } from '../service/AuthenticationService';
import { LoadState } from '../common/Constants';

@ObservedV2
export class SellerHomeViewModel {
  @Trace state: LoadState = LoadState.LOADING;
  @Trace products: Product[] = [];
  @Trace error: string = '';
  @Trace actioningId: string = '';
  @Trace actionError: string = '';
  private requestSeq: number = 0;

  async delist(productId: string): Promise<boolean> {
    return this.changeListing(productId, false);
  }

  async relist(productId: string): Promise<boolean> {
    return this.changeListing(productId, true);
  }

  private async changeListing(productId: string, relist: boolean): Promise<boolean> {
    if (this.actioningId !== '') {
      return false;
    }
    this.actioningId = productId;
    this.actionError = '';
    try {
      if (relist) {
        await productService.relistProduct(productId);
      } else {
        await productService.delistProduct(productId);
      }
      await this.loadMyProducts(true);
      return true;
    } catch (error) {
      this.actionError = (error as Error).message || '操作失败，请稍后重试';
      return false;
    } finally {
      this.actioningId = '';
    }
  }

  async loadMyProducts(silent: boolean = false): Promise<void> {
    const seq: number = ++this.requestSeq;
    this.error = '';
    const current: User | null = authService.getCurrentUser();
    if (current === null) {
      this.state = LoadState.ERROR;
      return;
    }
    if (!silent && this.products.length === 0) {
      this.state = LoadState.LOADING;
    }
    try {
      const result: Product[] = await productService.getProductsBySeller(current.id);
      if (seq !== this.requestSeq || authService.getCurrentUser()?.id !== current.id) {
        return;
      }
      this.products = result;
      this.state = result.length > 0 ? LoadState.CONTENT : LoadState.EMPTY;
    } catch (_error) {
      if (seq === this.requestSeq) {
        this.error = '加载失败，请检查网络后重试';
        this.state = this.products.length > 0 ? LoadState.CONTENT : LoadState.ERROR;
      }
    }
  }
}
