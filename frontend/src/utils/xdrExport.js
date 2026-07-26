export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false
  );
}

export function generateStellarLabUrl(xdr, isTestnet = false) {
  const network = isTestnet ? 'testnet' : 'public';
  const params = new URLSearchParams({ xdr, network });
  return `https://laboratory.stellar.org/?tab=xdr-viewer&${params.toString()}`;
}

export function formatXdrForDisplay(xdr, width = 80) {
  if (!xdr) return '';
  const lines = [];
  for (let i = 0; i < xdr.length; i += width) {
    lines.push(xdr.substring(i, i + width));
  }
  return lines.join('\n');
}
