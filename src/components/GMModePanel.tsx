import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Car, Track, RaceConfig, Team, TyreCompound, SavedRaceSummary } from '@/types/game';
import type { DamageState } from '@/types/game';
import { initGMSession, advanceGMState, type GMState, type ActivationOption } from '@/lib/simulation/gm-engine';
import { reorderGridWithEvent } from '@/lib/simulation/race-engine';
import { DriverNameWithTeamColors } from '@/components/DriverNameWithTeamColors';
import { LiveRaceEventFeed } from '@/components/LiveRaceEventFeed';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { assignTyreCompoundForSelection, getTyreStatus } from '@/lib/simulation/tyre-system';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useData } from '@/context/DataContext';

/** Background/border shade for tyre compound badges (text colour unchanged). */
const COMPOUND_BADGE_CLASS: Record<TyreCompound, string> = {
  soft: 'bg-red-500/20 border-red-500/50',
  medium: 'bg-amber-500/20 border-amber-500/50',
  hard: 'bg-stone-200/80 dark:bg-stone-500/30 border-stone-400/50 dark:border-stone-500/50',
  intermediate: 'bg-green-500/20 border-green-500/50',
  wet: 'bg-blue-500/20 border-blue-500/50',
};

const formatTyreLabel = (
  track: Track,
  compound: TyreCompound,
  currentLapOnTyre: number
): string => {
  const status = getTyreStatus(track, compound, currentLapOnTyre);
  const statusLabel =
    status === 'fresh'
      ? 'Fresh'
      : status === 'base'
      ? 'Base'
      : status === 'worn'
      ? 'Worn'
      : 'Dead';

  const compoundLabel =
    compound === 'soft'
      ? 'Softs'
      : compound === 'medium'
      ? 'Mediums'
      : compound === 'hard'
      ? 'Hards'
      : compound === 'intermediate'
      ? 'Inters'
      : 'Wets';

  return `${statusLabel} ${compoundLabel}`;
};

interface GMModePanelProps {
  track: Track;
  drivers: Driver[];
  cars: Car[];
  teams: Team[];
  raceConfig: RaceConfig | null;
  setRaceConfig: (value: RaceConfig | null | ((prev: RaceConfig | null) => RaceConfig | null)) => void;
}

const MIN_LAPS = 1;
const MAX_LAPS = 200;

