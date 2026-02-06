import type { Car, Track, Driver, DriverStat, TrackCompatibilityEntry } from '@/types/game';
import { calculateTrackCompatibility, isStatAffectedByTrackCompatibility } from '@/types/game';
import { TRACK_COMPATIBILITY_TABLE } from './data';

// ============================================
// STAT MODIFIER FORMULA
// ============================================

// Convert a 1-20 stat into a -5 to +5 modifier (D&D standard)
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
  const baseMod = statToModifier(rawStat);

  if (!isStatAffectedByTrackCompatibility(statName)) {
    return baseMod; // Awareness/Adaptability: no car modifier
  }

  const compat = calculateTrackCompatibility(car, track, lookupTable);
  return baseMod + compat.modifier;
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
