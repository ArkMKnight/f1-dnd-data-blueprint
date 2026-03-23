// F1 × DnD Core Data Models

// ============================================
// ENUMS
// ============================================

export type CarStat = 
  | 'lowSpeedCornering'
  | 'mediumSpeedCornering'
  | 'highSpeedCornering'
  | 'topSpeed'
  | 'acceleration';

export type DriverStat = 
  | 'pace'
  | 'qualifying'
  | 'racecraft'
  | 'awareness'
  | 'adaptability';

export type TraitType = 'deterministic' | 'conditional';

export type RacePhase = 
  | 'qualifying'
  | 'raceStart'
  | 'midRace'
  | 'lateRace'
  | 'finalLap';

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';

export type WeatherCondition = 'sunny' | 'wetSpots' | 'damp' | 'wet' | 'drenched';

// Tyre status bands per track/compound:
// - fresh: full compound modifier (Soft +2, Medium +1, Hard 0)
// - base:  no modifier (0)
// - worn:  -1 Pace modifier and puncture risk (d6, 1 = puncture)
// - dead:  forced pit (tyre cannot be used further)
export type TyreStatus = 'fresh' | 'base' | 'worn' | 'dead';

export interface TyreStatusBands {
  freshUntilLap: number; // inclusive
  baseUntilLap: number;  // inclusive
  wornUntilLap: number;  // inclusive
  deadFromLap: number;   // inclusive
}

export type DiceType = 'd6' | 'd20' | 'dX';

export type CheckType = 
  | 'overtake'
  | 'defend'
  | 'puncture'
  | 'awareness'
  | 'opportunitySelection'
  | 'damageLocation';

// ============================================
// CORE MODELS
// ============================================

export interface Driver {
  id: string;
  name: string;
  teamId: string;
  number: number;
  nationality: string;
  age?: number;
  pace: number;         // 1-20
  qualifying: number;   // 1-20
  racecraft: number;    // 1-20
  awareness: number;    // 1-20
  adaptability: number; // 1-20
  paceModifier?: number;
  racecraftModifier?: number;
  qualifyingModifier?: number;
  /**
   * Trait identifier (preferred).
   * Kept separate from legacy `trait` to avoid breaking older saved data.
   */
  traitId?: string | null;
  /**
   * Legacy trait field (string id). UI should write to `traitId`.
   */
  trait?: string | null;
}

export interface Car {
  id: string;
  teamId: string;
  lowSpeedCornering: number;    // 0-200
  mediumSpeedCornering: number; // 0-200
  highSpeedCornering: number;   // 0-200
  topSpeed: number;             // 0-200
  acceleration: number;         // 0-200
}

export interface Team {
  id: string;
  name: string;
  teamPrincipal?: string;
  primaryColor: string;   // hex
  secondaryColor?: string; // hex
  lowSpeedCornering: number;
  mediumSpeedCornering: number;
  highSpeedCornering: number;
  acceleration: number;
  topSpeed: number;
  paceModifier: number;
  racecraftModifier: number;
  qualifyingModifier: number;
  /**
   * Trait identifier (preferred).
   * Kept separate from legacy `trait` to avoid breaking older saved data.
   */
  traitId?: string | null;
  /**
   * Legacy trait field (string id). UI should write to `traitId`.
   */
  trait?: string | null;
}

export interface Trait {
  id: string;
  name: string;
  description: string;
  type: TraitType;
  triggerCondition: string | null;
  targetDriverStat: DriverStat | null;
  racePhase: RacePhase | null;
}

export interface Track {
  id: string;
  name: string;
  lapCount: number;
  primaryCarStat: CarStat;
  secondaryCarStat: CarStat;
  momentumLossPositions: number;   // Positions lost when Momentum Loss occurs
  // Pit Stop Parameters
  // NOTE: `pitLoss` is the unified position loss value for manual/forced pits
  // in the pit & tyre management layer. Legacy fields are kept for compatibility.
  pitLoss: number;                  // Unified positions lost for a standard pit stop
  pitLossNormal: number;           // Positions lost under green flag
  pitLossSafetyCar: number;        // Reduced positions lost under SC
  pitLossFrontWing: number;        // Additional loss for front wing repair
  pitLossDoubleStack: number;      // Additional loss for second car in double stack
  pitLossDoubleStackSafetyCar?: number; // Additional loss for second car in double stack under SC
  // Tyre Degradation Parameters (per compound)
  tyreDegradation: TyreDegradationConfig;
  deterministicTraits: Trait[];
  conditionalTraits: Trait[];
  // Optional per-race weather context; defaults to 'dry' when omitted.
  weather?: WeatherCondition;
  // Tyre status bands per compound (fresh/base/worn/dead) for this track.
  tyreStatusBands: {
    soft: TyreStatusBands;
    medium: TyreStatusBands;
    hard: TyreStatusBands;
    intermediate: TyreStatusBands;
    wet: TyreStatusBands;
  };
}

// ============================================
// RACE CONFIGURATION
// ============================================

// Per-race configuration chosen in the setup flow.
// - lapCount is always configurable per race
// - track.lapCount acts as the default value
export interface RaceConfig {
  trackId: string;
  selectedDrivers: string[]; // driver IDs included in this race
  lapCount: number;
}

// Live race event feed model (UI-facing)
export type RaceEventType = 'overtake' | 'defense' | 'incident';

