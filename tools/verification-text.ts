export function normalizeCheckoutText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
