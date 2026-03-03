import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Car, Track, RaceConfig, Team, TyreCompound } from '@/types/game';
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
import { assignTyreCompoundForSelection } from '@/lib/simulation/tyre-system';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

/** Background/border shade for tyre compound badges (text colour unchanged). */
const COMPOUND_BADGE_CLASS: Record<TyreCompound, string> = {
  soft: 'bg-red-500/20 border-red-500/50',
  medium: 'bg-amber-500/20 border-amber-500/50',
  hard: 'bg-stone-200/80 dark:bg-stone-500/30 border-stone-400/50 dark:border-stone-500/50',
  intermediate: 'bg-green-500/20 border-green-500/50',
  wet: 'bg-blue-500/20 border-blue-500/50',
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
    setGmState(advanced);
    setIsStarted(true);
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
        <Badge variant={race.raceFlag === 'green' ? 'default' : 'destructive'}>
          {race.raceFlag === 'green' ? '🟢 Green' : race.raceFlag === 'safetyCar' ? '🟡 Safety Car' : '🔴 Red Flag'}
        </Badge>
        <Badge variant="secondary">{gmState.currentPhase}</Badge>
        {race.isComplete && <Badge className="bg-green-600 text-white">RACE COMPLETE</Badge>}
      </div>

      {/* Standings (drag driver name to reorder) */}
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
                return (
                  <ContextMenu key={s.driverId}>
                    <ContextMenuTrigger asChild>
                      <div
                        className="flex items-center justify-between px-4 py-2 text-sm cursor-default"
                        onDragOver={event => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={handleStandingsDrop(s.driverId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold w-6 text-center">P{s.position}</span>
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
                            <Badge variant="outline" className={cn('text-xs', COMPOUND_BADGE_CLASS[s.tyreState.compound])}>
                              {s.tyreState.compound}
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

      {/* Live race event feed (above dice rolling section) */}
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
    </div>
  );
};

export const GMModePanel = GMModePanelComponent;
