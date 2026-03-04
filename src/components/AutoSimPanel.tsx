import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Car, Track, Team, RaceConfig, TyreCompound, SavedRaceSummary } from '@/types/game';
import { simulateFullRace, type RaceState } from '@/lib/simulation/race-engine';
import { getTrackMatchScore, getTrackCompatibilityModifier } from '@/lib/simulation/track-compatibility';
import { DriverNameWithTeamColors } from '@/components/DriverNameWithTeamColors';
import { LiveRaceEventFeed } from '@/components/LiveRaceEventFeed';
import { useData } from '@/context/DataContext';

interface AutoSimPanelProps {
  track: Track;
  drivers: Driver[];
  cars: Car[];
  teams: Team[];
  raceConfig: RaceConfig | null;
  setRaceConfig: (value: RaceConfig | null | ((prev: RaceConfig | null) => RaceConfig | null)) => void;
}

const MIN_LAPS = 1;
const MAX_LAPS = 200;

const AutoSimPanelComponent = ({ track, drivers, cars, teams, raceConfig, setRaceConfig }: AutoSimPanelProps) => {
  const [result, setResult] = useState<RaceState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasSavedCurrentResult, setHasSavedCurrentResult] = useState(false);
  const { addRaceToHistory } = useData();

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

  const [lapInput, setLapInput] = useState<string>(() => String(effectiveLapCount));
  const [lapError, setLapError] = useState<string | null>(null);

  useEffect(() => {
    setLapInput(String(effectiveLapCount));
    setLapError(null);
  }, [effectiveLapCount]);

  useEffect(() => {
    // Reset starting compounds & strategy when driver set changes
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
  }, [drivers]);

  const hasMissingTeamTrait = useMemo(
    () => teams.some(team => !(team.traitId ?? team.trait)),
    [teams]
  );

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

  const runSim = useCallback(() => {
    const { valid, value, error } = validateLapCount(lapInput);
    if (!valid || value === undefined) {
      setLapError(error ?? 'Invalid lap count.');
      return;
    }
    setLapError(null);

    // Require starting compound and at least one valid planned stop per driver
    const missingStarting: string[] = [];
    const missingStrategy: string[] = [];
    const startingMap: Record<string, TyreCompound> = {};
    const plannedPits: Record<string, { lap: number; compound: TyreCompound }[]> = {};

    drivers.forEach(d => {
      const sc = startingCompounds[d.id];
      if (!sc) {
        missingStarting.push(d.name);
      } else {
        startingMap[d.id] = sc;
      }

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
      if (stops.length === 0) {
        missingStrategy.push(d.name);
      }
    });

    if (missingStarting.length > 0 || missingStrategy.length > 0) {
      setStrategyError('All drivers must have a starting compound and at least one planned stop.');
      return;
    }
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

    setIsRunning(true);
    setHasSavedCurrentResult(false);
    // Use setTimeout to allow UI update
    setTimeout(() => {
      const res = simulateFullRace(
        track,
        drivers,
        cars,
        'medium',
        value,
        teams,
        startingMap,
        plannedPits
      );
      setResult(res);
      setIsRunning(false);
    }, 50);
  }, [drivers, cars, teams, lapInput, setRaceConfig, startingCompounds, strategy, track, validateLapCount]);

  const handleSaveResult = useCallback(() => {
    if (!result) return;
    const createdAt = Date.now();
    const standingsWithMeta = result.standings
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(s => {
        const driver = drivers.find(d => d.id === s.driverId) ?? null;
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
      id: `auto-${track.id}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      mode: 'auto',
      trackId: track.id,
      trackName: track.name,
      totalLaps: result.totalLaps,
      standings: standingsWithMeta,
    };
    addRaceToHistory(summary);
    setHasSavedCurrentResult(true);
  }, [addRaceToHistory, drivers, result, teams, track.id, track.name]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>⚡ Auto Simulation — {track.name}</span>
            <Button
              size="sm"
              onClick={runSim}
              disabled={isRunning || drivers.length === 0 || !!lapError || hasMissingTeamTrait}
            >
              {isRunning ? 'Simulating…' : result ? 'Re-run' : 'Run Simulation'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{track.name}</span>{' '}
              · Default laps: <span className="font-mono">{track.lapCount}</span>
            </p>
            <div className="flex flex-col gap-1 max-w-xs">
              <label className="text-xs font-medium text-foreground" htmlFor="auto-sim-lap-count">
                Number of Laps
              </label>
              <input
                id="auto-sim-lap-count"
                type="number"
                min={MIN_LAPS}
                max={MAX_LAPS}
                className="border rounded px-2 py-1 text-sm bg-background"
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
              {strategyError && !lapError && !hasMissingTeamTrait && (
                <p className="text-xs text-destructive">
                  {strategyError}
                </p>
              )}
            </div>
          </div>
          {/* Track compatibility overview */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {teams.map(team => {
              const car = cars.find(c => c.teamId === team.id);
              if (!car) return null;
              const score = getTrackMatchScore(car, track);
              const mod = getTrackCompatibilityModifier(car, track);
              return (
                <div key={team.id} className="text-xs p-2 rounded bg-muted">
                  <span className="font-medium">{team.name}</span>
                  <div className="text-muted-foreground">
                    Score: {score} → {mod >= 0 ? '+' : ''}{mod}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Starting compounds & compulsory strategy for Auto Sim */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">
              Starting Tyres & Strategy (Auto Sim)
            </p>
            <p className="text-[11px] text-muted-foreground">
              All drivers must have a starting compound and at least one planned stop before running the simulation.
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
                      </div>
                    </div>
                    {[0, 1, 2].map(idx => {
                      const row = rows[idx] ?? { nextCompound: null as TyreCompound | null, laps: '' };
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 pl-4"
                        >
                          <span className="text-[11px] text-muted-foreground">
                            Planned stint {idx + 1}:
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
                            <input
                              type="number"
                              className="border rounded px-1 py-0.5 text-[11px] bg-background w-20 h-7 text-[11px]"
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
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Live race event summary */}
          <LiveRaceEventFeed
            events={result.liveEvents ?? []}
            drivers={drivers}
            teams={teams}
          />

          {/* Final standings */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Final Results</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={hasSavedCurrentResult}
                  onClick={handleSaveResult}
                >
                  {hasSavedCurrentResult ? 'Saved to History' : 'Save to History'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {result.standings
                  .sort((a, b) => a.position - b.position)
                  .map((s, i) => {
                    const driver = drivers.find(d => d.id === s.driverId);
                    const team = teams.find(t => t.id === driver?.teamId);
                    return (
                      <div key={s.driverId} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold w-6 text-center">
                            {s.isDNF ? '—' : `P${s.position}`}
                          </span>
                          <DriverNameWithTeamColors
                            driver={driver ?? null}
                            team={team ?? null}
                            nameFallback={s.driverId}
                            nameClassName={s.isDNF ? 'line-through text-muted-foreground' : ''}
                          />
                          <span className="text-xs text-muted-foreground">{team?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.isDNF && <Badge variant="destructive" className="text-xs">DNF</Badge>}
                          {s.damageState.state !== 'none' && !s.isDNF && (
                            <Badge variant="destructive" className="text-xs">{s.damageState.state}</Badge>
                          )}
                          {s.pitCount > 0 && <Badge variant="secondary" className="text-xs">{s.pitCount} stop</Badge>}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

          {/* Event log */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Race Log ({result.eventLog.length} events)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-80">
                <div className="space-y-1 p-4">
                  {result.eventLog.map((event, i) => (
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
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export const AutoSimPanel = AutoSimPanelComponent;