export interface RaceEvent {
  id: string;
  lapNumber: number;
  type: RaceEventType;
  description: string;
  primaryDriverId: string;
  secondaryDriverId?: string;
  timestamp: number;
}

// ============================================
// SAVED RACE HISTORY
// ============================================

export type RaceMode = 'auto' | 'gm';

export interface SavedRaceStanding {
  driverId: string;
  driverName: string;
  teamId: string | null;
  teamName: string | null;
  position: number;
  isDNF: boolean;
}

export interface SavedRaceSummary {
  id: string;
  createdAt: number;
  mode: RaceMode;
  trackId: string;
  trackName: string;
  totalLaps: number;
  standings: SavedRaceStanding[];
}

// Track-specific tyre degradation configuration
export interface TyreCompoundConfig {
  effectiveLapRangeStart: number;  // First lap of optimal performance
  effectiveLapRangeEnd: number;    // Last lap of optimal performance
  hiddenMaxLimit: number;          // Hidden threshold before degradation begins
  absoluteEndLap: number;          // Mandatory pit stop threshold
}

export interface TyreDegradationConfig {
  soft: TyreCompoundConfig;
  medium: TyreCompoundConfig;
  hard: TyreCompoundConfig;
  intermediate: TyreCompoundConfig;
  wet: TyreCompoundConfig;
}

// ============================================
// DICE CONTROL SYSTEM
// ============================================

// Roll modes determine how dice values are obtained
export type RollMode = 'manual' | 'auto';

// DiceRequest is the input to the dice system
// Resolution logic creates requests; the dice system produces results
export interface DiceRequest {
  checkType: CheckType;
  diceType: DiceType;
  diceSize: number;           // 6 for d6, 20 for d20, or driver count for dX
  rollMode: RollMode;
  manualResult?: number;      // Required when rollMode is 'manual'
}

// DiceResult is the output consumed by resolution logic
// Resolution MUST NOT know whether the roll was manual or auto
export interface DiceResult {
  checkType: CheckType;
  diceType: DiceType;
  diceSize: number;
  roll: number;               // Final roll value (from manual input or random generation)
}

// Dice resolution function type
// Converts a DiceRequest into a DiceResult, abstracting the roll source
export type DiceResolver = (request: DiceRequest) => DiceResult;

// Validation: manual rolls must provide manualResult within valid range [1, diceSize]
export const isValidDiceRequest = (request: DiceRequest): boolean => {
  if (request.rollMode === 'manual') {
    return (
      request.manualResult !== undefined &&
      request.manualResult >= 1 &&
      request.manualResult <= request.diceSize
    );
  }
  return true; // Auto mode is always valid
};

// Legacy interface for backward compatibility
export interface DiceCheck {
  type: CheckType;
  diceType: DiceType;
  diceSize: number;
}

// ============================================
// AWARENESS OUTCOME SYSTEM
// ============================================

// Resolution rules:
// - Neutral threshold: NO dice roll, automatically resolves as "Clean racing"
// - Minor/Major thresholds: Roll d6 and consult outcome table

export type AwarenessDifferenceThreshold = 
  | 'majorDisadvantage'   // -6 or lower  → roll d6
  | 'minorDisadvantage'   // -3 to -5     → roll d6
  | 'neutral'             // -2 to +2     → NO roll, "Clean racing"
  | 'minorAdvantage'      // +3 to +5     → roll d6
  | 'majorAdvantage';     // +6 or higher → roll d6

export interface AwarenessOutcomeTable {
  threshold: Exclude<AwarenessDifferenceThreshold, 'neutral'>; // Only non-neutral thresholds have tables
  outcomes: Record<number, string>; // d6 roll -> outcome description
}

export const NEUTRAL_AWARENESS_OUTCOME = 'Clean racing' as const;

// ============================================
// AWARENESS RESOLUTION SYSTEM
// ============================================

// Awareness check triggers only when modified roll difference ≤ 3
export const AWARENESS_CHECK_TRIGGER_THRESHOLD = 3 as const;

// Special Conditions
// Low Awareness Rule: If both drivers have Awareness < 10, treat difference as 3-6
export const LOW_AWARENESS_THRESHOLD = 10 as const;
export const LOW_AWARENESS_FORCED_DIFFERENCE_MIN = 3 as const;
export const LOW_AWARENESS_FORCED_DIFFERENCE_MAX = 6 as const;

// Single-driver Awareness bands for wet Adaptability rule:
// - 0-6   Awareness → treated as difference ≥ 7 (most dangerous band)
// - 7-13  Awareness → treated as difference 3-6 (middle band)
// - 14-20 Awareness → treated as difference ≤ 2 (clean band)
export const mapSingleDriverAwarenessToDifference = (
  awareness: number
): number => {
  if (awareness <= 6) return 7;
  if (awareness <= 13) return 3;
  return 2;
};

// Evasion Priority: If Awareness difference ≥ 5, higher Awareness driver gets evasion
export const EVASION_PRIORITY_THRESHOLD = 5 as const;

// Awareness outcome types
export type AwarenessOutcome =
  | 'cleanRacing'
  | 'positionShift'
  | 'momentumLoss'
  | 'miracleEscape'
  | 'minorDamage'
  | 'majorDamage'
  | 'dnf';

