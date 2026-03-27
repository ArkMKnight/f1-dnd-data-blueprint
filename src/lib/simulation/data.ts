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
  { id: 't1', name: 'Ford Motorsport', teamPrincipal: '', primaryColor: '#1C3F95', secondaryColor: '#6B7280', lowSpeedCornering: 75, mediumSpeedCornering: 50, highSpeedCornering: 100, topSpeed: 85, acceleration: 90, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'reactive_suspension' },
  { id: 't2', name: 'Aurora Bombardier', teamPrincipal: '', primaryColor: '#1F3A8A', secondaryColor: '#39FF9F', lowSpeedCornering: 25, mediumSpeedCornering: 75, highSpeedCornering: 25, topSpeed: 50, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'flexible_strategy' },
  { id: 't3', name: 'Magnus F1 Team', teamPrincipal: '', primaryColor: '#0F8A2D', secondaryColor: '#FACC15', lowSpeedCornering: 75, mediumSpeedCornering: 75, highSpeedCornering: 0, topSpeed: 75, acceleration: 25, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'experimental_parts' },
  { id: 't4', name: 'DevOps', teamPrincipal: '', primaryColor: '#000000', secondaryColor: '#DC2626', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 100, topSpeed: 100, acceleration: 100, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'reactive_suspension' },
  { id: 't5', name: 'Pemberley Racing', teamPrincipal: '', primaryColor: '#6F3FA3', secondaryColor: '#000000', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 25, topSpeed: 50, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'ultra_stable_chassis' },
  { id: 't6', name: 'Shard Motorsports', teamPrincipal: '', primaryColor: '#000000', secondaryColor: '#FACC15', lowSpeedCornering: 75, mediumSpeedCornering: 75, highSpeedCornering: 75, topSpeed: 75, acceleration: 100, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'reactive_suspension' },
  { id: 't7', name: 'Bayern Motorworks', teamPrincipal: '', primaryColor: '#F97316', secondaryColor: '#000000', lowSpeedCornering: 30, mediumSpeedCornering: 30, highSpeedCornering: 30, topSpeed: 30, acceleration: 30, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'reinforced_components' },
  { id: 't8', name: 'Takahashi Taikyu', teamPrincipal: '', primaryColor: '#FFFFFF', secondaryColor: '#DC2626', lowSpeedCornering: 25, mediumSpeedCornering: 25, highSpeedCornering: 25, topSpeed: 50, acceleration: 25, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'lightweight_parts' },
  { id: 't9', name: 'Ecurie Voltaire', teamPrincipal: '', primaryColor: '#6B7280', secondaryColor: '#38BDF8', lowSpeedCornering: 50, mediumSpeedCornering: 50, highSpeedCornering: 50, topSpeed: 0, acceleration: 0, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'experimental_parts' },
  { id: 't10', name: 'Scuderia Rampante', teamPrincipal: '', primaryColor: '#DC2626', secondaryColor: '#FFFFFF', lowSpeedCornering: 50, mediumSpeedCornering: 25, highSpeedCornering: 25, topSpeed: 75, acceleration: 75, paceModifier: 0, racecraftModifier: 0, qualifyingModifier: 0, traitId: 'flexible_strategy' },
];

