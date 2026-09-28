// Shared shapes between the live market feeds, the HUD and the 3D battlefield.

export type Side = 'bull' | 'bear';

/** A cumulative depth point: at price `p` the book holds `c` USD between the mid and `p`. */
export type DepthPoint = { p: number; c: number };

export type Depth = {
	mid: number;
	bids: DepthPoint[]; // mid → lower, cumulative
	asks: DepthPoint[]; // mid → higher, cumulative
	lo: number;
	hi: number;
};

export type Venue = 'Coinbase' | 'Kraken' | 'Binance' | 'OKX' | 'Bybit' | 'PumpSwap';

export type MarketEvent =
	| {
			type: 'trade';
			side: 'buy' | 'sell';
			usd: number;
			venue: Venue;
			wallet?: string;
			tx?: string;
			ts: number;
			history?: boolean; // already on the tape when we connected: list it, don't fight it
	  }
	| { type: 'liquidation'; side: 'long' | 'short'; usd: number; venue: Venue; ts: number };

/** What the battlefield needs to size the two armies. All USD. */
export type Forces = {
	bidWall: number; // buy-side liquidity below the price (Bull support)
	askWall: number; // sell-side liquidity above the price (Bear resistance)
	flowBuy: number; // taker buy flow, rolling window
	flowSell: number; // taker sell flow, rolling window
	heavyBuy: number; // large buy trades, longer window
	heavySell: number;
	volatility: number; // 0..1
	liquidity: number; // pool liquidity (sizes the $OSIRIS strike tiers); 0 for order books
};

export type Quote = {
	price: number; // the battle value (BTC price, or $OSIRIS market cap)
	change24h: number; // %
	sub?: string; // secondary line, e.g. the token price
};

export type FeedHandlers = {
	quote(q: Quote): void;
	depth(d: Depth | null, forces: Forces): void;
	event(e: MarketEvent): void;
	status(s: string): void;
};

export interface MarketFeed {
	readonly sources: { id: string; label: string }[];
	start(h: FeedHandlers): void;
	setSource(id: string): void;
	stop(): void;
}

/** How a theater's numbers map onto the battlefield. */
export type Theater = {
	id: 'osiris' | 'btc';
	name: string; // short name for the switcher
	/** HUD label above the price, naming the active book source. */
	pairLabel(source: string): string;
	depthLabel(source: string): string;
	/** Dollar spacing between the price markers painted on the terrain. */
	step(price: number): number;
	/** Label for a marker row. */
	level(v: number): string;
	/** Big HUD price. */
	price(v: number): string;
	/** USD thresholds that turn events into battlefield strikes. `liq` = the size that scales them. */
	tiers(liq: number): StrikeTiers;
	/** Liquidations drive strikes on BTC; on $OSIRIS the whale trades themselves do. */
	strikesFrom: 'liquidation' | 'trade';
};

export type StrikeTiers = {
	squad: number; // a trade this big sends a fresh squad
	tank: number; // … a tank
	heli: number; // helicopter rocket strike
	jet: number; // jet strike
	bomber: number; // bombing run
	feed: number; // smallest trade worth a line in the Market Feed
};
