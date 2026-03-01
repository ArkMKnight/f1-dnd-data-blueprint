// GM Tabletop Engine — step-by-step race control
// The GM manually advances through each phase of the resolution order

import type {
  Driver,
  Car,
  Team,
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
import {
  resolveRollWithTraits,
  initTraitRuntimeState,
  applyAwarenessOutcomeTraits,
  consumeTraitActivation,
  type TraitRuntimeState,
} from './trait-engine';
import { TRAITS_BY_ID } from '@/lib/trait-definitions';

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
  | 'trait_choice'
  | 'tyre_check'
  | 'lap_end'
  | 'race_complete'
  | 'experimental_parts_roll';

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
  teams: Team[];
  traitRuntime: TraitRuntimeState;
}

// ============================================
// INITIALIZE GM SESSION
// ============================================

export const initGMSession = (
  track: Track,
  drivers: Driver[],
  cars: Car[],
  teams: Team[],
  startingCompound: TyreCompound = 'medium',
  totalLapsOverride?: number
): GMState => ({
  raceState: initializeRace(track, drivers, cars, startingCompound, totalLapsOverride, teams),
  currentPhase: 'lap_start',
  currentOpportunityIndex: 0,
  currentOpportunity: null,
  pendingPrompt: null,
  teams,
  traitRuntime: initTraitRuntimeState(drivers, teams),
});

// ============================================
// ADVANCE GM STATE
// ============================================

