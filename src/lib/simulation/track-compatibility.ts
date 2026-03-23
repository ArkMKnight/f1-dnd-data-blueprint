import type { Car, Track, Driver, DriverStat, TrackCompatibilityEntry } from '@/types/game';
import { calculateTrackCompatibility, isStatAffectedByTrackCompatibility } from '@/types/game';
import { TRACK_COMPATIBILITY_TABLE } from './data';

// ============================================
// STAT MODIFIER FORMULAS (per handout.txt)
// ============================================
// Only Pace and Racecraft use these tables for overtake/defence rolls.
// Other stats (Qualifying, Awareness, Adaptability) use statToModifier for display/grid only.

/** Pace: 0-3=+0, 4-7=+1, 8-11=+2, 12-15=+3, 16-19=+4, 20=+5 */
export const paceModifierFromStat = (stat: number): number => {
  if (stat >= 20) return 5;
  if (stat >= 16) return 4;
  if (stat >= 12) return 3;
  if (stat >= 8) return 2;
  if (stat >= 4) return 1;
  return 0;
};

/** Racecraft: 0-4=+0, 5-9=+1, 10-14=+2, 15-19=+3, 20=+4 */
export const racecraftModifierFromStat = (stat: number): number => {
  if (stat >= 20) return 4;
  if (stat >= 15) return 3;
  if (stat >= 10) return 2;
  if (stat >= 5) return 1;
  return 0;
};

/** Generic modifier for stats not used in overtake roll (Qualifying, Awareness, Adaptability). D&D-style for display/grid. */
export const statToModifier = (stat: number): number => Math.floor((stat - 10) / 2);

// ============================================
// TRACK MATCH BONUS THRESHOLDS
// ============================================

export const TRACK_BONUS_BASE_THRESHOLD = 200;
export const TRACK_BONUS_STEP = 50;
export const COMPATIBILITY_CAP = 400;

export interface TrackBonusTiers {
  trackSpecificBonusEligible: boolean;
  genericBonusTiers: number;
}

export const getTrackBonusTiers = (compatValue: number): TrackBonusTiers => {
  if (compatValue < TRACK_BONUS_BASE_THRESHOLD) {
    return { trackSpecificBonusEligible: false, genericBonusTiers: 0 };
  }
  const excess = Math.min(compatValue, COMPATIBILITY_CAP) - TRACK_BONUS_BASE_THRESHOLD;
  return {
    trackSpecificBonusEligible: true,
    genericBonusTiers: Math.floor(excess / TRACK_BONUS_STEP),
  };
};

// ============================================
// MODIFIED DRIVER STAT
// ============================================

// Returns the stat modifier (not raw stat) with track compatibility applied where relevant
export const getModifiedDriverStat = (
  driver: Driver,
  statName: DriverStat,
  car: Car,
  track: Track,
  lookupTable: TrackCompatibilityEntry[] = TRACK_COMPATIBILITY_TABLE
): number => {
  const rawStat = driver[statName];
  const isMonaco = track.name === 'Monaco';
  const isMexico = track.name === 'Mexico';
  const baseMod =
    statName === 'pace'
      ? (isMonaco ? racecraftModifierFromStat(rawStat) : paceModifierFromStat(rawStat))
      : statName === 'racecraft'
        ? (isMonaco ? paceModifierFromStat(rawStat) : racecraftModifierFromStat(rawStat))
        : statToModifier(rawStat);

  if (!isStatAffectedByTrackCompatibility(statName)) {
    return baseMod; // Awareness/Adaptability: no car modifier
  }

  const compat = calculateTrackCompatibility(car, track, lookupTable);
  let modified = baseMod + compat.modifier;

  if (isMexico && statName === 'racecraft') {
    modified += driver.adaptability >= 8 ? 1 : -1;
  }

  return modified;
};

export const ignoresMexicoThinAir = (
  driver: Driver,
  car: Car,
  track: Track
): boolean => {
  if (track.name !== 'Mexico') return false;
  const matchScore = getTrackMatchScore(car, track);
  return driver.adaptability >= 10 && getTrackBonusTiers(matchScore).trackSpecificBonusEligible;
};

export const capMexicoPaceContribution = (
  driver: Driver,
  car: Car,
  track: Track,
  paceContribution: number
): number => {
  if (track.name !== 'Mexico') return paceContribution;
  if (ignoresMexicoThinAir(driver, car, track)) return paceContribution;
  return paceContribution > 4 ? 4 : paceContribution;
};

// Get track match score for a car at a track
export const getTrackMatchScore = (car: Car, track: Track): number => {
  return car[track.primaryCarStat] + car[track.secondaryCarStat];
};

// Get the track compatibility modifier from the lookup table
export const getTrackCompatibilityModifier = (
  car: Car,
  track: Track,
  lookupTable: TrackCompatibilityEntry[] = TRACK_COMPATIBILITY_TABLE
): number => {
  const compat = calculateTrackCompatibility(car, track, lookupTable);
  return compat.modifier;
};

/**
 * Monaco Track Trait — "Watch your Step"
 *
 * When fighting a driver with a lower (Racecraft - Pace) difference than your own,
 * gain +1 Racecraft modifier for that contested check.
 *
 * This helper returns the per-check racecraft bonus for `driver` against `opponent`
 * and is only active on Monaco.
 */
export const getMonacoRacecraftBonus = (
  track: Track,
  driver: Driver,
  opponent: Driver
): number => {
  if (track.name !== 'Monaco') return 0;
  const selfDiff = (driver.racecraft ?? 0) - (driver.pace ?? 0);
  const oppDiff = (opponent.racecraft ?? 0) - (opponent.pace ?? 0);
  return selfDiff > oppDiff ? 1 : 0;
};

export const getMexicoOvertakeRacecraftBonus = (track: Track): number => {
  return track.name === 'Mexico' ? 1 : 0;
};

export const getMexicoDefendingAwarenessBonus = (track: Track): number => {
  return track.name === 'Mexico' ? 1 : 0;
};
