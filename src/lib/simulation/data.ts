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

/** Build Car[] for race engine from teams that have at least one of the given drivers. */
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
  { id: 't1', name: 'Red Bull Racing', teamPrincipal: 'Christian Horner', primaryColor: '#0600EF', secondaryColor: '#FFD700', lowSpeedCornering: 150, mediumSpeedCornering: 160, highSpeedCornering: 170, topSpeed: 175, acceleration: 165, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't2', name: 'Mercedes', teamPrincipal: 'Toto Wolff', primaryColor: '#00D2BE', secondaryColor: '#000000', lowSpeedCornering: 145, mediumSpeedCornering: 155, highSpeedCornering: 165, topSpeed: 170, acceleration: 160, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't3', name: 'Ferrari', teamPrincipal: 'Frédéric Vasseur', primaryColor: '#DC0000', secondaryColor: '#FFFFFF', lowSpeedCornering: 155, mediumSpeedCornering: 150, highSpeedCornering: 160, topSpeed: 165, acceleration: 155, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't4', name: 'McLaren', teamPrincipal: 'Andrea Stella', primaryColor: '#FF8700', secondaryColor: '#000000', lowSpeedCornering: 140, mediumSpeedCornering: 155, highSpeedCornering: 160, topSpeed: 170, acceleration: 155, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
  { id: 't5', name: 'Aston Martin', teamPrincipal: 'Mike Krack', primaryColor: '#006F62', secondaryColor: '#C0C0C0', lowSpeedCornering: 135, mediumSpeedCornering: 140, highSpeedCornering: 145, topSpeed: 155, acceleration: 140, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0 },
];

export const INITIAL_DRIVERS: Driver[] = [
  { id: 'd1', name: 'Max Verstappen', teamId: 't1', number: 1, nationality: 'Dutch', age: 27, pace: 19, qualifying: 19, racecraft: 18, awareness: 16, adaptability: 18 },
  { id: 'd2', name: 'Sergio Perez', teamId: 't1', number: 11, nationality: 'Mexican', age: 34, pace: 14, qualifying: 13, racecraft: 15, awareness: 13, adaptability: 12 },
  { id: 'd3', name: 'Lewis Hamilton', teamId: 't2', number: 44, nationality: 'British', age: 39, pace: 18, qualifying: 17, racecraft: 19, awareness: 17, adaptability: 17 },
  { id: 'd4', name: 'George Russell', teamId: 't2', number: 63, nationality: 'British', age: 26, pace: 16, qualifying: 18, racecraft: 15, awareness: 14, adaptability: 15 },
  { id: 'd5', name: 'Charles Leclerc', teamId: 't3', number: 16, nationality: 'Monegasque', age: 26, pace: 17, qualifying: 19, racecraft: 16, awareness: 13, adaptability: 14 },
  { id: 'd6', name: 'Carlos Sainz', teamId: 't3', number: 55, nationality: 'Spanish', age: 29, pace: 16, qualifying: 16, racecraft: 16, awareness: 15, adaptability: 15 },
  { id: 'd7', name: 'Lando Norris', teamId: 't4', number: 4, nationality: 'British', age: 24, pace: 17, qualifying: 18, racecraft: 16, awareness: 14, adaptability: 16 },
  { id: 'd8', name: 'Oscar Piastri', teamId: 't4', number: 81, nationality: 'Australian', age: 23, pace: 15, qualifying: 16, racecraft: 14, awareness: 13, adaptability: 14 },
  { id: 'd9', name: 'Fernando Alonso', teamId: 't5', number: 14, nationality: 'Spanish', age: 42, pace: 16, qualifying: 15, racecraft: 18, awareness: 17, adaptability: 17 },
  { id: 'd10', name: 'Lance Stroll', teamId: 't5', number: 18, nationality: 'Canadian', age: 25, pace: 12, qualifying: 12, racecraft: 12, awareness: 11, adaptability: 11 },
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

// Default tyre status bands derived from the generic degradation model:
// - fresh:   effective range
// - base:    from end of effective range up to hidden limit
// - worn:    from hidden limit+1 up to absoluteEndLap-1
// - dead:    from absoluteEndLap onwards (forced pit)
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
    momentumLossPositions: 2,
    pitLoss: 4,
    pitLossNormal: 4, pitLossSafetyCar: 2, pitLossFrontWing: 1, pitLossDoubleStack: 1,
    tyreDegradation: DEFAULT_TYRE_DEGRADATION,
    deterministicTraits: [], conditionalTraits: [],
    weather: 'dry',
    tyreStatusBands: {
      // Soft: Fresh 1-18, Base 19-20, Worn 21-24, Dead 25+
      soft:  { freshUntilLap: 18, baseUntilLap: 20, wornUntilLap: 24, deadFromLap: 25 },
      // Medium: Fresh 1-30, Base 31-37, no Worn band (goes straight to Dead at 38)
      medium:{ freshUntilLap: 30, baseUntilLap: 37, wornUntilLap: 37, deadFromLap: 38 },
      // Hard: Fresh 1-45, Base 46-51, Worn 52-54, Dead 55+
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

// Lookup helpers (track is static; drivers/teams come from store)
export const getTrack = (id: string) => TRACKS.find(t => t.id === id);
