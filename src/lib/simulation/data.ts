import type { Driver, Car, Team, Track, TyreDegradationConfig, TrackCompatibilityEntry } from '@/types/game';

// ============================================
// TRACK COMPATIBILITY LOOKUP TABLE
// ============================================

export const TRACK_COMPATIBILITY_TABLE: TrackCompatibilityEntry[] = [
  { minValue: 0, maxValue: 24, modifier: -2 },
  { minValue: 25, maxValue: 49, modifier: -1 },
  { minValue: 50, maxValue: 74, modifier: 0 },
  { minValue: 75, maxValue: 99, modifier: 1 },
  { minValue: 100, maxValue: 124, modifier: 2 },
  { minValue: 125, maxValue: 149, modifier: 3 },
  { minValue: 150, maxValue: 174, modifier: 4 },
  { minValue: 175, maxValue: 199, modifier: 5 },
];

// ============================================
// TEAMS
// ============================================

export const TEAMS: Team[] = [
  { id: 't1', name: 'Red Bull Racing', driverIds: ['d1', 'd2'], carId: 'c1' },
  { id: 't2', name: 'Mercedes', driverIds: ['d3', 'd4'], carId: 'c2' },
  { id: 't3', name: 'Ferrari', driverIds: ['d5', 'd6'], carId: 'c3' },
  { id: 't4', name: 'McLaren', driverIds: ['d7', 'd8'], carId: 'c4' },
  { id: 't5', name: 'Aston Martin', driverIds: ['d9', 'd10'], carId: 'c5' },
];

// ============================================
// DRIVERS
// ============================================

export const DRIVERS: Driver[] = [
  { id: 'd1', name: 'Max Verstappen', teamId: 't1', pace: 19, qualifying: 19, racecraft: 18, awareness: 16, adaptability: 18 },
  { id: 'd2', name: 'Sergio Perez', teamId: 't1', pace: 14, qualifying: 13, racecraft: 15, awareness: 13, adaptability: 12 },
  { id: 'd3', name: 'Lewis Hamilton', teamId: 't2', pace: 18, qualifying: 17, racecraft: 19, awareness: 17, adaptability: 17 },
  { id: 'd4', name: 'George Russell', teamId: 't2', pace: 16, qualifying: 18, racecraft: 15, awareness: 14, adaptability: 15 },
  { id: 'd5', name: 'Charles Leclerc', teamId: 't3', pace: 17, qualifying: 19, racecraft: 16, awareness: 13, adaptability: 14 },
  { id: 'd6', name: 'Carlos Sainz', teamId: 't3', pace: 16, qualifying: 16, racecraft: 16, awareness: 15, adaptability: 15 },
  { id: 'd7', name: 'Lando Norris', teamId: 't4', pace: 17, qualifying: 18, racecraft: 16, awareness: 14, adaptability: 16 },
  { id: 'd8', name: 'Oscar Piastri', teamId: 't4', pace: 15, qualifying: 16, racecraft: 14, awareness: 13, adaptability: 14 },
  { id: 'd9', name: 'Fernando Alonso', teamId: 't5', pace: 16, qualifying: 15, racecraft: 18, awareness: 17, adaptability: 17 },
  { id: 'd10', name: 'Lance Stroll', teamId: 't5', pace: 12, qualifying: 12, racecraft: 12, awareness: 11, adaptability: 11 },
];

// ============================================
// CARS
// ============================================

export const CARS: Car[] = [
  { id: 'c1', teamId: 't1', lowSpeedCornering: 150, mediumSpeedCornering: 160, highSpeedCornering: 170, topSpeed: 175, acceleration: 165 },
  { id: 'c2', teamId: 't2', lowSpeedCornering: 145, mediumSpeedCornering: 155, highSpeedCornering: 165, topSpeed: 170, acceleration: 160 },
  { id: 'c3', teamId: 't3', lowSpeedCornering: 155, mediumSpeedCornering: 150, highSpeedCornering: 160, topSpeed: 165, acceleration: 155 },
  { id: 'c4', teamId: 't4', lowSpeedCornering: 140, mediumSpeedCornering: 155, highSpeedCornering: 160, topSpeed: 170, acceleration: 155 },
  { id: 'c5', teamId: 't5', lowSpeedCornering: 135, mediumSpeedCornering: 140, highSpeedCornering: 145, topSpeed: 155, acceleration: 140 },
];

// ============================================
// DEFAULT TYRE DEGRADATION CONFIG
// ============================================

const DEFAULT_TYRE_DEGRADATION: TyreDegradationConfig = {
  soft: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 8, hiddenMaxLimit: 10, absoluteEndLap: 14 },
  medium: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 14, hiddenMaxLimit: 18, absoluteEndLap: 24 },
  hard: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 22, hiddenMaxLimit: 28, absoluteEndLap: 36 },
  intermediate: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 18, hiddenMaxLimit: 24, absoluteEndLap: 30 },
  wet: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 14, hiddenMaxLimit: 18, absoluteEndLap: 24 },
};

// ============================================
// TRACKS
// ============================================

export const TRACKS: Track[] = [
  {
    id: 'tr1', name: 'Monaco', lapCount: 10,
    primaryCarStat: 'lowSpeedCornering', secondaryCarStat: 'acceleration',
    momentumLossPositions: 2,
    pitLossNormal: 4, pitLossSafetyCar: 2, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
  },
  {
    id: 'tr2', name: 'Monza', lapCount: 10,
    primaryCarStat: 'topSpeed', secondaryCarStat: 'highSpeedCornering',
    momentumLossPositions: 1,
    pitLossNormal: 3, pitLossSafetyCar: 1, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
  },
  {
    id: 'tr3', name: 'Silverstone', lapCount: 10,
    primaryCarStat: 'highSpeedCornering', secondaryCarStat: 'mediumSpeedCornering',
    momentumLossPositions: 1,
    pitLossNormal: 3, pitLossSafetyCar: 1, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
  },
  {
    id: 'tr4', name: 'Spa-Francorchamps', lapCount: 10,
    primaryCarStat: 'highSpeedCornering', secondaryCarStat: 'topSpeed',
    momentumLossPositions: 1,
    pitLossNormal: 3, pitLossSafetyCar: 2, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
  },
];

// Lookup helpers
export const getDriver = (id: string) => DRIVERS.find(d => d.id === id);
export const getTeam = (id: string) => TEAMS.find(t => t.id === id);
export const getCar = (id: string) => CARS.find(c => c.id === id);
export const getCarForTeam = (teamId: string) => CARS.find(c => c.teamId === teamId);
export const getTrack = (id: string) => TRACKS.find(t => t.id === id);
