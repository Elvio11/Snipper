import { log } from './logger.js';

const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';

/**
 * Full rug check via rugcheck.xyz API
 * Returns { safe, score, rating, risks, topHolders, details }
 */
export async function rugCheck(mintAddress) {
  try {
    const res  = await fetch(`${RUGCHECK_API}/tokens/${mintAddress}/report/summary`, {
      signal: AbortSignal.timeout(12000),
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      log('warn', `RugCheck API error: ${res.status} for ${mintAddress.slice(0,8)}...`);
      return { safe: null, error: `HTTP ${res.status}`, score: null };
    }

    const data = await res.json();
    return parseRugCheckReport(data);

  } catch (err) {
    log('warn', `RugCheck request failed: ${err.message}`);
    return { safe: null, error: err.message, score: null };
  }
}

/**
 * Quick summary-only check (faster, less data)
 */
export async function rugCheckSummary(mintAddress) {
  try {
    const res  = await fetch(`${RUGCHECK_API}/tokens/${mintAddress}/report/summary`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      score:  data.score,
      rating: data.score >= 700 ? 'Good' : data.score >= 400 ? 'Warn' : 'Danger',
      risks:  data.risks || [],
    };
  } catch {
    return null;
  }
}

function parseRugCheckReport(data) {
  const risks    = data.risks || [];
  const score    = data.score ?? 0;           // 0–1000, higher = safer
  const markets  = data.markets || [];
  const topHolders = data.topHolders || [];

  // ─── Risk flags ────────────────────────────────────────────────────────
  const flags = [];
  let riskScore = 0;

  // RugCheck risk items each have: name, description, level (warn/danger), score
  for (const risk of risks) {
    const level = risk.level?.toLowerCase();
    if (level === 'danger') {
      flags.push({ level: 'danger', name: risk.name, desc: risk.description });
      riskScore += risk.score || 50;
    } else if (level === 'warn') {
      flags.push({ level: 'warn', name: risk.name, desc: risk.description });
      riskScore += risk.score || 20;
    }
  }

  // ─── Top holder concentration ───────────────────────────────────────────
  const top10Pct = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || 0), 0);
  if (top10Pct > 80) {
    flags.push({ level: 'danger', name: 'Top10 concentration', desc: `Top 10 wallets hold ${top10Pct.toFixed(1)}%` });
  } else if (top10Pct > 60) {
    flags.push({ level: 'warn', name: 'Top10 concentration', desc: `Top 10 wallets hold ${top10Pct.toFixed(1)}%` });
  }

  // ─── LP locked check ───────────────────────────────────────────────────
  const lpLocked = markets.some(m => m.lpLockedPct > 80);
  const lpLockedPct = markets.reduce((max, m) => Math.max(max, m.lpLockedPct || 0), 0);

  // ─── Rating ────────────────────────────────────────────────────────────
  // RugCheck score: 0–1000. >700 = Good, 400–700 = Warn, <400 = Danger
  let rating;
  if      (score >= 700) rating = 'Good';
  else if (score >= 400) rating = 'Warn';
  else                   rating = 'Danger';

  const dangerFlags = flags.filter(f => f.level === 'danger');
  const safe = dangerFlags.length === 0 && score >= 500;

  return {
    safe,
    score,        // 0–1000
    rating,       // Good / Warn / Danger
    risks:    flags,
    topHolders,
    top10Pct,
    lpLocked,
    lpLockedPct,
    mintDisabled: data.mintDisabled ?? null,
    freezeDisabled: data.freezeDisabled ?? null,
    details: data,
  };
}

/**
 * Pretty-print rug check results to console
 */
export function logRugCheckResult(result, mintAddress) {
  const short = mintAddress.slice(0, 10) + '...';

  if (result.error) {
    log('warn', `RugCheck unavailable for ${short}: ${result.error}`);
    return;
  }

  const scoreColor = result.score >= 700 ? '🟢' : result.score >= 400 ? '🟡' : '🔴';
  log('info', `RugCheck ${short}: ${scoreColor} ${result.score}/1000 [${result.rating}]`);

  if (result.top10Pct) {
    log('info', `  Top 10 holders: ${result.top10Pct.toFixed(1)}%`);
  }

  if (result.lpLockedPct > 0) {
    log('info', `  LP locked: ${result.lpLockedPct.toFixed(1)}%`);
  }

  for (const risk of result.risks) {
    const icon = risk.level === 'danger' ? '🔴' : '🟡';
    log('warn', `  ${icon} ${risk.name}: ${risk.desc}`);
  }

  if (result.safe) {
    log('success', `  ✔ RugCheck PASSED`);
  } else {
    log('error', `  ✖ RugCheck FAILED — ${result.risks.filter(r => r.level === 'danger').length} danger flag(s)`);
  }
}
