export const usd = (n: number): string => {
	const a = Math.abs(n);
	if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
	if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
	if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
	if (a >= 10) return '$' + n.toFixed(0);
	return '$' + n.toFixed(2);
};

export const grouped = (n: number, digits = 0): string =>
	n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Round to a "nice" 1 / 2 / 2.5 / 5 × 10^k step. */
export function niceStep(raw: number): number {
	const e = Math.pow(10, Math.floor(Math.log10(raw)));
	const f = raw / e;
	const m = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
	return m * e;
}

export const shortAddr = (a?: string): string => (a && a.length > 8 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');

export const utc = (): string => new Date().toISOString().slice(11, 19);
