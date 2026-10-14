import { common } from '@kit.AbilityKit';
import { PublishViewModel } from '../viewmodel/PublishViewModel';
import { CAMPUS_OPTIONS, CONDITION_OPTIONS, PRODUCT_CATEGORIES, publishCategoryHint } from '../common/MarketOptions';
import { formatCondition } from '../common/Utils';
import {
  CONTROL_RADIUS, COLOR_DIVIDER, COLOR_ERROR, COLOR_PAGE_BG, COLOR_PRIMARY, COLOR_SUCCESS,
  COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY, MAX_PRODUCT_PHOTOS
} from '../common/Constants';

@ComponentV2
export struct PublishProductView {
  @Local vm: PublishViewModel = new PublishViewModel();
  @Local pathStack: NavPathStack = new NavPathStack();

  build() {
    NavDestination() {
      Column() {
        Scroll() {
          Column({ space: 16 }) {
            this.photoSection();
            this.fieldLabel('商品标题');
            TextInput({ placeholder: '写出品牌、型号和物品名称', text: this.vm.title })
              .height(50).fontSize('14fp').backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .padding({ left: 14, right: 14 })
              .onChange((value: string) => {
                this.vm.title = value;
                this.vm.titleError = '';
              });
            this.errorText(this.vm.titleError);

            this.fieldLabel('商品描述');
            TextArea({ placeholder: '介绍使用情况和瑕疵；图书馆门口等见面地点也可写在这里', text: this.vm.description })
              .height(118).fontSize('14fp').backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .padding(14)
              .onChange((value: string) => {
                this.vm.description = value;
                this.vm.descriptionError = '';
              });
            this.errorText(this.vm.descriptionError);

            this.fieldLabel('商品价格');
            TextInput({ placeholder: '输入价格（元）', text: this.vm.priceText })
              .type(InputType.NUMBER_DECIMAL).height(50).fontSize('15fp')
              .backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .padding({ left: 14, right: 14 })
              .onChange((value: string) => {
                this.vm.onPriceChanged(value);
              });
            this.errorText(this.vm.priceError);
            if (this.vm.priceError === '' && this.vm.priceOk) {
              Text('金额格式正确').fontSize('12fp').fontColor(COLOR_SUCCESS).width('100%');
            }
            Text('当面交易时付款').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY).width('100%');

            this.fieldLabel('商品类别');
            Select(PRODUCT_CATEGORIES.map((option): SelectOption => ({ value: option.value })))
              .value(this.vm.category || '请选择商品类别').width('100%').height(50).font({ size: '14fp' })
              .backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .onSelect((index: number) => {
                this.vm.category = PRODUCT_CATEGORIES[index].value;
                this.vm.categoryError = '';
              });
            this.errorText(this.vm.categoryError);
            Text(publishCategoryHint(this.vm.category)).fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY).width('100%');

            this.fieldLabel('成色');
            Select(CONDITION_OPTIONS.map((value: string): SelectOption => ({ value: formatCondition(value) })))
              .value(formatCondition(this.vm.condition)).width('100%').height(50).font({ size: '14fp' })
              .backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .onSelect((index: number) => this.vm.condition = CONDITION_OPTIONS[index]);

            this.fieldLabel('所在校区');
            Select(CAMPUS_OPTIONS.map((value: string): SelectOption => ({ value: value })))
              .value(this.vm.campus || '请选择所在校区').width('100%').height(50).font({ size: '14fp' })
              .backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .onSelect((index: number) => {
                this.vm.campus = CAMPUS_OPTIONS[index];
                this.vm.campusError = '';
              });
            this.errorText(this.vm.campusError);
            this.fieldLabel('见面地点（选填）');
            TextInput({ placeholder: '例如：图书馆门口，会追加到商品描述', text: this.vm.meetingPlace })
              .height(50).fontSize('14fp').backgroundColor(Color.White).borderRadius(CONTROL_RADIUS)
              .padding({ left: 14, right: 14 })
              .onChange((value: string) => this.vm.meetingPlace = value);
            Text('当面交易 · 线下付款').fontSize('12fp').fontColor(COLOR_TEXT_SECONDARY)
              .width('100%').padding(14).backgroundColor('#FFF4EB').borderRadius(12)
              .margin({ bottom: 16 });
          }
          .width('100%').padding({ left: 16, right: 16, top: 16 });
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off);
        if (this.vm.formError !== '') {
          Text(this.vm.formError).fontSize('12fp').fontColor(COLOR_ERROR).width('92%').padding({ bottom: 8 });
        }
        Button(this.vm.submitting ? '发布中…' : '发布商品')
          .enabled(!this.vm.submitting).width('92%').height(50)
          .fontSize('16fp').fontWeight(FontWeight.Bold).fontColor(Color.White)
          .backgroundColor(COLOR_PRIMARY).borderRadius(25)
          .onClick(async () => {
            const success: boolean = await this.vm.submit();
            if (success) {
              this.getUIContext().getPromptAction().showToast({ message: '商品发布成功', duration: 1500 });
              this.pathStack.pop();
            }
          });
      }
      .width('100%').height('100%').padding({ bottom: 14 })
      .backgroundColor(COLOR_PAGE_BG);
    }
    .title('发布闲置')
    .onReady((context: NavDestinationContext) => {
      this.pathStack = context.pathStack;
    });
  }

  @Builder
  photoSection(): void {
    Column({ space: 10 }) {
      Column({ space: 4 }) {
        Text('商品照片').fontSize('15fp').fontWeight(FontWeight.Bold)
          .fontColor(COLOR_TEXT_PRIMARY);
        Text(`最多 ${MAX_PRODUCT_PHOTOS} 张 · 第一张为封面`)
          .fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
      }
      .width('100%').alignItems(HorizontalAlign.Start);
      Scroll() {
        Row({ space: 10 }) {
          ForEach(this.vm.images, (source: string, index: number) => {
            Stack() {
              Image(source).width(86).height(86).borderRadius(12).objectFit(ImageFit.Cover);
              Text('×').fontSize('18fp').fontColor(Color.White)
                .backgroundColor('#00000088').borderRadius(11)
                .width(44).height(44).textAlign(TextAlign.Center).align(Alignment.TopEnd)
                .onClick(() => this.vm.removeImage(index));
            }
          }, (source: string, index: number): string => `${source}_${index}`);
          if (this.vm.canAddPhoto) {
            Column({ space: 3 }) {
              Text('+').fontSize('28fp').fontColor(COLOR_PRIMARY);
              Text('添加照片').fontSize('12fp').fontColor(COLOR_TEXT_TERTIARY);
            }
            .width(86).height(86).justifyContent(FlexAlign.Center)
            .border({ width: 1, color: COLOR_DIVIDER, style: BorderStyle.Dashed })
            .borderRadius(12).onClick(() => this.showPhotoActions());
          }
        }
      }
      .width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off);
      if (this.vm.photoError !== '') {
        Text(this.vm.photoError).fontSize('12fp').fontColor(COLOR_ERROR).width('100%');
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding(14).backgroundColor(Color.White).borderRadius(16);
  }

  @Builder
  fieldLabel(label: string): void {
    Text(label).fontSize('14fp').fontWeight(FontWeight.Bold)
      .fontColor(COLOR_TEXT_PRIMARY).width('100%');
  }

  @Builder
  errorText(value: string): void {
    if (value !== '') {
      Text(value).fontSize('12fp').fontColor(COLOR_ERROR).width('100%');
    }
  }

  private showPhotoActions(): void {
    this.getUIContext().showActionSheet({
      title: '添加商品照片',
      message: '选择拍摄照片或从相册选择',
      sheets: [
        {
          title: '拍摄照片',
          action: (): void => {
            const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
            this.vm.takePhoto(context);
          }
        },
        {
          title: '从相册选择',
          action: (): void => {
            this.vm.chooseFromAlbum();
          }
        }
      ]
    });
  }
}
