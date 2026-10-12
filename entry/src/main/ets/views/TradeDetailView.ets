import { Message, TransactionDetail, TransactionStatus, User } from '../model/Models';
import { TradeViewModel } from '../viewmodel/TradeViewModel';
import { StateView } from '../components/StateView';
import { formatPrice, formatTime } from '../common/Utils';
import {
  COLOR_DIVIDER, COLOR_PAGE_BG, COLOR_PRICE, COLOR_PRIMARY, COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY,
  LoadState, TradeStatusUI, STATUS_ACCEPTED_TEXT_COLOR, STATUS_REJECTED_TEXT_COLOR
} from '../common/Constants';

@ComponentV2
export struct TradeDetailView {
  @Local vm: TradeViewModel = new TradeViewModel();
  @Local pathStack: NavPathStack = new NavPathStack();
  @Local transactionId: string = '';
  @Local confirmingCancel: boolean = false;

  aboutToDisappear(): void {
    this.vm.dispose();
  }

  build() {
    NavDestination() {
      Column() {
        if (this.vm.detailState === LoadState.CONTENT && this.vm.detail !== null) {
          this.tradeInfo();
          if (this.vm.buyerStatusHint !== '') {
            Text(this.vm.buyerStatusHint).fontSize('13fp').fontColor(COLOR_TEXT_SECONDARY).width('100%')
              .padding({ left: 14, right: 14, top: 8, bottom: 4 });
          }
          this.actionBar();
          this.messageList();
          this.chatBar();
        } else {
          Column() {
            StateView({
              state: this.vm.detailState,
              errorText: this.vm.lastError || '交易详情加载失败',
              onRetry: (): void => {
                this.vm.loadDetail(this.transactionId);
              }
            });
          }
          .layoutWeight(1).width('100%');
        }
      }
      .width('100%').height('100%').backgroundColor(COLOR_PAGE_BG);
    }
    .title('交易详情')
    .onReady((context: NavDestinationContext) => {
      this.pathStack = context.pathStack;
      this.transactionId = context.pathInfo.param as string;
      this.vm.loadDetail(this.transactionId);
      this.vm.startPolling(this.transactionId);
    });
  }

  @Builder
  tradeInfo(): void {
    if (this.vm.detail !== null) {
      Row({ space: 12 }) {
        if (this.vm.detail.product.images.length > 0) {
          Image(this.vm.detail.product.images[0]).width(76).height(76).borderRadius(12)
            .objectFit(ImageFit.Cover);
        } else {
          Text('📷').fontSize('26fp').width(76).height(76).textAlign(TextAlign.Center)
            .backgroundColor(COLOR_PAGE_BG).borderRadius(12);
        }
        Column({ space: 6 }) {
          Text(this.vm.detail.product.title).fontSize('16fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY);
          Text(formatPrice(this.vm.detail.product.price)).fontSize('17fp').fontWeight(FontWeight.Bold)
            .fontColor(COLOR_PRICE);
          Text(`${this.vm.detail.buyer.nickname} ↔ ${this.vm.detail.seller.nickname}`)
            .fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY);
          Text(TradeStatusUI.text(this.vm.detail.transaction.status)).fontSize('12fp')
            .fontColor(TradeStatusUI.textColor(this.vm.detail.transaction.status))
            .backgroundColor(TradeStatusUI.bgColor(this.vm.detail.transaction.status))
            .borderRadius(8).padding({ left: 8, right: 8, top: 3, bottom: 3 });
        }
        .alignItems(HorizontalAlign.Start).layoutWeight(1);
      }
      .width('100%').padding(14).backgroundColor(Color.White).borderRadius(16)
      .margin({ top: 12 }).width('92%');
    }
  }

