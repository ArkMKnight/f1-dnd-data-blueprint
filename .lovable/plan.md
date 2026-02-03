

## F1 × DnD Data Models

### 1. Driver
| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | string | - | Unique identifier |
| `name` | string | - | Driver's display name |
| `teamId` | string | - | Reference to Team |
| `pace` | integer | 1-20 | Baseline speed and race pace performance |
| `qualifying` | integer | 1-20 | Performance in qualifying sessions only |
| `racecraft` | integer | 1-20 | Overtaking, defending, wheel-to-wheel battles |
| `awareness` | integer | 1-20 | Avoiding incidents, penalties, and mistakes |
| `adaptability` | integer | 1-20 | Handling changing conditions and unexpected events |

---

### 2. Car
| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | string | - | Unique identifier |
| `teamId` | string | - | Reference to Team |
| `lowSpeedCornering` | integer | 0-200 | Performance in slow corners (hairpins, chicanes) |
| `mediumSpeedCornering` | integer | 0-200 | Performance in medium-speed corners |
| `highSpeedCornering` | integer | 0-200 | Performance in fast, sweeping corners |
| `topSpeed` | integer | 0-200 | Maximum straight-line velocity |
| `acceleration` | integer | 0-200 | Speed gained out of corners and off the line |

---

### 3. Team
| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | string | - | Unique identifier |
| `name` | string | - | Team's display name |
| `driverIds` | string[] | - | References to team's Drivers (typically 2) |
| `carId` | string | - | Reference to team's Car spec |

A Team represents organizational grouping only and does not provide performance modifiers unless explicitly defined by a future system.

---

### 4. Track
| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | string | - | Unique identifier |
| `name` | string | - | Track's display name (e.g., "Monaco", "Spa") |
| `lapCount` | integer | 1+ | Fixed number of laps for the race |
| `primaryCarStat` | enum | - | First car stat used for compatibility (one of the 5 car stats) |
| `secondaryCarStat` | enum | - | Second car stat used for compatibility (one of the 5 car stats) |
| `deterministicTraits` | Trait[] | - | Always-active traits that modify resolution rules |
| `conditionalTraits` | Trait[] | - | Traits that trigger under explicit conditions |

Traits may apply multiple stat-specific modifiers, but only as part of a single, explicitly defined modifier bundle, and only during resolution. Traits must not permanently modify base stats.

---

### 5. Trait (Sub-model for Track)
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name (e.g., "Street Circuit", "High Altitude") |
| `description` | string | Human-readable effect description |
| `type` | enum | `"deterministic"` or `"conditional"` |
| `triggerCondition` | string | null | Condition text (only for conditional traits) |
| `targetDriverStat` | enum | null | Which driver stat this trait references, if any |
| `racePhase` | enum | null | Which phase this applies to (qualifying, race start, mid-race, etc.) |

---

### Notes for Future Implementation
- **Track Compatibility Modifier**: Calculated externally by summing the two selected car stats, capping at 200, then mapping via predefined table
- **Dice resolution**: d6 for overtakes/defending/punctures/awareness checks; dX for opportunity selection
- **Awareness outcome tables**: Separate lookup tables based on Awareness difference thresholds (not stored in model)

