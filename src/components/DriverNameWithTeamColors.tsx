import type { Driver, Team } from '@/types/game';

interface DriverNameWithTeamColorsProps {
  driver: Driver | null | undefined;
  team: Team | null | undefined;
  nameFallback?: string;
  nameClassName?: string;
}

export const DriverNameWithTeamColors = ({
  driver,
  team,
  nameFallback,
  nameClassName,
}: DriverNameWithTeamColorsProps) => {
  const name = driver?.name ?? nameFallback ?? 'Unknown driver';
  const primaryColor = team?.primaryColor;
  const secondaryColor = team?.secondaryColor;

  return (
    <div className="flex items-center gap-2">
      {primaryColor && (
        <div className="flex h-5">
          <div
            className="w-[3px]"
            style={{ backgroundColor: primaryColor }}
          />
          {secondaryColor && (
            <div
              className="w-[3px]"
              style={{ backgroundColor: secondaryColor }}
            />
          )}
        </div>
      )}
      <span className={nameClassName}>{name}</span>
    </div>
  );
};

