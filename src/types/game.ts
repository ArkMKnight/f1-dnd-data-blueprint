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
  pace: number;         // 1-20
  qualifying: number;   // 1-20
  racecraft: number;    // 1-20
  awareness: number;    // 1-20
  adaptability: number; // 1-20
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
  driverIds: string[];
  carId: string;
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
  deterministicTraits: Trait[];
  conditionalTraits: Trait[];
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
  // Momentum loss does not stack
  // Results in position/time loss as defined elsewhere
}

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
// - major + minor = major (no change)
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
  if (current === 'major' && incoming === 'major') return 'dnf';
  return current; // major + minor = major (no change)
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

export interface TrackCompatibilityEntry {
  minValue: number;
  maxValue: number;
  modifier: number;
}

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
