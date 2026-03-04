import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TRACKS } from '@/lib/simulation/data';
import { buildCarFromTeam, getCarsForDrivers } from '@/lib/simulation/data';
import { paceModifierFromStat, racecraftModifierFromStat, getTrackMatchScore, getTrackCompatibilityModifier } from '@/lib/simulation/track-compatibility';
import { useData } from '@/context/DataContext';
import { GMModePanel } from '@/components/GMModePanel';
import { AutoSimPanel } from '@/components/AutoSimPanel';
import { RaceHistoryPanel } from '@/components/RaceHistoryPanel';
import { DriverSelectionPanel } from '@/components/DriverSelectionPanel';

const Index = () => {
  const [selectedTrackId, setSelectedTrackId] = useState(TRACKS[0].id);
  const {
    teams,
    drivers,
    getTeamById,
    getDriverById,
    selectedRaceDriverIds,
    setSelectedRaceDriverIds,
    raceConfig,
    setRaceConfig,
  } = useData();
  const track = TRACKS.find(t => t.id === selectedTrackId)!;

  // Cars for display: one per team (from team car stats)
  const carsForDisplay = useMemo(
    () => teams.map(buildCarFromTeam),
    [teams]
  );

  // Race drivers and cars: only selected drivers and their teams' cars
  const raceDrivers = useMemo(() => {
    if (!selectedRaceDriverIds || selectedRaceDriverIds.length === 0) return [];
    return selectedRaceDriverIds
      .map(id => getDriverById(id))
      .filter((d): d is NonNullable<typeof d> => d != null);
  }, [selectedRaceDriverIds, getDriverById]);

  const raceCars = useMemo(
    () => getCarsForDrivers(teams, raceDrivers),
    [teams, raceDrivers]
  );

  const showDriverSelection = selectedRaceDriverIds === null;

  // Keep RaceConfig in sync with current track & selected drivers.
  useEffect(() => {
    setRaceConfig(prev => {
      // If track changed or no existing config, reset to track default laps.
      if (!prev || prev.trackId !== selectedTrackId) {
        return {
          trackId: selectedTrackId,
          selectedDrivers: selectedRaceDriverIds ?? [],
          lapCount: track.lapCount,
        };
      }
      // Same track: preserve custom lap count, update selected drivers.
      return {
        ...prev,
        selectedDrivers: selectedRaceDriverIds ?? prev.selectedDrivers,
      };
    });
  }, [selectedTrackId, selectedRaceDriverIds, setRaceConfig, track.lapCount]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-6xl mx-auto">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold tracking-tight">F1 × DnD Race Simulator</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/teams">Teams</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/drivers">Drivers</Link>
            </Button>
            <Select value={selectedTrackId} onValueChange={setSelectedTrackId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRACKS.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Track info */}
        <Card>
          <CardContent className="py-3 flex flex-wrap gap-4 text-sm">
            <div><span className="text-muted-foreground">Primary:</span> <span className="font-medium">{track.primaryCarStat}</span></div>
            <div><span className="text-muted-foreground">Secondary:</span> <span className="font-medium">{track.secondaryCarStat}</span></div>
            <div><span className="text-muted-foreground">Laps:</span> <span className="font-medium">{track.lapCount}</span></div>
            <div><span className="text-muted-foreground">Pit loss:</span> <span className="font-medium">{track.pitLossNormal}</span></div>
            <div><span className="text-muted-foreground">Momentum loss:</span> <span className="font-medium">{track.momentumLossPositions} pos</span></div>
          </CardContent>
        </Card>

        <Tabs defaultValue="drivers" className="space-y-4">
          <TabsList>
            <TabsTrigger value="drivers">Drivers & Cars</TabsTrigger>
            <TabsTrigger value="auto">Auto Sim</TabsTrigger>
            <TabsTrigger value="gm">GM Mode</TabsTrigger>
            <TabsTrigger value="history">Race History</TabsTrigger>
          </TabsList>

          {/* Drivers & Cars tab */}
          <TabsContent value="drivers" className="space-y-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Driver Stats & Track Modifiers — {track.name}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-center">PAC</TableHead>
                      <TableHead className="text-center">QUA</TableHead>
                      <TableHead className="text-center">RAC</TableHead>
                      <TableHead className="text-center">AWR</TableHead>
                      <TableHead className="text-center">ADP</TableHead>
                      <TableHead className="text-center">Car Mod</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drivers.map(driver => {
                      const team = getTeamById(driver.teamId);
                      const car = team ? buildCarFromTeam(team) : null;
                      const carMod = car ? getTrackCompatibilityModifier(car, track) : 0;
                      return (
                        <TableRow key={driver.id}>
                          <TableCell className="font-medium">{driver.name}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{team?.name}</TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.pace} mod={paceModifierFromStat(driver.pace)} carMod={carMod} affected />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.qualifying} mod={0} carMod={0} affected={false} showMod={false} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.racecraft} mod={racecraftModifierFromStat(driver.racecraft)} carMod={carMod} affected />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.awareness} mod={0} carMod={0} affected={false} showMod={false} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.adaptability} mod={0} carMod={0} affected={false} showMod={false} />
                          </TableCell>
                          <TableCell className="text-center">
                            {car && (
                              <Badge variant={carMod >= 0 ? 'default' : 'destructive'} className="text-xs">
                                {carMod >= 0 ? '+' : ''}{carMod}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Cars */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Car Stats & Track Match</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-center">LowSpd</TableHead>
                      <TableHead className="text-center">MedSpd</TableHead>
                      <TableHead className="text-center">HiSpd</TableHead>
                      <TableHead className="text-center">TopSpd</TableHead>
                      <TableHead className="text-center">Accel</TableHead>
                      <TableHead className="text-center">Match Score</TableHead>
                      <TableHead className="text-center">Modifier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {carsForDisplay.map(car => {
                      const team = getTeamById(car.teamId);
                      const score = getTrackMatchScore(car, track);
                      const mod = getTrackCompatibilityModifier(car, track);
                      return (
                        <TableRow key={car.id}>
                          <TableCell className="font-medium">{team?.name}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{car.lowSpeedCornering}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{car.mediumSpeedCornering}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{car.highSpeedCornering}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{car.topSpeed}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{car.acceleration}</TableCell>
                          <TableCell className="text-center">
                            <span className="font-mono font-bold">{score}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={mod >= 0 ? 'default' : 'destructive'}>
                              {mod >= 0 ? '+' : ''}{mod}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Auto Sim tab */}
          <TabsContent value="auto" className="space-y-4">
            {showDriverSelection ? (
              <DriverSelectionPanel
                teams={teams}
                drivers={drivers}
                onConfirm={ids => setSelectedRaceDriverIds(ids)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Racing with {raceDrivers.length} driver(s).</span>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSelectedRaceDriverIds(null)}>
                    Change selection
                  </Button>
                </div>
                <AutoSimPanel
                  track={track}
                  drivers={raceDrivers}
                  cars={raceCars}
                  teams={teams}
                  raceConfig={raceConfig}
                  setRaceConfig={setRaceConfig}
                />
              </>
            )}
          </TabsContent>

          {/* GM Mode tab */}
          <TabsContent value="gm" className="space-y-4">
            {showDriverSelection ? (
              <DriverSelectionPanel
                teams={teams}
                drivers={drivers}
                onConfirm={ids => setSelectedRaceDriverIds(ids)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Racing with {raceDrivers.length} driver(s).</span>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSelectedRaceDriverIds(null)}>
                    Change selection
                  </Button>
                </div>
                <GMModePanel
                  key={selectedTrackId}
                  track={track}
                  drivers={raceDrivers}
                  cars={raceCars}
                  teams={teams}
                  raceConfig={raceConfig}
                  setRaceConfig={setRaceConfig}
                />
              </>
            )}
          </TabsContent>

          {/* Race History tab */}
          <TabsContent value="history" className="space-y-4">
            <RaceHistoryPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// Stat display helper. Only Pace and Racecraft show modifiers (overtake roll); others show raw only.
const StatCell = ({ raw, mod, carMod, affected, showMod = true }: { raw: number; mod: number; carMod: number; affected: boolean; showMod?: boolean }) => {
  if (!showMod) {
    return <div className="text-xs"><span className="font-mono">{raw}</span></div>;
  }
  const totalMod = affected ? mod + carMod : mod;
  return (
    <div className="text-xs">
      <span className="font-mono">{raw}</span>
      <span className="text-muted-foreground ml-1">
        ({totalMod >= 0 ? '+' : ''}{totalMod})
      </span>
    </div>
  );
};

export default Index;
