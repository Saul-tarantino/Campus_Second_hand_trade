import { AgentConversationSummary, AgentRecommendation, Product } from '../model/Models';
import { AgentConversationTurn, AgentViewModel } from '../viewmodel/AgentViewModel';
import { ProductCard } from '../components/ProductCard';
import { formatTime } from '../common/Utils';
import { COLOR_ERROR, COLOR_PAGE_BG, COLOR_PRIMARY, COLOR_PRIMARY_SOFT, COLOR_PRIMARY_STRONG, COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY, CONTROL_RADIUS, SHEET_ACTION_HEIGHT, ROUTE_PRODUCT_DETAIL } from '../common/Constants';

@ComponentV2
export struct AgentSheetView {
  @Require @Param pathStack: NavPathStack;
  @Require @Param vm: AgentViewModel;
  @Event onClose: () => void = (): void => {
  };
  private chatScroller: Scroller = new Scroller();
  private inputController: TextInputController = new TextInputController();

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('AI 找物').fontSize('20fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY)
          .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
        Button(this.vm.historyVisible ? '返回对话' : '历史', { type: ButtonType.Normal }).fontSize('14fp')
          .fontWeight(FontWeight.Medium).fontColor(COLOR_PRIMARY).backgroundColor(COLOR_PRIMARY_SOFT)
          .height(SHEET_ACTION_HEIGHT).padding({ left: 12, right: 12 }).borderRadius(CONTROL_RADIUS)
          .onClick(() => {
            if (this.vm.historyVisible) {
              this.vm.historyVisible = false;
            } else {
              this.vm.historyVisible = true;
              this.vm.loadHistory();
            }
          });
        if (this.vm.turns.length > 0) {
          Button('新对话', { type: ButtonType.Normal }).fontSize('14fp').fontWeight(FontWeight.Medium)
            .fontColor(Color.White).backgroundColor(COLOR_PRIMARY_STRONG)
            .height(SHEET_ACTION_HEIGHT).padding({ left: 12, right: 12 }).borderRadius(CONTROL_RADIUS)
            .enabled(!this.vm.loading)
            .onClick(() => this.vm.resetConversation());
        }
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.design_close')).width(20).height(20);
        }
        .width(SHEET_ACTION_HEIGHT).height(SHEET_ACTION_HEIGHT)
        .backgroundColor('#E5E4E1').borderRadius(CONTROL_RADIUS)
        .accessibilityText('关闭 AI 找物').onClick(() => this.onClose());
      }
      .width('100%').alignItems(VerticalAlign.Center).margin({ top: 8 });
      Text('描述商品、预算或校区，支持继续补充条件').fontSize('12fp')
        .fontColor(COLOR_TEXT_SECONDARY).width('100%');

      if (this.vm.historyVisible) {
        this.historyPanel();
      } else if (this.vm.turns.length === 0 && !this.vm.loading) {
        Column({ space: 8 }) {
          Text('试试这样问').fontSize('16fp').fontWeight(FontWeight.Medium)
            .fontColor(COLOR_TEXT_PRIMARY);
          this.suggestion('帮我找 80 元以内的高等数学教材');
          this.suggestion('想买可以当面交易的二手台灯');
          this.suggestion('预算 200 元，有什么成色较好的耳机？');
        }
        .layoutWeight(1).width('100%').justifyContent(FlexAlign.Center);
      } else {
        List({ space: 14, scroller: this.chatScroller }) {
          ForEach(this.vm.turns, (turn: AgentConversationTurn) => {
            ListItem() {
              this.turnContent(turn);
            }
          }, (turn: AgentConversationTurn): string => turn.id);
          if (this.vm.loading) {
            ListItem() {
              Column({ space: 10 }) {
                Row() {
                  Text(this.vm.query).fontSize('14fp').fontColor(Color.White).lineHeight(20)
                    .width('82%').padding(12).backgroundColor(COLOR_PRIMARY).borderRadius(12);
                }
                .width('100%').justifyContent(FlexAlign.End);
                Row({ space: 8 }) {
                  LoadingProgress().width(20).height(20).color(COLOR_PRIMARY);
                  Text('正在为你查找…').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY);
                }
                .width('100%');
              }
              .width('100%');
            }
          }
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off)
        .onAppear(() => this.scrollToLatest());
      }

      if (this.vm.error !== '') {
        Text(this.vm.error).fontSize('12fp').fontColor(COLOR_ERROR).width('100%');
      }
      Row({ space: 8 }) {
        TextInput({ placeholder: '继续提问或补充条件', text: this.vm.query, controller: this.inputController })
          .height(48).layoutWeight(1).fontSize('14fp').backgroundColor(COLOR_PAGE_BG).borderRadius(24)
          .padding({ left: 12, right: 12 })
          .onChange((value: string) => {
            this.vm.query = value;
            this.vm.error = '';
          });
        Button(this.vm.loading ? '…' : '发送').enabled(!this.vm.loading).height(48).fontColor(Color.White)
          .backgroundColor(COLOR_PRIMARY).borderRadius(24)
          .onClick(() => this.sendMessage());
      }
      .width('100%');
    }
    .width('100%').height('100%').padding({ left: 16, right: 16, bottom: 20 });
  }

  @Builder
  historyPanel(): void {
    Column({ space: 8 }) {
      Row() {
        Text('历史对话').fontSize('15fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY).layoutWeight(1);
        Text('最多保留 5 条').fontSize('11fp').fontColor(COLOR_TEXT_TERTIARY);
      }
      .width('100%');
      if (this.vm.historyLoading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color(COLOR_PRIMARY);
          Text('加载中…').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY);
        }
        .width('100%').justifyContent(FlexAlign.Center).margin({ top: 20 });
      } else if (this.vm.historyError !== '') {
        Text(this.vm.historyError).fontSize('13fp').fontColor(COLOR_ERROR)
          .width('100%').textAlign(TextAlign.Center).margin({ top: 16 });
        Button('重试').height(44).fontColor(COLOR_PRIMARY).onClick(() => this.vm.loadHistory());
      } else if (this.vm.history.length === 0) {
        Text('还没有历史对话').fontSize('14fp').fontColor(COLOR_TEXT_TERTIARY)
          .width('100%').textAlign(TextAlign.Center).margin({ top: 24 });
      } else {
        List({ space: 8 }) {
          ForEach(this.vm.history, (item: AgentConversationSummary) => {
            ListItem() {
              Row({ space: 10 }) {
                Column({ space: 4 }) {
                  Text(item.title).fontSize('14fp').fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY)
                    .width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
                  Text(`${formatTime(item.updatedAt)} · ${item.messageCount} 条消息`).fontSize('11fp')
                    .fontColor(COLOR_TEXT_TERTIARY).width('100%');
                  if (item.lastMessage !== undefined && item.lastMessage !== '') {
                    Text(item.lastMessage).fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY)
                      .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis });
                  }
                }
                .layoutWeight(1).alignItems(HorizontalAlign.Start)
                .onClick(() => this.openHistory(item));
                Button('删除', { type: ButtonType.Normal }).fontSize('12fp').fontColor(COLOR_ERROR)
                  .backgroundColor(COLOR_PAGE_BG).height(36).padding({ left: 10, right: 10 })
                  .borderRadius(CONTROL_RADIUS).onClick(() => this.removeHistory(item));
              }
              .width('100%').padding(12).backgroundColor(Color.White).borderRadius(CONTROL_RADIUS);
            }
          }, (item: AgentConversationSummary): string => item.sessionId);
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off);
      }
    }
    .layoutWeight(1).width('100%').alignItems(HorizontalAlign.Start);
  }

  private async openHistory(item: AgentConversationSummary): Promise<void> {
    const opened: boolean = await this.vm.openConversation(item.sessionId);
    if (!opened) {
      this.getUIContext().getPromptAction().showToast({ message: this.vm.error || '打开对话失败', duration: 1500 });
    }
  }

  private async removeHistory(item: AgentConversationSummary): Promise<void> {
    const removed: boolean = await this.vm.deleteConversation(item.sessionId);
    this.getUIContext().getPromptAction().showToast({
      message: removed ? '已删除' : (this.vm.error || '删除失败，请稍后重试'), duration: 1500
    });
  }

  @Builder
  suggestion(prompt: string): void {
    Text(prompt).fontSize('13fp').fontColor(COLOR_TEXT_SECONDARY)
      .width('100%').padding(12).backgroundColor(Color.White).borderRadius(12)
      .onClick(() => {
        this.vm.query = prompt;
        this.sendMessage();
      });
  }

  @Builder
  turnContent(turn: AgentConversationTurn): void {
    Column({ space: 10 }) {
      Row() {
        Text(turn.question).fontSize('14fp').lineHeight(20).fontColor(Color.White)
          .width('82%').padding(12).backgroundColor(COLOR_PRIMARY).borderRadius(12);
      }
      .width('100%').justifyContent(FlexAlign.End);
      Text(turn.replyLead).fontSize('14fp').lineHeight(21).fontColor(COLOR_TEXT_PRIMARY)
        .width('100%').padding(12).backgroundColor(Color.White).borderRadius(12);
      if (turn.recommendations.length > 0) {
        Text(`推荐商品 · ${turn.recommendations.length} 件`).fontSize('14fp')
          .fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY).width('100%');
        Column({ space: 10 }) {
          ForEach(turn.recommendations, (item: AgentRecommendation) => {
            Row() {
              if (item.product !== null) {
                ProductCard({
                  product: item.product,
                  onCardClick: (product: Product): void => {
                    this.onClose();
                    this.pathStack.pushPathByName(ROUTE_PRODUCT_DETAIL, product.id);
                  }
                });
              } else {
                Column({ space: 5 }) {
                  Text('商品信息暂时无法加载').fontSize('14fp').fontWeight(FontWeight.Medium)
                    .fontColor(COLOR_TEXT_PRIMARY);
                  Text('点击查看详情').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
                }
                .width('100%').padding(12).backgroundColor(Color.White).borderRadius(12)
                .onClick(() => {
                  this.onClose();
                  this.pathStack.pushPathByName(ROUTE_PRODUCT_DETAIL, item.listingId);
                });
              }
            }
          }, (item: AgentRecommendation): string => item.listingId);
        }
        .width('100%');
      }
      if (turn.replyDetail !== '') {
        Text(turn.replyDetail).fontSize('13fp').lineHeight(20).fontColor(COLOR_TEXT_SECONDARY)
          .width('100%').padding(12).backgroundColor(Color.White).borderRadius(12);
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start);
  }

  private async sendMessage(): Promise<void> {
    if (this.vm.query.trim() !== '') {
      this.inputController.stopEditing();
    }
    const success: boolean = await this.vm.send();
    if (success) {
      this.scrollToLatest();
    }
  }

  private scrollToLatest(): void {
    setTimeout(() => {
      if (this.vm.turns.length > 0) {
        this.chatScroller.scrollToIndex(this.vm.turns.length - 1, true, ScrollAlign.START);
      }
    }, 80);
  }
}
