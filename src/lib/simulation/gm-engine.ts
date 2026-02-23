// GM Tabletop Engine — step-by-step race control
// The GM manually advances through each phase of the resolution order

import type {
  Driver,
  Car,
  Track,
  TyreCompound,
  DiceResult,
  OvertakeOpportunityRoll,
  OvertakeIntent,
  RaceEvent,
} from '@/types/game';
import {
  OVERTAKE_OPPORTUNITIES_PER_LAP, resolveOpportunityRoll,
  shouldTriggerAwarenessCheck, calculateEffectiveAwarenessDifference,
  checkEvasionPriority, determineAwarenessOutcomeCategory, resolveAwarenessD6Outcome,
  applyEvasionDowngrade, requiresDamageHandoff, mapAwarenessOutcomeToDamageState,
  escalateDamage, createFreshTyreState, hasTyreExceededHiddenLimit, isTyreDead,
  checkForcedPitCondition, TIRE_PUNCTURE_ROLL, MAJOR_DAMAGE_ROLL_MODIFIER,
  resolveIntentDeclaration,
} from '@/types/game';
import { statToModifier, getModifiedDriverStat } from './track-compatibility';
import type { DriverRaceState, RaceState } from './race-engine';
import { initializeRace, appendLiveRaceEvent } from './race-engine';

// ============================================
// GM PROMPT TYPES
// ============================================

export type GMPhase =
  | 'lap_start'
  | 'pit_decision'
  | 'opportunity_roll'
  | 'intent_declaration'
  | 'contested_roll'
  | 'awareness_roll'
  | 'tyre_check'
  | 'lap_end'
  | 'race_complete';

export interface GMPrompt {
  phase: GMPhase;
  description: string;
  needsInput: boolean;
  inputType?: 'roll' | 'choice' | 'confirm';
  diceSize?: number;
  choices?: { label: string; value: string }[];
  context?: Record<string, unknown>;
}

export interface GMState {
  raceState: RaceState;
  currentPhase: GMPhase;
  currentOpportunityIndex: number;
  currentOpportunity: OvertakeOpportunityRoll | null;
  pendingPrompt: GMPrompt | null;
}

// ============================================
// INITIALIZE GM SESSION
// ============================================

export const initGMSession = (
  track: Track,
  drivers: Driver[],
  cars: Car[],
  startingCompound: TyreCompound = 'medium',
  totalLapsOverride?: number
): GMState => ({
  raceState: initializeRace(track, drivers, cars, startingCompound, totalLapsOverride),
  currentPhase: 'lap_start',
  currentOpportunityIndex: 0,
  currentOpportunity: null,
  pendingPrompt: null,
});

// ============================================
// ADVANCE GM STATE
// ============================================

