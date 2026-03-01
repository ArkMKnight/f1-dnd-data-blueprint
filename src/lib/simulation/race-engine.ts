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
import { TRAITS_BY_ID } from '@/lib/trait-definitions';
import {
  initTraitRuntimeState,
  resolveRollWithTraits,
  applyAwarenessOutcomeTraits,
  type TraitRuntimeState,
} from './trait-engine';

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
  isComplete: boolean;
  /** When provided, trait engine is used for contested rolls and awareness. */
  teams?: Team[];
  traitRuntime?: TraitRuntimeState;
  /** Experimental Parts: count of d6=1 rolls per driver (second half, every 5th lap). DNF when count >= 2. */
  experimentalPartsOnes?: Record<string, number>;
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
  teams?: Team[]
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
    isComplete: false,
    experimentalPartsOnes: {},
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

  // Experimental Parts: one d6 every 5th lap in second half (inclusive); track 1s per driver; DNF when same driver gets 2nd 1
  const secondHalfStart = Math.ceil(newState.totalLaps / 2);
  const shouldRunExperimentalParts = lap >= secondHalfStart && lap % 5 === 0;
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

    const attackerState = standings.find(s => s.driverId === attackerId)!;
    const defenderState = standings.find(s => s.driverId === defenderId)!;
    const attackerDmgMod = attackerState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;
    const defenderDmgMod = defenderState.damageState.state === 'major' ? MAJOR_DAMAGE_ROLL_MODIFIER : 0;

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
        externalPhase3Modifier: attackerDmgMod,
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
        externalPhase3Modifier: defenderDmgMod,
        currentLap: lap,
        totalLaps: newState.totalLaps,
        halfIndex,
        isAttacker: false,
        position: defenderState.position,
      });
      newState.traitRuntime = dTraitRes.runtime;

      attackerTotal = aTraitRes.result.finalTotal;
      defenderTotal = dTraitRes.result.finalTotal;
      const aT2 = aTraitRes.result.phase2Delta + aTraitRes.result.phase3Delta - attackerDmgMod;
      const dT2 = dTraitRes.result.phase2Delta + dTraitRes.result.phase3Delta - defenderDmgMod;
      if (aT2 !== 0) attackerTraitsLabel = ` + traits(${aT2 >= 0 ? '+' : ''}${aT2})`;
      if (dT2 !== 0) defenderTraitsLabel = ` + traits(${dT2 >= 0 ? '+' : ''}${dT2})`;

      // Consume "next roll" temporary modifiers (e.g. momentum_driver)
      const aTr = newState.traitRuntime!.driverTraits[attackerId];
      const dTr = newState.traitRuntime!.driverTraits[defenderId];
      if (aTr?.temporaryModifiers) delete aTr.temporaryModifiers['pace:nextRoll'];
      if (dTr?.temporaryModifiers) delete dTr.temporaryModifiers['pace:nextRoll'];
    } else {
      attackerTotal = aRoll.roll + attackerPaceMod + attackerRacecraftMod + attackerDmgMod;
      defenderTotal = dRoll.roll + defenderPaceMod + defenderRacecraftMod + defenderDmgMod;
    }

    const overtakeSuccess = attackerTotal > defenderTotal;

    newState.eventLog.push({
      lap,
      type: 'contested_roll',
      description: `${attacker.name}: d20(${aRoll.roll}) + pace(${attackerPaceMod}) + racecraft(${attackerRacecraftMod})${attackerTraitsLabel}${attackerDmgMod ? ` + dmg(${attackerDmgMod})` : ''} = ${attackerTotal} vs ${defender.name}: d20(${dRoll.roll}) + pace(${defenderPaceMod}) + racecraft(${defenderRacecraftMod})${defenderTraitsLabel}${defenderDmgMod ? ` + dmg(${defenderDmgMod})` : ''} = ${defenderTotal} → ${overtakeSuccess ? 'OVERTAKE' : 'DEFENDED'}`,
    });

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
        if (dTr) {
          dTr.temporaryModifiers = dTr.temporaryModifiers || {};
          dTr.temporaryModifiers['awareness:flexible_strategy'] = -1;
        }
        newState.eventLog.push({
          lap,
          type: 'trait',
          description: `${defender.name}'s team used Flexible Strategy — position unchanged; -1 Awareness rest of race.`,
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
      if (shouldTriggerAwarenessCheck(rollDiff)) {
        const defenderAwarenessForDiff = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
        const { difference } = calculateEffectiveAwarenessDifference(
          attacker.awareness,
          defenderAwarenessForDiff
        );
        let effectiveDiff = difference;
        if (traitRuntime) {
          const mod = traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
          effectiveDiff = difference + mod;
        }
        const category = determineAwarenessOutcomeCategory(effectiveDiff);

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
        } else if (category !== 'clean') {
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
          const canReactiveSuspension = defenderTeamRef && (defenderTeamRef.traitId ?? defenderTeamRef.trait) === 'reactive_suspension' && (rsState?.usesRemaining ?? 0) > 0;
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
            newState.eventLog.push({ lap, type: 'trait', description: `${defender.name}'s team used Reactive Suspension — rerolled d6(${d6.roll}).` });
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
            externalPhase3Modifier: attackerDmgMod - 1, // Relentless penalty
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
            externalPhase3Modifier: defenderDmgMod,
            currentLap: lap,
            totalLaps: newState.totalLaps,
            halfIndex,
            isAttacker: false,
            position: defenderState.position,
          });
          newState.traitRuntime = dRetryRes.runtime;

          retryAttackerTotal = aRetryRes.result.finalTotal;
          retryDefenderTotal = dRetryRes.result.finalTotal;
          const aR2 = aRetryRes.result.phase2Delta + aRetryRes.result.phase3Delta - (attackerDmgMod - 1);
          const dR2 = dRetryRes.result.phase2Delta + dRetryRes.result.phase3Delta - defenderDmgMod;
          if (aR2 !== 0) retryAttackerTraitsLabel = ` + traits(${aR2 >= 0 ? '+' : ''}${aR2})`;
          if (dR2 !== 0) retryDefenderTraitsLabel = ` + traits(${dR2 >= 0 ? '+' : ''}${dR2})`;

          const aTr = newState.traitRuntime!.driverTraits[attackerId];
          const dTr = newState.traitRuntime!.driverTraits[defenderId];
          if (aTr?.temporaryModifiers) delete aTr.temporaryModifiers['pace:nextRoll'];
          if (dTr?.temporaryModifiers) delete dTr.temporaryModifiers['pace:nextRoll'];
        } else {
          retryAttackerTotal =
            retryAttackerRoll.roll +
            attackerPaceMod +
            attackerRacecraftMod +
            attackerDmgMod -
            1;
          retryDefenderTotal =
            retryDefenderRoll.roll +
            defenderPaceMod +
            defenderRacecraftMod +
            defenderDmgMod;
        }

        const retrySuccess = retryAttackerTotal > retryDefenderTotal;

        newState.eventLog.push({
          lap,
          type: 'contested_roll',
          description: `${attacker.name} (Relentless retry): d20(${retryAttackerRoll.roll}) + pace(${attackerPaceMod}) + racecraft(${attackerRacecraftMod})${retryAttackerTraitsLabel}${attackerDmgMod ? ` + dmg(${attackerDmgMod})` : ''} - 1(relentless) = ${retryAttackerTotal} vs ${defender.name}: d20(${retryDefenderRoll.roll}) + pace(${defenderPaceMod}) + racecraft(${defenderRacecraftMod})${retryDefenderTraitsLabel}${defenderDmgMod ? ` + dmg(${defenderDmgMod})` : ''} = ${retryDefenderTotal} → ${retrySuccess ? 'OVERTAKE' : 'DEFENDED'}`,
        });

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
        const retryDefenderAwareness = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
        const { difference: retryDiff } = calculateEffectiveAwarenessDifference(
          attacker.awareness,
          retryDefenderAwareness
        );
        let retryEffectiveDiff = retryDiff;
        if (traitRuntime) {
          const rmod = traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
          retryEffectiveDiff = retryDiff + rmod;
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
        const triggerAwarenessFailed = shouldTriggerAwarenessCheck(rollDiff) || (attackerHasDragFocus && rollDiff >= 8);
        if (triggerAwarenessFailed) {
          const failDefenderAwareness = defender.awareness - (((defender.traitId ?? defender.trait) === 'hotlap_master' && TRAITS_BY_ID['hotlap_master']?.isEnabled) ? 1 : 0);
          const { difference: failDiff } = calculateEffectiveAwarenessDifference(
            attacker.awareness,
            failDefenderAwareness
          );
          let failEffectiveDiff = failDiff;
          if (traitRuntime) {
            const fmod = traitRuntime.driverTraits[defenderId]?.temporaryModifiers?.['awareness:flexible_strategy'] ?? 0;
            failEffectiveDiff = failDiff + fmod;
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
          } else if (failCategory !== 'clean') {
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
            const failDefenderTeamRef = teams?.find(t => t.id === defender.teamId);
            const failRS = traitRuntime?.teamTraits[defender.teamId];
            const failCanRS = (failDefenderTeamRef?.traitId ?? failDefenderTeamRef?.trait) === 'reactive_suspension' && (failRS?.usesRemaining ?? 0) > 0;
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
              defenderState.damageState = { ...defenderState.damageState, state: escalateDamage(defenderState.damageState.state as any, damageType) };
              attackerState.damageState = { ...attackerState.damageState, state: escalateDamage(attackerState.damageState.state as any, damageType) };
              if (damageType === 'dnf') {
                defenderState.isDNF = true;
                attackerState.isDNF = true;
              }
              newState.eventLog.push({ lap, type: 'damage', description: `${defender.name}: ${prevDef} → ${defenderState.damageState.state}; ${attacker.name}: ${prevAtt} → ${attackerState.damageState.state}` });
            }
            if (failFinalOutcome === 'momentumLoss') {
              const maxPos = standings.filter(s => !s.isDNF).length;
              defenderState.position = Math.min(defenderState.position + newState.track.momentumLossPositions, maxPos);
              attackerState.position = Math.min(attackerState.position + newState.track.momentumLossPositions, maxPos);
              newState.eventLog.push({
                lap,
                type: 'momentum_loss',
                description: `Both lose ${newState.track.momentumLossPositions} position(s): ${defender.name}, ${attacker.name}`,
              });
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
  startingCompound: TyreCompound = 'medium',
  totalLapsOverride?: number,
  teams?: Team[]
): RaceState => {
  let state = initializeRace(track, drivers, cars, startingCompound, totalLapsOverride, teams);
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
