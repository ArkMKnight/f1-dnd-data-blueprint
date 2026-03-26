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
  AwarenessOutcome,
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
  requiresDamageHandoff,
  mapAwarenessOutcomeToDamageState,
  escalateDamage,
  checkForcedPitCondition,
  MAJOR_DAMAGE_ROLL_MODIFIER,
  resolveIntentDeclaration,
  mapSingleDriverAwarenessToDifference,
} from '@/types/game';
import {
  statToModifier,
  getModifiedDriverStat,
  getMonacoRacecraftBonus,
  getMexicoOvertakeRacecraftBonus,
  getMexicoDefendingAwarenessBonus,
  capMexicoPaceContribution,
} from './track-compatibility';
import type { DriverRaceState, RaceState } from './race-engine';
import { initializeRace, appendLiveRaceEvent } from './race-engine';
import { executePitStop, getTyreStatus, getTyrePhase1Modifiers, getPuncturePhase3Penalty } from './tyre-system';
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
  | 'puncture_roll'
  | 'lap_end'
  | 'race_complete'
  | 'experimental_parts_roll'
  | 'safety_car_action';

export interface GMPrompt {
  phase: GMPhase;
  description: string;
  needsInput: boolean;
  inputType?: 'roll' | 'choice' | 'confirm';
  diceSize?: number;
  choices?: { label: string; value: string }[];
  context?: Record<string, unknown>;
}

// Risk tiers for Awareness outcomes — lower is safer.
const AWARENESS_RISK_TIER: Record<AwarenessOutcome, number> = {
  cleanRacing: 0,
  miracleEscape: 0,
  positionShift: 1,
  momentumLoss: 2,
  minorDamage: 3,
  majorDamage: 4,
  dnf: 5,
};