// Evasion priority downgrades outcomes by one tier
export const EVASION_DOWNGRADE_MAP: Record<AwarenessOutcome, AwarenessOutcome> = {
  cleanRacing: 'cleanRacing',     // Already best outcome
  positionShift: 'cleanRacing',
  momentumLoss: 'cleanRacing',
  miracleEscape: 'miracleEscape', // Already clean
  minorDamage: 'momentumLoss',
  majorDamage: 'minorDamage',
  dnf: 'majorDamage',
};

// Outcome tables for d6 rolls based on Awareness difference
// Difference 3-6: Roll d6
export const AWARENESS_OUTCOME_TABLE_3_TO_6: Record<number, AwarenessOutcome> = {
  1: 'cleanRacing',
  2: 'cleanRacing',
  3: 'positionShift',
  4: 'positionShift',
  5: 'minorDamage',
  6: 'minorDamage',
};

// Difference ≥ 7: Roll d6
export const AWARENESS_OUTCOME_TABLE_7_PLUS: Record<number, AwarenessOutcome> = {
  1: 'miracleEscape',
  2: 'momentumLoss',
  3: 'momentumLoss',
  4: 'majorDamage',
  5: 'majorDamage',
  6: 'dnf',
};

// Position Shift Resolution
export type PositionShiftResult = 
  | 'attackerGainsPosition'       // Attacker has higher Awareness
  | 'defenderRetainsAndAttackerDrops'; // Defender has higher Awareness

export interface PositionShiftResolution {
  result: PositionShiftResult;
  attackerAwareness: number;
  defenderAwareness: number;
  attackerPositionChange: number;  // negative = drops positions
  defenderPositionChange: number;
}

// Momentum Loss tracking
export interface MomentumLossState {
  hasLostMomentum: boolean;
  positionsLost: number;           // Defined by track.momentumLossPositions
  // Momentum Loss rules:
  // - Does not stack (hasLostMomentum prevents re-application)
  // - Does not apply stat penalties
  // - Cannot escalate into damage
  // - Does not trigger Safety Car or Red Flag
}

// Momentum Loss resolution timing: After Awareness, before Damage/Tire/Pit
export const MOMENTUM_LOSS_CANNOT_CAUSE_DAMAGE = true as const;
export const MOMENTUM_LOSS_CANNOT_STACK = true as const;

// Awareness Check Input
export interface AwarenessCheckInput {
  attackerId: string;
  defenderId: string;
  attackerAwareness: number;
  defenderAwareness: number;
  modifiedRollDifference: number; // Absolute difference after Pace/Racecraft modifiers
}

// Awareness Check Result
export interface AwarenessCheckResult {
  triggered: boolean;              // False if roll difference > 3
  awarenessDifference: number;     // After special condition adjustments
  lowAwarenessRuleApplied: boolean;
  evasionPriorityApplied: boolean;
  evasionDriverId: string | null;  // Driver who has evasion priority
  diceResult: DiceResult | null;   // d6 roll (null if difference ≤ 2)
  rawOutcome: AwarenessOutcome;    // Before evasion downgrade
  finalOutcome: AwarenessOutcome;  // After evasion downgrade
  positionShiftResolution: PositionShiftResolution | null;
  damageHandoff: DamageHandoff | null;
}

// Damage System Handoff
// Awareness determines WHETHER damage occurs, not HOW it behaves
export interface DamageHandoff {
  targetDriverId: string;
  damageType: Exclude<AwarenessOutcome, 'cleanRacing' | 'positionShift' | 'momentumLoss' | 'miracleEscape'>;
}

// Utility: Determine if Awareness check should trigger
export const shouldTriggerAwarenessCheck = (
  modifiedRollDifference: number
): boolean => Math.abs(modifiedRollDifference) <= AWARENESS_CHECK_TRIGGER_THRESHOLD;

// Utility: Calculate effective Awareness difference with special conditions
export const calculateEffectiveAwarenessDifference = (
  attackerAwareness: number,
  defenderAwareness: number
): { difference: number; lowAwarenessRuleApplied: boolean } => {
  const actualDifference = Math.abs(attackerAwareness - defenderAwareness);
  
  // Low Awareness Rule: Both < 10 → treat as 3-6 range
  if (attackerAwareness < LOW_AWARENESS_THRESHOLD && 
      defenderAwareness < LOW_AWARENESS_THRESHOLD) {
    // Force difference into 3-6 range (use middle value)
    const forcedDifference = Math.max(
      LOW_AWARENESS_FORCED_DIFFERENCE_MIN,
      Math.min(actualDifference, LOW_AWARENESS_FORCED_DIFFERENCE_MAX)
    );
    return { 
      difference: forcedDifference < LOW_AWARENESS_FORCED_DIFFERENCE_MIN 
        ? LOW_AWARENESS_FORCED_DIFFERENCE_MIN 
        : forcedDifference,
      lowAwarenessRuleApplied: true 
    };
  }
  
  return { difference: actualDifference, lowAwarenessRuleApplied: false };
};

// Utility: Check for Evasion Priority
export const checkEvasionPriority = (
  attackerAwareness: number,
  defenderAwareness: number
): { hasEvasion: boolean; evasionDriverId: 'attacker' | 'defender' | null } => {
  const difference = Math.abs(attackerAwareness - defenderAwareness);
  
  if (difference >= EVASION_PRIORITY_THRESHOLD) {
    return {
      hasEvasion: true,
      evasionDriverId: attackerAwareness > defenderAwareness ? 'attacker' : 'defender'
    };
  }
  
  return { hasEvasion: false, evasionDriverId: null };
};

