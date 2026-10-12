import { Product, ProductDetail, PublishDraft } from '../model/Models';
import { MAX_PRODUCT_PHOTOS } from '../common/Constants';
import { fileIo } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { businessApiClient, BusinessApiError } from './BusinessApiClient';

export interface ProductService {
  getProductFeed(): Promise<Product[]>;
  searchByKeyword(keyword: string): Promise<Product[]>;
  searchProducts(query: ProductQuery): Promise<Product[]>;
  getProductsBySeller(sellerId: string): Promise<Product[]>;
  getProductDetail(productId: string): Promise<ProductDetail | null>;
  publishProduct(draft: PublishDraft): Promise<Product>;
  delistProduct(productId: string): Promise<Product>;
  relistProduct(productId: string): Promise<Product>;
}

interface ProductListResponse {
  items: Product[];
  nextCursor: string | null;
}

/** Filters are ORed within one field and ANDed across fields, matching the business API. */
export interface ProductQuery {
  keyword: string;
  categories: string[];
  campuses: string[];
  priceRanges: string[];
}

class UploadBytes {
  bytes: ArrayBuffer;
  mime: string;

  constructor(bytes: ArrayBuffer, mime: string) {
    this.bytes = bytes;
    this.mime = mime;
  }
}

function readPhoto(uri: string): UploadBytes {
  const file: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  try {
    const size: number = fileIo.statSync(file.fd).size;
    if (size < 1 || size > 5_000_000) {
      throw new Error('单张图片必须小于 5 MB');
    }
    const bytes = new Uint8Array(size);
    let offset: number = 0;
    while (offset < size) {
      const chunk = new ArrayBuffer(Math.min(65536, size - offset));
      const count: number = fileIo.readSync(file.fd, chunk);
      if (count < 1) {
        throw new Error('照片读取不完整');
      }
      bytes.set(new Uint8Array(chunk, 0, count), offset);
      offset += count;
    }
    let mime: string = '';
    if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      mime = 'image/jpeg';
    } else if (bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
      mime = 'image/png';
    } else if (bytes.length > 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
      String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP') {
      mime = 'image/webp';
    }
    if (mime === '') {
      throw new Error('仅支持 JPEG、PNG 或 WebP 图片');
    }
    return new UploadBytes(bytes.buffer as ArrayBuffer, mime);
  } finally {
    fileIo.closeSync(file);
  }
}

export class HttpProductService implements ProductService {
  private async list(path: string): Promise<Product[]> {
    const result: Product[] = [];
    let cursor: string | null = null;
    for (let page: number = 0; page < 20; page += 1) {
      const response: ProductListResponse = await businessApiClient.request<ProductListResponse>(http.RequestMethod.GET,
        `${path}${path.indexOf('?') >= 0 ? '&' : '?'}limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      for (const item of response.items) {
        result.push(item);
      }
      cursor = response.nextCursor;
      if (cursor === null) {
        break;
      }
    }
    return result;
  }

  async getProductFeed(): Promise<Product[]> {
    return this.list('/api/v1/products');
  }

  async searchByKeyword(keyword: string): Promise<Product[]> {
    if (keyword.trim() === '') {
      return [];
    }
    return this.list(`/api/v1/products?q=${encodeURIComponent(keyword.trim())}`);
  }

  async searchProducts(query: ProductQuery): Promise<Product[]> {
    const parts: string[] = [];
    const keyword: string = query.keyword.trim();
    if (keyword !== '') {
      parts.push(`q=${encodeURIComponent(keyword)}`);
    }
    for (const category of query.categories) {
      parts.push(`category=${encodeURIComponent(category)}`);
    }
    for (const campus of query.campuses) {
      parts.push(`campus=${encodeURIComponent(campus)}`);
    }
    for (const price of query.priceRanges) {
      parts.push(`price=${encodeURIComponent(price)}`);
    }
    if (parts.length === 0) {
      return [];
    }
    return this.list(`/api/v1/products?${parts.join('&')}`);
  }

  async delistProduct(productId: string): Promise<Product> {
    return await businessApiClient.request<Product>(http.RequestMethod.POST,
      `/api/v1/products/${encodeURIComponent(productId)}/delist`);
  }

  async relistProduct(productId: string): Promise<Product> {
    return await businessApiClient.request<Product>(http.RequestMethod.POST,
      `/api/v1/products/${encodeURIComponent(productId)}/relist`);
  }

  async getProductsBySeller(_sellerId: string): Promise<Product[]> {
    return this.list('/api/v1/me/products');
  }

  async getProductDetail(productId: string): Promise<ProductDetail | null> {
    try {
      return await businessApiClient.request<ProductDetail>(http.RequestMethod.GET,
        `/api/v1/products/${encodeURIComponent(productId)}`);
    } catch (error) {
      if (error instanceof BusinessApiError && error.statusCode === 404) {
        return null;
      }
      throw new Error((error as Error).message);
    }
  }

  async publishProduct(draft: PublishDraft): Promise<Product> {
    const imageIds: string[] = [];
    for (const uri of draft.images.slice(0, MAX_PRODUCT_PHOTOS)) {
      const image: UploadBytes = readPhoto(uri);
      imageIds.push(await businessApiClient.uploadImage(image.bytes, image.mime));
    }
    return await businessApiClient.request<Product>(http.RequestMethod.POST, '/api/v1/products', JSON.stringify({
      title: draft.title.trim(), description: draft.description.trim(), price: draft.price,
      imageIds: imageIds, category: draft.category || '其他', condition: draft.condition || 'unknown',
      campus: draft.campus || '未填写校区'
    }));
  }
}

export const productService: ProductService = new HttpProductService();
