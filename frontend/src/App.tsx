import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
} from "viem";
import {
  AGENT_ID_REGISTRY,
  BADGE_TIERS,
  CHAIN,
  DAILYFEST_ADDRESS,
  DAILYFEST_DEPLOYED,
  DAILYFEST_START_BLOCK,
  DISHES,
  dishImage,
  dishIndexForDay,
  utcDayNow,
} from "./config";
import { dailyFestAbi, registryAbi } from "./abi";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

const dishMintedEvent = dailyFestAbi.find((x) => x.type === "event" && x.name === "DishMinted")!;
const badgeClaimedEvent = dailyFestAbi.find((x) => x.type === "event" && x.name === "BadgeClaimed")!;

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === "number" ? c : undefined;
  }
  return undefined;
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

type MintLog = {
  user: string;
  day: bigint;
  dishIndex: number;
  streak: bigint;
  tokenId: bigint;
  blockNumber: bigint;
};
type BadgeLog = { user: string; tier: number; tokenId: bigint; blockNumber: bigint };
type ActivityRow =
  | { kind: "dish"; block: bigint; user: string; dishIndex: number; streak: bigint }
  | { kind: "badge"; block: bigint; user: string; tier: number };

// Scan DishMinted logs for one user, forward-chunked from the start block.
// Best-effort: returns whatever was found if a chunk fails.
async function scanUserMintLogs(user: Address): Promise<MintLog[]> {
  const latest = await publicClient.getBlockNumber();
  const CHUNK = 50_000n;
  const MAX_CHUNKS = 40;
  const out: MintLog[] = [];
  let from = DAILYFEST_START_BLOCK;
  let chunks = 0;
  while (from <= latest && chunks < MAX_CHUNKS) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    try {
      const logs = await publicClient.getLogs({
        address: DAILYFEST_ADDRESS,
        event: dishMintedEvent,
        args: { user },
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs as unknown as Array<{ args: MintLog; blockNumber: bigint }>) {
        out.push({ ...l.args, blockNumber: l.blockNumber });
      }
    } catch {
      break;
    }
    from = to + 1n;
    chunks++;
  }
  return out;
}

