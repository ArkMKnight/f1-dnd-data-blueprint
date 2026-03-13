import type {
  Driver,
  Car,
  Team,
  Track,
  TyreDegradationConfig,
  TyreStatusBands,
  TrackCompatibilityEntry,
} from '@/types/game';

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
// BUILD CAR FROM TEAM (for race engine)
// ============================================

export function buildCarFromTeam(team: Team): Car {
  return {
    id: `${team.id}-car`,
    teamId: team.id,
    lowSpeedCornering: team.lowSpeedCornering,
    mediumSpeedCornering: team.mediumSpeedCornering,
    highSpeedCornering: team.highSpeedCornering,
    topSpeed: team.topSpeed,
    acceleration: team.acceleration,
  };
}

export function getCarsForDrivers(teams: Team[], drivers: Driver[]): Car[] {
  const teamIds = [...new Set(drivers.map(d => d.teamId))];
  return teamIds
    .map(tid => teams.find(t => t.id === tid))
    .filter((t): t is Team => t != null)
    .map(buildCarFromTeam);
}

// ============================================
// SEED DATA (initial teams & drivers for store)
// ============================================

export const INITIAL_TEAMS: Team[] = [
  { id: 't1', name: 'Ford Motorsport', teamPrincipal: '', primaryColor: '#3B6BBF', secondaryColor: '#FFFFFF', lowSpeedCornering: 75, mediumSpeedCornering: 50, highSpeedCornering: 100, topSpeed: 85, acceleration: 90, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't2', name: 'Aurora Bombardier', teamPrincipal: '', primaryColor: '#8AAAC7', secondaryColor: '#FFFFFF', lowSpeedCornering: 25, mediumSpeedCornering: 75, highSpeedCornering: 25, topSpeed: 50, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't3', name: 'Magnus F1 Team', teamPrincipal: '', primaryColor: '#A6C9AC', secondaryColor: '#FFFFFF', lowSpeedCornering: 75, mediumSpeedCornering: 75, highSpeedCornering: 0, topSpeed: 75, acceleration: 25, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't4', name: 'DevOps', teamPrincipal: '', primaryColor: '#000000', secondaryColor: '#FFFFFF', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 100, topSpeed: 100, acceleration: 100, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't5', name: 'Pemberley Racing', teamPrincipal: '', primaryColor: '#6F3FA3', secondaryColor: '#FFFFFF', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 25, topSpeed: 50, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't6', name: 'Shard Motorsports', teamPrincipal: '', primaryColor: '#E7D28C', secondaryColor: '#000000', lowSpeedCornering: 75, mediumSpeedCornering: 75, highSpeedCornering: 75, topSpeed: 75, acceleration: 100, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't7', name: 'Bayern Motorworks', teamPrincipal: '', primaryColor: '#E87A33', secondaryColor: '#FFFFFF', lowSpeedCornering: 30, mediumSpeedCornering: 30, highSpeedCornering: 30, topSpeed: 30, acceleration: 30, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't8', name: 'Takahashi Taikyu', teamPrincipal: '', primaryColor: '#D8D8D8', secondaryColor: '#000000', lowSpeedCornering: 25, mediumSpeedCornering: 25, highSpeedCornering: 25, topSpeed: 50, acceleration: 25, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't9', name: 'Ecurie Voltaire', teamPrincipal: '', primaryColor: '#9C9C9C', secondaryColor: '#FFFFFF', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 50, topSpeed: 0, acceleration: 0, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't10', name: 'Scuderia Rampante', teamPrincipal: '', primaryColor: '#D84C4C', secondaryColor: '#FFFFFF', lowSpeedCornering: 50, mediumSpeedCornering: 25, highSpeedCornering: 25, topSpeed: 75, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
];

export const INITIAL_DRIVERS: Driver[] = [
  { id: 'd1', name: 'Edward Blake', teamId: 't2', number: 13, nationality: 'American', age: 27, pace: 9, qualifying: 7, racecraft: 13, awareness: 9, adaptability: 11 },
  { id: 'd2', name: 'John Jeffers', teamId: 't1', number: 63, nationality: 'American', age: 28, pace: 9, qualifying: 11, racecraft: 15, awareness: 10, adaptability: 5 },
  { id: 'd3', name: 'Chad Chadderton', teamId: 't6', number: 32, nationality: 'British', age: 29, pace: 14, qualifying: 5, racecraft: 7, awareness: 10, adaptability: 8 },
  { id: 'd4', name: 'Elodie Webber', teamId: 't5', number: 25, nationality: 'British', age: 26, pace: 12, qualifying: 6, racecraft: 11, awareness: 9, adaptability: 10 },
  { id: 'd5', name: 'Neil Boyd', teamId: 't5', number: 34, nationality: 'British', age: 30, pace: 12, qualifying: 11, racecraft: 8, awareness: 5, adaptability: 6 },
  { id: 'd6', name: 'Jack Hartley', teamId: 't3', number: 21, nationality: 'Australian', age: 24, pace: 11, qualifying: 13, racecraft: 11, awareness: 9, adaptability: 6 },
  { id: 'd7', name: 'Sam Solares', teamId: 't6', number: 27, nationality: 'British', age: 27, pace: 13, qualifying: 7, racecraft: 9, awareness: 9, adaptability: 9 },
  { id: 'd8', name: 'Julian Valero', teamId: 't1', number: 7, nationality: 'American', age: 25, pace: 14, qualifying: 10, racecraft: 10, awareness: 6, adaptability: 6 },
  { id: 'd9', name: 'Lucas Meers', teamId: 't3', number: 23, nationality: 'Australian', age: 23, pace: 8, qualifying: 7, racecraft: 13, awareness: 12, adaptability: 6 },
  { id: 'd10', name: 'Claude Pacquin', teamId: 't9', number: 11, nationality: 'French', age: 28, pace: 11, qualifying: 13, racecraft: 9, awareness: 12, adaptability: 6 },
  { id: 'd11', name: 'Takahiro Sato', teamId: 't8', number: 15, nationality: 'Japanese', age: 26, pace: 13, qualifying: 6, racecraft: 13, awareness: 8, adaptability: 7 },
  { id: 'd12', name: 'Lucien Moreau', teamId: 't9', number: 16, nationality: 'French', age: 27, pace: 7, qualifying: 12, racecraft: 10, awareness: 12, adaptability: 6 },
  { id: 'd13', name: 'Annie Kruger', teamId: 't7', number: 17, nationality: 'German', age: 29, pace: 12, qualifying: 10, racecraft: 9, awareness: 5, adaptability: 9 },
  { id: 'd14', name: 'Matteo Conti', teamId: 't10', number: 18, nationality: 'Italian', age: 25, pace: 8, qualifying: 8, racecraft: 12, awareness: 9, adaptability: 9 },
  { id: 'd15', name: 'Felipe Andrade', teamId: 't2', number: 19, nationality: 'Canadian', age: 27, pace: 8, qualifying: 14, racecraft: 8, awareness: 7, adaptability: 9 },
  { id: 'd16', name: 'Samyak Yadav', teamId: 't4', number: 20, nationality: 'Canadian', age: 24, pace: 12, qualifying: 9, racecraft: 11, awareness: 13, adaptability: 9 },
  { id: 'd17', name: 'Tariq Biviji', teamId: 't4', number: 22, nationality: 'American', age: 30, pace: 7, qualifying: 12, racecraft: 9, awareness: 11, adaptability: 11 },
  { id: 'd18', name: 'Arnav Yadav', teamId: 't10', number: 10, nationality: 'German', age: 23, pace: 14, qualifying: 8, racecraft: 9, awareness: 12, adaptability: 6 },
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

const DEFAULT_TYRE_STATUS_BANDS: Record<keyof TyreDegradationConfig, TyreStatusBands> = {
  soft: {
    freshUntilLap: DEFAULT_TYRE_DEGRADATION.soft.effectiveLapRangeEnd,
    baseUntilLap: DEFAULT_TYRE_DEGRADATION.soft.hiddenMaxLimit,
    wornUntilLap: DEFAULT_TYRE_DEGRADATION.soft.absoluteEndLap - 1,
    deadFromLap: DEFAULT_TYRE_DEGRADATION.soft.absoluteEndLap,
  },
  medium: {
    freshUntilLap: DEFAULT_TYRE_DEGRADATION.medium.effectiveLapRangeEnd,
    baseUntilLap: DEFAULT_TYRE_DEGRADATION.medium.hiddenMaxLimit,
    wornUntilLap: DEFAULT_TYRE_DEGRADATION.medium.absoluteEndLap - 1,
    deadFromLap: DEFAULT_TYRE_DEGRADATION.medium.absoluteEndLap,
  },
  hard: {
    freshUntilLap: DEFAULT_TYRE_DEGRADATION.hard.effectiveLapRangeEnd,
    baseUntilLap: DEFAULT_TYRE_DEGRADATION.hard.hiddenMaxLimit,
    wornUntilLap: DEFAULT_TYRE_DEGRADATION.hard.absoluteEndLap - 1,
    deadFromLap: DEFAULT_TYRE_DEGRADATION.hard.absoluteEndLap,
  },
  intermediate: {
    freshUntilLap: DEFAULT_TYRE_DEGRADATION.intermediate.effectiveLapRangeEnd,
    baseUntilLap: DEFAULT_TYRE_DEGRADATION.intermediate.hiddenMaxLimit,
    wornUntilLap: DEFAULT_TYRE_DEGRADATION.intermediate.absoluteEndLap - 1,
    deadFromLap: DEFAULT_TYRE_DEGRADATION.intermediate.absoluteEndLap,
  },
  wet: {
    freshUntilLap: DEFAULT_TYRE_DEGRADATION.wet.effectiveLapRangeEnd,
    baseUntilLap: DEFAULT_TYRE_DEGRADATION.wet.hiddenMaxLimit,
    wornUntilLap: DEFAULT_TYRE_DEGRADATION.wet.absoluteEndLap - 1,
    deadFromLap: DEFAULT_TYRE_DEGRADATION.wet.absoluteEndLap,
  },
};

// ============================================
// TRACKS
// ============================================

export const TRACKS: Track[] = [
  {
    id: 'tr1', name: 'Monaco', lapCount: 10,
    primaryCarStat: 'lowSpeedCornering', secondaryCarStat: 'acceleration',
    momentumLossPositions: 5,
    pitLoss: 8,
    pitLossNormal: 8, pitLossSafetyCar: 4, pitLossFrontWing: 1, pitLossDoubleStack: 6,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
    weather: 'dry',
    tyreStatusBands: {
      soft:  { freshUntilLap: 18, baseUntilLap: 20, wornUntilLap: 24, deadFromLap: 25 },
      medium:{ freshUntilLap: 30, baseUntilLap: 37, wornUntilLap: 37, deadFromLap: 38 },
      hard:  { freshUntilLap: 45, baseUntilLap: 51, wornUntilLap: 54, deadFromLap: 55 },
      intermediate: DEFAULT_TYRE_STATUS_BANDS.intermediate,
      wet: DEFAULT_TYRE_STATUS_BANDS.wet,
    },
  },
  {
    id: 'tr2', name: 'Monza', lapCount: 10,
    primaryCarStat: 'topSpeed', secondaryCarStat: 'highSpeedCornering',
    momentumLossPositions: 1,
    pitLoss: 3,
    pitLossNormal: 3, pitLossSafetyCar: 1, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
    weather: 'dry',
    tyreStatusBands: DEFAULT_TYRE_STATUS_BANDS,
  },
  {
    id: 'tr3', name: 'Silverstone', lapCount: 10,
    primaryCarStat: 'highSpeedCornering', secondaryCarStat: 'mediumSpeedCornering',
    momentumLossPositions: 1,
    pitLoss: 3,
    pitLossNormal: 3, pitLossSafetyCar: 1, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
    weather: 'dry',
    tyreStatusBands: DEFAULT_TYRE_STATUS_BANDS,
  },
  {
    id: 'tr4', name: 'Spa-Francorchamps', lapCount: 10,
    primaryCarStat: 'highSpeedCornering', secondaryCarStat: 'topSpeed',
    momentumLossPositions: 1,
    pitLoss: 3,
    pitLossNormal: 3, pitLossSafetyCar: 2, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
    weather: 'dry',
    tyreStatusBands: DEFAULT_TYRE_STATUS_BANDS,
  },
];

export const getTrack = (id: string) => TRACKS.find(t => t.id === id);