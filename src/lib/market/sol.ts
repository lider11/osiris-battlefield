// SOL theater: live spot order books (Coinbase, Kraken, Binance), the trade tape,
// and perp liquidations (Binance, Bybit, OKX) — all public WebSockets, straight
// from the browser. Mirrors the Newhedge battlefield's inputs, for Solana.
//
// A big market order fills as a spray of small prints, so each venue's taker
// prints are summed per side over one-second windows: the sum is the order that
// hit the book, and that is what deploys armour and calls in strikes.

import type { Depth, FeedHandlers, Forces, MarketFeed, Venue } from './types';
import { LiveSocket, Rolling } from './socket';

type Book = { bids: Map<number, number>; asks: Map<number, number>; at: number };

const BAND = 0.01; // ±1% of mid for walls + depth chart
const BUCKETS = 64;
const EMIT_TRADE = 2_000; // smaller one-second bursts only feed the flow meters (= the squad tier)
const HEAVY = 15_000; // "heavy" flow = tank-sized bursts and up

const newBook = (): Book => ({ bids: new Map(), asks: new Map(), at: 0 });

function bestBid(b: Book) {
	let m = 0;
	for (const p of b.bids.keys()) if (p > m) m = p;
	return m;
}
function bestAsk(b: Book) {
	let m = Infinity;
	for (const p of b.asks.keys()) if (p < m) m = p;
	return m;
}

export class SolFeed implements MarketFeed {
	readonly sources = [
		{ id: 'agg', label: 'Aggregated spot' },
		{ id: 'binance', label: 'Binance' },
		{ id: 'coinbase', label: 'Coinbase' },
		{ id: 'kraken', label: 'Kraken' }
	];
	private source = 'agg';
	private h!: FeedHandlers;
	private sockets: LiveSocket[] = [];
	private timers: ReturnType<typeof setInterval>[] = [];
	private books: Record<'coinbase' | 'kraken' | 'binance', Book> = {
		coinbase: newBook(),
		kraken: newBook(),
		binance: newBook()
	};
	private lastTrade = 0;
	private open24 = 0;
	private flowBuy = new Rolling(60_000);
	private flowSell = new Rolling(60_000);
	private heavyBuy = new Rolling(600_000);
	private heavySell = new Rolling(600_000);
	private mids: { t: number; p: number }[] = [];
	private lastQuote = 0;
	private bursts = new Map<string, number>();

	// Binance diff-depth needs a REST snapshot stitched onto the stream
	private bnBuffer: any[] = [];
	private bnLastId = 0;
	private bnSynced = false;
	private bnSnapshotPending = false;
	private bnBlocked = false;

