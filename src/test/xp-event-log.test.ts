import { describe, expect, it } from 'vitest';

import { computeRaceXp } from '@/components/GMModePanel';
import { TRACKS, INITIAL_DRIVERS, INITIAL_TEAMS, getCarsForDrivers } from '@/lib/simulation/data';
import { initGMSession } from '@/lib/simulation/gm-engine';
import { appendLiveRaceEvent } from '@/lib/simulation/race-engine';

describe('computeRaceXp (event log)', () => {
  it('uses mirrored overtake rows in eventLog, not trimmed liveEvents', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;
    const drivers = INITIAL_DRIVERS.slice(0, 3);
    const teams = INITIAL_TEAMS.filter(t => drivers.some(d => d.teamId === t.id));
    const cars = getCarsForDrivers(teams, drivers);

    const gm = initGMSession(track, drivers, cars, teams, 'medium', 5);
    const race = gm.raceState;
    const [a, b, c] = drivers;

    appendLiveRaceEvent(race, {
      lapNumber: 1,
      type: 'overtake',
      description: `${a.name} overtakes ${b.name}`,
      primaryDriverId: a.id,
      secondaryDriverId: b.id,
    });

    // Simulate trimmed live feed (would break XP if we still read liveEvents only)
    race.liveEvents = [];

    const xp = computeRaceXp(gm, { [a.id]: 1, [b.id]: 2, [c.id]: 3 });
    expect(xp[a.id]?.pace).toBeGreaterThanOrEqual(1);
  });

  it('falls back to contested_roll when no mirrored overtake/defense rows exist', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;
    const drivers = INITIAL_DRIVERS.slice(0, 2);
    const teams = INITIAL_TEAMS.filter(t => drivers.some(d => d.teamId === t.id));
    const cars = getCarsForDrivers(teams, drivers);

    const gm = initGMSession(track, drivers, cars, teams, 'medium', 5);
    const [a, b] = drivers;

    gm.raceState.eventLog.push({
      lap: 1,
      type: 'contested_roll',
      description: `${a.name}: d20(10) + pace(0) + racecraft(0) = 20 vs ${b.name}: d20(5) + pace(0) + racecraft(0) = 15 → OVERTAKE`,
    });

    const xp = computeRaceXp(gm, { [a.id]: 2, [b.id]: 1 });
    expect(xp[a.id]?.pace).toBe(1);
    expect(xp[b.id]?.racecraft).toBe(-1);
  });
});
