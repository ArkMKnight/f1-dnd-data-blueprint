import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useData } from '@/context/DataContext';

export default function TeamListPage() {
  const { teams, getDriversByTeamId } = useData();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
        <Button asChild>
          <Link to="/teams/new">Add Team</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">All Teams</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-24">Colors</TableHead>
                <TableHead className="text-center w-24">Drivers</TableHead>
                <TableHead className="text-right w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map(team => {
                const count = getDriversByTeamId(team.id).length;
                return (
                  <TableRow key={team.id}>
                    <TableCell className="font-medium">{team.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span
                          className="inline-block w-5 h-5 rounded border border-border"
                          style={{ backgroundColor: team.primaryColor }}
                          title={team.primaryColor}
                        />
                        {team.secondaryColor && (
                          <span
                            className="inline-block w-5 h-5 rounded border border-border"
                            style={{ backgroundColor: team.secondaryColor }}
                            title={team.secondaryColor}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{count}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/teams/${team.id}/edit`}>Edit</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button variant="ghost" asChild>
        <Link to="/">← Back to Simulator</Link>
      </Button>
    </div>
  );
}
