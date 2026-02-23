import type {
  Driver, Car, Track, DiceResult, DiceRequest, TyreCompound,
  DriverTyreState, DriverDamageState, AwarenessCheckResult, AwarenessOutcome,
  OvertakeOpportunityRoll, IntentDeclaration,
} from '@/types/game';
import {
  OVERTAKE_OPPORTUNITIES_PER_LAP,
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
  createFreshTyreState,
  hasTyreExceededHiddenLimit,
  isTyreDead,
  checkForcedPitCondition,
  resolvePitStop,
  TIRE_DEGRADATION_PACE_PENALTY,
  TIRE_PUNCTURE_ROLL,
  MINOR_DAMAGE_STAT_MODIFIER,
  MAJOR_DAMAGE_ROLL_MODIFIER,
  FRONT_WING_DAMAGE_ROLL,
  determineRaceFlag,
} from '@/types/game';
import { statToModifier, getModifiedDriverStat } from './track-compatibility';

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
  eventLog: RaceEvent[];
  raceFlag: 'green' | 'safetyCar' | 'redFlag';
  isComplete: boolean;
}

export interface RaceEvent {
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
  startingCompound: TyreCompound = 'medium'
): RaceState => {
  // Guard: only include drivers that have a car (avoids deleted team/driver references)
  const driversWithCars = drivers.filter(d => cars.some(c => c.teamId === d.teamId));
  // Starting grid based on qualifying simulation (simplified: sort by qualifying modifier)
  const sorted = [...driversWithCars].sort((a, b) => {
    const carA = cars.find(c => c.teamId === a.teamId);
    const carB = cars.find(c => c.teamId === b.teamId);
    const modA = carA ? getModifiedDriverStat(a, 'qualifying', carA, track) : statToModifier(a.qualifying);
    const modB = carB ? getModifiedDriverStat(b, 'qualifying', carB, track) : statToModifier(b.qualifying);
    return modB - modA; // Higher is better
  });

  const standings: DriverRaceState[] = sorted.map((d, i) => ({
    driverId: d.id,
    position: i + 1,
    tyreState: createFreshTyreState(d.id, startingCompound),
    damageState: { state: 'none' as const, location: null, hasFrontWingDamage: false },
    hasPitted: false,
    pitCount: 0,
    isDNF: false,
  }));

  return {
    track,
    drivers: driversWithCars,
    cars,
    currentLap: 0,
    totalLaps: track.lapCount,
    standings,
    eventLog: [],
    raceFlag: 'green',
    isComplete: false,
  };
};

// ============================================
// SIMULATE ONE LAP
// ============================================

