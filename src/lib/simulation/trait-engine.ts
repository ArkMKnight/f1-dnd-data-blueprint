import type { Driver, Team, Track } from '@/types/game';
import type { TraitDefinition } from '@/lib/trait-definitions';
import { TRAITS_BY_ID } from '@/lib/trait-definitions';

// ============================================================
// RUNTIME STATE
// ============================================================

export interface RaceTraitState {
  usesRemaining: number | null;
  usedThisHalf: boolean;
  temporaryModifiers: Record<string, number>;
  flags: Record<string, unknown>;
}

export interface TraitRuntimeState {
  halfIndex: 1 | 2;
  driverTraits: Record<string, RaceTraitState>; // key: driverId
  teamTraits: Record<string, RaceTraitState>; // key: teamId
}

// Default per-trait use limits for active / hybrid traits.
const TRAIT_USE_LIMITS: Record<string, number | null> = {
  // Team
  reactive_suspension: 1,
  flexible_strategy: 1,
  experimental_parts: null,
  reinforced_components: null,
  lightweight_parts: null,
  ultra_stable_chassis: null,
  // Driver
  power_unit_overdrive: 1,
  race_intelligence: 2, // once per half
  drag_reduction_focus: null,
  relentless: null,
  walk_the_line: null,
  momentum_driver: null,
  hotlap_master: null,
  rain_man: null,
  preservation_instinct: null,
  smooth_operator: null,
  pay_driver: null,
};

export const createEmptyRaceTraitState = (): RaceTraitState => ({
  usesRemaining: null,
  usedThisHalf: false,
  temporaryModifiers: {},
  flags: {},
});

export const initTraitRuntimeState = (
  drivers: Driver[],
  teams: Team[]
): TraitRuntimeState => {
  const driverTraits: Record<string, RaceTraitState> = {};
  const teamTraits: Record<string, RaceTraitState> = {};

  for (const d of drivers) {
    const traitId = d.traitId ?? d.trait ?? null;
    const base: RaceTraitState = createEmptyRaceTraitState();
    if (traitId && TRAITS_BY_ID[traitId]) {
      const limit = TRAIT_USE_LIMITS[traitId] ?? null;
      base.usesRemaining = limit;
    }
    driverTraits[d.id] = base;
  }

  for (const t of teams) {
    const traitId = t.traitId ?? t.trait ?? null;
    const base: RaceTraitState = createEmptyRaceTraitState();
    if (traitId && TRAITS_BY_ID[traitId]) {
      const limit = TRAIT_USE_LIMITS[traitId] ?? null;
      base.usesRemaining = limit;
    }
    teamTraits[t.id] = base;
  }

  return {
    halfIndex: 1,
    driverTraits,
    teamTraits,
  };
};

// ============================================================
// ROLL RESOLUTION API (PHASED MODIFIER ARCHITECTURE)
// ============================================================

export type TraitCheckType =
  | 'overtake'
  | 'defend'
  | 'awareness'
  | 'qualifying'
  | 'other';

export type TraitStat =
  | 'pace'
  | 'qualifying'
  | 'racecraft'
  | 'awareness'
  | 'adaptability';

export interface TraitRollContext {
  track: Track;
  driver: Driver;
  team: Team;
  opponentDriver?: Driver | null;
  opponentTeam?: Team | null;
  checkType: TraitCheckType;
  stat: TraitStat;
  baseRoll: number; // raw die (d20/d6/etc)
  phase1Modifier: number; // base + car + track + weather
  externalPhase3Modifier: number; // damage, position-based non-trait, etc.
  currentLap: number;
  totalLaps: number;
  halfIndex: 1 | 2;
  isAttacker: boolean;
  position?: number;
}

export interface TraitRollResult {
  finalTotal: number;
  phase1Total: number;
  phase2Total: number;
  phase3Total: number;
  phase2Delta: number;
  phase3Delta: number;
}

export interface ResolveRollWithTraitsResult {
  result: TraitRollResult;
  runtime: TraitRuntimeState;
}

export const resolveRollWithTraits = (
  runtime: TraitRuntimeState,
  ctx: TraitRollContext
): ResolveRollWithTraitsResult => {
  const { baseRoll, phase1Modifier, externalPhase3Modifier } = ctx;

  const phase1Total = baseRoll + phase1Modifier;

  const { delta: passiveDelta } = computePassivePhase2Modifiers(ctx);
  const phase2Total = phase1Total + passiveDelta;

  const { delta: activeDelta } = computeActivePhase3Modifiers(runtime, ctx);
  const phase3Total = phase2Total + externalPhase3Modifier + activeDelta;

  return {
    result: {
      finalTotal: phase3Total,
      phase1Total,
      phase2Total,
      phase3Total,
      phase2Delta: passiveDelta,
      phase3Delta: activeDelta + externalPhase3Modifier,
    },
    runtime,
  };
};

