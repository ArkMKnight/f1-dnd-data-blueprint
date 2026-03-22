import type {
  Driver,
  Track,
  TyreCompound,
  DriverTyreState,
  TyreStatus,
} from '@/types/game';
import { TRAITS_BY_ID } from '@/lib/trait-definitions';

// ============================================
// BASE TYRE LIFE CONFIG (kept for potential UI/debug; no longer drives behavior)
// ============================================

const BASE_TYRE_MAX_LIFE: Record<TyreCompound, number> = {
  soft: 12,
  medium: 18,
  hard: 24,
  intermediate: 20,
  wet: 20,
};

export interface TyreAssignmentOptions {
  compound: TyreCompound;
}

export const createInitialDriverTyreState = (
  driverId: string,
  compound: TyreCompound,
  driver: Driver,
  track: Track
): DriverTyreState => {
  const baseLife = BASE_TYRE_MAX_LIFE[compound];
  const maxLife = applySmoothOperatorMaxLife(driver, baseLife);

  return {
    driverId,
    compound,
    currentLap: 0,
    hasExceededHiddenLimit: false,
    isPunctured: false,
    isDeadTyre: false,
    lifeRemaining: maxLife,
    maxLife,
    pendingPit: {
      active: false,
      compound: null,
    },
    forcedPit: false,
    awaitingTyreSelection: false,
  };
};

export const applySmoothOperatorMaxLife = (driver: Driver, baseLife: number): number => {
  const traitId = driver.traitId ?? driver.trait ?? null;
  const trait = traitId ? TRAITS_BY_ID[traitId] : undefined;
  if (trait?.id === 'smooth_operator' && trait.isEnabled) {
    return Math.ceil(baseLife * 1.1);
  }
  return baseLife;
};

// ============================================
// PER-LAP TYRE WEAR & PUNCTURE CHECKS (legacy lifeRemaining-based, no longer used)
// ============================================

export interface TyreWearResult {
  updated: DriverTyreState;
  puncturedThisLap: boolean;
}

export const applyLapTyreWear = (
  tyre: DriverTyreState,
  driver: Driver,
  track: Track
): TyreWearResult => {
  const updated: DriverTyreState = {
    ...tyre,
    currentLap: tyre.currentLap + 1,
  };

  let puncturedThisLap = false;

  return { updated, puncturedThisLap };
};

// ============================================
// PIT EXECUTION HELPERS
// ============================================

export type PitReason = 'manual' | 'forced';

export interface PitExecutionResult {
  updated: DriverTyreState;
  positionsLost: number;
}

export const executePitStop = (
  tyre: DriverTyreState,
  driver: Driver,
  track: Track,
  reason: PitReason,
  manualCompound: TyreCompound | null
): PitExecutionResult => {
  const compound: TyreCompound =
    reason === 'manual' && manualCompound != null ? manualCompound : tyre.compound;

  const baseLife = BASE_TYRE_MAX_LIFE[compound];
  const maxLife = applySmoothOperatorMaxLife(driver, baseLife);

  const updated: DriverTyreState = {
    ...tyre,
    compound,
    currentLap: 0,
    hasExceededHiddenLimit: false,
    isPunctured: false,
    isDeadTyre: false,
    lifeRemaining: maxLife,
    maxLife,
    pendingPit: {
      active: false,
      compound: null,
    },
    forcedPit: false,
    awaitingTyreSelection: false,
  };

  const positionsLost = track.pitLoss;

  return { updated, positionsLost };
};

// ============================================
// PHASED MODIFIER INTEGRATION
// ============================================

export interface TyrePhase1Modifiers {
  paceDelta: number;
  adaptabilityDelta: number;
}

// Base Pace modifier per compound (universal, before status adjustments)
const BASE_PACE_BY_COMPOUND: Record<TyreCompound, number> = {
  soft: 2,
  medium: 1,
  hard: 0,
  intermediate: 0,
  wet: 0,
};

