function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function formatTime(timestamp: number): string {
  const date: Date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatPrice(price: number): string {
  return `¥${price}`;
}

export function formatCondition(condition: string | undefined): string {
  if (condition === 'new') {
    return '全新';
  }
  if (condition === 'like_new') {
    return '近乎全新';
  }
  if (condition === 'good') {
    return '成色良好';
  }
  if (condition === 'fair') {
    return '有使用痕迹';
  }
  return '未注明';
}

export function isValidPhone(phone: string): boolean {
  return new RegExp('^\\d{11}$').test(phone.trim());
}

export function isValidSmsCode(code: string): boolean {
  return new RegExp('^\\d{6}$').test(code.trim());
}

export const MAX_PRODUCT_PRICE: number = 99999;

/** Live feedback for the price field; an empty string means no problem found. */
export function priceInputError(text: string): string {
  const value: string = text.trim();
  if (value === '') {
    return '';
  }
  if (!new RegExp('^\\d*\\.?\\d*$').test(value)) {
    return '输入不合法：只能填数字和小数点';
  }
  if (new RegExp('^\\d*\\.$').test(value) || value === '.') {
    // Still typing the decimal part.
    return '';
  }
  if (new RegExp('^\\d+\\.\\d{3,}$').test(value)) {
    return '最多保留两位小数';
  }
  if (!new RegExp('^\\d+(\\.\\d{1,2})?$').test(value)) {
    return '输入不合法';
  }
  const amount: number = Number(value);
  if (amount <= 0) {
    return '金额必须大于 0';
  }
  if (amount > MAX_PRODUCT_PRICE) {
    return `不能超过 ${MAX_PRODUCT_PRICE} 元`;
  }
  return '';
}

export function isValidPrice(text: string): boolean {
  const value: string = text.trim();
  if (!new RegExp('^\\d+(\\.\\d{1,2})?$').test(value)) {
    return false;
  }
  const amount: number = Number(value);
  return amount > 0 && amount <= MAX_PRODUCT_PRICE;
}

export function parsePrice(text: string): number {
  return Number(text.trim());
}