// ============================================================
// PHASE 2 — PASSIVE / HYBRID PASSIVE MODIFIERS
// ============================================================

interface Phase2Result {
  delta: number;
}

const computePassivePhase2Modifiers = (ctx: TraitRollContext): Phase2Result => {
  let delta = 0;

  const driverTraitId = ctx.driver.traitId ?? ctx.driver.trait ?? null;
  const teamTraitId = ctx.team.traitId ?? ctx.team.trait ?? null;
  const driverTrait = driverTraitId ? TRAITS_BY_ID[driverTraitId] : undefined;
  const teamTrait = teamTraitId ? TRAITS_BY_ID[teamTraitId] : undefined;

  if (driverTrait?.isEnabled) {
    delta += applyDriverPassive(ctx, driverTrait);
  }

  if (teamTrait?.isEnabled) {
    delta += applyTeamPassive(ctx, teamTrait);
  }

  return { delta };
};

const applyDriverPassive = (
  ctx: TraitRollContext,
  trait: TraitDefinition
): number => {
  const { checkType, stat, halfIndex } = ctx;

  switch (trait.id) {
    case 'drag_reduction_focus':
      // PHASE 2 (during overtakes): +1 Pace
      if (trait.scope === 'driver' && checkType === 'overtake' && stat === 'pace') {
        return 1;
      }
      return 0;

    case 'ice_cold':
      // Blocking of Awareness reductions and track boosts is handled
      // in the calling code; no flat roll modifier here.
      return 0;

    case 'walk_the_line':
      // PHASE 2: Racecraft -1
      if (stat === 'racecraft') {
        return -1;
      }
      return 0;

    case 'momentum_driver':
      // Purely PHASE 3 via temporary modifiers (handled elsewhere)
      return 0;

    case 'hotlap_master':
      // PHASE 2: +1 Qualifying
      if (checkType === 'qualifying' && stat === 'qualifying') {
        return 1;
      }
      return 0;

    case 'rain_man':
      // PHASE 2: +1 Adaptability
      if (stat === 'adaptability') {
        return 1;
      }
      return 0;

    case 'smooth_operator':
      // PHASE 2: Pace -1 (tyre-life handled in tyre system)
      if (stat === 'pace') {
        return -1;
      }
      return 0;

    case 'relentless':
    case 'preservation_instinct':
    case 'power_unit_overdrive':
    case 'race_intelligence':
      // These are active / situational; no always-on passive delta here.
      return 0;

    case 'pay_driver':
      // Disabled via isEnabled=false; defensive no-op.
      return 0;

    default:
      return 0;
  }
};

const applyTeamPassive = (
  ctx: TraitRollContext,
  trait: TraitDefinition
): number => {
  const { stat, halfIndex } = ctx;

  switch (trait.id) {
    case 'lightweight_parts':
      // PHASE 2: +1 Pace
      if (stat === 'pace') {
        return 1;
      }
      return 0;

    case 'ultra_stable_chassis':
      // PHASE 2: +2 Awareness, Racecraft -1
      if (stat === 'awareness') return 2;
      if (stat === 'racecraft') return -1;
      return 0;

    case 'reinforced_components':
      // PHASE 2: Pace -1
      if (stat === 'pace') return -1;
      return 0;

    case 'experimental_parts':
      // PHASE 2 (First Half Only): +2 Pace
      if (halfIndex === 1 && stat === 'pace') {
        return 2;
      }
      return 0;

    case 'reactive_suspension':
    case 'flexible_strategy':
      // Active-only; no flat passive modifier.
      return 0;

    default:
      return 0;
  }
};

// ============================================================
// PHASE 3 — ACTIVE / TEMPORARY MODIFIERS
// ============================================================

interface Phase3Result {
  delta: number;
}

const computeActivePhase3Modifiers = (
  runtime: TraitRuntimeState,
  ctx: TraitRollContext
): Phase3Result => {
  let delta = 0;

  const driverState = runtime.driverTraits[ctx.driver.id];
  const teamState = runtime.teamTraits[ctx.team.id];
  const driverTraitId = ctx.driver.traitId ?? ctx.driver.trait ?? null;
  const teamTraitId = ctx.team.traitId ?? ctx.team.trait ?? null;
  const driverTrait = driverTraitId ? TRAITS_BY_ID[driverTraitId] : undefined;
  const teamTrait = teamTraitId ? TRAITS_BY_ID[teamTraitId] : undefined;

  if (driverTrait?.isEnabled && driverState) {
    delta += applyDriverPhase3(ctx, driverTrait, driverState);
  }

  if (teamTrait?.isEnabled && teamState) {
    delta += applyTeamPhase3(ctx, teamTrait, teamState);
  }

  // Apply any generic temporary modifiers stored on the driver
  if (driverState?.temporaryModifiers) {
    delta += sumApplicableTemporaryModifiers(driverState.temporaryModifiers, ctx);
  }

  return { delta };
};

