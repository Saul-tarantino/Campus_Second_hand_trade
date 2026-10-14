import { ProductDetailViewModel } from '../viewmodel/ProductDetailViewModel';
import { StateView } from '../components/StateView';
import { formatCondition, formatPrice } from '../common/Utils';
import {
  COLOR_PAGE_BG, COLOR_PRICE, COLOR_PRIMARY, COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY, LoadState, OWN_PRODUCT_HINT
} from '../common/Constants';

@ComponentV2
export struct ProductDetailView {
  @Local vm: ProductDetailViewModel = new ProductDetailViewModel();
  @Local pathStack: NavPathStack = new NavPathStack();
  @Local productId: string = '';
  @Local mediaWidth: number = 0;

  private mediaEdge(): number {
    return this.mediaWidth > 0 ? this.mediaWidth : 320;
  }

  build() {
    NavDestination() {
      Column() {
        if (this.vm.state === LoadState.CONTENT && this.vm.detail !== null) {
          Scroll() {
            Column() {
              if (this.vm.detail.product.images.length > 0) {
                Swiper() {
                  ForEach(this.vm.detail.product.images, (source: string) => {
                    Image(source).width(this.mediaEdge()).height(this.mediaEdge()).objectFit(ImageFit.Cover);
                  }, (source: string): string => source);
                }
                .indicator(true).width('100%').height(this.mediaEdge()).backgroundColor(Color.White)
                .onAreaChange((_oldValue: Area, newValue: Area) => {
                  const width: number = Number(newValue.width);
                  if (width > 0 && Math.abs(width - this.mediaWidth) > 0.5) {
                    this.mediaWidth = width;
                  }
                });
              } else {
                Column({ space: 8 }) {
                  Text('📷').fontSize('48fp');
                  Text('暂无图片').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY);
                }
                .width('100%').height(this.mediaEdge()).justifyContent(FlexAlign.Center).backgroundColor(Color.White)
                .onAreaChange((_oldValue: Area, newValue: Area) => {
                  const width: number = Number(newValue.width);
                  if (width > 0 && Math.abs(width - this.mediaWidth) > 0.5) {
                    this.mediaWidth = width;
                  }
                });
              }
              Column({ space: 10 }) {
                Text(this.vm.detail.product.title).fontSize('21fp').fontWeight(FontWeight.Bold)
                  .fontColor(COLOR_TEXT_PRIMARY).width('100%');
                Text(formatPrice(this.vm.detail.product.price)).fontSize('26fp').fontWeight(FontWeight.Bold)
                  .fontColor(COLOR_PRICE).width('100%');
                Row({ space: 8 }) {
                  Text(this.vm.detail.product.status === 'SOLD' ? '已售出' :
                    (this.vm.reserved ? '已预约' : '在售'))
                    .fontSize('12fp').fontColor('#2E9E5B')
                    .backgroundColor('#EAF6ED').borderRadius(12)
                    .padding({ left: 10, right: 10, top: 5, bottom: 5 });
                  Text('同校当面交易').fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY)
                    .backgroundColor(COLOR_PAGE_BG).borderRadius(12)
                    .padding({ left: 10, right: 10, top: 5, bottom: 5 });
                }
              }
              .width('100%').alignItems(HorizontalAlign.Start)
              .padding(16).backgroundColor(Color.White)
              .margin({ top: 10 });
              Column() {
                Column({ space: 10 }) {
                  if (this.vm.detail.product.category !== undefined) {
                    this.infoLine('品类', this.vm.detail.product.category);
                  }
                  if (formatCondition(this.vm.detail.product.condition) !== '') {
                    this.infoLine('成色', formatCondition(this.vm.detail.product.condition));
                  }
                  if (this.vm.detail.product.campus !== undefined) {
                    this.infoLine('所在校区', this.vm.detail.product.campus);
                  }
                }
                .width('100%').padding(16).backgroundColor(Color.White).borderRadius(16)
                .margin({ top: 12 });
                Column({ space: 8 }) {
                  Text('商品描述').fontSize('15fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY).width('100%');
                  Text(this.vm.detail.product.description).fontSize('14fp').fontColor(COLOR_TEXT_PRIMARY)
                    .lineHeight(22).width('100%');
                }
                .width('100%').padding(16).backgroundColor(Color.White).borderRadius(16)
                  .margin({ top: 12 });
                Row({ space: 10 }) {
                  Image(this.vm.detail.seller.avatar).width(46).height(46).borderRadius(23);
                  Column({ space: 2 }) {
                    Text(this.vm.detail.seller.nickname).fontSize('15fp').fontWeight(FontWeight.Medium)
                      .fontColor(COLOR_TEXT_PRIMARY);
                    Text('同校卖家').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
                  }
                  .alignItems(HorizontalAlign.Start).layoutWeight(1);
                }
                .width('100%').padding(16).backgroundColor(Color.White).borderRadius(16)
                  .margin({ top: 12 });
                Column({ space: 6 }) {
                  Text('当面交易 · 线下付款').fontSize('13fp').fontWeight(FontWeight.Medium)
                    .fontColor(COLOR_TEXT_PRIMARY);
                  Text('请在校内公共场所当面验货后付款。平台不提供在线支付和物流服务。')
                    .fontSize('12fp').lineHeight(18).fontColor(COLOR_TEXT_SECONDARY);
                }
                .width('100%').alignItems(HorizontalAlign.Start)
                .padding(14).backgroundColor('#FFF4EB').borderRadius(14)
                .margin({ top: 12, bottom: 20 });
              }
              .width('100%').padding({ left: 16, right: 16 });
            }
            .width('100%');
          }
          .layoutWeight(1).width('100%').scrollBar(BarState.Off);
          Row() {
            if (this.vm.isOwnProduct) {
              Button(OWN_PRODUCT_HINT).enabled(false).width('100%').height(48).fontSize('15fp')
                .fontColor(Color.White).backgroundColor('#C9CDD4').borderRadius(24);
            } else if (this.vm.detail.product.status === 'SOLD') {
              Button('已售出').enabled(false).width('100%').height(48).fontSize('15fp')
                .fontColor(Color.White).backgroundColor('#C9CDD4').borderRadius(24);
            } else if (this.vm.reserved) {
              Button('已预约，等待交易确认').enabled(false).width('100%').height(48).fontSize('15fp')
                .fontColor(Color.White).backgroundColor('#C9CDD4').borderRadius(24);
            } else {
              Button(this.vm.purchasing ? '提交中…' : '预约交易').enabled(!this.vm.purchasing)
                .width('100%').height(48).fontSize('16fp').fontColor(Color.White)
                .backgroundColor(COLOR_PRIMARY).borderRadius(24)
                .onClick(() => this.showPurchaseDialog());
            }
          }
          .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 14 }).backgroundColor(Color.White);
        } else {
          Column() {
            StateView({
              state: this.vm.state,
              errorText: this.vm.lastErrorMessage,
              onRetry: (): void => {
                this.vm.load(this.productId);
              }
            });
          }
          .layoutWeight(1).width('100%');
        }
      }
      .width('100%').height('100%').backgroundColor(COLOR_PAGE_BG);
    }
    .title('商品详情')
    .onReady((context: NavDestinationContext) => {
      this.pathStack = context.pathStack;
      this.productId = context.pathInfo.param as string;
      this.vm.load(this.productId);
    });
  }

  @Builder
  infoLine(label: string, value: string): void {
    Row({ space: 14 }) {
      Text(label).fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY).constraintSize({ minWidth: 60 });
      Text(value).fontSize('13fp').fontColor(COLOR_TEXT_PRIMARY).layoutWeight(1);
    }
    .width('100%');
  }

  private showPurchaseDialog(): void {
    this.getUIContext().showAlertDialog({
      title: '确认预约',
      message: `确定以 ${formatPrice(this.vm.productPrice)} 预约「${this.vm.productTitle}」吗？`,
      primaryButton: {
        value: '确认预约',
        action: (): void => {
          this.confirmPurchase();
        }
      },
      secondaryButton: { value: '取消', action: (): void => { } }
    });
  }

  private async confirmPurchase(): Promise<void> {
    const success: boolean = await this.vm.purchase();
    this.getUIContext().getPromptAction().showToast({
      message: success ? '预约成功，等待卖家确认' : (this.vm.lastErrorMessage || '预约失败，请稍后重试'),
      duration: 1800
    });
  }
}
