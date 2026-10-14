const equivalents = [
  ['数学', '高数', '高等数学', '微积分'],
  ['英语', '英文', 'english'],
  ['书', '书籍', '课本', '教材', 'book', 'books', 'textbook', 'textbooks'],
  ['键盘', 'keyboard'], ['鼠标', 'mouse'], ['耳机', 'headphone', 'headphones', 'earphone', 'earphones'],
  ['显示器', 'monitor'], ['自行车', '单车', 'bicycle', 'bike'],
  ['线代', '线性代数', '概率论', '概率统计', '数理统计'],
  ['物理', '大学物理', 'physics'], ['化学', 'chemistry'],
  ['电脑', '笔记本', '笔记本电脑', 'laptop', 'notebook'], ['手机', 'mobile', 'phone'],
  ['平板', '平板电脑', 'tablet'], ['台灯', '护眼灯'],
  ['充电器', '充电头', 'charger'], ['音箱', '音响', 'speaker'],
  ['水杯', '保温杯'], ['雨伞', '伞'], ['球拍', '羽毛球拍', '网球拍']
];

/** Expand known equivalents within a term; separate terms must still all match. */
export function keywordGroups(keyword: string): string[][] {
  const normalized = keyword.toLowerCase().replace(/(英语|英文)(书籍|课本|教材|书)/gu, '$1 $2');
  return normalized.split(/\s+/u).filter(Boolean).slice(0, 8)
    .map(term => equivalents.find(aliases => aliases.includes(term)) ?? [term]);
}

// Keep these storage/display groups aligned with the App's MarketOptions.
const categoryGroups = [
  { category: '教材', members: ['教材', '图书', '书籍'] },
  { category: '数码', members: ['数码', '手机', '电脑', '平板', '相机', '计算器'] },
  { category: '外设', members: ['外设', '键盘', '鼠标', '耳机', '显示器', '音箱', '充电器'] },
  { category: '日用', members: ['日用', '生活', '生活用品', '台灯', '收纳'] },
  { category: '运动', members: ['运动', '出行', '自行车', '单车', '运动用品'] },
  { category: '其他', members: ['其他'] }
];

export function categorySearchSpec(category: string): { exact: string[]; grouped?: { category: string; keywords: string[] } } {
  const group = categoryGroups.find(item => item.members.includes(category));
  if (!group) return { exact: [category] };
  if (category === group.category || ['生活', '生活用品', '出行', '运动用品', '图书', '书籍'].includes(category)) {
    return { exact: group.members };
  }
  const keywords = keywordGroups(category)[0] ?? [category];
  return {
    exact: group.members.filter(value => keywords.includes(value)),
    grouped: { category: group.category, keywords }
  };
}
