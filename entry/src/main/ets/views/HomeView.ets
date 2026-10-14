import { Product, User } from '../model/Models';
import { authService } from '../service/AuthenticationService';
import { BuyerHomeViewModel } from '../viewmodel/BuyerHomeViewModel';
import { AgentViewModel } from '../viewmodel/AgentViewModel';
import { ProductCard } from '../components/ProductCard';
import { StateView } from '../components/StateView';
import { SearchSheetView } from './SearchSheetView';
import { AgentSheetView } from './AgentSheetView';
import { AdminSheetView } from './AdminSheetView';
import { HOME_CATEGORIES, homeCategory } from '../common/MarketOptions';
import {
  FONT_TITLE, PAGE_PADDING, GRID_GAP, CONTROL_RADIUS, COLOR_DIVIDER, COLOR_PAGE_BG, COLOR_PRIMARY, COLOR_PRIMARY_SOFT,
  COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY,
  LoadState, ROUTE_PRODUCT_DETAIL, ROUTE_PUBLISH_PAGE, ROUTE_SELLER_HOME, ROUTE_TRADE_LIST
} from '../common/Constants';

@ComponentV2
export struct HomeView {
  @Require @Param pathStack: NavPathStack;
  @Require @Param agentVm: AgentViewModel;
  @Require @Param vm: BuyerHomeViewModel;
  @Local user: User | null = null;
  @Local selectedTab: number = 0;
  @Local category: string = '全部';
  @Local searchSheetVisible: boolean = false;
  @Local agentSheetVisible: boolean = false;
  @Local adminSheetVisible: boolean = false;
  private categories: string[] = HOME_CATEGORIES;
  private feedScroller: Scroller = new Scroller();
  private visibleProductId: string = '';
  private visibleProductIndex: number = 0;

  @Monitor('vm.feedRevision')
  restoreFeedPosition(): void {
    const items: Product[] = this.filteredProducts();
    const index: number = items.findIndex((item: Product): boolean => item.id === this.visibleProductId);
    const target: number = index >= 0 ? index : Math.min(this.visibleProductIndex, items.length - 1);
    if (target >= 0 && this.selectedTab === 0) {
      setTimeout((): void => {
        this.feedScroller.scrollToIndex(target, false, ScrollAlign.START);
      }, 0);
    }
  }

  aboutToAppear(): void {
    this.user = authService.getCurrentUser();
  }

  build() {
    Column() {
      Stack() {
        Column() {
          this.marketHeader();
          this.categoryBar();
          this.productFeed();
        }
        .width('100%').height('100%')
        .visibility(this.selectedTab === 0 ? Visibility.Visible : Visibility.Hidden);
        if (this.selectedTab === 1) {
          this.profilePage();
        }
      }
      .layoutWeight(1).width('100%');
      this.bottomBar();
    }
    .width('100%').height('100%').backgroundColor(COLOR_PAGE_BG);
  }