export const advanceGMState = (gm: GMState, input?: number | string): GMState => {
  const state = { ...gm, raceState: { ...gm.raceState, eventLog: [...gm.raceState.eventLog] } };
  const race = state.raceState;
  const lap = race.currentLap;

  switch (state.currentPhase) {
    case 'lap_start': {
      race.currentLap++;
      // Increment tyres
      race.standings.forEach(s => {
        if (!s.isDNF) s.tyreState = { ...s.tyreState, currentLap: s.tyreState.currentLap + 1 };
      });
      race.eventLog.push({ lap: race.currentLap, type: 'lap_start', description: `Lap ${race.currentLap} begins` });
      state.currentPhase = 'pit_decision';
      state.currentOpportunityIndex = 0;
      return advanceGMState(state); // auto-advance through pit decision for now
    }

    case 'pit_decision': {
      // Auto-handle forced pits
      race.standings.forEach(s => {
        if (s.isDNF) return;
        const forced = checkForcedPitCondition(s.tyreState);
        if (forced.isForced) {
          const driver = race.drivers.find(d => d.id === s.driverId)!;
          s.tyreState = createFreshTyreState(s.driverId, 'hard');
          s.pitCount++;
          s.position = Math.min(s.position + race.track.pitLossNormal, race.standings.length);
          race.eventLog.push({ lap: race.currentLap, type: 'pit_stop', description: `${driver.name} pits (forced: ${forced.reason})` });
        }
      });
      state.currentPhase = 'opportunity_roll';
      state.currentOpportunityIndex = 1;
      return generateOpportunityPrompt(state);
    }

    case 'opportunity_roll': {
      // Input is the dice roll result
      const rollValue = typeof input === 'number' ? input : parseInt(input as string);
      if (!rollValue || isNaN(rollValue)) return state;

      const activeDrivers = race.standings.filter(s => !s.isDNF);
      const diceResult: DiceResult = {
        checkType: 'opportunitySelection', diceType: 'dX',
        diceSize: activeDrivers.length, roll: rollValue,
      };
      const standingsForRoll = activeDrivers.map(s => ({ position: s.position, driverId: s.driverId }));
      const opp = resolveOpportunityRoll(diceResult, state.currentOpportunityIndex, standingsForRoll);
      state.currentOpportunity = opp;

      if (!opp.isValid) {
        race.eventLog.push({
          lap: race.currentLap, type: 'opportunity',
          description: `Opportunity ${state.currentOpportunityIndex}: rolled ${rollValue} (P1) — no overtake`,
        });
        return moveToNextOpportunityOrEnd(state);
      }

      const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
      const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
      race.eventLog.push({
        lap: race.currentLap, type: 'opportunity',
        description: `Opportunity ${state.currentOpportunityIndex}: ${attacker.name} (P${opp.selectedPosition}) attacks ${defender.name}`,
      });

      state.currentPhase = 'intent_declaration';
      state.pendingPrompt = {
        phase: 'intent_declaration',
        description: `${attacker.name} vs ${defender.name} — Declare intent`,
        needsInput: true,
        inputType: 'choice',
        choices: [
          { label: 'Contested (roll)', value: 'contested' },
          { label: 'Defender Yields', value: 'defenderYields' },
          { label: 'Attacker Forfeits', value: 'attackerForfeits' },
        ],
      };
      return state;
    }

    case 'intent_declaration': {
      const intent = (input as string) as OvertakeIntent;
      const opp = state.currentOpportunity!;

      if (intent !== 'contested') {
        const result = resolveIntentDeclaration({
          attackerId: opp.attackerDriverId!, defenderId: opp.defenderDriverId!, declaredIntent: intent,
        });
        if (result?.type === 'defenderYields') {
          const aState = race.standings.find(s => s.driverId === opp.attackerDriverId)!;
          const dState = race.standings.find(s => s.driverId === opp.defenderDriverId)!;
          const tmp = aState.position;
          aState.position = dState.position;
          dState.position = tmp;
          race.eventLog.push({
            lap: race.currentLap, type: 'intent',
            description: `Defender yields — positions swapped`,
          });
          const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
          const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
          appendLiveRaceEvent(race, {
            lapNumber: race.currentLap,
            type: 'overtake',
            description: `${attacker.name} overtakes ${defender.name} (defender yields)`,
            primaryDriverId: attacker.id,
            secondaryDriverId: defender.id,
          });
        } else {
          race.eventLog.push({
            lap: race.currentLap, type: 'intent',
            description: `Attacker forfeits — no change`,
          });
        }
        return moveToNextOpportunityOrEnd(state);
      }

      // Contested — need attacker roll
      state.currentPhase = 'contested_roll';
      const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
      const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
      state.pendingPrompt = {
        phase: 'contested_roll',
        description: `Roll d20 for ${attacker.name} (attacker) then ${defender.name} (defender). Enter attacker roll:`,
        needsInput: true,
        inputType: 'roll',
        diceSize: 20,
        context: { waitingFor: 'attacker' },
      };
      return state;
    }

    case 'contested_roll': {
      const rollValue = typeof input === 'number' ? input : parseInt(input as string);
      if (!rollValue || isNaN(rollValue)) return state;
      const opp = state.currentOpportunity!;
      const ctx = state.pendingPrompt?.context;

      if (ctx?.waitingFor === 'attacker') {
        // Store attacker roll, ask for defender
        const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
        state.pendingPrompt = {
          phase: 'contested_roll',
          description: `Now enter d20 roll for ${defender.name} (defender):`,
          needsInput: true, inputType: 'roll', diceSize: 20,
          context: { waitingFor: 'defender', attackerRoll: rollValue },
        };
        return state;
      }

      // Both rolls in — resolve
      const attackerRoll = ctx?.attackerRoll as number;
      const defenderRoll = rollValue;
      return resolveContestedRolls(state, attackerRoll, defenderRoll);
    }

    case 'awareness_roll': {
      const rollValue = typeof input === 'number' ? input : parseInt(input as string);
      if (!rollValue || isNaN(rollValue)) return state;
      return resolveAwareness(state, rollValue);
    }

    case 'tyre_check': {
      // Tyre degradation
      race.standings.forEach(s => {
        if (s.isDNF) return;
        if (isTyreDead(s.tyreState, race.track)) {
          s.tyreState = { ...s.tyreState, isDeadTyre: true };
        } else if (hasTyreExceededHiddenLimit(s.tyreState, race.track) && !s.tyreState.hasExceededHiddenLimit) {
          s.tyreState = { ...s.tyreState, hasExceededHiddenLimit: true };
          const driver = race.drivers.find(d => d.id === s.driverId)!;
          race.eventLog.push({ lap: race.currentLap, type: 'tyre_deg', description: `${driver.name}: tyre degradation (-1 pace)` });
        }
      });
      state.currentPhase = 'lap_end';
      if (race.currentLap >= race.totalLaps) {
        state.currentPhase = 'race_complete';
        race.isComplete = true;
        state.pendingPrompt = { phase: 'race_complete', description: 'Race complete!', needsInput: false };
      } else {
        state.pendingPrompt = {
          phase: 'lap_end',
          description: `Lap ${race.currentLap} complete. Press continue for next lap.`,
          needsInput: true, inputType: 'confirm',
        };
      }
      return state;
    }

    case 'lap_end': {
      state.currentPhase = 'lap_start';
      return advanceGMState(state);
    }

    default:
      return state;
  }
};

