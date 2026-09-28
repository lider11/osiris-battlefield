// $OSIRIS theater. The token trades against SOL in a PumpSwap constant-product
// pool, so its USD market cap is (pool price in SOL) × (live SOL/USD) × supply.
// SOL/USD streams every second from Coinbase (Kraken as fallback), which keeps the
// front line alive between $OSIRIS trades exactly as the real USD price moves.
// Pool depth is the exact x·y=k curve from the pool's reserves.

import type { Depth, FeedHandlers, MarketFeed } from './types';
import { LiveSocket } from './socket';
import { OSIRIS } from './theaters';

type Pool = {
	priceNative: number;
	solUsd: number;
	supply: number;
	liquidity: { usd: number; base: number; quote: number };
	change: { m5: number; h1: number; h24: number };
};

type Trade = { tx: string; wallet: string; kind: 'buy' | 'sell'; usd: number; priceNative: number; ts: number };

const BAND = 0.1; // ±10% of market cap for walls + depth chart
const POINTS = 48;

export class OsirisFeed implements MarketFeed {
	readonly sources = [{ id: 'pumpswap', label: 'PumpSwap pool' }];
	private h!: FeedHandlers;
	private timers: ReturnType<typeof setInterval>[] = [];
	private sockets: LiveSocket[] = [];
	private stopped = false;

	private pool: Pool | null = null;
	private base = 0; // $OSIRIS reserve
	private quote = 0; // SOL reserve
	private priceNative = 0;
	private sol = 0;
	private solAt = 0;
	private solSamples: { t: number; p: number }[] = [];
	private trades: Trade[] = [];
	private seen = new Set<string>();
	private primed = false;
	// after a trade we move the price ourselves; ignore pool snapshots that
	// still show the pre-trade price until the indexer catches up
	private stalePrice = 0;
	private staleUntil = 0;
	private lastQuote = 0;

	private startedAt = 0;

