import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { POOL } from '$lib/server/osiris';

// Live trade tape from GeckoTerminal, proxied + lightly cached so every
// viewer of the battlefield pulls the same synchronized feed.
let cache: { at: number; body: unknown } | null = null;
const TTL = 5000;

export const GET: RequestHandler = async () => {
	if (cache && Date.now() - cache.at < TTL) return json(cache.body);
	try {
		const res = await fetch(
			`https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL()}/trades`,
			{ headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
		const data = await res.json();
		const trades = (data?.data || []).map((t: any) => {
			const a = t.attributes;
			const buy = a.kind === 'buy';
			return {
				tx: a.tx_hash,
				wallet: a.tx_from_address,
				kind: a.kind as 'buy' | 'sell',
				usd: Number(a.volume_in_usd) || 0,
				// $OSIRIS priced in SOL at execution
				priceNative: Number(buy ? a.price_to_in_currency_token : a.price_from_in_currency_token) || 0,
				ts: Math.floor(new Date(a.block_timestamp).getTime() / 1000)
			};
		});
		const body = { trades, updatedAt: Date.now() };
		cache = { at: Date.now(), body };
		return json(body);
	} catch (e) {
		if (cache) return json(cache.body);
		return json({ error: (e as Error).message, trades: [] }, { status: 502 });
	}
};