export const advanceGMState = (gm: GMState, input?: number | string): GMState => {
  const state = {
    ...gm,
    raceState: {
      ...gm.raceState,
      eventLog: [...gm.raceState.eventLog],
      teams: gm.raceState.teams ?? gm.teams,
      experimentalPartsOnes: gm.raceState.experimentalPartsOnes ?? {},
    },
  };
  const race = state.raceState;
  const lap = race.currentLap;

  switch (state.currentPhase) {
    case 'lap_start': {
      race.currentLap++;
      const currentLapNum = race.currentLap;
      const newHalf: 1 | 2 = currentLapNum > Math.ceil(race.totalLaps / 2) ? 2 : 1;
      if (state.traitRuntime.halfIndex !== newHalf) {
        state.traitRuntime.halfIndex = newHalf;
        Object.values(state.traitRuntime.driverTraits).forEach(tr => {
          tr.usedThisHalf = false;
        });
      }
      // Experimental Parts: one d6 every 5th lap in second half (inclusive); prompt GM to roll or submit (like Opportunity roll)
      const secondHalfStart = Math.ceil(race.totalLaps / 2);
      const isExpPartsTriggerLap = currentLapNum >= secondHalfStart && currentLapNum % 5 === 0;
      if (isExpPartsTriggerLap && state.teams.length > 0) {
        const driverEntries: { driverId: string; driverName: string }[] = [];
        for (const s of race.standings) {
          if (s.isDNF) continue;
          const driver = race.drivers.find(d => d.id === s.driverId);
          if (!driver) continue;
          const team = state.teams.find(t => t.id === driver.teamId);
          const teamTraitId = team?.traitId ?? team?.trait ?? null;
          if (teamTraitId === 'experimental_parts') driverEntries.push({ driverId: s.driverId, driverName: driver.name });
        }
        if (driverEntries.length > 0) {
          const first = driverEntries[0];
          state.currentPhase = 'experimental_parts_roll';
          state.pendingPrompt = {
            phase: 'experimental_parts_roll',
            description: `Experimental Parts (Lap ${currentLapNum}): Roll d6 for ${first.driverName}`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: { driverEntries, driverIndex: 0, currentLapNum },
          };
          return state;
        }
      }
      // Increment tyres
      race.standings.forEach(s => {
        if (!s.isDNF) s.tyreState = { ...s.tyreState, currentLap: s.tyreState.currentLap + 1 };
      });
      race.eventLog.push({ lap: currentLapNum, type: 'lap_start', description: `Lap ${currentLapNum} begins` });
      state.currentPhase = 'pit_decision';
      state.currentOpportunityIndex = 0;
      return advanceGMState(state);
    }

    case 'experimental_parts_roll': {
      const rollValue = typeof input === 'number' ? input : parseInt(String(input ?? ''), 10);
      if (isNaN(rollValue) || rollValue < 1 || rollValue > 6) return state;
      const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
      const driverEntries = (ctx?.driverEntries as { driverId: string; driverName: string }[]) ?? [];
      const driverIndex = (ctx?.driverIndex as number) ?? 0;
      const currentLapNum = (ctx?.currentLapNum as number) ?? race.currentLap;
      if (driverIndex >= driverEntries.length) return state;
      const entry = driverEntries[driverIndex];
      const ones = race.experimentalPartsOnes!;
      const s = race.standings.find(st => st.driverId === entry.driverId);
      if (!s || s.isDNF) {
        state.pendingPrompt = null;
        return advanceGMState(state);
      }
      race.eventLog.push({
        lap: currentLapNum,
        type: 'damage',
        description: `${entry.driverName}: Experimental Parts d6 = ${rollValue}`,
      });
      if (rollValue === 1) {
        const count = (ones[entry.driverId] ?? 0) + 1;
        ones[entry.driverId] = count;
        if (count >= 2) {
          s.isDNF = true;
          race.eventLog.push({
            lap: currentLapNum,
            type: 'damage',
            description: `${entry.driverName}: mechanical DNF (Experimental Parts — second 1)`,
          });
        } else {
          race.eventLog.push({
            lap: currentLapNum,
            type: 'damage',
            description: `${entry.driverName}: 1st warning (roll 1), lap ${currentLapNum}`,
          });
        }
      }
      const nextIndex = driverIndex + 1;
      if (nextIndex < driverEntries.length) {
        const next = driverEntries[nextIndex];
        state.pendingPrompt = {
          phase: 'experimental_parts_roll',
          description: `Experimental Parts (Lap ${currentLapNum}): Roll d6 for ${next.driverName}`,
          needsInput: true,
          inputType: 'roll',
          diceSize: 6,
          context: { driverEntries, driverIndex: nextIndex, currentLapNum },
        };
        return state;
      }
      state.pendingPrompt = null;
      state.currentPhase = 'pit_decision';
      race.standings.forEach(sx => {
        if (!sx.isDNF) sx.tyreState = { ...sx.tyreState, currentLap: sx.tyreState.currentLap + 1 };
      });
      race.eventLog.push({ lap: currentLapNum, type: 'lap_start', description: `Lap ${currentLapNum} begins` });
      state.currentOpportunityIndex = 0;
      return advanceGMState(state);
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
      if (isNaN(rollValue)) return state;

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
        context: {
          waitingFor: 'attacker',
          activatedTraits: { attacker: [] as string[], defender: [] as string[] },
          activationOptions: getContestedRollActivationOptions(state, 'attacker'),
        },
      };
      return state;
    }

    case 'contested_roll': {
      const inputStr = typeof input === 'string' ? input : String(input ?? '');
      if (inputStr.startsWith('activate:')) {
        const parts = inputStr.split(':');
        const traitId = parts[1];
        const forRole = parts[2] as 'attacker' | 'defender';
        if (traitId && (forRole === 'attacker' || forRole === 'defender')) {
          const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
          const waitingFor = ctx?.waitingFor as string;
          if (waitingFor !== forRole) return state;
          const opts = (ctx?.activationOptions as ActivationOption[]) ?? [];
          if (!opts.some(o => o.traitId === traitId && o.forRole === forRole)) return state;
          const opp = state.currentOpportunity!;
          const driverId = forRole === 'attacker' ? opp.attackerDriverId! : opp.defenderDriverId!;
          if (!consumeTraitActivation(state.traitRuntime, traitId, 'driver', driverId)) return state;
          const activated = (ctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
          if (!activated[forRole].includes(traitId)) activated[forRole].push(traitId);
          state.pendingPrompt = { ...state.pendingPrompt!, context: { ...ctx, activatedTraits: activated } };
        }
        return state;
      }

      const rollValue = typeof input === 'number' ? input : parseInt(inputStr);
      if (isNaN(rollValue)) return state;
      const opp = state.currentOpportunity!;
      const ctx = state.pendingPrompt?.context;

      if (ctx?.waitingFor === 'attacker') {
        // Store attacker roll, ask for defender
        const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
        const activatedTraits = (ctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
        state.pendingPrompt = {
          phase: 'contested_roll',
          description: ctx?.mode === 'relentless_retry'
            ? `Relentless retry: now enter d20 roll for ${defender.name} (defender):`
            : `Now enter d20 roll for ${defender.name} (defender):`,
          needsInput: true, inputType: 'roll', diceSize: 20,
          context: {
            waitingFor: 'defender',
            attackerRoll: rollValue,
            mode: ctx?.mode,
            activatedTraits,
            activationOptions: getContestedRollActivationOptions(state, 'defender'),
          },
        };
        return state;
      }

      // Both rolls in — resolve
      const attackerRoll = ctx?.attackerRoll as number;
      const defenderRoll = rollValue;
      if (ctx?.mode === 'relentless_retry') {
        return resolveRelentlessRetry(state, attackerRoll, defenderRoll);
      }
      return resolveContestedRolls(state, attackerRoll, defenderRoll);
    }

    case 'awareness_roll': {
      const rollValue = typeof input === 'number' ? input : parseInt(input as string);
      if (isNaN(rollValue)) return state;
      return resolveAwareness(state, rollValue);
    }

    case 'trait_choice': {
      const choice = typeof input === 'string' ? input : '';
      const tctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
      const choiceType = tctx?.type as string;

      if (choiceType === 'flexible_strategy') {
        const attackerId = tctx?.attackerId as string;
        const defenderId = tctx?.defenderId as string;
        const rollDiff = tctx?.rollDiff as number;
        const attacker = race.drivers.find(d => d.id === attackerId)!;
        const defender = race.drivers.find(d => d.id === defenderId)!;
        const aState = race.standings.find(s => s.driverId === attackerId)!;
        const dState = race.standings.find(s => s.driverId === defenderId)!;

        if (choice === 'flexible_strategy_no') {
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
        } else if (choice === 'flexible_strategy_yes') {
          consumeTraitActivation(state.traitRuntime, 'flexible_strategy', 'team', defender.teamId);
          const dTr = state.traitRuntime.driverTraits[defenderId];
          if (dTr) {
            dTr.temporaryModifiers = dTr.temporaryModifiers || {};
            dTr.temporaryModifiers['awareness:flexible_strategy'] = -1; // rest of race
          }
          race.eventLog.push({
            lap: race.currentLap,
            type: 'trait',
            description: `${defender.name}'s team used Flexible Strategy — position unchanged; -1 Awareness for rest of race.`,
          });
        }

        const defenderAwarenessForDiffFS = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
        const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiffFS);
        const category = determineAwarenessOutcomeCategory(difference);
        if (category !== 'clean') {
          const defenderHasPreservationFS = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
          const attackerHasPreservationFS = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
          if (defenderHasPreservationFS) {
            const tmp = aState.position;
            aState.position = dState.position;
            dState.position = tmp;
            appendLiveRaceEvent(race, {
              lapNumber: race.currentLap,
              type: 'overtake',
              description: `${attacker.name} overtakes ${defender.name} (Preservation Instinct — defense fails)`,
              primaryDriverId: attacker.id,
              secondaryDriverId: defender.id,
            });
            race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${defender.name} Preservation Instinct — awareness aborted; defense fails, ${attacker.name} through.` });
            return moveToNextOpportunityOrEnd(state);
          }
          if (attackerHasPreservationFS) {
            race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${attacker.name} Preservation Instinct — awareness aborted; overtake fails, ${defender.name} keeps position.` });
            return moveToNextOpportunityOrEnd(state);
          }
          state.currentPhase = 'awareness_roll';
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: `Awareness check (roll diff ${rollDiff}). Roll d6:`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId,
              defenderId,
              awarenessDiff: difference,
            },
          };
          return state;
        }
        race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: 'Awareness: Clean racing' });
        return moveToNextOpportunityOrEnd(state);
      }

      if (choiceType === 'reactive_suspension') {
        if (choice === 'reactive_suspension_yes') {
          const defenderTeamId = tctx?.defenderTeamId as string;
          consumeTraitActivation(state.traitRuntime, 'reactive_suspension', 'team', defenderTeamId);
          race.eventLog.push({
            lap: race.currentLap,
            type: 'trait',
            description: `Reactive Suspension used — rerolling Awareness d6.`,
          });
          state.currentPhase = 'awareness_roll';
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: 'Reactive Suspension reroll — Roll d6:',
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId: tctx?.attackerId,
              defenderId: tctx?.defenderId,
              awarenessDiff: tctx?.awarenessDiff,
            },
          };
          return state;
        }
        if (choice === 'reactive_suspension_no') {
          const finalOutcome = tctx?.finalOutcome as string;
          const defenderId = tctx?.defenderId as string;
          const attackerId = tctx?.attackerId as string;
          const defenderName = tctx?.defenderName as string;
          const defender = race.drivers.find(d => d.id === defenderId)!;
          const attacker = race.drivers.find(d => d.id === attackerId)!;
          appendLiveRaceEvent(race, {
            lapNumber: race.currentLap,
            type: 'incident',
            description: `${defenderName} awareness incident (${finalOutcome})`,
            primaryDriverId: defenderId,
            secondaryDriverId: attackerId,
          });
          if (requiresDamageHandoff(finalOutcome as any)) {
            const damageType = mapAwarenessOutcomeToDamageState(finalOutcome as any);
            const dState = race.standings.find(s => s.driverId === defenderId)!;
            const aState = race.standings.find(s => s.driverId === attackerId)!;
            dState.damageState = { ...dState.damageState, state: escalateDamage(dState.damageState.state as any, damageType) };
            aState.damageState = { ...aState.damageState, state: escalateDamage(aState.damageState.state as any, damageType) };
            if (damageType === 'dnf') {
              dState.isDNF = true;
              aState.isDNF = true;
            }
            race.eventLog.push({
              lap: race.currentLap, type: 'damage',
              description: `Both: damage → ${dState.damageState.state} (${defender.name}, ${attacker.name})`,
            });
          }
          if (finalOutcome === 'momentumLoss') {
            const dState = race.standings.find(s => s.driverId === defenderId)!;
            const aState = race.standings.find(s => s.driverId === attackerId)!;
            const maxPos = race.standings.filter(s => !s.isDNF).length;
            dState.position = Math.min(dState.position + race.track.momentumLossPositions, maxPos);
            aState.position = Math.min(aState.position + race.track.momentumLossPositions, maxPos);
            race.eventLog.push({
              lap: race.currentLap, type: 'momentum_loss',
              description: `Both lose ${race.track.momentumLossPositions} pos: ${defender.name}, ${attacker.name}`,
            });
          }
        }
        return moveToNextOpportunityOrEnd(state);
      }

      return state;
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

