const MIN = 0.0000001;
const MAX_DECIMALS = 7;

export function validateAmount(value, availableBalance) {
  if (!value) return null;
  if (/e/i.test(value)) return 'Scientific notation is not allowed';
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'Amount must be a positive number';
  if (num < MIN) return `Minimum amount is ${MIN} XLM`;
  const decimals = value.includes('.') ? value.split('.')[1].length : 0;
  if (decimals > MAX_DECIMALS) return `Maximum ${MAX_DECIMALS} decimal places allowed`;
  if (availableBalance !== null && num > availableBalance) return 'Amount exceeds available balance';
  return null;
}

export function formatAmount(value) {
  // Remove leading zeros (but keep "0." prefix)
  return value.replace(/^0+(?=\d)/, '');
}