export const INITIAL_DRIVERS: Driver[] = [
  { id: 'd1', name: 'Edward Blake', teamId: 't2', number: 13, nationality: 'American', age: 27, pace: 9, qualifying: 7, racecraft: 13, awareness: 10, adaptability: 11 },
  { id: 'd2', name: 'John Jeffers', teamId: 't1', number: 63, nationality: 'American', age: 28, pace: 9, qualifying: 11, racecraft: 15, awareness: 10, adaptability: 5 },
  { id: 'd3', name: 'Chad Chadderton', teamId: 't6', number: 32, nationality: 'British', age: 29, pace: 14, qualifying: 5, racecraft: 7, awareness: 10, adaptability: 8, traitId: 'momentum_driver' },
  { id: 'd4', name: 'Elodie Webber', teamId: 't5', number: 25, nationality: 'British', age: 26, pace: 12, qualifying: 6, racecraft: 10, awareness: 11, adaptability: 10, traitId: 'hotlap_master' },
  { id: 'd5', name: 'Neil Boyd', teamId: 't5', number: 34, nationality: 'British', age: 30, pace: 12, qualifying: 12, racecraft: 7, awareness: 6, adaptability: 6 },
  { id: 'd6', name: 'Jack Hartley', teamId: 't3', number: 21, nationality: 'Australian', age: 24, pace: 11, qualifying: 13, racecraft: 10, awareness: 11, adaptability: 6, traitId: 'momentum_driver' },
  { id: 'd7', name: 'Sam Solares', teamId: 't6', number: 27, nationality: 'British', age: 27, pace: 13, qualifying: 7, racecraft: 9, awareness: 9, adaptability: 9, traitId: 'relentless' },
  { id: 'd8', name: 'Julian Valero', teamId: 't1', number: 7, nationality: 'American', age: 25, pace: 14, qualifying: 10, racecraft: 10, awareness: 6, adaptability: 6 },
  { id: 'd9', name: 'Lucas Meers', teamId: 't3', number: 23, nationality: 'Australian', age: 23, pace: 8, qualifying: 7, racecraft: 13, awareness: 12, adaptability: 6, traitId: 'race_intelligence' },
  { id: 'd10', name: 'Claude Pacquin', teamId: 't9', number: 11, nationality: 'French', age: 28, pace: 9, qualifying: 13, racecraft: 12, awareness: 6, adaptability: 13, traitId: 'pay_driver' },
  { id: 'd11', name: 'Takahiro Sato', teamId: 't8', number: 15, nationality: 'Japanese', age: 26, pace: 14, qualifying: 6, racecraft: 13, awareness: 8, adaptability: 7, traitId: 'drag_reduction_focus' },
  { id: 'd12', name: 'Lucien Moreau', teamId: 't9', number: 16, nationality: 'French', age: 27, pace: 7, qualifying: 12, racecraft: 11, awareness: 6, adaptability: 13 },
  { id: 'd13', name: 'Annie Kruger', teamId: 't7', number: 17, nationality: 'German', age: 29, pace: 12, qualifying: 10, racecraft: 9, awareness: 5, adaptability: 9, traitId: 'preservation_instinct' },
  { id: 'd14', name: 'Matteo Conti', teamId: 't10', number: 18, nationality: 'Italian', age: 25, pace: 12, qualifying: 10, racecraft: 7, awareness: 9, adaptability: 11, traitId: 'ice_cold' },
  { id: 'd15', name: 'Felipe Andrade', teamId: 't2', number: 19, nationality: 'Canadian', age: 27, pace: 8, qualifying: 14, racecraft: 8, awareness: 7, adaptability: 9, traitId: 'walk_the_line' },
  { id: 'd16', name: 'Samyak Yadav', teamId: 't4', number: 20, nationality: 'Canadian', age: 24, pace: 12, qualifying: 9, racecraft: 11, awareness: 14, adaptability: 9, traitId: 'relentless' },
  { id: 'd17', name: 'Tariq Biviji', teamId: 't4', number: 22, nationality: 'American', age: 30, pace: 8, qualifying: 12, racecraft: 9, awareness: 11, adaptability: 11, traitId: 'ice_cold' },
  { id: 'd18', name: 'Arnav Yadav', teamId: 't10', number: 10, nationality: 'German', age: 23, pace: 14, qualifying: 8, racecraft: 10, awareness: 12, adaptability: 6, traitId: 'smooth_operator' },
  { id: 'd19', name: 'Isaiah Walker', teamId: 't7', number: 8, nationality: 'American', age: 26, pace: 8, qualifying: 8, racecraft: 12, awareness: 9, adaptability: 9, traitId: 'race_intelligence' },
  { id: 'd20', name: 'Ren Kobayashi', teamId: 't8', number: 20, nationality: 'Japanese', age: 24, pace: 15, qualifying: 6, racecraft: 13, awareness: 11, adaptability: 5, traitId: 'power_unit_overdrive' },
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
    weather: 'sunny',
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
    weather: 'sunny',
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
    weather: 'sunny',
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
    weather: 'sunny',
    tyreStatusBands: DEFAULT_TYRE_STATUS_BANDS,
  },
  {
    id: 'tr5', name: 'Mexico', lapCount: 71,
    primaryCarStat: 'mediumSpeedCornering', secondaryCarStat: 'topSpeed',
    momentumLossPositions: 4,
    pitLoss: 6,
    pitLossNormal: 6, pitLossSafetyCar: 3, pitLossFrontWing: 1, pitLossDoubleStack: 3, pitLossDoubleStackSafetyCar: 1,
    tyreDegradation: {
      soft: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 17, hiddenMaxLimit: 19, absoluteEndLap: 23 },
      medium: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 28, hiddenMaxLimit: 34, absoluteEndLap: 36 },
      hard: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 40, hiddenMaxLimit: 47, absoluteEndLap: 50 },
      intermediate: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 38, hiddenMaxLimit: 42, absoluteEndLap: 48 },
      wet: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 52, hiddenMaxLimit: 52, absoluteEndLap: 60 },
    },
    deterministicTraits: [
      {
        id: 'mexico_thin_air',
        name: 'Thin Air',
        description: 'Pace bonuses are capped at +4.',
        type: 'deterministic',
        triggerCondition: 'always',
        targetDriverStat: 'pace',
        racePhase: null,
      },
      {
        id: 'mexico_high_altitude',
        name: 'High Altitude',
        description: 'Drivers with 8+ Adaptability gain +1 Racecraft; otherwise they get -1 Racecraft.',
        type: 'deterministic',
        triggerCondition: 'always',
        targetDriverStat: 'racecraft',
        racePhase: null,
      },
      {
        id: 'mexico_late_braking_specialist',
        name: 'Late Braking Specialist',
        description: '+1 Racecraft when overtaking. +1 Awareness when defending.',
        type: 'conditional',
        triggerCondition: 'overtake/defend checks',
        targetDriverStat: 'racecraft',
        racePhase: null,
      },
    ],
    conditionalTraits: [
      {
        id: 'mexico_altitude_specialist',
        name: 'Altitude Specialist',
        description: 'At 200+ Car Match Score, drivers with 10+ Adaptability ignore Thin Air.',
        type: 'conditional',
        triggerCondition: '200+ Car Match Score',
        targetDriverStat: 'adaptability',
        racePhase: null,
      },
    ],
    weather: 'sunny',
    chanceOfRain: 60,
    weatherTimeline: [
      { startLap: 1, endLap: 11, condition: 'sunny' },
      { startLap: 12, endLap: 13, condition: 'wetSpots' },
      { startLap: 14, endLap: 15, condition: 'damp' },
      { startLap: 16, endLap: 16, condition: 'wet' },
      { startLap: 17, endLap: 57, condition: 'drenched' },
      { startLap: 58, endLap: 60, condition: 'wet' },
      { startLap: 61, endLap: 62, condition: 'damp' },
      { startLap: 63, endLap: 63, condition: 'wetSpots' },
      { startLap: 64, endLap: 71, condition: 'sunny' },
    ],
    tyreStatusBands: {
      soft: { freshUntilLap: 17, baseUntilLap: 19, wornUntilLap: 22, deadFromLap: 23 },
      medium: { freshUntilLap: 28, baseUntilLap: 34, wornUntilLap: 35, deadFromLap: 36 },
      hard: { freshUntilLap: 40, baseUntilLap: 47, wornUntilLap: 49, deadFromLap: 50 },
      intermediate: { freshUntilLap: 38, baseUntilLap: 42, wornUntilLap: 47, deadFromLap: 48 },
      wet: { freshUntilLap: 52, baseUntilLap: 52, wornUntilLap: 59, deadFromLap: 60 },
    },
  },
  {
    id: 'tr6', name: 'Azerbaijan', lapCount: 51,
    primaryCarStat: 'lowSpeedCornering', secondaryCarStat: 'topSpeed',
    momentumLossPositions: 4,
    pitLoss: 6,
    pitLossNormal: 6, pitLossSafetyCar: 3, pitLossFrontWing: 1, pitLossDoubleStack: 3, pitLossDoubleStackSafetyCar: 1,
    tyreDegradation: {
      // Legacy "life" model (not currently used by tyre wear behavior).
      // Kept aligned with the same bands shown in `tyreStatusBands`.
      soft: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 18, hiddenMaxLimit: 21, absoluteEndLap: 25 },
      medium: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 30, hiddenMaxLimit: 35, absoluteEndLap: 39 },
      hard: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 45, hiddenMaxLimit: 47, absoluteEndLap: 56 },
      intermediate: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 39, hiddenMaxLimit: 42, absoluteEndLap: 49 },
      wet: { effectiveLapRangeStart: 1, effectiveLapRangeEnd: 49, hiddenMaxLimit: 52, absoluteEndLap: 56 },
    },
    deterministicTraits: [
      {
        id: 'azerbaijan_walls_dont_forgive',
        name: "Walls Don't Forgive",
        description: 'Any awareness check where both values are less than 10 uses the 7+ (High Risk) band.',
        type: 'deterministic',
        triggerCondition: 'awareness: both awareness values < 10',
        targetDriverStat: null,
        racePhase: null,
      },
      {
        id: 'azerbaijan_better_safe_than_sorry',
        name: 'Better Safe than Sorry',
        description: 'Lower SC/Red Flag triggers: direct Major Damage+ => Safety Car, direct DNF (non-mechanical) => Red Flag.',
        type: 'deterministic',
        triggerCondition: 'awareness incident damage escalation',
        targetDriverStat: null,
        racePhase: null,
      },
    ],
    conditionalTraits: [
      {
        id: 'azerbaijan_positioning_battle',
        name: 'Positioning Battle',
        description: 'After a successful defense, gain +1 for the next defense opportunity; fail the second opportunity => lose 2 positions instead of 1.',
        type: 'conditional',
        triggerCondition: 'after successful defense',
        targetDriverStat: null,
        racePhase: null,
      },
      {
        id: 'azerbaijan_late_braking_gamble',
        name: 'Late Braking Gamble',
        description: 'When an overtake succeeds by 4 or more, gain +1 Pace Mod for the next encounter (unlocked at match score 200+).',
        type: 'conditional',
        triggerCondition: 'overtake success margin >= 4 && match score 200+',
        targetDriverStat: null,
        racePhase: null,
      },
    ],
    commentary: {
      successfulOvertakes: [
        'The overtaking driver gets a massive slipstream down the main straight and blasts past the defending driver into Turn 1!',
        'Late braking into Turn 3—the overtaking driver commits and steals the position from the defending driver!',
        'The overtaking driver gets a better exit from Turn 16 and storms past the defending driver before the braking zone!',
        'Into the tight Castle Section, the overtaking driver forces the defending driver slightly wide and sneaks through!',
        'Side by side into Turn 1—the overtaking driver holds the inside and completes the pass!',
        'The overtaking driver gets a perfect tow along the waterfront and clears the defending driver before Turn 3.',
        'The defending driver locks up at Turn 15 and the overtaking driver pounces immediately!',
        'Brilliant traction out of Turn 7—the overtaking driver powers past before the Castle Section.',
        'The overtaking driver pressures through the middle sector and finally dives inside the defending driver at Turn 3!',
        'A brave move around the outside at Turn 1—the overtaking driver somehow makes it work!',
        'The overtaking driver gets superior exit from the Castle Section and completes the move before Turn 15.',
        'Through the final corner the overtaking driver gets the better run and slips past the defending driver down the straight.',
        'The overtaking driver positions perfectly through Turn 2 and out-drags the defending driver into Turn 3.',
        'Massive tow down the straight—the overtaking driver flies past the defending driver with ease!',
        'The overtaking driver feints into Turn 15, cuts back on exit, and completes the pass on the defending driver.',
      ],
      successfulDefenses: [
        'The overtaking driver tries the inside into Turn 1, but the defending driver brakes perfectly and holds position.',
        'The defending driver covers the inside line at Turn 3, forcing the overtaking driver to back out.',
        'Through the Castle Section the defending driver places the car perfectly, leaving the overtaking driver nowhere to go.',
        'The overtaking driver dives late at Turn 15, but the defending driver cuts back and keeps the place.',
        'Down the long straight the overtaking driver closes quickly, yet the defending driver positions the car brilliantly into Turn 1.',
        'The overtaking driver tries to go around the outside at Turn 3, but the defending driver squeezes the line.',
        'The defending driver exits Turn 16 perfectly and denies the overtaking driver the run down the straight.',
        'The overtaking driver pressures through Turn 2 but the defending driver calmly holds the apex.',
        'Into Turn 15 the overtaking driver shows the nose, but the defending driver refuses to yield.',
        'The overtaking driver tries a late dive at Turn 3—brilliant awareness from the defending driver to shut it down.',
        'Through the tight Castle Section the defending driver stays millimeter-perfect.',
        'The overtaking driver gets a slipstream but the defending driver brakes impossibly late into Turn 1.',
        'Nose to tail through the middle sector, the defending driver makes the car as wide as possible.',
        'The overtaking driver shapes for a move at Turn 15 but the defending driver covers it early.',
        'The defending driver exits Turn 7 strongly, neutralizing the overtaking driver’s momentum.',
        'Into Turn 3 the overtaking driver tries to surprise the defending driver—but the door is firmly closed.',
        'The overtaking driver stays tucked in down the straight but the defending driver holds the racing line perfectly.',
        'The defending driver survives huge pressure through the Castle Section.',
        'The overtaking driver looks to the outside at Turn 1 but the defending driver squeezes the space away.',
        'The defending driver gets excellent traction out of Turn 16 and keeps the overtaking driver behind.',
        'The overtaking driver lunges at Turn 3 but the defending driver calmly defends the apex.',
        'Down the main straight the overtaking driver is gaining, but the defending driver positions perfectly into the braking zone.',
        'The defending driver covers the inside at Turn 15, frustrating the overtaking driver again.',
        'The overtaking driver searches for an opening through Turn 2 but the defending driver remains composed.',
        'Through the Castle Section the overtaking driver backs out—no room against the defending driver.',
        'The defending driver forces the overtaking driver to take the long way around at Turn 3.',
        'The overtaking driver tries to out-drag the defending driver after Turn 16 but falls just short.',
        'Into Turn 1 the overtaking driver shows the nose, but the defending driver defends aggressively.',
        'The defending driver hugs the apex at Turn 15 and denies the overtaking driver any chance.',
        'The overtaking driver stays glued to the rear wing but the defending driver completes another lap in front.',
      ],
      majorDamage: [
        'The overtaking driver dives into Turn 1 far too late and crashes heavily into the defending driver—massive damage for both!',
        'Through the Castle Section the overtaking driver clips the barrier and ricochets into the defending driver—huge accident!',
        'Late braking at Turn 3 from the overtaking driver—contact with the defending driver and both slam into the runoff!',
        'The overtaking driver attempts a move at Turn 15 but spins the defending driver around with heavy contact!',
        'Down the straight the overtaking driver misjudges the braking zone and drives straight into the rear of the defending driver.',
      ],
      minorDamage: [
        'The overtaking driver taps the rear of the defending driver at Turn 1—small front wing damage.',
        'Wheel-to-wheel through Turn 3 and there’s slight contact between the overtaking driver and defending driver.',
        'The defending driver squeezes the overtaking driver at Turn 15—minor scrape against the wall.',
        'The overtaking driver nudges the defending driver exiting Turn 2—both continue with light damage.',
        'Slight contact through the Castle Section as the overtaking driver brushes the defending driver.',
      ],
      dangerousRacing: [
        'The overtaking driver lunges dangerously late into Turn 1—very risky move against the defending driver.',
        'The defending driver moves under braking into Turn 3, forcing the overtaking driver to avoid contact.',
        'The overtaking driver attempts an unrealistic dive into the Castle Section—extremely dangerous.',
        'The defending driver aggressively squeezes the overtaking driver toward the wall on the straight.',
        'The overtaking driver weaves repeatedly behind the defending driver approaching Turn 15.',
      ],
      mechanicalDnfs: [
        'The overtaking driver was lining up a move down the main straight but suddenly slows—engine failure ends the race!',
        'The defending driver exits Turn 16 ahead but smoke pours from the car—mechanical failure and that battle is over!',
      ],
      safetyCarDeployment: [
        'Yellow flags in Sector 1 and now the Safety Car is deployed at the Baku City Circuit after contact between the overtaking driver and the defending driver at Turn 3.',
        'Debris scattered across the straight after the overtaking driver clipped the defending driver into Turn 1—Safety Car deployed!',
        'The overtaking driver has stopped near the Castle Section after contact with the defending driver and the Safety Car is coming out.',
        'Marshals rushing onto the track at Turn 15 after a collision between the overtaking driver and the defending driver—Safety Car deployed.',
        'The overtaking driver has hit the barriers exiting Turn 16 while chasing the defending driver—this will bring out the Safety Car.',
      ],
      redFlagChaos: [
        'Massive crash into Turn 1! The overtaking driver and defending driver are both out and the race has been red flagged.',
        'A pileup in the Castle Section involving the overtaking driver and defending driver—race control has stopped the race.',
        'The overtaking driver loses control on the straight and collects the defending driver at high speed—red flag immediately.',
        'Multiple cars involved after the overtaking driver and defending driver collide at Turn 3—this race is suspended.',
        'Huge barrier damage after the overtaking driver crashes while battling the defending driver—red flag conditions.',
      ],
      momentumLoss: [
        'Disaster for the overtaking driver! A tyre explodes at top speed on the main straight while chasing the defending driver!',
        'The defending driver suffers a sudden tyre blowout approaching Turn 1 and the overtaking driver sails past.',
        'Catastrophic tyre failure for the overtaking driver down the straight—the defending driver narrowly avoids the slowing car!',
        'The defending driver’s tyre lets go at full speed and the overtaking driver takes evasive action!',
        'Huge moment! The overtaking driver’s tyre explodes while slipstreaming the defending driver.',
      ],
    },
    weather: 'sunny',
    tyreStatusBands: {
      // Soft-18-24 laps (worn after 21)
      soft: { freshUntilLap: 18, baseUntilLap: 21, wornUntilLap: 24, deadFromLap: 25 },
      // Medium-30-38 laps (worn after 35)
      medium: { freshUntilLap: 30, baseUntilLap: 35, wornUntilLap: 38, deadFromLap: 39 },
      // Hards-45-55 laps (worn after 47)
      hard: { freshUntilLap: 45, baseUntilLap: 47, wornUntilLap: 55, deadFromLap: 56 },
      // Inters-39-48 laps (worn after 42)
      intermediate: { freshUntilLap: 39, baseUntilLap: 42, wornUntilLap: 48, deadFromLap: 49 },
      // Wets-49-55 laps (worn after 52)
      wet: { freshUntilLap: 49, baseUntilLap: 52, wornUntilLap: 55, deadFromLap: 56 },
    },
  },
];

export const getTrack = (id: string) => TRACKS.find(t => t.id === id);