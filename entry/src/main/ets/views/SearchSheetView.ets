import { Product } from '../model/Models';
import { productService, ProductQuery } from '../service/ProductService';
import { ProductCard } from '../components/ProductCard';
import { BROWSE_CATEGORIES, CAMPUS_OPTIONS, PriceFilterOption, PRICE_FILTER_OPTIONS } from '../common/MarketOptions';
import {
  CONTROL_RADIUS, COLOR_PAGE_BG, COLOR_PRIMARY, COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY, ROUTE_PRODUCT_DETAIL
} from '../common/Constants';

@ComponentV2
export struct SearchSheetView {
  @Require @Param pathStack: NavPathStack;
  @Event onClose: () => void = (): void => {
  };
  @Local keyword: string = '';
  @Local results: Product[] = [];
  @Local loading: boolean = false;
  @Local searched: boolean = false;
  @Local error: string = '';
  @Local priceSelections: string[] = [];
  @Local categorySelections: string[] = [];
  @Local campusSelections: string[] = [];
  private timerId: number = -1;
  private searchSeq: number = 0;

  aboutToDisappear(): void {
    this.searchSeq += 1;
    if (this.timerId >= 0) {
      clearTimeout(this.timerId);
    }
  }

  build() {
    Column({ space: 10 }) {
      Text('搜索商品').fontSize('20fp').fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT_PRIMARY)
        .width('100%').margin({ top: 8 });
      TextInput({ placeholder: '搜索高数教材、键盘、台灯', text: this.keyword })
        .height(50).fontSize('14fp').backgroundColor(COLOR_PAGE_BG).borderRadius(CONTROL_RADIUS)
        .padding({ left: 14, right: 14 })
        .onChange((value: string) => {
          this.keyword = value;
          this.error = '';
          this.scheduleSearch();
        })
        .enterKeyType(EnterKeyType.Search)
        .onSubmit(() => this.scheduleSearch());
      this.filterPanel();
      if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(22).height(22).color(COLOR_PRIMARY);
          Text('搜索中…').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY);
        }
        .width('100%').justifyContent(FlexAlign.Center);
      } else if (!this.searched) {
        Text('输入关键词，或在下面选择筛选条件').fontSize('14fp').fontColor(COLOR_TEXT_TERTIARY)
          .width('100%').textAlign(TextAlign.Center).margin({ top: 22 });
      } else if (this.error !== '') {
        Text(this.error).fontSize('14fp').fontColor(COLOR_TEXT_SECONDARY).width('100%').textAlign(TextAlign.Center);
        Button('重试').height(44).fontColor(COLOR_PRIMARY).onClick(() => this.scheduleSearch());
      } else if (this.results.length === 0) {
        Text('无匹配商品').fontSize('16fp').fontColor(COLOR_TEXT_SECONDARY).width('100%')
          .textAlign(TextAlign.Center).margin({ top: 22 });
        Text('换个关键词或放宽筛选条件试试').fontSize('13fp').fontColor(COLOR_TEXT_TERTIARY).width('100%')
          .textAlign(TextAlign.Center);
      } else {
        List({ space: 10 }) {
          ForEach(this.results, (item: Product) => {
            ListItem() {
              ProductCard({
                product: item,
                onCardClick: (product: Product): void => {
                  this.onClose();
                  this.pathStack.pushPathByName(ROUTE_PRODUCT_DETAIL, product.id);
                }
              });
            }
          }, (item: Product): string => item.id);
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off);
      }
    }
    .width('100%').height('100%').padding({ left: 16, right: 16, bottom: 20 });
  }

  @Builder
  filterPanel(): void {
    Column({ space: 8 }) {
      this.priceRow();
      this.categoryRow();
      this.campusRow();
      if (this.hasFilters()) {
        Text('清空筛选').fontSize('12fp').fontColor(COLOR_PRIMARY)
          .onClick(() => this.clearFilters());
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start);
  }

  @Builder
  priceRow(): void {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(PRICE_FILTER_OPTIONS, (option: PriceFilterOption) => {
          Text(option.label).fontSize('12fp')
            .fontColor(this.isSelected(this.priceSelections, option.value) ? Color.White : COLOR_TEXT_SECONDARY)
            .backgroundColor(this.isSelected(this.priceSelections, option.value) ? COLOR_PRIMARY : Color.White)
            .borderRadius(14).padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .onClick(() => {
              this.priceSelections = this.toggle(this.priceSelections, option.value);
              this.scheduleSearch();
            });
        }, (option: PriceFilterOption): string => option.value);
      }
    }
    .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%');
  }

  @Builder
  categoryRow(): void {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(BROWSE_CATEGORIES, (category: string) => {
          Text(category).fontSize('12fp')
            .fontColor(this.isSelected(this.categorySelections, category) ? Color.White : COLOR_TEXT_SECONDARY)
            .backgroundColor(this.isSelected(this.categorySelections, category) ? COLOR_PRIMARY : Color.White)
            .borderRadius(14).padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .onClick(() => {
              this.categorySelections = this.toggle(this.categorySelections, category);
              this.scheduleSearch();
            });
        }, (category: string): string => category);
      }
    }
    .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%');
  }

  @Builder
  campusRow(): void {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(CAMPUS_OPTIONS, (campus: string) => {
          Text(campus).fontSize('12fp')
            .fontColor(this.isSelected(this.campusSelections, campus) ? Color.White : COLOR_TEXT_SECONDARY)
            .backgroundColor(this.isSelected(this.campusSelections, campus) ? COLOR_PRIMARY : Color.White)
            .borderRadius(14).padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .onClick(() => {
              this.campusSelections = this.toggle(this.campusSelections, campus);
              this.scheduleSearch();
            });
        }, (campus: string): string => campus);
      }
    }
    .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%');
  }

  private isSelected(list: string[], value: string): boolean {
    return list.indexOf(value) >= 0;
  }

  private toggle(list: string[], value: string): string[] {
    return list.indexOf(value) >= 0
      ? list.filter((item: string): boolean => item !== value)
      : list.concat([value]);
  }

  private hasFilters(): boolean {
    return this.priceSelections.length > 0 || this.categorySelections.length > 0 || this.campusSelections.length > 0;
  }

  private clearFilters(): void {
    this.priceSelections = [];
    this.categorySelections = [];
    this.campusSelections = [];
    this.scheduleSearch();
  }

  private scheduleSearch(): void {
    this.error = '';
    if (this.timerId >= 0) {
      clearTimeout(this.timerId);
    }
    this.searchSeq += 1;
    const seq: number = this.searchSeq;
    const query: ProductQuery = {
      keyword: this.keyword.trim(),
      categories: this.categorySelections,
      campuses: this.campusSelections,
      priceRanges: this.priceSelections
    };
    if (query.keyword === '' && query.categories.length === 0 &&
      query.campuses.length === 0 && query.priceRanges.length === 0) {
      this.results = [];
      this.searched = false;
      this.loading = false;
      return;
    }
    this.loading = true;
    this.timerId = setTimeout(async () => {
      try {
        const result: Product[] = await productService.searchProducts(query);
        if (seq === this.searchSeq) {
          this.results = result;
          this.searched = true;
        }
      } catch (_error) {
        if (seq === this.searchSeq) {
          this.error = '搜索失败，请稍后重试';
          this.searched = true;
        }
      } finally {
        if (seq === this.searchSeq) {
          this.loading = false;
        }
      }
    }, 280);
  }
}
