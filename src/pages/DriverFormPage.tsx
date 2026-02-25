import * as React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { Driver } from '@/types/game';
import { DRIVER_STAT_RANGE } from '@/types/game';
import { TRAIT_DEFINITIONS } from '@/lib/trait-definitions';

const statSchema = z.number().min(DRIVER_STAT_RANGE.min).max(DRIVER_STAT_RANGE.max);

const driverSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  number: z.coerce.number().int().min(0),
  nationality: z.string().min(1, 'Nationality is required'),
  age: z.coerce.number().int().min(1).max(120).optional().nullable(),
  teamId: z.string().min(1, 'Team is required'),
  pace: statSchema,
  qualifying: statSchema,
  racecraft: statSchema,
  awareness: statSchema,
  adaptability: statSchema,
  paceModifier: z.coerce.number().optional(),
  racecraftModifier: z.coerce.number().optional(),
  qualifyingModifier: z.coerce.number().optional(),
  traitId: z.string().optional().nullable(),
});

type DriverFormValues = z.infer<typeof driverSchema>;

function toFormValues(driver: Driver | null, teams: { id: string }[]): DriverFormValues {
  if (!driver) {
    const firstTeamId = teams[0]?.id ?? '';
    return {
      name: '',
      number: 0,
      nationality: '',
      age: undefined,
      teamId: firstTeamId,
      pace: 10,
      qualifying: 10,
      racecraft: 10,
      awareness: 10,
      adaptability: 10,
      paceModifier: 0,
      racecraftModifier: 0,
      qualifyingModifier: 0,
      traitId: null,
    };
  }
  return {
    name: driver.name,
    number: driver.number,
    nationality: driver.nationality,
    age: driver.age ?? undefined,
    teamId: driver.teamId,
    pace: driver.pace,
    qualifying: driver.qualifying,
    racecraft: driver.racecraft,
    awareness: driver.awareness,
    adaptability: driver.adaptability,
    paceModifier: driver.paceModifier ?? 0,
    racecraftModifier: driver.racecraftModifier ?? 0,
    qualifyingModifier: driver.qualifyingModifier ?? 0,
    traitId: driver.traitId ?? driver.trait ?? null,
  };
}

export default function DriverFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { teams, getDriverById, addDriver, updateDriver, deleteDriver, getTeamById } = useData();
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const isEdit = Boolean(id);
  const driver = id ? getDriverById(id) : null;

  const form = useForm<DriverFormValues>({
    resolver: zodResolver(driverSchema),
    defaultValues: toFormValues(driver ?? null, teams),
  });

  React.useEffect(() => {
    if (isEdit && driver) form.reset(toFormValues(driver, teams));
  }, [isEdit, driver?.id, teams.length]);

  const onSubmit = (values: DriverFormValues) => {
    const teamExists = getTeamById(values.teamId);
    if (!teamExists) {
      toast({ title: 'Selected team does not exist.', variant: 'destructive' });
      return;
    }
    const payload = {
      name: values.name,
      number: values.number,
      nationality: values.nationality,
      age: values.age ?? undefined,
      teamId: values.teamId,
      pace: values.pace,
      qualifying: values.qualifying,
      racecraft: values.racecraft,
      awareness: values.awareness,
      adaptability: values.adaptability,
      paceModifier: values.paceModifier,
      racecraftModifier: values.racecraftModifier,
      qualifyingModifier: values.qualifyingModifier,
      traitId: values.traitId || null,
    };

    if (isEdit && id) {
      updateDriver(id, payload);
      toast({ title: 'Driver updated' });
    } else {
      addDriver(payload);
      toast({ title: 'Driver created' });
    }
    navigate('/drivers');
  };

  const handleDeleteClick = () => setShowDeleteConfirm(true);

  const handleConfirmDelete = () => {
    if (!id) return;
    deleteDriver(id);
    toast({ title: 'Driver deleted' });
    setShowDeleteConfirm(false);
    navigate('/drivers');
  };

  if (isEdit && id && !driver) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Driver not found.</p>
        <Button variant="link" asChild><Link to="/drivers">Back to Drivers</Link></Button>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6 max-w-2xl mx-auto space-y-4">
        <p className="text-muted-foreground">Create at least one team before adding drivers.</p>
        <Button asChild><Link to="/teams/new">Add Team</Link></Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {isEdit ? 'Edit Driver' : 'New Driver'}
      </h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nationality"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nationality</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="age"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Age (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => {
                          const v = e.target.value;
                          field.onChange(v === '' ? undefined : parseInt(v, 10));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="teamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team (required)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teams.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Stats (1–20)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {(['pace', 'qualifying', 'racecraft', 'awareness', 'adaptability'] as const).map(name => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{name.charAt(0).toUpperCase() + name.slice(1)}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={DRIVER_STAT_RANGE.min}
                            max={DRIVER_STAT_RANGE.max}
                            {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4">
                {(['paceModifier', 'racecraftModifier', 'qualifyingModifier'] as const).map(name => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{name.replace(/([A-Z])/g, ' $1').replace('Modifier', '')} mod</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <FormField
                control={form.control}
                name="traitId"
                render={({ field }) => {
                  const NO_TRAIT = '__no_trait__';
                  const value = field.value ?? NO_TRAIT;
                  return (
                  <FormItem className="mt-4">
                    <FormLabel>Trait (optional)</FormLabel>
                    <Select
                      value={value}
                      onValueChange={val => field.onChange(val === NO_TRAIT ? null : val)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No Trait" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_TRAIT}>No Trait</SelectItem>
                        {TRAIT_DEFINITIONS.filter(t => t.scope === 'driver').map(trait => (
                          <SelectItem key={trait.id} value={trait.id}>
                            {trait.name} ({trait.category.charAt(0).toUpperCase() + trait.category.slice(1)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                  );
                }}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/drivers">Cancel</Link>
            </Button>
            {isEdit && id && (
              <Button type="button" variant="destructive" onClick={handleDeleteClick}>
                Delete Driver
              </Button>
            )}
          </div>
        </form>
      </Form>

      <Button variant="ghost" asChild>
        <Link to="/">← Back to Simulator</Link>
      </Button>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete driver</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this driver?
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
