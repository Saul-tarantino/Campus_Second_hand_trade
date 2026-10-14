import { Product } from '../model/Models';
import { productService } from '../service/ProductService';
import { LoadState } from '../common/Constants';

@ObservedV2
export class BuyerHomeViewModel {
  @Trace feedState: LoadState = LoadState.LOADING;
  @Trace products: Product[] = [];
  @Trace feedError: string = '';
  @Trace feedRevision: number = 0;
  private feedSeq: number = 0;
  private initialized: boolean = false;
  @Trace searchKeyword: string = '';
  @Trace searchResults: Product[] = [];
  @Trace searching: boolean = false;
  @Trace searchDone: boolean = false;
  private searchSeq: number = 0;

  ensureFeedLoaded(): void {
    if (!this.initialized) {
      this.initialized = true;
      this.loadFeed(false);
    }
  }

  clear(): void {
    this.feedSeq += 1;
    this.searchSeq += 1;
    this.products = [];
    this.searchResults = [];
    this.searchKeyword = '';
    this.searching = false;
    this.searchDone = false;
    this.feedError = '';
    this.initialized = false;
    this.feedState = LoadState.LOADING;
  }

  async loadFeed(silent: boolean = false): Promise<void> {
    this.initialized = true;
    const seq: number = ++this.feedSeq;
    this.feedError = '';
    if (!silent && this.products.length === 0) {
      this.feedState = LoadState.LOADING;
    }
    try {
      const result: Product[] = await productService.getProductFeed();
      if (seq !== this.feedSeq) {
        return;
      }
      // Compare only meaningful fields: signed image URLs change on every request.
      const signature = (list: Product[]): string => JSON.stringify(list.map((item: Product): string =>
        `${item.id}|${item.title}|${item.price}|${item.status}|${item.campus}|${item.publishTime}|${item.images.length}`));
      if (signature(result) !== signature(this.products)) {
        this.products = result;
        this.feedRevision += 1;
      } else {
        this.products = result;
      }
      this.feedState = result.length > 0 ? LoadState.CONTENT : LoadState.EMPTY;
    } catch (_error) {
      if (seq === this.feedSeq) {
        this.feedError = '刷新失败，请检查网络后重试';
        this.feedState = this.products.length > 0 ? LoadState.CONTENT : LoadState.ERROR;
      }
    }
  }

  async doSearch(keyword: string): Promise<void> {
    const value: string = keyword.trim();
    this.searchKeyword = value;
    this.searchSeq += 1;
    const currentSeq: number = this.searchSeq;
    if (value === '') {
      this.searchResults = [];
      this.searching = false;
      this.searchDone = false;
      return;
    }
    this.searching = true;
    try {
      const result: Product[] = await productService.searchByKeyword(value);
      if (currentSeq === this.searchSeq) {
        this.searchResults = result;
        this.searchDone = true;
      }
    } catch (_error) {
      if (currentSeq === this.searchSeq) {
        this.searchResults = [];
        this.searchDone = true;
      }
    } finally {
      if (currentSeq === this.searchSeq) {
        this.searching = false;
      }
    }
  }
}
