import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Car, Track, RaceConfig, Team } from '@/types/game';
import type { DamageState } from '@/types/game';
import { initGMSession, advanceGMState, type GMState, type ActivationOption } from '@/lib/simulation/gm-engine';
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

  const effectiveLapCount = useMemo(
    () => (raceConfig && raceConfig.trackId === track.id ? raceConfig.lapCount : track.lapCount),
    [raceConfig, track]
  );

  const hasMissingTeamTrait = useMemo(
    () => teams.some(team => !(team.traitId ?? team.trait)),
    [teams]
  );

  useEffect(() => {
    setLapInput(String(effectiveLapCount));
    setLapError(null);
  }, [effectiveLapCount]);

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

    const session = initGMSession(track, drivers, cars, teams, 'medium', value);
    const advanced = advanceGMState(session);
    setGmState(advanced);
    setIsStarted(true);
  }, [cars, drivers, lapInput, setRaceConfig, track, validateLapCount]);

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

      {/* Standings */}
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
                      <div className="flex items-center justify-between px-4 py-2 text-sm cursor-context-menu">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold w-6 text-center">P{s.position}</span>
                          <DriverNameWithTeamColors
                            driver={driver ?? null}
                            team={team ?? null}
                            nameFallback={s.driverId}
                            nameClassName={s.isDNF ? 'line-through text-muted-foreground' : ''}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{s.tyreState.compound}</Badge>
                          {s.damageState.state !== 'none' && (
                            <Badge variant="destructive" className="text-xs">{s.damageState.state}</Badge>
                          )}
                          {s.isDNF && <Badge variant="destructive" className="text-xs">DNF</Badge>}
                          {s.pitCount > 0 && <Badge variant="secondary" className="text-xs">{s.pitCount} pit</Badge>}
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

      {/* GM Prompt */}
      {prompt && !race.isComplete && (
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
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Event Log</CardTitle>
        </CardHeader>
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
      </Card>
    </div>
  );
};

export const GMModePanel = GMModePanelComponent;
