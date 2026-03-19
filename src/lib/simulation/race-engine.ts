import type {
  Driver,
  Car,
  Track,
  Team,
  DiceResult,
  DiceRequest,
  TyreCompound,
  DriverTyreState,
  DriverDamageState,
  AwarenessCheckResult,
  AwarenessOutcome,
  OvertakeOpportunityRoll,
  IntentDeclaration,
  RaceEvent,
} from '@/types/game';
import {
  OVERTAKE_OPPORTUNITIES_PER_LAP,
  getOvertakeOpportunitiesPerLapForTrack,
  resolveOpportunityRoll,
  shouldTriggerAwarenessCheck,
  calculateEffectiveAwarenessDifference,
  checkEvasionPriority,
  determineAwarenessOutcomeCategory,
  resolveAwarenessD6Outcome,
  applyEvasionDowngrade,
  resolvePositionShift,
  requiresDamageHandoff,
  escalateDamage,
  mapAwarenessOutcomeToDamageState,
  resolveIntentDeclaration,
  checkForcedPitCondition,
  MINOR_DAMAGE_STAT_MODIFIER,
  MAJOR_DAMAGE_ROLL_MODIFIER,
  FRONT_WING_DAMAGE_ROLL,
  determineRaceFlag,
  mapSingleDriverAwarenessToDifference,
} from '@/types/game';
import {
  statToModifier,
  getModifiedDriverStat,
  getMonacoRacecraftBonus,
  getTrackMatchScore,
  getTrackBonusTiers,
  getMexicoOvertakeRacecraftBonus,
  getMexicoDefendingAwarenessBonus,
  capMexicoPaceContribution,
} from './track-compatibility';
import { TRAITS_BY_ID } from '@/lib/trait-definitions';
import {
  initTraitRuntimeState,
  resolveRollWithTraits,
  applyAwarenessOutcomeTraits,
  type TraitRuntimeState,
} from './trait-engine';
import {
  createInitialDriverTyreState,
  executePitStop,
  getTyrePhase1Modifiers,
  getPuncturePhase3Penalty,
  getTyreStatus,
} from './tyre-system';

// ============================================
// RACE STATE
// ============================================

export interface DriverRaceState {
  driverId: string;
  position: number;
  tyreState: DriverTyreState;
  damageState: DriverDamageState;
  hasPitted: boolean;
  pitCount: number;
  isDNF: boolean;
}

export interface RaceState {
  track: Track;
  drivers: Driver[];
  cars: Car[];
  currentLap: number;
  totalLaps: number;
  standings: DriverRaceState[];
  eventLog: RaceLogEvent[];
  liveEvents: RaceEvent[];
  raceFlag: 'green' | 'safetyCar' | 'redFlag';
  weather: WeatherCondition;
  isComplete: boolean;
  /** When provided, trait engine is used for contested rolls and awareness. */
  teams?: Team[];
  traitRuntime?: TraitRuntimeState;
  /** Experimental Parts: count of d6=1 rolls per driver (second half, every 5th lap). DNF when count >= 2. */
  experimentalPartsOnes?: Record<string, number>;
  /** Optional pre-race configuration for starting compounds and strategy pits (used by auto sim). */
  startingCompoundsByDriver?: Record<string, TyreCompound>;
  plannedPits?: Record<string, { lap: number; compound: TyreCompound }[]>;
  /** Monaco Track Bonus — Quali Lock: driver starting P1 with 200+ Match Score cannot be overtaken while in P1. */
  monacoQualiLockDriverId?: string;
}

export interface RaceLogEvent {
  lap: number;
  type: string;
  description: string;
  details?: Record<string, unknown>;
}

// ============================================
// DICE HELPERS
// ============================================

const autoRoll = (size: number): number => Math.floor(Math.random() * size) + 1;

const createDiceResult = (checkType: string, diceType: string, size: number): DiceResult => ({
  checkType: checkType as DiceResult['checkType'],
  diceType: diceType as DiceResult['diceType'],
  diceSize: size,
  roll: autoRoll(size),
});

// ============================================
// INITIALIZE RACE
// ============================================

export const initializeRace = (
  track: Track,
  drivers: Driver[],
  cars: Car[],
  startingCompound: TyreCompound = 'medium',
  totalLapsOverride?: number,
  teams?: Team[],
  startingCompoundsByDriver?: Record<string, TyreCompound>,
  plannedPits?: Record<string, { lap: number; compound: TyreCompound }[]>
): RaceState => {
  // Guard: only include drivers that have a car (avoids deleted team/driver references)
  const driversWithCars = drivers.filter(d => cars.some(c => c.teamId === d.teamId));
  // Starting grid based on qualifying simulation, with Pace as tiebreaker.
  const sorted = [...driversWithCars].sort((a, b) => {
    const carA = cars.find(c => c.teamId === a.teamId);
    const carB = cars.find(c => c.teamId === b.teamId);
    const qualA = carA ? getModifiedDriverStat(a, 'qualifying', carA, track) : statToModifier(a.qualifying);
    const qualB = carB ? getModifiedDriverStat(b, 'qualifying', carB, track) : statToModifier(b.qualifying);
    if (qualA !== qualB) {
      return qualB - qualA; // Higher qualifying modifier starts ahead
    }
    const paceA = carA ? getModifiedDriverStat(a, 'pace', carA, track) : statToModifier(a.pace);
    const paceB = carB ? getModifiedDriverStat(b, 'pace', carB, track) : statToModifier(b.pace);
    return paceB - paceA; // Use Pace as deterministic tiebreaker
  });

  const standings: DriverRaceState[] = sorted.map((d, i) => {
    const compoundForDriver = startingCompoundsByDriver?.[d.id] ?? startingCompound;
    return {
      driverId: d.id,
      position: i + 1,
      tyreState: createInitialDriverTyreState(d.id, compoundForDriver, d, track),
      damageState: { state: 'none' as const, location: null, hasFrontWingDamage: false },
      hasPitted: false,
      pitCount: 0,
      isDNF: false,
    };
  });

  // Monaco Track Bonus — Quali Lock:
  // If starting on P1 at Monaco and the P1 car has a Match Score >= 200,
  // that driver cannot be overtaken on track while holding P1. This will
  // also re-apply whenever they regain P1 later in the race.
  let monacoQualiLockDriverId: string | undefined;
  if (track.name === 'Monaco' && cars.length > 0) {
    const p1 = standings.find(s => s.position === 1);
    if (p1) {
      const p1Driver = driversWithCars.find(d => d.id === p1.driverId);
      if (p1Driver) {
        const p1Car = cars.find(c => c.teamId === p1Driver.teamId);
        if (p1Car) {
          const matchScore = getTrackMatchScore(p1Car, track);
          const tiers = getTrackBonusTiers(matchScore);
          if (tiers.trackSpecificBonusEligible) {
            monacoQualiLockDriverId = p1.driverId;
          }
        }
      }
    }
  }

  const base: RaceState = {
    track,
    drivers: driversWithCars,
    cars,
    currentLap: 0,
    totalLaps: totalLapsOverride ?? track.lapCount,
    standings,
    eventLog: [],
    liveEvents: [],
    raceFlag: 'green',
    weather: track.weather ?? 'sunny',
    isComplete: false,
    experimentalPartsOnes: {},
    startingCompoundsByDriver: startingCompoundsByDriver ?? undefined,
    plannedPits: plannedPits ?? undefined,
    monacoQualiLockDriverId,
  };
  if (teams != null) {
    base.teams = teams;
  }
  if (teams && teams.length > 0) {
    base.traitRuntime = initTraitRuntimeState(driversWithCars, teams);
  }
  return base;
};

const MAX_LIVE_EVENTS = 50;

