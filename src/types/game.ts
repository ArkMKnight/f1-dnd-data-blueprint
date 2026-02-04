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
  | 'opportunitySelection';

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
// DICE RESOLUTION MODELS
// ============================================

export interface DiceCheck {
  type: CheckType;
  diceType: DiceType;
  diceSize: number;  // 6 for d6, or driver count for dX
}

export interface DiceResult {
  checkType: CheckType;
  roll: number;
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
