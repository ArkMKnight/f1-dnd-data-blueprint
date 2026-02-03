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

export type DiceType = 'd6' | 'dX';

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

export type AwarenessDifferenceThreshold = 
  | 'majorDisadvantage'   // -6 or lower
  | 'minorDisadvantage'   // -3 to -5
  | 'neutral'             // -2 to +2
  | 'minorAdvantage'      // +3 to +5
  | 'majorAdvantage';     // +6 or higher

export interface AwarenessOutcomeTable {
  threshold: AwarenessDifferenceThreshold;
  outcomes: Record<number, string>; // d6 roll -> outcome description
}

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