export interface GMState {
  raceState: RaceState;
  currentPhase: GMPhase;
  currentOpportunityIndex: number;
  currentOpportunity: OvertakeOpportunityRoll | null;
  pendingPrompt: GMPrompt | null;
  teams: Team[];
  traitRuntime: TraitRuntimeState;
  startingCompounds: Record<string, TyreCompound>;
  plannedPits: Record<string, { lap: number; compound: TyreCompound }[]>;
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
  totalLapsOverride?: number,
  startingCompoundsByDriver?: Record<string, TyreCompound>,
  plannedPits?: Record<string, { lap: number; compound: TyreCompound }[]>
): GMState => ({
  raceState: initializeRace(
    track,
    drivers,
    cars,
    startingCompound,
    totalLapsOverride,
    teams,
    startingCompoundsByDriver
  ),
  currentPhase: 'lap_start',
  currentOpportunityIndex: 0,
  currentOpportunity: null,
  pendingPrompt: null,
  teams,
  traitRuntime: initTraitRuntimeState(drivers, teams),
  startingCompounds: startingCompoundsByDriver ?? {},
  plannedPits: plannedPits ?? {},
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
      // Experimental Parts: one d6 every 5th lap in the second half; skip the first trigger at halfway.
      const secondHalfStart = Math.ceil(race.totalLaps / 2);
      const isExpPartsTriggerLap =
        currentLapNum > secondHalfStart && (currentLapNum - secondHalfStart) % 5 === 0;
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
      // Increment tyres (paused under Safety Car)
      if (race.raceFlag !== 'safetyCar') {
        race.standings.forEach(s => {
          if (!s.isDNF) s.tyreState = { ...s.tyreState, currentLap: s.tyreState.currentLap + 1 };
        });
      }
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
          normalizeStandingsWithDNFsLast(race);
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
      if (race.raceFlag !== 'safetyCar') {
        race.standings.forEach(sx => {
          if (!sx.isDNF) sx.tyreState = { ...sx.tyreState, currentLap: sx.tyreState.currentLap + 1 };
        });
      }
      race.eventLog.push({ lap: currentLapNum, type: 'lap_start', description: `Lap ${currentLapNum} begins` });
      state.currentOpportunityIndex = 0;
      return advanceGMState(state);
    }

    case 'pit_decision': {
      // 0. Apply any pre-planned strategy pits for this lap (converted into manual pits)
      if (race.currentLap < race.totalLaps) {
        race.standings.forEach(s => {
          if (s.isDNF) return;
          const plans = state.plannedPits[s.driverId] ?? [];
          const planForLap = plans.find(p => p.lap === race.currentLap);
          if (!planForLap) return;
          s.tyreState = {
            ...s.tyreState,
            pendingPit: {
              active: true,
              compound: planForLap.compound,
            },
          };
        });
      }

      // Team double stack: if both drivers of a team pit on the same lap,
      // the car that was behind on track takes an additional pit position loss.
      const doubleStackDrivers = new Set<string>();
      if ((race.track.name === 'Monaco' || race.track.name === 'Mexico') && race.currentLap < race.totalLaps) {
        const byTeam: Record<string, { driverId: string; position: number }[]> = {};
        race.standings.forEach(s => {
          if (s.isDNF) return;
          const pending = s.tyreState.pendingPit;
          if (!pending.active || !pending.compound) return;
          const driver = race.drivers.find(d => d.id === s.driverId);
          if (!driver) return;
          const teamId = driver.teamId;
          if (!byTeam[teamId]) byTeam[teamId] = [];
          byTeam[teamId].push({ driverId: s.driverId, position: s.position });
        });
        Object.values(byTeam).forEach(list => {
          if (list.length < 2) return;
          list.sort((a, b) => a.position - b.position);
          const behind = list[list.length - 1];
          doubleStackDrivers.add(behind.driverId);
        });
      }
      // Pit position loss: Red Flag = 0 (free); Safety Car = track.pitLossSafetyCar; else track.pitLossNormal
      const getPitPositionLossForFlag = (): number => {
        if (race.raceFlag === 'redFlag') return 0;
        if (race.raceFlag === 'safetyCar') return race.track.pitLossSafetyCar;
        return race.track.pitLossNormal ?? race.track.pitLoss;
      };

      // 1. Auto-handle forced pits (legacy forced conditions)
      race.standings.forEach(s => {
        if (s.isDNF) return;
        const forced = checkForcedPitCondition(s.tyreState);
        if (forced.isForced) {
          const driver = race.drivers.find(d => d.id === s.driverId)!;
          const pitRes = executePitStop(s.tyreState, driver, race.track, 'forced', null);
          s.tyreState = pitRes.updated;
          s.pitCount++;
          applyPositionLoss(race, s.driverId, getPitPositionLossForFlag());
          race.eventLog.push({
            lap: race.currentLap,
            type: 'pit_stop',
            description: `${driver.name} pits (forced: ${forced.reason ?? 'tyre condition'})`,
          });
          appendLiveRaceEvent(race, {
            lapNumber: race.currentLap,
            type: 'incident',
            description: `Pit stop (forced): ${driver.name}`,
            primaryDriverId: driver.id,
          });
        }
      });

      // 2. Handle manual pits declared via pendingPit
      if (race.currentLap < race.totalLaps) {
        race.standings.forEach(s => {
          if (s.isDNF) return;
          const pending = s.tyreState.pendingPit;
          if (!pending.active || !pending.compound) return;
          const driver = race.drivers.find(d => d.id === s.driverId)!;
          const pitRes = executePitStop(s.tyreState, driver, race.track, 'manual', pending.compound);
          s.tyreState = pitRes.updated;
          s.pitCount++;
          s.hasPitted = true;
          let positionsLost = getPitPositionLossForFlag();
          // Apply double-stack penalty to the trailing car in a team double stop.
          if ((race.track.name === 'Monaco' || race.track.name === 'Mexico') && doubleStackDrivers.has(s.driverId) && race.track.pitLossDoubleStack > 0) {
            const doubleStackLoss =
              race.raceFlag === 'safetyCar'
                ? (race.track.pitLossDoubleStackSafetyCar ?? race.track.pitLossDoubleStack)
                : race.track.pitLossDoubleStack;
            positionsLost += doubleStackLoss;
            race.eventLog.push({
              lap: race.currentLap,
              type: 'pit_stop',
              description: `${driver.name}: Double Stack penalty (additional ${doubleStackLoss} positions lost at ${race.track.name})`,
            });
          }
          applyPositionLoss(race, s.driverId, positionsLost);
          race.eventLog.push({
            lap: race.currentLap,
            type: 'pit_stop',
            description: `${driver.name} pits for ${pending.compound}`,
          });
          appendLiveRaceEvent(race, {
            lapNumber: race.currentLap,
            type: 'incident',
            description: `Pit stop: ${driver.name} → ${pending.compound}`,
            primaryDriverId: driver.id,
          });
        });
      }

      // After pit window: if we were under Red Flag, resume Green for the rest of the race
      if (race.raceFlag === 'redFlag') {
        race.raceFlag = 'green';
        race.eventLog.push({
          lap: race.currentLap,
          type: 'flag',
          description: 'Race restarts under Green Flag after Red Flag free pit window.',
        });
      }

      // Under Safety Car: no overtakes; show two actions only
      if (race.raceFlag === 'safetyCar') {
        // Match non-SC pit_decision: first opportunity of the lap is index 1 (lap_start resets to 0).
        // Without this, resume_green → generateOpportunityPrompt showed "Opportunity 0 of 2".
        if (state.currentOpportunityIndex === 0) {
          state.currentOpportunityIndex = 1;
        }
        state.currentPhase = 'safety_car_action';
        state.pendingPrompt = {
          phase: 'safety_car_action',
          description: 'Safety Car: no overtaking this lap. Advance to next lap or resume under green flag.',
          needsInput: true,
          inputType: 'choice',
          choices: [
            { label: 'Advance to Next Lap', value: 'advance_lap' },
            { label: 'Resume under Green Flag', value: 'resume_green' },
          ],
        };
        return state;
      }

      state.currentPhase = 'opportunity_roll';
      state.currentOpportunityIndex = 1;
      return generateOpportunityPrompt(state);
    }

    case 'safety_car_action': {
      if (input !== 'advance_lap' && input !== 'resume_green') return state;
      if (input === 'advance_lap') {
        state.currentPhase = 'lap_end';
        state.pendingPrompt = null;
        return advanceGMState(state);
      }
      // resume_green
      race.raceFlag = 'green';
      race.eventLog.push({
        lap: race.currentLap,
        type: 'flag',
        description: 'Resumed under Green Flag.',
      });
      state.currentPhase = 'opportunity_roll';
      state.pendingPrompt = null;
      if (state.currentOpportunityIndex < 1) {
        state.currentOpportunityIndex = 1;
      }
      return generateOpportunityPrompt(state);
    }

    case 'opportunity_roll': {
      // Input is the dice roll result
      const rollValue = typeof input === 'number' ? input : parseInt(input as string);
      if (isNaN(rollValue)) return state;

      const activeDrivers = race.standings.filter(s => !s.isDNF);
      if (activeDrivers.length < 2) {
        return moveToNextOpportunityOrEnd(state);
      }
      const maxBase = Math.max(1, activeDrivers.length - 1);
      const clampedBase = Math.max(1, Math.min(rollValue, maxBase));
      const mappedRoll = clampedBase + 1;
      const diceResult: DiceResult = {
        checkType: 'opportunitySelection',
        diceType: 'dX',
        diceSize: activeDrivers.length,
        roll: mappedRoll,
      };
      const standingsForRoll = activeDrivers.map(s => ({ position: s.position, driverId: s.driverId }));
      const opp = resolveOpportunityRoll(diceResult, state.currentOpportunityIndex, standingsForRoll);
      state.currentOpportunity = opp;

      if (!opp.isValid) {
        race.eventLog.push({
          lap: race.currentLap, type: 'opportunity',
          description: `Opportunity ${state.currentOpportunityIndex}: no valid overtake`,
        });
        return moveToNextOpportunityOrEnd(state);
      }

      const attacker = race.drivers.find(d => d.id === opp.attackerDriverId)!;
      const defender = race.drivers.find(d => d.id === opp.defenderDriverId)!;

      // Monaco Track Bonus — Quali Lock (GM mode):
      // If the defender is the protected P1 driver, automatically deny on-track overtakes.
      const defenderState = race.standings.find(s => s.driverId === defender.id)!;
      if (
        race.track.name === 'Monaco' &&
        race.monacoQualiLockDriverId &&
        defender.id === race.monacoQualiLockDriverId &&
        defenderState.position === 1 &&
        !defenderState.isDNF
      ) {
        race.eventLog.push({
          lap: race.currentLap,
          type: 'opportunity',
          description: `Opportunity ${state.currentOpportunityIndex}: ${attacker.name} cannot overtake ${defender.name} (Monaco Quali Lock P1)`,
        });
        appendLiveRaceEvent(race, {
          lapNumber: race.currentLap,
          type: 'defense',
          description: `${defender.name} defends from ${attacker.name} (Monaco Quali Lock)`,
          primaryDriverId: defender.id,
          secondaryDriverId: attacker.id,
        });
        return moveToNextOpportunityOrEnd(state);
      }

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
      const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
      const waitingFor = (ctx?.waitingFor as 'attacker' | 'defender' | undefined) ?? 'attacker';

      if (waitingFor === 'attacker') {
        // Store attacker roll, now request defender roll.
        const attackerId = ctx?.attackerId as string;
        const defenderId = ctx?.defenderId as string;
        const attacker = race.drivers.find(d => d.id === attackerId);
        const defender = race.drivers.find(d => d.id === defenderId);

        state.pendingPrompt = {
          phase: 'awareness_roll',
          description: defender
            ? `Awareness check: now roll d6 for ${defender.name} (defender).`
            : 'Awareness check: now roll d6 for defender.',
          needsInput: true,
          inputType: 'roll',
          diceSize: 6,
          context: {
            ...(ctx ?? {}),
            waitingFor: 'defender',
            attackerRoll: rollValue,
          },
        };
        return state;
      }

      // We have both rolls; resolve full awareness outcomes.
      const attackerRoll = (ctx?.attackerRoll as number) ?? rollValue;
      const defenderRoll = rollValue;
      // Preserve context (including any RS flags) for resolver.
      state.pendingPrompt = {
        phase: 'awareness_roll',
        description: state.pendingPrompt?.description ?? 'Awareness resolution',
        needsInput: false,
        context: { ...(ctx ?? {}), attackerRoll, defenderRoll },
      };
      return resolveAwareness(state, attackerRoll, defenderRoll);
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
          if (dTr && dState.position <= 10) {
            dTr.temporaryModifiers = dTr.temporaryModifiers || {};
            dTr.temporaryModifiers['awareness:flexible_strategy'] = -1;
          }
          race.eventLog.push({
            lap: race.currentLap,
            type: 'trait',
            description: dState.position <= 10
              ? `${defender.name}'s team used Flexible Strategy — position unchanged; -1 Awareness for rest of race.`
              : `${defender.name}'s team used Flexible Strategy — position unchanged; no Awareness penalty (outside top 10).`,
          });
        }

        const defenderAwarenessForDiffFS =
          defender.awareness +
          getMexicoDefendingAwarenessBonus(race.track) -
          (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
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
            description: `Awareness check (roll diff ${rollDiff}). Roll d6 for ${attacker.name} (attacker):`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId,
              defenderId,
              awarenessDiff: difference,
              waitingFor: 'attacker',
            },
          };
          return state;
        }
        race.eventLog.push({ lap: race.currentLap, type: 'awareness', description: 'Awareness: Clean racing' });
        return moveToNextOpportunityOrEnd(state);
      }

      if (choiceType === 'reactive_suspension') {
        const targetRole = (tctx?.targetRole as 'attacker' | 'defender' | undefined) ?? 'defender';
        const targetDriverId = tctx?.targetDriverId as string;
        const targetDriverName = tctx?.targetDriverName as string;
        const targetTeamId = tctx?.targetTeamId as string;
        const targetOriginalRoll = tctx?.targetOriginalRoll as number;
        const targetOriginalOutcome = tctx?.targetOriginalOutcome as AwarenessOutcome;
        const attackerRoll = tctx?.attackerRoll as number;
        const defenderRoll = tctx?.defenderRoll as number;
        const attackerId = tctx?.attackerId as string;
        const defenderId = tctx?.defenderId as string;

        if (choice === 'reactive_suspension_yes') {
          consumeTraitActivation(state.traitRuntime, 'reactive_suspension', 'team', targetTeamId);
          race.eventLog.push({
            lap: race.currentLap,
            type: 'trait',
            description: `Reactive Suspension used for ${targetDriverName} — original roll ${targetOriginalRoll} → ${targetOriginalOutcome}. Rerolling Awareness d6.`,
          });
          state.currentPhase = 'awareness_roll';
          const waitingFor = targetRole;
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: `Reactive Suspension reroll for ${targetDriverName}: original d6=${targetOriginalRoll} → ${targetOriginalOutcome}. Roll new d6 for ${targetRole}:`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId,
              defenderId,
              awarenessDiff: tctx?.awarenessDiff,
              wetIndependentAwareness: tctx?.wetIndependentAwareness,
              waitingFor,
              attackerRoll,
              defenderRoll,
              rsConsumedAttacker: (tctx?.rsConsumedAttacker as boolean | undefined) ?? false,
              rsConsumedDefender: (tctx?.rsConsumedDefender as boolean | undefined) ?? false,
              originalAttackerOutcome:
                targetRole === 'attacker'
                  ? targetOriginalOutcome
                  : (tctx?.originalAttackerOutcome as AwarenessOutcome | undefined),
              originalDefenderOutcome:
                targetRole === 'defender'
                  ? targetOriginalOutcome
                  : (tctx?.originalDefenderOutcome as AwarenessOutcome | undefined),
              ...(targetRole === 'attacker'
                ? { rsConsumedAttacker: true }
                : { rsConsumedDefender: true }),
            },
          };
          return state;
        }

        if (choice === 'reactive_suspension_no') {
          // Proceed with original rolls and outcomes; mark this side as consumed to avoid re-offer.
          state.currentPhase = 'awareness_roll';
          state.pendingPrompt = {
            phase: 'awareness_roll',
            description: `Reactive Suspension declined for ${targetDriverName}. Applying original Awareness outcomes.`,
            needsInput: false,
            context: {
              attackerId,
              defenderId,
              awarenessDiff: tctx?.awarenessDiff,
              wetIndependentAwareness: tctx?.wetIndependentAwareness,
              attackerRoll,
              defenderRoll,
              rsConsumedAttacker: (tctx?.rsConsumedAttacker as boolean | undefined) ?? false,
              rsConsumedDefender: (tctx?.rsConsumedDefender as boolean | undefined) ?? false,
              ...(targetRole === 'attacker'
                ? { rsConsumedAttacker: true }
                : { rsConsumedDefender: true }),
            },
          };
          return resolveAwareness(state, attackerRoll, defenderRoll);
        }

        return state;
      }

      return state;
    }

    case 'tyre_check': {
      // Tyre degradation & puncture checks based on status bands
      const punctureQueue: string[] = [];
      race.standings.forEach(s => {
        if (s.isDNF) return;
        const driver = race.drivers.find(d => d.id === s.driverId)!;

        const status = getTyreStatus(race.track, s.tyreState.compound, s.tyreState.currentLap, race.weather);
        const prevExceeded = s.tyreState.hasExceededHiddenLimit;
        const hasExceeded = status === 'worn' || status === 'dead';
        const isDead = status === 'dead';

        s.tyreState = {
          ...s.tyreState,
          hasExceededHiddenLimit: hasExceeded,
          isDeadTyre: isDead,
        };

        if (!prevExceeded && hasExceeded && status === 'worn') {
          race.eventLog.push({
            lap: race.currentLap,
            type: 'tyre_deg',
            description: `${driver.name}: tyre degradation (-1 pace)`,
          });
        }

        if (status === 'worn' && !s.tyreState.isPunctured) {
          // Roll d6 for puncture risk on each worn tyre (manual, one driver at a time).
          punctureQueue.push(s.driverId);
        }
      });

      if (punctureQueue.length > 0) {
        const driverId = punctureQueue[0];
        const driverName = race.drivers.find(d => d.id === driverId)?.name ?? driverId;
        state.currentPhase = 'puncture_roll';
        state.pendingPrompt = {
          phase: 'puncture_roll',
          description: `${driverName}: Worn tyre puncture risk — roll d6 (1 = puncture)`,
          needsInput: true,
          inputType: 'roll',
          diceSize: 6,
          context: { punctureQueue, punctureDriverIndex: 0, currentLapNum: race.currentLap },
        };
        return state;
      }

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

    case 'puncture_roll': {
      const rollValue = typeof input === 'number' ? input : parseInt(String(input ?? ''), 10);
      if (isNaN(rollValue) || rollValue < 1 || rollValue > 6) return state;

      const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
      const punctureQueue = (ctx?.punctureQueue as string[]) ?? [];
      const punctureDriverIndex = (ctx?.punctureDriverIndex as number) ?? 0;
      const currentLapNum = (ctx?.currentLapNum as number) ?? race.currentLap;

      if (punctureDriverIndex >= punctureQueue.length) {
        state.pendingPrompt = null;
        state.currentPhase = 'lap_end';
        return advanceGMState(state);
      }

      const driverId = punctureQueue[punctureDriverIndex];
      const driver = race.drivers.find(d => d.id === driverId);
      const s = race.standings.find(ss => ss.driverId === driverId);

      if (s && driver && !s.isDNF && !s.tyreState.isPunctured) {
        const status = getTyreStatus(race.track, s.tyreState.compound, s.tyreState.currentLap, race.weather);
        if (status === 'worn' && rollValue === 1) {
          s.tyreState = { ...s.tyreState, isPunctured: true, forcedPit: true };
          race.eventLog.push({
            lap: currentLapNum,
            type: 'puncture',
            description: `${driver.name}: PUNCTURE! (d6=${rollValue})`,
          });
        }
      }

      const nextIndex = punctureDriverIndex + 1;
      if (nextIndex < punctureQueue.length) {
        const nextDriverId = punctureQueue[nextIndex];
        const nextDriverName = race.drivers.find(d => d.id === nextDriverId)?.name ?? nextDriverId;
        state.pendingPrompt = {
          phase: 'puncture_roll',
          description: `${nextDriverName}: Worn tyre puncture risk — roll d6 (1 = puncture)`,
          needsInput: true,
          inputType: 'roll',
          diceSize: 6,
          context: { punctureQueue, punctureDriverIndex: nextIndex, currentLapNum },
        };
        return state;
      }

      state.pendingPrompt = null;
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
      // Cap at total laps (e.g. when advancing from Safety Car / Red Flag skip)
      if (race.currentLap >= race.totalLaps) {
        state.currentPhase = 'race_complete';
        race.isComplete = true;
        state.pendingPrompt = { phase: 'race_complete', description: 'Race complete!', needsInput: false };
        return state;
      }
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
  if (activeDrivers.length < 2) {
    // No valid overtakes when fewer than 2 active drivers — skip to tyre check
    state.currentPhase = 'tyre_check';
    state.currentOpportunity = null;
    return advanceGMState(state);
  }
  const diceSpan = Math.max(1, activeDrivers.length - 1);
  const opportunitiesThisLap = getOvertakeOpportunitiesPerLapForTrack(state.raceState.track);
  state.pendingPrompt = {
    phase: 'opportunity_roll',
    description: `Opportunity ${state.currentOpportunityIndex} of ${opportunitiesThisLap}: Roll d${diceSpan} + 1 for position selection (2..${activeDrivers.length})`,
    needsInput: true,
    inputType: 'roll',
    diceSize: diceSpan,
  };
  return state;
};

const moveToNextOpportunityOrEnd = (state: GMState): GMState => {
  const race = state.raceState;
  const opportunitiesThisLap = getOvertakeOpportunitiesPerLapForTrack(race.track);

  if (state.currentOpportunityIndex < opportunitiesThisLap) {
    state.currentOpportunityIndex++;
    state.currentOpportunity = null;
    // No overtaking under Safety Car or Red Flag
    if (race.raceFlag === 'safetyCar') {
      state.currentPhase = 'safety_car_action';
      state.pendingPrompt = {
        phase: 'safety_car_action',
        description: 'Safety Car: no overtaking. Advance to next lap or resume under green flag.',
        needsInput: true,
        inputType: 'choice',
        choices: [
          { label: 'Advance to Next Lap', value: 'advance_lap' },
          { label: 'Resume under Green Flag', value: 'resume_green' },
        ],
      };
      return state;
    }
    if (race.raceFlag === 'redFlag') {
      state.currentPhase = 'tyre_check';
      return advanceGMState(state);
    }
    state.currentPhase = 'opportunity_roll';
    return generateOpportunityPrompt(state);
  }
  state.currentPhase = 'tyre_check';
  return advanceGMState(state);
};

// Apply a position loss to a driver while preserving a valid order and respecting DNFs.
// Drops the driver by `positionsLost` among active (non-DNF) runners, capped at last place.
const applyPositionLoss = (race: RaceState, driverId: string, positionsLost: number): void => {
  if (positionsLost <= 0) return;

  const active: DriverRaceState[] = race.standings
    .filter(s => !s.isDNF)
    .sort((a, b) => a.position - b.position);
  const dnf: DriverRaceState[] = race.standings
    .filter(s => s.isDNF)
    // Preserve previously "further back" DNFs ahead of newly created DNFs.
    .sort((a, b) => b.position - a.position);

  const fromIndex = active.findIndex(s => s.driverId === driverId);
  if (fromIndex === -1) return;

  const [driverState] = active.splice(fromIndex, 1);
  const targetIndex = Math.min(fromIndex + positionsLost, active.length);
  active.splice(targetIndex, 0, driverState);

  active.forEach((s, i) => {
    s.position = i + 1;
  });
  dnf.forEach((s, i) => {
    s.position = active.length + i + 1;
  });

  race.standings = [...active, ...dnf];
};

const normalizeStandingsWithDNFsLast = (race: RaceState): void => {
  const active: DriverRaceState[] = race.standings
    .filter(s => !s.isDNF)
    .sort((a, b) => a.position - b.position);
  const dnf: DriverRaceState[] = race.standings
    .filter(s => s.isDNF)
    .sort((a, b) => b.position - a.position);

  active.forEach((s, i) => {
    s.position = i + 1;
  });
  dnf.forEach((s, i) => {
    s.position = active.length + i + 1;
  });

  race.standings = [...active, ...dnf];
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

  const aState = race.standings.find(s => s.driverId === attacker.id)!;
  const dState = race.standings.find(s => s.driverId === defender.id)!;

  const aPaceMod = getModifiedDriverStat(attacker, 'pace', carA, race.track);
  let aRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, race.track);
  const dPaceMod = getModifiedDriverStat(defender, 'pace', carD, race.track);
  let dRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, race.track);

  // Monaco / Mexico contested-roll track bonuses.
  aRacecraftMod += getMonacoRacecraftBonus(race.track, attacker, defender);
  dRacecraftMod += getMonacoRacecraftBonus(race.track, defender, attacker);
  aRacecraftMod += getMexicoOvertakeRacecraftBonus(race.track);
  const aTyreMods = getTyrePhase1Modifiers(aState.tyreState, race.track, race.weather);
  const dTyreMods = getTyrePhase1Modifiers(dState.tyreState, race.track, race.weather);
  const aPaceWithTyre = aPaceMod + aTyreMods.paceDelta;
  const dPaceWithTyre = dPaceMod + dTyreMods.paceDelta;

  const aDmg = aState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const dDmg = dState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const aPuncture = getPuncturePhase3Penalty(aState.tyreState);
  const dPuncture = getPuncturePhase3Penalty(dState.tyreState);

  const halfIndex: 1 | 2 =
    race.currentLap <= Math.ceil(race.totalLaps / 2) ? 1 : 2;

  const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const activatedTraits = (ctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
  const aAct = (activatedTraits.attacker ?? []) as string[];
  const dAct = (activatedTraits.defender ?? []) as string[];

  let attackerPhase1 = aPaceWithTyre + aRacecraftMod;
  let defenderPhase1 = dPaceWithTyre + dRacecraftMod;
  const raceIntelligenceActive = aAct.includes('race_intelligence') || dAct.includes('race_intelligence');
  if (raceIntelligenceActive) {
    attackerPhase1 = 2 * aRacecraftMod;
    defenderPhase1 = 2 * dRacecraftMod;
  }

  const aPaceDisplay = raceIntelligenceActive ? 0 : aPaceMod;
  const aTyreDisplay = raceIntelligenceActive ? null : aTyreMods.paceDelta;
  const aRacecraftDisplay = raceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const dPaceDisplay = raceIntelligenceActive ? 0 : dPaceMod;
  const dTyreDisplay = raceIntelligenceActive ? null : dTyreMods.paceDelta;
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
    externalPhase3Modifier: aDmg + aPuncture,
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
    externalPhase3Modifier: dDmg + dPuncture,
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

  // Criticals based on raw d20 (not totals).
  const attackerCritSuccess = attackerRoll === 20;
  const defenderCritSuccess = defenderRoll === 20;
  const attackerCritFailure = attackerRoll === 1;
  const defenderCritFailure = defenderRoll === 1;

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
      overtakeSuccess = aTotal > dTotal;
  }

  const aTraitPhase2 = attackerTraitResult.result.phase2Delta;
  const aTraitPhase3 = attackerTraitResult.result.phase3Delta - aDmg - aPuncture;
  const aTraitTotal = aTraitPhase2 + aTraitPhase3 + (aAct.includes('power_unit_overdrive') ? 3 : 0);
  const dTraitPhase2 = defenderTraitResult.result.phase2Delta;
  const dTraitPhase3 = defenderTraitResult.result.phase3Delta - dDmg - dPuncture;
  const dTraitTotal = dTraitPhase2 + dTraitPhase3 + (dAct.includes('power_unit_overdrive') ? 3 : 0);

  const aRacecraftContribution = raceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const dRacecraftContribution = raceIntelligenceActive ? 2 * dRacecraftMod : dRacecraftMod;
  const aBasePaceContribution = raceIntelligenceActive ? 0 : aPaceWithTyre;
  const dBasePaceContribution = raceIntelligenceActive ? 0 : dPaceWithTyre;
  const aPaceContribution = capMexicoPaceContribution(
    attacker,
    carA,
    race.track,
    aBasePaceContribution + aTraitTotal
  );
  const dPaceContribution = capMexicoPaceContribution(
    defender,
    carD,
    race.track,
    dBasePaceContribution + dTraitTotal
  );
  aTotal = attackerRoll + aRacecraftContribution + aPaceContribution + aDmg + aPuncture;
  dTotal = defenderRoll + dRacecraftContribution + dPaceContribution + dDmg + dPuncture;

  const attackerTraitsLabel =
    aTraitTotal !== 0 ? ` + traits(${aTraitTotal >= 0 ? '+' : ''}${aTraitTotal})` : '';
  const defenderTraitsLabel =
    dTraitTotal !== 0 ? ` + traits(${dTraitTotal >= 0 ? '+' : ''}${dTraitTotal})` : '';

  const aPaceLog = aTyreDisplay !== null && aTyreDisplay !== 0
    ? `pace(${aPaceDisplay}) + tyre(${aTyreDisplay >= 0 ? '+' : ''}${aTyreDisplay})`
    : `pace(${raceIntelligenceActive ? 0 : aPaceWithTyre})`;
  const dPaceLog = dTyreDisplay !== null && dTyreDisplay !== 0
    ? `pace(${dPaceDisplay}) + tyre(${dTyreDisplay >= 0 ? '+' : ''}${dTyreDisplay})`
    : `pace(${raceIntelligenceActive ? 0 : dPaceWithTyre})`;
  const aExtra = [aDmg ? `dmg(${aDmg})` : '', aPuncture ? `puncture(${aPuncture})` : ''].filter(Boolean).join(' + ');
  const dExtra = [dDmg ? `dmg(${dDmg})` : '', dPuncture ? `puncture(${dPuncture})` : ''].filter(Boolean).join(' + ');

  race.eventLog.push({
    lap: race.currentLap,
    type: 'contested_roll',
    description: `${attacker.name}: d20(${attackerRoll}) + ${aPaceLog} + racecraft(${aRacecraftDisplay})${attackerTraitsLabel}${aExtra ? ` + ${aExtra}` : ''} = ${aTotal} vs ${defender.name}: d20(${defenderRoll}) + ${dPaceLog} + racecraft(${dRacecraftDisplay})${defenderTraitsLabel}${dExtra ? ` + ${dExtra}` : ''} = ${dTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
  });

  // Live Race Events for GM-mode criticals.
  switch (critOutcome) {
    case 'attackerCritSuccess':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Success: ${attacker.name} rolls a natural 20 attacking ${defender.name}.`,
        primaryDriverId: attacker.id,
        secondaryDriverId: defender.id,
      });
      break;
    case 'defenderCritSuccess':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Success: ${defender.name} rolls a natural 20 defending from ${attacker.name}.`,
        primaryDriverId: defender.id,
        secondaryDriverId: attacker.id,
      });
      break;
    case 'attackerCritFailure':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Failure: ${attacker.name} rolls a natural 1 while attacking ${defender.name}.`,
        primaryDriverId: attacker.id,
        secondaryDriverId: defender.id,
      });
      break;
    case 'defenderCritFailure':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
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

    // Successful overtake without Flexible Strategy: apply position swap.
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

    // Momentum Driver (GM mode): after a successful overtake, grant
    // +1 Pace modifier on the attacker's *next* contested roll.
    const attackerMomentumTraitId = attacker.traitId ?? attacker.trait ?? null;
    if (attackerMomentumTraitId === 'momentum_driver') {
      const rt = state.traitRuntime.driverTraits[attacker.id];
      if (rt) {
        rt.temporaryModifiers = rt.temporaryModifiers || {};
        rt.temporaryModifiers['pace:nextRoll'] =
          (rt.temporaryModifiers['pace:nextRoll'] ?? 0) + 1;
      }
    }

    // Normal awareness check for successful overtake
    const rollDiff = Math.abs(aTotal - dTotal);
    const wetWeather =
      race.weather === 'damp' ||
      race.weather === 'wet' ||
      race.weather === 'drenched';
    const attackerBaseThreshold = 10 - Math.floor(attacker.adaptability / 2);
    const defenderBaseThreshold = 10 - Math.floor(defender.adaptability / 2);
    const attackerOnDry =
      aState.tyreState.compound === 'soft' ||
      aState.tyreState.compound === 'medium' ||
      aState.tyreState.compound === 'hard';
    const defenderOnDry =
      dState.tyreState.compound === 'soft' ||
      dState.tyreState.compound === 'medium' ||
      dState.tyreState.compound === 'hard';
    const attackerThreshold = attackerOnDry ? attackerBaseThreshold * 2 : attackerBaseThreshold;
    const defenderThreshold = defenderOnDry ? defenderBaseThreshold * 2 : defenderBaseThreshold;

    // Wet Adaptability rule (GM tabletop):
    // If a driver rolls below this threshold in wet/damp/drenched conditions,
    // they trigger an Awareness check based on their own Awareness band
    // (no attacker/defender comparison).
    const attackerFailedWetThreshold = wetWeather && attackerRoll <= attackerThreshold;
    const defenderFailedWetThreshold = wetWeather && defenderRoll <= defenderThreshold;
    const wetForcingAwareness = attackerFailedWetThreshold || defenderFailedWetThreshold;
    if (shouldTriggerAwarenessCheck(rollDiff) || wetForcingAwareness) {
      const defenderAwarenessForDiff =
        defender.awareness +
        getMexicoDefendingAwarenessBonus(race.track) -
        (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
      const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiff);

      // For wet-forced checks, treat this as a single-driver Awareness band check
      // when deciding which risk band we are in.
      const failingDriverForCategory =
        wetForcingAwareness &&
        (attackerFailedWetThreshold !== defenderFailedWetThreshold)
          ? attackerFailedWetThreshold
            ? attacker
            : defender
          : null;

      const effectiveAwarenessDiffForCategory = failingDriverForCategory
        ? mapSingleDriverAwarenessToDifference(failingDriverForCategory.awareness)
        : difference;

      const category = determineAwarenessOutcomeCategory(effectiveAwarenessDiffForCategory);
      if (category !== 'clean' || wetForcingAwareness) {
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
            description: wetForcingAwareness
              ? `Awareness: wet Adaptability (dry tyres) — independent checks (roll diff ${rollDiff}). ${attacker.name} Awareness ${attacker.awareness}; ${defender.name} Awareness ${defender.awareness}. Roll d6 for ${attacker.name}:`
              : `Awareness check triggered (roll diff ${rollDiff}, awareness diff ${difference}). Roll d6 for ${attacker.name} (attacker):`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId: attacker.id,
              defenderId: defender.id,
              awarenessDiff: difference,
              wetIndependentAwareness: wetForcingAwareness,
              waitingFor: 'attacker',
            },
          };
          return state;
        }
      } else if (!wetForcingAwareness) {
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
    const wetWeather = race.weather === 'damp' || race.weather === 'wet' || race.weather === 'drenched';
    const attackerBaseThreshold = 10 - Math.floor(attacker.adaptability / 2);
    const defenderBaseThreshold = 10 - Math.floor(defender.adaptability / 2);
    const attackerOnDry =
      aState.tyreState.compound === 'soft' ||
      aState.tyreState.compound === 'medium' ||
      aState.tyreState.compound === 'hard';
    const defenderOnDry =
      dState.tyreState.compound === 'soft' ||
      dState.tyreState.compound === 'medium' ||
      dState.tyreState.compound === 'hard';
    const attackerThreshold = attackerOnDry ? attackerBaseThreshold * 2 : attackerBaseThreshold;
    const defenderThreshold = defenderOnDry ? defenderBaseThreshold * 2 : defenderBaseThreshold;
    const attackerFailedWetThreshold = wetWeather && attackerRoll <= attackerThreshold;
    const defenderFailedWetThreshold = wetWeather && defenderRoll <= defenderThreshold;
    const wetForcingAwareness = attackerFailedWetThreshold || defenderFailedWetThreshold;
    const triggerAwarenessFailed =
      shouldTriggerAwarenessCheck(rollDiff) || (attackerHasDragFocus && rollDiff >= 8) || wetForcingAwareness;
    if (triggerAwarenessFailed) {
      const defenderAwarenessForDiff =
        defender.awareness +
        getMexicoDefendingAwarenessBonus(race.track) -
        (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
      const { difference } = calculateEffectiveAwarenessDifference(attacker.awareness, defenderAwarenessForDiff);

      // For wet-forced checks, treat this as a single-driver Awareness band check
      // when deciding which risk band we are in.
      const failingDriverForCategory =
        wetForcingAwareness &&
        (attackerFailedWetThreshold !== defenderFailedWetThreshold)
          ? attackerFailedWetThreshold
            ? attacker
            : defender
          : null;

      const effectiveAwarenessDiffForCategory = failingDriverForCategory
        ? mapSingleDriverAwarenessToDifference(failingDriverForCategory.awareness)
        : difference;

      const category = determineAwarenessOutcomeCategory(effectiveAwarenessDiffForCategory);
      if (category !== 'clean' || wetForcingAwareness) {
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
            description: wetForcingAwareness
              ? `Awareness: wet Adaptability (dry tyres) — independent checks (roll diff ${rollDiff}). ${attacker.name} Awareness ${attacker.awareness}; ${defender.name} Awareness ${defender.awareness}. Roll d6 for ${attacker.name}:`
              : `Awareness check triggered (roll diff ${rollDiff}, awareness diff ${difference}). Roll d6:`,
            needsInput: true,
            inputType: 'roll',
            diceSize: 6,
            context: {
              attackerId: attacker.id,
              defenderId: defender.id,
              awarenessDiff: difference,
              wetIndependentAwareness: wetForcingAwareness,
            },
          };
          return state;
        }
      } else if (!wetForcingAwareness) {
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

  const aState = race.standings.find(s => s.driverId === attacker.id)!;
  const dState = race.standings.find(s => s.driverId === defender.id)!;

  const aPaceMod = getModifiedDriverStat(attacker, 'pace', carA, race.track);
  let aRacecraftMod = getModifiedDriverStat(attacker, 'racecraft', carA, race.track);
  const dPaceMod = getModifiedDriverStat(defender, 'pace', carD, race.track);
  let dRacecraftMod = getModifiedDriverStat(defender, 'racecraft', carD, race.track);

  // Monaco / Mexico contested-roll track bonuses.
  aRacecraftMod += getMonacoRacecraftBonus(race.track, attacker, defender);
  dRacecraftMod += getMonacoRacecraftBonus(race.track, defender, attacker);
  aRacecraftMod += getMexicoOvertakeRacecraftBonus(race.track);
  const aTyreMods = getTyrePhase1Modifiers(aState.tyreState, race.track, race.weather);
  const dTyreMods = getTyrePhase1Modifiers(dState.tyreState, race.track, race.weather);
  const aPaceWithTyre = aPaceMod + aTyreMods.paceDelta;
  const dPaceWithTyre = dPaceMod + dTyreMods.paceDelta;

  const aDmg = aState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const dDmg = dState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
  const aPuncture = getPuncturePhase3Penalty(aState.tyreState);
  const dPuncture = getPuncturePhase3Penalty(dState.tyreState);

  const halfIndex: 1 | 2 =
    race.currentLap <= Math.ceil(race.totalLaps / 2) ? 1 : 2;

  const rctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const rAct = (rctx?.activatedTraits as { attacker: string[]; defender: string[] }) ?? { attacker: [], defender: [] };
  const aAct = (rAct.attacker ?? []) as string[];
  const dAct = (rAct.defender ?? []) as string[];

  let attackerPhase1 = aPaceWithTyre + aRacecraftMod;
  let defenderPhase1 = dPaceWithTyre + dRacecraftMod;
  const rRaceIntelligenceActive = aAct.includes('race_intelligence') || dAct.includes('race_intelligence');
  if (rRaceIntelligenceActive) {
    attackerPhase1 = 2 * aRacecraftMod;
    defenderPhase1 = 2 * dRacecraftMod;
  }

  const raPaceDisplay = rRaceIntelligenceActive ? 0 : aPaceMod;
  const raTyreDisplay = rRaceIntelligenceActive ? null : aTyreMods.paceDelta;
  const raRacecraftDisplay = rRaceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const rdPaceDisplay = rRaceIntelligenceActive ? 0 : dPaceMod;
  const rdTyreDisplay = rRaceIntelligenceActive ? null : dTyreMods.paceDelta;
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
    externalPhase3Modifier: aDmg + aPuncture - 1,
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
    externalPhase3Modifier: dDmg + dPuncture,
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

  // Criticals on Relentless retry (GM) based on raw d20.
  const attackerCritSuccess = attackerRoll === 20;
  const defenderCritSuccess = defenderRoll === 20;
  const attackerCritFailure = attackerRoll === 1;
  const defenderCritFailure = defenderRoll === 1;

  type RetryCritOutcome =
    | 'none'
    | 'attackerCritSuccess'
    | 'defenderCritSuccess'
    | 'attackerCritFailure'
    | 'defenderCritFailure';

  let critOutcome: RetryCritOutcome = 'none';
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
      overtakeSuccess = aTotal > dTotal;
  }

  const aTraitPhase2 = attackerTraitResult.result.phase2Delta;
  const aTraitPhase3 = attackerTraitResult.result.phase3Delta - (aDmg + aPuncture - 1);
  const aTraitTotal = aTraitPhase2 + aTraitPhase3 + (aAct.includes('power_unit_overdrive') ? 3 : 0);
  const dTraitPhase2 = defenderTraitResult.result.phase2Delta;
  const dTraitPhase3 = defenderTraitResult.result.phase3Delta - dDmg;
  const dTraitTotal = dTraitPhase2 + dTraitPhase3 + (dAct.includes('power_unit_overdrive') ? 3 : 0);

  const raRacecraftContribution = rRaceIntelligenceActive ? 2 * aRacecraftMod : aRacecraftMod;
  const rdRacecraftContribution = rRaceIntelligenceActive ? 2 * dRacecraftMod : dRacecraftMod;
  const raBasePaceContribution = rRaceIntelligenceActive ? 0 : aPaceWithTyre;
  const rdBasePaceContribution = rRaceIntelligenceActive ? 0 : dPaceWithTyre;
  const raPaceContribution = capMexicoPaceContribution(
    attacker,
    carA,
    race.track,
    raBasePaceContribution + aTraitTotal
  );
  const rdPaceContribution = capMexicoPaceContribution(
    defender,
    carD,
    race.track,
    rdBasePaceContribution + dTraitTotal
  );
  aTotal = attackerRoll + raRacecraftContribution + raPaceContribution + aDmg + aPuncture - 1;
  dTotal = defenderRoll + rdRacecraftContribution + rdPaceContribution + dDmg + dPuncture;

  const attackerTraitsLabel =
    aTraitTotal !== 0 ? ` + traits(${aTraitTotal >= 0 ? '+' : ''}${aTraitTotal})` : '';
  const defenderTraitsLabel =
    dTraitTotal !== 0 ? ` + traits(${dTraitTotal >= 0 ? '+' : ''}${dTraitTotal})` : '';

  const raPaceLog = raTyreDisplay !== null && raTyreDisplay !== 0
    ? `pace(${raPaceDisplay}) + tyre(${raTyreDisplay >= 0 ? '+' : ''}${raTyreDisplay})`
    : `pace(${rRaceIntelligenceActive ? 0 : aPaceWithTyre})`;
  const rdPaceLog = rdTyreDisplay !== null && rdTyreDisplay !== 0
    ? `pace(${rdPaceDisplay}) + tyre(${rdTyreDisplay >= 0 ? '+' : ''}${rdTyreDisplay})`
    : `pace(${rRaceIntelligenceActive ? 0 : dPaceWithTyre})`;
  const raExtra = [aDmg ? `dmg(${aDmg})` : '', aPuncture ? `puncture(${aPuncture})` : ''].filter(Boolean).join(' + ');
  const rdExtra = [dDmg ? `dmg(${dDmg})` : '', dPuncture ? `puncture(${dPuncture})` : ''].filter(Boolean).join(' + ');

  race.eventLog.push({
    lap: race.currentLap,
    type: 'contested_roll',
    description: `${attacker.name} (Relentless retry): d20(${attackerRoll}) + ${raPaceLog} + racecraft(${raRacecraftDisplay})${attackerTraitsLabel}${raExtra ? ` + ${raExtra}` : ''} - 1(relentless) = ${aTotal} vs ${defender.name}: d20(${defenderRoll}) + ${rdPaceLog} + racecraft(${rdRacecraftDisplay})${defenderTraitsLabel}${rdExtra ? ` + ${rdExtra}` : ''} = ${dTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
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

  // Live Race Events for criticals on the Relentless retry.
  switch (critOutcome) {
    case 'attackerCritSuccess':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Success: ${attacker.name} rolls a natural 20 on Relentless retry against ${defender.name}.`,
        primaryDriverId: attacker.id,
        secondaryDriverId: defender.id,
      });
      break;
    case 'defenderCritSuccess':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Success: ${defender.name} rolls a natural 20 defending a Relentless retry from ${attacker.name}.`,
        primaryDriverId: defender.id,
        secondaryDriverId: attacker.id,
      });
      break;
    case 'attackerCritFailure':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
        type: 'incident',
        description: `Critical Failure: ${attacker.name} rolls a natural 1 on Relentless retry against ${defender.name}.`,
        primaryDriverId: attacker.id,
        secondaryDriverId: defender.id,
      });
      break;
    case 'defenderCritFailure':
      appendLiveRaceEvent(race, {
        lapNumber: race.currentLap,
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

  // Forced awareness on retry: prompt for d6 in GM mode (no createDiceResult here)
  const rollDiff = Math.abs(aTotal - dTotal);
  const defenderAwarenessForDiffRel =
    defender.awareness +
    getMexicoDefendingAwarenessBonus(race.track) -
    (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
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
      description: `Awareness (Relentless retry, roll diff ${rollDiff}). Roll d6 for ${attacker.name} (attacker):`,
      needsInput: true,
      inputType: 'roll',
      diceSize: 6,
      context: {
        attackerId: attacker.id,
        defenderId: defender.id,
        awarenessDiff: difference,
        waitingFor: 'attacker',
      },
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

const resolveAwareness = (state: GMState, attackerRoll: number, defenderRoll: number): GMState => {
  const race = state.raceState;
  const ctx = state.pendingPrompt?.context as Record<string, unknown> | undefined;
  const attackerId = ctx?.attackerId as string;
  const defenderId = ctx?.defenderId as string;
  const awarenessDiff = (ctx?.awarenessDiff as number) ?? 0;
  const defenderMod = (ctx?.awarenessDefenderModifier as number) ?? 0;
  const persistentAwarenessMod =
    (state.traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0);
  const effectiveDiffShared = awarenessDiff + defenderMod + persistentAwarenessMod;
  const wetIndependentAwareness = (ctx?.wetIndependentAwareness as boolean | undefined) ?? false;

  const attacker = race.drivers.find(d => d.id === attackerId)!;
  const defender = race.drivers.find(d => d.id === defenderId)!;
  const attackerDiffD6 = wetIndependentAwareness
    ? mapSingleDriverAwarenessToDifference(attacker.awareness)
    : effectiveDiffShared;
  const defenderDiffD6 = wetIndependentAwareness
    ? mapSingleDriverAwarenessToDifference(defender.awareness + persistentAwarenessMod)
    : effectiveDiffShared;

  const attackerTeam = state.teams.find(t => t.id === attacker.teamId)!;
  const defenderTeam = state.teams.find(t => t.id === defender.teamId)!;

  // Lightweight Parts Awareness risk:
  // If a team with Lightweight Parts has a driver whose Awareness is
  // lower than the opponent's by 5+, that driver automatically DNFs.
  const attackerTeamTraitId = attackerTeam.traitId ?? attackerTeam.trait ?? null;
  const defenderTeamTraitId = defenderTeam.traitId ?? defenderTeam.trait ?? null;
  const attackerAw = attacker.awareness;
  const defenderAw = defender.awareness;

  const attackerForcedDNF =
    attackerTeamTraitId === 'lightweight_parts' && defenderAw - attackerAw >= 5;
  const defenderForcedDNF =
    defenderTeamTraitId === 'lightweight_parts' && attackerAw - defenderAw >= 5;

  // Base outcomes from each driver's own d6 (unless forced DNF above)
  let attackerOutcome: AwarenessOutcome = attackerForcedDNF
    ? 'dnf'
    : resolveAwarenessD6Outcome(attackerDiffD6, attackerRoll);
  let defenderOutcome: AwarenessOutcome = defenderForcedDNF
    ? 'dnf'
    : resolveAwarenessD6Outcome(defenderDiffD6, defenderRoll);

  // Evasion priority compares drivers; wet dry-tyre checks are independent per driver.
  const { hasEvasion, evasionDriverId } = wetIndependentAwareness
    ? { hasEvasion: false, evasionDriverId: null }
    : checkEvasionPriority(attacker.awareness, defender.awareness);
  if (hasEvasion) {
    if (evasionDriverId === 'attacker') {
      attackerOutcome = applyEvasionDowngrade(attackerOutcome, true);
    } else if (evasionDriverId === 'defender') {
      defenderOutcome = applyEvasionDowngrade(defenderOutcome, true);
    }
  }

  // Apply awareness outcome–modifying traits independently per driver
  if (!attackerForcedDNF) {
    const attackerTraitAdjusted = applyAwarenessOutcomeTraits({
      track: race.track,
      attacker: defender,          // other driver
      defender: attacker,          // the driver whose traits we care about
      attackerTeam: defenderTeam,
      defenderTeam: attackerTeam,
      awarenessDifference: attackerDiffD6,
      baseOutcome: attackerOutcome,
    });
    attackerOutcome = attackerTraitAdjusted.outcome;
  }

  if (!defenderForcedDNF) {
    const defenderTraitAdjusted = applyAwarenessOutcomeTraits({
      track: race.track,
      attacker,
      defender,
      attackerTeam,
      defenderTeam,
      awarenessDifference: defenderDiffD6,
      baseOutcome: defenderOutcome,
    });
    defenderOutcome = defenderTraitAdjusted.outcome;
  }

  // Offer Reactive Suspension before applying awareness effects.
  // Either side may use it when their own outcome is not clean.
  const rsConsumedAttacker = (ctx?.rsConsumedAttacker as boolean | undefined) ?? false;
  const rsConsumedDefender = (ctx?.rsConsumedDefender as boolean | undefined) ?? false;
  const attackerTeamTraitIdForRS = attackerTeam.traitId ?? attackerTeam.trait ?? null;
  const defenderTeamTraitIdForRS = defenderTeam.traitId ?? defenderTeam.trait ?? null;
  const attackerRsState = state.traitRuntime.teamTraits[attacker.teamId];
  const defenderRsState = state.traitRuntime.teamTraits[defender.teamId];
  const canOfferAttackerRS =
    !rsConsumedAttacker &&
    attackerTeamTraitIdForRS === 'reactive_suspension' &&
    (attackerRsState?.usesRemaining ?? 0) > 0 &&
    attackerOutcome !== 'cleanRacing';
  const canOfferDefenderRS =
    !rsConsumedDefender &&
    defenderTeamTraitIdForRS === 'reactive_suspension' &&
    (defenderRsState?.usesRemaining ?? 0) > 0 &&
    defenderOutcome !== 'cleanRacing';

  const rsTarget =
    canOfferAttackerRS
      ? {
          role: 'attacker' as const,
          driverId: attacker.id,
          driverName: attacker.name,
          teamId: attacker.teamId,
          originalRoll: attackerRoll,
          originalOutcome: attackerOutcome,
        }
      : canOfferDefenderRS
        ? {
            role: 'defender' as const,
            driverId: defender.id,
            driverName: defender.name,
            teamId: defender.teamId,
            originalRoll: defenderRoll,
            originalOutcome: defenderOutcome,
          }
        : null;
  if (rsTarget) {
    state.currentPhase = 'trait_choice';
    state.pendingPrompt = {
      phase: 'trait_choice',
      description: `${rsTarget.driverName}'s team: Use Reactive Suspension to reroll ${rsTarget.role} Awareness outcome ${rsTarget.originalOutcome}?`,
      needsInput: true,
      inputType: 'choice',
      choices: [
        { label: `Yes — reroll ${rsTarget.role} Awareness`, value: 'reactive_suspension_yes' },
        { label: 'No — keep original result', value: 'reactive_suspension_no' },
      ],
      context: {
        type: 'reactive_suspension',
        attackerId,
        defenderId,
        awarenessDiff,
        wetIndependentAwareness,
        attackerRoll,
        defenderRoll,
        targetRole: rsTarget.role,
        targetDriverId: rsTarget.driverId,
        targetDriverName: rsTarget.driverName,
        targetTeamId: rsTarget.teamId,
        targetOriginalRoll: rsTarget.originalRoll,
        targetOriginalOutcome: rsTarget.originalOutcome,
        rsConsumedAttacker,
        rsConsumedDefender,
        originalAttackerOutcome: ctx?.originalAttackerOutcome,
        originalDefenderOutcome: ctx?.originalDefenderOutcome,
      },
    };
    return state;
  }

  race.eventLog.push({
    lap: race.currentLap,
    type: 'awareness',
    description: `Awareness: attacker d6(${attackerRoll}) → ${attackerOutcome}, defender d6(${defenderRoll}) → ${defenderOutcome}${
      wetIndependentAwareness ? ' (wet: independent bands per driver)' : ''
    }${hasEvasion ? ' (evasion applied to higher Awareness driver)' : ''}`,
  });

  const aState = race.standings.find(s => s.driverId === attackerId)!;
  const dState = race.standings.find(s => s.driverId === defenderId)!;
  const attackerDamageBeforeAwareness = aState.damageState.state;
  const defenderDamageBeforeAwareness = dState.damageState.state;

  // Reactive Suspension safety rule: if this Awareness resolution was
  // reached via a reroll, only apply the new defender outcome if it is
  // "safer" than the original. Otherwise, keep the original; if that
  // original was Position Swap, downgrade to a simple -1 position loss.
  const originalAttackerOutcome = ctx?.originalAttackerOutcome as AwarenessOutcome | undefined;
  const originalDefenderOutcome = ctx?.originalDefenderOutcome as AwarenessOutcome | undefined;
  const wasAttackerReroll = (ctx?.rsConsumedAttacker as boolean | undefined) ?? false;
  const wasDefenderReroll = (ctx?.rsConsumedDefender as boolean | undefined) ?? false;
  let attackerPositionShiftAsDropOne = false;
  let defenderPositionShiftAsDropOne = false;

  if (wasAttackerReroll && originalAttackerOutcome) {
    const newTier = AWARENESS_RISK_TIER[attackerOutcome];
    const origTier = AWARENESS_RISK_TIER[originalAttackerOutcome];
    if (newTier < origTier) {
      // New outcome is safer — accept it as-is.
    } else {
      if (originalAttackerOutcome === 'positionShift') {
        attackerPositionShiftAsDropOne = true;
      }
      attackerOutcome = originalAttackerOutcome;
    }
  }

  if (wasDefenderReroll && originalDefenderOutcome) {
    const newTier = AWARENESS_RISK_TIER[defenderOutcome];
    const origTier = AWARENESS_RISK_TIER[originalDefenderOutcome];
    if (newTier < origTier) {
      // New outcome is safer — accept it as-is.
    } else {
      // New is equal or riskier — revert to original.
      if (originalDefenderOutcome === 'positionShift') {
        defenderPositionShiftAsDropOne = true;
      }
      defenderOutcome = originalDefenderOutcome;
    }
  }

  // 1) Damage escalations (self-only)
  const applyDamage = (driverState: typeof aState, outcome: AwarenessOutcome) => {
    if (!requiresDamageHandoff(outcome)) return;
    const damageType = mapAwarenessOutcomeToDamageState(outcome);
    const prev = driverState.damageState.state;
    driverState.damageState = {
      ...driverState.damageState,
      state: escalateDamage(driverState.damageState.state as any, damageType),
    };
    if (damageType === 'dnf') {
      driverState.isDNF = true;
    }
    race.eventLog.push({
      lap: race.currentLap,
      type: 'damage',
      description: `${race.drivers.find(d => d.id === driverState.driverId)?.name ?? driverState.driverId}: ${prev} → ${driverState.damageState.state}`,
    });
  };

  applyDamage(aState, attackerOutcome);
  applyDamage(dState, defenderOutcome);

  // Safety Car / Red Flag from collision damage
  // Only trigger flags when BOTH final states were produced by THIS awareness check,
  // not when one/both cars were already in that state beforehand.
  const attackerDamage = aState.damageState.state;
  const defenderDamage = dState.damageState.state;
  const bothFreshMajorFromThisCheck =
    attackerDamage === 'major' &&
    defenderDamage === 'major' &&
    attackerDamageBeforeAwareness !== 'major' &&
    defenderDamageBeforeAwareness !== 'major';
  const bothFreshDnfFromThisCheck =
    attackerDamage === 'dnf' &&
    defenderDamage === 'dnf' &&
    attackerDamageBeforeAwareness !== 'dnf' &&
    defenderDamageBeforeAwareness !== 'dnf';
  const flag = bothFreshDnfFromThisCheck
    ? 'redFlag'
    : bothFreshMajorFromThisCheck
      ? 'safetyCar'
      : 'green';
  if (flag === 'safetyCar') {
    race.raceFlag = 'safetyCar';
    race.eventLog.push({
      lap: race.currentLap,
      type: 'flag',
      description: `Safety Car deployed after collision (both drivers Major Damage).`,
    });
  } else if (flag === 'redFlag') {
    race.raceFlag = 'redFlag';
    race.eventLog.push({
      lap: race.currentLap,
      type: 'flag',
      description: `Red Flag: both drivers DNF from collision. Positions preserved; free pit stop available next lap.`,
    });
  }

  // 2) Momentum Loss (self-only)
  const applyMomentum = (driverState: typeof aState, outcome: AwarenessOutcome) => {
    if (outcome !== 'momentumLoss') return;
    const loss = race.track.momentumLossPositions;
    if (loss <= 0) return;
    applyPositionLoss(race, driverState.driverId, loss);
    race.eventLog.push({
      lap: race.currentLap,
      type: 'momentum_loss',
      description: `${race.drivers.find(d => d.id === driverState.driverId)?.name ?? driverState.driverId} loses ${loss} position(s) from Momentum Loss.`,
    });
  };

  applyMomentum(aState, attackerOutcome);
  applyMomentum(dState, defenderOutcome);

  // 3) Position Swaps / Shifts
  const aPosShift = attackerOutcome === 'positionShift';
  const dPosShift = defenderOutcome === 'positionShift';
  const aHasMomentum = attackerOutcome === 'momentumLoss';
  const dHasMomentum = defenderOutcome === 'momentumLoss';
  const aHasDamage = requiresDamageHandoff(attackerOutcome);
  const dHasDamage = requiresDamageHandoff(defenderOutcome);

  const swapPositions = (first: typeof aState, second: typeof aState) => {
    const tmp = first.position;
    first.position = second.position;
    second.position = tmp;
  };

  if (attackerPositionShiftAsDropOne) {
    applyPositionLoss(race, attackerId, 1);
    race.eventLog.push({
      lap: race.currentLap,
      type: 'awareness',
      description: `${attacker.name} keeps original Position Swap via Reactive Suspension fallback — drops one position instead of full swap.`,
    });
  } else if (defenderPositionShiftAsDropOne) {
    // Special RS fallback: original outcome was Position Swap but the
    // reroll was worse. Instead of a full swap, the defender simply
    // drops one position.
    applyPositionLoss(race, defenderId, 1);
    race.eventLog.push({
      lap: race.currentLap,
      type: 'awareness',
      description: `${defender.name} keeps original Position Swap via Reactive Suspension fallback — drops one position instead of full swap.`,
    });
  } else if (aPosShift && dPosShift) {
    // Both got position shift → higher Awareness driver ends ahead.
    const attackerAw = attacker.awareness;
    const defenderAw = defender.awareness;
    const higher = attackerAw > defenderAw ? aState : dState;
    const lower = higher === aState ? dState : aState;
    swapPositions(higher, lower);
    race.eventLog.push({
      lap: race.currentLap,
      type: 'awareness',
      description: `Both drivers rolled Position Swap — higher Awareness driver (${race.drivers.find(d => d.id === higher.driverId)?.name ?? higher.driverId}) ends ahead.`,
    });
  } else {
    // Mixed or single Position Shift cases.
    if (aPosShift && !dPosShift) {
      if (dHasMomentum) {
        // Other has Momentum Loss → that driver already dropped; Position Swap driver drops one position.
        applyPositionLoss(race, attackerId, 1);
        race.eventLog.push({
          lap: race.currentLap,
          type: 'awareness',
          description: `${attacker.name} rolled Position Swap while ${defender.name} had Momentum Loss — ${attacker.name} drops one extra position.`,
        });
      } else if (dHasDamage) {
        swapPositions(aState, dState);
        race.eventLog.push({
          lap: race.currentLap,
          type: 'awareness',
          description: `${attacker.name} rolled Position Swap; ${defender.name} took damage — position swap still applied.`,
        });
      } else {
        // Clean or non-positional outcome for the other driver → full swap.
        swapPositions(aState, dState);
      }
    } else if (dPosShift && !aPosShift) {
      if (aHasMomentum) {
        applyPositionLoss(race, defenderId, 1);
        race.eventLog.push({
          lap: race.currentLap,
          type: 'awareness',
          description: `${defender.name} rolled Position Swap while ${attacker.name} had Momentum Loss — ${defender.name} drops one extra position.`,
        });
      } else if (aHasDamage) {
        swapPositions(aState, dState);
        race.eventLog.push({
          lap: race.currentLap,
          type: 'awareness',
          description: `${defender.name} rolled Position Swap; ${attacker.name} took damage — position swap still applied.`,
        });
      } else {
        swapPositions(aState, dState);
      }
    }
  }

  // Guarantee newly created DNFs are immediately classified at the back.
  normalizeStandingsWithDNFsLast(race);

  return moveToNextOpportunityOrEnd(state);
};