const applyDriverPhase3 = (
  ctx: TraitRollContext,
  trait: TraitDefinition,
  state: RaceTraitState
): number => {
  const { checkType, stat } = ctx;

  switch (trait.id) {
    case 'power_unit_overdrive':
      // The +3 / -1 behavior is driven by explicit activation.
      // At roll time, we only apply any stored temporary modifiers.
      return 0;

    case 'race_intelligence':
      // Same as above: numeric effects handled via explicit activation helpers.
      return 0;

    case 'relentless':
    case 'momentum_driver':
      // These rely on flags / temporaryModifiers; nothing hard-coded here.
      return 0;

    case 'walk_the_line':
      // Awareness tier shift is handled in awareness outcome helpers.
      return 0;

    default:
      return 0;
  }
};

const applyTeamPhase3 = (
  ctx: TraitRollContext,
  trait: TraitDefinition,
  state: RaceTraitState
): number => {
  switch (trait.id) {
    case 'reinforced_components':
    case 'experimental_parts':
    case 'reactive_suspension':
    case 'flexible_strategy':
      // Phase 3 behavior is primarily in damage / awareness / position resolution;
      // no flat roll modifier is added here.
      return 0;

    default:
      return 0;
  }
};

// Apply any generic stored temporary modifiers whose keys match this context.
const sumApplicableTemporaryModifiers = (
  mods: Record<string, number>,
  ctx: TraitRollContext
): number => {
  let total = 0;
  for (const [key, value] of Object.entries(mods)) {
    // Convention examples:
    //  - "pace:nextRoll"
    //  - "pace:phase3:persistent"
    //  - "awareness:phase3:persistent"
    const [statKey] = key.split(':');
    if (statKey === ctx.stat) {
      total += value;
    }
  }
  return total;
};

// ============================================================
// AWARENESS / DAMAGE HELPERS (NON-NUMERIC EFFECTS)
// ============================================================

export type AwarenessOutcome =
  | 'cleanRacing'
  | 'positionShift'
  | 'momentumLoss'
  | 'miracleEscape'
  | 'minorDamage'
  | 'majorDamage'
  | 'dnf';

export interface AwarenessTraitContext {
  track: Track;
  attacker: Driver;
  defender: Driver;
  attackerTeam: Team;
  defenderTeam: Team;
  awarenessDifference: number;
  baseOutcome: AwarenessOutcome;
}

export interface AwarenessTraitResult {
  outcome: AwarenessOutcome;
  forceMechanicalDnf: boolean;
}

// Applies trait effects that change the awareness outcome tiering only.
export const applyAwarenessOutcomeTraits = (
  ctx: AwarenessTraitContext
): AwarenessTraitResult => {
  let outcome = ctx.baseOutcome;
  let forceMechanicalDnf = false;

  const defenderTraitId = ctx.defender.traitId ?? ctx.defender.trait ?? null;
  const defenderTeamTraitId = ctx.defenderTeam.traitId ?? ctx.defenderTeam.trait ?? null;
  const defenderTrait = defenderTraitId ? TRAITS_BY_ID[defenderTraitId] : undefined;
  const defenderTeamTrait = defenderTeamTraitId ? TRAITS_BY_ID[defenderTeamTraitId] : undefined;

  // Walk the Line: Awareness treated one tier safer for this driver.
  if (defenderTrait?.id === 'walk_the_line' && defenderTrait.isEnabled) {
    outcome = downgradeOutcomeOneTier(outcome);
  }

  // Reinforced Components: Lower damage severity by 1 tier (not DNF/mechanical).
  if (defenderTeamTrait?.id === 'reinforced_components' && defenderTeamTrait.isEnabled) {
    if (outcome === 'minorDamage' || outcome === 'majorDamage') {
      outcome = downgradeOutcomeOneTier(outcome);
    }
  }

  return { outcome, forceMechanicalDnf };
};

const downgradeOutcomeOneTier = (outcome: AwarenessOutcome): AwarenessOutcome => {
  switch (outcome) {
    case 'dnf':
      return 'majorDamage';
    case 'majorDamage':
      return 'minorDamage';
    case 'minorDamage':
      return 'momentumLoss';
    case 'momentumLoss':
      return 'positionShift';
    case 'positionShift':
      return 'cleanRacing';
    default:
      return outcome;
  }
};

