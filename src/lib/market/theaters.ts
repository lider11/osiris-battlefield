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
			tank: Math.round(l * 0.0008),
			heli: Math.round(l * 0.0015),
			jet: Math.round(l * 0.005),
			bomber: Math.round(l * 0.015),
			nuke: Math.round(l * 0.04),
			barrage: Infinity,
			feed: 0
		};
	},
	strikesFrom: 'trade'
};

const spot = (src: string) => {
	const s = src.toUpperCase();
	return s.endsWith('SPOT') ? s : `${s} SPOT`;
};

// SOL: the Newhedge rules on Solana — a marker row every ~0.08% (10¢ at today's
// price). Whale buy/sell bursts and perp liquidations both call in strikes; the
// ladder is calibrated so quiet hours still see helicopters and busy ones jets.
export const SOL: Theater = {
	id: 'sol',
	name: 'SOL',
	pairLabel: (src) => `SOL/USD · ${spot(src)}`,
	depthLabel: (src) => `${spot(src)} DEPTH`,
	step: (p) => niceStep(p * 0.0008),
	level: (v) => grouped(v, 2),
	price: (v) => '$' + grouped(v, 2),
	tiers: () => ({
		squad: 2_000,
		tank: 15_000,
		heli: 20_000,
		jet: 50_000,
		bomber: 120_000,
		nuke: 400_000,
		barrage: 3_000,
		feed: 5_000
	}),
	strikesFrom: 'both'
};

export const THEATERS = { osiris: OSIRIS, sol: SOL } as const;