const GMModePanelComponent = ({ track, drivers, cars, teams, raceConfig, setRaceConfig }: GMModePanelProps) => {
  const [gmState, setGmState] = useState<GMState | null>(null);
  const [rollInput, setRollInput] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [lapInput, setLapInput] = useState<string>(() => String(track.lapCount));
  const [lapError, setLapError] = useState<string | null>(null);
  const [startingCompounds, setStartingCompounds] = useState<Record<string, TyreCompound | null>>(
    () => Object.fromEntries(drivers.map(d => [d.id, null as TyreCompound | null]))
  );
  const [strategy, setStrategy] = useState<
    Record<string, { nextCompound: TyreCompound | null; laps: string }[]>
  >(() =>
    Object.fromEntries(
      drivers.map(d => [
        d.id,
        [
          { nextCompound: null as TyreCompound | null, laps: '' },
          { nextCompound: null as TyreCompound | null, laps: '' },
          { nextCompound: null as TyreCompound | null, laps: '' },
        ],
      ])
    )
  );
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [hasSavedCurrentRace, setHasSavedCurrentRace] = useState(false);
  const { addRaceToHistory } = useData();
  const [prevPositions, setPrevPositions] = useState<Record<string, number>>({});
  const [positionDeltas, setPositionDeltas] = useState<Record<string, number>>({});
  const [commentary, setCommentary] = useState<string | null>(null);
  const [lastContestIndex, setLastContestIndex] = useState<number | null>(null);

  const effectiveLapCount = useMemo(
    () => (raceConfig && raceConfig.trackId === track.id ? raceConfig.lapCount : track.lapCount),
    [raceConfig, track]
  );

  const hasMissingTeamTrait = useMemo(
    () => teams.some(team => !(team.traitId ?? team.trait)),
    [teams]
  );

  // Stable key for "which drivers are in the race" so we only reset when the set changes, not on every parent re-render
  const participatingDriverIdsKey = useMemo(
    () => [...drivers].map(d => d.id).sort().join(','),
    [drivers]
  );

  useEffect(() => {
    setLapInput(String(effectiveLapCount));
    setLapError(null);
    setPrevPositions({});
    setPositionDeltas({});
  }, [effectiveLapCount]);

  useEffect(() => {
    // Reset starting compounds and strategy only when the set of participating drivers actually changes
    setStartingCompounds(Object.fromEntries(drivers.map(d => [d.id, null as TyreCompound | null])));
    setStrategy(
      Object.fromEntries(
        drivers.map(d => [
          d.id,
          [
            { nextCompound: null as TyreCompound | null, laps: '' },
            { nextCompound: null as TyreCompound | null, laps: '' },
            { nextCompound: null as TyreCompound | null, laps: '' },
          ],
        ])
      )
    );
    setStrategyError(null);
  }, [participatingDriverIdsKey]);

  // Track which drivers changed position between ticks for lightweight animation.
  useEffect(() => {
    if (!gmState) return;
    const current = gmState.raceState.standings;
    if (!current || current.length === 0) return;

    setPositionDeltas(() => {
      const deltas: Record<string, number> = {};
      current.forEach(s => {
        const prevPos = prevPositions[s.driverId];
        if (prevPos !== undefined && prevPos !== s.position) {
          // Negative delta = moved up (better position), positive = moved down.
          deltas[s.driverId] = s.position - prevPos;
        }
      });
      return deltas;
    });

    setPrevPositions(() => {
      const map: Record<string, number> = {};
      current.forEach(s => {
        map[s.driverId] = s.position;
      });
      return map;
    });
  }, [gmState, prevPositions]);

  // Clear the highlight after a delay so rows "pop" then settle.
  useEffect(() => {
    if (!Object.keys(positionDeltas).length) return;
    const timer = setTimeout(() => {
      setPositionDeltas({});
    }, 1500);
    return () => clearTimeout(timer);
  }, [positionDeltas]);

  const validateLapCount = useCallback((raw: string): { valid: boolean; value?: number; error?: string } => {
    if (raw.trim() === '') {
      return { valid: false, error: 'Lap count is required.' };
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      return { valid: false, error: 'Lap count must be an integer.' };
    }
    if (parsed < MIN_LAPS) {
      return { valid: false, error: `Minimum is ${MIN_LAPS} lap.` };
    }
    if (parsed > MAX_LAPS) {
      return { valid: false, error: `Maximum is ${MAX_LAPS} laps.` };
    }
    return { valid: true, value: parsed };
  }, []);

  const startRace = useCallback(() => {
    const { valid, value, error } = validateLapCount(lapInput);
    if (!valid || value === undefined) {
      setLapError(error ?? 'Invalid lap count.');
      return;
    }
    setLapError(null);

    // Validate starting compounds for all participating drivers
    const missingStarting: string[] = [];
    const startingMap: Record<string, TyreCompound> = {};
    drivers.forEach(d => {
      const sc = startingCompounds[d.id];
      if (!sc) {
        missingStarting.push(d.name);
      } else {
        startingMap[d.id] = sc;
      }
    });
    if (missingStarting.length > 0) {
      setStrategyError('All drivers must have a starting compound selected.');
      return;
    }

    // Build up to three planned strategy stops (optional, cumulative laps)
    const plannedPits: Record<string, { lap: number; compound: TyreCompound }[]> = {};
    drivers.forEach(d => {
      const rows = strategy[d.id] ?? [];
      const stops: { lap: number; compound: TyreCompound }[] = [];
      let cumulative = 0;
      rows.forEach(row => {
        if (!row.nextCompound || row.laps.trim() === '') return;
        const lapsNum = Number(row.laps);
        if (!Number.isFinite(lapsNum) || lapsNum <= 0) return;
        const pitLap = cumulative + lapsNum;
        if (pitLap >= value) return;
        stops.push({ lap: pitLap, compound: row.nextCompound });
        cumulative = pitLap;
      });
      plannedPits[d.id] = stops;
    });
    setStrategyError(null);

    setRaceConfig(prev => {
      const base: RaceConfig = prev && prev.trackId === track.id
        ? { ...prev }
        : {
            trackId: track.id,
            selectedDrivers: drivers.map(d => d.id),
            lapCount: value,
          };
      base.lapCount = value;
      base.selectedDrivers = drivers.map(d => d.id);
      return base;
    });

    const session = initGMSession(
      track,
      drivers,
      cars,
      teams,
      'medium',
      value,
      startingMap,
      plannedPits
    );
    const advanced = advanceGMState(session);
    // Initialize previous positions from the first race state so we only show arrows on actual changes.
    const initialPrev: Record<string, number> = {};
    advanced.raceState.standings.forEach(s => {
      initialPrev[s.driverId] = s.position;
    });
    setPrevPositions(initialPrev);
    setPositionDeltas({});
    setGmState(advanced);
    setIsStarted(true);
    setHasSavedCurrentRace(false);
  }, [cars, drivers, lapInput, setRaceConfig, startingCompounds, strategy, track, validateLapCount]);

  const handleSubmitRoll = useCallback(() => {
    if (!gmState || !rollInput) return;
    const val = parseInt(rollInput);
    if (isNaN(val)) return;
    const next = advanceGMState(gmState, val);
    setGmState(next);
    setRollInput('');
  }, [gmState, rollInput]);

  const handleAutoRoll = useCallback(() => {
    if (!gmState?.pendingPrompt) return;
    const size = gmState.pendingPrompt.diceSize ?? 20;
    const roll = Math.floor(Math.random() * size) + 1;
    const next = advanceGMState(gmState, roll);
    setGmState(next);
    setRollInput('');
  }, [gmState]);

  const handleTogglePendingPit = useCallback((driverId: string, active: boolean) => {
    setGmState(prev => {
      if (!prev) return prev;
      const race = prev.raceState;
      const newStandings = race.standings.map(s => {
        if (s.driverId !== driverId) return s;
        const current = s.tyreState;
        const nextPending = active
          ? {
              active: true,
              compound: current.pendingPit.compound ?? current.compound,
            }
          : {
              active: false,
              compound: null,
            };
        return {
          ...s,
          tyreState: {
            ...current,
            pendingPit: nextPending,
          },
        };
      });
      return { ...prev, raceState: { ...race, standings: newStandings } };
    });
  }, []);

  const handleChangePendingPitCompound = useCallback((driverId: string, compound: TyreCompound) => {
    setGmState(prev => {
      if (!prev) return prev;
      const race = prev.raceState;
      const newStandings = race.standings.map(s =>
        s.driverId === driverId
          ? {
              ...s,
              tyreState: {
                ...s.tyreState,
                pendingPit: {
                  active: true,
                  compound,
                },
              },
            }
          : s
      );
      return { ...prev, raceState: { ...race, standings: newStandings } };
    });
  }, []);

  const handleAssignTyreSelection = useCallback(
    (driverId: string, compound: TyreCompound) => {
      setGmState(prev => {
        if (!prev) return prev;
        const race = prev.raceState;
        const driver = race.drivers.find(d => d.id === driverId);
        if (!driver) return prev;
        const newStandings = race.standings.map(s => {
          if (s.driverId !== driverId) return s;
          const updatedTyre = assignTyreCompoundForSelection(s.tyreState, driver, race.track, compound);
          return {
            ...s,
            tyreState: updatedTyre,
          };
        });
        return { ...prev, raceState: { ...race, standings: newStandings } };
      });
    },
    []
  );

  const handleChoice = useCallback((value: string) => {
    if (!gmState) return;
    const next = advanceGMState(gmState, value);
    setGmState(next);
  }, [gmState]);

  const handleConfirm = useCallback(() => {
    if (!gmState) return;
    const next = advanceGMState(gmState, 'confirm');
    setGmState(next);
  }, [gmState]);

  const handleAssignDamage = useCallback((driverId: string, newState: DamageState) => {
    if (!gmState) return;
    const race = gmState.raceState;
    const damageState =
      newState === 'dnf'
        ? { state: 'dnf' as const, location: null as const, hasFrontWingDamage: false }
        : newState === 'none'
          ? { state: 'none' as const, location: null as null, hasFrontWingDamage: false }
          : {
              state: newState,
              location: 'other' as const,
              hasFrontWingDamage: false,
            };
    const newStandings = race.standings.map(s =>
      s.driverId === driverId
        ? { ...s, damageState, isDNF: newState === 'dnf' }
        : { ...s }
    );
    const newRaceState = { ...race, standings: newStandings };
    setGmState({ ...gmState, raceState: newRaceState });
  }, [gmState]);

  const handleSetRaceFlag = useCallback((flag: 'green' | 'safetyCar' | 'redFlag') => {
    if (!gmState) return;
    setGmState({
      ...gmState,
      raceState: { ...gmState.raceState, raceFlag: flag },
    });
  }, [gmState]);

  // Commentary: derive a single line for the last resolved contest.
  useEffect(() => {
    if (!gmState) return;
    const log = gmState.raceState.eventLog;
    if (!log || log.length === 0) return;

    let lastIdx = -1;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].type === 'contested_roll') {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1 || lastIdx === lastContestIndex) return;

    const contested = log[lastIdx];
    const desc: string = contested.description;
    const match = desc.match(/^(.+?): d20.* vs (.+?): d20.* → (OVERTAKE|DEFENDED)$/);
    if (!match) {
      setLastContestIndex(lastIdx);
      return;
    }
    const attackerName = match[1];
    const defenderName = match[2];
    const resultWord = match[3]; // 'OVERTAKE' | 'DEFENDED'

    // Scan events after this contested roll to refine outcome.
    const after = log.slice(lastIdx + 1);
    let category: 'overtake' | 'defense' | 'majorDamage' | 'minorDamage' | 'clean' | 'mechanical' =
      resultWord === 'OVERTAKE' ? 'overtake' : 'defense';

    for (const e of after) {
      if (e.type === 'damage') {
        const d = String(e.description).toLowerCase();
        if (d.includes('mechanical dnf') || d.includes('engine failure') || d.includes('mechanical failure')) {
          category = 'mechanical';
          break;
        }
        if (d.includes('major') || d.includes('dnf')) {
          category = 'majorDamage';
          break;
        }
        category = 'minorDamage';
        break;
      }
      if (e.type === 'awareness') {
        const d = String(e.description).toLowerCase();
        if (d.includes('clean racing')) {
          category = 'clean';
          // keep scanning for possible subsequent damage; only break if we never see damage.
        }
      }
    }

    const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    const overtakeLines: string[] = [
      'The overtaking driver dives to the inside at Sainte Devote—and this time it sticks! The defending driver has to yield!',
      'Out of Portier, the overtaking driver gets the perfect exit and blasts through the Tunnel to complete the move before the Nouvelle Chicane!',
      'Late on the brakes into the Nouvelle Chicane—the overtaking driver commits fully and makes it work!',
      'Around the outside at Casino Square! The overtaking driver pulls off something truly special at Monaco!',
      'The overtaking driver forces the defending driver narrow at Mirabeau and slips through on the exit!',
      'A brilliant switchback at the Loews Hairpin—the overtaking driver gets superior traction and completes the pass!',
      'Through the Tunnel in the slipstream, the overtaking driver draws alongside and seals it into the chicane!',
      'A bold lunge into Rascasse—the overtaking driver muscles past and claims the position!',
      'The overtaking driver keeps the pressure on through the Swimming Pool and capitalizes on a tiny mistake from the defending driver!',
      'Side by side into Sainte Devote, but the overtaking driver holds the inside line and emerges ahead!',
      'The overtaking driver sells the dummy at Mirabeau, cuts back underneath, and takes the place cleanly!',
      'A stunning move at Tabac! The overtaking driver commits to the outside and makes it stick!',
      'The overtaking driver positions perfectly through Casino and powers past before the braking zone!',
      'Into the final corner, the overtaking driver gets the traction and drags past the defending driver across the line!',
      'The overtaking driver stays patient all lap long, then strikes decisively at the Nouvelle Chicane to secure the overtake!',
    ];

    const defenseLines: string[] = [
      'The overtaking driver dives to the inside at Sainte Devote, but the defending driver shuts the door just in time!',
      'The overtaking driver gets a better launch out of Portier and pulls alongside into the Tunnel—can he make it stick? No! The defending driver holds firm.',
      'Late on the brakes into the Nouvelle Chicane! The overtaking driver throws it in, but the defending driver keeps the apex.',
      'The overtaking driver pressures through Casino Square, but the defending driver places the car perfectly on exit.',
      'Wheel-to-wheel into Mirabeau—yet the defending driver calmly squeezes the overtaking driver out.',
      'The overtaking driver shows the nose at the Loews Hairpin, but there’s simply no room at Monaco!',
      'Through the Tunnel they go, the overtaking driver tucked right under the rear wing of the defending driver.',
      'The overtaking driver lunges into Rascasse! That’s brave—but the defending driver cuts back on exit!',
      'Brilliant defense from the defending driver at the Swimming Pool, denying the overtaking driver any overlap.',
      'The overtaking driver tries the outside line at Casino—ambitious stuff—but the defending driver forces him wide.',
      'The defending driver parks it on the apex at Sainte Devote, frustrating the overtaking driver yet again.',
      'The overtaking driver gets a run down to the Nouvelle Chicane—this could be the move! Not quite, the defending driver brakes impossibly late.',
      'Side by side into Mirabeau Haute, but the defending driver keeps the inside covered.',
      'The overtaking driver switches back at Portier, looking for traction into the Tunnel!',
      'Through Tabac, the overtaking driver edges closer, but the defending driver refuses to blink.',
      'The overtaking driver shapes up for a dive at Rascasse—no, he thinks better of it as the defending driver guards the line.',
      'The defending driver exits the Swimming Pool flawlessly, denying the overtaking driver momentum.',
      'Into the Tunnel, the overtaking driver is in the slipstream, but the defending driver positions the car perfectly for the chicane.',
      'The overtaking driver commits around the outside at the Nouvelle Chicane! That’s sensational—but the defending driver hangs on!',
      'The defending driver covers the inside at Mirabeau, forcing the overtaking driver to back out.',
      'The overtaking driver nearly draws alongside at the Loews Hairpin, but there’s just not enough road.',
      'The defending driver brushes the barrier at Tabac but still keeps the overtaking driver behind!',
      'Into Rascasse they go—the overtaking driver tries the switchback, but the defending driver powers out cleanly.',
      'The overtaking driver shows incredible patience behind the defending driver through the tight final sector.',
      'The defending driver makes the car as wide as possible through Sainte Devote, denying the overtaking driver any gap.',
      'Through the final corner, the overtaking driver gets the better traction, but the defending driver edges ahead across the line!',
    ];

    const majorDamageLines: string[] = [
      'The overtaking driver dives into Sainte Devote but clips the rear of the defending driver—huge impact and both cars slam into the barriers!',
      'Into the Nouvelle Chicane, the overtaking driver locks up and makes heavy contact with the defending driver—front wing destroyed and debris everywhere!',
      'Side by side through the Swimming Pool—there’s no space! The overtaking driver touches the barrier and collects the defending driver in a massive crash!',
      'The overtaking driver attempts a bold move at Rascasse, but the defending driver turns in—major collision and both cars are out on the spot!',
      'Through Casino Square, the overtaking driver loses the rear under pressure and smashes into the defending driver—serious suspension damage for both!',
    ];

    const minorDamageLines: string[] = [
      'The overtaking driver taps the rear of the defending driver at Mirabeau—small front wing damage but the fight continues.',
      'Light contact at the Loews Hairpin as the overtaking driver nudges the defending driver—endplate missing but both continue.',
      'The defending driver squeezes the overtaking driver at Tabac—there’s a brush with the wall and slight rear damage.',
      'Into Sainte Devote, the overtaking driver locks up and clips the defending driver—minor floor damage reported.',
      'The overtaking driver makes slight wheel-to-wheel contact at the Nouvelle Chicane—both pick up cosmetic damage but stay racing.',
    ];

    const cleanLines: string[] = [
      'The overtaking driver lunges far too late into Rascasse and nearly spears into the defending driver—stewards will look at that one.',
      'The defending driver moves under braking into the Nouvelle Chicane, forcing the overtaking driver to take evasive action!',
      'The overtaking driver attempts a move at Casino from too far back—almost launching over the defending driver’s rear wheel!',
      'Through the Tunnel, the defending driver weaves aggressively, breaking the overtaking driver’s momentum.',
      'The overtaking driver pushes the defending driver toward the barrier at the Swimming Pool—very dangerous positioning there.',
    ];

    const mechanicalLines: string[] = [
      'The overtaking driver was lining up a move into Sainte Devote, but suddenly slows—engine failure! That’s race over in heartbreaking fashion.',
      'The defending driver exits the Tunnel ahead, but smoke pours from the rear—mechanical failure ends the battle instantly!',
    ];

    let template: string;
    switch (category) {
      case 'majorDamage':
        template = pickRandom(majorDamageLines);
        break;
      case 'minorDamage':
        template = pickRandom(minorDamageLines);
        break;
      case 'clean':
        template = pickRandom(cleanLines);
        break;
      case 'mechanical':
        template = pickRandom(mechanicalLines);
        break;
      case 'defense':
        template = pickRandom(defenseLines);
        break;
      case 'overtake':
      default:
        template = pickRandom(overtakeLines);
        break;
    }

    const withNames = template
      .replace(/the overtaking driver/gi, attackerName)
      .replace(/the defending driver/gi, defenderName);

    setCommentary(withNames);
    setLastContestIndex(lastIdx);
  }, [gmState, lastContestIndex]);

  const handleSaveRace = useCallback(() => {
    if (!gmState) return;
    const race = gmState.raceState;
    if (!race.isComplete) return;
    const createdAt = Date.now();
    const standingsWithMeta = race.standings
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(s => {
        const driver = race.drivers.find(d => d.id === s.driverId) ?? null;
        const team = driver ? teams.find(t => t.id === driver.teamId) ?? null : null;
        return {
          driverId: s.driverId,
          driverName: driver?.name ?? s.driverId,
          teamId: team?.id ?? null,
          teamName: team?.name ?? null,
          position: s.position,
          isDNF: s.isDNF,
        };
      });
    const summary: SavedRaceSummary = {
      id: `gm-${track.id}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      mode: 'gm',
      trackId: track.id,
      trackName: track.name,
      totalLaps: race.totalLaps,
      standings: standingsWithMeta,
    };
    addRaceToHistory(summary);
    setHasSavedCurrentRace(true);
  }, [addRaceToHistory, gmState, teams, track.id, track.name]);

  const handleStandingsDragStart = useCallback((driverId: string) => {
    return (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData('text/plain', driverId);
      event.dataTransfer.effectAllowed = 'move';
    };
  }, []);

  const handleStandingsDrop = useCallback((targetDriverId: string) => {
    return (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sourceDriverId = event.dataTransfer.getData('text/plain');
      if (!gmState || !sourceDriverId || sourceDriverId === targetDriverId) return;

      const race = gmState.raceState;
      const currentOrder = [...race.standings]
        .sort((a, b) => a.position - b.position)
        .map(s => s.driverId);

      const fromIndex = currentOrder.indexOf(sourceDriverId);
      const toIndex = currentOrder.indexOf(targetDriverId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const nextOrder = [...currentOrder];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);

      const nextRaceState = reorderGridWithEvent(race, nextOrder);
      setGmState({ ...gmState, raceState: nextRaceState });
    };
  }, [gmState]);

  if (!isStarted) {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg">🎲 GM Tabletop Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Track: <span className="font-medium text-foreground">{track.name}</span> · Default{' '}
            <span className="font-mono">{track.lapCount}</span> laps · {drivers.length} drivers
          </p>
          <div className="space-y-1 max-w-xs">
            <label className="text-xs font-medium text-foreground" htmlFor="gm-lap-count">
              Number of Laps
            </label>
            <Input
              id="gm-lap-count"
              type="number"
              min={MIN_LAPS}
              max={MAX_LAPS}
              value={lapInput}
              onChange={e => {
                const next = e.target.value;
                setLapInput(next);
                const { valid, error } = validateLapCount(next);
                setLapError(valid ? null : error ?? 'Invalid lap count.');
              }}
            />
            {lapError && (
              <p className="text-xs text-destructive">
                {lapError}
              </p>
            )}
            {!lapError && hasMissingTeamTrait && (
              <p className="text-xs text-destructive">
                All teams must have a trait selected before starting a race.
              </p>
            )}
          </div>
          {/* Starting compounds & simple strategy */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">
              Starting Tyres & Strategy
            </p>
            <div className="border rounded-md p-2 max-h-64 overflow-y-auto space-y-2">
              {drivers.map(driver => {
                const start = startingCompounds[driver.id];
                const rows = strategy[driver.id] ?? [];
                return (
                  <div key={driver.id} className="space-y-1 border-b last:border-b-0 pb-1 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{driver.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">Start:</span>
                        <select
                          className="border rounded px-1 py-0.5 text-[11px] bg-background"
                          value={start ?? ''}
                          onChange={e =>
                            setStartingCompounds(prev => ({
                              ...prev,
                              [driver.id]: (e.target.value || null) as TyreCompound | null,
                            }))
                          }
                        >
                          <option value="">Select</option>
                          <option value="soft">Soft</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                          <option value="intermediate">Inter</option>
                          <option value="wet">Wet</option>
                        </select>
                        {start && (
                          <Badge variant="outline" className={cn('text-[10px] py-0', COMPOUND_BADGE_CLASS[start])}>
                            {start}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {[0, 1, 2].map(idx => {
                      const row = rows[idx] ?? { nextCompound: null, laps: '' };
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 pl-4"
                        >
                          <span className="text-[11px] text-muted-foreground">
                            Planned stint {idx + 1} (optional):
                          </span>
                          <div className="flex items-center gap-2">
                            <select
                              className="border rounded px-1 py-0.5 text-[11px] bg-background"
                              value={row.nextCompound ?? ''}
                              onChange={e =>
                                setStrategy(prev => {
                                  const current = prev[driver.id] ?? [
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                  ];
                                  const updated = [...current];
                                  updated[idx] = {
                                    nextCompound: (e.target.value || null) as TyreCompound | null,
                                    laps: row.laps,
                                  };
                                  return { ...prev, [driver.id]: updated };
                                })
                              }
                            >
                              <option value="">Next tyre</option>
                              <option value="soft">Soft</option>
                              <option value="medium">Medium</option>
                              <option value="hard">Hard</option>
                              <option value="intermediate">Inters</option>
                              <option value="wet">Wets</option>
                            </select>
                            <Input
                              type="number"
                              className="w-20 h-7 text-[11px]"
                              placeholder="Laps"
                              value={row.laps}
                              onChange={e =>
                                setStrategy(prev => {
                                  const current = prev[driver.id] ?? [
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                    { nextCompound: null as TyreCompound | null, laps: '' },
                                  ];
                                  const updated = [...current];
                                  updated[idx] = {
                                    nextCompound: row.nextCompound,
                                    laps: e.target.value,
                                  };
                                  return { ...prev, [driver.id]: updated };
                                })
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {strategyError && (
              <p className="text-xs text-destructive">
                {strategyError}
              </p>
            )}
          </div>
          <Button
            onClick={startRace}
            className="w-full"
            disabled={drivers.length === 0 || !!lapError || hasMissingTeamTrait}
          >
            Start Race
          </Button>
          {drivers.length === 0 && (
            <p className="text-xs text-destructive">
              Select at least one driver before starting a race.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!gmState) return null;

  const race = gmState.raceState;
  const prompt = gmState.pendingPrompt;
  const awaitingSelectionDrivers = race.standings.filter(s => s.tyreState.awaitingTyreSelection);
  const isRaceLockedForTyres = awaitingSelectionDrivers.length > 0;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline">Lap {race.currentLap}/{race.totalLaps}</Badge>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Badge
              variant={race.raceFlag === 'green' ? 'default' : 'destructive'}
              className="cursor-context-menu"
            >
              {race.raceFlag === 'green' ? '🟢 Green' : race.raceFlag === 'safetyCar' ? '🟡 Safety Car' : '🔴 Red Flag'}
            </Badge>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>Set race flag</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleSetRaceFlag('green')}>
              🟢 Green Flag
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleSetRaceFlag('safetyCar')}>
              🟡 Safety Car
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleSetRaceFlag('redFlag')}>
              🔴 Red Flag
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Badge variant="secondary">{gmState.currentPhase}</Badge>
        {race.isComplete && <Badge className="bg-green-600 text-white">RACE COMPLETE</Badge>}
      </div>

      {/* Current Standings (drag driver name to reorder) */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Current Standings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {race.standings
              .sort((a, b) => a.position - b.position)
              .map(s => {
                const driver = drivers.find(d => d.id === s.driverId);
                const team = driver ? teams.find(t => t.id === driver.teamId) : null;
                const delta = positionDeltas[s.driverId] ?? 0;
                const movedUp = delta < 0;
                const movedDown = delta > 0;
                const hasDelta = movedUp || movedDown;
                return (
                  <ContextMenu key={s.driverId}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={[
                          'flex items-center justify-between px-4 py-2 text-sm cursor-default transition-all duration-500 ease-out',
                          hasDelta ? 'scale-[1.04] bg-primary/10 ring-2 ring-primary/50 shadow-md' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onDragOver={event => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={handleStandingsDrop(s.driverId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold w-10 text-left flex items-center gap-1">
                            <span>
                              P{s.position}
                            </span>
                            {movedUp && (
                              <span className="text-emerald-500 font-semibold text-sm translate-y-[-1px]">
                                ↑
                              </span>
                            )}
                            {movedDown && (
                              <span className="text-red-500 font-semibold text-sm translate-y-[-1px]">
                                ↓
                              </span>
                            )}
                          </span>
                          <div
                            draggable
                            onDragStart={handleStandingsDragStart(s.driverId)}
                            className="cursor-move"
                            title="Drag to manually reorder this driver"
                          >
                            <DriverNameWithTeamColors
                              driver={driver ?? null}
                              team={team ?? null}
                              nameFallback={s.driverId}
                              nameClassName={s.isDNF ? 'line-through text-muted-foreground' : ''}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn('text-xs', COMPOUND_BADGE_CLASS[s.tyreState.compound])}
                            >
                              {formatTyreLabel(race.track, s.tyreState.compound, s.tyreState.currentLap)}
                            </Badge>
                            {s.damageState.state !== 'none' && (
                              <Badge variant="destructive" className="text-xs">
                                {s.damageState.state}
                              </Badge>
                            )}
                            {s.isDNF && (
                              <Badge variant="destructive" className="text-xs">
                                DNF
                              </Badge>
                            )}
                            {s.pitCount > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {s.pitCount} pit
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[11px]">
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={s.tyreState.pendingPit.active}
                                onChange={e =>
                                  handleTogglePendingPit(s.driverId, e.target.checked)
                                }
                              />
                              <span>PIT</span>
                            </label>
                            {s.tyreState.pendingPit.active && (
                              <select
                                className="border rounded px-1 py-0.5 text-[11px] bg-background"
                                value={s.tyreState.pendingPit.compound ?? s.tyreState.compound}
                                onChange={e =>
                                  handleChangePendingPitCompound(
                                    s.driverId,
                                    e.target.value as TyreCompound
                                  )
                                }
                              >
                                <option value="soft">Pit for Softs</option>
                                <option value="medium">Pit for Mediums</option>
                                <option value="hard">Pit for Hards</option>
                                <option value="intermediate">Pit for Inters</option>
                                <option value="wet">Pit for Wets</option>
                              </select>
                            )}
                          </div>
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuLabel>Set damage</ContextMenuLabel>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => handleAssignDamage(s.driverId, 'none')}>
                        None
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleAssignDamage(s.driverId, 'minor')}>
                        Minor
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleAssignDamage(s.driverId, 'major')}>
                        Major
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleAssignDamage(s.driverId, 'dnf')}>
                        DNF
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Commentary card */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Commentary</CardTitle>
        </CardHeader>
        <CardContent>
          {commentary ? (
            <p className="text-sm leading-relaxed">{commentary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No contest has been resolved yet. Commentary will appear here after the next overtake attempt.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Live race event feed */}
      <LiveRaceEventFeed
        events={race.liveEvents ?? []}
        drivers={drivers}
        teams={teams}
      />

      {/* Tyre selection lock (post-puncture) */}
      {isRaceLockedForTyres && (
        <Card className="border-yellow-500/60 bg-yellow-500/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Tyre Selection Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Driver must select new tyre compound before the race can continue.
            </p>
            <div className="space-y-2">
              {awaitingSelectionDrivers.map(s => {
                const driver = drivers.find(d => d.id === s.driverId);
                const name = driver?.name ?? s.driverId;
                const current = s.tyreState.compound;
                return (
                  <div key={s.driverId} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{name}</span>
                    <div className="flex items-center gap-2">
                      <select
                        className="border rounded px-1 py-0.5 text-[11px] bg-background"
                        value={current}
                        onChange={e =>
                          handleAssignTyreSelection(
                            s.driverId,
                            e.target.value as TyreCompound
                          )
                        }
                      >
                        <option value="soft">Soft</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                        <option value="intermediate">Inter</option>
                        <option value="wet">Wet</option>
                      </select>
                      <Badge variant="outline" className={cn('text-[10px] py-0', COMPOUND_BADGE_CLASS[current])}>
                        {current}
                      </Badge>
                    </div>
                  </div>
                );
              })}
              {awaitingSelectionDrivers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No drivers currently awaiting tyre selection.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* GM Prompt */}
      {prompt && !race.isComplete && !isRaceLockedForTyres && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">GM Action Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{prompt.description}</p>

            {prompt.inputType === 'roll' && (
              <div className="space-y-2">
                {(prompt.context?.activationOptions as ActivationOption[])?.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-muted-foreground self-center">Activate trait:</span>
                    {(prompt.context.activationOptions as ActivationOption[]).map((opt) => {
                      const activated = (prompt.context?.activatedTraits as { attacker?: string[]; defender?: string[] })?.[opt.forRole]?.includes(opt.traitId) ?? false;
                      return (
                        <Button
                          key={`${opt.traitId}-${opt.forRole}`}
                          size="sm"
                          variant={activated ? 'default' : 'outline'}
                          disabled={activated}
                          onClick={() => !activated && handleChoice(`activate:${opt.traitId}:${opt.forRole}`)}
                        >
                          {opt.name} ({opt.forRole}){activated ? ' ✓' : ''}
                        </Button>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={prompt.diceSize}
                    placeholder={`1-${prompt.diceSize}`}
                    value={rollInput}
                    onChange={(e) => setRollInput(e.target.value)}
                    className="w-24"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitRoll()}
                  />
                  <Button size="sm" onClick={handleSubmitRoll}>Submit</Button>
                  <Button size="sm" variant="secondary" onClick={handleAutoRoll}>Auto Roll</Button>
                </div>
              </div>
            )}

            {prompt.inputType === 'choice' && prompt.choices && (
              <div className="flex gap-2 flex-wrap">
                {prompt.choices.map(c => (
                  <Button key={c.value} size="sm" variant="outline" onClick={() => handleChoice(c.value)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            )}

            {prompt.inputType === 'confirm' && (
              <Button size="sm" onClick={handleConfirm}>Continue</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Event Log */}
      <Collapsible defaultOpen className="group">
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0 cursor-pointer hover:bg-muted/50 rounded-t-lg transition-colors">
              <CardTitle className="text-sm">Event Log</CardTitle>
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=closed]:rotate-[-90deg]" />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-0">
              <ScrollArea className="h-64">
                <div className="space-y-1 p-4">
                  {race.eventLog.slice().reverse().map((event, i) => (
                    <div key={i} className="text-xs font-mono">
                      <span className="text-muted-foreground">[L{event.lap}]</span>{' '}
                      <span className={
                        event.type === 'contested_roll' ? 'text-blue-500' :
                        event.type === 'damage' ? 'text-red-500' :
                        event.type === 'awareness' ? 'text-yellow-600' :
                        event.type === 'opportunity' ? 'text-green-600' :
                        'text-foreground'
                      }>
                        {event.description}
                      </span>
                    </div>
                  ))}
                  {race.eventLog.length === 0 && (
                    <p className="text-xs text-muted-foreground">No events yet</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {race.isComplete && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={hasSavedCurrentRace}
            onClick={handleSaveRace}
          >
            {hasSavedCurrentRace ? 'Saved to History' : 'Save Race to History'}
          </Button>
        </div>
      )}
    </div>
  );
};

export const GMModePanel = GMModePanelComponent;
