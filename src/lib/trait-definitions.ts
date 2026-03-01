export type TraitScope = 'driver' | 'team';

export type TraitCategory = 'passive' | 'active' | 'hybrid';

export interface TraitDefinition {
  id: string;
  name: string;
  scope: TraitScope;
  category: TraitCategory;
  description: string;
  isEnabled: boolean;
  activationLimit: number | null;
  activationTiming: string | null;
}

// Central list of all driver and team traits used by the UI.
// The trait engine provides the concrete behavior; this file only
// describes metadata for selection & display.
export const TRAIT_DEFINITIONS: TraitDefinition[] = [
  // =====================
  // TEAM TRAITS
  // =====================
  {
    id: 'lightweight_parts',
    name: 'Lightweight Parts',
    scope: 'team',
    category: 'passive',
    description: 'Pace +1; risky Awareness behavior.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'ultra_stable_chassis',
    name: 'Ultra Stable Chassis',
    scope: 'team',
    category: 'passive',
    description: '+2 Awareness, -1 Racecraft.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'reactive_suspension',
    name: 'Reactive Suspension',
    scope: 'team',
    category: 'active',
    description: 'Reroll failed Awareness once per race.',
    isEnabled: true,
    activationLimit: 1,
    activationTiming: 'after Awareness result != Clean',
  },
  {
    id: 'reinforced_components',
    name: 'Reinforced Components',
    scope: 'team',
    category: 'hybrid',
    description: '-1 Pace; down-tier damage (not DNF).',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'damage resolution',
  },
  {
    id: 'experimental_parts',
    name: 'Experimental Parts',
    scope: 'team',
    category: 'hybrid',
    description: '+2 Pace first half; one d6 every 5th lap in second half—mechanical DNF when same driver rolls 1 twice (tracked).',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'start of every 5th lap (second half)',
  },
  {
    id: 'flexible_strategy',
    name: 'Flexible Strategy',
    scope: 'team',
    category: 'active',
    description: 'Ignore position loss once; may incur -1 Awareness.',
    isEnabled: true,
    activationLimit: 1,
    activationTiming: 'after defense fails',
  },

  // =====================
  // DRIVER TRAITS
  // =====================
  {
    id: 'drag_reduction_focus',
    name: 'Drag Reduction Focus',
    scope: 'driver',
    category: 'passive',
    description: '+1 Pace during overtakes; extra Awareness checks on big fails.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'power_unit_overdrive',
    name: 'Power Unit Overdrive',
    scope: 'driver',
    category: 'active',
    description: '+3 Pace on one roll; -1 Pace thereafter.',
    isEnabled: true,
    activationLimit: 1,
    activationTiming: 'before d20 roll',
  },
  {
    id: 'ice_cold',
    name: 'Ice Cold',
    scope: 'driver',
    category: 'passive',
    description: 'Blocks Awareness reductions and track Pace/Racecraft boosts.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'race_intelligence',
    name: 'Race Intelligence',
    scope: 'driver',
    category: 'active',
    description: 'Ignore Pace modifiers; double Racecraft for both drivers, then -1 Pace next roll.',
    isEnabled: true,
    activationLimit: 2,
    activationTiming: 'before roll (once per half)',
  },
  {
    id: 'relentless',
    name: 'Relentless',
    scope: 'driver',
    category: 'passive',
    description: 'Immediate retry after failed overtake with -1 Pace and forced Awareness.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'walk_the_line',
    name: 'Walk the Line',
    scope: 'driver',
    category: 'hybrid',
    description: '-1 Racecraft; Awareness outcomes one tier safer.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'awareness/damage tiering',
  },
  {
    id: 'momentum_driver',
    name: 'Momentum Driver',
    scope: 'driver',
    category: 'passive',
    description: '+1 Pace after successful overtake (next contest only).',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'hotlap_master',
    name: 'Hotlap Master',
    scope: 'driver',
    category: 'passive',
    description: '+1 Qualifying; worse Awareness comparisons.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'qualifying & awareness comparisons',
  },
  {
    id: 'rain_man',
    name: 'Rain Man',
    scope: 'driver',
    category: 'passive',
    description: '+1 Adaptability; ignore Adaptability penalties.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: null,
  },
  {
    id: 'preservation_instinct',
    name: 'Preservation Instinct',
    scope: 'driver',
    category: 'passive',
    description: 'When Awareness would be non-clean: aborts check (no damage/position loss) but your move fails — overtake fails or defense fails.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'before Awareness trigger',
  },
  {
    id: 'smooth_operator',
    name: 'Smooth Operator',
    scope: 'driver',
    category: 'hybrid',
    description: '+10% tyre life; -1 Pace.',
    isEnabled: true,
    activationLimit: null,
    activationTiming: 'tyre system',
  },
  {
    id: 'pay_driver',
    name: 'Pay Driver',
    scope: 'driver',
    category: 'passive',
    description: 'No mechanical effect.',
    isEnabled: false,
    activationLimit: null,
    activationTiming: null,
  },
];

export const TRAITS_BY_ID: Record<string, TraitDefinition> = TRAIT_DEFINITIONS.reduce(
  (acc, trait) => {
    acc[trait.id] = trait;
    return acc;
  },
  {} as Record<string, TraitDefinition>
);

