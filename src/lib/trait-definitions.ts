export type TraitScope = 'driver' | 'team';

export type TraitCategory = 'passive' | 'active' | 'hybrid';

export interface TraitDefinition {
  id: string;
  name: string;
  scope: TraitScope;
  category: TraitCategory;
  description: string;
  isEnabled: boolean;
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
  },
  {
    id: 'ultra_stable_chassis',
    name: 'Ultra Stable Chassis',
    scope: 'team',
    category: 'passive',
    description: '+2 Awareness, -1 Racecraft.',
    isEnabled: true,
  },
  {
    id: 'reactive_suspension',
    name: 'Reactive Suspension',
    scope: 'team',
    category: 'active',
    description: 'Reroll failed Awareness once per race.',
    isEnabled: true,
  },
  {
    id: 'reinforced_components',
    name: 'Reinforced Components',
    scope: 'team',
    category: 'hybrid',
    description: '-1 Pace; down-tier damage (not DNF).',
    isEnabled: true,
  },
  {
    id: 'experimental_parts',
    name: 'Experimental Parts',
    scope: 'team',
    category: 'hybrid',
    description: '+2 Pace first half; mechanical DNF risk later.',
    isEnabled: true,
  },
  {
    id: 'flexible_strategy',
    name: 'Flexible Strategy',
    scope: 'team',
    category: 'active',
    description: 'Ignore position loss once; may incur -1 Awareness.',
    isEnabled: true,
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
  },
  {
    id: 'power_unit_overdrive',
    name: 'Power Unit Overdrive',
    scope: 'driver',
    category: 'active',
    description: '+3 Pace on one roll; -1 Pace thereafter.',
    isEnabled: true,
  },
  {
    id: 'ice_cold',
    name: 'Ice Cold',
    scope: 'driver',
    category: 'passive',
    description: 'Blocks Awareness reductions and track Pace/Racecraft boosts.',
    isEnabled: true,
  },
  {
    id: 'race_intelligence',
    name: 'Race Intelligence',
    scope: 'driver',
    category: 'active',
    description: 'Ignore Pace modifiers; double Racecraft for both drivers, then -1 Pace next roll.',
    isEnabled: true,
  },
  {
    id: 'relentless',
    name: 'Relentless',
    scope: 'driver',
    category: 'passive',
    description: 'Immediate retry after failed overtake with -1 Pace and forced Awareness.',
    isEnabled: true,
  },
  {
    id: 'walk_the_line',
    name: 'Walk the Line',
    scope: 'driver',
    category: 'hybrid',
    description: '-1 Racecraft; Awareness outcomes one tier safer.',
    isEnabled: true,
  },
  {
    id: 'momentum_driver',
    name: 'Momentum Driver',
    scope: 'driver',
    category: 'passive',
    description: '+1 Pace after successful overtake (next contest only).',
    isEnabled: true,
  },
  {
    id: 'hotlap_master',
    name: 'Hotlap Master',
    scope: 'driver',
    category: 'passive',
    description: '+1 Qualifying; worse Awareness comparisons.',
    isEnabled: true,
  },
  {
    id: 'rain_man',
    name: 'Rain Man',
    scope: 'driver',
    category: 'passive',
    description: '+1 Adaptability; ignore Adaptability penalties.',
    isEnabled: true,
  },
  {
    id: 'preservation_instinct',
    name: 'Preservation Instinct',
    scope: 'driver',
    category: 'passive',
    description: 'Aborts moves that would trigger Awareness; no damage or position loss.',
    isEnabled: true,
  },
  {
    id: 'smooth_operator',
    name: 'Smooth Operator',
    scope: 'driver',
    category: 'hybrid',
    description: '+10% tyre life; -1 Pace.',
    isEnabled: true,
  },
  {
    id: 'pay_driver',
    name: 'Pay Driver',
    scope: 'driver',
    category: 'passive',
    description: 'No mechanical effect.',
    isEnabled: false,
  },
];

export const TRAITS_BY_ID: Record<string, TraitDefinition> = TRAIT_DEFINITIONS.reduce(
  (acc, trait) => {
    acc[trait.id] = trait;
    return acc;
  },
  {} as Record<string, TraitDefinition>
);