  @Builder
  marketHeader(): void {
    Column({ space: 14 }) {
      Row() {
        Column({ space: 2 }) {
          Text('校园二手集市').fontSize(FONT_TITLE).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY);
          Text('同校好物 · 当面交易').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Start);
        Column({ space: 2 }) {
          Image($r('app.media.design_bell')).width(20).height(20);
          Text('消息').fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY);
        }
        .width(52).constraintSize({ minHeight: 44 }).justifyContent(FlexAlign.Center)
        .backgroundColor(COLOR_PAGE_BG).borderRadius(16)
        .onClick(() => this.pathStack.pushPathByName(ROUTE_TRADE_LIST, ''));
      }
      .width('100%');
      Row({ space: 10 }) {
        Row({ space: 8 }) {
          Image($r('app.media.design_search')).width(18).height(18);
          Text('搜索高数教材、耳机、台灯').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY)
            .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .layoutWeight(1).height(52).padding({ left: 16, right: 12 })
        .backgroundColor(COLOR_PAGE_BG).borderRadius(CONTROL_RADIUS)
        .onClick(() => this.searchSheetVisible = true)
        .bindSheet($$this.searchSheetVisible, this.searchSheetContent(), {
          detents: [SheetSize.MEDIUM, SheetSize.LARGE]
        });
        Column({ space: 1 }) {
          Image($r('app.media.design_sparkles')).width(18).height(18);
          Text('AI 找物').fontSize('12fp').fontWeight(FontWeight.Bold).fontColor(Color.White);
        }
        .constraintSize({ minWidth: 72, minHeight: 52 }).padding({ left: 8, right: 8 })
        .justifyContent(FlexAlign.Center).backgroundColor(COLOR_PRIMARY).borderRadius(CONTROL_RADIUS)
        .onClick(() => this.agentSheetVisible = true)
        .bindSheet($$this.agentSheetVisible, this.agentSheetContent(), {
          detents: [SheetSize.LARGE], showClose: false
        });
      }
      .width('100%');
    }
    .width('100%').padding({ left: PAGE_PADDING, right: PAGE_PADDING, top: 12, bottom: 16 })
    .backgroundColor(Color.White);
  }

  @Builder
  categoryBar(): void {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(this.categories, (item: string) => {
          Text(item).fontSize('14fp').fontWeight(FontWeight.Medium).constraintSize({ minHeight: 44 })
            .fontColor(this.category === item ? Color.White : COLOR_TEXT_SECONDARY)
            .padding({ left: 17, right: 17, top: 8, bottom: 8 })
            .backgroundColor(this.category === item ? COLOR_PRIMARY : Color.White)
            .borderRadius(18)
            .border({ width: this.category === item ? 0 : 1, color: COLOR_DIVIDER })
            .onClick(() => {
              this.category = item;
              this.visibleProductId = '';
              this.visibleProductIndex = 0;
              this.feedScroller.scrollTo({ xOffset: 0, yOffset: 0 });
            });
        }, (item: string): string => item);
      }
      .padding({ left: PAGE_PADDING, right: PAGE_PADDING });
    }
    .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
    .padding({ top: 8, bottom: 8 });
  }

  @Builder
  productFeed(): void {
    Column({ space: 12 }) {
      Row() {
        Text(this.category === '全部' ? '最新闲置' : `${this.category}好物`)
          .fontSize('16fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY)
          .layoutWeight(1);
      }
      .width('100%');
      if (this.vm.feedError !== '' && this.vm.products.length > 0) {
        Row({ space: 8 }) {
          Text(this.vm.feedError).fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY).layoutWeight(1);
          Button('重试').height(44).fontSize('12fp').fontColor(COLOR_PRIMARY)
            .backgroundColor(COLOR_PRIMARY_SOFT).onClick(() => this.vm.loadFeed(true));
        }
        .width('100%');
      }
      if (this.vm.feedState === LoadState.CONTENT) {
        if (this.filteredProducts().length > 0) {
          this.productGrid(this.filteredProducts());
        } else {
          Column() {
            StateView({ state: LoadState.EMPTY, emptyText: '暂时没有相关商品', emptyHint: '试试其他分类，或用 AI 找物描述需求' });
          }
          .layoutWeight(1).width('100%');
        }
      } else {
        Column() {
          StateView({
            state: this.vm.feedState,
            errorText: this.vm.feedError,
            emptyText: '暂无在售商品',
            emptyHint: '同学还没有发布商品，稍后再来看看吧',
            onRetry: (): void => {
              this.vm.loadFeed(false);
            }
          });
        }
        .layoutWeight(1).width('100%');
      }
    }
    .layoutWeight(1).width('100%').padding({ left: PAGE_PADDING, right: PAGE_PADDING, top: 8, bottom: 8 });
  }

  private filteredProducts(): Product[] {
    if (this.category === '全部') {
      return this.vm.products;
    }
    return this.vm.products.filter((item: Product): boolean => homeCategory(item.category) === this.category);
  }

  @Builder
  productGrid(items: Product[]): void {
    WaterFlow({ scroller: this.feedScroller }) {
      ForEach(items, (item: Product) => {
        FlowItem() {
          ProductCard({
            product: item,
            onCardClick: (product: Product): void => {
              this.pathStack.pushPathByName(ROUTE_PRODUCT_DETAIL, product.id);
            }
          });
        }
      }, (item: Product): string => item.id);
    }
    .columnsTemplate('1fr 1fr').columnsGap(GRID_GAP).rowsGap(GRID_GAP)
    .layoutWeight(1).width('100%').scrollBar(BarState.Off)
    .onScrollIndex((first: number, _last: number) => {
      const items: Product[] = this.filteredProducts();
      if (first >= 0 && first < items.length) {
        this.visibleProductIndex = first;
        this.visibleProductId = items[first].id;
      }
    });
  }

  @Builder
  adminSheetContent(): void {
    AdminSheetView({
      onClose: (): void => {
        this.adminSheetVisible = false;
      }
    });
  }

  @Builder
  profilePage(): void {
    Scroll() {
      Column({ space: 16 }) {
        Text('我的').fontSize(FONT_TITLE).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY)
          .width('100%').margin({ top: 16 });
        Row({ space: 14 }) {
          if (this.user !== null && this.user.avatar !== '') {
            Image(this.user.avatar).width(56).height(56).borderRadius(28);
          } else {
            Text('我').fontSize(FONT_TITLE).fontColor(COLOR_PRIMARY).width(56).height(56)
              .textAlign(TextAlign.Center).backgroundColor(COLOR_PRIMARY_SOFT).borderRadius(28);
          }
          Column({ space: 6 }) {
            Text(this.user === null ? '校园同学' : this.user.nickname)
              .fontSize('18fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY);
            Text('欢迎来到校园二手集市').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
          }
          .alignItems(HorizontalAlign.Start).layoutWeight(1);
        }
        .width('100%').padding(18).backgroundColor(Color.White).borderRadius(16);
        Text('我的闲置').fontSize('15fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY)
          .width('100%').margin({ top: 8 });
        if (this.user !== null && this.user.role === 'admin') {
          Row({ space: 12 }) {
            Column({ space: 4 }) {
              Text('管理后台').fontSize('15fp').fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY);
              Text('下架商品 · 取消或恢复交易').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
            }
            .layoutWeight(1).alignItems(HorizontalAlign.Start);
            Text('›').fontSize('18fp').fontColor(COLOR_TEXT_TERTIARY);
          }
          .width('100%').padding(18).backgroundColor(Color.White).borderRadius(16)
          .onClick(() => this.adminSheetVisible = true)
          .bindSheet($$this.adminSheetVisible, this.adminSheetContent(), {
            detents: [SheetSize.LARGE], showClose: false
          });
        }
        this.profileLink('我发布的', '管理在售商品', ROUTE_SELLER_HOME);
        this.profileLink('我的交易', '查看预约与聊天消息', ROUTE_TRADE_LIST);
        Button('退出登录').width('100%').height(46).margin({ top: 12 })
          .fontSize('14fp').fontColor(COLOR_TEXT_SECONDARY).backgroundColor(Color.White)
          .borderRadius(12).onClick(async () => {
            try {
              await authService.logout();
            } catch (_error) {
            }
            this.user = null;
            this.vm.clear();
            this.agentVm.resetConversation(true);
            this.pathStack.clear();
            this.getUIContext().getRouter().replaceUrl({ url: 'pages/Index' });
          });
      }
      .width('100%').padding({ left: PAGE_PADDING, right: PAGE_PADDING, bottom: 24 });
    }
    .height('100%').width('100%').scrollBar(BarState.Off).backgroundColor(COLOR_PAGE_BG);
  }

  @Builder
  profileLink(title: string, hint: string, route: string): void {
    Row() {
      Column({ space: 5 }) {
        Text(title).fontSize('15fp').fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT_PRIMARY);
        Text(hint).fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start);
      Text('›').fontSize('24fp').fontColor(COLOR_TEXT_TERTIARY);
    }
    .width('100%').padding(18).backgroundColor(Color.White).borderRadius(14)
    .onClick(() => this.pathStack.pushPathByName(route, ''));
  }

  @Builder
  bottomBar(): void {
    Row() {
      this.tabItem(0, '首页');
      Column({ space: 4 }) {
        Text('+').fontSize('28fp').fontColor(Color.White).height(48).width(48)
          .textAlign(TextAlign.Center).backgroundColor(COLOR_PRIMARY).borderRadius(24);
        Text('发布').fontSize('12fp').fontWeight(FontWeight.Bold).fontColor(COLOR_PRIMARY);
      }
      .width(72).onClick(() => this.pathStack.pushPathByName(ROUTE_PUBLISH_PAGE, ''));
      this.tabItem(1, '我的');
    }
    .width('100%').justifyContent(FlexAlign.SpaceAround)
    .padding({ top: 8, bottom: 16 })
    .backgroundColor(Color.White)
    .border({ width: { top: 1 }, color: COLOR_DIVIDER });
  }

  @Builder
  tabItem(index: number, label: string): void {
    Column({ space: 4 }) {
      Image(index === 0 ? (this.selectedTab === 0 ? $r('app.media.design_house_selected') :
        $r('app.media.design_house_idle')) : (this.selectedTab === 1 ? $r('app.media.design_user_selected') :
        $r('app.media.design_user_idle'))).width(22).height(22);
      Text(label).fontSize('12fp').fontWeight(FontWeight.Bold)
        .fontColor(this.selectedTab === index ? COLOR_PRIMARY : COLOR_TEXT_TERTIARY);
    }
    .width(72).constraintSize({ minHeight: 48 }).onClick(() => {
      const changed: boolean = this.selectedTab !== index;
      this.selectedTab = index;
      if (index === 0 && changed) {
        this.vm.loadFeed(true);
      } else {
        this.user = authService.getCurrentUser();
      }
    });
  }

  @Builder
  searchSheetContent(): void {
    SearchSheetView({
      pathStack: this.pathStack,
      onClose: (): void => {
        this.searchSheetVisible = false;
      }
    });
  }

  @Builder
  agentSheetContent(): void {
    AgentSheetView({
      pathStack: this.pathStack,
      vm: this.agentVm,
      onClose: (): void => {
        this.agentSheetVisible = false;
      }
    });
  }
}