// Utility: Apply evasion downgrade to outcome
export const applyEvasionDowngrade = (
  outcome: AwarenessOutcome,
  hasEvasion: boolean
): AwarenessOutcome => {
  if (!hasEvasion) return outcome;
  return EVASION_DOWNGRADE_MAP[outcome];
};

// Utility: Determine outcome based on Awareness difference
export const determineAwarenessOutcomeCategory = (
  difference: number
): 'clean' | 'roll_3_to_6' | 'roll_7_plus' => {
  if (difference <= 2) return 'clean';
  if (difference <= 6) return 'roll_3_to_6';
  return 'roll_7_plus';
};

// Utility: Resolve outcome from d6 roll
export const resolveAwarenessD6Outcome = (
  difference: number,
  d6Roll: number
): AwarenessOutcome => {
  if (difference <= 2) return 'cleanRacing';
  if (difference <= 6) return AWARENESS_OUTCOME_TABLE_3_TO_6[d6Roll];
  return AWARENESS_OUTCOME_TABLE_7_PLUS[d6Roll];
};

// Utility: Resolve Position Shift based on Awareness comparison
export const resolvePositionShift = (
  attackerId: string,
  defenderId: string,
  attackerAwareness: number,
  defenderAwareness: number
): PositionShiftResolution => {
  if (attackerAwareness > defenderAwareness) {
    return {
      result: 'attackerGainsPosition',
      attackerAwareness,
      defenderAwareness,
      attackerPositionChange: 1,   // Gains one position
      defenderPositionChange: -1,  // Loses one position
    };
  }
  
  // Defender has higher or equal Awareness
  return {
    result: 'defenderRetainsAndAttackerDrops',
    attackerAwareness,
    defenderAwareness,
    attackerPositionChange: -1,  // Drops one additional position
    defenderPositionChange: 0,   // Retains position
  };
};

// Utility: Check if outcome requires damage handoff
export const requiresDamageHandoff = (
  outcome: AwarenessOutcome
): outcome is 'minorDamage' | 'majorDamage' | 'dnf' => {
  return outcome === 'minorDamage' || outcome === 'majorDamage' || outcome === 'dnf';
};

// Utility: Map Awareness outcome to Damage state for handoff
export const mapAwarenessOutcomeToDamageState = (
  outcome: 'minorDamage' | 'majorDamage' | 'dnf'
): Exclude<DamageState, 'none'> => {
  switch (outcome) {
    case 'minorDamage': return 'minor';
    case 'majorDamage': return 'major';
    case 'dnf': return 'dnf';
  }
};

// ============================================
// TIRE SYSTEM
// ============================================

// Resolution rules:
// 1. Each tire has a hidden absolute lap limit (not visible to player)
// 2. When tire FIRST exceeds hidden limit:
//    - Apply -1 Pace modifier (ONE TIME ONLY, does not stack)
// 3. For EVERY lap beyond hidden limit:
//    - Roll 1d6 for puncture check: 1 = puncture (immediate pit stop), 2-6 = safe
// 4. When tire reaches absolute end of effective range:
//    - Mandatory pit stop, no roll required

export interface TireState {
  currentLap: number;
  hiddenLapLimit: number;        // Hidden threshold before degradation begins
  absoluteEndLap: number;        // Mandatory pit stop threshold
  hasExceededLimit: boolean;     // Tracks if -1 Pace was already applied
  isPunctured: boolean;
}

export interface TirePunctureCheck {
  diceType: 'd6';
  punctureOnRoll: 1;             // Only roll of 1 causes puncture
  safeRange: [2, 3, 4, 5, 6];    // Rolls 2-6 are safe
}

export type TireResolutionOutcome =
  | 'withinLimit'                // Lap <= hiddenLapLimit, no effects
  | 'firstDegradation'           // First lap exceeding limit, apply -1 Pace
  | 'punctureCheck'              // Beyond limit, roll d6
  | 'puncture'                   // Rolled 1, immediate pit stop
  | 'safe'                       // Rolled 2-6, continue racing
  | 'mandatoryPitStop';          // Reached absoluteEndLap

export const TIRE_DEGRADATION_PACE_PENALTY = -1 as const;
export const TIRE_PUNCTURE_ROLL = 1 as const;

// ============================================
// PIT STOP SYSTEM
// ============================================

// Pit Decision Phase occurs at the beginning of each lap, before on-track resolution
// The DM declares whether a driver pits; forced conditions override voluntary decisions

// Starting tyre selection (before race begins)
export interface StartingTyreSelection {
  driverId: string;
  compound: TyreCompound;
}

// Driver's current tyre state during race
export interface DriverTyreState {
  driverId: string;
  compound: TyreCompound;
  currentLap: number;              // Laps on current set (legacy hidden-limit system)
  hasExceededHiddenLimit: boolean; // -1 Pace applied (one-time, legacy)
  isPunctured: boolean;
  isDeadTyre: boolean;             // Reached absolute end lap (legacy)
  // Extended tyre life model (pit & tyre management layer)
  lifeRemaining: number;           // Laps remaining on current compound
  maxLife: number;                 // Max laps for this set (after trait/track adjustments)
  // Manual pit decision state
  pendingPit: {
    active: boolean;
    compound: TyreCompound | null;
  };
  // Puncture / forced pit flow
  forcedPit: boolean;              // Set when puncture forces a pit at next lap start
  awaitingTyreSelection: boolean;  // Race progression locked until compound chosen
}