	start(h: FeedHandlers) {
		this.h = h;
		this.startedAt = Date.now();
		h.status('Reading the PumpSwap pool…');
		const onSol = (p: number) => {
			if (!(p > 0)) return;
			this.sol = p;
			this.solAt = Date.now();
		};
		const cb = new LiveSocket('wss://ws-feed.exchange.coinbase.com', {
			onOpen: (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['SOL-USD'], channels: ['ticker'] })),
			onMessage: (d) => d.type === 'ticker' && onSol(Number(d.price))
		});
		const kr = new LiveSocket('wss://ws.kraken.com/v2', {
			onOpen: (ws) => ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: ['SOL/USD'] } })),
			// only used while Coinbase is quiet
			onMessage: (d) => {
				if (d.channel === 'ticker' && Array.isArray(d.data) && Date.now() - this.solAt > 5000) onSol(Number(d.data[0]?.last));
			}
		});
		this.sockets = [cb, kr];
		for (const s of this.sockets) s.open();

		this.loadPool();
		this.loadTrades();
		this.timers.push(setInterval(() => this.loadPool(), 10_000));
		this.timers.push(setInterval(() => this.loadTrades(), 5_000));
		this.timers.push(setInterval(() => this.emitQuote(), 250));
		this.timers.push(setInterval(() => this.emitDepth(), 1000));
		this.timers.push(
			setInterval(() => {
				h.status(cb.up || kr.up ? `PumpSwap · SOL/USD ${cb.up ? 'Coinbase' : 'Kraken'} live` : 'PumpSwap · SOL/USD reconnecting…');
			}, 3000)
		);
	}

	setSource() {}

	stop() {
		this.stopped = true;
		for (const t of this.timers) clearInterval(t);
		for (const s of this.sockets) s.close();
	}

	private solUsd(): number {
		// live SOL/USD, else the pool's implied SOL price
		return this.sol || this.pool?.solUsd || 0;
	}

	private async loadPool() {
		try {
			const r = await fetch('/api/pool');
			if (!r.ok || this.stopped) return;
			const p: Pool = await r.json();
			if (!p.priceNative) return;
			this.pool = p;
			const stale = Date.now() < this.staleUntil && Math.abs(p.priceNative - this.stalePrice) / this.stalePrice < 1e-9;
			if (!stale) {
				this.priceNative = p.priceNative;
				this.base = p.liquidity.base;
				this.quote = p.liquidity.quote;
				this.staleUntil = 0;
			}
		} catch {
			/* keep the last pool */
		}
	}

	private async loadTrades() {
		try {
			const r = await fetch('/api/trades');
			if (!r.ok || this.stopped) return;
			const d = await r.json();
			const list: Trade[] = (d.trades || []).slice().sort((a: Trade, b: Trade) => a.ts - b.ts);
			const fresh: Trade[] = [];
			for (const t of list) {
				const key = `${t.tx}:${t.kind}:${t.usd}`;
				if (this.seen.has(key)) continue;
				this.seen.add(key);
				fresh.push(t);
			}
			this.trades = list;
			if (!this.primed) {
				// the recent tape seeds the feed but doesn't replay as live fire
				this.primed = true;
				for (const t of fresh.slice(-10)) this.emitTrade(t, true);
				return;
			}
			for (const t of fresh) {
				this.applyTrade(t);
				this.emitTrade(t, false);
			}
		} catch {
			/* next poll */
		}
	}

	private emitTrade(t: Trade, history: boolean) {
		this.h.event({
			type: 'trade',
			side: t.kind,
			usd: t.usd,
			venue: 'PumpSwap',
			wallet: t.wallet,
			tx: t.tx,
			ts: t.ts * 1000,
			history
		});
	}

	/** Move the pool along x·y = k by this trade so the front reacts on the print. */
	private applyTrade(t: Trade) {
		const sol = this.solUsd();
		if (!this.base || !this.quote || !sol) {
			if (t.priceNative) this.priceNative = t.priceNative;
			return;
		}
		const k = this.base * this.quote;
		const dq = t.usd / sol;
		const q = t.kind === 'buy' ? this.quote + dq : Math.max(this.quote * 0.05, this.quote - dq);
		this.stalePrice = this.pool?.priceNative ?? this.priceNative;
		this.staleUntil = Date.now() + 120_000;
		this.quote = q;
		this.base = k / q;
		this.priceNative = q / this.base;
	}

	private marketCap(): number {
		const sol = this.solUsd();
		if (!this.priceNative || !sol || !this.pool?.supply) return 0;
		return this.priceNative * sol * this.pool.supply;
	}

	private emitQuote() {
		// give the live SOL/USD stream a moment so the first battle isn't centred
		// on the pool's stale implied SOL price
		if (!this.sol && Date.now() - this.startedAt < 5000) return;
		const mc = this.marketCap();
		if (!mc) return;
		const now = Date.now();
		if (this.sol && (!this.solSamples.length || now - this.solSamples[this.solSamples.length - 1].t >= 1000)) {
			this.solSamples.push({ t: now, p: this.sol });
			if (this.solSamples.length > 61) this.solSamples.shift();
		}
		if (mc === this.lastQuote) return;
		this.lastQuote = mc;
		const price = this.priceNative * this.solUsd();
		this.h.quote({
			price: mc,
			change24h: this.pool?.change.h24 ?? 0,
			sub: `$${price.toPrecision(4)} · SOL $${this.solUsd().toFixed(2)}`
		});
	}

	private emitDepth() {
		const mc = this.marketCap();
		const sol = this.solUsd();
		if (!mc || !this.quote) return;
		// constant product: taking the price from P to p moves y·|1 − √(p/P)| SOL
		const bids = [{ p: mc, c: 0 }];
		const asks = [{ p: mc, c: 0 }];
		for (let i = 1; i <= POINTS; i++) {
			const f = (BAND * i) / POINTS;
			bids.push({ p: mc * (1 - f), c: this.quote * (1 - Math.sqrt(1 - f)) * sol });
			asks.push({ p: mc * (1 + f), c: this.quote * (Math.sqrt(1 + f) - 1) * sol });
		}
		const depth: Depth = { mid: mc, bids, asks, lo: mc * (1 - BAND), hi: mc * (1 + BAND) };

		const now = Date.now() / 1000;
		const liquidity = this.pool?.liquidity.usd ?? 0;
		const heavyMin = OSIRIS.tiers(liquidity).tank; // "heavy" = a tank-sized trade or more
		let flowBuy = 0;
		let flowSell = 0;
		let heavyBuy = 0;
		let heavySell = 0;
		for (const t of this.trades) {
			const age = now - t.ts;
			if (age < 3600) t.kind === 'buy' ? (flowBuy += t.usd) : (flowSell += t.usd);
			if (age < 86_400 && t.usd >= heavyMin) t.kind === 'buy' ? (heavyBuy += t.usd) : (heavySell += t.usd);
		}
		let solRange = 0;
		if (this.solSamples.length > 5) {
			let lo = Infinity;
			let hi = 0;
			for (const s of this.solSamples) {
				lo = Math.min(lo, s.p);
				hi = Math.max(hi, s.p);
			}
			solRange = (hi - lo) / hi;
		}
		const volatility = Math.min(1, Math.abs(this.pool?.change.h1 ?? 0) / 6 + solRange / 0.004);
		this.h.depth(depth, {
			bidWall: bids[bids.length - 1].c,
			askWall: asks[asks.length - 1].c,
			flowBuy,
			flowSell,
			heavyBuy,
			heavySell,
			volatility,
			liquidity
		});
	}
}