export const simulateLap = (state: RaceState): RaceState => {
  const newState = { ...state, currentLap: state.currentLap + 1, eventLog: [...state.eventLog] };
  const lap = newState.currentLap;
  let standings = newState.standings.map(s => ({ ...s }));

  // 1. Tyre increment
  standings.forEach(s => {
    if (!s.isDNF) s.tyreState = { ...s.tyreState, currentLap: s.tyreState.currentLap + 1 };
  });

  // 2. Forced pit checks (simplified: auto-pit on dead tyres)
  standings.forEach(s => {
    if (s.isDNF) return;
    const forced = checkForcedPitCondition(s.tyreState);
    if (forced.isForced) {
      const driver = newState.drivers.find(d => d.id === s.driverId)!;
      s.tyreState = createFreshTyreState(s.driverId, 'hard');
      s.pitCount++;
      s.hasPitted = true;
      s.position = Math.min(s.position + newState.track.pitLossNormal, standings.length);
      newState.eventLog.push({ lap, type: 'pit_stop', description: `${driver.name} pits (forced: ${forced.reason})` });
    }
  });

  // Re-sort after pits
  standings = normalizePositions(standings);

  // 3. Opportunity Selection — FIXED 2 per lap
  for (let oppIdx = 1; oppIdx <= OVERTAKE_OPPORTUNITIES_PER_LAP; oppIdx++) {
    const activeDrivers = standings.filter(s => !s.isDNF);
    if (activeDrivers.length < 2) break;

    const driverCount = activeDrivers.length;
    const oppRoll = createDiceResult('opportunitySelection', 'dX', driverCount);
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
    const carA = newState.cars.find(c => c.teamId === attacker.teamId)!;
    const carD = newState.cars.find(c => c.teamId === defender.teamId)!;

    const attackerPaceMod = getModifiedDriverStat(attacker, 'pace', carA, newState.track);
    const attackerRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, newState.track);
    const defenderPaceMod = getModifiedDriverStat(defender, 'pace', carD, newState.track);
    const defenderRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, newState.track);

    // Damage modifiers
    const attackerState = standings.find(s => s.driverId === attackerId)!;
    const defenderState = standings.find(s => s.driverId === defenderId)!;
    const attackerDmgMod = attackerState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
    const defenderDmgMod = defenderState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;

    const aRoll = createDiceResult('overtake', 'd20', 20);
    const dRoll = createDiceResult('defend', 'd20', 20);

    const attackerTotal = aRoll.roll + attackerPaceMod + attackerRacecraftMod + attackerDmgMod;
    const defenderTotal = dRoll.roll + defenderPaceMod + defenderRacecraftMod + defenderDmgMod;

    const overtakeSuccess = attackerTotal > defenderTotal;

    newState.eventLog.push({
      lap, type: 'contested_roll',
      description: `${attacker.name}: d20(${aRoll.roll}) + pace(${attackerPaceMod}) + racecraft(${attackerRacecraftMod})${attackerDmgMod ? ` + dmg(${attackerDmgMod})` : ''} = ${attackerTotal} vs ${defender.name}: d20(${dRoll.roll}) + pace(${defenderPaceMod}) + racecraft(${defenderRacecraftMod})${defenderDmgMod ? ` + dmg(${defenderDmgMod})` : ''} = ${defenderTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
    });

    if (overtakeSuccess) {
      // Swap positions
      const aPos = attackerState.position;
      const dPos = defenderState.position;
      attackerState.position = dPos;
      defenderState.position = aPos;
    }

    // 5. Awareness check
    const rollDiff = Math.abs(attackerTotal - defenderTotal);
    if (shouldTriggerAwarenessCheck(rollDiff)) {
      const { difference, lowAwarenessRuleApplied } = calculateEffectiveAwarenessDifference(
        attacker.awareness, defender.awareness
      );
      const category = determineAwarenessOutcomeCategory(difference);

      if (category !== 'clean') {
        const d6 = createDiceResult('awareness', 'd6', 6);
        const rawOutcome = resolveAwarenessD6Outcome(difference, d6.roll);
        const { hasEvasion } = checkEvasionPriority(attacker.awareness, defender.awareness);
        const finalOutcome = applyEvasionDowngrade(rawOutcome, hasEvasion);

        newState.eventLog.push({
          lap, type: 'awareness',
          description: `Awareness check (diff ${rollDiff}): d6(${d6.roll}) → ${finalOutcome}${hasEvasion ? ' (evasion applied)' : ''}`,
        });

        // Handle damage outcomes
        if (requiresDamageHandoff(finalOutcome)) {
          const damageType = mapAwarenessOutcomeToDamageState(finalOutcome);
          // Apply to defender by default
          const target = defenderState;
          const prevState = target.damageState.state;
          target.damageState = {
            ...target.damageState,
            state: escalateDamage(target.damageState.state as any, damageType),
          };
          if (damageType === 'dnf') target.isDNF = true;
          newState.eventLog.push({
            lap, type: 'damage',
            description: `${defender.name}: ${prevState} → ${target.damageState.state}`,
          });
        }

        if (finalOutcome === 'momentumLoss') {
          defenderState.position = Math.min(
            defenderState.position + newState.track.momentumLossPositions,
            standings.filter(s => !s.isDNF).length
          );
          newState.eventLog.push({
            lap, type: 'momentum_loss',
            description: `${defender.name} loses ${newState.track.momentumLossPositions} position(s)`,
          });
        }
      } else {
        newState.eventLog.push({ lap, type: 'awareness', description: 'Awareness: Clean racing (diff ≤ 2)' });
      }
    }

    standings = normalizePositions(standings);
  }

  // 8. Tyre degradation checks
  standings.forEach(s => {
    if (s.isDNF) return;
    if (isTyreDead(s.tyreState, newState.track)) {
      s.tyreState = { ...s.tyreState, isDeadTyre: true };
    } else if (hasTyreExceededHiddenLimit(s.tyreState, newState.track) && !s.tyreState.hasExceededHiddenLimit) {
      s.tyreState = { ...s.tyreState, hasExceededHiddenLimit: true };
      const driver = newState.drivers.find(d => d.id === s.driverId)!;
      newState.eventLog.push({ lap, type: 'tyre_deg', description: `${driver.name}: tyre degradation (-1 pace)` });
    } else if (s.tyreState.hasExceededHiddenLimit) {
      // Puncture check
      const pRoll = createDiceResult('puncture', 'd6', 6);
      if (pRoll.roll === TIRE_PUNCTURE_ROLL) {
        s.tyreState = { ...s.tyreState, isPunctured: true };
        const driver = newState.drivers.find(d => d.id === s.driverId)!;
        newState.eventLog.push({ lap, type: 'puncture', description: `${driver.name}: PUNCTURE! (d6=${pRoll.roll})` });
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
  startingCompound: TyreCompound = 'medium'
): RaceState => {
  let state = initializeRace(track, drivers, cars, startingCompound);
  while (!state.isComplete) {
    state = simulateLap(state);
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
