/** Publishing and browsing use the same six categories; old values are mapped for display. */
export const HOME_CATEGORIES: string[] = ['全部', '教材', '数码', '外设', '日用', '运动', '其他'];
export interface CategoryOption {
  value: string;
  group: string;
  hint: string;
}
export const PRODUCT_CATEGORIES: CategoryOption[] = [
  { value: '教材', group: '教材', hint: '课本、参考书、学习资料等' },
  { value: '数码', group: '数码', hint: '手机、电脑、平板、相机、计算器等' },
  { value: '外设', group: '外设', hint: '键盘、鼠标、耳机、显示器、音箱、充电器等' },
  { value: '日用', group: '日用', hint: '台灯、收纳、生活用品等' },
  { value: '运动', group: '运动', hint: '自行车、球类、健身与户外用品等' },
  { value: '其他', group: '其他', hint: '不属于以上类别的闲置物品' }
];
export const CAMPUS_OPTIONS: string[] = ['江湾校区', '邯郸校区', '张江校区', '枫林校区'];
export const CONDITION_OPTIONS: string[] = ['new', 'like_new', 'good', 'fair', 'unknown'];

/** Price filter values use the `min-max` yuan format understood by the business API. */
export interface PriceFilterOption {
  value: string;
  label: string;
}

export const PRICE_FILTER_OPTIONS: PriceFilterOption[] = [
  { value: '0-0.99', label: '1 元以下' },
  { value: '1-10', label: '1-10 元' },
  { value: '10-50', label: '10-50 元' },
  { value: '50-100', label: '50-100 元' },
  { value: '100-300', label: '100-300 元' },
  { value: '300-', label: '300 元以上' }
];

export const BROWSE_CATEGORIES: string[] = ['教材', '数码', '外设', '日用', '运动', '其他'];

export function homeCategory(category: string | undefined): string {
  const value: string = (category || '').trim();
  for (const option of PRODUCT_CATEGORIES) {
    if (option.value === value) {
      return option.group;
    }
  }
  if (['图书', '书籍'].includes(value)) return '教材';
  if (['手机', '电脑', '平板', '相机', '计算器'].includes(value)) return '数码';
  if (['耳机', '键盘', '鼠标', '显示器', '音箱', '充电器'].includes(value)) return '外设';
  if (['生活', '生活用品', '台灯', '收纳'].includes(value)) return '日用';
  if (['出行', '自行车', '单车', '运动用品'].includes(value)) return '运动';
  return '其他';
}

export function publishCategoryHint(category: string): string {
  const option: CategoryOption | undefined = PRODUCT_CATEGORIES.find((item: CategoryOption): boolean => item.value === category);
  return option === undefined ? '按物品用途选择类别，具体名称填写在商品标题中。' : option.hint;
}

export function isPublishCategory(category: string): boolean {
  return PRODUCT_CATEGORIES.some((option: CategoryOption): boolean => option.value === category);
}
