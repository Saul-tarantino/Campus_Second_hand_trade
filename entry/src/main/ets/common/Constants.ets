import { TransactionStatus } from '../model/Models';

export const ROUTE_BUYER_HOME: string = 'BuyerHome';
export const ROUTE_SELLER_HOME: string = 'SellerHome';
export const ROUTE_PUBLISH_PAGE: string = 'PublishPage';
export const ROUTE_PRODUCT_DETAIL: string = 'ProductDetail';
export const ROUTE_TRADE_LIST: string = 'TradeList';
export const ROUTE_TRADE_DETAIL: string = 'TradeDetail';
export const PAGE_MAIN: string = 'pages/Main';

export const MAX_PRODUCT_PHOTOS: number = 3;
export const CHAT_REFRESH_DELAY_MS: number = 1000;

export const OWN_PRODUCT_HINT: string = '不能购买自己发布的商品';
export const TRADE_EMPTY_CHAT_HINT: string = '发送第一条消息开始沟通';
export const BUYER_PENDING_HINT: string = '等待卖家确认';

// Palette from the sibling arkui design project.
export const COLOR_PRIMARY: string = '#E06620';
export const COLOR_PRIMARY_STRONG: string = '#B7470F';
export const COLOR_PRIMARY_SOFT: string = '#FFF0E5';
export const COLOR_PRICE: string = '#E06620';
export const COLOR_TEXT_PRIMARY: string = '#1A1918';
export const COLOR_TEXT_SECONDARY: string = '#6D6C6A';
export const COLOR_TEXT_TERTIARY: string = '#75736F';
export const COLOR_ERROR: string = '#B83232';
export const COLOR_SUCCESS: string = '#2E9E5B';
export const COLOR_PAGE_BG: string = '#F5F4F1';
export const COLOR_CARD_BG: string = '#FFFFFF';
export const COLOR_DIVIDER: string = '#E5E4E1';
export const PAGE_PADDING: number = 16;
export const CARD_RADIUS: number = 16;
export const CONTROL_RADIUS: number = 16;
export const SHEET_ACTION_HEIGHT: number = 44;
export const GRID_GAP: number = 10;
export const FONT_TITLE: string = '21fp';
export const FONT_PRODUCT: string = '14fp';
export const FONT_PRICE: string = '19fp';
export const FONT_META: string = '12fp';

export const STATUS_PENDING_TEXT_COLOR: string = '#E8830C';
export const STATUS_PENDING_BG_COLOR: string = '#E8830C1F';
export const STATUS_ACCEPTED_TEXT_COLOR: string = '#2E9E5B';
export const STATUS_ACCEPTED_BG_COLOR: string = '#2E9E5B1F';
export const STATUS_REJECTED_TEXT_COLOR: string = '#E5484D';
export const STATUS_REJECTED_BG_COLOR: string = '#E5484D1F';
export const STATUS_COMPLETED_TEXT_COLOR: string = '#5B7A9D';
export const STATUS_COMPLETED_BG_COLOR: string = '#5B7A9D1F';
export const STATUS_CANCELLED_TEXT_COLOR: string = '#8A8A8A';
export const STATUS_CANCELLED_BG_COLOR: string = '#8A8A8A1F';

export const PRODUCT_STATUS_ACTIVE: string = 'ACTIVE';
export const PRODUCT_STATUS_SOLD: string = 'SOLD';
export const PRODUCT_STATUS_OFFLINE: string = 'OFFLINE';

export enum LoadState {
  LOADING = 0,
  CONTENT = 1,
  EMPTY = 2,
  ERROR = 3
}

export class TradeStatusUI {
  static text(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.PENDING:
        return '待确认';
      case TransactionStatus.ACCEPTED:
        return '待见面';
      case TransactionStatus.REJECTED:
        return '已关闭';
      case TransactionStatus.COMPLETED:
        return '已完成';
      case TransactionStatus.CANCELLED:
        return '已取消';
      default:
        return '未知';
    }
  }

  static textColor(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.PENDING:
        return STATUS_PENDING_TEXT_COLOR;
      case TransactionStatus.ACCEPTED:
        return STATUS_ACCEPTED_TEXT_COLOR;
      case TransactionStatus.REJECTED:
        return STATUS_REJECTED_TEXT_COLOR;
      case TransactionStatus.COMPLETED:
        return STATUS_COMPLETED_TEXT_COLOR;
      case TransactionStatus.CANCELLED:
        return STATUS_CANCELLED_TEXT_COLOR;
      default:
        return COLOR_TEXT_SECONDARY;
    }
  }

  static bgColor(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.PENDING:
        return STATUS_PENDING_BG_COLOR;
      case TransactionStatus.ACCEPTED:
        return STATUS_ACCEPTED_BG_COLOR;
      case TransactionStatus.REJECTED:
        return STATUS_REJECTED_BG_COLOR;
      case TransactionStatus.COMPLETED:
        return STATUS_COMPLETED_BG_COLOR;
      case TransactionStatus.CANCELLED:
        return STATUS_CANCELLED_BG_COLOR;
      default:
        return COLOR_DIVIDER;
    }
  }

  static isTerminal(status: TransactionStatus): boolean {
    return status === TransactionStatus.REJECTED || status === TransactionStatus.COMPLETED;
  }
}
