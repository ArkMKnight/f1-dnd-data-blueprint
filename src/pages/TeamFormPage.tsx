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
import type { Team } from '@/types/game';
import { TRAIT_DEFINITIONS } from '@/lib/trait-definitions';

const teamSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  teamPrincipal: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use hex e.g. #FF0000'),
  secondaryColor: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal('')]).optional(),
  lowSpeedCornering: z.coerce.number().min(0).max(200),
  mediumSpeedCornering: z.coerce.number().min(0).max(200),
  highSpeedCornering: z.coerce.number().min(0).max(200),
  acceleration: z.coerce.number().min(0).max(200),
  topSpeed: z.coerce.number().min(0).max(200),
  paceModifier: z.coerce.number(),
  racecraftModifier: z.coerce.number(),
  qualifyingModifier: z.coerce.number(),
  traitId: z.string().min(1, 'Team trait is required'),
});

type TeamFormValues = z.infer<typeof teamSchema>;

function toFormValues(team: Team | null): TeamFormValues {
  if (!team) {
    return {
      name: '',
      teamPrincipal: '',
      primaryColor: '#000000',
      secondaryColor: '',
      lowSpeedCornering: 100,
      mediumSpeedCornering: 100,
      highSpeedCornering: 100,
      acceleration: 100,
      topSpeed: 100,
      paceModifier: 0,
      racecraftModifier: 0,
      qualifyingModifier: 0,
      traitId: '',
    };
  }
  return {
    name: team.name,
    teamPrincipal: team.teamPrincipal ?? '',
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor ?? '',
    lowSpeedCornering: team.lowSpeedCornering,
    mediumSpeedCornering: team.mediumSpeedCornering,
    highSpeedCornering: team.highSpeedCornering,
    acceleration: team.acceleration,
    topSpeed: team.topSpeed,
    paceModifier: team.paceModifier,
    racecraftModifier: team.racecraftModifier,
    qualifyingModifier: team.qualifyingModifier,
    traitId: team.traitId ?? team.trait ?? '',
  };
}

export default function TeamFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getTeamById, addTeam, updateTeam, deleteTeam, getDriversByTeamId } = useData();
  const [teamDeleteDialog, setTeamDeleteDialog] = React.useState<'closed' | 'confirm' | 'blocked'>('closed');
  const isEdit = Boolean(id);
  const team = id ? getTeamById(id) : null;

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: toFormValues(team ?? null),
  });

  // Keep form in sync when editing and team loads
  React.useEffect(() => {
    if (isEdit && team) form.reset(toFormValues(team));
  }, [isEdit, team?.id]);

  const onSubmit = (values: TeamFormValues) => {
    const payload = {
      name: values.name,
      teamPrincipal: values.teamPrincipal || undefined,
      primaryColor: values.primaryColor,
      secondaryColor: values.secondaryColor || undefined,
      lowSpeedCornering: values.lowSpeedCornering,
      mediumSpeedCornering: values.mediumSpeedCornering,
      highSpeedCornering: values.highSpeedCornering,
      acceleration: values.acceleration,
      topSpeed: values.topSpeed,
      paceModifier: values.paceModifier,
      racecraftModifier: values.racecraftModifier,
      qualifyingModifier: values.qualifyingModifier,
      traitId: values.traitId,
    };

    if (isEdit && id) {
      updateTeam(id, payload);
      toast({ title: 'Team updated' });
    } else {
      addTeam(payload);
      toast({ title: 'Team created' });
    }
    navigate('/teams');
  };

  const handleDeleteClick = () => {
    if (!id) return;
    const driverCount = getDriversByTeamId(id).length;
    if (driverCount > 0) setTeamDeleteDialog('blocked');
    else setTeamDeleteDialog('confirm');
  };

  const handleConfirmTeamDelete = () => {
    if (!id) return;
    const result = deleteTeam(id);
    if (result.ok) {
      toast({ title: 'Team deleted' });
      setTeamDeleteDialog('closed');
      navigate('/teams');
    } else {
      toast({ title: result.reason, variant: 'destructive' });
      setTeamDeleteDialog('closed');
    }
  };

  if (isEdit && id && !team) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Team not found.</p>
        <Button variant="link" asChild><Link to="/teams">Back to Teams</Link></Button>
      </div>
    );
  }

  const driverCount = id ? getDriversByTeamId(id).length : 0;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {isEdit ? 'Edit Team' : 'New Team'}
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
              <FormField
                control={form.control}
                name="teamPrincipal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Principal (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="primaryColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary color (hex)</FormLabel>
                      <FormControl>
                        <Input type="color" {...field} className="h-10 w-full" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secondaryColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secondary color (hex, optional)</FormLabel>
                      <FormControl>
                        <Input type="color" {...field} value={field.value || '#cccccc'} className="h-10 w-full" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Car stats (0–200)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {(['lowSpeedCornering', 'mediumSpeedCornering', 'highSpeedCornering', 'acceleration', 'topSpeed'] as const).map(name => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{name.replace(/([A-Z])/g, ' $1').trim()}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                {(['paceModifier', 'racecraftModifier', 'qualifyingModifier'] as const).map(name => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{name.replace(/([A-Z])/g, ' $1').replace('Modifier', '')}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
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
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trait (required)</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={val => field.onChange(val)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select team trait" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TRAIT_DEFINITIONS.filter(t => t.scope === 'team').map(trait => (
                          <SelectItem key={trait.id} value={trait.id}>
                            {trait.name} ({trait.category.charAt(0).toUpperCase() + trait.category.slice(1)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/teams">Cancel</Link>
            </Button>
            {isEdit && id && (
              <Button type="button" variant="destructive" onClick={handleDeleteClick}>
                Delete Team
              </Button>
            )}
          </div>
        </form>
      </Form>

      <Button variant="ghost" asChild>
        <Link to="/">← Back to Simulator</Link>
      </Button>

      {/* Team delete: blocked (has drivers) or confirm (0 drivers) */}
      <AlertDialog
        open={teamDeleteDialog !== 'closed'}
        onOpenChange={open => !open && setTeamDeleteDialog('closed')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {teamDeleteDialog === 'blocked' ? 'Cannot delete team' : 'Delete team'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {teamDeleteDialog === 'blocked' ? (
                'This team has assigned drivers. Reassign or delete drivers first.'
              ) : (
                'Are you sure you want to delete this team? This cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {teamDeleteDialog === 'blocked' ? (
              <AlertDialogAction onClick={() => setTeamDeleteDialog('closed')}>
                OK
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmTeamDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