export type ActivationOption = { traitId: string; name: string; forRole: 'attacker' | 'defender' };

/** Active traits that can be activated before this contested roll (attacker or defender d20). */
const getContestedRollActivationOptions = (
  state: GMState,
  forRole: 'attacker' | 'defender'
): ActivationOption[] => {
  const opp = state.currentOpportunity;
  if (!opp) return [];
  const driverId = forRole === 'attacker' ? opp.attackerDriverId! : opp.defenderDriverId!;
  const driver = state.raceState.drivers.find(d => d.id === driverId);
  if (!driver) return [];
  const traitId = driver.traitId ?? driver.trait ?? null;
  if (!traitId) return [];
  const def = TRAITS_BY_ID[traitId];
  if (!def?.isEnabled || def.scope !== 'driver') return [];
  const timing = def.activationTiming;
  if (timing !== 'before d20 roll' && timing !== 'before roll (once per half)') return [];

  const rt = state.traitRuntime.driverTraits[driverId];
  if (!rt) return [];
  if (traitId === 'race_intelligence' && rt.usedThisHalf) return [];
  if (rt.usesRemaining != null && rt.usesRemaining <= 0) return [];

  return [{ traitId, name: def.name, forRole }];
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
  const attackerTeam = state.teams.find(t => t.id === attacker.teamId)!;
  const defenderTeam = state.teams.find(t => t.id === defender.teamId)!;

  const aPaceMod = getModifiedDriverStat(attacker, 'pace', carA, race.track);
  const aRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, race.track);
  const dPaceMod = getModifiedDriverStat(defender, 'pace', carD, race.track);
  const dRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, race.track);

  const aState = race.standings.find(s => s.driverId === attacker.id)!;
  const dState = race.standings.find(s => s.driverId === defender.id)!;
  const aDmg = aState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const dDmg = dState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;

  const halfIndex: 1 | 2 =
    race.currentLap <= Math.ceil(race.totalLaps / 2) ? 1 : 2;

  const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const activatedTraits = (ctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
  const aAct = (activatedTraits.attacker ?? []) as string[];
  const dAct = (activatedTraits.defender ?? []) as string[];

  let attackerPhase1 = aPaceMod + aRacecraftMod;
  let defenderPhase1 = dPaceMod + dRacecraftMod;
  const raceIntelligenceActive = aAct.includes('race_intelligence') || dAct.includes('race_intelligence');
  if (raceIntelligenceActive) {
    attackerPhase1 = 2 * aRacecraftMod;
    defenderPhase1 = 2 * dRacecraftMod;
  }

  const aPaceDisplay = raceIntelligenceActive ? 0 : aPaceMod;
  const aRacecraftDisplay = raceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const dPaceDisplay = raceIntelligenceActive ? 0 : dPaceMod;
  const dRacecraftDisplay = raceIntelligenceActive ? 2 * dRacecraftMod : dRacecraftMod;

  const attackerTraitResult = resolveRollWithTraits(state.traitRuntime, {
    track: race.track,
    driver: attacker,
    team: attackerTeam,
    opponentDriver: defender,
    opponentTeam: defenderTeam,
    checkType: 'overtake',
    stat: 'pace',
    baseRoll: attackerRoll,
    phase1Modifier: attackerPhase1,
    externalPhase3Modifier: aDmg,
    currentLap: race.currentLap,
    totalLaps: race.totalLaps,
    halfIndex,
    isAttacker: true,
    position: aState.position,
  });
  state.traitRuntime = attackerTraitResult.runtime;

  const defenderTraitResult = resolveRollWithTraits(state.traitRuntime, {
    track: race.track,
    driver: defender,
    team: defenderTeam,
    opponentDriver: attacker,
    opponentTeam: attackerTeam,
    checkType: 'defend',
    stat: 'pace',
    baseRoll: defenderRoll,
    phase1Modifier: defenderPhase1,
    externalPhase3Modifier: dDmg,
    currentLap: race.currentLap,
    totalLaps: race.totalLaps,
    halfIndex,
    isAttacker: false,
    position: dState.position,
  });
  state.traitRuntime = defenderTraitResult.runtime;

  let aTotal = attackerTraitResult.result.finalTotal;
  let dTotal = defenderTraitResult.result.finalTotal;
  if (aAct.includes('power_unit_overdrive')) aTotal += 3;
  if (dAct.includes('power_unit_overdrive')) dTotal += 3;

  [aAct, dAct].forEach((list, idx) => {
    const driverId = idx === 0 ? attacker.id : defender.id;
    const tr = state.traitRuntime.driverTraits[driverId];
    if (tr) {
      tr.temporaryModifiers = tr.temporaryModifiers || {};
      if (list.includes('power_unit_overdrive')) tr.temporaryModifiers['pace:power_unit_overdrive'] = -1; // rest of race
      if (list.includes('race_intelligence')) tr.temporaryModifiers['pace:nextRoll'] = -1;
    }
  });

  const overtakeSuccess = aTotal > dTotal;

  const aTraitPhase2 = attackerTraitResult.result.phase2Delta;
  const aTraitPhase3 = attackerTraitResult.result.phase3Delta - aDmg;
  const aTraitTotal = aTraitPhase2 + aTraitPhase3 + (aAct.includes('power_unit_overdrive') ? 3 : 0);
  const dTraitPhase2 = defenderTraitResult.result.phase2Delta;
  const dTraitPhase3 = defenderTraitResult.result.phase3Delta - dDmg;
  const dTraitTotal = dTraitPhase2 + dTraitPhase3 + (dAct.includes('power_unit_overdrive') ? 3 : 0);

  const attackerTraitsLabel =
    aTraitTotal !== 0 ? ` + traits(${aTraitTotal >= 0 ? '+' : ''}${aTraitTotal})` : '';
  const defenderTraitsLabel =
    dTraitTotal !== 0 ? ` + traits(${dTraitTotal >= 0 ? '+' : ''}${dTraitTotal})` : '';

  race.eventLog.push({
    lap: race.currentLap,
    type: 'contested_roll',
    description: `${attacker.name}: d20(${attackerRoll}) + pace(${aPaceDisplay}) + racecraft(${aRacecraftDisplay})${attackerTraitsLabel}${aDmg ? ` + dmg(${aDmg})` : ''} = ${aTotal} vs ${defender.name}: d20(${defenderRoll}) + pace(${dPaceDisplay}) + racecraft(${dRacecraftDisplay})${defenderTraitsLabel}${dDmg ? ` + dmg(${dDmg})` : ''} = ${dTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
  });

  const attackerTraitId = attacker.traitId ?? attacker.trait ?? null;
  const hasRelentless = attackerTraitId === 'relentless';

  if (overtakeSuccess) {
    const defenderTeamTraitId = defenderTeam.traitId ?? defenderTeam.trait ?? null;
    const hasFlexibleStrategy =
      defenderTeamTraitId === 'flexible_strategy' &&
      (state.traitRuntime.teamTraits[defenderTeam.id]?.usesRemaining ?? 0) > 0;

    if (hasFlexibleStrategy) {
      state.currentPhase = 'trait_choice';
      state.pendingPrompt = {
        phase: 'trait_choice',
        description: `${defender.name}'s team: Use Flexible Strategy to ignore position loss (defender keeps position)? May incur -1 Awareness on next check.`,
        needsInput: true,
        inputType: 'choice',
        choices: [
          { label: 'Yes — ignore position loss', value: 'flexible_strategy_yes' },
          { label: 'No — apply overtake', value: 'flexible_strategy_no' },
        ],
        context: {
          type: 'flexible_strategy',
          attackerId: attacker.id,
          defenderId: defender.id,
          rollDiff: Math.abs(aTotal - dTotal),
          aTotal,
          dTotal,
        },
      };
      return state;
    }

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

    // Normal awareness check for successful overtake
    const rollDiff = Math.abs(aTotal - dTotal);
    if (shouldTriggerAwarenessCheck(rollDiff)) {
      const defenderAwarenessForDiff = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
      const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiff);
      const category = determineAwarenessOutcomeCategory(difference);
      if (category !== 'clean') {
        const defenderHasPreservation = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        const attackerHasPreservation = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        if (defenderHasPreservation) {
          race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${defender.name} Preservation Instinct — awareness aborted; defense fails, ${attacker.name} through.` });
        } else if (attackerHasPreservation) {
          const tmp = aState.position;
          aState.position = dState.position;
          dState.position = tmp;
          race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${attacker.name} Preservation Instinct — awareness aborted; overtake fails, ${defender.name} keeps position.` });
        } else {
          state.currentPhase = 'awareness_roll';
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: `Awareness check triggered (roll diff ${rollDiff}, awareness diff ${difference}). Roll d6:`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: { attackerId: attacker.id, defenderId: defender.id, awarenessDiff: difference },
          };
          return state;
        }
      } else {
        race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: 'Awareness: Clean racing' });
      }
    }
  } else {
    if (hasRelentless) {
      // Initial failed attempt logged, then set up Relentless retry.
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'defense',
        description: `${defender.name} defends from ${attacker.name} (Relentless initial fail)`,
        primaryDriverId: defender.id,
        secondaryDriverId: attacker.id,
      });

      state.currentPhase = 'contested_roll';
      state.pendingPrompt = {
        phase: 'contested_roll',
        description: `Relentless retry for ${attacker.name} vs ${defender.name} — enter d20 for attacker:`,
        needsInput: true,
        inputType: 'roll',
        diceSize: 20,
        context: {
          waitingFor: 'attacker',
          mode: 'relentless_retry',
          activatedTraits: { attacker: [] as string[], defender: [] as string[] },
          activationOptions: getContestedRollActivationOptions(state, 'attacker'),
        },
      };
      return state;
    }

    // Normal failed defence without Relentless
    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'defense',
      description: `${defender.name} successfully defends from ${attacker.name}`,
      primaryDriverId: defender.id,
      secondaryDriverId: attacker.id,
    });

    const rollDiff = Math.abs(aTotal - dTotal);
    const attackerHasDragFocus = (attacker.traitId ?? attacker.trait) === 'drag_reduction_focus' && TRAITS_BY_ID['drag_reduction_focus']?.isEnabled;
    const triggerAwarenessFailed = shouldTriggerAwarenessCheck(rollDiff) || (attackerHasDragFocus && rollDiff >= 8);
    if (triggerAwarenessFailed) {
      const defenderAwarenessForDiff = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
      const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiff);
      const category = determineAwarenessOutcomeCategory(difference);
      if (category !== 'clean') {
        const defenderHasPreservation = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        const attackerHasPreservation = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
        if (defenderHasPreservation) {
          const tmp = aState.position;
          aState.position = dState.position;
          dState.position = tmp;
          appendLiveRaceEvent(race, {
            lapNumber: race.currentLap,
            type: 'overtake',
            description: `${attacker.name} gets through (Preservation Instinct — ${defender.name}'s defense fails)`,
            primaryDriverId: attacker.id,
            secondaryDriverId: defender.id,
          });
          race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${defender.name} Preservation Instinct — awareness aborted; defense fails, ${attacker.name} through.` });
        } else if (attackerHasPreservation) {
          race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: `${attacker.name} Preservation Instinct — awareness aborted; overtake fails, ${defender.name} keeps position.` });
        } else {
          state.currentPhase = 'awareness_roll';
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: `Awareness check triggered (roll diff ${rollDiff}, awareness diff ${difference}). Roll d6:`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: { attackerId: attacker.id, defenderId: defender.id, awarenessDiff: difference },
          };
          return state;
        }
      } else {
        race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: 'Awareness: Clean racing' });
      }
    }
  }

  return moveToNextOpportunityOrEnd(state);
};

const resolveRelentlessRetry = (state: GMState, attackerRoll: number, defenderRoll: number): GMState => {
  const race = state.raceState;
  const opp = state.currentOpportunity!;
  const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
  const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;
  const carA = race.cars.find(c => c.teamId === attacker.teamId)!;
  const carD = race.cars.find(c => c.teamId === defender.teamId)!;
  const attackerTeam = state.teams.find(t => t.id === attacker.teamId)!;
  const defenderTeam = state.teams.find(t => t.id === defender.teamId)!;

  const aPaceMod = getModifiedDriverStat(attacker, 'pace', carA, race.track);
  const aRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, race.track);
  const dPaceMod = getModifiedDriverStat(defender, 'pace', carD, race.track);
  const dRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, race.track);

  const aState = race.standings.find(s => s.driverId === attacker.id)!;
  const dState = race.standings.find(s => s.driverId === defender.id)!;
  const aDmg = aState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const dDmg = dState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;

  const halfIndex: 1 | 2 =
    race.currentLap <= Math.ceil(race.totalLaps / 2) ? 1 : 2;

  const rctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const rAct = (rctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
  const aAct = (rAct.attacker ?? []) as string[];
  const dAct = (rAct.defender ?? []) as string[];

  let attackerPhase1 = aPaceMod + aRacecraftMod;
  let defenderPhase1 = dPaceMod + dRacecraftMod;
  const rRaceIntelligenceActive = aAct.includes('race_intelligence') || dAct.includes('race_intelligence');
  if (rRaceIntelligenceActive) {
    attackerPhase1 = 2 * aRacecraftMod;
    defenderPhase1 = 2 * dRacecraftMod;
  }

  const raPaceDisplay = rRaceIntelligenceActive ? 0 : aPaceMod;
  const raRacecraftDisplay = rRaceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const rdPaceDisplay = rRaceIntelligenceActive ? 0 : dPaceMod;
  const rdRacecraftDisplay = rRaceIntelligenceActive ? 2 * dRacecraftMod : dRacecraftMod;

  // Apply -1 Pace equivalent as a Phase 3 modifier (retry penalty)
  const attackerTraitResult = resolveRollWithTraits(state.traitRuntime, {
    track: race.track,
    driver: attacker,
    team: attackerTeam,
    opponentDriver: defender,
    opponentTeam: defenderTeam,
    checkType: 'overtake',
    stat: 'pace',
    baseRoll: attackerRoll,
    phase1Modifier: attackerPhase1,
    externalPhase3Modifier: aDmg - 1,
    currentLap: race.currentLap,
    totalLaps: race.totalLaps,
    halfIndex,
    isAttacker: true,
    position: aState.position,
  });
  state.traitRuntime = attackerTraitResult.runtime;

  const defenderTraitResult = resolveRollWithTraits(state.traitRuntime, {
    track: race.track,
    driver: defender,
    team: defenderTeam,
    opponentDriver: attacker,
    opponentTeam: attackerTeam,
    checkType: 'defend',
    stat: 'pace',
    baseRoll: defenderRoll,
    phase1Modifier: defenderPhase1,
    externalPhase3Modifier: dDmg,
    currentLap: race.currentLap,
    totalLaps: race.totalLaps,
    halfIndex,
    isAttacker: false,
    position: dState.position,
  });
  state.traitRuntime = defenderTraitResult.runtime;

  let aTotal = attackerTraitResult.result.finalTotal;
  let dTotal = defenderTraitResult.result.finalTotal;
  if (aAct.includes('power_unit_overdrive')) aTotal += 3;
  if (dAct.includes('power_unit_overdrive')) dTotal += 3;

  [aAct, dAct].forEach((list, idx) => {
    const driverId = idx === 0 ? attacker.id : defender.id;
    const tr = state.traitRuntime.driverTraits[driverId];
    if (tr) {
      tr.temporaryModifiers = tr.temporaryModifiers || {};
      if (list.includes('power_unit_overdrive')) tr.temporaryModifiers['pace:power_unit_overdrive'] = -1; // rest of race
      if (list.includes('race_intelligence')) tr.temporaryModifiers['pace:nextRoll'] = -1;
    }
  });

  const overtakeSuccess = aTotal > dTotal;

  const aTraitPhase2 = attackerTraitResult.result.phase2Delta;
  const aTraitPhase3 = attackerTraitResult.result.phase3Delta - (aDmg - 1);
  const aTraitTotal = aTraitPhase2 + aTraitPhase3 + (aAct.includes('power_unit_overdrive') ? 3 : 0);
  const dTraitPhase2 = defenderTraitResult.result.phase2Delta;
  const dTraitPhase3 = defenderTraitResult.result.phase3Delta - dDmg;
  const dTraitTotal = dTraitPhase2 + dTraitPhase3 + (dAct.includes('power_unit_overdrive') ? 3 : 0);

  const attackerTraitsLabel =
    aTraitTotal !== 0 ? ` + traits(${aTraitTotal >= 0 ? '+' : ''}${aTraitTotal})` : '';
  const defenderTraitsLabel =
    dTraitTotal !== 0 ? ` + traits(${dTraitTotal >= 0 ? '+' : ''}${dTraitTotal})` : '';

  race.eventLog.push({
    lap: race.currentLap,
    type: 'contested_roll',
    description: `${attacker.name} (Relentless retry): d20(${attackerRoll}) + pace(${raPaceDisplay}) + racecraft(${raRacecraftDisplay})${attackerTraitsLabel}${aDmg ? ` + dmg(${aDmg})` : ''} - 1(relentless) = ${aTotal} vs ${defender.name}: d20(${defenderRoll}) + pace(${rdPaceDisplay}) + racecraft(${rdRacecraftDisplay})${defenderTraitsLabel}${dDmg ? ` + dmg(${dDmg})` : ''} = ${dTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
  });

  if (overtakeSuccess) {
    const tmp = aState.position;
    aState.position = dState.position;
    dState.position = tmp;

    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'overtake',
      description: `${attacker.name} overtakes ${defender.name} (Relentless retry)`,
      primaryDriverId: attacker.id,
      secondaryDriverId: defender.id,
    });
  } else {
    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'defense',
      description: `${defender.name} successfully defends from ${attacker.name} (Relentless retry)`,
      primaryDriverId: defender.id,
      secondaryDriverId: attacker.id,
    });
  }

  // Forced awareness on retry: prompt for d6 in GM mode (no createDiceResult here)
  const rollDiff = Math.abs(aTotal - dTotal);
  const defenderAwarenessForDiffRel = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
  const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiffRel);
  const category = determineAwarenessOutcomeCategory(difference);

  if (category !== 'clean') {
    const defenderHasPreservationRel = (defender.traitId ?? defender.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
    const attackerHasPreservationRel = (attacker.traitId ?? attacker.trait) === 'preservation_instinct' && TRAITS_BY_ID['preservation_instinct']?.isEnabled;
    if (defenderHasPreservationRel) {
      if (!overtakeSuccess) {
        const tmp = aState.position;
        aState.position = dState.position;
        dState.position = tmp;
        appendLiveRaceEvent(race, {
          lapNumber: race.currentLap,
          type: 'overtake',
          description: `${attacker.name} gets through (Preservation Instinct — ${defender.name}'s defense fails, Relentless retry)`,
          primaryDriverId: attacker.id,
          secondaryDriverId: defender.id,
        });
      }
      race.eventLog.push({
        lap: race.currentLap,
        type: 'awareness',
        description: `${defender.name} Preservation Instinct — awareness aborted (Relentless retry); defense fails, ${attacker.name} through.`,
      });
      return moveToNextOpportunityOrEnd(state);
    }
    if (attackerHasPreservationRel) {
      if (overtakeSuccess) {
        const tmp = aState.position;
        aState.position = dState.position;
        dState.position = tmp;
      }
      race.eventLog.push({
        lap: race.currentLap,
        type: 'awareness',
        description: `${attacker.name} Preservation Instinct — awareness aborted (Relentless retry); overtake fails, ${defender.name} keeps position.`,
      });
      return moveToNextOpportunityOrEnd(state);
    }
    state.currentPhase = 'awareness_roll';
    state.pendingPrompt = {
      phase: 'awareness_roll',
      description: `Awareness (Relentless retry, roll diff ${rollDiff}). Roll d6:`,
      needsInput: true,
      inputType: 'roll',
      diceSize: 6,
      context: { attackerId: attacker.id, defenderId: defender.id, awarenessDiff: difference },
    };
    return state;
  }

  race.eventLog.push({
    lap: race.currentLap,
    type: 'awareness',
    description: 'Awareness (Relentless retry): Clean racing (diff ≤ 2)',
  });
  return moveToNextOpportunityOrEnd(state);
};

