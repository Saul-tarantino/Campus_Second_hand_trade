import { AdminProductItem, AdminTransactionItem, TransactionStatus } from '../model/Models';
import { adminService } from '../service/AdminService';
import { formatPrice, formatTime } from '../common/Utils';
import {
  COLOR_ERROR, COLOR_PAGE_BG, COLOR_PRIMARY, COLOR_PRIMARY_SOFT, COLOR_SUCCESS, COLOR_TEXT_PRIMARY,
  COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY, CONTROL_RADIUS, PRODUCT_STATUS_ACTIVE, PRODUCT_STATUS_OFFLINE,
  TradeStatusUI
} from '../common/Constants';

/** Administrator panel: every listing and every transaction of the school. */
@ComponentV2
export struct AdminSheetView {
  @Event onClose: () => void = (): void => {
  };
  @Local tab: number = 0;
  @Local products: AdminProductItem[] = [];
  @Local trades: AdminTransactionItem[] = [];
  @Local loading: boolean = false;
  @Local error: string = '';
  @Local confirming: string = '';

  aboutToAppear(): void {
    this.load();
  }

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('管理后台').fontSize('20fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY).layoutWeight(1);
        Button('刷新', { type: ButtonType.Normal }).fontSize('14fp').fontColor(COLOR_PRIMARY)
          .backgroundColor(COLOR_PRIMARY_SOFT).height(44).padding({ left: 12, right: 12 }).borderRadius(CONTROL_RADIUS)
          .onClick(() => this.load());
        Button('关闭', { type: ButtonType.Normal }).fontSize('14fp').fontColor(COLOR_TEXT_SECONDARY)
          .backgroundColor(COLOR_PAGE_BG).height(44).padding({ left: 12, right: 12 }).borderRadius(CONTROL_RADIUS)
          .onClick(() => this.onClose());
      }
      .width('100%');
      Row({ space: 8 }) {
        this.tabButton('商品', 0);
        this.tabButton('交易', 1);
      }
      .width('100%');
      if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color(COLOR_PRIMARY);
          Text('加载中…').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY);
        }
        .width('100%').justifyContent(FlexAlign.Center).margin({ top: 24 });
      } else if (this.error !== '') {
        Text(this.error).fontSize('13fp').fontColor(COLOR_ERROR).width('100%').margin({ top: 12 });
        Button('重试').height(44).fontColor(COLOR_PRIMARY).onClick(() => this.load());
      } else if (this.tab === 0) {
        this.productList();
      } else {
        this.tradeList();
      }
    }
    .width('100%').height('100%').padding({ left: 16, right: 16, bottom: 20 });
  }

  @Builder
  tabButton(label: string, index: number): void {
    Text(label).fontSize('14fp').fontWeight(FontWeight.Medium)
      .fontColor(this.tab === index ? Color.White : COLOR_TEXT_SECONDARY)
      .backgroundColor(this.tab === index ? COLOR_PRIMARY : Color.White)
      .borderRadius(CONTROL_RADIUS).padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .onClick(() => this.tab = index);
  }

  @Builder
  productList(): void {
    Column({ space: 6 }) {
      Text(`共 ${this.products.length} 件`).fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY).width('100%');
      List({ space: 8 }) {
        ForEach(this.products, (item: AdminProductItem) => {
          ListItem() {
            Column({ space: 8 }) {
              Text(item.title).fontSize('14fp').fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY)
                .width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
              Text(`${formatPrice(item.price)} · ${this.productStatusText(item.status)} · ` +
                `${item.seller === undefined ? '' : item.seller.nickname}`)
                .fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY).width('100%');
              if ((item.activeTransactionCount ?? 0) > 0) {
                Text(`有 ${item.activeTransactionCount} 笔进行中交易，请先取消`).fontSize('11fp')
                  .fontColor(COLOR_ERROR).width('100%');
              }
              if (item.status === PRODUCT_STATUS_ACTIVE || item.status === PRODUCT_STATUS_OFFLINE) {
                Button(item.status === PRODUCT_STATUS_OFFLINE ? '重新上架'
                  : (this.confirming === `p:${item.id}` ? '确认下架' : '下架'), { type: ButtonType.Normal })
                  .fontSize('12fp').height(34).width('100%')
                  .fontColor(this.confirming === `p:${item.id}` ? Color.White : COLOR_TEXT_SECONDARY)
                  .backgroundColor(this.confirming === `p:${item.id}` ? COLOR_PRIMARY : COLOR_PAGE_BG)
                  .borderRadius(CONTROL_RADIUS).onClick(() => this.toggleProduct(item));
              }
            }
            .width('100%').padding(12).backgroundColor(Color.White).borderRadius(CONTROL_RADIUS);
          }
        }, (item: AdminProductItem): string => item.id);
      }
      .layoutWeight(1).width('100%').scrollBar(BarState.Off);
    }
    .layoutWeight(1).width('100%').alignItems(HorizontalAlign.Start);
  }

  @Builder
  tradeList(): void {
    Column({ space: 6 }) {
      Text(`共 ${this.trades.length} 笔`).fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY).width('100%');
      List({ space: 8 }) {
        ForEach(this.trades, (item: AdminTransactionItem) => {
          ListItem() {
            Column({ space: 8 }) {
              Text(item.product.title).fontSize('14fp').fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY)
                .width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
              Text(`${item.buyer.nickname} ← ${item.seller.nickname} · ${TradeStatusUI.text(item.transaction.status)} · ` +
                `${formatTime(item.transaction.createTime)}`)
                .fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY).width('100%');
              Row({ space: 8 }) {
                if (this.isOpen(item)) {
                  Button(this.confirming === `t:${item.transaction.id}` ? '确认取消交易' : '取消交易', { type: ButtonType.Normal })
                    .fontSize('12fp').height(34).width('100%')
                    .fontColor(this.confirming === `t:${item.transaction.id}` ? Color.White : COLOR_ERROR)
                    .backgroundColor(this.confirming === `t:${item.transaction.id}` ? COLOR_ERROR : COLOR_PAGE_BG)
                    .borderRadius(CONTROL_RADIUS).onClick(() => this.cancelTrade(item));
                } else {
                  Button(this.confirming === `t:${item.transaction.id}` ? '确认恢复' : '恢复交易', { type: ButtonType.Normal })
                    .fontSize('12fp').height(34).width('100%').fontColor(COLOR_SUCCESS)
                    .backgroundColor(COLOR_PAGE_BG).borderRadius(CONTROL_RADIUS)
                    .onClick(() => this.restoreTrade(item));
                }
              }
              .width('100%');
            }
            .width('100%').padding(12).backgroundColor(Color.White).borderRadius(CONTROL_RADIUS);
          }
        }, (item: AdminTransactionItem): string => item.transaction.id);
      }
      .layoutWeight(1).width('100%').scrollBar(BarState.Off);
    }
    .layoutWeight(1).width('100%').alignItems(HorizontalAlign.Start);
  }

  private productStatusText(status: string | undefined): string {
    if (status === PRODUCT_STATUS_OFFLINE) {
      return '已下架';
    }
    if (status === 'SOLD') {
      return '已售出';
    }
    return '在售';
  }

  private isOpen(item: AdminTransactionItem): boolean {
    return item.transaction.status === TransactionStatus.PENDING || item.transaction.status === TransactionStatus.ACCEPTED;
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.confirming = '';
    try {
      this.products = await adminService.listProducts();
      this.trades = await adminService.listTransactions();
    } catch (error) {
      this.error = (error as Error).message || '加载失败，请稍后重试';
    } finally {
      this.loading = false;
    }
  }

  /** First tap arms the action, second tap performs it. */
  private async toggleProduct(item: AdminProductItem): Promise<void> {
    const offline: boolean = item.status === PRODUCT_STATUS_OFFLINE;
    const key: string = `p:${item.id}`;
    if (!offline && this.confirming !== key) {
      this.confirming = key;
      return;
    }
    this.confirming = '';
    try {
      if (offline) {
        await adminService.relistProduct(item.id);
      } else {
        await adminService.delistProduct(item.id);
      }
      this.toast(offline ? '已重新上架' : '已下架');
      await this.load();
    } catch (error) {
      this.toast((error as Error).message || '操作失败');
    }
  }

  private async cancelTrade(item: AdminTransactionItem): Promise<void> {
    const key: string = `t:${item.transaction.id}`;
    if (this.confirming !== key) {
      this.confirming = key;
      return;
    }
    this.confirming = '';
    try {
      await adminService.cancelTransaction(item.transaction.id);
      this.toast('交易已取消，商品恢复可售');
      await this.load();
    } catch (error) {
      this.toast((error as Error).message || '操作失败');
    }
  }

  private async restoreTrade(item: AdminTransactionItem): Promise<void> {
    const key: string = `t:${item.transaction.id}`;
    if (this.confirming !== key) {
      this.confirming = key;
      return;
    }
    this.confirming = '';
    try {
      await adminService.restoreTransaction(item.transaction.id);
      this.toast('交易已恢复');
      await this.load();
    } catch (error) {
      this.toast((error as Error).message || '操作失败');
    }
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message, duration: 1500 });
  }
}