// Scan recent activity (both events), walking backwards from the latest
// block until enough rows are found or the chunk budget runs out.
async function scanRecentActivity(want = 15): Promise<ActivityRow[]> {
  const latest = await publicClient.getBlockNumber();
  const CHUNK = 10_000n;
  const MAX_CHUNKS = 30;
  const rows: ActivityRow[] = [];
  let to = latest;
  let chunks = 0;
  while (to >= DAILYFEST_START_BLOCK && rows.length < want && chunks < MAX_CHUNKS) {
    const from = to - CHUNK + 1n < DAILYFEST_START_BLOCK ? DAILYFEST_START_BLOCK : to - CHUNK + 1n;
    try {
      const [dishLogs, badgeLogs] = await Promise.all([
        publicClient.getLogs({
          address: DAILYFEST_ADDRESS,
          event: dishMintedEvent,
          fromBlock: from,
          toBlock: to,
        }),
        publicClient.getLogs({
          address: DAILYFEST_ADDRESS,
          event: badgeClaimedEvent,
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      for (const l of dishLogs as unknown as Array<{ args: MintLog; blockNumber: bigint }>) {
        rows.push({
          kind: "dish",
          block: l.blockNumber,
          user: l.args.user,
          dishIndex: Number(l.args.dishIndex),
          streak: l.args.streak,
        });
      }
      for (const l of badgeLogs as unknown as Array<{ args: BadgeLog; blockNumber: bigint }>) {
        rows.push({ kind: "badge", block: l.blockNumber, user: l.args.user, tier: Number(l.args.tier) });
      }
    } catch {
      break;
    }
    if (from === DAILYFEST_START_BLOCK) break;
    to = from - 1n;
    chunks++;
  }
  return rows.sort((a, b) => (b.block > a.block ? 1 : b.block < a.block ? -1 : 0)).slice(0, want);
}

type MineState = {
  current: bigint;
  best: bigint;
  lifetime: bigint;
  canMint: boolean;
  distinct: bigint;
  shelf: boolean[];
  dishDays: (bigint | null)[];
  badges: boolean[];
};

type LbRow = { address: string; current: bigint; best: bigint; lifetime: bigint };

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [holder, setHolder] = useState<boolean | null>(null);
  const [handle, setHandle] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [nowMs, setNowMs] = useState<number>(Date.now());
  const today = utcDayNow();
  const todayDishIdx = dishIndexForDay(today);
  const todayDish = DISHES[todayDishIdx];
  const nextMidnightMs = (today + 1) * 86400 * 1000;
  const countdown = fmtCountdown(nextMidnightMs - nowMs);

  const [stats, setStats] = useState<{ total: bigint; festgoers: bigint } | null>(null);
  const [mine, setMine] = useState<MineState | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LbRow[]>([]);
  const [lbLoading, setLbLoading] = useState<boolean>(DAILYFEST_DEPLOYED);
  const [lbError, setLbError] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState<boolean>(DAILYFEST_DEPLOYED);
  const [actError, setActError] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const walletClient = useMemo(() => {
    if (!window.ethereum) return null;
    return createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) });
  }, [account]);

  const loadStats = useCallback(async () => {
    if (!DAILYFEST_DEPLOYED) return;
    try {
      const [total, festgoers] = await Promise.all([
        publicClient.readContract({
          address: DAILYFEST_ADDRESS,
          abi: dailyFestAbi,
          functionName: "totalMinted",
        }),
        publicClient.readContract({
          address: DAILYFEST_ADDRESS,
          abi: dailyFestAbi,
          functionName: "uniqueFestgoers",
        }),
      ]);
      setStats({ total, festgoers });
    } catch {
      /* stats are decorative; ignore failures */
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!DAILYFEST_DEPLOYED) {
      setLbLoading(false);
      return;
    }
    setLbLoading(true);
    setLbError(false);
    try {
      const addrs = await publicClient.readContract({
        address: DAILYFEST_ADDRESS,
        abi: dailyFestAbi,
        functionName: "getFestgoers",
        args: [0n, 100n],
      });
      const rows = await Promise.all(
        addrs.map(async (a) => {
          const [current, best, lifetime] = await publicClient.readContract({
            address: DAILYFEST_ADDRESS,
            abi: dailyFestAbi,
            functionName: "streakOf",
            args: [a],
          });
          return { address: a as string, current, best, lifetime } as LbRow;
        })
      );
      rows.sort((x, y) =>
        y.current !== x.current
          ? y.current > x.current
            ? 1
            : -1
          : y.best !== x.best
            ? y.best > x.best
              ? 1
              : -1
            : y.lifetime > x.lifetime
              ? 1
              : y.lifetime < x.lifetime
                ? -1
                : 0
      );
      setLeaderboard(rows);
    } catch {
      setLbError(true);
    } finally {
      setLbLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    if (!DAILYFEST_DEPLOYED) {
      setActLoading(false);
      return;
    }
    setActLoading(true);
    setActError(false);
    try {
      setActivity(await scanRecentActivity(15));
    } catch {
      setActError(true);
    } finally {
      setActLoading(false);
    }
  }, []);

  const loadMine = useCallback(async (me: Address) => {
    setMineLoading(true);
    setMineError(false);
    try {
      const bal = await publicClient.readContract({
        address: AGENT_ID_REGISTRY,
        abi: registryAbi,
        functionName: "balanceOf",
        args: [me],
      });
      setHolder(bal > 0n);
      if (bal > 0n) {
        try {
          const h = await publicClient.readContract({
            address: AGENT_ID_REGISTRY,
            abi: registryAbi,
            functionName: "handleOf",
            args: [me],
          });
          setHandle(h);
        } catch {
          setHandle("");
        }
      } else {
        setHandle("");
      }
      if (!DAILYFEST_DEPLOYED) {
        setMine(null);
        return;
      }
      const [streakRes, canMint, distinct] = await Promise.all([
        publicClient.readContract({
          address: DAILYFEST_ADDRESS,
          abi: dailyFestAbi,
          functionName: "streakOf",
          args: [me],
        }),
        publicClient.readContract({
          address: DAILYFEST_ADDRESS,
          abi: dailyFestAbi,
          functionName: "canMintToday",
          args: [me],
        }),
        publicClient.readContract({
          address: DAILYFEST_ADDRESS,
          abi: dailyFestAbi,
          functionName: "distinctDishesOf",
          args: [me],
        }),
      ]);
      const shelf: boolean[] = [];
      for (let i = 0; i < DISHES.length; i++) {
        shelf.push(
          await publicClient.readContract({
            address: DAILYFEST_ADDRESS,
            abi: dailyFestAbi,
            functionName: "hasDish",
            args: [me, i],
          })
        );
      }
      const badges: boolean[] = [];
      for (const t of BADGE_TIERS) {
        badges.push(
          await publicClient.readContract({
            address: DAILYFEST_ADDRESS,
            abi: dailyFestAbi,
            functionName: "badgeClaimed",
            args: [me, t.tier],
          })
        );
      }
      // Day each dish was first minted — from the user's own DishMinted logs.
      const dishDays: (bigint | null)[] = DISHES.map(() => null);
      try {
        const logs = await scanUserMintLogs(me);
        for (const l of logs) {
          const d = Number(l.dishIndex);
          if (dishDays[d] === null) dishDays[d] = l.day;
        }
      } catch {
        /* shelf still renders from hasDish reads */
      }
      setMine({
        current: streakRes[0],
        best: streakRes[1],
        lifetime: streakRes[2],
        canMint,
        distinct,
        shelf,
        dishDays,
        badges,
      });
    } catch {
      setMineError(true);
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadLeaderboard();
    loadActivity();
  }, [loadStats, loadLeaderboard, loadActivity]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      if (accounts.length === 0) {
        setAccount(null);
        setHolder(null);
        setHandle("");
        setMine(null);
      } else {
        const me = accounts[0] as Address;
        setAccount(me);
        loadMine(me);
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      if (args[0] !== "0x38") {
        setError(
          "You switched away from BNB Chain — switch back to BNB Chain (56) in your wallet to mint or claim."
        );
      } else {
        setError("");
        loadStats();
        loadLeaderboard();
        loadActivity();
      }
    };
    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [loadMine, loadStats, loadLeaderboard, loadActivity]);

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("No injected wallet found. Open this page in MetaMask or the Binance Wallet browser.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      if (chainId !== "0x38") {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x38" }],
          });
        } catch {
          setError("Please switch to BNB Chain (56) in your wallet — Daily Fest only works on BNB Chain.");
          return;
        }
      }
      const me = accounts[0] as Address;
      setAccount(me);
      await loadMine(me);
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Connection request was rejected in your wallet — nothing was connected.");
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    }
  }

  async function write(fn: "mintDish" | "claimBadge", args: unknown[]): Promise<boolean> {
    if (!walletClient || !account) return false;
    setBusy(fn + JSON.stringify(args));
    setError("");
    try {
      const hash = await walletClient.writeContract({
        address: DAILYFEST_ADDRESS,
        abi: dailyFestAbi,
        functionName: fn,
        args: args as never,
        account,
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await loadMine(account);
      await loadStats();
      await loadLeaderboard();
      await loadActivity();
      return true;
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Transaction was rejected in your wallet — nothing was sent.");
      } else {
        setError(e instanceof Error ? e.message : "Transaction failed");
      }
      return false;
    } finally {
      setBusy("");
    }
  }

  const mintDisabledReason = !DAILYFEST_DEPLOYED
    ? "Minting goes live when the DailyFest contract is deployed."
    : !account
      ? "Connect your wallet to mint today's dish."
      : holder === false
        ? "This wallet holds no Agent ID — only Agent ID holders can mint."
        : mineLoading
          ? "Checking your festival status…"
          : mine && !mine.canMint
            ? "You've already minted today's dish."
            : "";

  return (
    <div className="page">
      <header>
        <h1>Daily Fest</h1>
        <p className="tagline">
          A food festival for Agent ID holders on BNB Chain. One free dish every day.
          Don't break the streak.
        </p>
        {!account ? (
          <button onClick={connect}>Connect wallet</button>
        ) : (
          <p className="meta">
            Connected: {short(account)} (BNB Chain)
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {stats && (
          <p className="meta">
            So far: {stats.festgoers.toString()} festgoers · {stats.total.toString()} dishes
            &amp; badges minted
          </p>
        )}
      </header>

      <section>
        <h2>Today's Dish</h2>
        <div className="card fest spotlight">
          <img src={dishImage(todayDish.slug)} alt={todayDish.name} />
          <p className="dish-name">{todayDish.name}</p>
          <p className="meta">
            Festival day {today} · Dish {todayDishIdx + 1} of 14 on the menu
          </p>
          <p className="meta">
            Next dish in <span className="countdown">{countdown}</span> (new UTC day)
          </p>
        </div>
      </section>

      <section>
        <h2>Your Agent ID status</h2>
        {!account ? (
          <div className="card placeholder">
            <p>Connect your wallet to see your Agent ID status.</p>
            <p className="meta">
              Once connected, this card shows whether your wallet holds an Agent ID — and
              your handle — verified against the SPACE ID Agent ID registry. Your shelf,
              streak and badges below also appear after connecting.
            </p>
          </div>
        ) : mineError && holder === null ? (
          <div className="card warn">
            <p className="error">Couldn't check your Agent ID status.</p>
            <button onClick={() => account && loadMine(account)}>Retry</button>
          </div>
        ) : holder === null ? (
          <p>Checking…</p>
        ) : holder ? (
          <div className="card">
            <p>
              Agent ID holder ✓{handle ? <> — <strong>{handle}.ai</strong></> : null}
            </p>
            <p className="meta">
              Verified against the SPACE ID Agent ID registry ({short(AGENT_ID_REGISTRY)}).
            </p>
          </div>
        ) : (
          <div className="card">
            <p>This wallet holds no Agent ID yet.</p>
            <p className="meta">
              Agent IDs can only be claimed inside the Binance App: Wallet → homepage
              banner → Agent ID. Come back with the same wallet once you have one — only
              Agent ID holders can mint dishes.
            </p>
          </div>
        )}
      </section>

      {!DAILYFEST_DEPLOYED && (
        <section>
          <div className="card warn">
            <p>
              <strong>Pre-deployment build:</strong> the DailyFest contract address in{" "}
              <code>src/config.ts</code> is the predicted CREATE2 address (
              {short(DAILYFEST_ADDRESS)}). Minting, shelves, streaks and the leaderboard
              activate once the contract is deployed and verified at that address.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2>Mint today's dish</h2>
        <div className="card">
          <div className="mint-dish">
            <img src={dishImage(todayDish.slug)} alt={todayDish.name} />
            <div>
              <p className="title">{todayDish.name}</p>
              <p className="meta">
                Free — you only pay BNB Chain gas. One per wallet per day, soulbound
                (it can never be transferred or sold).
              </p>
              {account && mine && !mine.canMint && DAILYFEST_DEPLOYED && (
                <p className="meta">
                  Already on your shelf for today ✓ — next dish in{" "}
                  <span className="countdown">{countdown}</span>
                </p>
              )}
            </div>
          </div>
          <button
            disabled={mintDisabledReason !== "" || busy !== ""}
            onClick={() => write("mintDish", [])}
          >
            {busy.startsWith("mintDish") ? "Confirm in your wallet…" : "Mint today's dish — free"}
          </button>
          {mintDisabledReason && <p className="meta">{mintDisabledReason}</p>}
        </div>
      </section>

      <section>
        <h2>Use Daily Fest through your agent</h2>
        <div className="card fest">
          <p>
            <strong>This is the main way to eat at Daily Fest.</strong> If you run an agent
            with the Binance Agentic Wallet (<code>baw</code>), you never need this page:
            give your agent the DailyFest skill and one line a day — it mints through your
            own paired wallet, preview-first, and you confirm in your Binance App.
          </p>
          <p className="meta">
            Skill:{" "}
            <a
              href="https://github.com/Velt89/dailyfest/blob/main/agent/SKILL.md"
              target="_blank"
              rel="noreferrer"
            >
              github.com/Velt89/dailyfest/blob/main/agent/SKILL.md
            </a>{" "}
            · Machine-readable manifest: <a href="/agent.json">/agent.json</a>
          </p>
          <p className="meta">
            Example instruction:{" "}
            <em>"Mint today's Daily Fest dish and claim any Feast badge I've qualified for"</em>
          </p>
          <p className="meta">
            Your agent checks you hold an Agent ID, reads today's dish, runs a{" "}
            <code>baw</code> preview (a simulation — nothing is broadcast), shows you the
            summary, and only executes on your explicit go-ahead. Value is always 0; there
            are no approvals. Put it in your agent's daily routine and your streak keeps
            itself.
          </p>
        </div>
      </section>

      <section>
        <h2>Your Shelf</h2>
        {!account ? (
          <div className="card placeholder">
            <p>Connect your wallet to see your dish shelf.</p>
            <p className="meta">
              Every dish you mint lands here. There are 14 dishes on the festival menu —
              collect the full set.
            </p>
          </div>
        ) : !DAILYFEST_DEPLOYED ? (
          <div className="card placeholder">
            <p>Your shelf opens when the festival starts (contract deployment).</p>
            <p className="meta">The menu below is what's being served, in rotation order.</p>
            <div className="shelf">
              {DISHES.map((d) => (
                <div className="shelf-cell missing" key={d.slug}>
                  <img src={dishImage(d.slug)} alt={d.name} />
                  <div className="dish-label">{d.name}</div>
                </div>
              ))}
            </div>
          </div>
        ) : mineLoading && !mine ? (
          <p className="meta">Loading your shelf…</p>
        ) : mineError ? (
          <div className="card warn">
            <p className="error">Couldn't load your shelf.</p>
            <button onClick={() => account && loadMine(account)}>Retry</button>
          </div>
        ) : mine ? (
          <div className="card">
            <p>
              <strong>{mine.distinct.toString()} of 14 dishes</strong> collected
            </p>
            <div className="shelf">
              {DISHES.map((d, i) => (
                <div className={`shelf-cell ${mine.shelf[i] ? "" : "missing"}`} key={d.slug}>
                  <img src={dishImage(d.slug)} alt={d.name} />
                  <div className="dish-label">{d.name}</div>
                  <div className="dish-day">
                    {mine.shelf[i]
                      ? mine.dishDays[i] !== null
                        ? `Day ${mine.dishDays[i]!.toString()}`
                        : "Collected"
                      : "Not yet"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h2>Streak &amp; Feast badges</h2>
        {!account ? (
          <div className="card placeholder">
            <p>Connect your wallet to see your streak and badges.</p>
            <p className="meta">
              Mint on consecutive days to build a streak. Feast badges — Bronze (3-day best
              streak), Silver (7), Gold (14) — are claimed off your <em>best</em> streak, so
              a missed day never takes a badge you've already earned the right to claim.
            </p>
          </div>
        ) : mine ? (
          <div className="card">
            <div className="row">
              <span className="badge hot">Current streak: {mine.current.toString()}</span>
              <span className="badge">Best: {mine.best.toString()}</span>
              <span className="badge">Days at the fest: {mine.lifetime.toString()}</span>
            </div>
            <div className="badge-grid">
              {BADGE_TIERS.map((t, i) => {
                const claimed = mine.badges[i];
                const qualified = mine.best >= BigInt(t.required);
                return (
                  <div className={`badge-cell ${claimed || qualified ? "" : "locked"}`} key={t.tier}>
                    <img src={dishImage(t.slug)} alt={`${t.name} Feast Badge`} />
                    <div className="badge-name">{t.name} Feast Badge</div>
                    <div className="badge-req">Best streak {t.required}+</div>
                    {claimed ? (
                      <p className="field-ok">Claimed ✓</p>
                    ) : qualified ? (
                      <button
                        disabled={busy !== "" || !DAILYFEST_DEPLOYED}
                        onClick={() => write("claimBadge", [t.tier])}
                      >
                        {busy === `claimBadge[${t.tier}]` ? "Confirm in your wallet…" : "Claim badge"}
                      </button>
                    ) : (
                      <p className="meta">
                        {mine.best.toString()} / {t.required} days
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : mineLoading ? (
          <p className="meta">Loading…</p>
        ) : !DAILYFEST_DEPLOYED ? (
          <div className="card placeholder">
            <p>Streaks and badges start counting at deployment.</p>
            <div className="badge-grid">
              {BADGE_TIERS.map((t) => (
                <div className="badge-cell locked" key={t.tier}>
                  <img src={dishImage(t.slug)} alt={`${t.name} Feast Badge`} />
                  <div className="badge-name">{t.name} Feast Badge</div>
                  <div className="badge-req">Best streak {t.required}+</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h2>Leaderboard</h2>
        {!DAILYFEST_DEPLOYED ? (
          <p className="meta">The leaderboard goes live after deployment.</p>
        ) : lbLoading && leaderboard.length === 0 ? (
          <p className="meta">Loading…</p>
        ) : lbError ? (
          <div className="card warn">
            <p className="error">Couldn't load the leaderboard.</p>
            <button onClick={() => loadLeaderboard()}>Retry</button>
          </div>
        ) : leaderboard.length === 0 ? (
          <p className="meta">No festgoers yet — be the first to mint a dish.</p>
        ) : (
          <div className="card">
            {leaderboard.map((r, i) => (
              <div className="lb-row" key={r.address}>
                <span className="lb-rank">#{i + 1}</span>
                <span className="lb-addr">{short(r.address)}</span>
                {account && r.address.toLowerCase() === account.toLowerCase() && (
                  <span className="badge hot">you</span>
                )}
                <span className="lb-stats">
                  streak {r.current.toString()} · best {r.best.toString()} ·{" "}
                  {r.lifetime.toString()} days
                </span>
              </div>
            ))}
            <p className="meta">
              Ranked by current streak, then best streak, then total days. Addresses only —
              Daily Fest never looks up anyone's Agent ID name.
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>Festival activity</h2>
        {!DAILYFEST_DEPLOYED ? (
          <p className="meta">Activity goes live after deployment.</p>
        ) : actLoading && activity.length === 0 ? (
          <p className="meta">Loading…</p>
        ) : actError ? (
          <div className="card warn">
            <p className="error">Couldn't load recent activity.</p>
            <button onClick={() => loadActivity()}>Retry</button>
          </div>
        ) : activity.length === 0 ? (
          <p className="meta">No mints or badge claims in the recent window yet.</p>
        ) : (
          <div className="card">
            {activity.map((a, i) =>
              a.kind === "dish" ? (
                <div className="act-row" key={`d-${a.block}-${i}`}>
                  <img src={dishImage(DISHES[a.dishIndex].slug)} alt={DISHES[a.dishIndex].name} />
                  <span>
                    {short(a.user)} minted <strong>{DISHES[a.dishIndex].name}</strong>
                  </span>
                  <span className="badge">streak {a.streak.toString()}</span>
                </div>
              ) : (
                <div className="act-row" key={`b-${a.block}-${i}`}>
                  <img
                    src={dishImage(BADGE_TIERS[a.tier - 1].slug)}
                    alt={BADGE_TIERS[a.tier - 1].name}
                  />
                  <span>
                    {short(a.user)} claimed the{" "}
                    <strong>{BADGE_TIERS[a.tier - 1].name} Feast Badge</strong>
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <footer>
        <p className="meta">
          Daily Fest is free: minting a dish costs only BNB Chain gas, dishes and badges are
          soulbound (they can never be transferred, sold, or approved away), and the contract
          has no payable functions, no owner, and no admin keys. Daily Fest involves no
          token, no payments, and promises no returns — it's a festival, not an investment.
        </p>
        <p className="meta">
          Agent ID registry: {AGENT_ID_REGISTRY} · DailyFest contract:{" "}
          {DAILYFEST_DEPLOYED ? DAILYFEST_ADDRESS : `${DAILYFEST_ADDRESS} (predicted CREATE2 address — deployment pending)`}
        </p>
      </footer>
    </div>
  );
}
