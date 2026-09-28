import type { Theater } from './types';
import { grouped, niceStep } from './format';

// $OSIRIS: the battle value is the market cap. A marker row every ~0.4% of it,
// rounded to a clean dollar step, so the field reads like a price ladder.
export const OSIRIS: Theater = {
	id: 'osiris',
	name: '$OSIRIS',
	pairLabel: () => '$OSIRIS · MARKET CAP · PUMPSWAP',
	depthLabel: () => 'PUMPSWAP POOL DEPTH',
	step: (mc) => niceStep(Math.max(1, mc * 0.004)),
	level: (v) => grouped(v),
	price: (v) => '$' + grouped(v),
	// Thin pool: scale the event tiers with pool liquidity so a whale is a whale
	// whatever size the pool grows to.
	tiers: (liq) => {
		const l = Math.max(5000, liq);
		return {
			squad: 0,
			tank: Math.round(l * 0.001),
			heli: Math.round(l * 0.0025),
			jet: Math.round(l * 0.012),
			bomber: Math.round(l * 0.05),
			feed: 0
		};
	},
	strikesFrom: 'trade'
};

// BTC: the Newhedge rules — $50 marker rows, liquidation-driven strikes at
// $50K helicopter / $150K jet / $500K bombing run.
const spot = (src: string) => {
	const s = src.toUpperCase();
	return s.endsWith('SPOT') ? s : `${s} SPOT`;
};

export const BTC: Theater = {
	id: 'btc',
	name: 'BTC',
	pairLabel: (src) => `BTC/USD · ${spot(src)}`,
	depthLabel: (src) => `${spot(src)} DEPTH`,
	step: () => 50,
	level: (v) => grouped(v),
	price: (v) => '$' + grouped(v, 2),
	tiers: () => ({ squad: 25_000, tank: 250_000, heli: 50_000, jet: 150_000, bomber: 500_000, feed: 25_000 }),
	strikesFrom: 'liquidation'
};

export const THEATERS = { osiris: OSIRIS, btc: BTC } as const;