export const getTyreStatus = (
  track: Track,
  compound: TyreCompound,
  lapsOnTyre: number,
  weather: WeatherCondition = 'sunny'
): TyreStatus => {
  const bands = track.tyreStatusBands[compound];

  // Weather-based life adjustments: certain tyres "last half as long"
  let lap = lapsOnTyre;
  if (weather === 'sunny') {
    if (compound === 'intermediate' || compound === 'wet') {
      lap = lapsOnTyre * 2;
    }
  } else if (weather === 'wetSpots' || weather === 'damp') {
    if (compound === 'wet') {
      lap = lapsOnTyre * 2;
    }
  }

  if (lap >= bands.deadFromLap) {
    return 'dead';
  }
  if (lap > bands.wornUntilLap) {
    // Should not occur if bands are well-formed; treat as dead.
    return 'dead';
  }
  if (lap > bands.baseUntilLap) {
    return 'worn';
  }
  if (lap > bands.freshUntilLap) {
    return 'base';
  }
  return 'fresh';
};

export const getTyrePhase1Modifiers = (
  tyre: DriverTyreState,
  track: Track,
  weather: WeatherCondition = 'sunny'
): TyrePhase1Modifiers => {
  const status = getTyreStatus(track, tyre.compound, tyre.currentLap, weather);

  // Start from universal base modifier for this compound
  let paceDelta = BASE_PACE_BY_COMPOUND[tyre.compound] ?? 0;
  let adaptabilityDelta = 0;

  // Override based on status bands:
  // - fresh: full compound modifier (unchanged)
  // - base:  no modifier (0), except Hard which is -1
  // - worn:  -1 (universal penalty), except Hard which is -2
  // - dead:  handled by forced pit; no additional Pace modifier needed
  if (status === 'base') {
    if (tyre.compound === 'hard') {
      paceDelta = -1;
    } else {
      paceDelta = 0;
    }
  } else if (status === 'worn') {
    if (tyre.compound === 'hard') {
      paceDelta = -2;
    } else {
      paceDelta = -1;
    }
  }

  // Weather-based Pace penalties for running the wrong tyre
  const isDryTyre = tyre.compound === 'soft' || tyre.compound === 'medium' || tyre.compound === 'hard';
  if (weather === 'sunny') {
    // In sunny conditions, Inters and Wets get -3 Pace
    if (tyre.compound === 'intermediate' || tyre.compound === 'wet') {
      paceDelta -= 3;
    }
  } else if (weather === 'wetSpots' || weather === 'damp' || weather === 'wet') {
    if (isDryTyre) {
      // In wet-leaning conditions, dry tyres have a flat -3 modifier
      // (ignores base/status value).
      paceDelta = -3;
    }
    if (weather === 'wet') {
      if (tyre.compound === 'intermediate') {
        paceDelta -= 1;
      } else if (tyre.compound === 'wet') {
        paceDelta -= 2;
      }
    }
  } else if (weather === 'drenched') {
    if (isDryTyre || tyre.compound === 'intermediate') {
      // In drenched conditions, dry tyres and Inters have a flat -3 modifier
      paceDelta = -3;
    }
  }

  return { paceDelta, adaptabilityDelta };
};

export const getPuncturePhase3Penalty = (tyre: DriverTyreState): number => {
  // When punctured, apply Pace -4 in Phase 3 for remainder of current lap.
  return tyre.isPunctured ? -4 : 0;
};

// Utility used by GM UI when resolving post-puncture tyre selection without applying any
// additional pit position loss. This mirrors executePitStop's state reset behavior but
// leaves positions untouched.
export const assignTyreCompoundForSelection = (
  tyre: DriverTyreState,
  driver: Driver,
  track: Track,
  compound: TyreCompound
): DriverTyreState => {
  const baseLife = BASE_TYRE_MAX_LIFE[compound];
  const maxLife = applySmoothOperatorMaxLife(driver, baseLife);

  return {
    ...tyre,
    compound,
    currentLap: 0,
    hasExceededHiddenLimit: false,
    isPunctured: false,
    isDeadTyre: false,
    lifeRemaining: maxLife,
    maxLife,
    pendingPit: {
      active: false,
      compound: null,
    },
    forcedPit: false,
    awaitingTyreSelection: false,
  };
};

