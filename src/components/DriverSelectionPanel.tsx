import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Driver, Team } from '@/types/game';

const MAX_DRIVERS_PER_TEAM = 2;

interface DriverSelectionPanelProps {
  teams: Team[];
  drivers: Driver[];
  onConfirm: (selectedDriverIds: string[]) => void;
  onCancel?: () => void;
}

function getDriversByTeam(drivers: Driver[]): Map<string, Driver[]> {
  const map = new Map<string, Driver[]>();
  for (const d of drivers) {
    const list = map.get(d.teamId) ?? [];
    list.push(d);
    map.set(d.teamId, list);
  }
  return map;
}

export function DriverSelectionPanel({
  teams,
  drivers,
  onConfirm,
  onCancel,
}: DriverSelectionPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const byTeam = useMemo(() => getDriversByTeam(drivers), [drivers]);

  const selectedPerTeam = useMemo(() => {
    const map = new Map<string, number>();
    selectedIds.forEach(id => {
      const d = drivers.find(dr => dr.id === id);
      if (d) map.set(d.teamId, (map.get(d.teamId) ?? 0) + 1);
    });
    return map;
  }, [selectedIds, drivers]);

  const canSelect = (driverId: string) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return false;
    const count = selectedPerTeam.get(driver.teamId) ?? 0;
    if (selectedIds.has(driverId)) return true; // can deselect
    return count < MAX_DRIVERS_PER_TEAM;
  };

  const toggle = (driverId: string) => {
    if (!canSelect(driverId) && !selectedIds.has(driverId)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
  };

  const totalSelected = selectedIds.size;
  const canConfirm = totalSelected > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm([...selectedIds]);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="py-3">
        <CardTitle className="text-lg">Select Drivers for Race</CardTitle>
        <p className="text-sm text-muted-foreground">
          Max {MAX_DRIVERS_PER_TEAM} drivers per team. Total selected: <strong>{totalSelected}</strong>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-[min(60vh,400px)] pr-4">
          <div className="space-y-6">
            {teams.map(team => {
              const teamDrivers = byTeam.get(team.id) ?? [];
              if (teamDrivers.length === 0) return null;
              const count = selectedPerTeam.get(team.id) ?? 0;
              return (
                <div key={team.id} className="space-y-2">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <span
                      className="inline-block w-4 h-4 rounded shrink-0"
                      style={{ backgroundColor: team.primaryColor }}
                    />
                    {team.name}
                    <span className="text-muted-foreground font-normal">
                      ({count}/{MAX_DRIVERS_PER_TEAM} selected)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 pl-6">
                    {teamDrivers.map(driver => {
                      const checked = selectedIds.has(driver.id);
                      const disabled = !checked && count >= MAX_DRIVERS_PER_TEAM;
                      return (
                        <label
                          key={driver.id}
                          className={`flex items-center gap-2 cursor-pointer text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => toggle(driver.id)}
                          />
                          <span>
                            #{driver.number} {driver.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Confirm selection ({totalSelected} driver{totalSelected !== 1 ? 's' : ''})
          </Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
