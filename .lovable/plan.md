# F1 × DnD System Freeze Directive

**Status: FROZEN** — Last locked: 2026-02-05

---

## Locked Systems

The following core systems are **stable and locked**. They must not be altered unless explicitly unfrozen by directive.

| System | Status | Description |
|--------|--------|-------------|
| Driver Stats | 🔒 Locked | Pace, Qualifying, Racecraft, Awareness, Adaptability (1-20) |
| Car Stats | 🔒 Locked | LowSpeedCornering, MediumSpeedCornering, HighSpeedCornering, TopSpeed, Acceleration (0-200) |
| Track Compatibility | 🔒 Locked | Car stat → driver stat mapping; affects Pace/Qualifying/Racecraft only |
| Awareness System | 🔒 Locked | Contested check triggers, difference thresholds, outcome tables |
| Damage System | 🔒 Locked | None/Minor/Major/DNF states, escalation rules, front wing repairs |
| Momentum Loss | 🔒 Locked | Position loss without contact, no stat penalties or escalation |
| Safety Car & Red Flag | 🔒 Locked | Trigger conditions, tire pause, pit loss reduction |
| Tyre System | 🔒 Locked | Compounds, degradation, puncture checks, forced pit conditions |
| Pit Stop System | 🔒 Locked | Atomic resolution, position loss calculation, state resets |
| Track Parameters | 🔒 Locked | Pit losses, momentum loss positions, tyre degradation configs |
| Intent Declaration | 🔒 Locked | Defender yields, attacker forfeits, bypass logic |
| Dice System | 🔒 Locked | d20 contested, d6 outcomes, dX opportunity selection |

---

## Extension Guidelines

Future additions **must** be implemented as modular extensions that:

1. **Do not modify** existing locked logic or data structures
2. **Hook into** defined resolution points only:
   - Lap Start (before Pit Decision)
   - Post-Pit Decision
   - Post-Opportunity Selection
   - Post-Intent Declaration
   - Post-Contested Rolls
   - Post-Awareness Resolution
   - Post-Damage Resolution
   - Lap End (after Tyre Checks)
3. **Can be enabled/disabled** without breaking the core system
4. **Do not rebalance** or reinterpret frozen mechanics

---

## Resolution Order (Frozen)

1. Pit Decision Phase (Lap Start)
2. Opportunity Selection (dX)
3. Intent Declaration (Bypass)
4. Contested Overtake/Defense Rolls (d20)
5. Awareness Check (if triggered)
6. Momentum Loss Resolution
7. Damage Resolution
8. Tyre Degradation Checks (Lap End)

---

## Data Models Reference

### Driver
| Field | Type | Range |
|-------|------|-------|
| pace | integer | 1-20 |
| qualifying | integer | 1-20 |
| racecraft | integer | 1-20 |
| awareness | integer | 1-20 |
| adaptability | integer | 1-20 |

### Car
| Field | Type | Range |
|-------|------|-------|
| lowSpeedCornering | integer | 0-200 |
| mediumSpeedCornering | integer | 0-200 |
| highSpeedCornering | integer | 0-200 |
| topSpeed | integer | 0-200 |
| acceleration | integer | 0-200 |

### Track Race Parameters
| Field | Type |
|-------|------|
| pitLossNormal | integer |
| pitLossSafetyCar | integer |
| pitLossFrontWing | integer |
| pitLossDoubleStack | integer |
| momentumLossPositions | integer |
| tyreDegradation | map per compound |

---

## Notes

- Track Compatibility modifiers apply to Pace, Qualifying, Racecraft only
- Awareness and Adaptability are **driver-only** stats (never modified by car/track)
- Damage resolution occurs after Awareness but before Tyre checks
- Extensions may read frozen state but must not write to it
- **Awareness outcome tables**: Separate lookup tables based on Awareness difference thresholds (not stored in model)

