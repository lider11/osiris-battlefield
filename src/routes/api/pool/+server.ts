import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MINT, POOL } from '$lib/server/osiris';

// The $OSIRIS PumpSwap pool: spot price in SOL, reserves (for the constant-product
// depth curve), supply and 24h stats. From DexScreener, cached for all viewers.
let cache: { at: number; body: unknown } | null = null;
const TTL = 8000;

export const GET: RequestHandler = async () => {
	if (cache && Date.now() - cache.at < TTL) return json(cache.body);
	try {
		const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT()}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`DexScreener ${res.status}`);
		const data = await res.json();
		const pairs: any[] = data?.pairs || [];
		const p =
			pairs.find((x) => x.pairAddress === POOL()) ||
			pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
		if (!p) return json({ error: 'no market data' }, { status: 404 });

		const priceUsd = Number(p.priceUsd) || 0;
		const priceNative = Number(p.priceNative) || 0;
		const marketCap = p.marketCap || p.fdv || 0;
		const body = {
			symbol: p.baseToken?.symbol || 'OSIRIS',
			dex: p.dexId,
			pair: p.pairAddress,
			priceUsd,
			priceNative,
			solUsd: priceNative ? priceUsd / priceNative : 0,
			marketCap,
			supply: priceUsd ? marketCap / priceUsd : 0,
			liquidity: { usd: p.liquidity?.usd || 0, base: p.liquidity?.base || 0, quote: p.liquidity?.quote || 0 },
			change: { m5: p.priceChange?.m5 ?? 0, h1: p.priceChange?.h1 ?? 0, h24: p.priceChange?.h24 ?? 0 },
			volume24h: p.volume?.h24 || 0,
			buys24h: p.txns?.h24?.buys ?? 0,
			sells24h: p.txns?.h24?.sells ?? 0,
			url: p.url,
			updatedAt: Date.now()
		};
		cache = { at: Date.now(), body };
		return json(body);
	} catch (e) {
		if (cache) return json(cache.body);
		return json({ error: (e as Error).message }, { status: 502 });
	}
};
