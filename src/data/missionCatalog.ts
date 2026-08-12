// Mirrors gamescripts/MissionCatalog.h. Only the fields the SERVER needs
// to price a clear live here -- the scenario setup (tanks, counts, tint)
// is purely client-side presentation and never affects the payout.
//
// The halving curve is duplicated here rather than trusting a
// client-reported amount: the client sends only which mission was
// cleared, and the server derives the credits from its own stored clear
// count. Otherwise a modified client could claim the first-clear payout
// indefinitely.

export interface MissionDef {
  id: string;
  rewardCredits: number; // first-clear payout
}

export const MIN_MISSION_REWARD = 50;

export const MISSION_CATALOG: MissionDef[] = [
  { id: "mission_black_maus", rewardCredits: 5000 },
];

export function findMission(id: string): MissionDef | undefined {
  return MISSION_CATALOG.find((m) => m.id === id);
}

export function clearsFromPairs(pairs: string[], missionId: string): number {
  for (const pair of pairs ?? []) {
    const colon = pair.indexOf(":");
    if (colon <= 0 || pair.slice(0, colon) !== missionId) continue;
    const n = Number.parseInt(pair.slice(colon + 1), 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  }
  return 0;
}

export function withClears(pairs: string[], missionId: string, clears: number): string[] {
  const next = (pairs ?? []).filter((p) => {
    const colon = p.indexOf(":");
    return colon > 0 && p.slice(0, colon) !== missionId;
  });
  if (clears > 0) next.push(`${missionId}:${clears}`);
  return next;
}

// Payout for the NEXT clear given how many are already recorded.
export function missionReward(def: MissionDef, clears: number): number {
  let reward = def.rewardCredits;
  for (let i = 0; i < clears && i < 24; i++) {
    reward = Math.floor(reward / 2);
    if (reward <= MIN_MISSION_REWARD) break;
  }
  return Math.max(MIN_MISSION_REWARD, reward);
}
