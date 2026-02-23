import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Driver, Team } from '@/types/game';
import { INITIAL_DRIVERS, INITIAL_TEAMS } from '@/lib/simulation/data';

type DataContextValue = {
  teams: Team[];
  drivers: Driver[];
  selectedRaceDriverIds: string[] | null;
  setSelectedRaceDriverIds: (value: string[] | null | ((prev: string[] | null) => string[] | null)) => void;
  addTeam: (team: Omit<Team, 'id'>) => Team;
  updateTeam: (id: string, patch: Partial<Omit<Team, 'id'>>) => void;
  deleteTeam: (id: string) => { ok: true } | { ok: false; reason: string };
  addDriver: (driver: Omit<Driver, 'id'>) => Driver;
  updateDriver: (id: string, patch: Partial<Omit<Driver, 'id'>>) => void;
  deleteDriver: (id: string) => void;
  getTeamById: (id: string) => Team | undefined;
  getDriverById: (id: string) => Driver | undefined;
  getDriversByTeamId: (teamId: string) => Driver[];
};

const DataContext = createContext<DataContextValue | null>(null);

function nextId(prefix: string, existing: { id: string }[]): string {
  const max = existing.reduce((acc, e) => {
    const m = e.id.replace(prefix, '');
    const n = parseInt(m, 10);
    return isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `${prefix}${max + 1}`;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [teams, setTeams] = useState<Team[]>(() => [...INITIAL_TEAMS]);
  const [drivers, setDrivers] = useState<Driver[]>(() => [...INITIAL_DRIVERS]);
  const [selectedRaceDriverIds, setSelectedRaceDriverIds] = useState<string[] | null>(null);

  const getTeamById = useCallback(
    (id: string) => teams.find(t => t.id === id),
    [teams]
  );
  const getDriverById = useCallback(
    (id: string) => drivers.find(d => d.id === id),
    [drivers]
  );
  const getDriversByTeamId = useCallback(
    (teamId: string) => drivers.filter(d => d.teamId === teamId),
    [drivers]
  );

  const addTeam = useCallback(
    (team: Omit<Team, 'id'>) => {
      const id = nextId('t', teams);
      const newTeam: Team = { ...team, id };
      setTeams(prev => [...prev, newTeam]);
      return newTeam;
    },
    [teams]
  );

  const updateTeam = useCallback((id: string, patch: Partial<Omit<Team, 'id'>>) => {
    setTeams(prev =>
      prev.map(t => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  const deleteTeam = useCallback(
    (id: string): { ok: true } | { ok: false; reason: string } => {
      const assigned = drivers.some(d => d.teamId === id);
      if (assigned) return { ok: false, reason: 'This team has assigned drivers. Reassign or delete drivers first.' };
      setTeams(prev => prev.filter(t => t.id !== id));
      return { ok: true };
    },
    [drivers]
  );

  const addDriver = useCallback(
    (driver: Omit<Driver, 'id'>) => {
      const id = nextId('d', drivers);
      const newDriver: Driver = { ...driver, id };
      setDrivers(prev => [...prev, newDriver]);
      return newDriver;
    },
    [drivers]
  );

  const updateDriver = useCallback((id: string, patch: Partial<Omit<Driver, 'id'>>) => {
    setDrivers(prev =>
      prev.map(d => (d.id === id ? { ...d, ...patch } : d))
    );
  }, []);

  const deleteDriver = useCallback((id: string) => {
    setDrivers(prev => prev.filter(d => d.id !== id));
    setSelectedRaceDriverIds(prev =>
      prev === null ? null : prev.filter(driverId => driverId !== id)
    );
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      teams,
      drivers,
      selectedRaceDriverIds,
      setSelectedRaceDriverIds,
      addTeam,
      updateTeam,
      deleteTeam,
      addDriver,
      updateDriver,
      deleteDriver,
      getTeamById,
      getDriverById,
      getDriversByTeamId,
    }),
    [
      teams,
      drivers,
      selectedRaceDriverIds,
      addTeam,
      updateTeam,
      deleteTeam,
      addDriver,
      updateDriver,
      deleteDriver,
      getTeamById,
      getDriverById,
      getDriversByTeamId,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
