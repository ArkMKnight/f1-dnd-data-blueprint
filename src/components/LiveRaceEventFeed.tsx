import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Team, RaceEvent } from '@/types/game';
import { DriverNameWithTeamColors } from './DriverNameWithTeamColors';

interface LiveRaceEventFeedProps {
  events: RaceEvent[];
  drivers: Driver[];
  teams: Team[];
}

export const LiveRaceEventFeed = ({ events, drivers, teams }: LiveRaceEventFeedProps) => {
  const ordered = [...events].sort((a, b) => {
    if (a.lapNumber !== b.lapNumber) return b.lapNumber - a.lapNumber;
    return b.timestamp - a.timestamp;
  });

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-semibold tracking-tight">
          Live Race Events
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-24">
          <div className="space-y-1 p-2">
            {ordered.length === 0 ? (
              <p className="text-xs text-muted-foreground">No race events yet.</p>
            ) : (
              ordered.map(event => {
                const primaryDriver = drivers.find(d => d.id === event.primaryDriverId);
                const secondaryDriver = event.secondaryDriverId
                  ? drivers.find(d => d.id === event.secondaryDriverId)
                  : null;
                const primaryTeam = primaryDriver
                  ? teams.find(t => t.id === primaryDriver.teamId)
                  : null;
                const secondaryTeam = secondaryDriver
                  ? teams.find(t => t.id === secondaryDriver.teamId)
                  : null;

                return (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Lap {event.lapNumber}
                    </span>
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <DriverNameWithTeamColors
                        driver={primaryDriver}
                        team={primaryTeam}
                        nameFallback="Unknown"
                        nameClassName="truncate"
                      />
                      {secondaryDriver && (
                        <>
                          <span className="text-muted-foreground">vs</span>
                          <DriverNameWithTeamColors
                            driver={secondaryDriver}
                            team={secondaryTeam}
                            nameFallback="Unknown"
                            nameClassName="truncate"
                          />
                        </>
                      )}
                    </div>
                    <span className="text-[10px] text-right text-muted-foreground max-w-[40%] truncate">
                      {event.description}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

