const BASE_TRANSACTION_FEE_XLM = 0.00001;

export function getOptimisticXlmBalance(currentBalance, amount) {
  const parsedBalance = parseFloat(currentBalance);
  const parsedAmount = parseFloat(amount);
  const nextBalance = parsedBalance - parsedAmount - BASE_TRANSACTION_FEE_XLM;
  return String(nextBalance.toFixed(7));
}