// Forced pit conditions
export type ForcedPitReason = 'puncture' | 'deadTyres';

export interface ForcedPitCondition {
  isForced: boolean;
  reason: ForcedPitReason | null;
}

// Pit stop decision (DM-controlled)
export interface PitStopDecision {
  driverId: string;
  lap: number;
  isVoluntary: boolean;
  forcedReason: ForcedPitReason | null;
  newCompound: TyreCompound;
  isDoubleStack: boolean;          // Second car of teammate pit on same lap
}

// Pit stop resolution result
export interface PitStopResult {
  driverId: string;
  lap: number;
  previousCompound: TyreCompound;
  newCompound: TyreCompound;
  // Position loss calculation
  basePitLoss: number;             // From track.pitLossNormal or track.pitLossSafetyCar
  frontWingRepairLoss: number;     // From track.pitLossFrontWing (0 if no repair)
  doubleStackLoss: number;         // From track.pitLossDoubleStack (0 if not applicable)
  totalPositionLoss: number;       // Sum of all losses
  // State changes
  tyreStateReset: boolean;         // Always true after pit
  frontWingRepaired: boolean;      // True if front wing damage was present and repaired
  // Context
  underSafetyCar: boolean;
}

// Pit stop cannot occur mid-lap or be partially resolved
export const PIT_STOP_ATOMIC = true as const;
export const PIT_STOP_NO_DICE_REQUIRED = true as const;

// Utility: Check for forced pit conditions
export const checkForcedPitCondition = (
  tyreState: DriverTyreState
): ForcedPitCondition => {
  if (tyreState.isPunctured) {
    return { isForced: true, reason: 'puncture' };
  }
  if (tyreState.isDeadTyre) {
    return { isForced: true, reason: 'deadTyres' };
  }
  return { isForced: false, reason: null };
};

// Utility: Calculate pit stop position loss
export const calculatePitStopPositionLoss = (
  track: Track,
  hasFrontWingDamage: boolean,
  isDoubleStack: boolean,
  underSafetyCar: boolean
): {
  basePitLoss: number;
  frontWingRepairLoss: number;
  doubleStackLoss: number;
  totalPositionLoss: number;
} => {
  const basePitLoss = underSafetyCar ? track.pitLossSafetyCar : track.pitLossNormal;
  const frontWingRepairLoss = hasFrontWingDamage ? track.pitLossFrontWing : 0;
  const doubleStackLoss = isDoubleStack ? track.pitLossDoubleStack : 0;
  
  return {
    basePitLoss,
    frontWingRepairLoss,
    doubleStackLoss,
    totalPositionLoss: basePitLoss + frontWingRepairLoss + doubleStackLoss,
  };
};

// Utility: Resolve pit stop
export const resolvePitStop = (
  decision: PitStopDecision,
  track: Track,
  currentTyreState: DriverTyreState,
  currentDamageState: DriverDamageState,
  underSafetyCar: boolean
): PitStopResult => {
  const positionLoss = calculatePitStopPositionLoss(
    track,
    currentDamageState.hasFrontWingDamage,
    decision.isDoubleStack,
    underSafetyCar
  );
  
  return {
    driverId: decision.driverId,
    lap: decision.lap,
    previousCompound: currentTyreState.compound,
    newCompound: decision.newCompound,
    basePitLoss: positionLoss.basePitLoss,
    frontWingRepairLoss: positionLoss.frontWingRepairLoss,
    doubleStackLoss: positionLoss.doubleStackLoss,
    totalPositionLoss: positionLoss.totalPositionLoss,
    tyreStateReset: true,
    frontWingRepaired: currentDamageState.hasFrontWingDamage,
    underSafetyCar,
  };
};

// Utility: Create fresh tyre state after pit stop
export const createFreshTyreState = (
  driverId: string,
  compound: TyreCompound
): DriverTyreState => ({
  driverId,
  compound,
  currentLap: 0,
  hasExceededHiddenLimit: false,
  isPunctured: false,
  isDeadTyre: false,
  lifeRemaining: 0,
  maxLife: 0,
  pendingPit: {
    active: false,
    compound: null,
  },
  forcedPit: false,
  awaitingTyreSelection: false,
});

// Utility: Check if tyre has reached hidden limit for track/compound
export const hasTyreExceededHiddenLimit = (
  tyreState: DriverTyreState,
  track: Track
): boolean => {
  const compoundConfig = track.tyreDegradation[tyreState.compound];
  return tyreState.currentLap > compoundConfig.hiddenMaxLimit;
};

// Utility: Check if tyre has reached absolute end (dead tyre)
export const isTyreDead = (
  tyreState: DriverTyreState,
  track: Track
): boolean => {
  const compoundConfig = track.tyreDegradation[tyreState.compound];
  return tyreState.currentLap >= compoundConfig.absoluteEndLap;
};