  @Builder
  actionBar(): void {
    if (this.vm.isSeller && this.vm.detail !== null) {
      Row({ space: 10 }) {
        if (this.vm.detail.transaction.status === TransactionStatus.PENDING) {
          Button('接受').layoutWeight(1).height(48).fontColor(Color.White).backgroundColor(STATUS_ACCEPTED_TEXT_COLOR)
            .borderRadius(21).enabled(!this.vm.actioning).onClick(async () => {
              const success: boolean = await this.vm.accept();
              this.showActionToast(success, '交易已接受');
            });
          Button('拒绝').layoutWeight(1).height(48).fontColor(Color.White).backgroundColor(STATUS_REJECTED_TEXT_COLOR)
            .borderRadius(21).enabled(!this.vm.actioning).onClick(async () => {
              const success: boolean = await this.vm.reject();
              this.showActionToast(success, '交易已拒绝');
            });
        } else if (this.vm.detail.transaction.status === TransactionStatus.ACCEPTED) {
          Button('标记完成').layoutWeight(1).height(48).fontColor(Color.White).backgroundColor(COLOR_PRIMARY)
            .borderRadius(21).enabled(!this.vm.actioning).onClick(async () => {
              const success: boolean = await this.vm.complete();
              this.showActionToast(success, '交易已完成');
            });
        }
      }
      .width('100%').padding({ left: 16, right: 16, top: 8 });
    }
    if (this.vm.canCancel) {
      Row({ space: 10 }) {
        if (this.confirmingCancel) {
          Button('确认取消交易').layoutWeight(1).height(44).fontSize('14fp').fontColor(Color.White)
            .backgroundColor(STATUS_REJECTED_TEXT_COLOR).borderRadius(21).enabled(!this.vm.actioning)
            .onClick(async () => {
              const success: boolean = await this.vm.cancel();
              this.confirmingCancel = false;
              this.showActionToast(success, '交易已取消');
            });
          Button('再想想').layoutWeight(1).height(44).fontSize('14fp').fontColor(COLOR_TEXT_SECONDARY)
            .backgroundColor(Color.White).borderRadius(21).onClick(() => {
              this.confirmingCancel = false;
            });
        } else {
          Button('取消交易').width('100%').height(44).fontSize('14fp').fontColor(COLOR_TEXT_SECONDARY)
            .backgroundColor(Color.White).borderRadius(21).enabled(!this.vm.actioning)
            .onClick(() => {
              this.confirmingCancel = true;
            });
        }
      }
      .width('100%').padding({ left: 16, right: 16, top: 8 });
    }
  }

  @Builder
  messageList(): void {
    Column({ space: 8 }) {
      Text('交易沟通').fontSize('15fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY).width('100%');
      if (this.vm.messages.length === 0) {
        Text('发送第一条消息开始沟通').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY)
          .width('100%').textAlign(TextAlign.Center).margin({ top: 24 });
      } else {
        List({ space: 8 }) {
          ForEach(this.vm.messages, (message: Message) => {
            ListItem() {
              this.messageBubble(message);
            }
          }, (message: Message): string => message.id);
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off);
      }
    }
    .layoutWeight(1).width('100%').padding({ left: 16, right: 16, top: 14 });
  }

  @Builder
  messageBubble(message: Message): void {
    Row() {
      Text(message.content).fontSize('14fp').fontColor(this.isCurrentUserMessage(message)
        ? Color.White : COLOR_TEXT_PRIMARY)
        .backgroundColor(this.isCurrentUserMessage(message) ? COLOR_PRIMARY : Color.White)
        .borderRadius(16).padding({ left: 12, right: 12, top: 8, bottom: 8 });
    }
    .width('100%').justifyContent(this.isCurrentUserMessage(message)
      ? FlexAlign.End : FlexAlign.Start);
  }

  @Builder
  chatBar(): void {
    Row({ space: 8 }) {
      TextInput({
        placeholder: this.vm.canChat ? '输入消息…' : '交易已结束，仅可查看历史消息',
        text: this.vm.chatText
      })
        .enabled(this.vm.canChat).height(44).layoutWeight(1).fontSize('14fp')
        .backgroundColor(this.vm.canChat && !this.vm.sending ? COLOR_PAGE_BG : COLOR_DIVIDER).borderRadius(22)
        .padding({ left: 14, right: 14 })
        .onChange((value: string) => this.vm.chatText = value);
      Button(this.vm.sending ? '…' : '发送').enabled(this.vm.canChat && !this.vm.sending).constraintSize({ minHeight: 44, minWidth: 64 })
        .fontColor(Color.White).backgroundColor(this.vm.canChat && !this.vm.sending ? COLOR_PRIMARY : '#C9CDD4').borderRadius(22)
        .onClick(async () => {
          const success: boolean = await this.vm.send();
          if (!success && this.vm.lastError !== '') {
            this.getUIContext().getPromptAction().showToast({ message: this.vm.lastError, duration: 1500 });
          }
        });
    }
      .width('100%').padding({ left: 16, right: 16, top: 8, bottom: 14 }).backgroundColor(Color.White);
  }

  private isCurrentUserMessage(message: Message): boolean {
    const current: User | null = this.vm.currentUser;
    return current !== null && message.senderId === current.id;
  }

  private showActionToast(success: boolean, successText: string): void {
    this.getUIContext().getPromptAction().showToast({
      message: success ? successText : (this.vm.lastError || '操作失败，请稍后重试'),
      duration: 1500
    });
  }
}