	start(h: FeedHandlers) {
		this.h = h;
		h.status('Connecting to exchanges…');

		const cb = new LiveSocket('wss://ws-feed.exchange.coinbase.com', {
			onOpen: (ws) =>
				ws.send(
					JSON.stringify({ type: 'subscribe', product_ids: ['SOL-USD'], channels: ['matches', 'ticker', 'level2_batch'] })
				),
			onMessage: (d) => this.coinbase(d)
		});
		const kr = new LiveSocket('wss://ws.kraken.com/v2', {
			onOpen: (ws) => {
				ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'book', symbol: ['SOL/USD'], depth: 1000 } }));
				ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: ['SOL/USD'] } }));
			},
			onMessage: (d) => this.kraken(d)
		});
		const bn = new LiveSocket('wss://stream.binance.com:9443/stream?streams=solusdt@aggTrade/solusdt@depth@1000ms', {
			onOpen: () => {
				this.bnSynced = false;
				this.bnBuffer = [];
				this.books.binance = newBook();
			},
			onMessage: (d) => this.binance(d),
			maxTries: 6
		});
		const bnLiq = new LiveSocket('wss://fstream.binance.com/ws/solusdt@forceOrder', {
			onMessage: (d) => {
				const o = d?.o;
				if (!o) return;
				const qty = Number(o.z || o.q);
				const px = Number(o.ap || o.p);
				this.liquidation(o.S === 'SELL' ? 'long' : 'short', qty * px, 'Binance');
			},
			maxTries: 6
		});
		const bybit = new LiveSocket('wss://stream.bybit.com/v5/public/linear', {
			onOpen: (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: ['allLiquidation.SOLUSDT'] })),
			onMessage: (d) => {
				if (!Array.isArray(d?.data)) return;
				for (const l of d.data) this.liquidation(l.S === 'Buy' ? 'long' : 'short', Number(l.v) * Number(l.p), 'Bybit');
			},
			ping: { every: 20_000, msg: '{"op":"ping"}' },
			maxTries: 8
		});
		const okx = new LiveSocket('wss://ws.okx.com:8443/ws/v5/public', {
			onOpen: (ws) =>
				ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] })),
			onMessage: (d) => {
				if (!Array.isArray(d?.data)) return;
				for (const inst of d.data) {
					const fam = inst.instFamily || inst.uly;
					if (fam !== 'SOL-USDT' && fam !== 'SOL-USD') continue;
					for (const x of inst.details || []) {
						const sz = Number(x.sz);
						// SOL-USD-SWAP contracts are $10; SOL-USDT-SWAP contracts are 1 SOL
						const usd = fam === 'SOL-USD' ? sz * 10 : sz * Number(x.bkPx);
						const long = x.posSide === 'long' || (x.posSide !== 'short' && x.side === 'sell');
						this.liquidation(long ? 'long' : 'short', usd, 'OKX');
					}
				}
			},
			ping: { every: 25_000, msg: 'ping' },
			maxTries: 8
		});
		this.sockets = [cb, kr, bn, bnLiq, bybit, okx];
		for (const s of this.sockets) s.open();

		this.timers.push(setInterval(() => this.emitQuote(), 250));
		this.timers.push(setInterval(() => this.emitDepth(), 1000));
		this.timers.push(setInterval(() => this.flushBursts(), 1000));
		// networks that block WebSockets still get a live price over REST
		this.timers.push(
			setInterval(async () => {
				if (cb.up || kr.up || bn.up) return;
				try {
					const r = await fetch('https://api.exchange.coinbase.com/products/SOL-USD/ticker');
					if (r.ok) this.lastTrade = Number((await r.json()).price) || this.lastTrade;
				} catch {
					/* keep waiting */
				}
			}, 2500)
		);
		this.timers.push(
			setInterval(() => {
				const live = [
					cb.up && 'Coinbase',
					kr.up && 'Kraken',
					bn.up && 'Binance'
				].filter(Boolean);
				h.status(live.length ? `${live.join(' · ')} live` : 'Reconnecting…');
			}, 3000)
		);
	}

	setSource(id: string) {
		this.source = id;
		this.lastQuote = 0;
		this.emitQuote();
		this.emitDepth();
	}

	stop() {
		for (const s of this.sockets) s.close();
		for (const t of this.timers) clearInterval(t);
		this.sockets = [];
		this.timers = [];
	}

	// ── venues ──────────────────────────────────────────────────────────

	private coinbase(d: any) {
		if (d.product_id !== 'SOL-USD') return;
		const b = this.books.coinbase;
		if (d.type === 'snapshot') {
			b.bids.clear();
			b.asks.clear();
			const mid = Number(d.bids?.[0]?.[0]) || 0;
			const lo = mid * 0.95;
			const hi = mid * 1.05;
			for (const [p, s] of d.bids) {
				const pr = Number(p);
				if (pr < lo) break;
				b.bids.set(pr, Number(s));
			}
			for (const [p, s] of d.asks) {
				const pr = Number(p);
				if (pr > hi) break;
				b.asks.set(pr, Number(s));
			}
			b.at = Date.now();
		} else if (d.type === 'l2update') {
			for (const [side, p, s] of d.changes) {
				const m = side === 'buy' ? b.bids : b.asks;
				const q = Number(s);
				if (q === 0) m.delete(Number(p));
				else m.set(Number(p), q);
			}
			b.at = Date.now();
		} else if (d.type === 'match' || d.type === 'last_match') {
			const px = Number(d.price);
			this.lastTrade = px;
			// Coinbase reports the maker's side: a "sell" maker means a taker bought.
			if (d.type === 'match') this.trade(d.side === 'sell' ? 'buy' : 'sell', px * Number(d.size), 'Coinbase');
		} else if (d.type === 'ticker') {
			this.open24 = Number(d.open_24h) || this.open24;
			if (!this.lastTrade) this.lastTrade = Number(d.price);
		}
	}

	private kraken(d: any) {
		if (d.channel === 'book' && Array.isArray(d.data)) {
			const b = this.books.kraken;
			const x = d.data[0];
			if (d.type === 'snapshot') {
				b.bids.clear();
				b.asks.clear();
			}
			for (const l of x.bids || []) (l.qty === 0 ? b.bids.delete(l.price) : b.bids.set(l.price, l.qty));
			for (const l of x.asks || []) (l.qty === 0 ? b.asks.delete(l.price) : b.asks.set(l.price, l.qty));
			// Kraken expects the client to truncate to the subscribed depth
			if (b.bids.size > 1100) trim(b.bids, 1000, true);
			if (b.asks.size > 1100) trim(b.asks, 1000, false);
			b.at = Date.now();
		} else if (d.channel === 'trade' && d.type === 'update' && Array.isArray(d.data)) {
			for (const t of d.data) {
				this.lastTrade = t.price;
				this.trade(t.side === 'buy' ? 'buy' : 'sell', t.price * t.qty, 'Kraken');
			}
		}
	}

	private binance(msg: any) {
		const d = msg?.data;
		if (!d) return;
		if (d.e === 'aggTrade') {
			const px = Number(d.p);
			this.lastTrade = this.lastTrade || px;
			// m = buyer is the maker → the taker sold
			this.trade(d.m ? 'sell' : 'buy', px * Number(d.q), 'Binance');
			return;
		}
		if (d.e !== 'depthUpdate' || this.bnBlocked) return;
		if (!this.bnSynced) {
			this.bnBuffer.push(d);
			if (this.bnBuffer.length > 60) this.bnBuffer.shift();
			if (!this.bnSnapshotPending) this.binanceSnapshot();
			return;
		}
		if (d.U !== this.bnLastId + 1) {
			// gap: resync from a fresh snapshot
			this.bnSynced = false;
			this.bnBuffer = [d];
			this.binanceSnapshot();
			return;
		}
		this.applyBinance(d);
	}

	private async binanceSnapshot() {
		this.bnSnapshotPending = true;
		try {
			const r = await fetch('https://api.binance.com/api/v3/depth?symbol=SOLUSDT&limit=5000');
			if (!r.ok) {
				if (r.status === 451 || r.status === 403) this.bnBlocked = true;
				return;
			}
			const s = await r.json();
			const b = this.books.binance;
			b.bids = new Map(s.bids.map(([p, q]: string[]) => [Number(p), Number(q)]));
			b.asks = new Map(s.asks.map(([p, q]: string[]) => [Number(p), Number(q)]));
			this.bnLastId = s.lastUpdateId;
			const rest = this.bnBuffer.filter((e) => e.u > s.lastUpdateId);
			this.bnBuffer = [];
			this.bnSynced = true;
			for (const e of rest) this.applyBinance(e);
		} catch {
			this.bnBlocked = true; // CORS / network block: aggregate without it
		} finally {
			this.bnSnapshotPending = false;
		}
	}

	private applyBinance(d: any) {
		const b = this.books.binance;
		for (const [p, q] of d.b) (Number(q) === 0 ? b.bids.delete(Number(p)) : b.bids.set(Number(p), Number(q)));
		for (const [p, q] of d.a) (Number(q) === 0 ? b.asks.delete(Number(p)) : b.asks.set(Number(p), Number(q)));
		this.bnLastId = d.u;
		b.at = Date.now();
	}

	// ── normalised events ───────────────────────────────────────────────

	private trade(side: 'buy' | 'sell', usd: number, venue: Venue) {
		if (!(usd > 0)) return;
		(side === 'buy' ? this.flowBuy : this.flowSell).add(usd);
		const k = `${venue}|${side}`;
		this.bursts.set(k, (this.bursts.get(k) ?? 0) + usd);
	}

	/** Once a second: each venue's summed taker prints per side become one order. */
	private flushBursts() {
		for (const [k, usd] of this.bursts) {
			const [venue, side] = k.split('|') as [Venue, 'buy' | 'sell'];
			if (usd >= HEAVY) (side === 'buy' ? this.heavyBuy : this.heavySell).add(usd);
			if (usd >= EMIT_TRADE) this.h.event({ type: 'trade', side, usd, venue, ts: Date.now() });
		}
		this.bursts.clear();
	}

	private liquidation(side: 'long' | 'short', usd: number, venue: Venue) {
		if (!(usd > 0)) return;
		this.h.event({ type: 'liquidation', side, usd, venue, ts: Date.now() });
	}

	// ── outputs ─────────────────────────────────────────────────────────

	private activeBooks(): Book[] {
		const now = Date.now();
		const fresh = (b: Book) => b.at > now - 15_000 && b.bids.size > 0 && b.asks.size > 0;
		if (this.source === 'agg') return Object.values(this.books).filter(fresh);
		const b = this.books[this.source as 'coinbase' | 'kraken' | 'binance'];
		return b && fresh(b) ? [b] : [];
	}

	private mid(): number {
		const books = this.activeBooks();
		let s = 0;
		let n = 0;
		for (const b of books) {
			const bb = bestBid(b);
			const ba = bestAsk(b);
			if (bb > 0 && ba < Infinity && ba > bb) {
				s += (bb + ba) / 2;
				n++;
			}
		}
		// no fresh book for this source: fall back to the live trade price
		return n ? s / n : this.lastTrade;
	}

	private emitQuote() {
		const p = this.mid();
		if (!p) return;
		const now = Date.now();
		if (!this.mids.length || now - this.mids[this.mids.length - 1].t >= 1000) {
			this.mids.push({ t: now, p });
			if (this.mids.length > 61) this.mids.shift();
		}
		if (p === this.lastQuote) return;
		this.lastQuote = p;
		const change24h = this.open24 ? ((p - this.open24) / this.open24) * 100 : 0;
		this.h.quote({ price: p, change24h });
	}

	private emitDepth() {
		const mid = this.mid();
		if (!mid) return;
		const books = this.activeBooks();
		const w = mid * BAND;
		const bid = new Float64Array(BUCKETS);
		const ask = new Float64Array(BUCKETS);
		for (const b of books) {
			for (const [p, q] of b.bids) {
				if (p > mid || p < mid - w) continue;
				bid[Math.min(BUCKETS - 1, Math.floor(((mid - p) / w) * BUCKETS))] += p * q;
			}
			for (const [p, q] of b.asks) {
				if (p < mid || p > mid + w) continue;
				ask[Math.min(BUCKETS - 1, Math.floor(((p - mid) / w) * BUCKETS))] += p * q;
			}
		}
		let cb = 0;
		let ca = 0;
		const bids = [{ p: mid, c: 0 }];
		const asks = [{ p: mid, c: 0 }];
		for (let i = 0; i < BUCKETS; i++) {
			cb += bid[i];
			ca += ask[i];
			bids.push({ p: mid - ((i + 1) / BUCKETS) * w, c: cb });
			asks.push({ p: mid + ((i + 1) / BUCKETS) * w, c: ca });
		}
		const depth: Depth | null = books.length ? { mid, bids, asks, lo: mid - w, hi: mid + w } : null;

		let vol = 0;
		if (this.mids.length > 5) {
			let lo = Infinity;
			let hi = 0;
			for (const m of this.mids) {
				lo = Math.min(lo, m.p);
				hi = Math.max(hi, m.p);
			}
			vol = Math.min(1, (hi - lo) / mid / 0.003);
		}
		const forces: Forces = {
			bidWall: cb,
			askWall: ca,
			flowBuy: this.flowBuy.sum(),
			flowSell: this.flowSell.sum(),
			heavyBuy: this.heavyBuy.sum(),
			heavySell: this.heavySell.sum(),
			volatility: vol,
			liquidity: 0
		};
		this.h.depth(depth, forces);
	}
}

function trim(m: Map<number, number>, keep: number, bids: boolean) {
	const keys = [...m.keys()].sort((a, b) => (bids ? b - a : a - b));
	for (let i = keep; i < keys.length; i++) m.delete(keys[i]);
}