// Resolution flow with pit stops:
// 1. Pit Decision Phase (lap start, before on-track)
//    - Check forced pit conditions
//    - DM declares voluntary pits
//    - Resolve pit stops (atomic, no dice)
// 2. Opportunity Selection (FIXED 2 per lap, each resolved via d(driverCount - 1) + 1)
//    - Positions 2..N are eligible (P1 is never selected)
//    - Final selected position = base roll (1..driverCount-1) + 1
// 3. Intent Declaration Phase (DM manual)
// 4. Overtake/Defense rolls (d20 + modifiers)
// 5. Awareness check (if triggered)
// 6. Damage resolution (if applicable)
// 7. Tire degradation checks (end of lap)

// ============================================
// DAMAGE SYSTEM
// ============================================

// Resolution timing: After Awareness resolution, before Tire/Pit checks

// Damage states are mutually exclusive and non-stackable
// Escalation: none → minor → major → dnf
export type DamageState = 'none' | 'minor' | 'major' | 'dnf';

// Damage location (determined by d6 roll of 1)
export type DamageLocation = 'frontWing' | 'other';

// Driver damage tracking
export interface DriverDamageState {
  state: DamageState;
  location: DamageLocation | null;        // Only set when state is 'minor' or 'major'
  hasFrontWingDamage: boolean;            // Can be repaired during pit stop
}

// Damage modifiers
// Minor: -2 to all driver stats (persistent)
// Major: -4 to total roll result for all checks (not stats)
export const MINOR_DAMAGE_STAT_MODIFIER = -2 as const;
export const MAJOR_DAMAGE_ROLL_MODIFIER = -4 as const;
export const FRONT_WING_DAMAGE_ROLL = 1 as const;

// Damage escalation rules
// - none + minor = minor
// - none + major = major
// - minor + minor = major (escalation)
// - minor + major = major
// - major + minor = dnf (any further significant contact on major damage retires the car)
// - major + major = dnf (escalation)
// - any + dnf = dnf
export const escalateDamage = (
  current: DamageState, 
  incoming: Exclude<DamageState, 'none'>
): DamageState => {
  if (current === 'dnf' || incoming === 'dnf') return 'dnf';
  if (current === 'none') return incoming;
  if (current === 'minor' && incoming === 'minor') return 'major';
  if (current === 'minor' && incoming === 'major') return 'major';
  if (current === 'major' && (incoming === 'minor' || incoming === 'major')) return 'dnf';
  return current;
};

// Damage application result
export interface DamageApplicationResult {
  previousState: DamageState;
  newState: DamageState;
  wasEscalated: boolean;
  locationRoll?: DiceResult;              // d6 roll for front wing check
  isFrontWingDamage: boolean;
}

// ============================================
// RACE FLAGS (Safety Car / Red Flag)
// ============================================

export type RaceFlag = 'green' | 'safetyCar' | 'redFlag';

// Safety Car is deployed when BOTH drivers in a collision receive Major Damage
// Red Flag is deployed when BOTH drivers in a collision receive DNF

export interface SafetyCarState {
  isActive: boolean;
  tyreDegradationPaused: boolean;         // Tire wear stops under SC
  reducedPitPositionLoss: boolean;        // Pit stops lose fewer positions
}

export interface RedFlagState {
  isActive: boolean;
  positionsPreserved: boolean;            // Current positions frozen
  freePitStopAvailable: boolean;          // All drivers get voluntary free pit
}

// Collision resolution combines Awareness outcome with Damage determination
export interface CollisionResolution {
  driver1Id: string;
  driver2Id: string;
  driver1DamageResult: DamageApplicationResult;
  driver2DamageResult: DamageApplicationResult;
  flagTriggered: RaceFlag;
}

// Safety Car trigger condition
export const checkSafetyCarTrigger = (
  driver1State: DamageState,
  driver2State: DamageState
): boolean => driver1State === 'major' && driver2State === 'major';

// Red Flag trigger condition
export const checkRedFlagTrigger = (
  driver1State: DamageState,
  driver2State: DamageState
): boolean => driver1State === 'dnf' && driver2State === 'dnf';

// Determine flag from collision outcome
export const determineRaceFlag = (
  driver1State: DamageState,
  driver2State: DamageState
): RaceFlag => {
  if (checkRedFlagTrigger(driver1State, driver2State)) return 'redFlag';
  if (checkSafetyCarTrigger(driver1State, driver2State)) return 'safetyCar';
  return 'green';
};

// Pit stop position loss modifiers
export const NORMAL_PIT_POSITION_LOSS = 3 as const;
export const SAFETY_CAR_PIT_POSITION_LOSS = 1 as const;
export const FRONT_WING_REPAIR_ADDITIONAL_LOSS = 1 as const;

// ============================================
// TRACK COMPATIBILITY
// ============================================

// Driver stats affected by Track Compatibility modifiers
// ONLY these stats receive car performance bonuses from track compatibility
export type TrackCompatibilityAffectedStat = 'pace' | 'qualifying' | 'racecraft';

// Driver stats NOT affected by Track Compatibility
// These are driver-only stats that remain unchanged by car performance
export type TrackCompatibilityExcludedStat = 'awareness' | 'adaptability';

// Compile-time validation that affected + excluded = all driver stats
export const TRACK_COMPATIBILITY_AFFECTED_STATS: TrackCompatibilityAffectedStat[] = [
  'pace',
  'qualifying',
  'racecraft'
];

export const TRACK_COMPATIBILITY_EXCLUDED_STATS: TrackCompatibilityExcludedStat[] = [
  'awareness',
  'adaptability'
];

export interface TrackCompatibilityEntry {
  minValue: number;
  maxValue: number;
  modifier: number;
}

