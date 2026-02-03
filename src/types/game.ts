// F1 × DnD Core Data Models

// Enums for type safety
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

// Core Models

export interface Driver {
  id: string;
  name: string;
  teamId: string;
  pace: number;        // 1-20: Baseline speed and race pace performance
  qualifying: number;  // 1-20: Performance in qualifying sessions only
  racecraft: number;   // 1-20: Overtaking, defending, wheel-to-wheel battles
  awareness: number;   // 1-20: Avoiding incidents, penalties, and mistakes
  adaptability: number; // 1-20: Handling changing conditions and unexpected events
}

export interface Car {
  id: string;
  teamId: string;
  lowSpeedCornering: number;    // 0-200: Performance in slow corners
  mediumSpeedCornering: number; // 0-200: Performance in medium-speed corners
  highSpeedCornering: number;   // 0-200: Performance in fast, sweeping corners
  topSpeed: number;             // 0-200: Maximum straight-line velocity
  acceleration: number;         // 0-200: Speed gained out of corners
}

export interface Team {
  id: string;
  name: string;
  driverIds: string[];  // References to team's Drivers (typically 2)
  carId: string;        // Reference to team's Car spec
}

export interface Trait {
  id: string;
  name: string;
  description: string;
  type: TraitType;
  triggerCondition: string | null;  // Only for conditional traits
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
