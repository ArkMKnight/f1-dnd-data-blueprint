import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DRIVERS, CARS, TEAMS, TRACKS } from '@/lib/simulation/data';
import { statToModifier, getModifiedDriverStat, getTrackMatchScore, getTrackCompatibilityModifier } from '@/lib/simulation/track-compatibility';
import { GMModePanel } from '@/components/GMModePanel';
import { AutoSimPanel } from '@/components/AutoSimPanel';

const Index = () => {
  const [selectedTrackId, setSelectedTrackId] = useState(TRACKS[0].id);
  const track = TRACKS.find(t => t.id === selectedTrackId)!;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-6xl mx-auto">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold tracking-tight">F1 × DnD Race Simulator</h1>
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
                    {DRIVERS.map(driver => {
                      const team = TEAMS.find(t => t.id === driver.teamId);
                      const car = CARS.find(c => c.teamId === driver.teamId);
                      const carMod = car ? getTrackCompatibilityModifier(car, track) : 0;
                      return (
                        <TableRow key={driver.id}>
                          <TableCell className="font-medium">{driver.name}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{team?.name}</TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.pace} mod={statToModifier(driver.pace)} carMod={carMod} affected />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.qualifying} mod={statToModifier(driver.qualifying)} carMod={carMod} affected />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.racecraft} mod={statToModifier(driver.racecraft)} carMod={carMod} affected />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.awareness} mod={statToModifier(driver.awareness)} carMod={0} affected={false} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatCell raw={driver.adaptability} mod={statToModifier(driver.adaptability)} carMod={0} affected={false} />
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
                    {CARS.map(car => {
                      const team = TEAMS.find(t => t.id === car.teamId);
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
          <TabsContent value="auto">
            <AutoSimPanel track={track} drivers={DRIVERS} cars={CARS} />
          </TabsContent>

          {/* GM Mode tab */}
          <TabsContent value="gm">
            <GMModePanel key={selectedTrackId} track={track} drivers={DRIVERS} cars={CARS} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// Stat display helper
const StatCell = ({ raw, mod, carMod, affected }: { raw: number; mod: number; carMod: number; affected: boolean }) => {
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