// Track Compatibility calculation
// Sum primary + secondary car stats, cap at 200, then lookup modifier
export interface TrackCompatibilityResult {
  primaryStatValue: number;
  secondaryStatValue: number;
  rawSum: number;
  cappedValue: number;
  modifier: number;
}

// Utility: Check if a driver stat is affected by Track Compatibility
export const isStatAffectedByTrackCompatibility = (
  stat: DriverStat
): stat is TrackCompatibilityAffectedStat => {
  return TRACK_COMPATIBILITY_AFFECTED_STATS.includes(stat as TrackCompatibilityAffectedStat);
};

// Utility: Calculate Track Compatibility modifier from car stats
export const calculateTrackCompatibility = (
  car: Car,
  track: Track,
  lookupTable: TrackCompatibilityEntry[]
): TrackCompatibilityResult => {
  const primaryStatValue = car[track.primaryCarStat];
  const secondaryStatValue = car[track.secondaryCarStat];
  const rawSum = primaryStatValue + secondaryStatValue;
  const cappedValue = Math.min(rawSum, COMPATIBILITY_CAP);
  
  // Find matching entry in lookup table
  const entry = lookupTable.find(
    e => cappedValue >= e.minValue && cappedValue <= e.maxValue
  );
  const modifier = entry?.modifier ?? 0;
  
  return {
    primaryStatValue,
    secondaryStatValue,
    rawSum,
    cappedValue,
    modifier,
  };
};

// Utility: Apply Track Compatibility modifier to a specific stat
// Returns original value if stat is not affected by Track Compatibility
export const applyTrackCompatibilityToStat = (
  statName: DriverStat,
  baseValue: number,
  trackCompatibilityModifier: number
): { modifiedValue: number; wasModified: boolean } => {
  if (isStatAffectedByTrackCompatibility(statName)) {
    return {
      modifiedValue: baseValue + trackCompatibilityModifier,
      wasModified: true,
    };
  }
  // Awareness and Adaptability are driver-only stats
  return {
    modifiedValue: baseValue,
    wasModified: false,
  };
};

// Utility: Get all modified driver stats for a given car/track combination
export const getTrackCompatibilityModifiedStats = (
  driver: Driver,
  car: Car,
  track: Track,
  lookupTable: TrackCompatibilityEntry[]
): Record<DriverStat, { base: number; modified: number; wasModified: boolean }> => {
  const compatibility = calculateTrackCompatibility(car, track, lookupTable);
  
  const paceResult = applyTrackCompatibilityToStat('pace', driver.pace, compatibility.modifier);
  const qualifyingResult = applyTrackCompatibilityToStat('qualifying', driver.qualifying, compatibility.modifier);
  const racecraftResult = applyTrackCompatibilityToStat('racecraft', driver.racecraft, compatibility.modifier);
  const awarenessResult = applyTrackCompatibilityToStat('awareness', driver.awareness, compatibility.modifier);
  const adaptabilityResult = applyTrackCompatibilityToStat('adaptability', driver.adaptability, compatibility.modifier);
  
  return {
    pace: {
      base: driver.pace,
      modified: paceResult.modifiedValue,
      wasModified: paceResult.wasModified,
    },
    qualifying: {
      base: driver.qualifying,
      modified: qualifyingResult.modifiedValue,
      wasModified: qualifyingResult.wasModified,
    },
    racecraft: {
      base: driver.racecraft,
      modified: racecraftResult.modifiedValue,
      wasModified: racecraftResult.wasModified,
    },
    awareness: {
      base: driver.awareness,
      modified: awarenessResult.modifiedValue,
      wasModified: awarenessResult.wasModified,
    },
    adaptability: {
      base: driver.adaptability,
      modified: adaptabilityResult.modifiedValue,
      wasModified: adaptabilityResult.wasModified,
    },
  };
};

// ============================================
// RESOLUTION FLOW
// ============================================

export interface ResolutionContext {
  track: Track;
  drivers: Driver[];
  cars: Car[];
  currentPhase: RacePhase;
  currentLap: number;
}

export interface CheckResolution {
  driverId: string;
  checkType: CheckType;
  diceResult: DiceResult;
  modifiersApplied: string[];
  outcome: string;
}

// ============================================
// STAT CONSTRAINTS (for validation)
// ============================================

export const DRIVER_STAT_RANGE = { min: 1, max: 20 } as const;
export const CAR_STAT_RANGE = { min: 0, max: 200 } as const;
export const COMPATIBILITY_CAP = 200 as const;

export const CAR_STATS: CarStat[] = [
  'lowSpeedCornering',
  'mediumSpeedCornering', 
  'highSpeedCornering',
  'topSpeed',
  'acceleration'
];

export const DRIVER_STATS: DriverStat[] = [
  'pace',
  'qualifying',
  'racecraft',
  'awareness',
  'adaptability'
];

// ============================================
// INTENT DECLARATION SYSTEM
// ============================================

// Intent declaration occurs AFTER opportunity selection, BEFORE any dice rolls
// This is a DM-controlled manual bypass of the normal resolution flow

export type OvertakeIntent = 
  | 'defenderYields'      // Defender allows attacker to pass
  | 'attackerForfeits'    // Attacker abandons overtake attempt
  | 'contested';          // Normal resolution (default)