// ============================================
// INTERNAL HELPERS
// ============================================

const generateOpportunityPrompt = (state: GMState): GMState => {
  const activeDrivers = state.raceState.standings.filter(s => !s.isDNF);
  state.pendingPrompt = {
    phase: 'opportunity_roll',
    description: `Opportunity ${state.currentOpportunityIndex} of ${OVERTAKE_OPPORTUNITIES_PER_LAP}: Roll d${activeDrivers.length} for position selection`,
    needsInput: true, inputType: 'roll', diceSize: activeDrivers.length,
  };
  return state;
};

const moveToNextOpportunityOrEnd = (state: GMState): GMState => {
  if (state.currentOpportunityIndex < OVERTAKE_OPPORTUNITIES_PER_LAP) {
    state.currentOpportunityIndex++;
    state.currentOpportunity = null;
    state.currentPhase = 'opportunity_roll';
    return generateOpportunityPrompt(state);
  }
  state.currentPhase = 'tyre_check';
  return advanceGMState(state);
};

// Contested roll: only Pace + Racecraft modifiers are used (never Adaptability, Qualifying, or Awareness).
// See docs/overtake-roll-modifiers.md for prompt-generator reference.
const resolveContestedRolls = (state: GMState, attackerRoll: number, defenderRoll: number): GMState => {
  const race = state.raceState;
  const opp = state.currentOpportunity!;
  const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
  const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
  const carA = race.cars.find(c => c.teamId === attacker.teamId)!;
  const carD = race.cars.find(c => c.teamId === defender.teamId)!;

  const aPaceMod = getModifiedDriverStat(attacker, 'pace', carA, race.track);
  const aRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, race.track);
  const dPaceMod = getModifiedDriverStat(defender, 'pace', carD, race.track);
  const dRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, race.track);

  const aState = race.standings.find(s => s.driverId === attacker.id)!;
  const dState = race.standings.find(s => s.driverId === defender.id)!;
  const aDmg = aState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const dDmg = dState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;

  const aTotal = attackerRoll + aPaceMod + aRacecraftMod + aDmg;
  const dTotal = defenderRoll + dPaceMod + dRacecraftMod + dDmg;
  const overtakeSuccess = aTotal > dTotal;

  race.eventLog.push({
    lap: race.currentLap, type: 'contested_roll',
    description: `${attacker.name}: d20(${attackerRoll}) + pace(${aPaceMod}) + racecraft(${aRacecraftMod})${aDmg ? ` + dmg(${aDmg})` : ''} = ${aTotal} vs ${defender.name}: d20(${defenderRoll}) + pace(${dPaceMod}) + racecraft(${dRacecraftMod})${dDmg ? ` + dmg(${dDmg})` : ''} = ${dTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
  });

  if (overtakeSuccess) {
    const tmp = aState.position;
    aState.position = dState.position;
    dState.position = tmp;

    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'overtake',
      description: `${attacker.name} overtakes ${defender.name}`,
      primaryDriverId: attacker.id,
      secondaryDriverId: defender.id,
    });
  } else {
    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'defense',
      description: `${defender.name} successfully defends from ${attacker.name}`,
      primaryDriverId: defender.id,
      secondaryDriverId: attacker.id,
    });
  }

  // Check awareness trigger
  const rollDiff = Math.abs(aTotal - dTotal);
  if (shouldTriggerAwarenessCheck(rollDiff)) {
    const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defender.awareness);
    const category = determineAwarenessOutcomeCategory(difference);
    if (category !== 'clean') {
      state.currentPhase = 'awareness_roll';
      state.pendingPrompt = {
        phase: 'awareness_roll',
        description: `Awareness check triggered (roll diff ${rollDiff}, awareness diff ${difference}). Roll d6:`,
        needsInput: true, inputType: 'roll', diceSize: 6,
        context: { attackerId: attacker.id, defenderId: defender.id, awarenessDiff: difference },
      };
      return state;
    }
    race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: 'Awareness: Clean racing' });
  }

  return moveToNextOpportunityOrEnd(state);
};

const resolveAwareness = (state: GMState, d6Roll: number): GMState => {
  const race = state.raceState;
  const ctx = state.pendingPrompt?.context;
  const attackerId = ctx?.attackerId as string;
  const defenderId = ctx?.defenderId as string;
  const awarenessDiff = ctx?.awarenessDiff as number;
  const attacker = race.drivers.find(d => d.id === attackerId)!;
  const defender = race.drivers.find(d => d.id === defenderId)!;

  const rawOutcome = resolveAwarenessD6Outcome(awarenessDiff, d6Roll);
  const { hasEvasion } = checkEvasionPriority(attacker.awareness, defender.awareness);
  const finalOutcome = applyEvasionDowngrade(rawOutcome, hasEvasion);

  race.eventLog.push({
    lap: race.currentLap, type: 'awareness',
    description: `Awareness d6(${d6Roll}) → ${finalOutcome}${hasEvasion ? ' (evasion)' : ''}`,
  });

  if (finalOutcome !== 'cleanRacing') {
    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'incident',
      description: `${defender.name} awareness incident (${finalOutcome})`,
      primaryDriverId: defender.id,
      secondaryDriverId: attacker.id,
    });
  }

  if (requiresDamageHandoff(finalOutcome)) {
    const damageType = mapAwarenessOutcomeToDamageState(finalOutcome);
    const dState = race.standings.find(s => s.driverId === defenderId)!;
    dState.damageState = { ...dState.damageState, state: escalateDamage(dState.damageState.state as any, damageType) };
    if (damageType === 'dnf') dState.isDNF = true;
    race.eventLog.push({
      lap: race.currentLap, type: 'damage',
      description: `${defender.name}: damage → ${dState.damageState.state}`,
    });
  }

  if (finalOutcome === 'momentumLoss') {
    const dState = race.standings.find(s => s.driverId === defenderId)!;
    dState.position = Math.min(dState.position + race.track.momentumLossPositions, race.standings.filter(s => !s.isDNF).length);
    race.eventLog.push({
      lap: race.currentLap, type: 'momentum_loss',
      description: `${defender.name}: momentum loss (${race.track.momentumLossPositions} pos)`,
    });
  }

  return moveToNextOpportunityOrEnd(state);
};
