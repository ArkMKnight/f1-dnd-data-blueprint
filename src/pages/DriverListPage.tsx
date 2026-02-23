import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useData } from '@/context/DataContext';
import { useToast } from '@/hooks/use-toast';

export default function DriverListPage() {
  const { drivers, getTeamById, deleteDriver } = useData();
  const { toast } = useToast();
  const [driverToDelete, setDriverToDelete] = useState<{ id: string; name: string } | null>(null);

  const handleConfirmDelete = () => {
    if (!driverToDelete) return;
    deleteDriver(driverToDelete.id);
    toast({ title: 'Driver deleted' });
    setDriverToDelete(null);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
        <Button asChild>
          <Link to="/drivers/new">Add Driver</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">All Drivers</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Nationality</TableHead>
                <TableHead className="text-center">PAC</TableHead>
                <TableHead className="text-center">QUA</TableHead>
                <TableHead className="text-center">RAC</TableHead>
                <TableHead className="text-center">AWR</TableHead>
                <TableHead className="text-center">ADP</TableHead>
                <TableHead className="text-right w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map(driver => {
                const team = getTeamById(driver.teamId);
                return (
                  <TableRow key={driver.id}>
                    <TableCell className="font-mono">{driver.number}</TableCell>
                    <TableCell className="font-medium">{driver.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{team?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{driver.nationality}</TableCell>
                    <TableCell className="text-center">{driver.pace}</TableCell>
                    <TableCell className="text-center">{driver.qualifying}</TableCell>
                    <TableCell className="text-center">{driver.racecraft}</TableCell>
                    <TableCell className="text-center">{driver.awareness}</TableCell>
                    <TableCell className="text-center">{driver.adaptability}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/drivers/${driver.id}/edit`}>Edit</Link>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDriverToDelete({ id: driver.id, name: driver.name })}
                        >
                          Delete
                        </Button>
                      </div>
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

      <AlertDialog open={!!driverToDelete} onOpenChange={open => !open && setDriverToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete driver</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this driver?
              {driverToDelete && (
                <span className="block mt-1 font-medium text-foreground">{driverToDelete.name}</span>
              )}
              If they were selected for the upcoming race, they will be removed from the selection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
