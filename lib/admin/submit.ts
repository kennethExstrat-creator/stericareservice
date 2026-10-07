import { startTransition, type FormEvent } from "react";

/**
 * A form's submit handler that runs its action by hand, for forms that hold
 * a Radix Select, RadioGroup, Checkbox or Switch:
 *
 *   const [state, formAction, pending] = useActionState(run, IDLE);
 *   <form onSubmit={submitAction(formAction, pending)} noValidate>
 *
 * React 19 resets a `<form action={fn}>` after every action, failed ones
 * included, and those Radix controls listen for the reset and go back to the
 * value they started with, controlled or not: a refused invite would quietly
 * flip the role back to Inspector. Submitted from onSubmit instead (the
 * default prevented, the action called in a transition, as
 * app/(app)/inspections/new does), the form is never reset, so every choice
 * stays as the admin left it, next to the message saying what to fix.
 *
 * `pending` drops a second submit while the first runs. `read` builds the
 * form data; tests pass their own (Node's FormData takes no form element).
 */
export function submitAction(
  action: (formData: FormData) => void,
  pending = false,
  read: (form: HTMLFormElement) => FormData = (form) => new FormData(form),
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    if (pending) return;
    const formData = read(event.currentTarget);
    startTransition(() => action(formData));
  };
}
