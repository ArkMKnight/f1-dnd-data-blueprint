import { describe, expect, it } from 'vitest';

import { TRACKS, INITIAL_DRIVERS, INITIAL_TEAMS, getCarsForDrivers } from '@/lib/simulation/data';
import { initializeRace, simulateLap } from '@/lib/simulation/race-engine';
import { initGMSession, advanceGMState } from '@/lib/simulation/gm-engine';
import { getTyrePhase1Modifiers, getTyreStatus } from '@/lib/simulation/tyre-system';

describe('simulation regressions', () => {
  it('keeps existing DNFs ahead of newly created DNFs in auto sim', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;
    const drivers = INITIAL_DRIVERS.slice(0, 3);
    const teams = INITIAL_TEAMS.filter(t => drivers.some(d => d.teamId === t.id));
    const cars = getCarsForDrivers(teams, drivers);

    const race = initializeRace(track, drivers, cars, 'medium', 5, teams);
    const [newDnf, active, existingDnf] = race.standings;

    race.standings = [
      { ...newDnf, position: 1, isDNF: true },
      { ...active, position: 2, isDNF: false },
      { ...existingDnf, position: 3, isDNF: true },
    ];

    const next = simulateLap(race, teams);
    const dnfOrder = next.standings.filter(s => s.isDNF).map(s => s.driverId);

    expect(dnfOrder).toEqual([existingDnf.driverId, newDnf.driverId]);
    expect(next.standings[next.standings.length - 1].driverId).toBe(newDnf.driverId);
  });

  it('keeps existing DNFs ahead of newly created DNFs in GM mode ordering', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;
    const drivers = INITIAL_DRIVERS.slice(0, 3);
    const teams = INITIAL_TEAMS.filter(t => drivers.some(d => d.teamId === t.id));
    const cars = getCarsForDrivers(teams, drivers);

    const gm = initGMSession(track, drivers, cars, teams, 'medium', 5);
    const [newDnf, active, existingDnf] = gm.raceState.standings;

    gm.currentPhase = 'pit_decision';
    gm.raceState.currentLap = 1;
    gm.raceState.standings = [
      { ...newDnf, position: 1, isDNF: true },
      {
        ...active,
        position: 2,
        isDNF: false,
        tyreState: {
          ...active.tyreState,
          pendingPit: { active: true, compound: 'medium' },
        },
      },
      { ...existingDnf, position: 3, isDNF: true },
    ];

    const next = advanceGMState(gm);
    const dnfOrder = next.raceState.standings.filter(s => s.isDNF).map(s => s.driverId);

    expect(dnfOrder).toEqual([existingDnf.driverId, newDnf.driverId]);
    expect(next.raceState.standings[next.raceState.standings.length - 1].driverId).toBe(newDnf.driverId);
  });

  it('drops a newly DNFed GM driver to last immediately', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;
    const drivers = INITIAL_DRIVERS
      .filter(d => d.teamId === 't1' || d.teamId === 't2')
      .slice(0, 3);
    const teams = INITIAL_TEAMS.filter(t => drivers.some(d => d.teamId === t.id));
    const cars = getCarsForDrivers(teams, drivers);

    const gm = initGMSession(track, drivers, cars, teams, 'medium', 20);
    const [p6LikeDriver, activeDriver, existingDnfDriver] = gm.raceState.standings;
    gm.raceState.standings = [
      { ...p6LikeDriver, position: 1, isDNF: false },
      { ...activeDriver, position: 2, isDNF: false },
      { ...existingDnfDriver, position: 3, isDNF: true },
    ];

    gm.raceState.experimentalPartsOnes = { [p6LikeDriver.driverId]: 1 };
    gm.currentPhase = 'experimental_parts_roll';
    gm.pendingPrompt = {
      phase: 'experimental_parts_roll',
      description: 'test',
      needsInput: true,
      inputType: 'roll',
      diceSize: 6,
      context: {
        driverEntries: [{ driverId: p6LikeDriver.driverId, driverName: 'Test Driver' }],
        driverIndex: 0,
        currentLapNum: 15,
      },
    };

    const next = advanceGMState(gm, 1);
    expect(next.raceState.standings[next.raceState.standings.length - 1].driverId).toBe(
      p6LikeDriver.driverId
    );
  });

  it('applies consistent wet bucket behaviour while keeping wet tyre penalty in wet weather', () => {
    const track = TRACKS.find(t => t.id === 'tr2')!;

    const wetSpotsStatus = getTyreStatus(track, 'wet', 10, 'wetSpots');
    const dampStatus = getTyreStatus(track, 'wet', 10, 'damp');
    const wetStatus = getTyreStatus(track, 'wet', 10, 'wet');

    expect(wetSpotsStatus).toBe(dampStatus);
    expect(wetSpotsStatus).toBe('worn');
    expect(wetStatus).toBe('fresh');

    const dryTyreInWetSpots = getTyrePhase1Modifiers(
      {
        driverId: 'd-test',
        compound: 'medium',
        currentLap: 1,
        hasExceededHiddenLimit: false,
        isPunctured: false,
        isDeadTyre: false,
        lifeRemaining: 0,
        maxLife: 0,
        pendingPit: { active: false, compound: null },
        forcedPit: false,
        awaitingTyreSelection: false,
      },
      track,
      'wetSpots'
    );
    const wetTyreInWet = getTyrePhase1Modifiers(
      {
        driverId: 'd-test',
        compound: 'wet',
        currentLap: 1,
        hasExceededHiddenLimit: false,
        isPunctured: false,
        isDeadTyre: false,
        lifeRemaining: 0,
        maxLife: 0,
        pendingPit: { active: false, compound: null },
        forcedPit: false,
        awaitingTyreSelection: false,
      },
      track,
      'wet'
    );

    expect(dryTyreInWetSpots.paceDelta).toBe(-3);
    expect(wetTyreInWet.paceDelta).toBe(-2);
  });
});
