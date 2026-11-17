// Build-side glue for the Token Launch Radar program.
// The model itself lives in dashboard/model.js, shared verbatim with the
// page. This file only parses the sealed snapshot, mirrors the entry gate
// as a pre-flight check, and serializes the data file the dashboard loads.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || typeof raw.as_of !== 'string') {
    throw new Error('snapshot: unexpected shape');
  }
  return raw;
}

export interface BoardRowOut {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

// Mirror of the entry gate's board checks. Returns a description of the
// first problem found, or null when the board would pass.
export function boardIssue(board: BoardRowOut[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board rows ${board.length} outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    if (!slugs.has(r.slug)) return `row ${r.slug}: slug not in snapshot`;
    if (!r.name || r.name.trim() === '') return `row ${r.slug}: empty name`;
    if (r.rank !== i + 1) return `row ${r.slug}: rank ${r.rank} != ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14)
      return `row ${r.slug}: implied_value_usd ${r.implied_value_usd} not a positive whole number <= 1e14`;
    if (r.implied_value_usd > prev) return `row ${r.slug}: implied value rises with rank`;
    if (i > 0 && r.implied_value_usd !== board[0].implied_value_usd) allEqual = false;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12)
      return `row ${r.slug}: farm_steps count ${r.farm_steps?.length} outside 3..12`;
    for (const s of r.farm_steps) {
      const t = typeof s === 'string' ? s.trim() : '';
      if (t.length < 20 || t.length > 600) return `row ${r.slug}: farm step length ${t.length} outside 20..600`;
    }
  }
  if (allEqual) return 'all implied values are equal';
  const onBoard = new Set(board.map((r) => r.slug));
  for (const w of snapshot.watchlist) if (!onBoard.has(w)) return `watchlist slug ${w} missing from board`;
  return null;
}

// The dashboard's data file. Written at the output root (not inside
// dashboard/) so the generated data stays out of the dossier's source cap;
// the page loads it as window.RADAR.
export function dataScript(meta: unknown, rows: unknown, comps: unknown, watchlist: string[]): string {
  return 'window.RADAR = ' + JSON.stringify({ meta, rows, comps, watchlist }) + ';\n';
}