export const appendLiveRaceEvent = (
  state: RaceState,
  payload: Omit<RaceEvent, 'id' | 'timestamp'>
): void => {
  const baseEvents = state.liveEvents ?? [];
  const nextEvent: RaceEvent = {
    id: `${state.currentLap}-${payload.primaryDriverId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    timestamp: Date.now(),
    ...payload,
  };
  const next = [...baseEvents, nextEvent];
  state.liveEvents = next.length > MAX_LIVE_EVENTS ? next.slice(-MAX_LIVE_EVENTS) : next;
};

// ============================================
// STANDINGS MANUAL REORDER (e.g. drag-and-drop)
// ============================================

/**
 * Reorders the current standings based on a drag-and-drop result and logs the change.
 *
 * @param state Current race state
 * @param newOrder Driver IDs in desired grid order (P1..Pn). Drivers missing from this
 *                 list keep their relative order and are appended after the listed IDs.
 */
export const reorderGridWithEvent = (
  state: RaceState,
  newOrder: string[]
): RaceState => {
  const current = state.standings;
  if (!current || current.length === 0) return state;

  const byId = new Map(current.map(s => [s.driverId, s]));

  const ordered: DriverRaceState[] = [];
  const seen = new Set<string>();

  // 1) Add drivers that appear in newOrder, in that order
  newOrder.forEach((driverId, idx) => {
    const s = byId.get(driverId);
    if (!s) return;
    seen.add(driverId);
    ordered.push({ ...s, position: idx + 1 });
  });

  // 2) Append any remaining drivers, preserving their existing relative order
  current.forEach(s => {
    if (seen.has(s.driverId)) return;
    ordered.push({ ...s, position: ordered.length + 1 });
  });

  // Build a concise description of the new order for the event log
  const driverLookup = new Map(state.drivers.map(d => [d.id, d]));
  const summary = ordered
    .map(s => {
      const d = driverLookup.get(s.driverId);
      return `P${s.position} ${d?.name ?? s.driverId}`;
    })
    .join(', ');

  const isPreRace = state.currentLap === 0;
  const event: RaceLogEvent = {
    lap: state.currentLap, // Pre-race edits will show as L0
    type: isPreRace ? 'grid_edit' : 'manual_reorder',
    description: isPreRace
      ? `Starting grid manually reordered: ${summary}`
      : `Standings manually reordered (Lap ${state.currentLap}): ${summary}`,
  };

  return {
    ...state,
    standings: ordered,
    eventLog: [...state.eventLog, event],
  };
};

// ============================================
// SIMULATE ONE LAP
// ============================================

export const simulateLap = (state: RaceState, teamsOverride?: Team[] | null): RaceState => {
  const newState: RaceState = {
    ...state,
    currentLap: state.currentLap + 1,
    eventLog: [...state.eventLog],
    liveEvents: state.liveEvents ? [...state.liveEvents] : [],
    experimentalPartsOnes: { ...(state.experimentalPartsOnes ?? {}) },
    teams: teamsOverride !== undefined ? teamsOverride ?? state.teams : state.teams,
  };
  const lap = newState.currentLap;
  let standings = newState.standings.map(s => ({ ...s }));

  // Trait runtime: set half for this lap (first half vs second half of race)
  const traitRuntime = newState.traitRuntime;
  const teams = newState.teams;
  if (traitRuntime) {
    traitRuntime.halfIndex = lap > newState.totalLaps / 2 ? 2 : 1;
  }

  // Experimental Parts: one d6 every 5th lap in the second half; skip the first trigger at halfway.
  const secondHalfStart = Math.ceil(newState.totalLaps / 2);
  const shouldRunExperimentalParts =
    lap > secondHalfStart && (lap - secondHalfStart) % 5 === 0;
  if (shouldRunExperimentalParts && teams && teams.length > 0) {
    const ones = newState.experimentalPartsOnes;
    standings.forEach(s => {
      if (s.isDNF) return;
      const driver = newState.drivers.find(d => d.id === s.driverId)!;
      const team = teams.find(t => t.id === driver.teamId);
      const teamTraitId = team?.traitId ?? team?.trait ?? null;
      if (teamTraitId !== 'experimental_parts') return;
      const mechRoll = Math.floor(Math.random() * 6) + 1;
      if (mechRoll === 1) {
        const count = (ones[s.driverId] ?? 0) + 1;
        ones[s.driverId] = count;
        if (count >= 2) {
          s.isDNF = true;
          newState.eventLog.push({
            lap,
            type: 'damage',
            description: `${driver.name}: mechanical DNF (Experimental Parts, d6=1 — second 1 over the race)`,
          });
        } else {
          newState.eventLog.push({
            lap,
            type: 'damage',
            description: `${driver.name}: Experimental Parts roll d6=1 (1st warning, lap ${lap})`,
          });
        }
      }
    });
  }

  // 1. Tyre lap increment for this stint
  standings.forEach(s => {
    if (!s.isDNF) {
      s.tyreState = { ...s.tyreState, currentLap: s.tyreState.currentLap + 1 };
    }
  });

  const pittedThisLap = new Set<string>();

  // 1a. Apply any pre-planned strategy pits for this lap (auto sim)
  if (newState.plannedPits && lap < newState.totalLaps) {
    standings.forEach(s => {
      if (s.isDNF) return;
      const plans = newState.plannedPits?.[s.driverId] ?? [];
      const planForLap = plans.find(p => p.lap === lap);
      if (!planForLap) return;
      const driver = newState.drivers.find(d => d.id === s.driverId)!;
      const pitRes = executePitStop(s.tyreState, driver, newState.track, 'manual', planForLap.compound);
      s.tyreState = pitRes.updated;
      s.pitCount++;
      s.hasPitted = true;
      s.position = Math.min(s.position + pitRes.positionsLost, standings.length);
      pittedThisLap.add(s.driverId);
      newState.eventLog.push({
        lap,
        type: 'pit_stop',
        description: `${driver.name} pits (strategy: ${planForLap.compound})`,
      });
    });
  }

  // 1b. Forced pits at lap start (skip if already pitted for strategy this lap)
  standings.forEach(s => {
    if (s.isDNF) return;
    if (pittedThisLap.has(s.driverId)) return;
    const forced = checkForcedPitCondition(s.tyreState);
    if (forced.isForced) {
      const driver = newState.drivers.find(d => d.id === s.driverId)!;
      const pitRes = executePitStop(s.tyreState, driver, newState.track, 'forced', null);
      s.tyreState = pitRes.updated;
      s.pitCount++;
      s.hasPitted = true;
      s.position = Math.min(s.position + pitRes.positionsLost, standings.length);
      newState.eventLog.push({
        lap,
        type: 'pit_stop',
        description: `${driver.name} pits (forced: ${forced.reason})`,
      });
    }
  });

  // Re-sort after pits
  standings = normalizePositions(standings);

  // 4. Opportunity Selection — FIXED 2 per lap
  const opportunitiesThisLap = getOvertakeOpportunitiesPerLapForTrack(newState.track);
  for (let oppIdx = 1; oppIdx <= opportunitiesThisLap; oppIdx++) {
    const activeDrivers = standings.filter(s => !s.isDNF);
    if (activeDrivers.length < 2) break;

    const driverCount = activeDrivers.length;
    // Opportunity selection: d(driverCount - 1) + 1 → positions 2..N only (P1 is never selected)
    const baseRoll = autoRoll(driverCount - 1);
    const oppRoll: DiceResult = {
      checkType: 'opportunitySelection',
      diceType: 'dX',
      diceSize: driverCount,
      roll: baseRoll + 1,
    };
    const standingsForRoll = activeDrivers.map(s => ({ position: s.position, driverId: s.driverId }));
    const opportunity = resolveOpportunityRoll(oppRoll, oppIdx, standingsForRoll);

    if (!opportunity.isValid) {
      newState.eventLog.push({ lap, type: 'opportunity', description: `Opportunity ${oppIdx}: rolled ${oppRoll.roll} (P1) — no overtake` });
      continue;
    }

    const attackerId = opportunity.attackerDriverId!;
    const defenderId = opportunity.defenderDriverId!;
    const attacker = newState.drivers.find(d => d.id === attackerId)!;
    const defender = newState.drivers.find(d => d.id === defenderId)!;

    newState.eventLog.push({
      lap, type: 'opportunity',
      description: `Opportunity ${oppIdx}: ${attacker.name} (P${opportunity.selectedPosition}) attacks ${defender.name} (P${opportunity.selectedPosition - 1})`,
    });

    // 4. Contested roll
    const attackerState = standings.find(s => s.driverId === attackerId)!;
    const defenderState = standings.find(s => s.driverId === defenderId)!;

    // Monaco Track Bonus — Quali Lock:
    // Protected driver in P1 cannot be overtaken on track. If they are the
    // defender and currently P1, treat the attempt as automatically defended.
    if (
      newState.track.name === 'Monaco' &&
      newState.monacoQualiLockDriverId &&
      defenderId === newState.monacoQualiLockDriverId &&
      defenderState.position === 1 &&
      !defenderState.isDNF
    ) {
      appendLiveRaceEvent(newState, {
        lapNumber: lap,
        type: 'defense',
        description: `${defender.name} defends from ${attacker.name} (Monaco Quali Lock)`,
        primaryDriverId: defender.id,
        secondaryDriverId: attacker.id,
      });
      newState.eventLog.push({
        lap,
        type: 'opportunity',
        description: `Opportunity ${oppIdx}: ${attacker.name} cannot overtake ${defender.name} (Monaco Quali Lock P1)`,
      });
      continue;
    }

    const carA = newState.cars.find(c => c.teamId === attacker.teamId)!;
    const carD = newState.cars.find(c => c.teamId === defender.teamId)!;

    const attackerBasePaceMod = getModifiedDriverStat(attacker, 'pace', carA, newState.track);
    let attackerRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, newState.track);
    const defenderBasePaceMod = getModifiedDriverStat(defender, 'pace', carD, newState.track);
    let defenderRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, newState.track);

    // Monaco / Mexico contested-roll track bonuses.
    attackerRacecraftMod += getMonacoRacecraftBonus(newState.track, attacker, defender);
    defenderRacecraftMod += getMonacoRacecraftBonus(newState.track, defender, attacker);
    attackerRacecraftMod += getMexicoOvertakeRacecraftBonus(newState.track);

    const attackerTyreMods = getTyrePhase1Modifiers(attackerState.tyreState, newState.track, newState.weather);
    const defenderTyreMods = getTyrePhase1Modifiers(defenderState.tyreState, newState.track, newState.weather);

    const attackerPaceMod = attackerBasePaceMod + attackerTyreMods.paceDelta;
    const defenderPaceMod = defenderBasePaceMod + defenderTyreMods.paceDelta;
    const attackerDmgMod = attackerState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
    const defenderDmgMod = defenderState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
    const attackerPunctureMod = getPuncturePhase3Penalty(attackerState.tyreState);
    const defenderPunctureMod = getPuncturePhase3Penalty(defenderState.tyreState);

    const aRoll = createDiceResult('overtake', 'd20', 20);
    const dRoll = createDiceResult('defend', 'd20', 20);

    let attackerTotal: number;
    let defenderTotal: number;
    let attackerTraitsLabel = '';
    let defenderTraitsLabel = '';

    if (traitRuntime && teams && teams.length > 0) {
      const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
      const defenderTeam = teams.find(t => t.id === defender.teamId)!;
      const halfIndex: 1 | 2 = lap > newState.totalLaps / 2 ? 2 : 1;

      const attackerPhase1 = attackerPaceMod + attackerRacecraftMod;
      const defenderPhase1 = defenderPaceMod + defenderRacecraftMod;

      const aTraitRes = resolveRollWithTraits(traitRuntime, {
        track: newState.track,
        driver: attacker,
        team: attackerTeam,
        opponentDriver: defender,
        opponentTeam: defenderTeam,
        checkType: 'overtake',
        stat: 'pace',
        baseRoll: aRoll.roll,
        phase1Modifier: attackerPhase1,
        externalPhase3Modifier: attackerDmgMod + attackerPunctureMod,
        currentLap: lap,
        totalLaps: newState.totalLaps,
        halfIndex,
        isAttacker: true,
        position: attackerState.position,
      });
      newState.traitRuntime = aTraitRes.runtime;

      const dTraitRes = resolveRollWithTraits(newState.traitRuntime!, {
        track: newState.track,
        driver: defender,
        team: defenderTeam,
        opponentDriver: attacker,
        opponentTeam: attackerTeam,
        checkType: 'defend',
        stat: 'pace',
        baseRoll: dRoll.roll,
        phase1Modifier: defenderPhase1,
        externalPhase3Modifier: defenderDmgMod + defenderPunctureMod,
        currentLap: lap,
        totalLaps: newState.totalLaps,
        halfIndex,
        isAttacker: false,
        position: defenderState.position,
      });
      newState.traitRuntime = dTraitRes.runtime;

      const aT2 = aTraitRes.result.phase2Delta + aTraitRes.result.phase3Delta - attackerDmgMod;
      const dT2 = dTraitRes.result.phase2Delta + dTraitRes.result.phase3Delta - defenderDmgMod;
      const attackerPaceContribution = capMexicoPaceContribution(
        attacker,
        carA,
        newState.track,
        attackerPaceMod + aT2
      );
      const defenderPaceContribution = capMexicoPaceContribution(
        defender,
        carD,
        newState.track,
        defenderPaceMod + dT2
      );
      attackerTotal = aRoll.roll + attackerPaceContribution + attackerRacecraftMod + attackerDmgMod + attackerPunctureMod;
      defenderTotal = dRoll.roll + defenderPaceContribution + defenderRacecraftMod + defenderDmgMod + defenderPunctureMod;
      if (aT2 !== 0) attackerTraitsLabel = ` + traits(${aT2 >= 0 ? '+' : ''}${aT2})`;
      if (dT2 !== 0) defenderTraitsLabel = ` + traits(${dT2 >= 0 ? '+' : ''}${dT2})`;

      // Consume "next roll" temporary modifiers (e.g. momentum_driver)
      const aTr = newState.traitRuntime!.driverTraits[attackerId];
      const dTr = newState.traitRuntime!.driverTraits[defenderId];
      if (aTr?.temporaryModifiers) delete aTr.temporaryModifiers['pace:nextRoll'];
      if (dTr?.temporaryModifiers) delete dTr.temporaryModifiers['pace:nextRoll'];
    } else {
      attackerTotal =
        aRoll.roll +
        capMexicoPaceContribution(attacker, carA, newState.track, attackerPaceMod) +
        attackerRacecraftMod +
        attackerDmgMod +
        attackerPunctureMod;
      defenderTotal =
        dRoll.roll +
        capMexicoPaceContribution(defender, carD, newState.track, defenderPaceMod) +
        defenderRacecraftMod +
        defenderDmgMod +
        defenderPunctureMod;
    }

    // Criticals are based on the raw d20 roll (not the total).
    const attackerCritSuccess = aRoll.roll === 20;
    const defenderCritSuccess = dRoll.roll === 20;
    const attackerCritFailure = aRoll.roll === 1;
    const defenderCritFailure = dRoll.roll === 1;

    type CritOutcome =
      | 'none'
      | 'attackerCritSuccess'
      | 'defenderCritSuccess'
      | 'attackerCritFailure'
      | 'defenderCritFailure';

    let critOutcome: CritOutcome = 'none';
    if (attackerCritSuccess && !defenderCritSuccess) critOutcome = 'attackerCritSuccess';
    else if (defenderCritSuccess && !attackerCritSuccess) critOutcome = 'defenderCritSuccess';
    else if (attackerCritFailure && !defenderCritFailure) critOutcome = 'attackerCritFailure';
    else if (defenderCritFailure && !attackerCritFailure) critOutcome = 'defenderCritFailure';

    let overtakeSuccess: boolean;
    switch (critOutcome) {
      case 'attackerCritSuccess':
        overtakeSuccess = true;
        break;
      case 'defenderCritSuccess':
        overtakeSuccess = false;
        break;
      case 'attackerCritFailure':
        overtakeSuccess = false;
        break;
      case 'defenderCritFailure':
        overtakeSuccess = true;
        break;
      default:
        overtakeSuccess = attackerTotal > defenderTotal;
    }

    const aPaceLog = attackerTyreMods.paceDelta !== 0
      ? `pace(${attackerBasePaceMod}) + tyre(${attackerTyreMods.paceDelta >= 0 ? '+' : ''}${attackerTyreMods.paceDelta})`
      : `pace(${attackerPaceMod})`;
    const dPaceLog = defenderTyreMods.paceDelta !== 0
      ? `pace(${defenderBasePaceMod}) + tyre(${defenderTyreMods.paceDelta >= 0 ? '+' : ''}${defenderTyreMods.paceDelta})`
      : `pace(${defenderPaceMod})`;
    const aExtra = [attackerDmgMod ? `dmg(${attackerDmgMod})` : '', attackerPunctureMod ? `puncture(${attackerPunctureMod})` : ''].filter(Boolean).join(' + ');
    const dExtra = [defenderDmgMod ? `dmg(${defenderDmgMod})` : '', defenderPunctureMod ? `puncture(${defenderPunctureMod})` : ''].filter(Boolean).join(' + ');

    newState.eventLog.push({
      lap,
      type: 'contested_roll',
      description: `${attacker.name}: d20(${aRoll.roll}) + ${aPaceLog} + racecraft(${attackerRacecraftMod})${attackerTraitsLabel}${aExtra ? ` + ${aExtra}` : ''} = ${attackerTotal} vs ${defender.name}: d20(${dRoll.roll}) + ${dPaceLog} + racecraft(${defenderRacecraftMod})${defenderTraitsLabel}${dExtra ? ` + ${dExtra}` : ''} = ${defenderTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
    });

    // Live Race Events: surface critical successes/failures explicitly.
    switch (critOutcome) {
      case 'attackerCritSuccess':
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'incident',
          description: `Critical Success: ${attacker.name} rolls a natural 20 attacking ${defender.name}.`,
          primaryDriverId: attacker.id,
          secondaryDriverId: defender.id,
        });
        break;
      case 'defenderCritSuccess':
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'incident',
          description: `Critical Success: ${defender.name} rolls a natural 20 defending from ${attacker.name}.`,
          primaryDriverId: defender.id,
          secondaryDriverId: attacker.id,
        });
        break;
      case 'attackerCritFailure':
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'incident',
          description: `Critical Failure: ${attacker.name} rolls a natural 1 while attacking ${defender.name}.`,
          primaryDriverId: attacker.id,
          secondaryDriverId: defender.id,
        });
        break;
      case 'defenderCritFailure':
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'incident',
          description: `Critical Failure: ${defender.name} rolls a natural 1 while defending from ${attacker.name}.`,
          primaryDriverId: defender.id,
          secondaryDriverId: attacker.id,
        });
        break;
      case 'none':
      default:
        break;
    }

    if (overtakeSuccess) {
      const defenderTeamRef = teams?.find(t => t.id === defender.teamId);
      const defenderTeamTraitId = defenderTeamRef?.traitId ?? defenderTeamRef?.trait ?? null;
      const flexibleStrategyState = traitRuntime && teams && defenderTeamTraitId === 'flexible_strategy'
        ? traitRuntime.teamTraits[defender.teamId]
        : null;
      const useFlexibleStrategy = flexibleStrategyState && (flexibleStrategyState.usesRemaining ?? 0) > 0;

      if (useFlexibleStrategy) {
        flexibleStrategyState!.usesRemaining = Math.max(0, (flexibleStrategyState!.usesRemaining ?? 1) - 1);
        const dTr = traitRuntime!.driverTraits[defenderId];
        if (dTr && defenderState.position <= 10) {
          dTr.temporaryModifiers = dTr.temporaryModifiers || {};
          dTr.temporaryModifiers['awareness:flexible_strategy'] = -1;
        }
        newState.eventLog.push({
          lap,
          type: 'trait',
          description: defenderState.position <= 10
            ? `${defender.name}'s team used Flexible Strategy — position unchanged; -1 Awareness rest of race.`
            : `${defender.name}'s team used Flexible Strategy — position unchanged; no Awareness penalty (outside top 10).`,
        });
      } else {
        const aPos = attackerState.position;
        const dPos = defenderState.position;
        attackerState.position = dPos;
        defenderState.position = aPos;

        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'overtake',
          description: `${attacker.name} overtakes ${defender.name}`,
          primaryDriverId: attacker.id,
          secondaryDriverId: defender.id,
        });

        if (traitRuntime && teams) {
          const atId = attacker.traitId ?? attacker.trait ?? null;
          const atDef = atId ? TRAITS_BY_ID[atId] : undefined;
          if (atDef?.id === 'momentum_driver' && atDef.isEnabled) {
            const tr = traitRuntime.driverTraits[attackerId];
            if (tr) {
              tr.temporaryModifiers = tr.temporaryModifiers || {};
              tr.temporaryModifiers['pace:nextRoll'] = 1;
            }
          }
        }
      }

      // Normal awareness check for a successful overtake
      const rollDiff = Math.abs(attackerTotal - defenderTotal);
      const wetWeather =
        newState.weather === 'damp' ||
        newState.weather === 'wet' ||
        newState.weather === 'drenched';
      const attackerBaseThreshold = 10 - Math.floor(attacker.adaptability / 2);
      const defenderBaseThreshold = 10 - Math.floor(defender.adaptability / 2);
      const attackerOnDry =
        attackerState.tyreState.compound === 'soft' ||
        attackerState.tyreState.compound === 'medium' ||
        attackerState.tyreState.compound === 'hard';
      const defenderOnDry =
        defenderState.tyreState.compound === 'soft' ||
        defenderState.tyreState.compound === 'medium' ||
        defenderState.tyreState.compound === 'hard';
      const attackerThreshold = attackerOnDry ? attackerBaseThreshold * 2 : attackerBaseThreshold;
      const defenderThreshold = defenderOnDry ? defenderBaseThreshold * 2 : defenderBaseThreshold;

      // Wet Adaptability rule:
      // If a driver rolls below this threshold in wet/damp/drenched conditions,
      // they trigger an Awareness check based on their own Awareness band
      // (no attacker/defender comparison).
      const attackerFailedWetThreshold = wetWeather && aRoll.result.roll <= attackerThreshold;
      const defenderFailedWetThreshold = wetWeather && dRoll.result.roll <= defenderThreshold;
      const wetForcingAwareness = attackerFailedWetThreshold || defenderFailedWetThreshold;
      if (shouldTriggerAwarenessCheck(rollDiff) || wetForcingAwareness) {
        const defenderAwarenessForDiff =
          defender.awareness +
          getMexicoDefendingAwarenessBonus(newState.track) -
          (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
        const { difference } = calculateEffectiveAwarenessDifference(
          attacker.awareness,
          defenderAwarenessForDiff
        );
        let effectiveDiff = difference;
        if (traitRuntime) {
          const mod =
            traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
          effectiveDiff = difference + mod;
        }

        // For wet-forced checks, base the category on the single-driver Awareness band
        // rather than the attacker/defender difference, so low-Awareness drivers always
        // enter the 3-6 or 7+ tables as intended.
        const failingDriverForCategory =
          wetForcingAwareness &&
          (attackerFailedWetThreshold !== defenderFailedWetThreshold)
            ? attackerFailedWetThreshold
              ? attacker
              : defender
            : null;

        const diffForCategory = failingDriverForCategory
          ? mapSingleDriverAwarenessToDifference(failingDriverForCategory.awareness)
          : effectiveDiff;

        const category = determineAwarenessOutcomeCategory(diffForCategory);

        const defenderHasPreservation = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        const attackerHasPreservation = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        if (category !== 'clean' && (defenderHasPreservation || attackerHasPreservation)) {
          if (defenderHasPreservation) {
            // Defense fails — attacker goes through. If Flexible was used we never swapped, so swap now.
            if (useFlexibleStrategy) {
              const aPos = attackerState.position;
              const dPos = defenderState.position;
              attackerState.position = dPos;
              defenderState.position = aPos;
              appendLiveRaceEvent(newState, {
                lapNumber: lap,
                type: 'overtake',
                description: `${attacker.name} overtakes ${defender.name} (Preservation Instinct — defense fails)`,
                primaryDriverId: attacker.id,
                secondaryDriverId: defender.id,
              });
            }
            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `${defender.name} Preservation Instinct — awareness aborted; defense fails, ${attacker.name} through.`,
            });
          } else {
            // Attacker has Preservation: overtake fails — defender keeps position. Undo swap if we already did it.
            if (!useFlexibleStrategy) {
              const aPos = attackerState.position;
              const dPos = defenderState.position;
              attackerState.position = dPos;
              defenderState.position = aPos;
            }
            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `${attacker.name} Preservation Instinct — awareness aborted; overtake fails, ${defender.name} keeps position.`,
            });
          }
        } else if (category !== 'clean' || wetForcingAwareness) {
          if (wetForcingAwareness) {
            const flexMod =
              traitRuntime?.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
            const aDiff = mapSingleDriverAwarenessToDifference(attacker.awareness);
            const dDiff = mapSingleDriverAwarenessToDifference(defender.awareness + flexMod);

            let d6a = createDiceResult('awareness', 'd6', 6);
            let d6d = createDiceResult('awareness', 'd6', 6);
            let attOutcome = resolveAwarenessD6Outcome(aDiff, d6a.roll);
            let defOutcome = resolveAwarenessD6Outcome(dDiff, d6d.roll);

            if (teams && teams.length > 0) {
              const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
              const defenderTeam = teams.find(t => t.id === defender.teamId)!;
              attOutcome = applyAwarenessOutcomeTraits({
                track: newState.track,
                attacker: defender,
                defender: attacker,
                attackerTeam: defenderTeam,
                defenderTeam: attackerTeam,
                awarenessDifference: aDiff,
                baseOutcome: attOutcome,
              }).outcome;
              defOutcome = applyAwarenessOutcomeTraits({
                track: newState.track,
                attacker,
                defender,
                attackerTeam,
                defenderTeam,
                awarenessDifference: dDiff,
                baseOutcome: defOutcome,
              }).outcome;
            }

            const rsStateW = traitRuntime?.teamTraits[defender.teamId];
            const canRSW =
              defenderTeamRef &&
              (defenderTeamRef.traitId ?? defenderTeamRef.trait) === 'reactive_suspension' &&
              (rsStateW?.usesRemaining ?? 0) > 0;
            if (canRSW && defOutcome !== 'cleanRacing') {
              rsStateW!.usesRemaining = Math.max(0, (rsStateW!.usesRemaining ?? 1) - 1);
              d6d = createDiceResult('awareness', 'd6', 6);
              defOutcome = resolveAwarenessD6Outcome(dDiff, d6d.roll);
              if (teams && teams.length > 0) {
                const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                defOutcome = applyAwarenessOutcomeTraits({
                  track: newState.track,
                  attacker,
                  defender,
                  attackerTeam,
                  defenderTeam,
                  awarenessDifference: dDiff,
                  baseOutcome: defOutcome,
                }).outcome;
              }
              newState.eventLog.push({
                lap,
                type: 'trait',
                description: `${defender.name}'s team used Reactive Suspension — rerolled d6(${d6d.roll}).`,
              });
            }

            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `Awareness (wet, independent; roll diff ${rollDiff}): ${attacker.name} d6(${d6a.roll}) → ${attOutcome}; ${defender.name} d6(${d6d.roll}) → ${defOutcome}`,
            });

            const logIncident = (name: string, id: string, o: AwarenessOutcome) => {
              if (o === 'cleanRacing') return;
              appendLiveRaceEvent(newState, {
                lapNumber: lap,
                type: 'incident',
                description: `${name} awareness incident (${o})`,
                primaryDriverId: id,
                secondaryDriverId: id === attacker.id ? defender.id : attacker.id,
              });
            };
            logIncident(attacker.name, attacker.id, attOutcome);
            logIncident(defender.name, defender.id, defOutcome);

            const applyAwarenessDamage = (row: typeof attackerState, o: AwarenessOutcome) => {
              if (!requiresDamageHandoff(o)) return;
              const damageType = mapAwarenessOutcomeToDamageState(o);
              const prev = row.damageState.state;
              row.damageState = {
                ...row.damageState,
                state: escalateDamage(row.damageState.state as any, damageType),
              };
              if (damageType === 'dnf') row.isDNF = true;
              const drv = newState.drivers.find(d => d.id === row.driverId)!;
              newState.eventLog.push({
                lap,
                type: 'damage',
                description: `${drv.name}: ${prev} → ${row.damageState.state}`,
              });
            };
            applyAwarenessDamage(attackerState, attOutcome);
            applyAwarenessDamage(defenderState, defOutcome);

            const maxPosW = standings.filter(s => !s.isDNF).length;
            const lossW = newState.track.momentumLossPositions;
            if (attOutcome === 'momentumLoss') {
              attackerState.position = Math.min(attackerState.position + lossW, maxPosW);
              newState.eventLog.push({
                lap,
                type: 'momentum_loss',
                description: `${attacker.name} loses ${lossW} position(s) from Momentum Loss.`,
              });
            }
            if (defOutcome === 'momentumLoss') {
              defenderState.position = Math.min(defenderState.position + lossW, maxPosW);
              newState.eventLog.push({
                lap,
                type: 'momentum_loss',
                description: `${defender.name} loses ${lossW} position(s) from Momentum Loss.`,
              });
            }
          } else {
            let d6 = createDiceResult('awareness', 'd6', 6);
            let rawOutcome = resolveAwarenessD6Outcome(effectiveDiff, d6.roll);
            const { hasEvasion } = checkEvasionPriority(attacker.awareness, defender.awareness);
            let finalOutcome = applyEvasionDowngrade(rawOutcome, hasEvasion);
            if (teams && teams.length > 0) {
              const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
              const defenderTeam = teams.find(t => t.id === defender.teamId)!;
              const traitAdjusted = applyAwarenessOutcomeTraits({
                track: newState.track,
                attacker,
                defender,
                attackerTeam,
                defenderTeam,
                awarenessDifference: effectiveDiff,
                baseOutcome: finalOutcome,
              });
              finalOutcome = traitAdjusted.outcome;
            }

            const rsState = traitRuntime?.teamTraits[defender.teamId];
            const canReactiveSuspension =
              defenderTeamRef &&
              (defenderTeamRef.traitId ?? defenderTeamRef.trait) === 'reactive_suspension' &&
              (rsState?.usesRemaining ?? 0) > 0;
            if (canReactiveSuspension && finalOutcome !== 'cleanRacing') {
              rsState!.usesRemaining = Math.max(0, (rsState!.usesRemaining ?? 1) - 1);
              d6 = createDiceResult('awareness', 'd6', 6);
              rawOutcome = resolveAwarenessD6Outcome(effectiveDiff, d6.roll);
              finalOutcome = applyEvasionDowngrade(rawOutcome, hasEvasion);
              if (teams && teams.length > 0) {
                const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                const traitAdjusted = applyAwarenessOutcomeTraits({
                  track: newState.track,
                  attacker,
                  defender,
                  attackerTeam,
                  defenderTeam,
                  awarenessDifference: effectiveDiff,
                  baseOutcome: finalOutcome,
                });
                finalOutcome = traitAdjusted.outcome;
              }
              newState.eventLog.push({
                lap,
                type: 'trait',
                description: `${defender.name}'s team used Reactive Suspension — rerolled d6(${d6.roll}).`,
              });
            }

            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `Awareness check (diff ${rollDiff}): d6(${d6.roll}) → ${finalOutcome}${
                hasEvasion ? ' (evasion applied)' : ''
              }`,
            });

            if (finalOutcome !== 'cleanRacing') {
              appendLiveRaceEvent(newState, {
                lapNumber: lap,
                type: 'incident',
                description: `${defender.name} awareness incident (${finalOutcome})`,
                primaryDriverId: defender.id,
                secondaryDriverId: attacker.id,
              });
            }

            if (requiresDamageHandoff(finalOutcome)) {
              const damageType = mapAwarenessOutcomeToDamageState(finalOutcome);
              const prevDef = defenderState.damageState.state;
              const prevAtt = attackerState.damageState.state;
              defenderState.damageState = {
                ...defenderState.damageState,
                state: escalateDamage(defenderState.damageState.state as any, damageType),
              };
              attackerState.damageState = {
                ...attackerState.damageState,
                state: escalateDamage(attackerState.damageState.state as any, damageType),
              };
              if (damageType === 'dnf') {
                defenderState.isDNF = true;
                attackerState.isDNF = true;
              }
              newState.eventLog.push({
                lap,
                type: 'damage',
                description: `${defender.name}: ${prevDef} → ${defenderState.damageState.state}; ${attacker.name}: ${prevAtt} → ${attackerState.damageState.state}`,
              });
            }

            if (finalOutcome === 'momentumLoss') {
              const maxPos = standings.filter(s => !s.isDNF).length;
              defenderState.position = Math.min(defenderState.position + newState.track.momentumLossPositions, maxPos);
              attackerState.position = Math.min(attackerState.position + newState.track.momentumLossPositions, maxPos);
              newState.eventLog.push({
                lap,
                type: 'momentum_loss',
                description: `Both lose ${newState.track.momentumLossPositions} position(s): ${defender.name}, ${attacker.name}`,
              });
            }
          }
        } else {
          newState.eventLog.push({
            lap,
            type: 'awareness',
            description: 'Awareness: Clean racing (diff ≤ 2)',
          });
        }
      }
    } else {
      // Failed overtake: check for Relentless trait on attacker
      const attackerTraitId = attacker.traitId ?? attacker.trait ?? null;
      const attackerTrait =
        attackerTraitId && TRAITS_BY_ID[attackerTraitId]
          ? TRAITS_BY_ID[attackerTraitId]
          : null;
      const hasRelentless =
        attackerTrait && attackerTrait.id === 'relentless' && attackerTrait.isEnabled;

      if (hasRelentless) {
        // Log the initial failed attempt
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'defense',
          description: `${defender.name} defends from ${attacker.name} (Relentless initial fail)`,
          primaryDriverId: defender.id,
          secondaryDriverId: attacker.id,
        });

        // Immediate retry with -1 Pace and forced Awareness.
        const retryAttackerRoll = createDiceResult('overtake', 'd20', 20);
        const retryDefenderRoll = createDiceResult('defend', 'd20', 20);

        let retryAttackerTotal: number;
        let retryDefenderTotal: number;
        let retryAttackerTraitsLabel = '';
        let retryDefenderTraitsLabel = '';

        if (traitRuntime && teams && teams.length > 0) {
          const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
          const defenderTeam = teams.find(t => t.id === defender.teamId)!;
          const halfIndex: 1 | 2 = lap > newState.totalLaps / 2 ? 2 : 1;
          const attackerPhase1 = attackerPaceMod + attackerRacecraftMod;
          const defenderPhase1 = defenderPaceMod + defenderRacecraftMod;

          const aRetryRes = resolveRollWithTraits(traitRuntime, {
            track: newState.track,
            driver: attacker,
            team: attackerTeam,
            opponentDriver: defender,
            opponentTeam: defenderTeam,
            checkType: 'overtake',
            stat: 'pace',
            baseRoll: retryAttackerRoll.roll,
            phase1Modifier: attackerPhase1,
            externalPhase3Modifier: attackerDmgMod - 1 + attackerPunctureMod, // Relentless penalty
            currentLap: lap,
            totalLaps: newState.totalLaps,
            halfIndex,
            isAttacker: true,
            position: attackerState.position,
          });
          newState.traitRuntime = aRetryRes.runtime;

          const dRetryRes = resolveRollWithTraits(newState.traitRuntime!, {
            track: newState.track,
            driver: defender,
            team: defenderTeam,
            opponentDriver: attacker,
            opponentTeam: attackerTeam,
            checkType: 'defend',
            stat: 'pace',
            baseRoll: retryDefenderRoll.roll,
            phase1Modifier: defenderPhase1,
            externalPhase3Modifier: defenderDmgMod + defenderPunctureMod,
            currentLap: lap,
            totalLaps: newState.totalLaps,
            halfIndex,
            isAttacker: false,
            position: defenderState.position,
          });
          newState.traitRuntime = dRetryRes.runtime;

          const aR2 = aRetryRes.result.phase2Delta + aRetryRes.result.phase3Delta - (attackerDmgMod - 1);
          const dR2 = dRetryRes.result.phase2Delta + dRetryRes.result.phase3Delta - defenderDmgMod;
          const retryAttackerPaceContribution = capMexicoPaceContribution(
            attacker,
            carA,
            newState.track,
            attackerPaceMod + aR2
          );
          const retryDefenderPaceContribution = capMexicoPaceContribution(
            defender,
            carD,
            newState.track,
            defenderPaceMod + dR2
          );
          retryAttackerTotal =
            retryAttackerRoll.roll +
            retryAttackerPaceContribution +
            attackerRacecraftMod +
            attackerDmgMod +
            attackerPunctureMod -
            1;
          retryDefenderTotal =
            retryDefenderRoll.roll +
            retryDefenderPaceContribution +
            defenderRacecraftMod +
            defenderDmgMod +
            defenderPunctureMod;
          if (aR2 !== 0) retryAttackerTraitsLabel = ` + traits(${aR2 >= 0 ? '+' : ''}${aR2})`;
          if (dR2 !== 0) retryDefenderTraitsLabel = ` + traits(${dR2 >= 0 ? '+' : ''}${dR2})`;

          const aTr = newState.traitRuntime!.driverTraits[attackerId];
          const dTr = newState.traitRuntime!.driverTraits[defenderId];
          if (aTr?.temporaryModifiers) delete aTr.temporaryModifiers['pace:nextRoll'];
          if (dTr?.temporaryModifiers) delete dTr.temporaryModifiers['pace:nextRoll'];
        } else {
          retryAttackerTotal =
            retryAttackerRoll.roll +
            capMexicoPaceContribution(attacker, carA, newState.track, attackerPaceMod) +
            attackerRacecraftMod +
            attackerDmgMod +
            attackerPunctureMod -
            1;
          retryDefenderTotal =
            retryDefenderRoll.roll +
            capMexicoPaceContribution(defender, carD, newState.track, defenderPaceMod) +
            defenderRacecraftMod +
            defenderDmgMod +
            defenderPunctureMod;
        }

        // Criticals on Relentless retry are also based on raw d20.
        const retryAttackerCritSuccess = retryAttackerRoll.roll === 20;
        const retryDefenderCritSuccess = retryDefenderRoll.roll === 20;
        const retryAttackerCritFailure = retryAttackerRoll.roll === 1;
        const retryDefenderCritFailure = retryDefenderRoll.roll === 1;

        type RetryCritOutcome =
          | 'none'
          | 'attackerCritSuccess'
          | 'defenderCritSuccess'
          | 'attackerCritFailure'
          | 'defenderCritFailure';

        let retryCritOutcome: RetryCritOutcome = 'none';
        if (retryAttackerCritSuccess && !retryDefenderCritSuccess) retryCritOutcome = 'attackerCritSuccess';
        else if (retryDefenderCritSuccess && !retryAttackerCritSuccess) retryCritOutcome = 'defenderCritSuccess';
        else if (retryAttackerCritFailure && !retryDefenderCritFailure) retryCritOutcome = 'attackerCritFailure';
        else if (retryDefenderCritFailure && !retryAttackerCritFailure) retryCritOutcome = 'defenderCritFailure';

        let retrySuccess: boolean;
        switch (retryCritOutcome) {
          case 'attackerCritSuccess':
            retrySuccess = true;
            break;
          case 'defenderCritSuccess':
            retrySuccess = false;
            break;
          case 'attackerCritFailure':
            retrySuccess = false;
            break;
          case 'defenderCritFailure':
            retrySuccess = true;
            break;
          default:
            retrySuccess = retryAttackerTotal > retryDefenderTotal;
        }

        newState.eventLog.push({
          lap,
          type: 'contested_roll',
        description: `${attacker.name} (Relentless retry): d20(${retryAttackerRoll.roll}) + pace(${attackerPaceMod}) + racecraft(${attackerRacecraftMod})${retryAttackerTraitsLabel}${attackerDmgMod ? ` + dmg(${attackerDmgMod})` : ''}${attackerPunctureMod ? ` + tyre(${attackerPunctureMod})` : ''} - 1(relentless) = ${retryAttackerTotal} vs ${defender.name}: d20(${retryDefenderRoll.roll}) + pace(${defenderPaceMod}) + racecraft(${defenderRacecraftMod})${retryDefenderTraitsLabel}${defenderDmgMod ? ` + dmg(${defenderDmgMod})` : ''}${defenderPunctureMod ? ` + tyre(${defenderPunctureMod})` : ''} = ${retryDefenderTotal} → ${retrySuccess ? 'OVERTAKE' : 'DEFENDED'}`,
        });

        // Live Race Events for critical outcomes on the retry.
        switch (retryCritOutcome) {
          case 'attackerCritSuccess':
            appendLiveRaceEvent(newState, {
              lapNumber: lap,
              type: 'incident',
              description: `Critical Success: ${attacker.name} rolls a natural 20 on Relentless retry against ${defender.name}.`,
              primaryDriverId: attacker.id,
              secondaryDriverId: defender.id,
            });
            break;
          case 'defenderCritSuccess':
            appendLiveRaceEvent(newState, {
              lapNumber: lap,
              type: 'incident',
              description: `Critical Success: ${defender.name} rolls a natural 20 defending a Relentless retry from ${attacker.name}.`,
              primaryDriverId: defender.id,
              secondaryDriverId: attacker.id,
            });
            break;
          case 'attackerCritFailure':
            appendLiveRaceEvent(newState, {
              lapNumber: lap,
              type: 'incident',
              description: `Critical Failure: ${attacker.name} rolls a natural 1 on Relentless retry against ${defender.name}.`,
              primaryDriverId: attacker.id,
              secondaryDriverId: defender.id,
            });
            break;
          case 'defenderCritFailure':
            appendLiveRaceEvent(newState, {
              lapNumber: lap,
              type: 'incident',
              description: `Critical Failure: ${defender.name} rolls a natural 1 defending a Relentless retry from ${attacker.name}.`,
              primaryDriverId: defender.id,
              secondaryDriverId: attacker.id,
            });
            break;
          case 'none':
          default:
            break;
        }

        if (retrySuccess) {
          const aPos = attackerState.position;
          const dPos = defenderState.position;
          attackerState.position = dPos;
          defenderState.position = aPos;

          appendLiveRaceEvent(newState, {
            lapNumber: lap,
            type: 'overtake',
            description: `${attacker.name} overtakes ${defender.name} (Relentless retry)`,
            primaryDriverId: attacker.id,
            secondaryDriverId: defender.id,
          });
        } else {
          appendLiveRaceEvent(newState, {
            lapNumber: lap,
            type: 'defense',
            description: `${defender.name} successfully defends from ${attacker.name} (Relentless retry)`,
            primaryDriverId: defender.id,
            secondaryDriverId: attacker.id,
          });
        }

        // Forced Awareness on retry, regardless of roll difference.
        const retryRollDiff = Math.abs(retryAttackerTotal - retryDefenderTotal);
        const retryDefenderAwareness =
          defender.awareness +
          getMexicoDefendingAwarenessBonus(newState.track) -
          (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
        const { difference: retryDiff } = calculateEffectiveAwarenessDifference(
          attacker.awareness,
          retryDefenderAwareness
        );
        let retryEffectiveDiff = retryDiff;
        if (traitRuntime) {
          const mod =
            traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
          retryEffectiveDiff = retryDiff + mod;
        }
        const retryCategory = determineAwarenessOutcomeCategory(retryEffectiveDiff);
        const retryDefenderHasPreservation = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        const retryAttackerHasPreservation = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        const retryDefenderTeamRef = teams?.find(t => t.id === defender.teamId);

        if (retryCategory !== 'clean' && (retryDefenderHasPreservation || retryAttackerHasPreservation)) {
          if (retryDefenderHasPreservation) {
            // Defense fails — attacker through. If retry was success we already swapped; if retry failed we need to swap now.
            if (!retrySuccess) {
              const aPos = attackerState.position;
              const dPos = defenderState.position;
              attackerState.position = dPos;
              defenderState.position = aPos;
              appendLiveRaceEvent(newState, {
                lapNumber: lap,
                type: 'overtake',
                description: `${attacker.name} gets through (Preservation Instinct — ${defender.name}'s defense fails, Relentless retry)`,
                primaryDriverId: attacker.id,
                secondaryDriverId: defender.id,
              });
            }
            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `${defender.name} Preservation Instinct — awareness aborted (Relentless retry); defense fails, ${attacker.name} through.`,
            });
          } else {
            // Attacker has Preservation: overtake fails. If retry was success we swapped so undo; if retry failed we didn't swap.
            if (retrySuccess) {
              const aPos = attackerState.position;
              const dPos = defenderState.position;
              attackerState.position = dPos;
              defenderState.position = aPos;
            }
            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: `${attacker.name} Preservation Instinct — awareness aborted (Relentless retry); overtake fails, ${defender.name} keeps position.`,
            });
          }
        } else if (retryCategory !== 'clean') {
          let retryD6 = createDiceResult('awareness', 'd6', 6);
          let retryRawOutcome = resolveAwarenessD6Outcome(retryEffectiveDiff, retryD6.roll);
          const retryHasEvasion = checkEvasionPriority(attacker.awareness, defender.awareness);
          let retryFinalOutcome = applyEvasionDowngrade(retryRawOutcome, retryHasEvasion.hasEvasion);
          if (teams && teams.length > 0) {
            const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
            const defenderTeam = teams.find(t => t.id === defender.teamId)!;
            const traitAdjusted = applyAwarenessOutcomeTraits({
              track: newState.track,
              attacker,
              defender,
              attackerTeam,
              defenderTeam,
              awarenessDifference: retryEffectiveDiff,
              baseOutcome: retryFinalOutcome,
            });
            retryFinalOutcome = traitAdjusted.outcome;
          }
          const retryRS = traitRuntime?.teamTraits[defender.teamId];
          const retryCanRS = (retryDefenderTeamRef?.traitId ?? retryDefenderTeamRef?.trait) === 'reactive_suspension' && (retryRS?.usesRemaining ?? 0) > 0;
          if (retryCanRS && retryFinalOutcome !== 'cleanRacing') {
            retryRS!.usesRemaining = Math.max(0, (retryRS!.usesRemaining ?? 1) - 1);
            retryD6 = createDiceResult('awareness', 'd6', 6);
            retryRawOutcome = resolveAwarenessD6Outcome(retryEffectiveDiff, retryD6.roll);
            retryFinalOutcome = applyEvasionDowngrade(retryRawOutcome, retryHasEvasion.hasEvasion);
            if (teams && teams.length > 0) {
              const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
              const defenderTeam = teams.find(t => t.id === defender.teamId)!;
              const traitAdjusted = applyAwarenessOutcomeTraits({
                track: newState.track,
                attacker,
                defender,
                attackerTeam,
                defenderTeam,
                awarenessDifference: retryEffectiveDiff,
                baseOutcome: retryFinalOutcome,
              });
              retryFinalOutcome = traitAdjusted.outcome;
            }
            newState.eventLog.push({ lap, type: 'trait', description: `${defender.name}'s team used Reactive Suspension (Relentless retry).` });
          }

          newState.eventLog.push({
            lap,
            type: 'awareness',
            description: `Awareness (Relentless retry, diff ${retryRollDiff}): d6(${retryD6.roll}) → ${retryFinalOutcome}${retryHasEvasion.hasEvasion ? ' (evasion applied)' : ''}`,
          });

          if (retryFinalOutcome !== 'cleanRacing') {
            appendLiveRaceEvent(newState, {
              lapNumber: lap,
              type: 'incident',
              description: `${defender.name} awareness incident (${retryFinalOutcome})`,
              primaryDriverId: defender.id,
              secondaryDriverId: attacker.id,
            });
          }
          if (requiresDamageHandoff(retryFinalOutcome)) {
            const damageType = mapAwarenessOutcomeToDamageState(retryFinalOutcome);
            defenderState.damageState = { ...defenderState.damageState, state: escalateDamage(defenderState.damageState.state as any, damageType) };
            attackerState.damageState = { ...attackerState.damageState, state: escalateDamage(attackerState.damageState.state as any, damageType) };
            if (damageType === 'dnf') {
              defenderState.isDNF = true;
              attackerState.isDNF = true;
            }
            newState.eventLog.push({ lap, type: 'damage', description: `Both: damage → ${defenderState.damageState.state} (${defender.name}, ${attacker.name})` });
          }
          if (retryFinalOutcome === 'momentumLoss') {
            const maxPos = standings.filter(s => !s.isDNF).length;
            defenderState.position = Math.min(defenderState.position + newState.track.momentumLossPositions, maxPos);
            attackerState.position = Math.min(attackerState.position + newState.track.momentumLossPositions, maxPos);
            newState.eventLog.push({ lap, type: 'momentum_loss', description: `Both lose position(s): ${defender.name}, ${attacker.name}` });
          }
        } else {
          newState.eventLog.push({
            lap,
            type: 'awareness',
            description: 'Awareness (Relentless retry): Clean racing (diff ≤ 2)',
          });
        }

        standings = normalizePositions(standings);
        // Move straight to next opportunity
        continue;
      } else {
        // Normal failed defense without Relentless
        appendLiveRaceEvent(newState, {
          lapNumber: lap,
          type: 'defense',
          description: `${defender.name} successfully defends from ${attacker.name}`,
          primaryDriverId: defender.id,
          secondaryDriverId: attacker.id,
        });

        // Normal awareness check for failed overtake (or extra check from Drag Reduction Focus on big fail)
        const rollDiff = Math.abs(attackerTotal - defenderTotal);
        const attackerHasDragFocus = (attacker.traitId ?? attacker.trait) === 'drag_reduction_focus' && TRAITS_BY_ID['drag_reduction_focus']?.isEnabled;
        const wetWeather = newState.weather === 'damp' || newState.weather === 'wet' || newState.weather === 'drenched';
        const attackerBaseThreshold = 10 - Math.floor(attacker.adaptability / 2);
        const defenderBaseThreshold = 10 - Math.floor(defender.adaptability / 2);
        const attackerOnDry =
          attackerState.tyreState.compound === 'soft' ||
          attackerState.tyreState.compound === 'medium' ||
          attackerState.tyreState.compound === 'hard';
        const defenderOnDry =
          defenderState.tyreState.compound === 'soft' ||
          defenderState.tyreState.compound === 'medium' ||
          defenderState.tyreState.compound === 'hard';
        const attackerThreshold = attackerOnDry ? attackerBaseThreshold * 2 : attackerBaseThreshold;
        const defenderThreshold = defenderOnDry ? defenderBaseThreshold * 2 : defenderBaseThreshold;
        const failAttackerFailedWet = wetWeather && aRoll.result.roll <= attackerThreshold;
        const failDefenderFailedWet = wetWeather && dRoll.result.roll <= defenderThreshold;
        const wetForcingAwareness = failAttackerFailedWet || failDefenderFailedWet;
        const triggerAwarenessFailed =
          shouldTriggerAwarenessCheck(rollDiff) || (attackerHasDragFocus && rollDiff >= 8) || wetForcingAwareness;
        if (triggerAwarenessFailed) {
          const failDefenderTeamRefEarly = teams?.find(t => t.id === defender.teamId);
          const failDefenderAwareness =
            defender.awareness +
            getMexicoDefendingAwarenessBonus(newState.track) -
            (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
          const { difference: failDiff } = calculateEffectiveAwarenessDifference(
            attacker.awareness,
            failDefenderAwareness
          );
          let failEffectiveDiff = failDiff;
          if (traitRuntime) {
            const mod =
              traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
            failEffectiveDiff = failDiff + mod;
          }
          const failCategory = determineAwarenessOutcomeCategory(failEffectiveDiff);
          const failDefenderHasPreservation = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
          const failAttackerHasPreservation = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;

          if (failCategory !== 'clean' && (failDefenderHasPreservation || failAttackerHasPreservation)) {
            if (failDefenderHasPreservation) {
              // Defense fails — attacker goes through. We didn't swap (defender won), so swap now.
              const aPos = attackerState.position;
              const dPos = defenderState.position;
              attackerState.position = dPos;
              defenderState.position = aPos;
              appendLiveRaceEvent(newState, {
                lapNumber: lap,
                type: 'overtake',
                description: `${attacker.name} gets through (Preservation Instinct — ${defender.name}'s defense fails)`,
                primaryDriverId: attacker.id,
                secondaryDriverId: defender.id,
              });
              newState.eventLog.push({
                lap,
                type: 'awareness',
                description: `${defender.name} Preservation Instinct — awareness aborted; defense fails, ${attacker.name} through.`,
              });
            } else {
              newState.eventLog.push({
                lap,
                type: 'awareness',
                description: `${attacker.name} Preservation Instinct — awareness aborted; overtake fails, ${defender.name} keeps position.`,
              });
            }
          } else if (failCategory !== 'clean' || wetForcingAwareness) {
            if (wetForcingAwareness) {
              const flexModF =
                traitRuntime?.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
              const aDiffF = mapSingleDriverAwarenessToDifference(attacker.awareness);
              const dDiffF = mapSingleDriverAwarenessToDifference(defender.awareness + flexModF);

              let d6af = createDiceResult('awareness', 'd6', 6);
              let d6df = createDiceResult('awareness', 'd6', 6);
              let attOutF = resolveAwarenessD6Outcome(aDiffF, d6af.roll);
              let defOutF = resolveAwarenessD6Outcome(dDiffF, d6df.roll);

              if (teams && teams.length > 0) {
                const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                attOutF = applyAwarenessOutcomeTraits({
                  track: newState.track,
                  attacker: defender,
                  defender: attacker,
                  attackerTeam: defenderTeam,
                  defenderTeam: attackerTeam,
                  awarenessDifference: aDiffF,
                  baseOutcome: attOutF,
                }).outcome;
                defOutF = applyAwarenessOutcomeTraits({
                  track: newState.track,
                  attacker,
                  defender,
                  attackerTeam,
                  defenderTeam,
                  awarenessDifference: dDiffF,
                  baseOutcome: defOutF,
                }).outcome;
              }

              const failRSW = traitRuntime?.teamTraits[defender.teamId];
              const failCanRSW =
                failDefenderTeamRefEarly &&
                (failDefenderTeamRefEarly.traitId ?? failDefenderTeamRefEarly.trait) === 'reactive_suspension' &&
                (failRSW?.usesRemaining ?? 0) > 0;
              if (failCanRSW && defOutF !== 'cleanRacing') {
                failRSW!.usesRemaining = Math.max(0, (failRSW!.usesRemaining ?? 1) - 1);
                d6df = createDiceResult('awareness', 'd6', 6);
                defOutF = resolveAwarenessD6Outcome(dDiffF, d6df.roll);
                if (teams && teams.length > 0) {
                  const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                  const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                  defOutF = applyAwarenessOutcomeTraits({
                    track: newState.track,
                    attacker,
                    defender,
                    attackerTeam,
                    defenderTeam,
                    awarenessDifference: dDiffF,
                    baseOutcome: defOutF,
                  }).outcome;
                }
                newState.eventLog.push({
                  lap,
                  type: 'trait',
                  description: `${defender.name}'s team used Reactive Suspension — rerolled d6(${d6df.roll}).`,
                });
              }

              newState.eventLog.push({
                lap,
                type: 'awareness',
                description: `Awareness (wet, independent; roll diff ${rollDiff}): ${attacker.name} d6(${d6af.roll}) → ${attOutF}; ${defender.name} d6(${d6df.roll}) → ${defOutF}`,
              });

              const logIncF = (name: string, id: string, o: AwarenessOutcome) => {
                if (o === 'cleanRacing') return;
                appendLiveRaceEvent(newState, {
                  lapNumber: lap,
                  type: 'incident',
                  description: `${name} awareness incident (${o})`,
                  primaryDriverId: id,
                  secondaryDriverId: id === attacker.id ? defender.id : attacker.id,
                });
              };
              logIncF(attacker.name, attacker.id, attOutF);
              logIncF(defender.name, defender.id, defOutF);

              const applyDmgF = (row: typeof attackerState, o: AwarenessOutcome) => {
                if (!requiresDamageHandoff(o)) return;
                const damageType = mapAwarenessOutcomeToDamageState(o);
                const prev = row.damageState.state;
                row.damageState = {
                  ...row.damageState,
                  state: escalateDamage(row.damageState.state as any, damageType),
                };
                if (damageType === 'dnf') row.isDNF = true;
                const drv = newState.drivers.find(d => d.id === row.driverId)!;
                newState.eventLog.push({
                  lap,
                  type: 'damage',
                  description: `${drv.name}: ${prev} → ${row.damageState.state}`,
                });
              };
              applyDmgF(attackerState, attOutF);
              applyDmgF(defenderState, defOutF);

              const maxPosF = standings.filter(s => !s.isDNF).length;
              const lossF = newState.track.momentumLossPositions;
              if (attOutF === 'momentumLoss') {
                attackerState.position = Math.min(attackerState.position + lossF, maxPosF);
                newState.eventLog.push({
                  lap,
                  type: 'momentum_loss',
                  description: `${attacker.name} loses ${lossF} position(s) from Momentum Loss.`,
                });
              }
              if (defOutF === 'momentumLoss') {
                defenderState.position = Math.min(defenderState.position + lossF, maxPosF);
                newState.eventLog.push({
                  lap,
                  type: 'momentum_loss',
                  description: `${defender.name} loses ${lossF} position(s) from Momentum Loss.`,
                });
              }
            } else {
              let failD6 = createDiceResult('awareness', 'd6', 6);
              let failRawOutcome = resolveAwarenessD6Outcome(failEffectiveDiff, failD6.roll);
              const failHasEvasion = checkEvasionPriority(attacker.awareness, defender.awareness);
              let failFinalOutcome = applyEvasionDowngrade(failRawOutcome, failHasEvasion.hasEvasion);
              if (teams && teams.length > 0) {
                const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                const traitAdjusted = applyAwarenessOutcomeTraits({
                  track: newState.track,
                  attacker,
                  defender,
                  attackerTeam,
                  defenderTeam,
                  awarenessDifference: failEffectiveDiff,
                  baseOutcome: failFinalOutcome,
                });
                failFinalOutcome = traitAdjusted.outcome;
              }
              const failRS = traitRuntime?.teamTraits[defender.teamId];
              const failCanRS =
                (failDefenderTeamRefEarly?.traitId ?? failDefenderTeamRefEarly?.trait) === 'reactive_suspension' &&
                (failRS?.usesRemaining ?? 0) > 0;
              if (failCanRS && failFinalOutcome !== 'cleanRacing') {
                failRS!.usesRemaining = Math.max(0, (failRS!.usesRemaining ?? 1) - 1);
                failD6 = createDiceResult('awareness', 'd6', 6);
                failRawOutcome = resolveAwarenessD6Outcome(failEffectiveDiff, failD6.roll);
                failFinalOutcome = applyEvasionDowngrade(failRawOutcome, failHasEvasion.hasEvasion);
                if (teams && teams.length > 0) {
                  const attackerTeam = teams.find(t => t.id === attacker.teamId)!;
                  const defenderTeam = teams.find(t => t.id === defender.teamId)!;
                  const traitAdjusted = applyAwarenessOutcomeTraits({
                    track: newState.track,
                    attacker,
                    defender,
                    attackerTeam,
                    defenderTeam,
                    awarenessDifference: failEffectiveDiff,
                    baseOutcome: failFinalOutcome,
                  });
                  failFinalOutcome = traitAdjusted.outcome;
                }
                newState.eventLog.push({ lap, type: 'trait', description: `${defender.name}'s team used Reactive Suspension.` });
              }

              newState.eventLog.push({
                lap,
                type: 'awareness',
                description: `Awareness check (diff ${rollDiff}): d6(${failD6.roll}) → ${failFinalOutcome}${failHasEvasion.hasEvasion ? ' (evasion applied)' : ''}`,
              });

              if (failFinalOutcome !== 'cleanRacing') {
                appendLiveRaceEvent(newState, {
                  lapNumber: lap,
                  type: 'incident',
                  description: `${defender.name} awareness incident (${failFinalOutcome})`,
                  primaryDriverId: defender.id,
                  secondaryDriverId: attacker.id,
                });
              }
              if (requiresDamageHandoff(failFinalOutcome)) {
                const damageType = mapAwarenessOutcomeToDamageState(failFinalOutcome);
                const prevDef = defenderState.damageState.state;
                const prevAtt = attackerState.damageState.state;
                defenderState.damageState = {
                  ...defenderState.damageState,
                  state: escalateDamage(defenderState.damageState.state as any, damageType),
                };
                attackerState.damageState = {
                  ...attackerState.damageState,
                  state: escalateDamage(attackerState.damageState.state as any, damageType),
                };
                if (damageType === 'dnf') {
                  defenderState.isDNF = true;
                  attackerState.isDNF = true;
                }
                newState.eventLog.push({
                  lap,
                  type: 'damage',
                  description: `${defender.name}: ${prevDef} → ${defenderState.damageState.state}; ${attacker.name}: ${prevAtt} → ${attackerState.damageState.state}`,
                });
              }
              if (failFinalOutcome === 'momentumLoss') {
                const maxPos = standings.filter(s => !s.isDNF).length;
                defenderState.position = Math.min(
                  defenderState.position + newState.track.momentumLossPositions,
                  maxPos
                );
                attackerState.position = Math.min(
                  attackerState.position + newState.track.momentumLossPositions,
                  maxPos
                );
                newState.eventLog.push({
                  lap,
                  type: 'momentum_loss',
                  description: `Both lose ${newState.track.momentumLossPositions} position(s): ${defender.name}, ${attacker.name}`,
                });
              }
            }
          } else {
            newState.eventLog.push({
              lap,
              type: 'awareness',
              description: 'Awareness: Clean racing (diff ≤ 2)',
            });
          }
        }
      }
    }

    standings = normalizePositions(standings);
  }

  // 8. Tyre degradation checks (legacy hidden-limit + new life system)
  standings.forEach(s => {
    if (s.isDNF) return;
    const driver = newState.drivers.find(d => d.id === s.driverId)!;

    const status = getTyreStatus(newState.track, s.tyreState.compound, s.tyreState.currentLap, newState.weather);

    const prevExceeded = s.tyreState.hasExceededHiddenLimit;
    const hasExceeded = status === 'worn' || status === 'dead';
    const isDead = status === 'dead';

    s.tyreState = {
      ...s.tyreState,
      hasExceededHiddenLimit: hasExceeded,
      isDeadTyre: isDead,
    };

    if (!prevExceeded && hasExceeded && status === 'worn') {
      newState.eventLog.push({
        lap,
        type: 'tyre_deg',
        description: `${driver.name}: tyre degradation (-1 pace)`,
      });
    }

    if (status === 'worn' && !s.tyreState.isPunctured) {
      const pRoll = createDiceResult('puncture', 'd6', 6);
      if (pRoll.roll === 1) {
        s.tyreState = { ...s.tyreState, isPunctured: true, forcedPit: true };
        newState.eventLog.push({
          lap,
          type: 'puncture',
          description: `${driver.name}: PUNCTURE! (d6=${pRoll.roll})`,
        });
      }
    }
  });

  newState.standings = standings;
  if (newState.currentLap >= newState.totalLaps) {
    newState.isComplete = true;
  }

  return newState;
};

// ============================================
// FULL AUTO RACE
// ============================================

export const simulateFullRace = (
  track: Track,
  drivers: Driver[],
  cars: Car[],
  startingCompound: TyreCompound = 'medium',
  totalLapsOverride?: number,
  teams?: Team[],
  startingCompoundsByDriver?: Record<string, TyreCompound>,
  plannedPits?: Record<string, { lap: number; compound: TyreCompound }[]>
): RaceState => {
  let state = initializeRace(
    track,
    drivers,
    cars,
    startingCompound,
    totalLapsOverride,
    teams,
    startingCompoundsByDriver,
    plannedPits
  );
  while (!state.isComplete) {
    state = simulateLap(state, teams);
  }
  return state;
};

// ============================================
// HELPERS
// ============================================

const normalizePositions = (standings: DriverRaceState[]): DriverRaceState[] => {
  const active = standings
    .filter(s => !s.isDNF)
    .sort((a, b) => a.position - b.position);
  active.forEach((s, i) => { s.position = i + 1; });

  const dnf = standings.filter(s => s.isDNF);
  dnf.forEach((s, i) => { s.position = active.length + i + 1; });

  return [...active, ...dnf];
};