const resolveAwareness = (state: GMState, d6Roll: number): GMState => {
  const race = state.raceState;
  const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const attackerId = ctx?.attackerId as string;
  const defenderId = ctx?.defenderId as string;
  const awarenessDiff = (ctx?.awarenessDiff as number) ?? 0;
  const defenderMod = (ctx?.awarenessDefenderModifier as number) ?? 0;
  const persistentAwarenessMod =
    (state.traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0);
  const effectiveDiff = awarenessDiff + defenderMod + persistentAwarenessMod;
  const attacker = race.drivers.find(d => d.id === attackerId)!;
  const defender = race.drivers.find(d => d.id === defenderId)!;

  const rawOutcome = resolveAwarenessD6Outcome(effectiveDiff, d6Roll);
  const { hasEvasion } = checkEvasionPriority(attacker.awareness, defender.awareness);
  const evasionAdjusted = applyEvasionDowngrade(rawOutcome, hasEvasion);

  const attackerTeam = state.teams.find(t => t.id === attacker.teamId)!;
  const defenderTeam = state.teams.find(t => t.id === defender.teamId)!;

  const traitAdjusted = applyAwarenessOutcomeTraits({
    track: race.track,
    attacker,
    defender,
    attackerTeam,
    defenderTeam,
    awarenessDifference: effectiveDiff,
    baseOutcome: evasionAdjusted,
  });
  const finalOutcome = traitAdjusted.outcome;

  race.eventLog.push({
    lap: race.currentLap, type: 'awareness',
    description: `Awareness d6(${d6Roll}) → ${finalOutcome}${hasEvasion ? ' (evasion)' : ''}`,
  });

  if (finalOutcome !== 'cleanRacing') {
    const rsState = state.traitRuntime.teamTraits[defenderTeam.id];
    const canReactiveSuspension =
      (defenderTeam.traitId ?? defenderTeam.trait) === 'reactive_suspension' &&
      (rsState?.usesRemaining ?? 0) > 0;

    if (canReactiveSuspension) {
      state.currentPhase = 'trait_choice';
      state.pendingPrompt = {
        phase: 'trait_choice',
        description: `${defender.name}'s team: Use Reactive Suspension to reroll this Awareness? (Once per race)`,
        needsInput: true,
        inputType: 'choice',
        choices: [
          { label: 'Yes — reroll d6', value: 'reactive_suspension_yes' },
          { label: 'No — keep result', value: 'reactive_suspension_no' },
        ],
        context: {
          type: 'reactive_suspension',
          attackerId,
          defenderId,
          defenderTeamId: defenderTeam.id,
          awarenessDiff: effectiveDiff,
          finalOutcome,
          d6Roll,
          defenderName: defender.name,
        },
      };
      return state;
    }

    appendLiveRaceEvent(race, {
      lapNumber: race.currentLap,
      type: 'incident',
      description: `${defender.name} awareness incident (${finalOutcome})`,
      primaryDriverId: defender.id,
      secondaryDriverId: attacker.id,
    });
  }

  if (finalOutcome !== 'cleanRacing') {
    if (requiresDamageHandoff(finalOutcome)) {
      const damageType = mapAwarenessOutcomeToDamageState(finalOutcome);
      const dState = race.standings.find(s => s.driverId === defenderId)!;
      const aState = race.standings.find(s => s.driverId === attackerId)!;
      dState.damageState = { ...dState.damageState, state: escalateDamage(dState.damageState.state as any, damageType) };
      aState.damageState = { ...aState.damageState, state: escalateDamage(aState.damageState.state as any, damageType) };
      if (damageType === 'dnf') {
        dState.isDNF = true;
        aState.isDNF = true;
      }
      race.eventLog.push({
        lap: race.currentLap, type: 'damage',
        description: `Both: damage → ${dState.damageState.state} (${defender.name}, ${attacker.name})`,
      });
    }
    if (finalOutcome === 'momentumLoss') {
      const dState = race.standings.find(s => s.driverId === defenderId)!;
      const aState = race.standings.find(s => s.driverId === attackerId)!;
      const maxPos = race.standings.filter(s => !s.isDNF).length;
      dState.position = Math.min(dState.position + race.track.momentumLossPositions, maxPos);
      aState.position = Math.min(aState.position + race.track.momentumLossPositions, maxPos);
      race.eventLog.push({
        lap: race.currentLap, type: 'momentum_loss',
        description: `Both lose ${race.track.momentumLossPositions} pos: ${defender.name}, ${attacker.name}`,
      });
    }
  }

  return moveToNextOpportunityOrEnd(state);
};
