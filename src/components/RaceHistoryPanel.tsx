import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useData } from '@/context/DataContext';

export const RaceHistoryPanel = () => {
  const { raceHistory, deleteRaceFromHistory } = useData();

  const sorted = useMemo(
    () => [...raceHistory].sort((a, b) => b.createdAt - a.createdAt),
    [raceHistory]
  );

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Race History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No races have been saved yet. Run a race and use &quot;Save to History&quot; to store it here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 flex items-center justify-between">
        <CardTitle className="text-sm">Race History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-80">
          <div className="divide-y">
            {sorted.map(race => (
              <div key={race.id} className="px-4 py-3 text-sm flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{race.trackName}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {race.mode === 'auto' ? 'Auto Sim' : 'GM Mode'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(race.createdAt).toLocaleString()}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => deleteRaceFromHistory(race.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Laps: {race.totalLaps}</span>
                  <span>
                    Top 3:{' '}
                    {race.standings
                      .slice()
                      .sort((a, b) => a.position - b.position)
                      .slice(0, 3)
                      .map(s => `${s.position === 1 ? 'P1' : `P${s.position}`}: ${s.driverName}`)
                      .join(' · ')}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                  {race.standings
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map(s => (
                      <div key={s.driverId} className="flex items-center gap-1">
                        <span className="font-mono w-6 text-center">
                          {s.isDNF ? '—' : `P${s.position}`}
                        </span>
                        <span className={s.isDNF ? 'line-through' : ''}>{s.driverName}</span>
                        {s.teamName && (
                          <span className="text-[10px] text-muted-foreground">
                            ({s.teamName})
                          </span>
                        )}
                        {s.isDNF && (
                          <Badge variant="destructive" className="ml-1 px-1 py-0 text-[9px]">
                            DNF
                          </Badge>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

