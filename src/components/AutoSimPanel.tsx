import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Car, Track, Team } from '@/types/game';
import { simulateFullRace, type RaceState } from '@/lib/simulation/race-engine';
import { getTrackMatchScore, getTrackCompatibilityModifier } from '@/lib/simulation/track-compatibility';

interface AutoSimPanelProps {
  track: Track;
  drivers: Driver[];
  cars: Car[];
  teams: Team[];
}

const AutoSimPanelComponent = ({ track, drivers, cars, teams }: AutoSimPanelProps) => {
  const [result, setResult] = useState<RaceState | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runSim = useCallback(() => {
    setIsRunning(true);
    // Use setTimeout to allow UI update
    setTimeout(() => {
      const res = simulateFullRace(track, drivers, cars);
      setResult(res);
      setIsRunning(false);
    }, 50);
  }, [track, drivers, cars]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>⚡ Auto Simulation — {track.name}</span>
            <Button size="sm" onClick={runSim} disabled={isRunning || drivers.length === 0}>
              {isRunning ? 'Simulating…' : result ? 'Re-run' : 'Run Simulation'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Final standings */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Final Results</CardTitle>
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
                          <span className={s.isDNF ? 'line-through text-muted-foreground' : ''}>
                            {driver?.name}
                          </span>
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
