import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Driver, Team, RaceConfig, SavedRaceSummary } from '@/types/game';
import { INITIAL_DRIVERS, INITIAL_TEAMS } from '@/lib/simulation/data';

type DataContextValue = {
  teams: Team[];
  drivers: Driver[];
  raceHistory: SavedRaceSummary[];
  selectedRaceDriverIds: string[] | null;
  setSelectedRaceDriverIds: (value: string[] | null | ((prev: string[] | null) => string[] | null)) => void;
  raceConfig: RaceConfig | null;
  setRaceConfig: (value: RaceConfig | null | ((prev: RaceConfig | null) => RaceConfig | null)) => void;
  addTeam: (team: Omit<Team, 'id'>) => Team;
  updateTeam: (id: string, patch: Partial<Omit<Team, 'id'>>) => void;
  deleteTeam: (id: string) => { ok: true } | { ok: false; reason: string };
  addDriver: (driver: Omit<Driver, 'id'>) => Driver;
  updateDriver: (id: string, patch: Partial<Omit<Driver, 'id'>>) => void;
  deleteDriver: (id: string) => void;
  getTeamById: (id: string) => Team | undefined;
  getDriverById: (id: string) => Driver | undefined;
  getDriversByTeamId: (teamId: string) => Driver[];
  addRaceToHistory: (race: SavedRaceSummary) => void;
  deleteRaceFromHistory: (id: string) => void;
};

const DataContext = createContext<DataContextValue | null>(null);

const STORAGE_KEYS = {
  teams: 'f1dnd_teams',
  drivers: 'f1dnd_drivers',
  raceHistory: 'f1dnd_race_history',
} as const;

function safeParseJSON<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function nextId(prefix: string, existing: { id: string }[]): string {
  const max = existing.reduce((acc, e) => {
    const m = e.id.replace(prefix, '');
    const n = parseInt(m, 10);
    return isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `${prefix}${max + 1}`;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [teams, setTeams] = useState<Team[]>(() => {
    return INITIAL_TEAMS.map(t => ({
      ...t,
      traitId: t.traitId ?? t.trait ?? null,
    }));
  });
  const [drivers, setDrivers] = useState<Driver[]>(() => {
    return INITIAL_DRIVERS.map(d => ({
      ...d,
      traitId: d.traitId ?? d.trait ?? null,
    }));
  });
  const [raceHistory, setRaceHistory] = useState<SavedRaceSummary[]>(() =>
    safeParseJSON<SavedRaceSummary[]>(typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEYS.raceHistory) : null, [])
  );
  const [selectedRaceDriverIds, setSelectedRaceDriverIds] = useState<string[] | null>(null);
  const [raceConfig, setRaceConfig] = useState<RaceConfig | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.teams, JSON.stringify(teams));
  }, [teams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.drivers, JSON.stringify(drivers));
  }, [drivers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.raceHistory, JSON.stringify(raceHistory));
  }, [raceHistory]);

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

  const addRaceToHistory = useCallback((race: SavedRaceSummary) => {
    setRaceHistory(prev => {
      const next = [race, ...prev];
      return next.slice(0, 50);
    });
  }, []);

  const deleteRaceFromHistory = useCallback((id: string) => {
    setRaceHistory(prev => prev.filter(r => r.id !== id));
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      teams,
      drivers,
      raceHistory,
      selectedRaceDriverIds,
      setSelectedRaceDriverIds,
      raceConfig,
      setRaceConfig,
      addTeam,
      updateTeam,
      deleteTeam,
      addDriver,
      updateDriver,
      deleteDriver,
      getTeamById,
      getDriverById,
      getDriversByTeamId,
      addRaceToHistory,
      deleteRaceFromHistory,
    }),
    [
      teams,
      drivers,
      raceHistory,
      selectedRaceDriverIds,
      raceConfig,
      addTeam,
      updateTeam,
      deleteTeam,
      addDriver,
      updateDriver,
      deleteDriver,
      getTeamById,
      getDriverById,
      getDriversByTeamId,
      addRaceToHistory,
      deleteRaceFromHistory,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