// Intent declaration input from DM
export interface IntentDeclaration {
  attackerId: string;
  defenderId: string;
  declaredIntent: OvertakeIntent;
}

// Defender Yields Resolution
// - Positions swap immediately
// - No dice rolls occur
// - No Awareness check triggered
// - No Momentum Loss or Damage possible
// - Cannot trigger Safety Car or Red Flag
export interface DefenderYieldsResult {
  type: 'defenderYields';
  attackerId: string;
  defenderId: string;
  positionsSwapped: true;
  rollsOccurred: false;
  awarenessCheckTriggered: false;
  damageHandoff: null;
  flagTriggered: 'green';
}

// Attacker Forfeits Resolution
// - No position change
// - No rolls or Awareness checks
// - Overtake opportunity consumed (cannot retry immediately)
// - No penalties applied
export interface AttackerForfeitsResult {
  type: 'attackerForfeits';
  attackerId: string;
  defenderId: string;
  positionsSwapped: false;
  rollsOccurred: false;
  awarenessCheckTriggered: false;
  opportunityConsumed: true;
  canRetryImmediately: false;
}

// Union type for intent resolution outcomes
export type IntentResolutionResult = 
  | DefenderYieldsResult 
  | AttackerForfeitsResult 
  | null; // null means proceed to normal contested resolution

// Utility: Check if intent bypasses normal resolution
export const intentBypassesResolution = (intent: OvertakeIntent): boolean => {
  return intent !== 'contested';
};

// Utility: Resolve Defender Yields
export const resolveDefenderYields = (
  attackerId: string,
  defenderId: string
): DefenderYieldsResult => ({
  type: 'defenderYields',
  attackerId,
  defenderId,
  positionsSwapped: true,
  rollsOccurred: false,
  awarenessCheckTriggered: false,
  damageHandoff: null,
  flagTriggered: 'green',
});

// Utility: Resolve Attacker Forfeits
export const resolveAttackerForfeits = (
  attackerId: string,
  defenderId: string
): AttackerForfeitsResult => ({
  type: 'attackerForfeits',
  attackerId,
  defenderId,
  positionsSwapped: false,
  rollsOccurred: false,
  awarenessCheckTriggered: false,
  opportunityConsumed: true,
  canRetryImmediately: false,
});

// Utility: Resolve intent declaration
// Returns null if contested (proceed to normal resolution)
export const resolveIntentDeclaration = (
  declaration: IntentDeclaration
): IntentResolutionResult => {
  switch (declaration.declaredIntent) {
    case 'defenderYields':
      return resolveDefenderYields(declaration.attackerId, declaration.defenderId);
    case 'attackerForfeits':
      return resolveAttackerForfeits(declaration.attackerId, declaration.defenderId);
    case 'contested':
      return null; // Proceed to normal resolution
  }
};

// Resolution flow with intent declaration:
// 1. Opportunity Selection (FIXED 2 per lap, each via d(driverCount))
//    - Roll of 1 = no valid overtake (P1 cannot overtake)
//    - Roll of N = driver in position N receives the opportunity
// 2. Intent Declaration Phase (DM manual)
//    - If defenderYields or attackerForfeits → skip to step 6
// 3. Overtake/Defense rolls (d20 + modifiers)
// 4. Awareness check (if triggered)
// 5. Damage resolution (if applicable)
// 6. Tire & pit stop checks

// ============================================
// OVERTAKE OPPORTUNITY SYSTEM
// ============================================

// Fixed number of overtake opportunities per lap (may be modified by track traits later)
export const OVERTAKE_OPPORTUNITIES_PER_LAP = 2 as const;

// Track-specific hook for overtake opportunities per lap.
// Monaco Track Trait — "No Elbow Room": only 1 opportunity per lap.
export const getOvertakeOpportunitiesPerLapForTrack = (track: Track): number => {
  if (track.name === 'Monaco') return 1;
  return OVERTAKE_OPPORTUNITIES_PER_LAP;
};

// Opportunity selection: roll d(driverCount - 1) + 1 for each opportunity
// - Positions 2..N are eligible; P1 is never selected as attacker
// - Final selected position = base d(driverCount - 1) roll + 1

export interface OvertakeOpportunityRoll {
  opportunityIndex: number;       // 1 or 2 (which of the two opportunities)
  diceResult: DiceResult;         // d(driverCount) roll
  selectedPosition: number;       // The rolled position number
  isValid: boolean;               // false if roll === 1 (P1 cannot overtake)
  attackerDriverId: string | null; // null if invalid
  defenderDriverId: string | null; // null if invalid (driver ahead of attacker)
}

// Utility: Resolve an opportunity selection roll
export const resolveOpportunityRoll = (
  diceResult: DiceResult,
  opportunityIndex: number,
  standings: { position: number; driverId: string }[]
): OvertakeOpportunityRoll => {
  const rolledPosition = diceResult.roll;
  const isValid = rolledPosition > 1; // P1 cannot overtake; callers ensure 2..N only

  const attacker = isValid
    ? standings.find(s => s.position === rolledPosition) ?? null
    : null;
  const defender = attacker
    ? standings.find(s => s.position === rolledPosition - 1) ?? null
    : null;

  return {
    opportunityIndex,
    diceResult,
    selectedPosition: rolledPosition,
    isValid,
    attackerDriverId: attacker?.driverId ?? null,
    defenderDriverId: defender?.driverId ?? null,
  };
};
