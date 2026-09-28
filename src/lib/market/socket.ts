// A self-healing public WebSocket: reconnects with backoff, optional keepalive.

export class LiveSocket {
	private ws: WebSocket | null = null;
	private closed = false;
	private tries = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	up = false;

	constructor(
		private url: string,
		private opts: {
			onOpen?: (ws: WebSocket) => void;
			onMessage: (data: any) => void;
			ping?: { every: number; msg: string };
			maxTries?: number; // give up after this many failed connects in a row (geo-blocked venues)
		}
	) {}

	open() {
		if (this.closed) return;
		let ws: WebSocket;
		try {
			ws = new WebSocket(this.url);
		} catch {
			this.schedule();
			return;
		}
		this.ws = ws;
		ws.onopen = () => {
			this.tries = 0;
			this.up = true;
			this.opts.onOpen?.(ws);
			if (this.opts.ping) {
				const { every, msg } = this.opts.ping;
				this.pingTimer = setInterval(() => ws.readyState === 1 && ws.send(msg), every);
			}
		};
		ws.onmessage = (e) => {
			if (typeof e.data !== 'string' || e.data === 'pong') return;
			let d: any;
			try {
				d = JSON.parse(e.data);
			} catch {
				return;
			}
			this.opts.onMessage(d);
		};
		ws.onclose = () => {
			this.up = false;
			if (this.pingTimer) clearInterval(this.pingTimer);
			this.pingTimer = null;
			this.schedule();
		};
		ws.onerror = () => ws.close();
	}

	send(msg: unknown) {
		if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
	}

	private schedule() {
		if (this.closed) return;
		this.tries++;
		if (this.opts.maxTries && this.tries > this.opts.maxTries) return;
		const wait = Math.min(30_000, 1000 * 2 ** Math.min(5, this.tries - 1));
		this.retryTimer = setTimeout(() => this.open(), wait);
	}

	close() {
		this.closed = true;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.close();
		}
		this.up = false;
	}
}

/** Sum of values added in the last `windowMs`. */
export class Rolling {
	private items: { t: number; v: number }[] = [];
	constructor(private windowMs: number) {}
	add(v: number, t = Date.now()) {
		this.items.push({ t, v });
	}
	sum(now = Date.now()): number {
		const cut = now - this.windowMs;
		let i = 0;
		while (i < this.items.length && this.items[i].t < cut) i++;
		if (i) this.items.splice(0, i);
		let s = 0;
		for (const it of this.items) s += it.v;
		return s;
	}
}
