const MIN = 0.0000001;
const MAX_DECIMALS = 7;
const BASE_FEE = 0.00001;
const MIN_RESERVE = 1;

export function validateAmount(value: string, availableBalance: number | null): string | null {
  if (!value) return null;
  if (/e/i.test(value)) return 'Scientific notation is not allowed';
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'Amount must be a positive number';
  if (num < MIN) return `Minimum amount is ${MIN} XLM`;
  const decimals = value.includes('.') ? value.split('.')[1].length : 0;
  if (decimals > MAX_DECIMALS) return `Maximum ${MAX_DECIMALS} decimal places allowed`;
  if (availableBalance !== null) {
    // The spendable cap is the balance minus the transaction fee and the
    // Stellar minimum account reserve that must always remain.
    const spendable = availableBalance - BASE_FEE - MIN_RESERVE;
    if (num > spendable)
      return 'Insufficient balance: account must keep a 1 XLM minimum reserve';
  }
  return null;
}

export function formatAmount(value: string): string {
  // Remove leading zeros (but keep "0." prefix)
  return value.replace(/^0+(?=\d)/, '');
}
