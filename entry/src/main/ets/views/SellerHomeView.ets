import { Product } from '../model/Models';
import { SellerHomeViewModel } from '../viewmodel/SellerHomeViewModel';
import { StateView } from '../components/StateView';
import { formatPrice, formatTime } from '../common/Utils';
import {
  COLOR_DIVIDER, COLOR_PAGE_BG, COLOR_PRICE, COLOR_PRIMARY, COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY, LoadState, PRODUCT_STATUS_ACTIVE, PRODUCT_STATUS_OFFLINE, PRODUCT_STATUS_SOLD,
  ROUTE_PRODUCT_DETAIL, ROUTE_PUBLISH_PAGE, STATUS_ACCEPTED_TEXT_COLOR, STATUS_COMPLETED_TEXT_COLOR
} from '../common/Constants';

@ComponentV2
export struct SellerHomeView {
  @Local vm: SellerHomeViewModel = new SellerHomeViewModel();
  @Local pathStack: NavPathStack = new NavPathStack();
  @Local confirmingId: string = '';
  private firstShow: boolean = true;

  build() {
    NavDestination() {
      Column() {
        if (this.vm.error !== '') {
          Button(`${this.vm.error} · 重试`).fontSize('12fp').height(44)
            .onClick(() => this.vm.loadMyProducts(true));
        }
        Row() {
          Column({ space: 4 }) {
            Text('我发布的').fontSize('20fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY);
            Text('管理你的校园闲置好物').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
          }
          .layoutWeight(1).alignItems(HorizontalAlign.Start);
          Text(`${this.vm.products.length} 件`).fontSize('13fp').fontColor(COLOR_PRIMARY);
        }
        .width('100%').padding(16).backgroundColor(Color.White);
        Button('＋ 发布一件闲置').width('90%').height(48)
          .margin({ top: 14, bottom: 6 })
          .fontSize('15fp').fontColor(Color.White).backgroundColor(COLOR_PRIMARY).borderRadius(24)
          .onClick(() => this.pathStack.pushPathByName(ROUTE_PUBLISH_PAGE, ''));
        if (this.vm.state === LoadState.CONTENT) {
          List({ space: 10 }) {
            ForEach(this.vm.products, (item: Product) => {
              ListItem() {
                Row({ space: 12 }) {
                  if (item.images.length > 0) {
                    Image(item.images[0]).width(72).height(72).borderRadius(12)
                      .objectFit(ImageFit.Cover);
                  } else {
                    Text('📷').fontSize('26fp').width(72).height(72).textAlign(TextAlign.Center)
                      .backgroundColor(COLOR_PAGE_BG).borderRadius(12);
                  }
                  Column({ space: 6 }) {
                    Text(item.title).fontSize('15fp').fontWeight(FontWeight.Medium)
                      .fontColor(COLOR_TEXT_PRIMARY).maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis });
                    Column({ space: 4 }) {
                      Text(formatPrice(item.price)).fontSize('17fp').fontWeight(FontWeight.Bold).fontColor(COLOR_PRICE);
                      Text(formatTime(item.publishTime)).fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
                    }
                    .alignItems(HorizontalAlign.Start);
                  }
                  .layoutWeight(1).alignItems(HorizontalAlign.Start);
                  Column({ space: 6 }) {
                    Text(this.statusLabel(item.status)).fontSize('11fp')
                      .fontColor(this.statusColor(item.status));
                    if (item.status === PRODUCT_STATUS_ACTIVE || item.status === PRODUCT_STATUS_OFFLINE) {
                      Button(this.actionLabel(item))
                        .fontSize('12fp').height(32).padding({ left: 12, right: 12 })
                        .backgroundColor(this.confirmingId === item.id ? COLOR_PRIMARY : Color.White)
                        .fontColor(this.confirmingId === item.id ? Color.White : COLOR_TEXT_SECONDARY)
                        .borderRadius(16).borderWidth(1).borderColor(COLOR_DIVIDER)
                        .enabled(this.vm.actioningId === '')
                        .onClick(async () => {
                          await this.onToggleListing(item);
                        });
                    }
                  }
                  .alignItems(HorizontalAlign.End);
                }
                .width('100%').padding(12).backgroundColor(Color.White).borderRadius(16)
                .onClick(() => this.pathStack.pushPathByName(ROUTE_PRODUCT_DETAIL, item.id));
              }
            }, (item: Product): string => item.id);
          }
          .layoutWeight(1).width('100%').padding({ left: 16, right: 16, top: 10, bottom: 12 })
          .scrollBar(BarState.Off);
        } else {
          Column() {
            StateView({
              state: this.vm.state,
              emptyText: '还没有发布商品',
              emptyHint: '点击上方「发布一件闲置」发布你的第一件闲置吧',
              onRetry: (): void => {
                this.vm.loadMyProducts(false);
              }
            });
          }
          .layoutWeight(1).width('100%');
        }
      }
      .width('100%').height('100%').backgroundColor(COLOR_PAGE_BG);
    }
    .title('我发布的')
    .onReady((context: NavDestinationContext) => {
      this.pathStack = context.pathStack;
      this.vm.loadMyProducts(false);
    })
    .onShown(() => {
      if (this.firstShow) {
        this.firstShow = false;
      } else {
        this.vm.loadMyProducts(true);
      }
    });
  }

  private statusLabel(status: string | undefined): string {
    if (status === PRODUCT_STATUS_OFFLINE) {
      return '已下架';
    }
    if (status === PRODUCT_STATUS_SOLD) {
      return '已售出';
    }
    return '在售';
  }

  private statusColor(status: string | undefined): string {
    if (status === PRODUCT_STATUS_OFFLINE) {
      return COLOR_TEXT_TERTIARY;
    }
    if (status === PRODUCT_STATUS_SOLD) {
      return STATUS_COMPLETED_TEXT_COLOR;
    }
    return STATUS_ACCEPTED_TEXT_COLOR;
  }

  private actionLabel(item: Product): string {
    if (item.status === PRODUCT_STATUS_OFFLINE) {
      return '重新上架';
    }
    return this.confirmingId === item.id ? '确认下架' : '下架';
  }

  /** Delisting is one tap; a second tap on the same item confirms it. */
  private async onToggleListing(item: Product): Promise<void> {
    const offline: boolean = item.status === PRODUCT_STATUS_OFFLINE;
    if (!offline && this.confirmingId !== item.id) {
      this.confirmingId = item.id;
      return;
    }
    this.confirmingId = '';
    const success: boolean = offline ? await this.vm.relist(item.id) : await this.vm.delist(item.id);
    this.getUIContext().getPromptAction().showToast({
      message: success ? (offline ? '已重新上架' : '已下架') : (this.vm.actionError || '操作失败，请稍后重试'),
      duration: 1500
    });
  }
}
